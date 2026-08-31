import '../../client/admin/progress.js';
const { approvedStageStatus, confirmedSnapshot } = globalThis.OfferPilotProgress;

class SupabaseMobileService {
  constructor() {
    this.url = '';
    this.key = '';
    this.ws = null;
    this.heartbeatTimer = null;
    this.reconnectTimer = null;
    this.realtimeSubscribers = [];
    this.statusListeners = [];
    this.isConnected = false;
    this.refCounter = 1;

    this.loadStoredConfig();
  }

  loadStoredConfig() {
    // 方案 A：代码完全纯净零内置，100% 依赖用户手机本机的安全沙盒 LocalStorage
    this.url = localStorage.getItem('offerpilot_supabase_url') || '';
    this.key = localStorage.getItem('offerpilot_supabase_key') || '';
  }

  saveConfig(url, key) {
    this.url = (url || '').trim().replace(/\/+$/, '');
    this.key = (key || '').trim();
    // 持久化保存至本机沙盒，关机或重启 App 均无需重复配置
    localStorage.setItem('offerpilot_supabase_url', this.url);
    localStorage.setItem('offerpilot_supabase_key', this.key);
    this.initRealtime();
  }

  clearConfig() {
    this.url = '';
    this.key = '';
    localStorage.removeItem('offerpilot_supabase_url');
    localStorage.removeItem('offerpilot_supabase_key');
    if (this.ws) {
      try { this.ws.close(); } catch(e) {}
      this.ws = null;
    }
    this.notifyStatus(false);
  }

  getConfig() {
    return {
      url: this.url,
      key: this.key,
      isConfigured: !!(this.url && this.key)
    };
  }

  onStatusChange(fn) {
    this.statusListeners.push(fn);
    fn(this.isConnected);
  }

  onRealtimeMessage(fn) {
    this.realtimeSubscribers.push(fn);
  }

  notifyStatus(connected) {
    this.isConnected = connected;
    this.statusListeners.forEach(fn => fn(connected));
  }

  notifySubscribers(payload) {
    this.realtimeSubscribers.forEach(fn => fn(payload));
  }

  async testConnection(testUrl, testKey) {
    const url = (testUrl || '').trim().replace(/\/+$/, '');
    const key = (testKey || '').trim();
    if (!url || !key) {
      throw new Error('Supabase URL 与 Anon Key 不能为空');
    }

    const endpoint = `${url}/rest/v1/applications?select=id&limit=1`;
    const res = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'apikey': key,
        'Authorization': `Bearer ${key}`
      }
    });

    if (!res.ok) {
      const errTxt = await res.text();
      throw new Error(`连接失败 (HTTP ${res.status}): ${errTxt || '鉴权失败或网络异常'}`);
    }

    return true;
  }

  async fetchApplicationsWithStages() {
    if (!this.url || !this.key) return { applications: [], stages: [] };

    const headers = {
      'apikey': this.key,
      'Authorization': `Bearer ${this.key}`
    };

    // 1. 获取投递主表
    const appRes = await fetch(`${this.url}/rest/v1/applications?select=*&order=updated_at.desc`, { headers });
    if (!appRes.ok) throw new Error('拉取投递数据失败');
    const applications = await appRes.json();

    // 2. 获取环节子表
    const stageRes = await fetch(`${this.url}/rest/v1/application_stages?select=*&order=seq.asc`, { headers });
    if (!stageRes.ok) throw new Error('拉取环节数据失败');
    const stages = await stageRes.json();

    return { applications, stages };
  }

  async writeRecord(table, query, data, method = 'PATCH') {
    if (!this.url || !this.key) throw new Error('未配置 Supabase');
    const res = await fetch(`${this.url}/rest/v1/${table}${query ? '?' + query : ''}`, {
      method, headers: {apikey: this.key, Authorization: `Bearer ${this.key}`,
        'Content-Type': 'application/json', Prefer: 'return=representation'},
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error(`保存 ${table} 失败 (${res.status})`);
    const rows = await res.json();
    if (!rows.length) throw new Error('记录已变化或没有写入权限，请刷新');
    return rows;
  }

  async updateStageStatus(stageId, newStatus) {
    return this.updateStageAndApplication(stageId, null, {stage_status: newStatus}, {});
  }

  async approveStage(stageId) {
    const {stages} = await this.fetchApplicationsWithStages();
    const stage = stages.find(s => s.id === stageId);
    if (!stage || stage.stage_status !== 'pending') throw new Error('待审记录已变化，请刷新');
    return this.updateStageStatus(stageId, approvedStageStatus(stage));
  }

  async updateStageAndApplication(stageId, appId, stageData, appData = {}) {
    const {stages, applications = []} = await this.fetchApplicationsWithStages();
    const stage = stages.find(s => s.id === stageId);
    if (!stage) throw new Error('环节不存在，请刷新');
    appId = stage.application_id;
    const stamp = new Date().toISOString();
    const change = {...stageData, updated_at: stamp};
    const query = `id=eq.${encodeURIComponent(stageId)}`;
    await this.writeRecord('application_stages', query + (stage.updated_at ? `&updated_at=eq.${encodeURIComponent(stage.updated_at)}` : ''), change);
    try {
      const snapshot = confirmedSnapshot(stages.filter(s => s.application_id === appId)
        .map(s => s.id === stageId ? {...s, ...change} : s));
      // 快照只由最新已确认环节决定，编辑历史环节不能覆盖当前进度。
      const {current_stage_name, overall_status, ...details} = appData;
      const app = applications.find(a => a.id === appId);
      if (app && app.overall_status === 'archived') snapshot.overall_status = 'archived';
      const appQuery = `id=eq.${encodeURIComponent(appId)}` + (app && app.updated_at ? `&updated_at=eq.${encodeURIComponent(app.updated_at)}` : '');
      await this.writeRecord('applications', appQuery,
        {...details, ...snapshot, updated_at: stamp});
    } catch (err) {
      const before = Object.fromEntries(Object.keys(change).map(k => [k, stage[k] ?? null]));
      try {
        await this.writeRecord('application_stages', `${query}&updated_at=eq.${encodeURIComponent(stamp)}`, before);
      } catch (undo) { throw new Error(`保存失败且恢复失败，请核对云端记录：${err.message}；${undo.message}`); }
      throw err;
    }
  }

  async createApplicationWithStage(appData, stageData) {
    if (!appData.position || !appData.position.trim()) throw new Error('请填写岗位名称，避免合并不同岗位');
    const {applications, stages} = await this.fetchApplicationsWithStages();
    const existing = applications.filter(a => a.company === appData.company &&
      (a.department || '') === (appData.department || '') &&
      (a.position || '') === (appData.position || '') && ['active', 'offered'].includes(a.overall_status));
    if (existing.length > 1) throw new Error('存在多个同名岗位，请先核对投递记录');
    let app = existing[0];
    if (!app) {
      [app] = await this.writeRecord('applications', '', {...appData,
        current_stage_name: '待审核', overall_status: 'active'}, 'POST');
    }
    const seq = Math.max(0, ...stages.filter(s => s.application_id === app.id).map(s => s.seq || 1)) + 1;
    const [stage] = await this.writeRecord('application_stages', '', {...stageData,
      application_id: app.id, seq, stage_status: 'pending'}, 'POST');
    try {
      await this.updateStageStatus(stage.id, stageData.stage_status || 'scheduled');
    } catch (err) { throw new Error(`已保存待审记录，请核对后重试，勿重复新增：${err.message}`); }
    return true;
  }

  async deleteStage(stageId) {
    // 保留可恢复历史，与网页端一致。
    return this.updateStageStatus(stageId, 'ignored');
  }

  async batchApproveStages(stageIds) {
    let completed = 0;
    try {
      for (const id of stageIds || []) { await this.approveStage(id); completed++; }
    } catch (err) { throw new Error(`已放行 ${completed} 封，其余未完成：${err.message}`); }
  }

  // ==================== WebSocket Realtime 实时双向推流 ====================
  initRealtime() {
    if (!this.url || !this.key) {
      this.notifyStatus(false);
      return;
    }

    if (this.ws) {
      try { this.ws.close(); } catch(e) {}
      this.ws = null;
    }
    clearInterval(this.heartbeatTimer);
    clearTimeout(this.reconnectTimer);

    try {
      const wsUrl = this.url.replace(/^http/, 'ws') + `/realtime/v1/websocket?apikey=${this.key}&vsn=1.0.0`;
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.notifyStatus(true);
        // 订阅 Realtime 广播频道
        const joinMsg = {
          topic: 'realtime:public',
          event: 'phx_join',
          payload: { config: { broadcast: { self: true }, presence: { key: '' }, postgres_changes: [{ event: '*', schema: 'public' }] } },
          ref: String(this.refCounter++)
        };
        this.ws.send(JSON.stringify(joinMsg));

        // 心跳保活 25s
        this.heartbeatTimer = setInterval(() => {
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
              topic: 'phoenix',
              event: 'heartbeat',
              payload: {},
              ref: String(this.refCounter++)
            }));
          }
        }, 25000);
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.event === 'postgres_changes' || msg.event === 'broadcast') {
            this.notifySubscribers(msg.payload);
          }
        } catch (e) {}
      };

      this.ws.onerror = () => {
        this.notifyStatus(false);
      };

      this.ws.onclose = () => {
        this.notifyStatus(false);
        this.reconnectTimer = setTimeout(() => {
          this.initRealtime();
        }, 6000);
      };

    } catch (e) {
      this.notifyStatus(false);
    }
  }
}

export const supabaseService = new SupabaseMobileService();

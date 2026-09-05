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
    if (!this.url || !this.key) return { applications: [], stages: [], recruitmentEvents: [], recruitmentEventsError: '' };

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

    // 3. 招聘会是独立记录；旧数据库尚未建表时不阻断企业数据加载。
    const eventRes = await fetch(`${this.url}/rest/v1/recruitment_events?select=*&order=starts_at.asc`, { headers });
    const recruitmentEvents = eventRes.ok ? await eventRes.json() : [];
    const recruitmentEventsError = eventRes.ok ? '' : '招聘会数据暂不可用，请先执行 recruitment_events.sql。';

    return { applications, stages, recruitmentEvents, recruitmentEventsError };
  }

  async updateApplicationFocus(appId, isFocused) {
    return this.writeRecord('applications', 'PATCH', { is_focused: isFocused }, appId);
  }

  async saveRecruitmentEvent(payload, eventId = '') {
    return this.writeRecord('recruitment_events', eventId ? 'PATCH' : 'POST', payload, eventId);
  }

  async updateRecruitmentEvent(eventId, changes) {
    return this.writeRecord('recruitment_events', 'PATCH', changes, eventId);
  }

  async writeRecord(table, method, payload, id = '') {
    if (!this.url || !this.key) throw new Error('未配置 Supabase');
    const query = id ? `?id=eq.${encodeURIComponent(id)}` : '';
    const res = await fetch(`${this.url}/rest/v1/${table}${query}`, {
      method,
      headers: {
        'apikey': this.key,
        'Authorization': `Bearer ${this.key}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(detail || '云端记录更新失败');
    }
    const rows = await res.json();
    if (!rows.length) throw new Error('记录未更新，请刷新后重试');
    return rows[0];
  }

  async updateStageStatus(stageId, newStatus) {
    if (!this.url || !this.key) throw new Error('未配置 Supabase');
    const res = await fetch(`${this.url}/rest/v1/application_stages?id=eq.${stageId}`, {
      method: 'PATCH',
      headers: {
        'apikey': this.key,
        'Authorization': `Bearer ${this.key}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({
        stage_status: newStatus,
        updated_at: new Date().toISOString()
      })
    });
    if (!res.ok) throw new Error('更新状态失败');
    return await res.json();
  }

  async updateStageAndApplication(stageId, appId, stageData, appData) {
    if (!this.url || !this.key) throw new Error('未配置 Supabase');
    const headers = {
      'apikey': this.key,
      'Authorization': `Bearer ${this.key}`,
      'Content-Type': 'application/json'
    };

    // 1. 更新主表
    if (appId && appData) {
      await fetch(`${this.url}/rest/v1/applications?id=eq.${appId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          ...appData,
          updated_at: new Date().toISOString()
        })
      });
    }

    // 2. 更新子表
    if (stageId && stageData) {
      await fetch(`${this.url}/rest/v1/application_stages?id=eq.${stageId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          ...stageData,
          updated_at: new Date().toISOString()
        })
      });
    }
  }

  async createApplicationWithStage(appData, stageData) {
    if (!this.url || !this.key) throw new Error('未配置 Supabase');
    const headers = {
      'apikey': this.key,
      'Authorization': `Bearer ${this.key}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    };

    // 检查是否存在同名公司
    const checkRes = await fetch(`${this.url}/rest/v1/applications?company=eq.${encodeURIComponent(appData.company)}&limit=1`, { headers });
    let appId = null;
    let existingApp = null;
    if (checkRes.ok) {
      const existing = await checkRes.json();
      if (existing && existing.length > 0) {
        existingApp = existing[0];
        appId = existingApp.id;
      }
    }

    if (!appId) {
      const createRes = await fetch(`${this.url}/rest/v1/applications`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          company: appData.company,
          department: appData.department || '',
          position: appData.position || '通用岗位',
          current_stage_name: stageData.stage_name,
          overall_status: 'active'
        })
      });
      if (!createRes.ok) throw new Error('创建主表记录失败');
      const createdApp = await createRes.json();
      appId = createdApp[0].id;
    }

    // 查询当前最大 seq；并列环节复用同一 seq，但仍是独立记录。
    const stagesRes = await fetch(`${this.url}/rest/v1/application_stages?application_id=eq.${appId}&select=seq&order=seq.desc&limit=1`, { headers });
    let maxSeq = 0;
    if (stagesRes.ok) {
      const s = await stagesRes.json();
      if (s && s.length > 0) maxSeq = s[0].seq || 0;
    }

    if (existingApp) {
      const currentStageName = stageData.parallel_with_latest && maxSeq > 0
        ? [...new Set(String(existingApp.current_stage_name || '').split(' / ').filter(Boolean).concat(stageData.stage_name))].join(' / ')
        : stageData.stage_name;
      await fetch(`${this.url}/rest/v1/applications?id=eq.${appId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          current_stage_name: currentStageName,
          updated_at: new Date().toISOString()
        })
      });
    }

    // 插入环节
    const insertStageRes = await fetch(`${this.url}/rest/v1/application_stages`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        application_id: appId,
        seq: stageData.parallel_with_latest && maxSeq > 0 ? maxSeq : maxSeq + 1,
        stage_name: stageData.stage_name,
        stage_status: stageData.stage_status || 'scheduled',
        schedule_time: stageData.schedule_time || '待定',
        schedule_type: stageData.schedule_type || 'unknown',
        meeting_info: stageData.meeting_info || '',
        next_expectation: stageData.next_expectation || '',
        notes: stageData.notes || ''
      })
    });

    if (!insertStageRes.ok) throw new Error('插入环节记录失败');
    return true;
  }

  async deleteStage(stageId) {
    if (!this.url || !this.key) throw new Error('未配置 Supabase');
    const res = await fetch(`${this.url}/rest/v1/application_stages?id=eq.${stageId}`, {
      method: 'DELETE',
      headers: {
        'apikey': this.key,
        'Authorization': `Bearer ${this.key}`
      }
    });
    if (!res.ok) throw new Error('删除环节失败');
    return true;
  }

  async batchApproveStages(stageIds) {
    if (!stageIds || stageIds.length === 0) return;
    const headers = {
      'apikey': this.key,
      'Authorization': `Bearer ${this.key}`,
      'Content-Type': 'application/json'
    };
    for (const id of stageIds) {
      await fetch(`${this.url}/rest/v1/application_stages?id=eq.${id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          stage_status: 'scheduled',
          updated_at: new Date().toISOString()
        })
      });
    }
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

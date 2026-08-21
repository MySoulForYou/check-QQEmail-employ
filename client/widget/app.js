function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/[&<>'"]/g, 
        tag => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        }[tag] || tag)
    );
}

document.addEventListener('DOMContentLoaded', () => {
    const pendingList = document.getElementById('task-list');
    const historyList = document.getElementById('history-list');
    const pendingCount = document.getElementById('pending-count');
    const historyCount = document.getElementById('history-count');
    const pendingHeader = document.getElementById('pending-header');
    const historyHeader = document.getElementById('history-header');
    const refreshBtn = document.getElementById('refresh-btn');
    const lastSyncSpan = document.getElementById('last-sync');
    const statusDot = document.getElementById('status-dot');
    
    // Modal Elements
    const setupModal = document.getElementById('setup-modal');
    const settingsBtn = document.getElementById('settings-btn');
    const cfgUrlInput = document.getElementById('cfg-url');
    const cfgKeyInput = document.getElementById('cfg-key');
    const cfgMsg = document.getElementById('cfg-msg');
    const btnSaveCfg = document.getElementById('btn-save-cfg');
    const btnCloseCfg = document.getElementById('btn-close-cfg');

    let supabase = null;
    let realtimeChannel = null;

    function updateStatusDot(online, reconnecting = false) {
        if (!statusDot) return;
        statusDot.className = '';
        if (reconnecting) {
            statusDot.classList.add('reconnecting');
            statusDot.title = '正在重连云端...';
        } else if (online) {
            statusDot.classList.add('online');
            statusDot.title = '云端连接正常 (Realtime 监听中)';
        } else {
            statusDot.classList.add('offline');
            statusDot.title = '云端连接断开 (离线/未配置)';
        }
    }

    // 折叠展开交互
    function toggleCollapse(header, list) {
        header.addEventListener('click', () => {
            const isCollapsed = list.classList.toggle('collapsed');
            header.classList.toggle('is-collapsed', isCollapsed);
        });
    }
    toggleCollapse(pendingHeader, pendingList);
    toggleCollapse(historyHeader, historyList);

    // 模态弹窗控制
    function showModal(isInitial = false) {
        const cfg = window.APP_CONFIG || {};
        cfgUrlInput.value = cfg.SUPABASE_URL || '';
        cfgKeyInput.value = cfg.SUPABASE_ANON_KEY || '';
        cfgMsg.textContent = '';
        cfgMsg.className = 'cfg-msg';

        if (isInitial || !cfg.SUPABASE_URL) {
            btnCloseCfg.style.display = 'none';
        } else {
            btnCloseCfg.style.display = 'block';
        }
        setupModal.classList.add('active');
    }

    function hideModal() {
        setupModal.classList.remove('active');
    }

    settingsBtn.addEventListener('click', () => showModal(false));
    btnCloseCfg.addEventListener('click', hideModal);

    const quitBtn = document.getElementById('quit-btn');
    if (quitBtn) {
        quitBtn.addEventListener('click', () => {
            if (window.pywebview && window.pywebview.api && window.pywebview.api.close_widget) {
                window.pywebview.api.close_widget();
            } else {
                window.close();
            }
        });
    }

    // 保存配置
    btnSaveCfg.addEventListener('click', async () => {
        const url = cfgUrlInput.value.trim().replace(/\/+$/, '');
        const key = cfgKeyInput.value.trim();

        if (!url || !key) {
            cfgMsg.textContent = '⚠️ 请完整填写 Supabase URL 和 Key';
            cfgMsg.className = 'cfg-msg error';
            return;
        }

        if (!url.startsWith('https://') && !url.startsWith('http://')) {
            cfgMsg.textContent = '⚠️ URL 必须以 https:// 开头';
            cfgMsg.className = 'cfg-msg error';
            return;
        }

        btnSaveCfg.textContent = '正在保存并测试...';
        btnSaveCfg.disabled = true;

        try {
            const resp = await fetch('/api/save_config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: url, publishable_key: key })
            });
            const res = await resp.json();

            if (res.success) {
                cfgMsg.textContent = '✅ 保存成功，正在连通云端...';
                cfgMsg.className = 'cfg-msg success';

                window.APP_CONFIG.SUPABASE_URL = url;
                window.APP_CONFIG.SUPABASE_ANON_KEY = key;
                window.APP_CONFIG.IS_CONFIGURED = true;

                initClient();
                setTimeout(hideModal, 800);
            } else {
                throw new Error(res.message || '保存失败');
            }
        } catch (err) {
            cfgMsg.textContent = `❌ 保存失败: ${err.message}`;
            cfgMsg.className = 'cfg-msg error';
        } finally {
            btnSaveCfg.textContent = '⚡️ 保存并立即连接';
            btnSaveCfg.disabled = false;
        }
    });

    // 2. 从 Supabase 拉取任务数据 (桌面端展示待办状态 stage_status = 'scheduled')
    async function fetchData() {
        if (!supabase) return;
        try {
            // 拉取所有 applications 用于获取公司名称和部门
            const { data: appsData, error: appsErr } = await supabase
                .from('applications')
                .select('id, company, department, position, overall_status');

            if (appsErr) throw appsErr;

            const appsMap = {};
            (appsData || []).forEach(a => {
                appsMap[a.id] = a;
            });

            // 待办待参加/待作答任务
            const { data: pendingStages, error: pendingErr } = await supabase
                .from('application_stages')
                .select('*')
                .eq('stage_status', 'scheduled')
                .order('created_at', { ascending: false });

            if (pendingErr) throw pendingErr;

            // 完结等待结果或历史通过任务
            const { data: completedStages, error: completedErr } = await supabase
                .from('application_stages')
                .select('*')
                .in('stage_status', ['awaiting_result', 'passed'])
                .order('updated_at', { ascending: false })
                .limit(20);

            if (completedErr) throw completedErr;

            // 绑定 application 信息
            const enrichedPending = (pendingStages || []).map(s => ({
                ...s,
                app: appsMap[s.application_id] || { company: '未知企业', position: '' }
            })).filter(s => s.app.overall_status !== 'archived');

            const enrichedCompleted = (completedStages || []).map(s => ({
                ...s,
                app: appsMap[s.application_id] || { company: '未知企业', position: '' }
            }));

            renderTasks(enrichedPending, enrichedCompleted);
            updateStatusDot(true);

            const now = new Date();
            const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
            lastSyncSpan.textContent = `最后同步: ${timeStr}`;
        } catch (error) {
            console.error('Supabase fetch error:', error);
            updateStatusDot(false);
            if (pendingList.children.length === 0 || pendingList.querySelector('.loading')) {
                pendingList.innerHTML = '<div class="loading" style="color:#ff6b81">云端连接异常，点击 ⚙️ 检查配置</div>';
            }
        }
    }

    // 3. 渲染任务列表
    function renderTasks(pendingTasks, completedTasks) {
        pendingCount.textContent = pendingTasks.length;
        historyCount.textContent = completedTasks.length;

        if (pendingTasks.length === 0) {
            pendingList.innerHTML = '<div class="loading">暂无已审核待办任务<br><span style="font-size:0.75rem;opacity:0.8">可在管理后台审核新邮件 ☕️</span></div>';
        } else {
            pendingList.innerHTML = pendingTasks.map(task => createTaskHTML(task, false)).join('');
        }

        if (completedTasks.length === 0) {
            historyList.innerHTML = '<div class="loading">暂无历史记录</div>';
        } else {
            historyList.innerHTML = completedTasks.map(task => createTaskHTML(task, true)).join('');
        }

        attachTaskEvents();
    }

    function createTaskHTML(task, isHistory = false) {
        let typeClass = '';
        const taskType = (task.stage_name || '求职通知').trim();
        let typeIcon = '⏳';

        if (taskType.includes('AI')) {
            typeClass = 'type-ai';
            typeIcon = '🤖';
        } else if (taskType.includes('笔试')) {
            typeClass = 'type-test';
            typeIcon = '📝';
        } else if (taskType.includes('测评') || taskType.includes('认知')) {
            typeClass = 'type-assessment';
            typeIcon = '📝';
        } else if (taskType.includes('Offer') || taskType.includes('录取') || taskType.includes('意向') || taskType.includes('沟通')) {
            typeClass = 'type-success';
            typeIcon = '🎁';
        } else if (taskType.includes('投递') || taskType.includes('网申') || taskType.includes('资料') || taskType.includes('入职')) {
            typeClass = 'type-info';
            typeIcon = '📬';
        } else if (taskType.includes('终面') || taskType.includes('总监')) {
            typeClass = 'type-success';
            typeIcon = '🏆';
        } else if (taskType.includes('二面') || taskType.includes('复试')) {
            typeClass = 'type-online';
            typeIcon = '🎯';
        } else if (taskType.includes('一面') || taskType.includes('初试') || taskType.includes('面试')) {
            typeClass = 'type-online';
            typeIcon = '⏳';
        } else if (taskType.includes('感谢信') || taskType.includes('结束') || taskType.includes('终止')) {
            typeClass = 'type-offline';
            typeIcon = '📦';
        }

        const app = task.app || {};
        const compDisplay = app.department ? `${app.company} · ${app.department}` : (app.company || '未知企业');
        const safeCompany = escapeHTML(compDisplay);
        const safeType = escapeHTML(taskType);
        const safeTime = escapeHTML(task.schedule_time || '待定');
        
        let completedTimeText = '';
        if (isHistory && (task.updated_at || task.created_at)) {
            try {
                const dt = new Date(task.updated_at || task.created_at);
                completedTimeText = `${dt.getMonth() + 1}/${dt.getDate()} ${dt.getHours().toString().padStart(2, '0')}:${dt.getMinutes().toString().padStart(2, '0')}`;
            } catch (e) {
                completedTimeText = '已完成';
            }
        }

        let historyActionLabel = `✓ 【${safeType}】已完成 @ ${completedTimeText}`;
        if (taskType.includes('笔试') || taskType.includes('测评')) {
            historyActionLabel = `✓ 【${safeType}】已作答 @ ${completedTimeText}`;
        } else if (taskType.includes('面试') || taskType.includes('初试') || taskType.includes('复试') || taskType.includes('终面')) {
            historyActionLabel = `✓ 【${safeType}】已参加 @ ${completedTimeText}`;
        } else if (taskType.includes('网申') || taskType.includes('投递')) {
            historyActionLabel = `✓ 【${safeType}】已送达 @ ${completedTimeText}`;
        } else if (taskType.includes('Offer') || taskType.includes('录用') || taskType.includes('意向')) {
            historyActionLabel = `🎉 【${safeType}】已完成 @ ${completedTimeText}`;
        } else if (taskType.includes('感谢信') || taskType.includes('结束') || taskType.includes('终止')) {
            historyActionLabel = `📦 【${safeType}】已归档 @ ${completedTimeText}`;
        }

        return `
            <div class="task-item ${isHistory ? 'is-completed' : ''}" id="task-${task.id}" data-id="${task.id}">
                <div class="task-header">
                    <span class="company-name" title="${safeCompany}">${safeCompany}</span>
                    <span class="task-type ${typeClass}">${typeIcon} ${safeType}</span>
                </div>
                <div class="task-time">${safeTime}</div>
                ${isHistory ? 
                    `<div class="completed-tag">${historyActionLabel}</div>` : 
                    `<button class="complete-btn" data-id="${task.id}" title="标记为参加/作答完成">✓</button>`
                }
            </div>
        `;
    }

    function attachTaskEvents() {
        document.querySelectorAll('.complete-btn').forEach(btn => {
            btn.onclick = async (e) => {
                e.stopPropagation();
                const stageId = btn.getAttribute('data-id');
                const taskElement = document.getElementById(`task-${stageId}`);

                if (taskElement) {
                    taskElement.style.opacity = '0.3';
                    taskElement.style.transform = 'scale(0.95)';
                }

                try {
                    const nowIso = new Date().toISOString();
                    const { error } = await supabase
                        .from('application_stages')
                        .update({ 
                            stage_status: 'awaiting_result', 
                            updated_at: nowIso
                        })
                        .eq('id', stageId);

                    if (error) throw error;
                    fetchData();
                } catch (err) {
                    console.error('完成操作失败:', err);
                    if (taskElement) {
                        taskElement.style.opacity = '1';
                        taskElement.style.transform = 'none';
                    }
                }
            };
        });

        document.querySelectorAll('.task-item').forEach(item => {
            item.onclick = () => {
                item.classList.toggle('expanded');
            };
        });
    }

    // 4. 初始化 Realtime 监听
    function setupRealtime() {
        if (!supabase) return;
        if (realtimeChannel) {
            try { realtimeChannel.unsubscribe(); } catch(e) {}
        }

        realtimeChannel = supabase
            .channel('widget_stages_realtime')
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'application_stages' },
                () => fetchData()
            )
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'applications' },
                () => fetchData()
            )
            .subscribe((status) => {
                console.log('⚡️ Supabase Realtime 订阅状态:', status);
                if (status === 'SUBSCRIBED') {
                    updateStatusDot(true);
                } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
                    updateStatusDot(false, true);
                }
            });
    }

    // 手动刷新按钮
    refreshBtn.addEventListener('click', () => {
        refreshBtn.style.transform = 'rotate(360deg)';
        fetchData().finally(() => {
            setTimeout(() => { refreshBtn.style.transform = 'none'; }, 300);
        });
    });

    // 5. 初始化主流程
    function initClient() {
        const cfg = window.APP_CONFIG || {};
        if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) {
            pendingList.innerHTML = '<div class="loading" style="color:#38bdf8">👋 首次使用，请点击 ⚙️ 设置配置云数据库</div>';
            updateStatusDot(false);
            showModal(true);
            return;
        }

        supabase = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
        fetchData();
        setupRealtime();
    }

    initClient();
    setInterval(fetchData, 60000);
});

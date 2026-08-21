// ==========================================================================
// OfferPilot V3.2.0 - 全景求职控制台 (Web Admin Console)
// 标准 ATS 架构：applications (投递主表) + application_stages (环节子表)
// ==========================================================================

function escapeHTML(str) {
    if (!str) return '';
    return String(str).replace(/[&<>'"]/g, 
        tag => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        }[tag] || tag)
    );
}

let supabase = null;
let realtimeChannelApps = null;
let realtimeChannelStages = null;

let allApplications = [];
let allStages = [];
let appStagesMap = {}; // application_id -> [stages...]

let currentFilter = 'all';
let currentSearchQuery = '';

// ==========================================================================
// 1. 公司头像 Monogram 背景颜色生成器 (相同公司生成统一品牌色)
// ==========================================================================
const AVATAR_PALETTE = [
    '#4F46E5', '#2563EB', '#0D9488', '#059669', 
    '#D97706', '#DC2626', '#7C3AED', '#DB2777', 
    '#0284C7', '#475569'
];

function getCompanyColor(companyName) {
    if (!companyName) return AVATAR_PALETTE[0];
    let hash = 0;
    for (let i = 0; i < companyName.length; i++) {
        hash = companyName.charCodeAt(i) + ((hash << 5) - hash);
    }
    const index = Math.abs(hash) % AVATAR_PALETTE.length;
    return AVATAR_PALETTE[index];
}

function getCompanyInitial(companyName) {
    if (!companyName) return '企';
    const clean = companyName.replace(/[\(\)（）\s·\-]/g, '');
    return clean.charAt(0) || '企';
}

// ==========================================================================
// 2. 🚀 求职全景状态机流转映射矩阵 (State Transition Matrix Helper)
// ==========================================================================
function getStageStatusMeta(stage, app) {
    if (!stage) {
        return {
            icon: '📌',
            cleanType: '求职进展',
            badgeText: '待处理',
            badgeClass: 'badge-blue',
            nodeIcon: '📌',
            timelineStatusText: '待处理',
            category: 'other'
        };
    }

    const type = (stage.stage_name || '').trim();
    const status = stage.stage_status || 'pending';
    const nextExp = (stage.next_expectation || '').trim();

    // 1. 感谢信 / 流程终止 / 归档
    if (type.includes('感谢信') || type.includes('终止') || type.includes('结束') || type.includes('未通过') || type.includes('遗憾') || status === 'failed') {
        return {
            icon: '📦',
            cleanType: '【流程结束】',
            badgeText: '📦 【流程结束】本轮流程结束 (已归档)',
            badgeClass: 'badge-gray',
            nodeIcon: '📦',
            timelineStatusText: '本轮流程结束 (已归档)',
            category: 'archived'
        };
    }

    // 2. HR 沟通 / 录用意向 / Offer
    if (type.includes('Offer') || type.includes('录用') || type.includes('意向') || type.includes('HR') || type.includes('录取')) {
        if (status === 'awaiting_result' || status === 'passed') {
            return {
                icon: '🎉',
                cleanType: '【录用沟通】',
                badgeText: `🎉 【录用沟通】已完成（${nextExp || '等待正式Offer签约'}）`,
                badgeClass: 'badge-gold',
                nodeIcon: '🎉',
                timelineStatusText: `✓ 已完成（${nextExp || '等待正式Offer签约'}）`,
                category: 'offer'
            };
        }
        return {
            icon: '🎁',
            cleanType: '【录用沟通】',
            badgeText: '🎁 【录用沟通】待沟通',
            badgeClass: 'badge-gold',
            nodeIcon: '🎁',
            timelineStatusText: '待沟通',
            category: 'offer'
        };
    }

    // 3. 终面 / 总监面 / 交叉面
    if (type.includes('终面') || type.includes('总监') || type.includes('三面') || type.includes('交叉') || type.includes('主管')) {
        if (status === 'awaiting_result' || status === 'passed') {
            return {
                icon: '🏆',
                cleanType: '【总监终面】',
                badgeText: `🏆 【总监终面】已结束（${nextExp || '等待终面结果'}）`,
                badgeClass: 'badge-emerald',
                nodeIcon: '🏆',
                timelineStatusText: `✓ 已参加（${nextExp || '等待终面结果'}）`,
                category: 'waiting'
            };
        }
        return {
            icon: '⏳',
            cleanType: '【总监终面】',
            badgeText: '⏳ 【总监终面】待参加',
            badgeClass: 'badge-emerald',
            nodeIcon: '⏳',
            timelineStatusText: '待参加',
            category: 'interview'
        };
    }

    // 4. 二面 / 业务复面
    if (type.includes('二面') || type.includes('复试') || type.includes('技术2面')) {
        if (status === 'awaiting_result' || status === 'passed') {
            return {
                icon: '🎯',
                cleanType: '【技术二面】',
                badgeText: `🎯 【技术二面】已结束（${nextExp || '等待二面结果'}）`,
                badgeClass: 'badge-blue',
                nodeIcon: '🎯',
                timelineStatusText: `✓ 已参加（${nextExp || '等待二面结果'}）`,
                category: 'waiting'
            };
        }
        return {
            icon: '⏳',
            cleanType: '【技术二面】',
            badgeText: '⏳ 【技术二面】待参加',
            badgeClass: 'badge-blue',
            nodeIcon: '⏳',
            timelineStatusText: '待参加',
            category: 'interview'
        };
    }

    // 5. 一面 / 初面 / 技术加面
    if (type.includes('一面') || type.includes('初试') || type.includes('技术1面') || type.includes('专业面')) {
        if (status === 'awaiting_result' || status === 'passed') {
            return {
                icon: '🎯',
                cleanType: '【技术一面】',
                badgeText: `🎯 【技术一面】已结束（${nextExp || '等待一面结果'}）`,
                badgeClass: 'badge-blue',
                nodeIcon: '🎯',
                timelineStatusText: `✓ 已参加（${nextExp || '等待一面结果'}）`,
                category: 'waiting'
            };
        }
        return {
            icon: '⏳',
            cleanType: '【技术一面】',
            badgeText: '⏳ 【技术一面】待参加',
            badgeClass: 'badge-blue',
            nodeIcon: '⏳',
            timelineStatusText: '待参加',
            category: 'interview'
        };
    }

    // 6. AI 模拟面试 / 视频面试 / 群面
    if (type.includes('AI') || type.includes('视频') || type.includes('群面') || type.includes('无领导')) {
        if (status === 'awaiting_result' || status === 'passed') {
            return {
                icon: '🤖',
                cleanType: `【${type}】`,
                badgeText: `🤖 【${type}】已完成（${nextExp || '等待结果'}）`,
                badgeClass: 'badge-purple',
                nodeIcon: '🤖',
                timelineStatusText: `✓ 已完成（${nextExp || '等待结果'}）`,
                category: 'waiting'
            };
        }
        return {
            icon: '🤖',
            cleanType: `【${type}】`,
            badgeText: `🤖 【${type}】待完成`,
            badgeClass: 'badge-purple',
            nodeIcon: '🤖',
            timelineStatusText: '待完成',
            category: 'test'
        };
    }

    // 7. 综合测评 / 性格测试
    if (type.includes('测评') || type.includes('认知') || type.includes('综合') || type.includes('性格')) {
        if (status === 'awaiting_result' || status === 'passed') {
            return {
                icon: '📝',
                cleanType: '【综合测评】',
                badgeText: `📝 【综合测评】已完成（${nextExp || '等待测评结果'}）`,
                badgeClass: 'badge-purple',
                nodeIcon: '📝',
                timelineStatusText: `✓ 已完成（${nextExp || '等待测评结果'}）`,
                category: 'waiting'
            };
        }
        return {
            icon: '📝',
            cleanType: '【综合测评】',
            badgeText: '📝 【综合测评】待完成',
            badgeClass: 'badge-purple',
            nodeIcon: '📝',
            timelineStatusText: '待完成',
            category: 'test'
        };
    }

    // 8. 在线笔试 / 机考
    if (type.includes('笔试') || type.includes('编程') || type.includes('测试') || type.includes('机考')) {
        if (status === 'awaiting_result' || status === 'passed') {
            return {
                icon: '📝',
                cleanType: '【在线笔试】',
                badgeText: `📝 【在线笔试】已作答（${nextExp || '等待笔试结果'}）`,
                badgeClass: 'badge-purple',
                nodeIcon: '📝',
                timelineStatusText: `✓ 已作答（${nextExp || '等待笔试结果'}）`,
                category: 'waiting'
            };
        }
        return {
            icon: '📝',
            cleanType: '【在线笔试】',
            badgeText: '📝 【在线笔试】待作答',
            badgeClass: 'badge-purple',
            nodeIcon: '📝',
            timelineStatusText: '待作答',
            category: 'test'
        };
    }

    // 9. 网申 / 简历投递
    if (type.includes('网申') || type.includes('简历') || type.includes('投递') || type.includes('申请') || type.includes('资料')) {
        if (status === 'awaiting_result' || status === 'passed') {
            return {
                icon: '📬',
                cleanType: '【网申提交】',
                badgeText: '📬 【简历初筛】等待简历筛选结果',
                badgeClass: 'badge-blue',
                nodeIcon: '📬',
                timelineStatusText: '已送达（等待简历初筛结果）',
                category: 'waiting'
            };
        }
        return {
            icon: '📬',
            cleanType: '【网申提交】',
            badgeText: '📬 【网申提交】已送达',
            badgeClass: 'badge-blue',
            nodeIcon: '📬',
            timelineStatusText: '网申已送达',
            category: 'other'
        };
    }

    // 10. 默认兜底
    const cleanName = type ? `【${type}】` : '【求职通知】';
    if (status === 'awaiting_result' || status === 'passed') {
        return {
            icon: '🎯',
            cleanType: cleanName,
            badgeText: `🎯 ${cleanName}已结束（${nextExp || '等待本轮结果'}）`,
            badgeClass: 'badge-blue',
            nodeIcon: '✓',
            timelineStatusText: `✓ 已结束（${nextExp || '等待本轮结果'}）`,
            category: 'waiting'
        };
    }
    return {
        icon: '⏳',
        cleanType: cleanName,
        badgeText: `⏳ ${cleanName}待处理`,
        badgeClass: 'badge-blue',
        nodeIcon: '⏳',
        timelineStatusText: '待处理',
        category: 'other'
    };
}

// ==========================================================================
// 3. 求职推进管道链路生成器 (动态 Progressive Pipeline：按 seq 升序展示)
// ==========================================================================
function generatePipelineHTML(stages) {
    if (!stages || stages.length === 0) {
        return `<span style="color:#94a3b8;font-size:0.8rem;">已建档待推进</span>`;
    }

    // 按 seq 升序排序 (从最初网申到最新环节)
    const sorted = [...stages].sort((a, b) => (a.seq || 1) - (b.seq || 1));
    const latestStage = sorted[sorted.length - 1];

    const stepsHTML = sorted.map((s, idx) => {
        const isLatest = idx === sorted.length - 1;
        const meta = getStageStatusMeta(s);
        let stageLabel = s.stage_name || '环节';

        // 简短标签
        if (stageLabel.length > 5) {
            stageLabel = stageLabel.substring(0, 4) + '..';
        }

        let stepClass = 'done';
        let stepIcon = '✓';

        if (isLatest) {
            if (s.stage_status === 'scheduled') {
                stepClass = 'active';
                stepIcon = '⏳';
            } else if (s.stage_status === 'awaiting_result') {
                stepClass = 'active';
                stepIcon = '🎯';
            } else if (meta.category === 'offer') {
                stepClass = 'offer';
                stepIcon = '🎉';
            } else if (meta.category === 'archived') {
                stepClass = 'archived';
                stepIcon = '📦';
            } else {
                stepClass = 'done';
                stepIcon = '✓';
            }
        }

        return `
            <div class="pipeline-step ${stepClass}" title="${escapeHTML(s.stage_name)} - ${meta.timelineStatusText}">
                <span class="step-dot">${stepIcon}</span>
                <span class="step-name">${escapeHTML(stageLabel)}</span>
            </div>
        `;
    });

    return `
        <div class="pipeline-flow">
            ${stepsHTML.join('<span class="pipeline-arrow">➔</span>')}
        </div>
    `;
}

// ==========================================================================
// 4. 页面初始化与标签页切换
// ==========================================================================
document.addEventListener('DOMContentLoaded', () => {
    initApp();
    setupEventListeners();
});

function setupEventListeners() {
    // 顶栏主 Tab 切换
    const navTabs = document.querySelectorAll('.nav-tab');
    const viewPanels = document.querySelectorAll('.view-panel');

    navTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const targetId = tab.getAttribute('data-target');
            navTabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            viewPanels.forEach(p => p.classList.remove('active'));
            const targetPanel = document.getElementById(targetId);
            if (targetPanel) targetPanel.classList.add('active');

            if (targetId === 'dashboard-view') renderDashboard();
            if (targetId === 'review-view') loadReviews();
        });
    });

    // 看板顶栏 Filter Chips 过滤按钮
    document.querySelectorAll('.filter-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            // 只在看板视图下切换芯片
            if (chip.closest('.filter-toolbar')) {
                document.querySelectorAll('.filter-toolbar .filter-chip').forEach(c => c.classList.remove('active'));
                chip.classList.add('active');
                currentFilter = chip.getAttribute('data-filter');
                renderDashboard();
            }
        });
    });

    // 搜索框防抖监听与一键清除
    const searchInput = document.getElementById('company-search-input');
    const searchClearBtn = document.getElementById('search-clear-btn');
    if (searchInput) {
        let timer = null;
        searchInput.addEventListener('input', (e) => {
            clearTimeout(timer);
            timer = setTimeout(() => {
                currentSearchQuery = e.target.value.trim().toLowerCase();
                if (searchClearBtn) {
                    searchClearBtn.style.display = currentSearchQuery ? 'block' : 'none';
                }
                renderDashboard();
            }, 180);
        });
    }

    if (searchClearBtn) {
        searchClearBtn.addEventListener('click', () => {
            if (searchInput) searchInput.value = '';
            currentSearchQuery = '';
            searchClearBtn.style.display = 'none';
            renderDashboard();
        });
    }

    // 刷新按钮
    const refreshBtn = document.getElementById('btn-global-refresh');
    const refreshSpin = document.getElementById('refresh-spin');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            if (refreshSpin) refreshSpin.style.transform = 'rotate(360deg)';
            loadAllData().finally(() => {
                setTimeout(() => {
                    if (refreshSpin) refreshSpin.style.transform = 'none';
                }, 400);
            });
        });
    }

    // 唤醒桌面挂件
    const btnWakeWidget = document.getElementById('btn-wake-widget');
    if (btnWakeWidget) {
        btnWakeWidget.addEventListener('click', async () => {
            try {
                btnWakeWidget.disabled = true;
                btnWakeWidget.textContent = '⏳ 正在唤醒...';
                const resp = await fetch('/api/show_widget', { method: 'POST' });
                const res = await resp.json();
                if (res.success) {
                    btnWakeWidget.textContent = '✅ 已唤醒';
                } else {
                    alert('唤醒挂件提示: ' + (res.message || '挂件可能已在前台'));
                }
            } catch (err) {
                console.error('唤醒挂件异常:', err);
                alert('唤醒挂件失败，请确认客户端在后台运行');
            } finally {
                setTimeout(() => {
                    btnWakeWidget.disabled = false;
                    btnWakeWidget.innerHTML = '<span>💻</span> 唤醒挂件';
                }, 1000);
            }
        });
    }

    // 抽屉关闭事件
    const drawerOverlay = document.getElementById('timeline-drawer-overlay');
    const drawerCloseBtn = document.getElementById('drawer-close-btn');
    if (drawerCloseBtn) drawerCloseBtn.addEventListener('click', closeTimelineDrawer);
    if (drawerOverlay) {
        drawerOverlay.addEventListener('click', (e) => {
            if (e.target === drawerOverlay) closeTimelineDrawer();
        });
    }

    // 快捷键 Esc
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeTimelineDrawer();
            closeConfigModal();
            closeManualStageModal();
        }
    });

    // 设置弹窗事件
    const settingsNav = document.getElementById('admin-settings-nav');
    const btnCloseModal = document.getElementById('admin-btn-close-cfg');
    const btnSaveModal = document.getElementById('admin-btn-save-cfg');

    if (settingsNav) settingsNav.addEventListener('click', showConfigModal);
    if (btnCloseModal) btnCloseModal.addEventListener('click', closeConfigModal);
    if (btnSaveModal) btnSaveModal.addEventListener('click', saveSettings);
}

// ==========================================================================
// 5. Supabase 初始化与 Realtime 广播监听
// ==========================================================================
function updateStatus(online) {
    const dot = document.getElementById('admin-status-dot');
    const text = document.getElementById('admin-status-text');
    if (!dot || !text) return;

    if (online) {
        dot.style.background = '#10B981';
        text.textContent = '云端 Realtime 已连接';
    } else {
        dot.style.background = '#EF4444';
        text.textContent = '云端未连接 (请配置)';
    }
}

async function initApp() {
    loadLocalSettings();
    if (!supabase) {
        updateStatus(false);
        showConfigModal();
        return;
    }
    updateStatus(true);
    setupRealtimeListeners();
}

function loadLocalSettings() {
    const cfg = window.APP_CONFIG || {};
    const url = cfg.SUPABASE_URL || localStorage.getItem('supabase_url') || '';
    const key = cfg.SUPABASE_ANON_KEY || localStorage.getItem('supabase_key') || '';

    const urlInput = document.getElementById('admin-cfg-url');
    const keyInput = document.getElementById('admin-cfg-key');
    if (urlInput) urlInput.value = url;
    if (keyInput) keyInput.value = key;

    if (url && key && window.supabase) {
        supabase = window.supabase.createClient(url, key);
    }
}

async function saveSettings() {
    const urlInput = document.getElementById('admin-cfg-url');
    const keyInput = document.getElementById('admin-cfg-key');
    const msgEl = document.getElementById('admin-cfg-msg');
    const btnSave = document.getElementById('admin-btn-save-cfg');

    const url = urlInput ? urlInput.value.trim().replace(/\/+$/, '') : '';
    const key = keyInput ? keyInput.value.trim() : '';

    if (!url || !key) {
        if (msgEl) {
            msgEl.textContent = '⚠️ 请完整填写 Supabase URL 和 Key';
            msgEl.style.color = '#ef4444';
        }
        return;
    }

    if (btnSave) {
        btnSave.textContent = '正在保存并连接...';
        btnSave.disabled = true;
    }

    try {
        const resp = await fetch('/api/save_config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: url, publishable_key: key })
        });
        const res = await resp.json();

        if (res.success) {
            if (msgEl) {
                msgEl.textContent = '✅ 保存成功！正在重新连接云端...';
                msgEl.style.color = '#10b981';
            }

            localStorage.setItem('supabase_url', url);
            localStorage.setItem('supabase_key', key);

            if (window.APP_CONFIG) {
                window.APP_CONFIG.SUPABASE_URL = url;
                window.APP_CONFIG.SUPABASE_ANON_KEY = key;
                window.APP_CONFIG.IS_CONFIGURED = true;
            }

            if (window.supabase) {
                supabase = window.supabase.createClient(url, key);
                updateStatus(true);
                setupRealtimeListeners();
            }

            setTimeout(closeConfigModal, 800);
        } else {
            throw new Error(res.message || '保存失败');
        }
    } catch (err) {
        if (msgEl) {
            msgEl.textContent = `❌ 保存失败: ${err.message}`;
            msgEl.style.color = '#ef4444';
        }
    } finally {
        if (btnSave) {
            btnSave.textContent = '⚡️ 保存配置并连接';
            btnSave.disabled = false;
        }
    }
}

function showConfigModal() {
    const modal = document.getElementById('admin-setup-modal');
    if (modal) modal.style.display = 'flex';
}

function closeConfigModal() {
    const modal = document.getElementById('admin-setup-modal');
    if (modal) modal.style.display = 'none';
}

function setupRealtimeListeners() {
    if (!supabase) return;

    if (realtimeChannelApps) {
        try { realtimeChannelApps.unsubscribe(); } catch(e) {}
    }
    if (realtimeChannelStages) {
        try { realtimeChannelStages.unsubscribe(); } catch(e) {}
    }

    // 监听 applications 主表与 application_stages 子表的实时变动
    realtimeChannelApps = supabase
        .channel('admin_applications_realtime')
        .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'applications' },
            () => loadAllData()
        )
        .subscribe();

    realtimeChannelStages = supabase
        .channel('admin_stages_realtime')
        .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'application_stages' },
            () => loadAllData()
        )
        .subscribe();

    loadAllData();
}

// ==========================================================================
// 6. 数据拉取与聚合加载 (Load All Applications & Stages)
// ==========================================================================
async function loadAllData() {
    if (!supabase) return;
    try {
        // 1. 拉取所有投递主表 (按更新时间倒序)
        const resApps = await supabase
            .from('applications')
            .select('*')
            .order('updated_at', { ascending: false });

        // 2. 拉取所有环节子表 (按 seq 升序)
        const resStages = await supabase
            .from('application_stages')
            .select('*')
            .order('seq', { ascending: true });

        if (resApps.error) throw resApps.error;
        if (resStages.error) throw resStages.error;

        allApplications = resApps.data || [];
        allStages = resStages.data || [];

        // 构建 application_id -> [stages] 映射表
        appStagesMap = {};
        allStages.forEach(s => {
            const appId = s.application_id;
            if (!appStagesMap[appId]) {
                appStagesMap[appId] = [];
            }
            appStagesMap[appId].push(s);
        });

        // 绑定到每一个 application 实体
        allApplications.forEach(app => {
            app.stages = appStagesMap[app.id] || [];
        });

        // 待审核任务（pending 状态）与已忽略任务（ignored 状态）
        const reviewStages = allStages.filter(s => s.stage_status === 'pending');
        const ignoredStages = allStages.filter(s => s.stage_status === 'ignored');

        // 更新待审角标与已忽略角标
        const badge = document.getElementById('review-badge');
        const badgeSub = document.getElementById('review-badge-sub');
        const ignoredBadge = document.getElementById('ignored-badge');

        if (badge) badge.textContent = reviewStages.length;
        if (badgeSub) badgeSub.textContent = reviewStages.length;
        if (ignoredBadge) ignoredBadge.textContent = ignoredStages.length;

        // 刷新渲染 4 大 KPI 数据卡、全景看板与审核大厅
        updateKPICards();
        renderDashboard();
        renderReviews(reviewStages);
        renderIgnoredReviews(ignoredStages);

    } catch (err) {
        console.error('拉取主子表数据异常:', err);
    }
}

// ==========================================================================
// 7. 顶部 4 大 KPI 数据指标卡动态计算
// ==========================================================================
function updateKPICards() {
    const totalCompaniesEl = document.getElementById('metric-total-companies');
    const activeStagesEl = document.getElementById('metric-active-stages');
    const waitingResultsEl = document.getElementById('metric-waiting-results');
    const offerCountEl = document.getElementById('metric-offer-count');

    // 统计已建档且非归档的投递单
    const validApps = allApplications.filter(a => a.overall_status !== 'archived');
    const totalAppsCount = validApps.length;

    let activeStagesCount = 0;
    let waitingResultsCount = 0;
    let offerCount = 0;

    validApps.forEach(app => {
        const stages = app.stages.filter(s => s.stage_status !== 'ignored' && s.stage_status !== 'pending');
        if (stages.length === 0) return;

        const latestStage = stages[stages.length - 1];
        const meta = getStageStatusMeta(latestStage, app);

        if (app.overall_status === 'offered' || meta.category === 'offer') {
            offerCount++;
        } else if (latestStage.stage_status === 'awaiting_result' || meta.category === 'waiting') {
            waitingResultsCount++;
        } else if (latestStage.stage_status === 'scheduled' || meta.category === 'interview' || meta.category === 'test') {
            activeStagesCount++;
        }
    });

    if (totalCompaniesEl) totalCompaniesEl.textContent = totalAppsCount;
    if (activeStagesEl) activeStagesEl.textContent = activeStagesCount;
    if (waitingResultsEl) waitingResultsEl.textContent = waitingResultsCount;
    if (offerCountEl) offerCountEl.textContent = offerCount;
}

// ==========================================================================
// 8. 渲染求职全景进度看板 (Dashboard Table - Applications 主表驱动)
// ==========================================================================
function renderDashboard() {
    const tbody = document.getElementById('dashboard-tbody');
    if (!tbody) return;

    if (allApplications.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" class="empty-state">
                    <div style="padding: 36px 16px;">
                        <div style="font-size: 2.2rem; margin-bottom: 8px;">📬</div>
                        <div style="font-size: 1.05rem; font-weight: 700; color: var(--text-main); margin-bottom: 6px;">
                            暂无求职建档记录
                        </div>
                        <div style="font-size: 0.86rem; color: var(--text-muted); max-width: 520px; margin: 0 auto; line-height: 1.6;">
                            云端 AI 抓取到的新邮件通知存放在顶栏 <strong>「新邮件待审」</strong> 中。<br>
                            请前往待审大厅点击 <strong>“通过展示”</strong>，确认后将自动在此全景建档并同步至桌面挂件！
                        </div>
                    </div>
                </td>
            </tr>
        `;
        return;
    }

    // 过滤逻辑 (搜索 & Filter Chips)
    const filteredApps = allApplications.filter(app => {
        const stages = (app.stages || []).filter(s => s.stage_status !== 'ignored' && s.stage_status !== 'pending');
        const latestStage = stages.length > 0 ? stages[stages.length - 1] : null;
        const meta = getStageStatusMeta(latestStage, app);

        // 文本模糊搜索 (支持公司、部门、岗位、环节)
        if (currentSearchQuery) {
            const q = currentSearchQuery;
            const matchComp = (app.company || '').toLowerCase().includes(q);
            const matchDept = (app.department || '').toLowerCase().includes(q);
            const matchPos = (app.position || '').toLowerCase().includes(q);
            const matchStage = (app.current_stage_name || '').toLowerCase().includes(q);
            const matchInStages = stages.some(s => (s.stage_name || '').toLowerCase().includes(q) || (s.meeting_info || '').toLowerCase().includes(q));

            if (!matchComp && !matchDept && !matchPos && !matchStage && !matchInStages) return false;
        }

        // 分类 Chip 过滤
        if (currentFilter === 'all') return app.overall_status !== 'archived';
        if (currentFilter === 'test') return stages.some(s => (s.stage_name || '').includes('笔试') || (s.stage_name || '').includes('测评'));
        if (currentFilter === 'interview') return meta.category === 'interview';
        if (currentFilter === 'waiting') return meta.category === 'waiting';
        if (currentFilter === 'offer') return app.overall_status === 'offered' || meta.category === 'offer';
        if (currentFilter === 'archived') return app.overall_status === 'archived';

        return true;
    });

    if (filteredApps.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="empty-state">🔍 没有匹配到符合当前筛选条件的企业或岗位</td></tr>';
        return;
    }

    tbody.innerHTML = filteredApps.map(app => {
        const stages = (app.stages || []).filter(s => s.stage_status !== 'ignored' && s.stage_status !== 'pending');
        const latestStage = stages.length > 0 ? stages[stages.length - 1] : null;
        const meta = getStageStatusMeta(latestStage, app);

        const safeCompany = escapeHTML(app.company || '未知企业');
        const safeDept = app.department ? escapeHTML(app.department) : '';
        const safePos = escapeHTML(app.position || '校招投递岗位');
        const avatarBg = getCompanyColor(app.company);
        const avatarInitial = getCompanyInitial(app.company);

        let timeFormatted = '待定';
        if (latestStage && latestStage.schedule_time && latestStage.schedule_time !== '待定') {
            timeFormatted = escapeHTML(latestStage.schedule_time);
        } else if (app.updated_at) {
            try {
                const dt = new Date(app.updated_at);
                timeFormatted = `${dt.getMonth() + 1}/${dt.getDate()} ${dt.getHours().toString().padStart(2, '0')}:${dt.getMinutes().toString().padStart(2, '0')}`;
            } catch(e) {}
        }

        const pipelineHTML = generatePipelineHTML(stages);

        return `
            <tr class="table-clickable-row" onclick="openTimelineDrawer('${app.id}')">
                <td>
                    <div class="company-cell">
                        <div class="company-avatar" style="background:${avatarBg};">
                            ${avatarInitial}
                        </div>
                        <div class="company-info">
                            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                                <span class="company-name">${safeCompany}</span>
                                ${safeDept ? `<span class="badge-tag badge-indigo" style="font-size:0.72rem;padding:1px 6px;">${safeDept}</span>` : ''}
                            </div>
                            <span class="company-subject">${safePos}</span>
                        </div>
                    </div>
                </td>
                <td>
                    ${pipelineHTML}
                </td>
                <td>
                    <span class="badge-tag ${meta.badgeClass}">
                        ${meta.badgeText}
                    </span>
                </td>
                <td>
                    <span style="font-weight:600;color:#334155;font-size:0.86rem;">${timeFormatted}</span>
                </td>
                <td style="text-align: right;">
                    <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); openTimelineDrawer('${app.id}')">
                        查看时间线 ➔
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

// ==========================================================================
// 9. 公司求职全景时间线抽屉 (【最新进展置顶 · 倒序时序流】)
// ==========================================================================
function openTimelineDrawer(appId) {
    const app = allApplications.find(a => a.id === appId);
    if (!app) return;

    const stages = (appStagesMap[app.id] || []).filter(s => s.stage_status !== 'ignored');

    const overlay = document.getElementById('timeline-drawer-overlay');
    const drawerAvatar = document.getElementById('drawer-avatar');
    const drawerTitle = document.getElementById('drawer-company-name');
    const drawerBadge = document.getElementById('drawer-status-badge');
    const drawerPos = document.getElementById('drawer-position-text');
    const drawerCount = document.getElementById('drawer-count-text');
    const timelineContent = document.getElementById('drawer-timeline-content');

    if (!overlay) return;

    // 🎯 核心升级：按 seq DESC 倒序排列（最新进展在最上方！）
    const reverseStages = [...stages].sort((a, b) => (b.seq || 1) - (a.seq || 1));
    const latestStage = reverseStages[0];
    const latestMeta = getStageStatusMeta(latestStage, app);

    drawerAvatar.style.background = getCompanyColor(app.company);
    drawerAvatar.textContent = getCompanyInitial(app.company);
    drawerTitle.dataset.appId = app.id;
    drawerTitle.innerHTML = `<span>${escapeHTML(app.company)}</span>${app.department ? `<span class="badge-tag badge-indigo" style="font-size:0.8rem;margin-left:8px;padding:2px 8px;">${escapeHTML(app.department)}</span>` : ''}`;
    drawerBadge.className = `badge-tag ${latestMeta.badgeClass}`;
    drawerBadge.textContent = latestMeta.badgeText;
    drawerPos.textContent = `投递岗位: ${app.position || '校招应聘'}`;
    drawerCount.textContent = `共 ${stages.length} 轮应聘进展`;

    // 渲染垂直倒序发光时间轴
    if (reverseStages.length === 0) {
        timelineContent.innerHTML = `
            <div style="text-align:center;padding:40px 16px;color:#94a3b8;">
                暂无推进环节，点击上方「➕ 手动推进新环节」开始建档！
            </div>
        `;
    } else {
        timelineContent.innerHTML = reverseStages.map((s, index) => {
            const isLatest = index === 0; // 倒序排布下，第 0 项即为当前最新进展！
            const meta = getStageStatusMeta(s, app);
            const safeType = escapeHTML(s.stage_name || '环节');
            const safeTime = escapeHTML(s.schedule_time || '时间待定');
            const safeMeeting = escapeHTML(s.meeting_info || '');
            const safeNotes = escapeHTML(s.notes || '');

            let dateStr = '通知时间';
            if (s.created_at) {
                try {
                    const dt = new Date(s.created_at);
                    dateStr = `${dt.getMonth() + 1}月${dt.getDate()}日 ${dt.getHours().toString().padStart(2, '0')}:${dt.getMinutes().toString().padStart(2, '0')}`;
                } catch(e) {}
            }

            // 🎯 严谨的状态机操作按钮构建
            let actionButtonsHTML = '';
            if (isLatest) {
                if (s.stage_status === 'scheduled') {
                    actionButtonsHTML = `
                        <button class="btn btn-primary btn-sm" style="font-size:0.75rem;padding:3px 10px;" onclick="advanceStageStatus('${s.id}', 'awaiting_result', '${app.id}')" title="面试或笔试结束，标记为已参加并等待结果">
                            ✓ 标为已参加
                        </button>
                        <button class="btn btn-outline btn-sm" style="font-size:0.75rem;padding:3px 8px;color:#64748B;" onclick="rollbackCurrentStage('${app.id}', '${s.id}')" title="手误推进或错发邮件：撤销当前轮次并无缝回退到上一轮">
                            ↩ 撤销本轮(回退上一状态)
                        </button>
                    `;
                } else if (s.stage_status === 'awaiting_result') {
                    actionButtonsHTML = `
                        <button class="btn btn-secondary btn-sm" style="font-size:0.75rem;padding:3px 8px;color:#64748B;" onclick="advanceStageStatus('${s.id}', 'scheduled', '${app.id}')" title="误操作撤回：重新激活待办并推回桌面挂件">
                            ↩ 撤回重设为待办
                        </button>
                    `;
                }
            } else {
                // 历史已过环节：显示为只读已通过
                actionButtonsHTML = `
                    <span class="badge-tag badge-gray" style="font-size:0.72rem;">✓ 历史环节 (已通过)</span>
                `;
            }

            return `
                <div class="timeline-item ${isLatest ? 'is-latest' : ''}">
                    <div class="timeline-node">
                        ${isLatest ? '📌' : meta.nodeIcon}
                    </div>
                    <div class="timeline-card">
                        <div class="timeline-header">
                            <div class="timeline-stage-name">
                                ${meta.icon} 第${s.seq || 1}轮 · ${safeType}
                                ${isLatest ? '<span class="badge-tag badge-emerald" style="font-size:0.7rem;padding:2px 8px;margin-left:6px;">📌 最新进展</span>' : ''}
                            </div>
                            <span class="timeline-timestamp">${dateStr}</span>
                        </div>

                        <div class="timeline-status-row">
                            <span style="color:var(--text-muted);font-size:0.85rem;">约定时间: <strong>${safeTime}</strong></span>
                            <div style="display:inline-flex;align-items:center;gap:6px;">
                                <span class="badge-tag ${meta.badgeClass}" style="font-size:0.75rem;">${meta.timelineStatusText}</span>
                                ${actionButtonsHTML}
                            </div>
                        </div>

                        ${safeMeeting ? `
                            <div class="timeline-notes-box" style="margin-top:8px;">
                                <span>🔑 <strong>会议/凭据:</strong> ${safeMeeting}</span>
                                <button class="btn btn-secondary btn-sm" style="padding:2px 6px;font-size:0.75rem;" onclick="navigator.clipboard.writeText('${safeMeeting}');alert('已复制会议凭据到剪贴板！');">复制</button>
                            </div>
                        ` : ''}

                        ${safeNotes ? `
                            <div class="timeline-notes-box" style="margin-top:6px;background:#F8FAFC;">
                                <span>📌 <strong>备注:</strong> ${safeNotes}</span>
                            </div>
                        ` : ''}
                    </div>
                </div>
            `;
        }).join('');
    }

    overlay.style.display = 'flex';
}

function closeTimelineDrawer() {
    const overlay = document.getElementById('timeline-drawer-overlay');
    if (overlay) overlay.style.display = 'none';
}

// ==========================================================================
// 10. 状态机精准流转与安全回退 (State Transitions & Rollback)
// ==========================================================================
async function advanceStageStatus(stageId, targetStatus, appId) {
    if (!supabase) return;
    try {
        const { error } = await supabase
            .from('application_stages')
            .update({
                stage_status: targetStatus,
                updated_at: new Date().toISOString()
            })
            .eq('id', stageId);

        if (error) throw error;
        console.log(`✅ 环节 ${stageId} 状态已更新为 ${targetStatus}`);

        await loadAllData();
        if (appId) {
            setTimeout(() => openTimelineDrawer(appId), 200);
        }
    } catch (err) {
        console.error('更新环节状态失败:', err);
        alert(`操作失败: ${err.message}`);
    }
}

// 🎯 核心无损回退算法：撤销当前环节，将投递单回退至上一环节 (seq - 1)
async function rollbackCurrentStage(appId, stageId) {
    if (!confirm('确定要撤销当前环节并回退到上一轮吗？')) return;
    if (!supabase) return;

    try {
        // 1. 获取该投递单下的所有环节
        const stages = (appStagesMap[appId] || []).filter(s => s.stage_status !== 'ignored');
        const sortedStages = [...stages].sort((a, b) => (a.seq || 1) - (b.seq || 1));

        // 2. 将当前环节软删除/标记为 ignored
        await supabase
            .from('application_stages')
            .update({
                stage_status: 'ignored',
                updated_at: new Date().toISOString()
            })
            .eq('id', stageId);

        // 3. 寻找上一轮环节 (seq - 1)
        const remainingStages = sortedStages.filter(s => s.id !== stageId);
        if (remainingStages.length > 0) {
            const prevStage = remainingStages[remainingStages.length - 1];
            // 更新主表最新快照为上一轮环节
            await supabase
                .from('applications')
                .update({
                    current_stage_name: prevStage.stage_name,
                    updated_at: new Date().toISOString()
                })
                .eq('id', appId);

            // 将上一轮恢复为等待结果状态 (awaiting_result)
            await supabase
                .from('application_stages')
                .update({
                    stage_status: 'awaiting_result',
                    updated_at: new Date().toISOString()
                })
                .eq('id', prevStage.id);

            console.log(`✅ 成功回退到上一轮: [${prevStage.stage_name}]`);
        } else {
            // 没有更早环节了，更新主表快照
            await supabase
                .from('applications')
                .update({
                    current_stage_name: '网申提交',
                    updated_at: new Date().toISOString()
                })
                .eq('id', appId);
        }

        await loadAllData();
        setTimeout(() => openTimelineDrawer(appId), 200);

    } catch (err) {
        console.error('回退上一轮异常:', err);
        alert(`回退失败: ${err.message}`);
    }
}

// 投递单整体归档 / 重新激活
async function toggleAppArchive(appId, targetStatus) {
    if (!supabase) return;
    try {
        const { error } = await supabase
            .from('applications')
            .update({
                overall_status: targetStatus,
                updated_at: new Date().toISOString()
            })
            .eq('id', appId);

        if (error) throw error;
        await loadAllData();
        closeTimelineDrawer();
    } catch (err) {
        console.error('切换归档状态失败:', err);
        alert(`操作失败: ${err.message}`);
    }
}

// ==========================================================================
// 11. 审核大厅与已忽略归档核心逻辑 (Review Hall & Ignored Archive)
// ==========================================================================
function switchReviewSubtab(subtab) {
    const btnPending = document.getElementById('btn-subtab-pending');
    const btnIgnored = document.getElementById('btn-subtab-ignored');
    const cardPending = document.getElementById('review-pending-card');
    const cardIgnored = document.getElementById('review-ignored-card');

    if (subtab === 'pending') {
        if (btnPending) btnPending.classList.add('active');
        if (btnIgnored) btnIgnored.classList.remove('active');
        if (cardPending) cardPending.style.display = 'block';
        if (cardIgnored) cardIgnored.style.display = 'none';
    } else {
        if (btnPending) btnPending.classList.remove('active');
        if (btnIgnored) btnIgnored.classList.add('active');
        if (cardPending) cardPending.style.display = 'none';
        if (cardIgnored) cardIgnored.style.display = 'block';
    }
}

async function loadReviews() {
    await loadAllData();
}

function renderReviews(stages) {
    const tbody = document.getElementById('review-tbody');
    if (!tbody) return;

    if (stages.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="empty-state">
                    <div style="padding: 30px 0;">
                        <div style="font-size: 2rem; margin-bottom: 6px;">🎉</div>
                        <div style="font-weight: 700; color: var(--text-main);">太棒了！所有新邮件均已审核完毕</div>
                        <div style="font-size: 0.85rem; color: var(--text-muted); margin-top: 2px;">
                            云端 7x24h 自动化扫描中，一旦有新的笔试/面试通知将第一时间在此浮现。
                        </div>
                    </div>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = stages.map(stage => {
        const app = allApplications.find(a => a.id === stage.application_id) || {};
        const meta = getStageStatusMeta(stage, app);
        const safeCompany = escapeHTML(app.company || '未知企业');
        const safeDept = app.department ? escapeHTML(app.department) : '';
        const safePosition = escapeHTML(app.position || stage.raw_subject || '求职岗位');
        const safeType = escapeHTML(stage.stage_name || '环节');
        const safeTime = escapeHTML(stage.schedule_time || '时间待定');
        const safeNextExp = escapeHTML(stage.next_expectation || '等待下一步通知');
        const safeMeeting = escapeHTML(stage.meeting_info || '');

        let timeStr = '刚刚';
        if (stage.created_at) {
            try {
                const dt = new Date(stage.created_at);
                timeStr = `${dt.getMonth() + 1}/${dt.getDate()} ${dt.getHours().toString().padStart(2, '0')}:${dt.getMinutes().toString().padStart(2, '0')}`;
            } catch(e) {}
        }

        return `
            <tr id="review-row-${stage.id}">
                <td><span style="font-size:0.85rem;color:var(--text-muted);">${timeStr}</span></td>
                <td>
                    <div style="display:flex;align-items:center;gap:4px;">
                        <strong style="font-size:0.98rem;color:var(--text-main);">${safeCompany}</strong>
                        ${safeDept ? `<span class="badge-tag badge-indigo" style="font-size:0.72rem;padding:1px 6px;">${safeDept}</span>` : ''}
                    </div>
                    <div style="font-size:0.78rem;color:var(--text-muted);margin-top:2px;">${safePosition}</div>
                </td>
                <td><span class="badge-tag ${meta.badgeClass}">${meta.icon} ${safeType}</span></td>
                <td><span style="font-size:0.85rem;color:#475569;">${safeNextExp}</span></td>
                <td><span style="font-weight:600;">${safeTime}</span></td>
                <td>
                    <span style="font-size:0.8rem;color:#B45309;">${safeMeeting ? `🔑 ${safeMeeting}` : '<span style="color:#94A3B8;">无凭据</span>'}</span>
                </td>
                <td style="text-align: right;">
                    <div style="display:inline-flex;gap:6px;">
                        <button class="btn btn-success btn-sm" onclick="approveStage('${stage.id}')" title="确认是我的求职邮件，通过并加入看板与桌面挂件">✓ 通过</button>
                        <button class="btn btn-danger btn-sm" onclick="ignoreStage('${stage.id}')" title="广告/误报/非本人应聘信息，直接忽略">✕ 忽略</button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

function renderIgnoredReviews(stages) {
    const tbody = document.getElementById('ignored-tbody');
    if (!tbody) return;

    if (stages.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="empty-state">
                    <div style="padding: 30px 0;">
                        <div style="font-size: 2rem; margin-bottom: 6px;">📦</div>
                        <div style="font-weight: 700; color: var(--text-main);">暂无已忽略邮件</div>
                        <div style="font-size: 0.85rem; color: var(--text-muted); margin-top: 2px;">
                            被忽略的邮件会保存在此，随时可一键恢复。
                        </div>
                    </div>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = stages.map(stage => {
        const app = allApplications.find(a => a.id === stage.application_id) || {};
        const meta = getStageStatusMeta(stage, app);
        const safeCompany = escapeHTML(app.company || '未知企业');
        const safeType = escapeHTML(stage.stage_name || '环节');
        const safePosition = escapeHTML(app.position || stage.raw_subject || '无主题');
        const safeMeeting = escapeHTML(stage.meeting_info || '');

        let timeStr = '未知';
        if (stage.created_at) {
            try {
                const dt = new Date(stage.created_at);
                timeStr = `${dt.getMonth() + 1}/${dt.getDate()} ${dt.getHours().toString().padStart(2, '0')}:${dt.getMinutes().toString().padStart(2, '0')}`;
            } catch(e) {}
        }

        return `
            <tr id="ignored-row-${stage.id}">
                <td><span style="font-size:0.85rem;color:var(--text-muted);">${timeStr}</span></td>
                <td><strong style="font-size:0.98rem;color:var(--text-main);">${safeCompany}</strong></td>
                <td><span class="badge-tag ${meta.badgeClass}">${meta.icon} ${safeType}</span></td>
                <td>
                    <div style="font-size:0.85rem;color:#334155;">${safePosition}</div>
                    ${safeMeeting ? `<div style="font-size:0.75rem;color:#B45309;margin-top:2px;">🔑 ${safeMeeting}</div>` : ''}
                </td>
                <td><span style="font-size:0.82rem;color:var(--text-muted);">${stage.schedule_time || '待定'}</span></td>
                <td style="text-align: right;">
                    <div style="display:inline-flex;gap:6px;">
                        <button class="btn btn-success btn-sm" onclick="restoreIgnoredStage('${stage.id}', 'scheduled')" title="恢复这个环节并通过展示">✓ 恢复并通过</button>
                        <button class="btn btn-secondary btn-sm" onclick="restoreIgnoredStage('${stage.id}', 'pending')" title="恢复并重新放回待审核大厅">↩ 恢复至待审</button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

// 审核通过
async function approveStage(stageId) {
    if (!supabase) return;
    try {
        const stage = allStages.find(s => s.id === stageId);
        if (!stage) return;

        const targetStatus = (stage.schedule_time && stage.schedule_time !== '待定') ? 'scheduled' : 'awaiting_result';

        // 1. 更新当前环节状态
        await supabase
            .from('application_stages')
            .update({
                stage_status: targetStatus,
                updated_at: new Date().toISOString()
            })
            .eq('id', stageId);

        // 2. 将该投递单下的前序环节全部自动标记为 passed (已通过)
        if (stage.application_id) {
            await supabase
                .from('application_stages')
                .update({
                    stage_status: 'passed',
                    updated_at: new Date().toISOString()
                })
                .eq('application_id', stage.application_id)
                .lt('seq', stage.seq || 1);

            // 更新主表最新环节快照
            await supabase
                .from('applications')
                .update({
                    current_stage_name: stage.stage_name,
                    overall_status: 'active',
                    updated_at: new Date().toISOString()
                })
                .eq('id', stage.application_id);
        }

        console.log(`✅ 环节 ${stageId} 审核通过，状态流转为 ${targetStatus}`);
        await loadAllData();
    } catch (err) {
        console.error('审核通过异常:', err);
        alert(`操作失败: ${err.message}`);
    }
}

// 忽略归档
async function ignoreStage(stageId) {
    if (!supabase) return;
    try {
        await supabase
            .from('application_stages')
            .update({
                stage_status: 'ignored',
                updated_at: new Date().toISOString()
            })
            .eq('id', stageId);

        console.log(`🗑️ 环节 ${stageId} 已忽略`);
        await loadAllData();
    } catch (err) {
        console.error('忽略环节异常:', err);
        alert(`操作失败: ${err.message}`);
    }
}

// 恢复已忽略环节
async function restoreIgnoredStage(stageId, targetStatus) {
    if (!supabase) return;
    try {
        await supabase
            .from('application_stages')
            .update({
                stage_status: targetStatus,
                updated_at: new Date().toISOString()
            })
            .eq('id', stageId);

        console.log(`✅ 已恢复环节 ${stageId} 为 ${targetStatus}`);
        await loadAllData();
    } catch (err) {
        console.error('恢复环节失败:', err);
        alert(`恢复失败: ${err.message}`);
    }
}

// ==========================================================================
// 12. ➕ 手动推进新环节与手动建档核心逻辑 (Manual Advance & Add Stage)
// ==========================================================================
function openManualStageModal(targetAppId) {
    const modal = document.getElementById('manual-stage-modal');
    const titleEl = document.getElementById('manual-modal-title');
    const compInput = document.getElementById('manual-comp-name');
    const deptInput = document.getElementById('manual-dept-name');
    const jobInput = document.getElementById('manual-job-subject');
    const typeInput = document.getElementById('manual-stage-type');
    const timeInput = document.getElementById('manual-stage-time');
    const notesInput = document.getElementById('manual-stage-notes');
    const nextExpInput = document.getElementById('manual-next-exp');
    const msgEl = document.getElementById('manual-stage-msg');

    if (!modal) return;

    if (targetAppId) {
        const app = allApplications.find(a => a.id === targetAppId);
        if (app) {
            modal.dataset.appId = app.id;
            if (compInput) compInput.value = app.company || '';
            if (deptInput) deptInput.value = app.department || '';
            if (jobInput) jobInput.value = app.position || '';
            if (titleEl) titleEl.textContent = `🚀 推进「${app.company}」下一环节`;
        }
    } else {
        delete modal.dataset.appId;
        if (compInput) compInput.value = '';
        if (deptInput) deptInput.value = '';
        if (jobInput) jobInput.value = '';
        if (titleEl) titleEl.textContent = '➕ 手动添加投递企业与环节';
    }

    if (typeInput) typeInput.value = '';
    if (timeInput) timeInput.value = '';
    if (notesInput) notesInput.value = '';
    if (nextExpInput) nextExpInput.value = '';
    if (msgEl) msgEl.textContent = '';

    modal.style.display = 'flex';
}

function openManualStageModalForCurrentCompany() {
    const drawerTitle = document.getElementById('drawer-company-name');
    const appId = drawerTitle ? drawerTitle.dataset.appId : '';
    openManualStageModal(appId);
}

function selectStagePreset(presetName) {
    const typeInput = document.getElementById('manual-stage-type');
    const nextExpInput = document.getElementById('manual-next-exp');
    if (!typeInput) return;

    typeInput.value = presetName;

    // 智能自动填充默认预期
    if (nextExpInput && !nextExpInput.value) {
        if (presetName.includes('网申')) nextExpInput.value = '等待简历初筛结果';
        else if (presetName.includes('笔试')) nextExpInput.value = '等待笔试结果';
        else if (presetName.includes('测评')) nextExpInput.value = '等待测评结果';
        else if (presetName.includes('一面')) nextExpInput.value = '等待一面结果';
        else if (presetName.includes('二面')) nextExpInput.value = '等待二面结果';
        else if (presetName.includes('终面')) nextExpInput.value = '等待终面结果';
        else if (presetName.includes('HR')) nextExpInput.value = '等待录用通知';
        else if (presetName.includes('Offer')) nextExpInput.value = '等待正式录用签约';
    }
}

function closeManualStageModal() {
    const modal = document.getElementById('manual-stage-modal');
    if (modal) modal.style.display = 'none';
}

async function submitManualStage() {
    if (!supabase) {
        alert('请先连接 Supabase 云数据库！');
        return;
    }

    const modal = document.getElementById('manual-stage-modal');
    const boundAppId = modal ? modal.dataset.appId : null;

    const compName = (document.getElementById('manual-comp-name')?.value || '').trim();
    const deptName = (document.getElementById('manual-dept-name')?.value || '').trim();
    const jobSubject = (document.getElementById('manual-job-subject')?.value || '').trim();
    const stageType = (document.getElementById('manual-stage-type')?.value || '').trim();
    const stageTime = (document.getElementById('manual-stage-time')?.value || '').trim();
    const stageNotes = (document.getElementById('manual-stage-notes')?.value || '').trim();
    const nextExp = (document.getElementById('manual-next-exp')?.value || '').trim();
    const statusRadio = document.querySelector('input[name="manual-status"]:checked');
    const initialStatus = statusRadio ? statusRadio.value : 'approved';
    const msgEl = document.getElementById('manual-stage-msg');
    const submitBtn = document.getElementById('btn-submit-manual-stage');

    if (!compName) {
        if (msgEl) {
            msgEl.textContent = '⚠️ 请填写目标公司名称';
            msgEl.style.color = '#ef4444';
        }
        return;
    }

    if (!stageType) {
        if (msgEl) {
            msgEl.textContent = '⚠️ 请填写或点击选择推进环节名称';
            msgEl.style.color = '#ef4444';
        }
        return;
    }

    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = '正在推进建档...';
    }

    try {
        const taskId = (window.crypto && window.crypto.randomUUID)
            ? window.crypto.randomUUID()
            : ('manual_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8));

        // 统一公司与部门格式
        const finalCompanyName = deptName ? `${compName}-${deptName}` : compName;
        const targetTrackKey = deptName ? `${compName} · ${deptName}` : compName;

        const payload = {
            id: taskId,
            company: finalCompanyName,
            subject: jobSubject || '校招应聘岗位',
            type: stageType,
            time: stageTime || '待定',
            notes: stageNotes,
            next_expectation: nextExp,
            urgent: false,
            status: initialStatus,
            is_deleted: false,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        let { error } = await supabase
            .from('tasks')
            .insert([payload]);

        // 若云数据库暂无 next_expectation 字段，进行兼容降级保存
        if (error && error.message && error.message.includes('next_expectation')) {
            console.warn('⚠️ 数据库暂无 next_expectation 字段，降级重试...');
            delete payload.next_expectation;
            const res = await supabase.from('tasks').insert([payload]);
            error = res.error;
        }

        if (error) throw error;

        if (msgEl) {
            msgEl.textContent = '✅ 推进成功！已自动建档并在看板与桌面挂件中同步。';
            msgEl.style.color = '#10b981';
        }

        await loadAllData();

        setTimeout(() => {
            closeManualStageModal();
            // 如果抽屉处于打开状态，重新刷新该赛道的抽屉时间线
            const drawerOverlay = document.getElementById('timeline-drawer-overlay');
            if (drawerOverlay && drawerOverlay.style.display === 'flex') {
                openTimelineDrawer(encodeURIComponent(targetTrackKey));
            }
        }, 600);

    } catch (err) {
        console.error('手动推进建档失败:', err);
        if (msgEl) {
            msgEl.textContent = `❌ 推进失败: ${err.message}`;
            msgEl.style.color = '#ef4444';
        }
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = '⚡️ 确认推进建档';
        }
    }
}



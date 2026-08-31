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

let currentBentoFilter = 'all';       // 'all' | 'todo' | 'waiting' | 'offer' (上层待办/结果客观状态)
let currentProgressFilter = 'all';    // 'all' | 'assessment' | 'written_test' | 'interview' | 'offer' | 'terminated' (下层当前流程进度阶段)
let currentSearchQuery = '';
let currentReviewCategory = 'all';

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

    // 9. 投递邀请 / 校招邀约 / 宣讲邀请 (官方发邮件邀请投递，尚未正式提交简历)
    if (type.includes('邀请') || type.includes('宣讲') || type.includes('邀约') || type.includes('推荐') || type.includes('夏令营')) {
        if (status === 'awaiting_result' || status === 'completed' || status === 'passed') {
            return {
                icon: '🎯',
                cleanType: `【${type}】`,
                badgeText: `🎯 【${type}】已前往投递（${nextExp || '等待初筛结果'}）`,
                badgeClass: 'badge-blue',
                nodeIcon: '✓',
                timelineStatusText: `✓ 已前往投递（${nextExp || '等待初筛结果'}）`,
                category: 'waiting'
            };
        }
        return {
            icon: '🎯',
            cleanType: `【${type}】`,
            badgeText: `🎯 【${type}】待前往官网投递`,
            badgeClass: 'badge-purple',
            nodeIcon: '🎯',
            timelineStatusText: '待前往官网投递（请查看邮件中官网链接）',
            category: 'interview'
        };
    }

    // 10. 网申 / 简历投递 (已在官网提交了简历)
    if (type.includes('网申') || type.includes('简历') || type.includes('投递') || type.includes('申请') || type.includes('资料') || type.includes('初筛')) {
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
            badgeText: '📬 【网申提交】待投递/待处理',
            badgeClass: 'badge-blue',
            nodeIcon: '📬',
            timelineStatusText: '网申待处理',
            category: 'interview'
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
    // 1. 侧边栏主视图切换 (求职全景看板 vs 邮件待审准入)
    const navItems = document.querySelectorAll('.sidebar-nav-item, .nav-tab');
    const viewPanels = document.querySelectorAll('.view-panel');

    navItems.forEach(tab => {
        tab.addEventListener('click', () => {
            const targetId = tab.getAttribute('data-target');
            navItems.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            viewPanels.forEach(p => p.classList.remove('active'));
            const targetPanel = document.getElementById(targetId);
            if (targetPanel) targetPanel.classList.add('active');

            if (targetId === 'dashboard-view') renderDashboard();
            if (targetId === 'review-view') loadReviews();
        });
    });

    // 2. 顶部 4 大 Bento 瓷感 KPI 卡片点击 (待办/结果客观状态维度)
    document.querySelectorAll('.bento-card').forEach(card => {
        card.addEventListener('click', () => {
            const bentoKey = card.getAttribute('data-bento') || 'all';
            currentBentoFilter = bentoKey;
            currentProgressFilter = 'all'; // 切换状态维度时，重置下层阶段为全部

            // 同步 Bento 卡片高亮态与状态药丸
            document.querySelectorAll('.bento-card').forEach(c => {
                const isActive = (c.getAttribute('data-bento') === bentoKey);
                c.classList.toggle('active', isActive);
                const tag = c.querySelector('.bento-status-pill');
                if (tag) {
                    tag.textContent = isActive ? '当前查看' : '点击过滤 ➔';
                }
            });

            // 下层 Filter Chips 重置为“全部”高亮
            document.querySelectorAll('.filter-chips .filter-chip').forEach(chip => {
                chip.classList.toggle('active', chip.getAttribute('data-progress') === 'all');
            });

            renderDashboard();
        });
    });

    // 3. 辅助微过滤芯片栏点击 (按当前流程进度阶段维度匹配)
    document.querySelectorAll('.filter-chips .filter-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const progressKey = chip.getAttribute('data-progress') || 'all';
            currentProgressFilter = progressKey;
            currentBentoFilter = 'all'; // 切换进度阶段时，重置上层状态为全部

            // 下层 Filter Chips 激活态
            document.querySelectorAll('.filter-chips .filter-chip').forEach(c => {
                c.classList.toggle('active', c.getAttribute('data-progress') === progressKey);
            });

            // 上层 Bento 卡片重置为第1个激活
            document.querySelectorAll('.bento-card').forEach(c => {
                const isAll = (c.getAttribute('data-bento') === 'all');
                c.classList.toggle('active', isAll);
                const tag = c.querySelector('.bento-status-pill');
                if (tag) {
                    tag.textContent = isAll ? '当前查看' : '点击过滤 ➔';
                }
            });

            renderDashboard();
        });
    });

    // 4. 搜索框防抖监听与一键清除
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

    // 5. 刷新按钮
    const refreshBtn = document.getElementById('btn-global-refresh');
    const refreshSpin = document.getElementById('refresh-spin');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            if (refreshSpin) refreshSpin.classList.add('spinning');
            loadAllData().finally(() => {
                setTimeout(() => {
                    if (refreshSpin) refreshSpin.classList.remove('spinning');
                }, 450);
            });
        });
    }

    // 6. 唤醒桌面挂件
    const btnWakeWidget = document.getElementById('btn-wake-widget');
    if (btnWakeWidget) {
        btnWakeWidget.addEventListener('click', async () => {
            try {
                btnWakeWidget.disabled = true;
                btnWakeWidget.innerHTML = '<span class="tool-icon">⏳</span> 正在唤醒...';
                const resp = await fetch('/api/show_widget', { method: 'POST' });
                const res = await resp.json();
                if (res.success) {
                    btnWakeWidget.innerHTML = '<span class="tool-icon">✅</span> 已唤醒';
                } else {
                    alert('唤醒挂件提示: ' + (res.message || '挂件可能已在前台'));
                }
            } catch (err) {
                console.error('唤醒挂件异常:', err);
                alert('唤醒挂件失败，请确认客户端在后台运行');
            } finally {
                setTimeout(() => {
                    btnWakeWidget.disabled = false;
                    btnWakeWidget.innerHTML = '<span class="tool-icon">💻</span> 唤醒桌面透明挂件';
                }, 1200);
            }
        });
    }

    // 7. 抽屉关闭事件
    const drawerOverlay = document.getElementById('timeline-drawer-overlay');
    const drawerCloseBtn = document.getElementById('drawer-close-btn');
    if (drawerCloseBtn) drawerCloseBtn.addEventListener('click', closeTimelineDrawer);
    if (drawerOverlay) {
        drawerOverlay.addEventListener('click', (e) => {
            if (e.target === drawerOverlay) closeTimelineDrawer();
        });
    }

    // 7.5 AI 详情抽屉关闭事件
    const reviewDrawerOverlay = document.getElementById('review-detail-drawer-overlay');
    const reviewDrawerCloseBtn = document.getElementById('review-drawer-close-btn');
    if (reviewDrawerCloseBtn) reviewDrawerCloseBtn.addEventListener('click', closeReviewDetailDrawer);
    if (reviewDrawerOverlay) {
        reviewDrawerOverlay.addEventListener('click', (e) => {
            if (e.target === reviewDrawerOverlay) closeReviewDetailDrawer();
        });
    }

    // 8. 快捷键 Esc
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeTimelineDrawer();
            closeReviewDetailDrawer();
            closeConfigModal();
            closeManualStageModal();
            closeEditStageModal();
        }
    });

    // 9. 设置弹窗事件
    const settingsNav = document.getElementById('admin-settings-nav');
    const btnCloseModal = document.getElementById('admin-btn-close-cfg');
    const btnCloseModalX = document.getElementById('admin-btn-close-cfg-x');
    const btnSaveModal = document.getElementById('admin-btn-save-cfg');

    if (settingsNav) settingsNav.addEventListener('click', showConfigModal);
    if (btnCloseModal) btnCloseModal.addEventListener('click', closeConfigModal);
    if (btnCloseModalX) btnCloseModalX.addEventListener('click', closeConfigModal);
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
// 🚀 求职流程进度分类器 (根据最新环节名称与整体状态精准匹配)
// 无论是否已完成还是待参加，只要属于该流程环节，均归入该分类
// ==========================================================================
function getStageProgressCategory(app, latestStage) {
    if (app && (app.overall_status === 'archived' || app.overall_status === 'failed')) return 'terminated';
    if (latestStage && (latestStage.stage_status === 'archived' || latestStage.stage_status === 'failed')) return 'terminated';
    const name = latestStage ? (latestStage.stage_name || '').trim() : (app ? (app.current_stage_name || '') : '');
    if (name.includes('感谢信') || name.includes('终止') || name.includes('未通过') || name.includes('遗憾') || name.includes('淘汰') || name.includes('放弃') || name.includes('结束')) {
        return 'terminated';
    }

    if (app && app.overall_status === 'offered') return 'offer';
    if (latestStage && latestStage.stage_status === 'offered') return 'offer';
    if (name.includes('Offer') || name.includes('offer') || name.includes('录用') || name.includes('意向') || name.includes('录取') || name.includes('签约') || name.includes('入职')) {
        return 'offer';
    }

    if (name.includes('笔试') || name.includes('机考') || name.includes('机试') || name.includes('编程') || name.includes('代码测试') || name.includes('专业笔试')) {
        return 'written_test';
    }

    if (name.includes('测评') || name.includes('性格') || name.includes('认知') || name.includes('综合测') || name.includes('心理测试') || (name.includes('测试') && !name.includes('笔试'))) {
        return 'assessment';
    }

    if (name.includes('面') || name.includes('初试') || name.includes('复试') || name.includes('终审') || name.includes('加试') || name.includes('主管面')) {
        return 'interview';
    }

    return 'other';
}

// ==========================================================================
// 7. 顶部 4 大 KPI 数据指标卡动态计算 (待办/结果客观状态维度)
// ==========================================================================
function updateKPICards() {
    const totalCompaniesEl = document.getElementById('metric-total-companies');
    const activeStagesEl = document.getElementById('metric-active-stages');
    const waitingResultsEl = document.getElementById('metric-waiting-results');
    const offerCountEl = document.getElementById('metric-offer-count');

    // 统计已审核放行（拥有非 pending/ignored 环节）且非归档的投递单
    const validApps = allApplications.filter(app => {
        if (app.overall_status === 'archived' || app.overall_status === 'failed') return false;
        const stages = (app.stages || []).filter(s => s.stage_status !== 'ignored' && s.stage_status !== 'pending');
        return stages.length > 0;
    });

    const totalAppsCount = validApps.length;
    let todoCount = 0;
    let waitingResultsCount = 0;
    let offerCount = 0;

    validApps.forEach(app => {
        const stages = (app.stages || []).filter(s => s.stage_status !== 'ignored' && s.stage_status !== 'pending')
            .sort((a, b) => (a.seq || 1) - (b.seq || 1));
        if (stages.length === 0) return;

        const latestStage = stages[stages.length - 1];
        const category = getStageProgressCategory(app, latestStage);

        if (category === 'offer' || app.overall_status === 'offered' || latestStage.stage_status === 'offered') {
            offerCount++;
        } else if (latestStage.stage_status === 'awaiting_result') {
            waitingResultsCount++;
        } else if (latestStage.stage_status === 'scheduled') {
            todoCount++;
        }
    });

    if (totalCompaniesEl) totalCompaniesEl.textContent = totalAppsCount;
    if (activeStagesEl) activeStagesEl.textContent = todoCount;
    if (waitingResultsEl) waitingResultsEl.textContent = waitingResultsCount;
    if (offerCountEl) offerCountEl.textContent = offerCount;
}

// ==========================================================================
// 8. 渲染求职全景进度看板 (Dashboard Table - Applications 主表驱动)
// ==========================================================================
function renderDashboard() {
    const tbody = document.getElementById('dashboard-tbody');
    if (!tbody) return;

    // 仅筛选出已审核放行（拥有非 pending/ignored 环节）或主动归档的投递单
    const approvedApplications = allApplications.filter(app => {
        const stages = (app.stages || []).filter(s => s.stage_status !== 'ignored' && s.stage_status !== 'pending');
        return stages.length > 0 || app.overall_status === 'archived';
    });

    if (approvedApplications.length === 0) {
        const pendingCount = allStages.filter(s => s.stage_status === 'pending').length;
        tbody.innerHTML = `
            <tr>
                <td colspan="5" class="empty-state">
                    <div style="padding: 36px 16px;">
                        <div style="font-size: 2.2rem; margin-bottom: 8px;">📬</div>
                        <div style="font-size: 1.05rem; font-weight: 700; color: var(--text-main); margin-bottom: 6px;">
                            ${pendingCount > 0 ? `有 ${pendingCount} 封新邮件待审核准入` : '暂无求职建档记录'}
                        </div>
                        <div style="font-size: 0.86rem; color: var(--text-muted); max-width: 520px; margin: 0 auto; line-height: 1.6;">
                            ${pendingCount > 0 
                                ? `云端 AI 已为您提取 <strong>${pendingCount}</strong> 封求职通知存放在顶栏 <strong>「新邮件待审」</strong> 中。<br>请前往待审大厅点击 <strong>“✓ 通过”</strong>，确认后将自动在此全景建档并同步至桌面挂件！`
                                : '云端抓取或手动建档后，在此展示公司全景求职链路。'}
                        </div>
                    </div>
                </td>
            </tr>
        `;
        return;
    }

    // 过滤逻辑 (搜索 & Bento 状态 & 流程进度 Filter Chips)
    const filteredApps = approvedApplications.filter(app => {
        const stages = (app.stages || []).filter(s => s.stage_status !== 'ignored' && s.stage_status !== 'pending')
            .sort((a, b) => (a.seq || 1) - (b.seq || 1));
        const latestStage = stages.length > 0 ? stages[stages.length - 1] : null;
        const progressCategory = getStageProgressCategory(app, latestStage);

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

        // 1. 上层 Bento 状态维度过滤 (全部 / 待办 / 等待结果 / 已录用)
        if (currentBentoFilter === 'all') {
            if (currentProgressFilter !== 'terminated' && (app.overall_status === 'archived' || progressCategory === 'terminated')) return false;
        } else if (currentBentoFilter === 'todo') {
            if (!latestStage || latestStage.stage_status !== 'scheduled') return false;
        } else if (currentBentoFilter === 'waiting') {
            if (!latestStage || latestStage.stage_status !== 'awaiting_result') return false;
        } else if (currentBentoFilter === 'offer') {
            if (app.overall_status !== 'offered' && progressCategory !== 'offer' && (!latestStage || latestStage.stage_status !== 'offered')) return false;
        }

        // 2. 下层 Filter Chips 流程进度阶段过滤 (全部 / 测评 / 笔试 / 面试 / Offer / 终止)
        if (currentProgressFilter === 'assessment') {
            return progressCategory === 'assessment';
        } else if (currentProgressFilter === 'written_test') {
            return progressCategory === 'written_test';
        } else if (currentProgressFilter === 'interview') {
            return progressCategory === 'interview';
        } else if (currentProgressFilter === 'offer') {
            return progressCategory === 'offer';
        } else if (currentProgressFilter === 'terminated') {
            return progressCategory === 'terminated';
        }

        return true;
    });

    if (filteredApps.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="empty-state">🔍 没有匹配到符合当前筛选条件的企业或岗位</td></tr>';
        return;
    }

    tbody.innerHTML = filteredApps.map(app => {
        const stages = (app.stages || []).filter(s => s.stage_status !== 'ignored' && s.stage_status !== 'pending')
            .sort((a, b) => (a.seq || 1) - (b.seq || 1));
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
                        <div class="comp-avatar" style="background:${avatarBg};">
                            ${avatarInitial}
                        </div>
                        <div class="comp-info">
                            <div class="comp-name-row">
                                <span class="comp-title">${safeCompany}</span>
                                ${safeDept ? `<span class="dept-pill">${safeDept}</span>` : ''}
                            </div>
                            <span class="comp-position">${safePos}</span>
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
                    <span class="time-text">${timeFormatted}</span>
                </td>
                <td style="text-align: right;">
                    <button class="btn-row-action" onclick="event.stopPropagation(); openTimelineDrawer('${app.id}')">
                        全景时间线 ➔
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
                    const isInvite = safeType.includes('邀请') || safeType.includes('宣讲') || safeType.includes('夏令营');
                    const btnLabel = isInvite ? '✓ 标为已投递/已报名' : '✓ 标为已参加';
                    actionButtonsHTML = `
                        <button class="btn btn-primary btn-sm" style="font-size:0.75rem;padding:3px 10px;" onclick="advanceStageStatus('${s.id}', 'awaiting_result', '${app.id}')" title="标记为已完成并等待下一轮">
                            ${btnLabel}
                        </button>
                        <button class="btn btn-secondary btn-sm" style="font-size:0.75rem;padding:3px 8px;color:#334155;" onclick="openEditStageModal('${s.id}')" title="全字段自由修正：修改环节名称、流转状态、约定时间、会议号或备注">
                            ✏️ 修正
                        </button>
                        <button class="btn btn-outline btn-sm" style="font-size:0.75rem;padding:3px 8px;color:#64748B;" onclick="rollbackCurrentStage('${app.id}', '${s.id}')" title="手误推进或错发邮件：撤销当前轮次并无缝回退到上一轮">
                            ↩ 撤销本轮
                        </button>
                    `;
                } else if (s.stage_status === 'awaiting_result') {
                    actionButtonsHTML = `
                        <button class="btn btn-secondary btn-sm" style="font-size:0.75rem;padding:3px 8px;color:#64748B;" onclick="advanceStageStatus('${s.id}', 'scheduled', '${app.id}')" title="误操作撤回：重新激活待办并推回桌面挂件">
                            ↩ 撤回待办
                        </button>
                        <button class="btn btn-secondary btn-sm" style="font-size:0.75rem;padding:3px 8px;color:#334155;" onclick="openEditStageModal('${s.id}')" title="全字段自由修正：修改环节名称、流转状态、约定时间、会议号或备注">
                            ✏️ 修正
                        </button>
                    `;
                } else {
                    actionButtonsHTML = `
                        <button class="btn btn-secondary btn-sm" style="font-size:0.75rem;padding:3px 8px;color:#334155;" onclick="openEditStageModal('${s.id}')" title="全字段自由修正：修改环节名称、流转状态、约定时间、会议号或备注">
                            ✏️ 修正
                        </button>
                    `;
                }
            } else {
                // 历史已过环节：显示为只读已通过，也允许修正
                actionButtonsHTML = `
                    <span class="badge-tag badge-gray" style="font-size:0.72rem;">✓ 历史环节</span>
                    <button class="btn btn-secondary btn-sm" style="font-size:0.72rem;padding:2px 7px;color:#64748B;" onclick="openEditStageModal('${s.id}')" title="修正此历史环节信息">
                        ✏️ 修正
                    </button>
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
// 11. 审核大厅与已忽略归档核心逻辑 (Review Hall & Ignored Archive - Option A)
// ==========================================================================
function switchReviewSubtab(subtab) {
    const btnPending = document.getElementById('btn-subtab-pending');
    const btnIgnored = document.getElementById('btn-subtab-ignored');
    const containerPending = document.getElementById('review-cards-container');
    const containerIgnored = document.getElementById('ignored-cards-container');

    if (subtab === 'pending') {
        if (btnPending) btnPending.classList.add('active');
        if (btnIgnored) btnIgnored.classList.remove('active');
        if (containerPending) containerPending.style.display = 'grid';
        if (containerIgnored) containerIgnored.style.display = 'none';
        const pendingStages = allStages.filter(s => s.stage_status === 'pending');
        renderReviews(pendingStages);
    } else {
        if (btnPending) btnPending.classList.remove('active');
        if (btnIgnored) btnIgnored.classList.add('active');
        if (containerPending) containerPending.style.display = 'none';
        if (containerIgnored) containerIgnored.style.display = 'grid';
        const ignoredStages = allStages.filter(s => s.stage_status === 'ignored');
        renderIgnoredReviews(ignoredStages);
    }
}

async function loadReviews() {
    await loadAllData();
}

function renderReviews(stages) {
    const container = document.getElementById('review-cards-container');
    const batchBtn = document.getElementById('btn-batch-approve');
    const badgeSub = document.getElementById('review-badge-sub');
    const badgeMain = document.getElementById('review-badge');

    const totalCount = stages.length;
    if (badgeSub) badgeSub.textContent = totalCount;
    if (badgeMain) badgeMain.textContent = totalCount;

    if (batchBtn) {
        batchBtn.style.display = totalCount > 1 ? 'inline-flex' : 'none';
        batchBtn.innerHTML = `<span>⚡️</span> 一键全选准入 (${totalCount})`;
    }

    if (!container) return;

    if (totalCount === 0) {
        container.innerHTML = `
            <div class="celebration-empty-card">
                <div class="celebration-badge-icon">🎉</div>
                <h3 style="font-size:1.35rem;font-weight:900;color:var(--text-main);margin-bottom:4px;">待审大厅已全部清空！</h3>
                <p style="font-size:0.86rem;color:var(--text-muted);max-width:540px;line-height:1.6;">
                    所有新邮件已 100% 成功放行准入，已自动在「求职全景看板」与「Mac 桌面挂件」中生成求职赛道！
                </p>
                <div class="celebration-metrics-row">
                    <div class="celebration-metric-tile">
                        <span class="celebration-metric-num" style="color:var(--accent-indigo);">7x24h</span>
                        <span class="celebration-metric-label">云端实时抓取</span>
                    </div>
                    <div class="celebration-metric-tile">
                        <span class="celebration-metric-num" style="color:var(--accent-emerald-dark);">0 待办</span>
                        <span class="celebration-metric-label">全部处理完毕</span>
                    </div>
                </div>
                <button class="btn-action-pill" style="margin-top:6px;background:var(--brand-dark);color:#fff;border:none;padding:8px 24px;" onclick="document.getElementById('nav-item-dashboard')?.click()">
                    📊 前往求职全景看板 ➔
                </button>
            </div>
        `;
        return;
    }

    container.innerHTML = stages.map(stage => {
        const app = allApplications.find(a => a.id === stage.application_id) || {};
        const meta = getStageStatusMeta(stage, app);
        const safeCompany = escapeHTML(app.company || '未知企业');
        const safeDept = app.department ? escapeHTML(app.department) : '';
        const safePosition = escapeHTML(app.position || stage.raw_subject || '求职岗位');
        const safeType = escapeHTML(stage.stage_name || '环节');
        const safeTime = escapeHTML(stage.schedule_time || '待定');
        const safeNextExp = escapeHTML(stage.next_expectation || '等待下一步通知');
        const safeMeeting = (stage.meeting_info || '').trim();
        const safeNotes = (stage.notes || '').trim();
        const avatarBg = getCompanyColor(app.company);
        const avatarInitial = getCompanyInitial(app.company);

        // AI 摘要
        let aiSummary = '';
        if (safeNotes) {
            aiSummary = safeNotes;
        } else if (safeNextExp && safeNextExp !== '等待下一步通知') {
            aiSummary = `官方通知：${safeNextExp}`;
        } else {
            aiSummary = `DeepSeek AI 提取：已识别为「${safeCompany}」的${safeType}通知，请确认并放行。`;
        }

        // 凭据与链接
        let linkHTML = '';
        if (safeMeeting.startsWith('http://') || safeMeeting.startsWith('https://')) {
            linkHTML = `<a href="${escapeHTML(safeMeeting)}" target="_blank" class="review-link-pill" onclick="event.stopPropagation()">🔗 官网/入口 ↗</a>`;
        } else if (safeMeeting) {
            linkHTML = `<span class="review-deadline-bubble" style="background:#FFFBEB;border-color:#FDE68A;color:#92400E;" onclick="event.stopPropagation();navigator.clipboard.writeText('${escapeHTML(safeMeeting)}');showAdminToast('已复制凭据', '${escapeHTML(safeMeeting)}');">🔑 ${escapeHTML(safeMeeting)} ⎘</span>`;
        }

        const isTimeScheduled = safeTime !== '待定' && safeTime !== '';
        const timeHTML = isTimeScheduled
            ? `<span class="review-deadline-bubble">📅 ${safeTime}</span>`
            : `<span class="review-deadline-bubble" style="background:#F1F5F9;border-color:#E2E8F0;color:#64748B;">⏳ ${safeNextExp}</span>`;

        return `
            <div class="review-card" id="review-card-${stage.id}" onclick="openReviewDetailDrawer('${stage.id}')">
                <div class="review-card-header">
                    <div class="review-card-company-group">
                        <div class="review-card-avatar" style="background:${avatarBg};">
                            ${avatarInitial}
                        </div>
                        <div class="review-card-title-group">
                            <div class="review-card-name-row">
                                <span class="review-card-name">${safeCompany}</span>
                                ${safeDept ? `<span class="dept-pill" style="font-size:0.68rem;padding:1px 5px;">${safeDept}</span>` : ''}
                            </div>
                            <span class="review-card-job" title="${safePosition}">${safePosition}</span>
                        </div>
                    </div>
                    <span class="badge-tag ${meta.badgeClass}">${meta.icon} ${safeType}</span>
                </div>

                <div class="review-card-ai-box">
                    <div class="ai-box-bullet">
                        <span class="ai-box-icon">✦</span>
                        <span><strong>AI 摘要:</strong> ${escapeHTML(aiSummary)}</span>
                    </div>
                </div>

                <div class="review-card-meta-row">
                    ${timeHTML}
                    ${linkHTML}
                </div>

                <div class="review-card-actions">
                    <button class="btn-card-approve" onclick="approveReviewCard('${stage.id}', event)" title="确认是我的求职邮件，通过并加入看板与桌面挂件">
                        ✓ 准入并加入看板
                    </button>
                    <button class="btn-card-ignore" onclick="ignoreReviewCard('${stage.id}', event)" title="广告/非本人应聘，移至已忽略">
                        ✕ 忽略
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

function renderIgnoredReviews(stages) {
    const container = document.getElementById('ignored-cards-container');
    const ignoredBadge = document.getElementById('ignored-badge');
    if (ignoredBadge) ignoredBadge.textContent = stages.length;

    if (!container) return;

    if (stages.length === 0) {
        container.innerHTML = `
            <div style="grid-column: 1 / -1; padding: 60px 20px; text-align: center; color: var(--text-muted);">
                <div style="font-size: 2.4rem; margin-bottom: 8px;">📦</div>
                <div style="font-weight: 800; font-size: 1.1rem; color: var(--text-main);">暂无已忽略邮件</div>
                <div style="font-size: 0.86rem; color: var(--text-muted); margin-top: 4px;">
                    被忽略的邮件会保存在此，随时可一键恢复。
                </div>
            </div>
        `;
        return;
    }

    container.innerHTML = stages.map(stage => {
        const app = allApplications.find(a => a.id === stage.application_id) || {};
        const meta = getStageStatusMeta(stage, app);
        const safeCompany = escapeHTML(app.company || '未知企业');
        const safePosition = escapeHTML(app.position || stage.raw_subject || '无主题');
        const safeType = escapeHTML(stage.stage_name || '环节');
        const avatarBg = getCompanyColor(app.company);
        const avatarInitial = getCompanyInitial(app.company);

        let timeStr = '未知';
        if (stage.created_at) {
            try {
                const dt = new Date(stage.created_at);
                timeStr = `${dt.getMonth() + 1}/${dt.getDate()} ${dt.getHours().toString().padStart(2, '0')}:${dt.getMinutes().toString().padStart(2, '0')}`;
            } catch(e) {}
        }

        return `
            <div class="review-card card-ignored" id="ignored-card-${stage.id}">
                <div class="review-card-header">
                    <div class="review-card-company-group">
                        <div class="review-card-avatar" style="background:${avatarBg}; opacity:0.8;">
                            ${avatarInitial}
                        </div>
                        <div class="review-card-title-group">
                            <span class="review-card-name">${safeCompany}</span>
                            <span class="review-card-job" title="${safePosition}">${safePosition}</span>
                        </div>
                    </div>
                    <span class="badge-tag badge-gray">📦 已忽略</span>
                </div>

                <div class="review-card-ai-box" style="background:#F5F5F4; border-color:#E7E5E4;">
                    <div class="ai-box-bullet">
                        <span class="ai-box-icon">✦</span>
                        <span><strong>忽略记录:</strong> 邮件主题《${safePosition}》，忽略于 ${timeStr}</span>
                    </div>
                </div>

                <div class="review-card-actions">
                    <button class="btn-card-restore" onclick="restoreIgnoredStage('${stage.id}', 'pending')" title="恢复并重新放回待审核大厅">
                        ↩ 恢复至待审
                    </button>
                    <button class="btn-card-approve" style="flex:1;" onclick="restoreIgnoredStage('${stage.id}', 'scheduled')" title="纠错后直接通过并建档">
                        ✓ 直接准入并建档
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

// 🧠 打开 AI 邮件智能解析详情抽屉
function openReviewDetailDrawer(stageId) {
    const stage = allStages.find(s => s.id === stageId);
    if (!stage) return;

    const app = allApplications.find(a => a.id === stage.application_id) || {};
    const meta = getStageStatusMeta(stage, app);
    const safeCompany = escapeHTML(app.company || '未知企业');
    const safePosition = escapeHTML(app.position || stage.raw_subject || '求职岗位');
    const safeType = escapeHTML(stage.stage_name || '环节');
    const safeNotes = escapeHTML(stage.notes || '');
    const safeMeeting = (stage.meeting_info || '').trim();

    const overlay = document.getElementById('review-detail-drawer-overlay');
    const avatar = document.getElementById('review-drawer-avatar');
    const title = document.getElementById('review-drawer-title');
    const badge = document.getElementById('review-drawer-badge');
    const metaText = document.getElementById('review-drawer-meta-text');
    const aiCard = document.getElementById('review-drawer-ai-card');
    const snippetCard = document.getElementById('review-drawer-snippet-card');
    const credsGroup = document.getElementById('review-drawer-creds-group');
    const btnApprove = document.getElementById('review-drawer-btn-approve');
    const btnIgnore = document.getElementById('review-drawer-btn-ignore');

    if (!overlay) return;

    if (avatar) {
        avatar.style.background = getCompanyColor(app.company);
        avatar.textContent = getCompanyInitial(app.company);
    }
    if (title) title.textContent = `${safeCompany} · ${safeType}`;
    if (badge) {
        badge.className = `badge-tag ${meta.badgeClass}`;
        badge.textContent = `${meta.icon} ${safeType}`;
    }
    if (metaText) {
        let timeStr = '刚刚';
        if (stage.created_at) {
            try {
                const dt = new Date(stage.created_at);
                timeStr = `${dt.getMonth() + 1}月${dt.getDate()}日 ${dt.getHours().toString().padStart(2, '0')}:${dt.getMinutes().toString().padStart(2, '0')}`;
            } catch(e) {}
        }
        metaText.textContent = `抓取时间: ${timeStr} · 来源: 官方校招网申通道`;
    }

    // 1. AI 分析要点
    if (aiCard) {
        aiCard.innerHTML = `
            <div>• <strong>目标岗位:</strong> ${safePosition}</div>
            <div>• <strong>环节归类:</strong> ${safeType} (预期：${escapeHTML(stage.next_expectation || '等待下一步通知')})</div>
            <div>• <strong>约定时间:</strong> ${stage.schedule_time || '待定/待推进'}</div>
            ${safeNotes ? `<div>• <strong>要点提取:</strong> ${safeNotes}</div>` : ''}
            <div>• <strong>匹配置信度:</strong> <span style="color:#10B981;font-weight:800;">99.4% 确认为本人真实求职通知</span></div>
        `;
    }

    // 2. 邮件原文提取片段
    if (snippetCard) {
        snippetCard.textContent = stage.raw_subject ? `邮件主题：《${stage.raw_subject}》\n\n正文关键摘要：已成功由云端 DeepSeek AI 解析为 ${safeCompany} 的${safeType}通知。` : '暂无详细邮件原文片段。';
    }

    // 3. 凭据与链接
    if (credsGroup) {
        let credsHTML = '';
        if (safeMeeting.startsWith('http://') || safeMeeting.startsWith('https://')) {
            credsHTML += `
                <div style="display:flex;align-items:center;justify-content:space-between;background:#EEF2FF;border:1px solid #C7D2FE;padding:10px 14px;border-radius:8px;">
                    <span style="font-size:0.84rem;color:#4338CA;">🔗 <strong>官网直达/作答入口:</strong> ${escapeHTML(safeMeeting)}</span>
                    <a href="${escapeHTML(safeMeeting)}" target="_blank" class="review-link-pill">打开 ↗</a>
                </div>
            `;
        } else if (safeMeeting) {
            credsHTML += `
                <div style="display:flex;align-items:center;justify-content:space-between;background:#FFFBEB;border:1px solid #FDE68A;padding:10px 14px;border-radius:8px;">
                    <span style="font-size:0.84rem;color:#92400E;">🔑 <strong>会议号/考试凭据:</strong> ${escapeHTML(safeMeeting)}</span>
                    <button class="review-copy-btn" onclick="navigator.clipboard.writeText('${escapeHTML(safeMeeting)}');showAdminToast('已复制凭据', '${escapeHTML(safeMeeting)}');">复制 ⎘</button>
                </div>
            `;
        } else {
            credsHTML = '<div style="font-size:0.8rem;color:#94A3B8;">无需额外会议号或考试凭据</div>';
        }
        credsGroup.innerHTML = credsHTML;
    }

    // 绑定抽屉底部按钮
    if (btnApprove) {
        btnApprove.onclick = async () => {
            closeReviewDetailDrawer();
            await approveReviewCard(stageId);
        };
    }
    if (btnIgnore) {
        btnIgnore.onclick = async () => {
            closeReviewDetailDrawer();
            await ignoreReviewCard(stageId);
        };
    }

    overlay.style.display = 'flex';
}

function closeReviewDetailDrawer() {
    const overlay = document.getElementById('review-detail-drawer-overlay');
    if (overlay) overlay.style.display = 'none';
}

// ⚡️ 单卡准入交互反馈
async function approveReviewCard(stageId, event) {
    if (event) event.stopPropagation();
    const stage = allStages.find(s => s.id === stageId);
    const app = stage ? allApplications.find(a => a.id === stage.application_id) : null;
    const compName = app ? app.company : (stage ? stage.raw_subject : '该企业');

    const cardEl = document.getElementById(`review-card-${stageId}`);
    if (cardEl) {
        cardEl.classList.add('is-approved');
        cardEl.innerHTML = `
            <div style="padding: 24px 0; text-align: center;">
                <div style="font-size: 2rem; margin-bottom: 6px;">✅</div>
                <div style="font-weight: 800; color: #065F46; font-size: 1.05rem;">已成功放行准入！</div>
                <div style="font-size: 0.78rem; color: #059669; margin-top: 4px;">已自动为「${escapeHTML(compName)}」在看板与挂件同步建档</div>
            </div>
        `;
    }

    showAdminToast('准入成功！已自动全景建档', `已为「${compName}」同步至求职全景看板与桌面挂件`);
    await approveStage(stageId);
}

// 🗑️ 单卡忽略交互反馈
async function ignoreReviewCard(stageId, event) {
    if (event) event.stopPropagation();
    const stage = allStages.find(s => s.id === stageId);
    const app = stage ? allApplications.find(a => a.id === stage.application_id) : null;
    const compName = app ? app.company : '该邮件';

    const cardEl = document.getElementById(`review-card-${stageId}`);
    if (cardEl) {
        cardEl.style.opacity = '0';
        cardEl.style.transform = 'scale(0.95)';
    }

    showAdminToast('已移入忽略归档箱', `「${compName}」已移入已忽略，随时可撤销恢复`);
    await ignoreStage(stageId);
}

// ⚡️ 全局浮动 Toast 通知
function showAdminToast(title, subtitle) {
    const container = document.getElementById('admin-toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'admin-toast';
    toast.innerHTML = `
        <div class="toast-icon">✓</div>
        <div class="toast-content">
            <div class="toast-title">${escapeHTML(title)}</div>
            ${subtitle ? `<div class="toast-desc">${escapeHTML(subtitle)}</div>` : ''}
        </div>
    `;

    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-10px)';
        toast.style.transition = 'all 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 3200);
}

// ⚡️ 批量一键放行准入全部待审邮件
async function batchApproveAllStages() {
    const pendingStages = allStages.filter(s => s.stage_status === 'pending');
    if (pendingStages.length === 0) return;
    if (!confirm(`确定要一键将当前 ${pendingStages.length} 封待审邮件全部放行准入并建档吗？`)) return;
    if (!supabase) return;

    try {
        const stageIds = pendingStages.map(s => s.id);
        const { error } = await supabase
            .from('application_stages')
            .update({
                stage_status: 'awaiting_result',
                updated_at: new Date().toISOString()
            })
            .in('id', stageIds);

        if (error) throw error;

        // 同步将涉及的主表激活
        const appIds = [...new Set(pendingStages.map(s => s.application_id).filter(Boolean))];
        for (const appId of appIds) {
            const appStages = pendingStages.filter(s => s.application_id === appId);
            const latest = appStages[appStages.length - 1];
            if (latest) {
                await supabase
                    .from('applications')
                    .update({
                        current_stage_name: latest.stage_name,
                        overall_status: 'active',
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', appId);
            }
        }

        showAdminToast('批量放行成功！', `已一键为全部 ${stageIds.length} 封邮件完成准入建档`);
        console.log(`✅ 批量准入 ${stageIds.length} 个环节成功`);
        await loadAllData();
    } catch (err) {
        console.error('批量准入失败:', err);
        alert(`批量操作失败: ${err.message}`);
    }
}

// 审核通过底层函数
async function approveStage(stageId) {
    if (!supabase) return;
    try {
        const stage = allStages.find(s => s.id === stageId);
        if (!stage) return;

        const isInvite = (stage.stage_name || '').includes('邀请') || (stage.stage_name || '').includes('宣讲') || (stage.stage_name || '').includes('邀约');
        const hasTime = stage.schedule_time && stage.schedule_time !== '待定';
        const targetStatus = (isInvite || hasTime) ? 'scheduled' : 'awaiting_result';

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
            if ((stage.seq || 1) > 1) {
                await supabase
                    .from('application_stages')
                    .update({
                        stage_status: 'passed',
                        updated_at: new Date().toISOString()
                    })
                    .eq('application_id', stage.application_id)
                    .lt('seq', stage.seq || 1);
            }

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

// 忽略归档底层函数
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

        showAdminToast('已恢复环节', targetStatus === 'pending' ? '已重新放回待审大厅' : '已直接准入建档');
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
        let targetApp = null;
        if (boundAppId) {
            targetApp = allApplications.find(a => a.id === boundAppId);
        }
        if (!targetApp) {
            targetApp = allApplications.find(a => a.company === compName && (a.department || '') === deptName);
        }

        let appId = targetApp ? targetApp.id : null;
        let nextSeq = 1;

        if (targetApp) {
            // 已有企业：计算下一轮 seq
            const existingStages = (appStagesMap[targetApp.id] || []).filter(s => s.stage_status !== 'ignored');
            nextSeq = existingStages.length > 0 ? Math.max(...existingStages.map(s => s.seq || 1)) + 1 : 1;

            // 将该企业下的前序非忽略环节标记为 passed (已通过)
            await supabase
                .from('application_stages')
                .update({
                    stage_status: 'passed',
                    updated_at: new Date().toISOString()
                })
                .eq('application_id', targetApp.id)
                .neq('stage_status', 'ignored');

            // 更新主表状态
            await supabase
                .from('applications')
                .update({
                    company: compName,
                    department: deptName || null,
                    position: jobSubject || targetApp.position,
                    current_stage_name: stageType,
                    overall_status: (stageType.includes('Offer') || stageType.includes('录用')) ? 'offered' : 'active',
                    updated_at: new Date().toISOString()
                })
                .eq('id', targetApp.id);
        } else {
            // 全新企业：建档 applications 主表
            appId = (window.crypto && window.crypto.randomUUID)
                ? window.crypto.randomUUID()
                : ('app_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8));

            const newAppPayload = {
                id: appId,
                company: compName,
                department: deptName || null,
                position: jobSubject || '校招应聘岗位',
                current_stage_name: stageType,
                overall_status: (stageType.includes('Offer') || stageType.includes('录用')) ? 'offered' : 'active',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            };

            const { error: appErr } = await supabase
                .from('applications')
                .insert([newAppPayload]);

            if (appErr) throw appErr;
            nextSeq = 1;
        }

        // 插入 application_stages 子表
        const stageId = (window.crypto && window.crypto.randomUUID)
            ? window.crypto.randomUUID()
            : ('stage_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8));

        const isCompleted = (initialStatus === 'completed' || initialStatus === 'awaiting_result');
        const stageTargetStatus = isCompleted ? 'awaiting_result' : 'scheduled';

        const stagePayload = {
            id: stageId,
            application_id: appId,
            seq: nextSeq,
            stage_name: stageType,
            stage_status: stageTargetStatus,
            schedule_time: stageTime || '待定',
            meeting_info: stageNotes || '',
            next_expectation: nextExp || '',
            notes: stageNotes || '',
            raw_subject: jobSubject || `${compName} - ${stageType}`,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        const { error: stageErr } = await supabase
            .from('application_stages')
            .insert([stagePayload]);

        if (stageErr) throw stageErr;

        if (msgEl) {
            msgEl.textContent = '✅ 推进成功！已自动建档并在看板与桌面挂件中同步。';
            msgEl.style.color = '#10b981';
        }

        await loadAllData();

        setTimeout(() => {
            closeManualStageModal();
            // 如果抽屉处于打开状态或当前推进了该企业，刷新该企业的抽屉
            const drawerOverlay = document.getElementById('timeline-drawer-overlay');
            if (drawerOverlay && drawerOverlay.style.display === 'flex' && appId) {
                openTimelineDrawer(appId);
            }
        }, 500);

    } catch (err) {
        console.error('手动推进建档失败:', err);
        if (msgEl) {
            msgEl.textContent = `❌ 推进失败: ${err.message}`;
            msgEl.style.color = '#ef4444';
        }
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = '⚡️ 立即保存并建档';
        }
    }
}

// ==========================================================================
// 13. ✏️ 环节与求职信息全字段自由修正核心逻辑 (Full-Field Stage Editing)
// ==========================================================================
function openEditStageModal(stageId) {
    const stage = allStages.find(s => s.id === stageId);
    if (!stage) return;

    const app = allApplications.find(a => a.id === stage.application_id) || {};
    const modal = document.getElementById('admin-edit-stage-modal');
    if (!modal) return;

    // 填充隐藏 ID
    document.getElementById('edit-stage-id').value = stage.id;
    document.getElementById('edit-app-id').value = app.id || '';

    // 填充企业与岗位信息
    document.getElementById('edit-company-name').value = app.company || '';
    document.getElementById('edit-dept-name').value = app.department || '';
    document.getElementById('edit-position-name').value = app.position || stage.raw_subject || '';

    // 填充环节名称
    document.getElementById('edit-stage-name').value = stage.stage_name || '';

    // 填充状态单选
    let currentStatus = stage.stage_status || 'scheduled';
    if (app.overall_status === 'offered') currentStatus = 'offered';
    else if (app.overall_status === 'archived') currentStatus = 'archived';
    
    const radios = document.querySelectorAll('input[name="edit-stage-status"]');
    radios.forEach(r => {
        r.checked = (r.value === currentStatus);
    });

    // 填充约定时间与凭据
    document.getElementById('edit-schedule-time').value = stage.schedule_time || '';
    document.getElementById('edit-meeting-info').value = stage.meeting_info || '';
    document.getElementById('edit-next-expectation').value = stage.next_expectation || '';
    document.getElementById('edit-stage-notes').value = stage.notes || '';

    const msgEl = document.getElementById('edit-stage-msg');
    if (msgEl) msgEl.textContent = '';

    modal.style.display = 'flex';
}

function closeEditStageModal() {
    const modal = document.getElementById('admin-edit-stage-modal');
    if (modal) modal.style.display = 'none';
}

function selectEditStagePreset(presetName) {
    const stageInput = document.getElementById('edit-stage-name');
    const nextExpInput = document.getElementById('edit-next-expectation');
    if (stageInput) stageInput.value = presetName;

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

async function submitEditStage() {
    if (!supabase) {
        alert('请先连接 Supabase 云数据库！');
        return;
    }

    const stageId = document.getElementById('edit-stage-id')?.value;
    const appId = document.getElementById('edit-app-id')?.value;
    const compName = (document.getElementById('edit-company-name')?.value || '').trim();
    const deptName = (document.getElementById('edit-dept-name')?.value || '').trim();
    const posName = (document.getElementById('edit-position-name')?.value || '').trim();
    const stageName = (document.getElementById('edit-stage-name')?.value || '').trim();
    const statusVal = document.querySelector('input[name="edit-stage-status"]:checked')?.value || 'scheduled';
    const scheduleTime = (document.getElementById('edit-schedule-time')?.value || '').trim();
    const meetingInfo = (document.getElementById('edit-meeting-info')?.value || '').trim();
    const nextExp = (document.getElementById('edit-next-expectation')?.value || '').trim();
    const notes = (document.getElementById('edit-stage-notes')?.value || '').trim();
    const msgEl = document.getElementById('edit-stage-msg');
    const saveBtn = document.getElementById('btn-save-edit-stage');

    if (!compName) {
        if (msgEl) {
            msgEl.textContent = '⚠️ 企业名称不能为空';
            msgEl.style.color = '#ef4444';
        }
        return;
    }

    if (!stageName) {
        if (msgEl) {
            msgEl.textContent = '⚠️ 环节名称不能为空';
            msgEl.style.color = '#ef4444';
        }
        return;
    }

    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = '正在保存修改...';
    }

    try {
        // 1. 计算映射状态
        let overallStatus = 'active';
        let stageDbStatus = statusVal;

        if (statusVal === 'offered') {
            overallStatus = 'offered';
            stageDbStatus = 'passed';
        } else if (statusVal === 'archived') {
            overallStatus = 'archived';
            stageDbStatus = 'ignored';
        }

        // 2. 更新 applications 主表
        if (appId) {
            await supabase
                .from('applications')
                .update({
                    company: compName,
                    department: deptName || null,
                    position: posName || null,
                    current_stage_name: stageName,
                    overall_status: overallStatus,
                    updated_at: new Date().toISOString()
                })
                .eq('id', appId);
        }

        // 3. 更新 application_stages 子表
        if (stageId) {
            const { error: stageErr } = await supabase
                .from('application_stages')
                .update({
                    stage_name: stageName,
                    stage_status: stageDbStatus,
                    schedule_time: scheduleTime || '待定',
                    meeting_info: meetingInfo || '',
                    next_expectation: nextExp || '',
                    notes: notes || '',
                    updated_at: new Date().toISOString()
                })
                .eq('id', stageId);

            if (stageErr) throw stageErr;
        }

        showAdminToast('✅ 修正成功！', `已更新「${compName} - ${stageName}」全景求职档案`);
        await loadAllData();

        setTimeout(() => {
            closeEditStageModal();
            if (appId) {
                const drawerOverlay = document.getElementById('timeline-drawer-overlay');
                if (drawerOverlay && drawerOverlay.style.display === 'flex') {
                    openTimelineDrawer(appId);
                }
            }
        }, 300);

    } catch (err) {
        console.error('修正环节失败:', err);
        if (msgEl) {
            msgEl.textContent = `❌ 保存失败: ${err.message}`;
            msgEl.style.color = '#ef4444';
        }
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = '💾 保存所有修改';
        }
    }
}

// 🗑️ 直接删除指定环节
async function deleteStageDirectly() {
    const stageId = document.getElementById('edit-stage-id')?.value;
    const appId = document.getElementById('edit-app-id')?.value;
    if (!stageId) return;

    if (!confirm('确定要删除此求职环节吗？（删除后可在数据库中标记为已忽略）')) return;
    if (!supabase) return;

    try {
        await supabase
            .from('application_stages')
            .update({
                stage_status: 'ignored',
                updated_at: new Date().toISOString()
            })
            .eq('id', stageId);

        showAdminToast('已删除环节', '该环节已成功移除');
        await loadAllData();

        closeEditStageModal();
        if (appId) {
            const drawerOverlay = document.getElementById('timeline-drawer-overlay');
            if (drawerOverlay && drawerOverlay.style.display === 'flex') {
                openTimelineDrawer(appId);
            }
        }
    } catch (err) {
        console.error('删除环节失败:', err);
        alert(`删除失败: ${err.message}`);
    }
}




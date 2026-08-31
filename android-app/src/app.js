/**
 * OfferPilot Android App - 核心移动端业务引擎与状态机
 * 1:1 对齐网页端流转逻辑，严格实现 Warm Milk-Tea 瓷感视觉与微动效
 */

import { supabaseService } from './supabase.js';
import { triggerHaptic } from './haptics.js';

// ==================== 全局状态管理 ====================
const state = {
  applications: [],
  stages: [],
  activeBento: 'all',        // 'all' | 'todo' | 'waiting' | 'offer' (上层待办/结果状态维度)
  activeProgress: 'all',     // 'all' | 'assessment' | 'written_test' | 'interview' | 'offer' | 'terminated' (下层当前流程进度阶段维度)
  searchQuery: '',
  timelineSearchQuery: '',
  dashboardScrollY: 0,       // 控制台精准滚动位置记忆 (px)
  reviewSubtab: 'pending',
  currentTimelineAppId: null,
  currentDrawerStageId: null,
  isDrawerOpen: false
};

// ==================== 1. 初始化入口 ====================
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initNavigation();
  initSearchAndFilters();
  initSettings();
  initRealtimeTelemetry();
  
  // 首次拉取数据或展示配置指引
  const cfg = supabaseService.getConfig();
  if (cfg.isConfigured) {
    supabaseService.initRealtime();
    loadAllData();
  } else {
    // 手机端首次打开未配置时，在大厅展示安全连接引导
    renderDashboard();
    renderReviewHall();
  }

  // 监听 Supabase Realtime 实时推流
  supabaseService.onRealtimeMessage(() => {
    loadAllData(false);
  });
});

// ==================== 1.1 主题皮肤引擎 ====================
function initTheme() {
  const savedTheme = localStorage.getItem('offerpilot_theme') || 'creamy-luminous';
  applyTheme(savedTheme, false);
}

window.switchAppTheme = function(themeName) {
  applyTheme(themeName, true);
};

function applyTheme(themeName, showNotification = true) {
  document.body.setAttribute('data-theme', themeName);
  localStorage.setItem('offerpilot_theme', themeName);

  const cardCreamy = document.getElementById('theme-card-creamy');
  const cardClassic = document.getElementById('theme-card-classic');

  if (cardCreamy && cardClassic) {
    cardCreamy.classList.toggle('active', themeName === 'creamy-luminous');
    cardClassic.classList.toggle('active', themeName === 'classic-milktea');
  }

  if (showNotification) {
    triggerHaptic('medium');
    showToast(themeName === 'creamy-luminous' ? '✨ 已切换为 奶油琥珀流光 主题' : '🍃 已切换为 经典温润白瓷 主题');
  }
}

// ==================== 2. 底部导航栏 Tab 切换 ====================
function initNavigation() {
  const navBtns = document.querySelectorAll('.nav-btn');
  navBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.target;
      switchToTab(targetId);
      triggerHaptic('light');
    });
  });

  // 顶栏新建求职
  const btnHeaderCreate = document.getElementById('btn-header-create-job');
  if (btnHeaderCreate) {
    btnHeaderCreate.addEventListener('click', () => {
      openManualModal('');
      triggerHaptic('light');
    });
  }
}

function switchToTab(tabId) {
  // 1. 如果当前正在从控制台切走，精确记录当前的垂直滚动位置
  const activeView = document.querySelector('.tab-view.active');
  if (activeView && activeView.id === 'view-dashboard') {
    state.dashboardScrollY = window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
  }

  // 2. 切换 Tab 的激活状态
  document.querySelectorAll('.tab-view').forEach(view => view.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));

  const targetView = document.getElementById(tabId);
  const targetBtn = document.querySelector(`.nav-btn[data-target="${tabId}"]`);
  
  if (targetView) targetView.classList.add('active');
  if (targetBtn) targetBtn.classList.add('active');

  // 3. 智能滚动位置恢复机制
  if (tabId === 'view-dashboard') {
    // 切回控制台：无感恢复到上次浏览的精确坐标
    requestAnimationFrame(() => {
      window.scrollTo({
        top: state.dashboardScrollY || 0,
        behavior: 'instant'
      });
    });
  } else {
    // 切换到全景时间、待审大厅或设置时：顶部对齐
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
}

// 全景时间 ➔ 返回控制台
window.backToDashboard = function() {
  switchToTab('view-dashboard');
  triggerHaptic('light');
};

// ==================== 3. 初始化与搜索过滤 ====================
function initSearchAndFilters() {
  const searchInput = document.getElementById('dashboard-search-input');
  const searchClear = document.getElementById('dashboard-search-clear');

  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      state.searchQuery = e.target.value.trim().toLowerCase();
      if (searchClear) searchClear.style.display = state.searchQuery ? 'block' : 'none';
      renderDashboard();
    });
  }

  if (searchClear) {
    searchClear.addEventListener('click', () => {
      searchInput.value = '';
      state.searchQuery = '';
      searchClear.style.display = 'none';
      renderDashboard();
      triggerHaptic('light');
    });
  }

  // 全景时间线专属搜索监听
  const timelineSearchInput = document.getElementById('timeline-search-input');
  const timelineSearchClear = document.getElementById('timeline-search-clear');

  if (timelineSearchInput) {
    timelineSearchInput.addEventListener('input', (e) => {
      state.timelineSearchQuery = e.target.value.trim().toLowerCase();
      if (timelineSearchClear) timelineSearchClear.style.display = state.timelineSearchQuery ? 'block' : 'none';
      renderTimelineView(state.currentTimelineAppId);
    });
  }

  if (timelineSearchClear) {
    timelineSearchClear.addEventListener('click', () => {
      timelineSearchInput.value = '';
      state.timelineSearchQuery = '';
      timelineSearchClear.style.display = 'none';
      renderTimelineView(state.currentTimelineAppId);
      triggerHaptic('light');
    });
  }

  // 上层 4 大 Bento KPI 指标卡点击 (状态维度)
  const bentoCards = document.querySelectorAll('.bento-card');
  bentoCards.forEach(card => {
    card.addEventListener('click', () => {
      const bentoKey = card.dataset.bento || 'all';
      setBentoFilter(bentoKey);
      triggerHaptic('medium');
    });
  });

  // 下层 6 大流程进度 Filter Chips 点击 (流程进度阶段维度)
  const filterChips = document.querySelectorAll('.chip-item');
  filterChips.forEach(chip => {
    chip.addEventListener('click', () => {
      const progressKey = chip.dataset.progress || 'all';
      setProgressFilter(progressKey);
      triggerHaptic('light');
    });
  });
}

function setBentoFilter(bentoKey) {
  state.activeBento = bentoKey;
  state.activeProgress = 'all'; // 切换状态维度时，重置下层阶段为全部

  // 同步 Bento 卡片激活态与状态标签
  document.querySelectorAll('.bento-card').forEach(c => {
    const isActive = c.dataset.bento === bentoKey;
    c.classList.toggle('active', isActive);
    const tag = c.querySelector('.bento-status-tag');
    if (tag) {
      tag.textContent = isActive ? '当前查看' : '点击过滤 ➔';
    }
  });

  // 下层 Chips 同步为全部激活
  document.querySelectorAll('.chip-item').forEach(c => {
    c.classList.toggle('active', c.dataset.progress === 'all');
  });

  renderDashboard();
}

function setProgressFilter(progressKey) {
  state.activeProgress = progressKey;
  state.activeBento = 'all'; // 切换进度阶段时，重置上层 Bento 状态为全部

  // 下层 Chips 激活态
  document.querySelectorAll('.chip-item').forEach(c => {
    c.classList.toggle('active', c.dataset.progress === progressKey);
  });

  // 上层 Bento 卡片重置为第1个激活
  document.querySelectorAll('.bento-card').forEach(c => {
    const isAll = c.dataset.bento === 'all';
    c.classList.toggle('active', isAll);
    const tag = c.querySelector('.bento-status-tag');
    if (tag) {
      tag.textContent = isAll ? '当前查看' : '点击过滤 ➔';
    }
  });

  renderDashboard();
}

// ==================== 4. 数据拉取与统计计算 ====================
async function loadAllData(showLoading = true) {
  const loadingEl = document.getElementById('dashboard-loading');
  if (showLoading && loadingEl) loadingEl.style.display = 'flex';

  try {
    const { applications, stages } = await supabaseService.fetchApplicationsWithStages();
    state.applications = applications || [];
    state.stages = stages || [];

    updateKPIStats();
    renderDashboard();
    renderReviewHall();
    updateReviewBadge();

    // 更新设置中的缓存统计
    const cacheTag = document.getElementById('telemetry-cache-count');
    if (cacheTag) cacheTag.textContent = `已同步 ${state.applications.length} 家企业 / ${state.stages.length} 个环节`;

    // 如果全景时间线正在查看某企业，同步刷新时间线
    if (state.currentTimelineAppId) {
      renderTimelineView(state.currentTimelineAppId);
    } else if (state.applications.length > 0) {
      state.currentTimelineAppId = state.applications[0].id;
      renderTimelineView(state.currentTimelineAppId);
    }

  } catch (err) {
    console.error('拉取数据失败:', err);
    showToast(`⚠️ 同步数据失败: ${err.message}`);
  } finally {
    if (loadingEl) loadingEl.style.display = 'none';
  }
}

// ==========================================================================
// 🚀 求职流程进度分类器 (根据最新环节名称与整体状态精准匹配)
// 无论是否已完成还是待参加，只要属于该流程环节，均归入该分类
// ==========================================================================
function getStageProgressCategory(app, latestStage) {
  // 1. 终止 / 归档
  if (app && (app.overall_status === 'archived' || app.overall_status === 'failed')) return 'terminated';
  if (latestStage && (latestStage.stage_status === 'archived' || latestStage.stage_status === 'failed')) return 'terminated';
  const name = latestStage ? (latestStage.stage_name || '').trim() : (app ? (app.current_stage_name || '') : '');
  if (name.includes('感谢信') || name.includes('终止') || name.includes('未通过') || name.includes('遗憾') || name.includes('淘汰') || name.includes('放弃') || name.includes('结束')) {
    return 'terminated';
  }

  // 2. Offer / 录用
  if (app && app.overall_status === 'offered') return 'offer';
  if (latestStage && latestStage.stage_status === 'offered') return 'offer';
  if (name.includes('Offer') || name.includes('offer') || name.includes('录用') || name.includes('意向') || name.includes('录取') || name.includes('签约') || name.includes('入职')) {
    return 'offer';
  }

  // 3. 笔试 (无论已考还是待考)
  if (name.includes('笔试') || name.includes('机考') || name.includes('机试') || name.includes('编程') || name.includes('代码测试') || name.includes('专业笔试')) {
    return 'written_test';
  }

  // 4. 测评 (无论已测还是待测)
  if (name.includes('测评') || name.includes('性格') || name.includes('认知') || name.includes('综合测') || name.includes('心理测试') || (name.includes('测试') && !name.includes('笔试'))) {
    return 'assessment';
  }

  // 5. 面试 (无论已参加还是待参加，只匹配真正面试环节：一面、二面、终面、HR面、AI面、群面、初试、复试等)
  if (name.includes('面') || name.includes('初试') || name.includes('复试') || name.includes('终审') || name.includes('加试') || name.includes('主管面')) {
    return 'interview';
  }

  // 6. 其他环节 (如网申、投递邀请、资料审核等)
  return 'other';
}

function updateKPIStats() {
  // 仅统计已审核放行（拥有非 pending/ignored 环节）且非归档的投递单
  const validApps = state.applications.filter(app => {
    if (app.overall_status === 'archived' || app.overall_status === 'failed') return false;
    const stages = state.stages.filter(s => s.application_id === app.id && s.stage_status !== 'ignored' && s.stage_status !== 'pending');
    return stages.length > 0;
  });

  const totalAppsCount = validApps.length;
  let todoCount = 0;
  let waitingResultsCount = 0;
  let offerCount = 0;

  validApps.forEach(app => {
    const stages = state.stages
      .filter(s => s.application_id === app.id && s.stage_status !== 'ignored' && s.stage_status !== 'pending')
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

  document.getElementById('stat-total-companies').textContent = totalAppsCount;
  document.getElementById('stat-active-interviews').textContent = todoCount;
  document.getElementById('stat-waiting-results').textContent = waitingResultsCount;
  document.getElementById('stat-offer-count').textContent = offerCount;
}

function updateReviewBadge() {
  const pendingStages = state.stages.filter(s => s.stage_status === 'pending');
  const ignoredStages = state.stages.filter(s => s.stage_status === 'ignored');

  document.getElementById('badge-pending-count').textContent = pendingStages.length;
  document.getElementById('badge-ignored-count').textContent = ignoredStages.length;

  const navBadge = document.getElementById('nav-review-badge');
  if (navBadge) {
    if (pendingStages.length > 0) {
      navBadge.textContent = pendingStages.length;
      navBadge.style.display = 'flex';
    } else {
      navBadge.style.display = 'none';
    }
  }
}

// ==================== 5. 渲染求职全景大厅 (Dashboard) ====================
function renderDashboard() {
  const container = document.getElementById('dashboard-job-list');
  if (!container) return;

  // 0. 如果本机尚未配置凭据，展示优雅的安全连接引导卡片
  if (!supabaseService.getConfig().isConfigured) {
    container.innerHTML = `
      <div class="empty-loading-state" onclick="switchToTab('view-settings')" style="cursor:pointer;background:#FFFFFF;border:1px solid var(--border-porcelain);border-radius:var(--radius-xl);padding:32px 20px;margin-top:12px;box-shadow:var(--shadow-porcelain);">
        <div style="font-size:2.8rem;margin-bottom:8px;">🔐</div>
        <div style="font-size:1.1rem;font-weight:800;color:var(--text-main);margin-bottom:6px;">尚未连接 Supabase 数据库</div>
        <div style="font-size:0.82rem;color:var(--text-sub);text-align:center;line-height:1.6;margin-bottom:14px;">
          OfferPilot 采用本地安全沙盒隐私架构。<br>请点击下方按钮前往<strong>【设置】</strong>填入您的云端凭据。<br><strong>仅需配置一次，手机自动永久保存，无需重复输入！</strong>
        </div>
        <button class="btn-create-header" style="background:var(--accent-emerald);font-size:0.86rem;padding:8px 18px;">前往设置连接 ➔</button>
      </div>
    `;
    return;
  }

  // 1. 严格筛选已审核准入放行（拥有非 pending/ignored 环节）或主动归档的投递单
  const approvedApplications = state.applications.filter(app => {
    const validStages = state.stages.filter(s => s.application_id === app.id && s.stage_status !== 'ignored' && s.stage_status !== 'pending');
    return validStages.length > 0 || app.overall_status === 'archived';
  });

  // 如果没有已准入的求职单，但有待审邮件，展示引导卡片
  if (approvedApplications.length === 0) {
    const pendingCount = state.stages.filter(s => s.stage_status === 'pending').length;
    if (pendingCount > 0) {
      container.innerHTML = `
        <div class="empty-loading-state" onclick="switchToTab('view-review')" style="cursor:pointer;background:#FFFFFF;border:1px solid var(--border-porcelain);border-radius:var(--radius-xl);padding:30px 18px;margin-top:8px;">
          <div style="font-size:2.6rem;margin-bottom:4px;">📬</div>
          <div style="font-size:1.05rem;font-weight:800;color:var(--text-main);">有 ${pendingCount} 封新求职邮件待审核准入</div>
          <div style="font-size:0.8rem;color:var(--text-sub);text-align:center;line-height:1.5;">
            云端 AI 已提取求职通知。<br>请点击前往 <strong>【审核管理】</strong> 放行准入，确认后将自动在此全景建档！
          </div>
          <button class="btn-create-header" style="margin-top:10px;background:var(--accent-emerald);">前往审核大厅 ➔</button>
        </div>
      `;
    } else {
      container.innerHTML = `
        <div class="empty-loading-state">
          <div style="font-size:2.5rem;">🍃</div>
          <span>暂无求职建档记录，点击右上角「＋新建求职」开始</span>
        </div>
      `;
    }
    return;
  }

  // 2. 组装已放行的环节列表
  let list = approvedApplications.map(app => {
    const validStages = state.stages
      .filter(s => s.application_id === app.id && s.stage_status !== 'ignored' && s.stage_status !== 'pending')
      .sort((a, b) => (a.seq || 1) - (b.seq || 1));
    const latestStage = validStages.length > 0 ? validStages[validStages.length - 1] : null;
    const progressCategory = getStageProgressCategory(app, latestStage);
    return { ...app, stages: validStages, latestStage, progressCategory };
  });

  // 3. 搜索过滤
  if (state.searchQuery) {
    list = list.filter(app => {
      const compMatch = (app.company || '').toLowerCase().includes(state.searchQuery);
      const posMatch = (app.position || '').toLowerCase().includes(state.searchQuery);
      const deptMatch = (app.department || '').toLowerCase().includes(state.searchQuery);
      const stageMatch = app.stages.some(s => (s.stage_name || '').toLowerCase().includes(state.searchQuery) || (s.meeting_info || '').toLowerCase().includes(state.searchQuery));
      return compMatch || posMatch || deptMatch || stageMatch;
    });
  }

  // 4. 上层 Bento 状态维度过滤 (全部 / 待办 / 等待结果 / 已录用)
  if (state.activeBento === 'all') {
    // 全部已建档企业：仅过滤掉已归档/已终止的
    if (state.activeProgress !== 'terminated') {
      list = list.filter(app => app.progressCategory !== 'terminated' && app.overall_status !== 'archived');
    }
  } else if (state.activeBento === 'todo') {
    // 待测评/投递/笔试/面试：最新环节为 scheduled
    list = list.filter(app => app.latestStage && app.latestStage.stage_status === 'scheduled');
  } else if (state.activeBento === 'waiting') {
    // 等待结果中：最新环节为 awaiting_result
    list = list.filter(app => app.latestStage && app.latestStage.stage_status === 'awaiting_result');
  } else if (state.activeBento === 'offer') {
    // 已录用：overall_status === 'offered' 或最新环节为 offer
    list = list.filter(app => app.progressCategory === 'offer' || app.overall_status === 'offered');
  }

  // 5. 下层 Filter Chips 流程进度阶段过滤 (全部 / 测评 / 笔试 / 面试 / Offer / 终止)
  if (state.activeProgress === 'assessment') {
    list = list.filter(app => app.progressCategory === 'assessment');
  } else if (state.activeProgress === 'written_test') {
    list = list.filter(app => app.progressCategory === 'written_test');
  } else if (state.activeProgress === 'interview') {
    list = list.filter(app => app.progressCategory === 'interview');
  } else if (state.activeProgress === 'offer') {
    list = list.filter(app => app.progressCategory === 'offer');
  } else if (state.activeProgress === 'terminated') {
    list = list.filter(app => app.progressCategory === 'terminated');
  }

  if (list.length === 0) {
    container.innerHTML = `
      <div class="empty-loading-state">
        <div style="font-size:2.5rem;">🍃</div>
        <span>没有匹配到符合当前筛选条件的企业或岗位</span>
      </div>
    `;
    return;
  }

  let html = '';
  list.forEach(item => {
    const latest = item.latestStage;
    const stageName = latest ? latest.stage_name : (item.current_stage_name || '网申提交');
    const scheduleTime = latest ? (latest.schedule_time || '待定') : '待定';
    const isScheduled = latest && latest.stage_status === 'scheduled';
    const isAwaiting = latest && latest.stage_status === 'awaiting_result';
    const isOffered = item.overall_status === 'offered' || (latest && latest.stage_status === 'offered');

    // Logo Avatar 样式
    let avatarClass = '';
    let avatarLetter = item.company.slice(0, 1);
    if (item.company.includes('阿里') || item.company.toLowerCase().includes('alibaba')) {
      avatarLetter = '阿';
    } else if (item.company.includes('腾讯') || item.company.toLowerCase().includes('tencent')) {
      avatarClass = 'avatar-tencent';
      avatarLetter = '腾';
    } else if (item.company.includes('字节') || item.company.toLowerCase().includes('bytedance')) {
      avatarClass = 'avatar-bytedance';
      avatarLetter = '字';
    }

    // 智能精简时间胶囊文本
    const shortTime = formatShortScheduleTime(scheduleTime);

    // 时间胶囊
    let timePillHtml = '';
    if (isOffered) {
      timePillHtml = `<span class="time-pill-badge pill-green" title="${escapeHtml(scheduleTime)}">🎉 已获 Offer</span>`;
    } else if (isAwaiting) {
      timePillHtml = `<span class="time-pill-badge pill-gray" title="${escapeHtml(scheduleTime)}">🎯 等待结果</span>`;
    } else if (isScheduled) {
      timePillHtml = `<span class="time-pill-badge" title="${escapeHtml(scheduleTime)}">🗓️ ${escapeHtml(shortTime)}</span>`;
    } else {
      timePillHtml = `<span class="time-pill-badge pill-gray" title="${escapeHtml(stageName)}">${escapeHtml(shortTime)}</span>`;
    }

    // Stepper 链路 (简历筛选 -> 笔试 -> 一面 -> 二面 -> HR面 -> 发Offer)
    const stepperHtml = buildStepperHtml(item.stages, stageName, isOffered);

    html += `
      <div class="porcelain-job-card" onclick="window.viewCompanyTimeline('${item.id}')">
        <div class="card-top-info">
          <div class="company-brand-group">
            <div class="company-logo-avatar ${avatarClass}">${avatarLetter}</div>
            <div class="company-titles">
              <div class="company-name-bold" title="${escapeHtml(item.company)}">${escapeHtml(item.company)}</div>
              <div class="company-pos-sub" title="${escapeHtml(item.position || '校招岗位')}">${escapeHtml(item.position || '校招岗位')}</div>
              <div class="company-stage-sub">
                ${item.department ? `<span>${escapeHtml(item.department)}</span> · ` : ''}
                <span class="stage-tag-mini">${escapeHtml(stageName)}</span>
              </div>
            </div>
          </div>
          ${timePillHtml}
        </div>

        <!-- 水平 Stepper 求职链路 -->
        <div class="stepper-pipeline-container">
          ${stepperHtml}
        </div>

        <!-- 底部候选人与快捷操作 -->
        <div class="card-bottom-row" onclick="event.stopPropagation()">
          <span class="card-candidate-name">求职时序: 第 ${item.stages.length} 轮推进</span>
          <div class="card-actions-right">
            ${isScheduled ? `
              <button class="btn-card-check" title="标为已参加 (进入等待结果)" onclick="window.markStageComplete('${latest.id}')">
                ✓
              </button>
            ` : ''}
            <button class="btn-card-more" onclick="window.viewCompanyTimeline('${item.id}')">
              查看档案 ➔
            </button>
          </div>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
}

// 渲染水平 Stepper 步进条 (100% 依据该企业真实已准入的环节动态生成)
function buildStepperHtml(stages, currentStageName, isOffered) {
  // 1. 严格筛选该企业已准入放行的真实有效环节，按 seq 升序排列
  const validStages = (stages || [])
    .filter(s => s.stage_status !== 'ignored' && s.stage_status !== 'pending')
    .sort((a, b) => (a.seq || 1) - (b.seq || 1));

  // 2. 如果没有任何有效环节，默认展示单个「网申投递」节点
  if (validStages.length === 0) {
    return `
      <div class="stepper-track-row single-node">
        <div class="stepper-node-item active">
          <div class="stepper-dot active">●</div>
          <span class="stepper-label">${escapeHtml(currentStageName || '网申投递')}</span>
        </div>
      </div>
    `;
  }

  // 3. 计算最后一个进行中节点的索引 (最新环节)
  const lastIndex = validStages.length - 1;

  let nodesHtml = '';
  validStages.forEach((stg, idx) => {
    const isLatest = idx === lastIndex;
    const isScheduled = stg.stage_status === 'scheduled';
    const isAwaiting = stg.stage_status === 'awaiting_result';
    const isStageOffered = stg.stage_status === 'offered' || isOffered;

    let dotClass = 'done';
    let dotContent = '✓';
    let itemClass = '';

    if (isStageOffered) {
      dotClass = 'done';
      dotContent = '✓';
      if (isLatest) {
        dotClass = 'active';
        dotContent = '🎉';
        itemClass = 'active';
      }
    } else if (isLatest) {
      if (isScheduled || isAwaiting) {
        dotClass = 'active';
        dotContent = '●';
        itemClass = 'active';
      } else {
        dotClass = 'done';
        dotContent = '✓';
      }
    } else {
      // 历史环节统一打勾
      dotClass = 'done';
      dotContent = '✓';
    }

    // 智能精简标签名称 (超过 5 个字自动精简，悬浮/点击显示全称)
    const rawName = stg.stage_name || `第${idx + 1}轮`;
    const shortName = rawName.length > 5 ? rawName.slice(0, 4) + '…' : rawName;

    nodesHtml += `
      <div class="stepper-node-item ${itemClass}">
        <div class="stepper-dot ${dotClass}">${dotContent}</div>
        <span class="stepper-label" title="${escapeHtml(rawName)}">${escapeHtml(shortName)}</span>
      </div>
    `;
  });

  const isSingle = validStages.length === 1;
  return `<div class="stepper-track-row ${isSingle ? 'single-node' : ''}">${nodesHtml}</div>`;
}

// ==================== 6. 邮件待审门禁大厅 (Review Gatekeeper) ====================
window.switchReviewTab = function(subtab) {
  state.reviewSubtab = subtab;
  document.getElementById('seg-btn-pending').classList.toggle('active', subtab === 'pending');
  document.getElementById('seg-btn-ignored').classList.toggle('active', subtab === 'ignored');

  document.getElementById('review-pending-list').style.display = subtab === 'pending' ? 'flex' : 'none';
  document.getElementById('review-ignored-list').style.display = subtab === 'ignored' ? 'flex' : 'none';
  triggerHaptic('light');
};

function renderReviewHall() {
  const pendingContainer = document.getElementById('review-pending-list');
  const ignoredContainer = document.getElementById('review-ignored-list');

  const pendingStages = state.stages.filter(s => s.stage_status === 'pending');
  const ignoredStages = state.stages.filter(s => s.stage_status === 'ignored');

  // 渲染待审核卡片
  if (pendingStages.length === 0) {
    pendingContainer.innerHTML = `
      <div class="empty-loading-state">
        <div style="font-size:2.5rem;">🎉</div>
        <span>待审大厅已全部清空，所有通知已放行！</span>
      </div>
    `;
  } else {
    pendingContainer.innerHTML = pendingStages.map(stage => {
      const app = state.applications.find(a => a.id === stage.application_id);
      const company = app ? app.company : '未知企业';
      return `
        <div class="porcelain-review-card" onclick="window.openAIDrawer('${stage.id}')">
          <div class="review-card-title">${escapeHtml(company)} · ${escapeHtml(stage.stage_name)}</div>
          <div class="review-card-subtitle">约定时间: ${escapeHtml(stage.schedule_time || '待定')}</div>
          <div>
            <span class="ai-tag-pill">✨ DeepSeek AI 解析</span>
          </div>
        </div>
      `;
    }).join('');
  }

  // 渲染已忽略卡片
  if (ignoredStages.length === 0) {
    ignoredContainer.innerHTML = `
      <div class="empty-loading-state">
        <div style="font-size:2.5rem;">📦</div>
        <span>暂无已忽略的邮件记录</span>
      </div>
    `;
  } else {
    ignoredContainer.innerHTML = ignoredStages.map(stage => {
      const app = state.applications.find(a => a.id === stage.application_id);
      const company = app ? app.company : '未知企业';
      return `
        <div class="porcelain-review-card" onclick="window.openAIDrawer('${stage.id}')" style="opacity:0.8;">
          <div class="review-card-title">${escapeHtml(company)} · ${escapeHtml(stage.stage_name)}</div>
          <div class="review-card-subtitle">已忽略归档 · 点击可恢复</div>
        </div>
      `;
    }).join('');
  }
}

// 批量放行全部待审
window.batchApprovePending = async function() {
  const pendingStages = state.stages.filter(s => s.stage_status === 'pending');
  if (pendingStages.length === 0) {
    showToast('📬 当前没有待审核的邮件');
    return;
  }

  triggerHaptic('heavy');
  try {
    const ids = pendingStages.map(s => s.id);
    await supabaseService.batchApproveStages(ids);
    showToast(`⚡️ 成功一键放行 ${ids.length} 封求职通知！`);
    loadAllData(false);
  } catch (err) {
    showToast(`⚠️ 批量放行失败: ${err.message}`);
  }
};

// ==================== 7. DeepSeek AI 详情抽屉 (BottomSheet) ====================
window.openAIDrawer = function(stageId) {
  const stage = state.stages.find(s => s.id === stageId);
  if (!stage) return;
  state.currentDrawerStageId = stageId;

  const app = state.applications.find(a => a.id === stage.application_id);
  const company = app ? app.company : '企业求职通知';

  // 1. AI 提炼要点 (解析 notes 或 raw_subject)
  const aiContainer = document.getElementById('drawer-ai-bullet-points');
  const notesText = stage.notes || '云端 DeepSeek AI 自动提取通知要点';
  const lines = notesText.split('\n').filter(l => l.trim().length > 0);
  
  let bulletHtml = '';
  if (lines.length > 0) {
    bulletHtml = lines.map(line => `
      <div class="ai-bullet-item">
        <span class="ai-bullet-dot"></span>
        <span>${escapeHtml(line)}</span>
      </div>
    `).join('');
  } else {
    bulletHtml = `
      <div class="ai-bullet-item">
        <span class="ai-bullet-dot"></span>
        <span>${escapeHtml(company)} 发送的 ${escapeHtml(stage.stage_name)} 通知</span>
      </div>
      <div class="ai-bullet-item">
        <span class="ai-bullet-dot"></span>
        <span>约定时间: ${escapeHtml(stage.schedule_time || '待定')}</span>
      </div>
    `;
  }
  aiContainer.innerHTML = bulletHtml;

  // 2. 邮件原文参考
  const excerptEl = document.getElementById('drawer-email-raw-snippet');
  excerptEl.textContent = stage.raw_subject ? `主题: ${stage.raw_subject}\n\n${notesText}` : '邮件正文已结构化解析至上方要点';

  // 3. 腾讯会议代码凭据
  const meetingPill = document.getElementById('drawer-meeting-pill');
  const meetingText = document.getElementById('drawer-meeting-text');
  if (stage.meeting_info && stage.meeting_info.trim().length > 0) {
    meetingText.textContent = stage.meeting_info;
    meetingPill.style.display = 'flex';
  } else {
    meetingPill.style.display = 'none';
  }

  // 打开抽屉
  const overlay = document.getElementById('ai-drawer-overlay');
  overlay.classList.add('active');
  state.isDrawerOpen = true;
  triggerHaptic('medium');
};

window.closeAIDrawer = function(e) {
  if (e && e.target && e.target.id !== 'ai-drawer-overlay') return;
  window.closeAIDrawerDirect();
};

window.closeAIDrawerDirect = function() {
  const overlay = document.getElementById('ai-drawer-overlay');
  overlay.classList.remove('active');
  state.isDrawerOpen = false;
  triggerHaptic('light');
};

// 抽屉内放行
window.approveCurrentDrawerStage = async function() {
  if (!state.currentDrawerStageId) return;
  triggerHaptic('heavy');
  try {
    await supabaseService.updateStageStatus(state.currentDrawerStageId, 'scheduled');
    showToast('⚡️ 准入成功！已加入待办日程');
    window.closeAIDrawerDirect();
    loadAllData(false);
  } catch (err) {
    showToast(`⚠️ 放行失败: ${err.message}`);
  }
};

// 抽屉内忽略
window.ignoreCurrentDrawerStage = async function() {
  if (!state.currentDrawerStageId) return;
  triggerHaptic('medium');
  try {
    await supabaseService.updateStageStatus(state.currentDrawerStageId, 'ignored');
    showToast('📦 已移入已忽略归档');
    window.closeAIDrawerDirect();
    loadAllData(false);
  } catch (err) {
    showToast(`⚠️ 操作失败: ${err.message}`);
  }
};

// 复制会议号
window.copyMeetingCredentials = function() {
  const text = document.getElementById('drawer-meeting-text').textContent;
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => {
      showToast('📋 会议凭据已成功复制到剪贴板！');
      triggerHaptic('light');
    });
  } else {
    showToast('📋 会议代码: ' + text);
  }
};

// ==================== 8. 企业求职全景时间线 (Company Timeline) ====================
window.viewCompanyTimeline = function(appId) {
  state.currentTimelineAppId = appId;
  renderTimelineView(appId);
  switchToTab('view-timeline');
  triggerHaptic('light');
};

function renderTimelineView(appId) {
  // 1. 严格筛选已审核放行准入且未归档的有效已建档企业
  const approvedApps = state.applications.filter(app => {
    const validStages = state.stages.filter(s => s.application_id === app.id && s.stage_status !== 'ignored' && s.stage_status !== 'pending');
    return validStages.length > 0 && app.overall_status !== 'archived';
  });

  // 2. 根据全景搜索词过滤
  let visibleApps = approvedApps;
  if (state.timelineSearchQuery) {
    const q = state.timelineSearchQuery;
    visibleApps = approvedApps.filter(app => {
      const matchComp = (app.company || '').toLowerCase().includes(q);
      const matchPos = (app.position || '').toLowerCase().includes(q);
      const matchDept = (app.department || '').toLowerCase().includes(q);
      return matchComp || matchPos || matchDept;
    });
  }

  // 3. 渲染顶部企业横向滑动选择栏 (仅展示搜索匹配的已建档企业)
  const chipsContainer = document.getElementById('timeline-company-chips');
  if (chipsContainer) {
    if (visibleApps.length === 0) {
      chipsContainer.innerHTML = `<span style="font-size:0.76rem;color:var(--text-muted);padding:6px 0;">未搜索到匹配的已建档企业</span>`;
    } else {
      chipsContainer.innerHTML = visibleApps.map(a => {
        const isSelected = a.id === (appId || (visibleApps[0] ? visibleApps[0].id : ''));
        return `
          <button class="timeline-chip-item ${isSelected ? 'active' : ''}" onclick="window.viewCompanyTimeline('${a.id}')">
            <span>${escapeHtml(a.company)}</span>
          </button>
        `;
      }).join('');
    }
  }

  // 4. 定位当前展示的企业
  let targetApp = visibleApps.find(a => a.id === appId);
  if (!targetApp && visibleApps.length > 0) {
    targetApp = visibleApps[0];
  }

  if (!targetApp) {
    const nodesContainer = document.getElementById('timeline-nodes-container');
    if (nodesContainer) {
      nodesContainer.innerHTML = `
        <div class="empty-loading-state">
          <div style="font-size:2.5rem;">🏢</div>
          <span>${approvedApps.length === 0 ? '暂无已建档的企业档案，请先在控制台新建求职或放行邮件' : '没有匹配到相关已建档企业'}</span>
        </div>
      `;
    }
    document.getElementById('timeline-company-name').textContent = '未选择企业';
    document.getElementById('timeline-header-avatar').textContent = '企';
    document.getElementById('timeline-position-name').textContent = '投递岗位: 待定';
    document.getElementById('timeline-stage-count').textContent = '共 0 轮通知';
    document.getElementById('timeline-status-badge').textContent = '无数据';
    return;
  }

  state.currentTimelineAppId = targetApp.id;

  // 过滤掉已忽略环节与未审核环节，按 seq 倒序展示时间轴
  const appStages = state.stages
    .filter(s => s.application_id === targetApp.id && s.stage_status !== 'ignored' && s.stage_status !== 'pending')
    .sort((a, b) => (b.seq || 1) - (a.seq || 1));
  const latestStage = appStages[0];

  // 企业专属 Logo 图标
  let companyIcon = '🏢';
  if (targetApp.company.includes('腾讯') || targetApp.company.toLowerCase().includes('tencent')) companyIcon = '🐧';
  else if (targetApp.company.includes('阿里') || targetApp.company.toLowerCase().includes('alibaba')) companyIcon = '🐱';
  else if (targetApp.company.includes('字节') || targetApp.company.toLowerCase().includes('bytedance')) companyIcon = '⚡️';
  else if (targetApp.company.includes('美团')) companyIcon = '🦘';
  else if (targetApp.company.includes('银行') || targetApp.company.includes('证券') || targetApp.company.includes('期货')) companyIcon = '🏦';

  document.getElementById('timeline-company-name').textContent = targetApp.company;
  document.getElementById('timeline-header-avatar').textContent = companyIcon;
  document.getElementById('timeline-position-name').textContent = targetApp.position || '校招工程师';

  const statusBadge = document.getElementById('timeline-status-badge');
  if (latestStage) {
    if (latestStage.stage_status === 'scheduled') {
      statusBadge.textContent = `⏳ ${latestStage.stage_name} 待参加`;
    } else if (latestStage.stage_status === 'awaiting_result') {
      statusBadge.textContent = `🎯 ${latestStage.stage_name} 等待结果`;
    } else if (latestStage.stage_status === 'offered' || targetApp.overall_status === 'offered') {
      statusBadge.textContent = `🎉 已斩获 录用 Offer`;
    } else if (latestStage.stage_status === 'pending') {
      statusBadge.textContent = `📬 新邮件待审核`;
    } else {
      statusBadge.textContent = `最新: ${latestStage.stage_name}`;
    }
  } else {
    statusBadge.textContent = '暂无已准入环节';
  }

  // 渲染高保真气泡卡片时间轴节点
  const nodesContainer = document.getElementById('timeline-nodes-container');
  if (appStages.length === 0) {
    nodesContainer.innerHTML = `
      <div class="empty-loading-state">
        <div style="font-size:2.5rem;">🗓️</div>
        <span>该企业暂无已准入的推进环节</span>
      </div>
    `;
    return;
  }

  nodesContainer.innerHTML = appStages.map((stg, idx) => {
    const isLatestActive = idx === 0 && stg.stage_status === 'scheduled';
    const isAwaiting = stg.stage_status === 'awaiting_result';
    const isOffered = stg.stage_status === 'offered';

    let badgeText = '已通过';
    let badgeClass = 'badge-passed';
    if (isLatestActive) {
      badgeText = '将参加';
      badgeClass = 'badge-upcoming';
    } else if (isAwaiting) {
      badgeText = '等待结果';
      badgeClass = 'badge-upcoming';
    } else if (isOffered) {
      badgeText = '已录用';
      badgeClass = 'badge-passed';
    }

    // 格式化时间
    const timeDisplay = stg.schedule_time || '待定';

    return `
      <div class="timeline-bubble-item">
        <!-- 双同心圆拟物发光节点 -->
        <div class="timeline-concentric-dot ${isLatestActive ? 'dot-active' : ''}"></div>

        <!-- 气泡对话框白瓷卡片 -->
        <div class="bubble-porcelain-card ${isLatestActive ? 'card-active-luminous' : ''}" onclick="window.openEditModalForCurrent('${stg.id}')">
          <div class="bubble-top-row">
            <span class="bubble-seq-text">Stage ${stg.seq || (appStages.length - idx)}</span>
            <span class="bubble-status-badge ${badgeClass}">${badgeText}</span>
          </div>

          <div class="bubble-stage-title">${escapeHtml(stg.stage_name)}</div>
          <div class="bubble-time-text">🗓️ ${escapeHtml(timeDisplay)}</div>

          ${stg.meeting_info ? `
            <div class="bubble-meeting-slot" onclick="event.stopPropagation()">
              <span class="meeting-info-text" title="${escapeHtml(stg.meeting_info)}">👥 ${escapeHtml(stg.meeting_info)}</span>
              <div class="meeting-btn-group">
                <button class="btn-mini-pill btn-mini-copy" onclick="window.copyText('${escapeHtml(stg.meeting_info)}')">复制</button>
                ${isLatestActive ? `
                  <button class="btn-mini-pill btn-mini-action" onclick="window.markStageComplete('${stg.id}')">标为已参加</button>
                ` : ''}
              </div>
            </div>
          ` : `
            ${isLatestActive ? `
              <div style="display:flex;justify-content:flex-end;margin-top:6px;" onclick="event.stopPropagation()">
                <button class="btn-mini-pill btn-mini-action" onclick="window.markStageComplete('${stg.id}')">✓ 标为已参加</button>
              </div>
            ` : ''}
          `}
        </div>
      </div>
    `;
  }).join('');
}

window.copyText = function(text) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => {
      showToast('📋 已复制到剪贴板！');
      triggerHaptic('light');
    });
  } else {
    showToast('📋 文本: ' + text);
  }
};

// 快速标记已参加
window.markStageComplete = async function(stageId) {
  triggerHaptic('heavy');
  try {
    await supabaseService.updateStageStatus(stageId, 'awaiting_result');
    showToast('✅ 已标为已参加，流转为等待官方结果！');
    loadAllData(false);
  } catch (err) {
    showToast(`⚠️ 操作失败: ${err.message}`);
  }
};

// ==================== 9. 手动建档与推进新环节 ====================
window.openManualModalForCurrent = function() {
  const app = state.applications.find(a => a.id === state.currentTimelineAppId);
  openManualModal(app ? app.company : '');
};

function openManualModal(defaultCompany = '') {
  document.getElementById('m-company').value = defaultCompany;
  document.getElementById('m-dept').value = '';
  document.getElementById('m-position').value = '';
  document.getElementById('m-stage-name').value = '';
  document.getElementById('m-schedule-time').value = '';
  document.getElementById('m-meeting').value = '';
  document.getElementById('manual-stage-modal').style.display = 'flex';
  triggerHaptic('light');
}

window.closeManualModal = function() {
  document.getElementById('manual-stage-modal').style.display = 'none';
};

window.setMPreset = function(name) {
  document.getElementById('m-stage-name').value = name;
  triggerHaptic('light');
};

window.submitManualStage = async function() {
  const company = document.getElementById('m-company').value.trim();
  const dept = document.getElementById('m-dept').value.trim();
  const position = document.getElementById('m-position').value.trim();
  const stageName = document.getElementById('m-stage-name').value.trim();
  const scheduleTime = document.getElementById('m-schedule-time').value.trim();
  const meeting = document.getElementById('m-meeting').value.trim();
  const statusRadio = document.querySelector('input[name="m-status-radio"]:checked');
  const stageStatus = statusRadio ? statusRadio.value : 'scheduled';

  if (!company || !stageName) {
    showToast('⚠️ 公司名称与推进环节类型为必填项');
    return;
  }

  triggerHaptic('heavy');
  try {
    await supabaseService.createApplicationWithStage(
      { company, department: dept, position },
      { stage_name: stageName, stage_status: stageStatus, schedule_time: scheduleTime, meeting_info: meeting }
    );
    showToast(`✨ 成功为【${company}】建档并推进【${stageName}】！`);
    window.closeManualModal();
    loadAllData(false);
  } catch (err) {
    showToast(`⚠️ 保存失败: ${err.message}`);
  }
};

// ==================== 10. 全字段自由修正弹窗 ====================
window.openEditModalForCurrent = function(targetStageId) {
  const app = state.applications.find(a => a.id === state.currentTimelineAppId);
  if (!app) return;

  // 1. 精确获取目标环节 (优先匹配传入的 targetStageId，否则匹配当前最新有效环节)
  let targetStage = null;
  if (targetStageId) {
    targetStage = state.stages.find(s => s.id === targetStageId);
  }
  if (!targetStage) {
    const validStages = state.stages
      .filter(s => s.application_id === app.id && s.stage_status !== 'ignored' && s.stage_status !== 'pending')
      .sort((a, b) => (b.seq || 1) - (a.seq || 1));
    targetStage = validStages[0] || state.stages.find(s => s.application_id === app.id);
  }

  document.getElementById('e-stage-id').value = targetStage ? targetStage.id : '';
  document.getElementById('e-app-id').value = app.id;
  document.getElementById('e-company').value = app.company;
  document.getElementById('e-dept').value = app.department || '';
  document.getElementById('e-position').value = app.position || '';

  // 2. 精确回显当前环节的名字、时间、会议与状态
  document.getElementById('e-stage-name').value = targetStage ? targetStage.stage_name : '';
  document.getElementById('e-schedule-time').value = targetStage ? (targetStage.schedule_time || '') : '';
  document.getElementById('e-meeting').value = targetStage ? (targetStage.meeting_info || '') : '';
  document.getElementById('e-notes').value = targetStage ? (targetStage.notes || '') : '';

  const currentStatus = targetStage ? targetStage.stage_status : 'scheduled';
  const targetRadio = document.querySelector(`input[name="e-status-radio"][value="${currentStatus}"]`);
  if (targetRadio) targetRadio.checked = true;

  document.getElementById('edit-stage-modal').style.display = 'flex';
  triggerHaptic('light');
};

window.closeEditModal = function() {
  document.getElementById('edit-stage-modal').style.display = 'none';
};

window.setEPreset = function(name) {
  document.getElementById('e-stage-name').value = name;
  triggerHaptic('light');
};

window.submitEditStage = async function() {
  const stageId = document.getElementById('e-stage-id').value;
  const appId = document.getElementById('e-app-id').value;
  const company = document.getElementById('e-company').value.trim();
  const dept = document.getElementById('e-dept').value.trim();
  const position = document.getElementById('e-position').value.trim();
  const stageName = document.getElementById('e-stage-name').value.trim();
  const scheduleTime = document.getElementById('e-schedule-time').value.trim();
  const meeting = document.getElementById('e-meeting').value.trim();
  const notes = document.getElementById('e-notes').value.trim();
  const statusRadio = document.querySelector('input[name="e-status-radio"]:checked');
  const stageStatus = statusRadio ? statusRadio.value : 'scheduled';

  if (!stageName) {
    showToast('⚠️ 环节名称不能为空');
    return;
  }

  triggerHaptic('heavy');
  try {
    // 检查是否为当前最新环节，是才联动主表的 current_stage_name
    const appStages = state.stages
      .filter(s => s.application_id === appId && s.stage_status !== 'ignored' && s.stage_status !== 'pending')
      .sort((a, b) => (b.seq || 1) - (a.seq || 1));
    const isLatest = appStages.length > 0 && appStages[0].id === stageId;

    const appUpdateData = { company, department: dept, position };
    if (isLatest) {
      appUpdateData.current_stage_name = stageName;
    }

    await supabaseService.updateStageAndApplication(
      stageId,
      appId,
      { stage_name: stageName, stage_status: stageStatus, schedule_time: scheduleTime, meeting_info: meeting, notes },
      appUpdateData
    );
    showToast(`💾 已成功修正【${stageName}】环节信息！`);
    window.closeEditModal();
    loadAllData(false);
  } catch (err) {
    showToast(`⚠️ 修正失败: ${err.message}`);
  }
};

window.deleteStageFromEdit = async function() {
  const stageId = document.getElementById('e-stage-id').value;
  if (!stageId) return;
  if (!confirm('确定要安全删除当前求职环节吗？')) return;

  triggerHaptic('heavy');
  try {
    await supabaseService.deleteStage(stageId);
    showToast('🗑️ 环节已成功删除并回滚');
    window.closeEditModal();
    loadAllData(false);
  } catch (err) {
    showToast(`⚠️ 删除失败: ${err.message}`);
  }
};

// ==================== 11. 设置中心与遥测 ====================
function initSettings() {
  const cfg = supabaseService.getConfig();
  const urlInput = document.getElementById('cfg-supabase-url');
  const keyInput = document.getElementById('cfg-supabase-key');
  if (urlInput) urlInput.value = cfg.url;
  if (keyInput) keyInput.value = cfg.key;

  // 初始化触感震动开关状态与实时切换监听
  const chkHaptic = document.getElementById('chk-haptic-feedback');
  if (chkHaptic) {
    const isHapticEnabled = localStorage.getItem('offerpilot_haptic') !== 'false';
    chkHaptic.checked = isHapticEnabled;

    chkHaptic.addEventListener('change', (e) => {
      const enabled = e.target.checked;
      localStorage.setItem('offerpilot_haptic', enabled ? 'true' : 'false');
      if (enabled) {
        triggerHaptic('medium');
        showToast('📳 已开启触感微震动');
      } else {
        showToast('🔇 已关闭触感微震动');
      }
    });
  }
}

window.testSupabaseConnection = async function() {
  const url = document.getElementById('cfg-supabase-url').value.trim();
  const key = document.getElementById('cfg-supabase-key').value.trim();
  const statusBox = document.getElementById('cfg-test-status');

  try {
    statusBox.className = 'config-feedback-box';
    statusBox.style.display = 'block';
    statusBox.textContent = '⚡️ 正在测试连通性...';
    await supabaseService.testConnection(url, key);
    statusBox.className = 'config-feedback-box success';
    statusBox.textContent = '✅ Supabase 云数据库连接成功！REST 与 RLS 响应正常';
    triggerHaptic('medium');
  } catch (err) {
    statusBox.className = 'config-feedback-box error';
    statusBox.textContent = `❌ ${err.message}`;
    triggerHaptic('heavy');
  }
};

window.saveSupabaseConfig = function() {
  const url = document.getElementById('cfg-supabase-url').value.trim();
  const key = document.getElementById('cfg-supabase-key').value.trim();

  if (!url || !key) {
    showToast('⚠️ Project URL 与 Anon Key 均不能为空');
    return;
  }

  supabaseService.saveConfig(url, key);
  showToast('💾 凭据已安全持久化至本机沙盒，正在同步数据...');
  triggerHaptic('heavy');
  switchToTab('view-dashboard');
  loadAllData(true);
};

window.clearSupabaseConfig = function() {
  if (!confirm('确定要清除本机保存的 Supabase 凭据并退出连接吗？')) return;
  supabaseService.clearConfig();
  
  const urlInput = document.getElementById('cfg-supabase-url');
  const keyInput = document.getElementById('cfg-supabase-key');
  if (urlInput) urlInput.value = '';
  if (keyInput) keyInput.value = '';

  const statusBox = document.getElementById('cfg-test-status');
  if (statusBox) statusBox.style.display = 'none';

  state.applications = [];
  state.stages = [];
  updateKPIStats();
  renderDashboard();
  renderReviewHall();
  updateReviewBadge();

  showToast('🔒 已安全清除本机凭据');
  triggerHaptic('medium');
  switchToTab('view-dashboard');
};

function initRealtimeTelemetry() {
  supabaseService.onStatusChange((connected) => {
    const dot = document.getElementById('realtime-dot');
    const txt = document.getElementById('realtime-text');
    if (dot && txt) {
      if (connected) {
        dot.style.background = 'var(--accent-emerald)';
        txt.textContent = 'Realtime 实时长连接正常';
      } else {
        dot.style.background = 'var(--accent-rose)';
        txt.textContent = '未连接或重连中...';
      }
    }
  });
}

// ==================== 12. 全局 Toast 提示 ====================
function showToast(msg) {
  const container = document.getElementById('app-toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'app-toast';
  toast.innerHTML = `<span>${msg}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-10px) scale(0.9)';
    toast.style.transition = 'all 0.25s ease';
    setTimeout(() => toast.remove(), 250);
  }, 2600);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatShortScheduleTime(text) {
  if (!text || text === '待定') return '待定';
  const str = String(text).trim();

  // 1. 匹配标准 YYYY-MM-DD 日期
  const dateMatch = str.match(/\d{4}-\d{2}-\d{2}/);
  if (dateMatch) {
    if (str.includes('截止')) return `${dateMatch[0]} 截止`;
    return dateMatch[0];
  }

  // 2. 匹配 MM-DD 日期或时间
  const shortDateMatch = str.match(/\d{1,2}[月/.-]\d{1,2}/);
  if (shortDateMatch) {
    return shortDateMatch[0];
  }

  // 3. 超过 10 个字符截断加省略号
  if (str.length > 10) {
    return str.slice(0, 9) + '…';
  }
  return str;
}

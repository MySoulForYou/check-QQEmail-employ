/**
 * OfferPilot Android App - 核心移动端业务引擎与状态机
 * 1:1 对齐网页端流转逻辑，严格实现 Warm Milk-Tea 瓷感视觉与微动效
 */

import { supabaseService } from './supabase.js';
import { triggerHaptic } from './haptics.js';
import { notificationService } from './notifications.js';

// ==================== 时间与日期辅助解析 ====================
function parseScheduleDate(value) {
  const matched = String(value || '').trim().match(/(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})(?:日)?(?:\s+(\d{1,2}):(\d{2}))?/);
  if (!matched) return null;
  const date = new Date(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3]), Number(matched[4] || 0), Number(matched[5] || 0));
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatCalendarKey(date) {
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// ==================== 全局状态管理 ====================
const state = {
  applications: [],
  stages: [],
  recruitmentEvents: [],
  recruitmentEventsError: '',
  recruitmentEventFilter: 'planned',
  recruitmentEventQuery: '',
  activeBento: 'all',        // 'all' | 'todo' | 'waiting' | 'offer' (上层待办/结果状态维度)
  activeProgress: 'all',     // 'all' | 'assessment' | 'written_test' | 'interview' | 'offer' | 'terminated' (下层当前流程进度阶段维度)
  searchQuery: '',
  timelineSearchQuery: '',
  dashboardScrollY: 0,       // 控制台精准滚动位置记忆 (px)
  reviewSubtab: 'pending',
  currentTimelineAppId: null,
  currentDrawerStageId: null,
  isDrawerOpen: false,
  urgentBannerExpanded: false,
  calendarCursor: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  selectedCalendarKey: formatCalendarKey(new Date())
};

// ==================== 1. 初始化入口 ====================
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initNavigation();
  initSearchAndFilters();
  initSettings();
  initRealtimeTelemetry();
  notificationService.init();
  
  // 首次拉取数据或展示配置指引
  const cfg = supabaseService.getConfig();
  if (cfg.isConfigured) {
    supabaseService.initRealtime();
    loadAllData();
  } else {
    // 手机端首次打开未配置时，在大厅展示安全连接引导
    renderDashboard();
    renderUrgentBanner();
    renderCalendar();
    renderRecruitmentEvents();
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
    // 切回控制台：无感恢复到上次浏览的精确坐标并刷新紧急通报栏
    renderUrgentBanner();
    requestAnimationFrame(() => {
      window.scrollTo({
        top: state.dashboardScrollY || 0,
        behavior: 'instant'
      });
    });
  } else if (tabId === 'view-calendar') {
    // 切换到求职日历
    renderCalendar();
    window.scrollTo({ top: 0, behavior: 'instant' });
  } else if (tabId === 'view-events') {
    renderRecruitmentEvents();
    window.scrollTo({ top: 0, behavior: 'instant' });
  } else {
    // 切换到全景时间、待审大厅或设置时：顶部对齐
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
}

window.switchToTab = switchToTab;

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
    const { applications, stages, recruitmentEvents, recruitmentEventsError } = await supabaseService.fetchApplicationsWithStages();
    state.applications = applications || [];
    state.stages = stages || [];
    state.recruitmentEvents = recruitmentEvents || [];
    state.recruitmentEventsError = recruitmentEventsError || '';

    updateKPIStats();
    renderDashboard();
    renderUrgentBanner();
    renderCalendar();
    renderRecruitmentEvents();
    renderReviewHall();
    updateReviewBadge();

    // 自动同步本地系统定时提醒
    notificationService.syncScheduledStages(state.stages, state.applications, parseScheduleDate, getScheduleType);

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

function getScheduleType(stage) {
  const explicit = String(stage?.schedule_type || '').toLowerCase();
  if (explicit === 'start' || explicit === 'deadline') return explicit;
  const time = String(stage?.schedule_time || '').trim();
  if (!time || time === '待定') return 'unknown';
  const name = String(stage?.stage_name || '');
  if (/(面试|一面|二面|终面|HR面|宣讲)/i.test(name)) return 'start';
  if (/(测评|材料|提交|网申|笔试)/.test(name)) return 'deadline';
  return 'unknown';
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

  list.sort((a, b) => Number(Boolean(b.is_focused)) - Number(Boolean(a.is_focused)));

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

    const scheduleType = getScheduleType(latest);
    const scheduleVerb = scheduleType === 'deadline' ? '截止' : scheduleType === 'start' ? '开始' : '';

    // 时间胶囊
    let timePillHtml = '';
    if (isOffered) {
      timePillHtml = `<span class="time-pill-badge pill-green" title="${escapeHtml(scheduleTime)}">🎉 已获 Offer</span>`;
    } else if (isAwaiting) {
      timePillHtml = `<span class="time-pill-badge pill-gray" title="${escapeHtml(scheduleTime)}">🎯 等待结果</span>`;
    } else if (isScheduled) {
      const verbTag = scheduleVerb ? `<span style="font-weight:800;opacity:0.9;">[${scheduleVerb}]</span> ` : '';
      const badgeStyle = scheduleType === 'deadline' ? 'pill-rose' : 'pill-indigo';
      timePillHtml = `<span class="time-pill-badge ${badgeStyle}" title="${escapeHtml(scheduleTime)}">🗓️ ${verbTag}${escapeHtml(shortTime)}</span>`;
    } else {
      timePillHtml = `<span class="time-pill-badge pill-gray" title="${escapeHtml(stageName)}">${escapeHtml(shortTime)}</span>`;
    }

    // 检查并列待办环节 (除了 latest 之外还有处于 scheduled 的环节)
    const otherScheduledStages = item.stages.filter(s => s.id !== (latest ? latest.id : null) && s.stage_status === 'scheduled');
    const parallelNoticeHtml = otherScheduledStages.length > 0
      ? `<div style="font-size:0.72rem;color:var(--accent-rose);margin:4px 0 2px 0;font-weight:700;display:flex;align-items:center;gap:4px;">
          <span>⚡ 并列待办:</span>
          <span>${escapeHtml(otherScheduledStages.map(s => s.stage_name).join('、'))}</span>
        </div>`
      : '';

    // Stepper 链路 (简历筛选 -> 笔试 -> 一面 -> 二面 -> HR面 -> 发Offer)
    const stepperHtml = buildStepperHtml(item.stages, stageName, isOffered);

    html += `
      <div class="porcelain-job-card${item.is_focused ? ' is-focused' : ''}" onclick="window.viewCompanyTimeline('${item.id}')">
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
          <div class="mobile-card-top-actions">
            <button type="button" class="mobile-focus-toggle${item.is_focused ? ' is-active' : ''}" onclick="event.stopPropagation(); window.toggleApplicationFocus('${item.id}', this)" aria-label="${item.is_focused ? '取消重点关心' : '设为重点关心'}" aria-pressed="${Boolean(item.is_focused)}">★</button>
            ${timePillHtml}
          </div>
        </div>

        <!-- 水平 Stepper 求职链路 -->
        <div class="stepper-pipeline-container">
          ${stepperHtml}
        </div>

        ${parallelNoticeHtml}

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

window.toggleApplicationFocus = async function(id, button) {
  const app = state.applications.find(item => item.id === id);
  if (!app || !button) return;
  const isFocused = !app.is_focused;
  button.disabled = true;
  try {
    await supabaseService.updateApplicationFocus(id, isFocused);
    app.is_focused = isFocused;
    renderDashboard();
    triggerHaptic('medium');
    showToast(isFocused ? `★ 已重点关心 ${app.company}` : `已取消重点关心 ${app.company}`);
  } catch (error) {
    button.disabled = false;
    showToast(`⚠️ 更新失败：${error.message}`);
  }
};

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

  const copyEmailBtn = document.getElementById('drawer-btn-copy-email');
  if (copyEmailBtn) {
    if (stage.raw_subject) {
      copyEmailBtn.style.display = 'flex';
    } else {
      copyEmailBtn.style.display = 'none';
    }
  }

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
  const latestSeq = latestStage ? (latestStage.seq || 1) : 0;
  const latestStages = appStages.filter(stage => (stage.seq || 1) === latestSeq);

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
    const scheduledNames = latestStages.filter(stage => stage.stage_status === 'scheduled').map(stage => stage.stage_name);
    const awaitingNames = latestStages.filter(stage => stage.stage_status === 'awaiting_result').map(stage => stage.stage_name);
    if (scheduledNames.length > 0) {
      statusBadge.textContent = `⏳ ${scheduledNames.join(' / ')} 待完成`;
    } else if (awaitingNames.length > 0) {
      statusBadge.textContent = `🎯 ${awaitingNames.join(' / ')} 等待结果`;
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
    const isLatestPosition = (stg.seq || 1) === latestSeq;
    const isParallel = latestStages.length > 1 && isLatestPosition;
    const isLatestActive = isLatestPosition && stg.stage_status === 'scheduled';
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
    const scheduleType = getScheduleType(stg);
    const timePrefix = scheduleType === 'start' ? '开始' : scheduleType === 'deadline' ? '截止' : '时间';
    const timeDisplay = stg.schedule_time && stg.schedule_time !== '待定' ? `${timePrefix}：${stg.schedule_time}` : '时间待定';

    return `
      <div class="timeline-bubble-item ${isParallel ? 'timeline-parallel-item' : ''}">
        <!-- 双同心圆拟物发光节点 -->
        <div class="timeline-concentric-dot ${isLatestActive ? 'dot-active' : ''}"></div>

        <!-- 气泡对话框白瓷卡片 -->
        <div class="bubble-porcelain-card ${isLatestActive ? 'card-active-luminous' : ''}" onclick="window.openEditModalForCurrent('${stg.id}')">
          <div class="bubble-top-row">
            <span class="bubble-seq-text">Stage ${stg.seq || (appStages.length - idx)}${isParallel ? ' · 并列' : ''}</span>
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
  document.getElementById('m-schedule-type').value = 'deadline';
  document.getElementById('m-meeting').value = '';
  const existingApp = state.applications.find(app => app.company === defaultCompany);
  const positionWrap = document.getElementById('m-stage-position-wrap');
  if (positionWrap) positionWrap.style.display = existingApp ? 'block' : 'none';
  const positionSelect = document.getElementById('m-stage-position');
  if (positionSelect) positionSelect.value = 'next';
  document.getElementById('manual-stage-modal').style.display = 'flex';
  triggerHaptic('light');
}

window.closeManualModal = function() {
  document.getElementById('manual-stage-modal').style.display = 'none';
};

window.setMPreset = function(name) {
  document.getElementById('m-stage-name').value = name;
  document.getElementById('m-schedule-type').value = /(面试|一面|二面|终面|HR面|宣讲)/i.test(name) ? 'start' : 'deadline';
  triggerHaptic('light');
};

window.submitManualStage = async function() {
  const company = document.getElementById('m-company').value.trim();
  const dept = document.getElementById('m-dept').value.trim();
  const position = document.getElementById('m-position').value.trim();
  const stageName = document.getElementById('m-stage-name').value.trim();
  const scheduleTime = document.getElementById('m-schedule-time').value.trim();
  const scheduleType = document.getElementById('m-schedule-type').value;
  const meeting = document.getElementById('m-meeting').value.trim();
  const statusRadio = document.querySelector('input[name="m-status-radio"]:checked');
  const stageStatus = statusRadio ? statusRadio.value : 'scheduled';
  const positionMode = document.getElementById('m-stage-position')?.value || 'next';

  if (!company || !stageName) {
    showToast('⚠️ 公司名称与推进环节类型为必填项');
    return;
  }

  triggerHaptic('heavy');
  try {
    await supabaseService.createApplicationWithStage(
      { company, department: dept, position },
      { stage_name: stageName, stage_status: stageStatus, schedule_time: scheduleTime, schedule_type: scheduleTime ? scheduleType : 'unknown', meeting_info: meeting, parallel_with_latest: positionMode === 'parallel' }
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
  document.getElementById('e-schedule-type').value = targetStage ? getScheduleType(targetStage) : 'unknown';
  document.getElementById('e-meeting').value = targetStage ? (targetStage.meeting_info || '') : '';
  document.getElementById('e-notes').value = targetStage ? (targetStage.notes || '') : '';

  const positionSelect = document.getElementById('e-stage-position');
  if (positionSelect && targetStage) {
    const siblings = state.stages
      .filter(stage => stage.application_id === app.id && stage.id !== targetStage.id && stage.stage_status !== 'ignored' && stage.stage_status !== 'pending')
      .sort((a, b) => (a.seq || 1) - (b.seq || 1));
    const groups = new Map();
    siblings.forEach(stage => {
      const seq = stage.seq || 1;
      if (!groups.has(seq)) groups.set(seq, []);
      groups.get(seq).push(stage.stage_name || '环节');
    });
    positionSelect.innerHTML = `<option value="${targetStage.seq || 1}">保持当前位置（第${targetStage.seq || 1}轮）</option>`
      + [...groups.entries()].filter(([seq]) => seq !== (targetStage.seq || 1)).map(([seq, names]) =>
        `<option value="${seq}">与「${escapeHtml(names.join(' / '))}」并列</option>`
      ).join('');
  }

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
  document.getElementById('e-schedule-type').value = /(面试|一面|二面|终面|HR面|宣讲)/i.test(name) ? 'start' : 'deadline';
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
  const scheduleType = document.getElementById('e-schedule-type').value;
  const meeting = document.getElementById('e-meeting').value.trim();
  const notes = document.getElementById('e-notes').value.trim();
  const statusRadio = document.querySelector('input[name="e-status-radio"]:checked');
  const stageStatus = statusRadio ? statusRadio.value : 'scheduled';
  const targetSeq = Number(document.getElementById('e-stage-position')?.value) || 1;

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
    const hypothetical = appStages.map(stage => stage.id === stageId
      ? { ...stage, seq: targetSeq, stage_name: stageName }
      : stage);
    const maxSeq = hypothetical.length > 0 ? Math.max(...hypothetical.map(stage => stage.seq || 1)) : targetSeq;
    const isLatest = targetSeq === maxSeq;

    const appUpdateData = { company, department: dept, position };
    if (isLatest) {
      const latestNames = hypothetical
        .filter(stage => stage.id !== stageId && (stage.seq || 1) === targetSeq)
        .map(stage => stage.stage_name)
        .concat(stageName);
      appUpdateData.current_stage_name = [...new Set(latestNames.filter(Boolean))].join(' / ');
    }

    await supabaseService.updateStageAndApplication(
      stageId,
      appId,
      { stage_name: stageName, stage_status: stageStatus, schedule_time: scheduleTime, schedule_type: scheduleTime ? scheduleType : 'unknown', meeting_info: meeting, notes, seq: targetSeq },
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

  // 初始化本地日程推送提醒开关与监听
  const chkNotif = document.getElementById('chk-notifications-enabled');
  if (chkNotif) {
    chkNotif.checked = notificationService.isEnabled();
    chkNotif.addEventListener('change', async (e) => {
      const enabled = e.target.checked;
      triggerHaptic('light');
      await notificationService.setEnabled(enabled, state.stages, state.applications, parseScheduleDate, getScheduleType);
      showToast(enabled ? '🔔 已开启本地日程临期提醒通知' : '🔕 已关闭本地日程通知');
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
  const text = document.createElement('span');
  text.textContent = String(msg || '');
  toast.appendChild(text);
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

// ==========================================================================
// 12. 顶部呼吸感近期紧要待办通报栏 (Urgent Action Banner)
// ==========================================================================
function renderUrgentBanner() {
  const banner = document.getElementById('dashboard-urgent-banner');
  if (!banner) return;

  if (!supabaseService.getConfig().isConfigured) {
    banner.style.display = 'none';
    return;
  }

  // 1. 提取所有待办环节 (stage_status === 'scheduled')
  const scheduledStages = state.stages.filter(s => s.stage_status === 'scheduled');
  const now = new Date();
  const todayStr = formatCalendarKey(now);
  const tomorrow = new Date(now.getTime() + 86400000);
  const tomorrowStr = formatCalendarKey(tomorrow);
  const urgentHorizon = new Date(now.getTime() + 7 * 86400000);

  const urgentItems = scheduledStages.map(stage => {
    const app = state.applications.find(a => a.id === stage.application_id);
    if (!app) return null;

    const date = parseScheduleDate(stage.schedule_time);
    const scheduleType = getScheduleType(stage);
    const scheduleVerb = scheduleType === 'deadline' ? '截止' : scheduleType === 'start' ? '开始' : '时间';
    let timeLabel = stage.schedule_time || '待定时间';
    let isToday = false;
    let isTomorrow = false;
    let isOverdue = false;
    let urgencyScore = 9999999999999;

    if (date) {
      const diffMs = date.getTime() - now.getTime();
      isOverdue = scheduleType === 'deadline' && diffMs < 0;
      urgencyScore = date.getTime();
      const dateKey = formatCalendarKey(date);
      const timePart = `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;

      if (dateKey === todayStr) {
        isToday = true;
        const hoursLeft = Math.round(diffMs / (1000 * 3600));
        if (scheduleType === 'deadline' && diffMs < 0) {
          timeLabel = `⚠️ 今日已到期 · ${timePart}`;
        } else if (scheduleType === 'start' && diffMs < 0) {
          timeLabel = `▶ 今日已开始 · ${timePart}`;
        } else if (diffMs < 0) {
          timeLabel = `⏱ 今日时间已到 · ${timePart}`;
        } else if (hoursLeft <= 1) {
          timeLabel = scheduleType === 'deadline'
            ? `🔥 截止 ${timePart} · 不足1小时`
            : `🔥 ${scheduleVerb} ${timePart} · 1小时内`;
        } else {
          timeLabel = `🔥 今日${scheduleVerb} ${timePart} · ${hoursLeft}小时`;
        }
      } else if (dateKey === tomorrowStr) {
        isTomorrow = true;
        timeLabel = `⏳ 明天${scheduleVerb} ${timePart}`;
      } else if (isOverdue) {
        timeLabel = `⚠️ 已逾期 · ${date.getMonth() + 1}月${date.getDate()}日 ${timePart}`;
      } else if (scheduleType === 'start' && diffMs < 0) {
        timeLabel = `▶ 已开始 · ${date.getMonth() + 1}月${date.getDate()}日 ${timePart}`;
      } else {
        timeLabel = `📅 ${date.getMonth() + 1}月${date.getDate()}日${scheduleVerb} ${timePart}`;
      }
    } else return null;

    // 逾期任务始终保留；未逾期任务只展示未来 7 天。
    if (date.getTime() > urgentHorizon.getTime()) return null;

    return { stage, app, date, timeLabel, isToday, isTomorrow, isOverdue, urgencyScore };
  }).filter(Boolean).sort((a, b) => a.urgencyScore - b.urgencyScore);

  if (urgentItems.length === 0) {
    banner.style.display = 'block';
    banner.innerHTML = `
      <div class="urgent-banner-peaceful">
        <div class="peaceful-left">
          <span class="peaceful-icon">☕</span>
          <span class="peaceful-text">未来 7 天暂无紧要待办，状态良好，从容备战！</span>
        </div>
        <div class="peaceful-right">
          <button class="btn-urgent-create" onclick="window.openManualModal('')">＋ 推进新环节</button>
        </div>
      </div>
    `;
    return;
  }

  const visibleUrgentItems = state.urgentBannerExpanded ? urgentItems : urgentItems.slice(0, 3);
  const hiddenCount = urgentItems.length - visibleUrgentItems.length;

  banner.style.display = 'block';
  banner.innerHTML = `
    <div class="urgent-banner-box">
      <div class="urgent-banner-header">
        <div class="urgent-header-title-group">
          <span class="urgent-pulse-indicator" aria-hidden="true"></span>
          <span class="urgent-header-title">⚡ 近期紧要待办</span>
          <span class="urgent-counter-pill">${urgentItems.length} 项日程</span>
        </div>
        <button type="button" class="btn-urgent-cal-link" onclick="window.switchToTab('view-calendar')">
          📅 查看完整求职日历 ➔
        </button>
      </div>
      <div class="urgent-cards-list">
        ${visibleUrgentItems.map(item => {
          const { stage, app, timeLabel, isToday, isTomorrow, isOverdue } = item;
          const safeCompany = escapeHtml(app.company || '未知企业');
          const safeDept = app.department ? escapeHtml(app.department) : '';
          const safePos = escapeHtml(app.position || '求职岗位');
          const safeStage = escapeHtml(stage.stage_name || '待办环节');
          const safeWebsite = (app.company_website || '').trim();

          let cardBadgeClass = 'pill-amber';
          const scheduleType = getScheduleType(stage);
          if (isOverdue || (isToday && scheduleType === 'deadline')) cardBadgeClass = 'pill-rose';
          else if ((isToday || isTomorrow) && scheduleType === 'start') cardBadgeClass = 'pill-indigo';

          const isInvite = safeStage.includes('邀请') || safeStage.includes('宣讲') || safeStage.includes('夏令营');
          const finishBtnLabel = isInvite ? '✓ 标为已投递' : '✓ 标为已参加';

          return `
            <div class="urgent-item-card ${isToday ? 'is-today' : ''}" onclick="window.viewCompanyTimeline('${app.id}')">
              <div class="urgent-item-header">
                <div class="urgent-item-comp-row">
                  <strong class="urgent-item-company">${safeCompany}</strong>
                  ${safeDept ? `<span class="urgent-item-dept">${safeDept}</span>` : ''}
                </div>
                <span class="urgent-stage-pill pill-indigo">${safeStage}</span>
              </div>
              <div class="urgent-item-pos" title="${safePos}">${safePos}</div>
              <div class="urgent-item-timerow">
                <span class="urgent-time-badge ${cardBadgeClass}">${timeLabel}</span>
              </div>
              <div class="urgent-item-actions" onclick="event.stopPropagation()">
                <button type="button" class="btn-urgent-action btn-urgent-email" onclick="window.copyEmailSubjectAndNotice('${escapeHtml(stage.raw_subject || '')}', '${safeCompany}')" title="快速复制邮件主题查找原件">
                  ✉️ 查邮件
                </button>
                ${safeWebsite ? `
                  <a class="btn-urgent-action btn-urgent-site" href="${escapeHtml(safeWebsite)}" target="_blank" rel="noopener noreferrer" title="前往企业官方招聘网站">
                    🌐 官网 ↗
                  </a>
                ` : ''}
                <button type="button" class="btn-urgent-action btn-urgent-done" onclick="window.markStageComplete('${stage.id}')" title="标记已参加/已完成并进入等待结果">
                  ${finishBtnLabel}
                </button>
              </div>
            </div>
          `;
        }).join('')}
      </div>
      ${urgentItems.length > 3 ? `
        <button type="button" class="btn-urgent-expand" onclick="window.toggleUrgentBannerExpanded()">
          ${state.urgentBannerExpanded ? '收起 ↑' : `查看其余 ${hiddenCount} 项待办 ↓`}
        </button>
      ` : ''}
    </div>
  `;
}

// ==========================================================================
// 13. 招聘会管理（与 Web 管理端共用 recruitment_events）
// ==========================================================================
function eventTimeText(value) {
  if (!value) return '待定';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '待定';
  return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
}

function eventLocalInput(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${formatCalendarKey(date)}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function normalizeEventUrl(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  try {
    const parsed = new URL(text);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : '';
  } catch (_) { return ''; }
}

function renderRecruitmentEvents() {
  const list = document.getElementById('events-mobile-list');
  const message = document.getElementById('events-mobile-message');
  if (!list) return;
  if (message) message.textContent = state.recruitmentEventsError || (!supabaseService.getConfig().isConfigured ? '请先在个人设置中连接 Supabase。' : '');
  document.querySelectorAll('[data-event-filter]').forEach(button => button.classList.toggle('active', button.dataset.eventFilter === state.recruitmentEventFilter));
  const items = state.recruitmentEvents.filter(event => event.status === state.recruitmentEventFilter &&
    [event.title, event.organizer, event.location].some(value => String(value || '').toLowerCase().includes(state.recruitmentEventQuery)))
    .sort((a, b) => Number(Boolean(b.is_focused)) - Number(Boolean(a.is_focused)) || new Date(a.starts_at) - new Date(b.starts_at));
  if (!items.length) {
    list.innerHTML = '<div class="events-mobile-empty">🎪<strong>暂无匹配的招聘会</strong><span>点击右上角“新增”记录活动</span></div>';
    return;
  }
  list.innerHTML = items.map(event => {
    const url = normalizeEventUrl(event.url);
    return `
      <article class="event-mobile-card${event.is_focused ? ' is-focused' : ''}">
        <div class="event-mobile-heading">
          <span class="event-mobile-type">${escapeHtml(event.event_type || '招聘会')}</span>
          <button type="button" class="mobile-focus-toggle${event.is_focused ? ' is-active' : ''}" onclick="window.toggleRecruitmentEventFocus('${event.id}', this)" aria-label="${event.is_focused ? '取消重点关心' : '设为重点关心'}" aria-pressed="${Boolean(event.is_focused)}">★</button>
        </div>
        <h2>${escapeHtml(event.title)}</h2>
        <p>${escapeHtml(event.organizer || '主办方未填写')}</p>
        <div class="event-mobile-time">开始 · ${escapeHtml(eventTimeText(event.starts_at))}${event.ends_at ? `<br>结束 · ${escapeHtml(eventTimeText(event.ends_at))}` : ''}</div>
        <p>地点 · ${escapeHtml(event.location || '线上 / 待补充')}</p>
        <div class="event-mobile-actions">
          <button onclick="window.openRecruitmentEvent('${event.id}')">编辑</button>
          ${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">活动链接 ↗</a>` : ''}
          ${event.status !== 'cancelled' ? `<button onclick="window.toggleRecruitmentEventCalendar('${event.id}', this)">${event.in_calendar ? '移出日历' : '加入日历'}</button>` : ''}
          ${event.status === 'planned' ? `<button onclick="window.markRecruitmentEventAttended('${event.id}', this)">✓ 已参加</button>` : ''}
        </div>
      </article>`;
  }).join('');
}

window.searchRecruitmentEvents = function(value) {
  state.recruitmentEventQuery = String(value || '').trim().toLowerCase();
  renderRecruitmentEvents();
};

window.setRecruitmentEventFilter = function(filter) {
  state.recruitmentEventFilter = filter;
  triggerHaptic('light');
  renderRecruitmentEvents();
};

async function updateMobileRecruitmentEvent(id, changes, button, successText) {
  const event = state.recruitmentEvents.find(item => item.id === id);
  if (!event || !button) return false;
  button.disabled = true;
  try {
    const updated = await supabaseService.updateRecruitmentEvent(id, { ...changes, updated_at: new Date().toISOString() });
    Object.assign(event, updated);
    renderRecruitmentEvents();
    renderCalendar();
    triggerHaptic('medium');
    showToast(successText);
    return true;
  } catch (error) {
    button.disabled = false;
    showToast(`⚠️ 更新失败：${error.message}`);
    return false;
  }
}

window.toggleRecruitmentEventFocus = function(id, button) {
  const event = state.recruitmentEvents.find(item => item.id === id);
  if (event) updateMobileRecruitmentEvent(id, { is_focused: !event.is_focused }, button, event.is_focused ? '已取消重点关心' : '★ 已设为重点关心');
};

window.toggleRecruitmentEventCalendar = function(id, button) {
  const event = state.recruitmentEvents.find(item => item.id === id);
  if (event) updateMobileRecruitmentEvent(id, { in_calendar: !event.in_calendar }, button, event.in_calendar ? '已移出求职日历' : '已加入求职日历');
};

window.markRecruitmentEventAttended = function(id, button) {
  updateMobileRecruitmentEvent(id, { status: 'attended' }, button, '已标记参加');
};

window.openRecruitmentEvent = function(id = '') {
  const event = state.recruitmentEvents.find(item => item.id === id) || {};
  let overlay = document.getElementById('mobile-event-modal');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'mobile-event-modal';
    overlay.className = 'mobile-event-modal';
    document.body.appendChild(overlay);
  }
  overlay.innerHTML = `
    <div class="mobile-event-sheet" role="dialog" aria-modal="true" aria-labelledby="mobile-event-modal-title">
      <div class="mobile-event-modal-head"><h2 id="mobile-event-modal-title">${id ? '编辑招聘会' : '新增招聘会'}</h2><button onclick="window.closeRecruitmentEvent()" aria-label="关闭">×</button></div>
      <form id="mobile-event-form">
        <input type="hidden" name="id" value="${escapeHtml(event.id || '')}">
        <label>活动名称 *<input name="title" required maxlength="160" value="${escapeHtml(event.title || '')}"></label>
        <label>活动类型<select name="event_type"><option>招聘会</option><option>双选会</option><option>宣讲会</option></select></label>
        <label>主办方<input name="organizer" maxlength="160" value="${escapeHtml(event.organizer || '')}"></label>
        <div class="mobile-event-form-row"><label>开始时间 *<input name="starts_at" type="datetime-local" required value="${eventLocalInput(event.starts_at)}"></label><label>结束时间<input name="ends_at" type="datetime-local" value="${eventLocalInput(event.ends_at)}"></label></div>
        <label>地点<input name="location" maxlength="300" value="${escapeHtml(event.location || '')}"></label>
        <label>活动链接<input name="url" type="url" value="${escapeHtml(event.url || '')}" placeholder="https://…"></label>
        <label>参加状态<select name="status"><option value="planned">待参加</option><option value="attended">已参加</option><option value="cancelled">已取消</option></select></label>
        <label>备注<textarea name="notes" rows="3">${escapeHtml(event.notes || '')}</textarea></label>
        <label class="mobile-event-check"><input name="is_focused" type="checkbox" ${event.is_focused ? 'checked' : ''}> 设为重点关心</label>
        <label class="mobile-event-check"><input name="in_calendar" type="checkbox" ${event.in_calendar !== false ? 'checked' : ''}> 加入求职日历</label>
        <p id="mobile-event-form-message"></p>
        <button class="mobile-event-save" type="submit">保存活动</button>
      </form>
    </div>`;
  const form = document.getElementById('mobile-event-form');
  form.elements.event_type.value = event.event_type || '招聘会';
  form.elements.status.value = event.status || 'planned';
  form.onsubmit = saveMobileRecruitmentEvent;
  overlay.classList.add('active');
  triggerHaptic('light');
};

window.closeRecruitmentEvent = function() {
  document.getElementById('mobile-event-modal')?.classList.remove('active');
};

async function saveMobileRecruitmentEvent(submitEvent) {
  submitEvent.preventDefault();
  const form = submitEvent.currentTarget;
  const fields = form.elements;
  const message = document.getElementById('mobile-event-form-message');
  const start = new Date(fields.starts_at.value);
  const end = fields.ends_at.value ? new Date(fields.ends_at.value) : null;
  if (!fields.title.value.trim() || Number.isNaN(start.getTime()) || (end && (Number.isNaN(end.getTime()) || end < start))) {
    message.textContent = '请填写活动名称和有效时间，结束时间不能早于开始时间。';
    return;
  }
  const url = normalizeEventUrl(fields.url.value);
  if (fields.url.value.trim() && !url) { message.textContent = '活动链接仅支持 HTTP(S) 网址。'; return; }
  const payload = {
    title: fields.title.value.trim(), event_type: fields.event_type.value,
    organizer: fields.organizer.value.trim(), starts_at: start.toISOString(), ends_at: end ? end.toISOString() : null,
    location: fields.location.value.trim(), url, notes: fields.notes.value.trim(), status: fields.status.value,
    is_focused: fields.is_focused.checked, in_calendar: fields.in_calendar.checked, updated_at: new Date().toISOString()
  };
  const button = form.querySelector('[type="submit"]');
  button.disabled = true;
  try {
    await supabaseService.saveRecruitmentEvent(payload, fields.id.value);
    window.closeRecruitmentEvent();
    await loadAllData(false);
    showToast('招聘会已保存并同步');
  } catch (error) {
    message.textContent = `保存失败：${error.message}`;
    button.disabled = false;
  }
}

// ==========================================================================
// 14. 求职日历大厅与当日事项核心逻辑 (Calendar View & Daily Agenda)
// ==========================================================================
function getCalendarEntries() {
  const stageEntries = state.stages.map(stage => {
    if (['pending', 'ignored'].includes(stage.stage_status)) return null;
    const date = parseScheduleDate(stage.schedule_time);
    const app = state.applications.find(item => item.id === stage.application_id);
    return date && app ? { stage, app, date, key: formatCalendarKey(date) } : null;
  }).filter(Boolean);
  const eventEntries = state.recruitmentEvents.flatMap(event => {
    if (!event.in_calendar || event.status === 'cancelled') return [];
    const date = new Date(event.starts_at);
    return Number.isNaN(date.getTime()) ? [] : [{ event, date, key: formatCalendarKey(date) }];
  });
  return stageEntries.concat(eventEntries).sort((a, b) => a.date - b.date);
}

function renderCalendar() {
  const grid = document.getElementById('calendar-days-grid');
  const title = document.getElementById('calendar-month-title');
  if (!grid || !title) return;

  const year = state.calendarCursor.getFullYear();
  const month = state.calendarCursor.getMonth();
  title.textContent = `${year}年${month + 1}月`;

  const firstDay = new Date(year, month, 1);
  const startDay = (firstDay.getDay() + 6) % 7; // 周一为 0
  const startDate = new Date(year, month, 1 - startDay);

  const entries = getCalendarEntries();
  const todayKey = formatCalendarKey(new Date());

  let html = '';
  for (let i = 0; i < 42; i++) {
    const date = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + i);
    const key = formatCalendarKey(date);
    const items = entries.filter(item => item.key === key);
    const isOutside = date.getMonth() !== month;
    const isToday = key === todayKey;
    const isSelected = key === state.selectedCalendarKey;

    let dotsHtml = '';
    if (items.length > 0) {
      const topItems = items.slice(0, 3);
      dotsHtml = `<div class="cal-dots-wrap">${topItems.map(item => {
        if (item.event) return '<span class="cal-event-dot dot-recruitment-event"></span>';
        const cat = getStageProgressCategory(item.app, item.stage);
        return `<span class="cal-event-dot dot-${cat}"></span>`;
      }).join('')}</div>`;
    }

    html += `
      <button type="button" class="cal-day-cell ${isOutside ? 'is-outside' : ''} ${isToday ? 'is-today' : ''} ${isSelected ? 'is-selected' : ''}" onclick="window.selectCalendarDay('${key}')">
        <span class="cal-day-number">${date.getDate()}</span>
        ${dotsHtml}
      </button>
    `;
  }

  grid.innerHTML = html;
  renderCalendarAgenda(entries);
}

function renderCalendarAgenda(entries = getCalendarEntries()) {
  const list = document.getElementById('calendar-agenda-list');
  const badge = document.getElementById('calendar-selected-date-badge');
  const countBadge = document.getElementById('calendar-selected-count-badge');

  const sheetList = document.getElementById('calendar-agenda-sheet-list');
  const sheetTitle = document.getElementById('agenda-sheet-date-title');
  const sheetCountTag = document.getElementById('agenda-sheet-count-tag');

  const selected = parseScheduleDate(state.selectedCalendarKey);
  const weekDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const dateFormatted = selected
    ? `${selected.getMonth() + 1}月${selected.getDate()}日 ${weekDays[selected.getDay()]}`
    : state.selectedCalendarKey;

  if (badge) badge.textContent = dateFormatted;
  if (sheetTitle) sheetTitle.textContent = dateFormatted;

  const items = entries.filter(item => item.key === state.selectedCalendarKey);
  const countText = `${items.length} 项安排`;
  if (countBadge) countBadge.textContent = countText;
  if (sheetCountTag) sheetCountTag.textContent = countText;

  if (items.length === 0) {
    const emptyHtml = `
      <div class="agenda-empty-card">
        <div class="agenda-empty-icon">☕</div>
        <div class="agenda-empty-title">当天没有求职日程安排</div>
        <div class="agenda-empty-sub">可以安心复盘、准备刷题或投递新岗位</div>
      </div>
    `;
    if (list) list.innerHTML = emptyHtml;
    if (sheetList) sheetList.innerHTML = emptyHtml;
    return;
  }

  const itemsHtml = items.map(item => {
    if (item.event) {
      const event = item.event;
      const time = `${item.date.getHours().toString().padStart(2, '0')}:${item.date.getMinutes().toString().padStart(2, '0')}`;
      return `
        <div class="agenda-item-card agenda-recruitment-event" onclick="window.closeCalendarAgendaSheetDirect(); window.openRecruitmentEvent('${event.id}')">
          <div class="agenda-left-info">
            <div class="agenda-item-time-row"><span class="agenda-time-text">⏱ ${time}</span><span class="agenda-type-tag agenda-type-event">招聘会</span></div>
            <div class="agenda-company-title">${event.is_focused ? '★ ' : ''}${escapeHtml(event.title)}</div>
            <div class="agenda-stage-subtitle">${escapeHtml(event.organizer || '主办方未填写')} · ${escapeHtml(event.location || '线上 / 待补充')}</div>
          </div>
          <span class="bento-status-tag pill-amber">${event.status === 'attended' ? '已参加' : '待参加'}</span>
        </div>`;
    }
    const { stage, app, date } = item;
    const time = `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
    const scheduleType = getScheduleType(stage);
    const typeTagLabel = scheduleType === 'deadline' ? '截止' : scheduleType === 'start' ? '开始' : '时间';
    const typeClass = `agenda-type-${scheduleType}`;
    const isScheduled = stage.stage_status === 'scheduled';
    const isAwaiting = stage.stage_status === 'awaiting_result';
    const isOffer = stage.stage_status === 'offered';

    let statusText = '已完成';
    let statusPillClass = 'pill-gray';
    if (isScheduled) {
      statusText = '待进行';
      statusPillClass = 'pill-indigo';
    } else if (isAwaiting) {
      statusText = '等待结果';
      statusPillClass = 'pill-amber';
    } else if (isOffer) {
      statusText = '已发Offer';
      statusPillClass = 'pill-emerald';
    }

    return `
      <div class="agenda-item-card" onclick="window.closeCalendarAgendaSheetDirect(); window.viewCompanyTimeline('${app.id}')">
        <div class="agenda-left-info">
          <div class="agenda-item-time-row">
            <span class="agenda-time-text">⏱ ${time}</span>
            <span class="agenda-type-tag ${typeClass}">[${typeTagLabel}]</span>
          </div>
          <div class="agenda-company-title">${escapeHtml(app.company)} · ${escapeHtml(stage.stage_name)}</div>
          <div class="agenda-stage-subtitle">${app.position ? escapeHtml(app.position) : '求职岗位'}${app.department ? ` · ${escapeHtml(app.department)}` : ''}</div>
        </div>
        <div style="display:flex; flex-direction:column; align-items:flex-end; gap:6px;">
          <span class="bento-status-tag ${statusPillClass}">${statusText}</span>
          <span style="font-size:0.72rem; color:var(--accent-indigo); font-weight:700;">查看档案 ➔</span>
        </div>
      </div>
    `;
  }).join('');

  if (list) list.innerHTML = itemsHtml;
  if (sheetList) sheetList.innerHTML = itemsHtml;
}

// ==========================================================================
// 15. 移动端快捷事件响应 (日历翻页、选择、弹出悬浮框、邮件主题复制)
// ==========================================================================
window.changeCalendarMonth = function(offset) {
  state.calendarCursor = new Date(state.calendarCursor.getFullYear(), state.calendarCursor.getMonth() + offset, 1);
  state.selectedCalendarKey = formatCalendarKey(state.calendarCursor);
  triggerHaptic('light');
  renderCalendar();
};

window.goToCalendarToday = function() {
  const today = new Date();
  state.calendarCursor = new Date(today.getFullYear(), today.getMonth(), 1);
  state.selectedCalendarKey = formatCalendarKey(today);
  triggerHaptic('medium');
  renderCalendar();
  window.openCalendarAgendaSheet();
};

window.selectCalendarDay = function(key) {
  state.selectedCalendarKey = key;
  triggerHaptic('medium');
  renderCalendar();
  window.openCalendarAgendaSheet();
};

window.openCalendarAgendaSheet = function() {
  const overlay = document.getElementById('calendar-agenda-overlay');
  if (!overlay) return;
  overlay.classList.add('active');
  state.isCalendarSheetOpen = true;
};

window.closeCalendarAgendaSheet = function(e) {
  if (e && e.target && e.target.id !== 'calendar-agenda-overlay') return;
  window.closeCalendarAgendaSheetDirect();
};

window.closeCalendarAgendaSheetDirect = function() {
  const overlay = document.getElementById('calendar-agenda-overlay');
  if (overlay) overlay.classList.remove('active');
  state.isCalendarSheetOpen = false;
};

window.openManualModalForCalendarDay = function() {
  window.closeCalendarAgendaSheetDirect();
  openManualModal('');
  setTimeout(() => {
    const timeInput = document.getElementById('m-time');
    if (timeInput && state.selectedCalendarKey) {
      timeInput.value = `${state.selectedCalendarKey} 10:00`;
    }
  }, 50);
  triggerHaptic('light');
  showToast(`📅 已预填 ${state.selectedCalendarKey} 日期`);
};

window.toggleUrgentBannerExpanded = function() {
  state.urgentBannerExpanded = !state.urgentBannerExpanded;
  triggerHaptic('light');
  renderUrgentBanner();
};

window.copyEmailSubjectAndNotice = async function(rawSubject, company = '') {
  triggerHaptic('medium');
  if (!rawSubject) {
    showToast(`✉️ ${company ? company + ' ' : ''}暂无原始邮件主题记录`);
    return;
  }
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(rawSubject);
      showToast(`📋 已复制邮件主题：《${rawSubject.slice(0, 18)}…》，可前往邮箱快速搜索原件！`);
    } else {
      const ta = document.createElement('textarea');
      ta.value = rawSubject;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      showToast(`📋 已复制主题：《${rawSubject.slice(0, 18)}…》`);
    }
  } catch (e) {
    showToast(`📋 邮件主题：《${rawSubject}》`);
  }
};

window.copyCurrentDrawerEmailSubject = function() {
  const stage = state.stages.find(s => s.id === state.currentDrawerStageId);
  const app = stage ? state.applications.find(a => a.id === stage.application_id) : null;
  const company = app ? app.company : '';
  window.copyEmailSubjectAndNotice(stage ? stage.raw_subject : '', company);
};

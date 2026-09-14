const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'android-app/index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'android-app/src/app.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'android-app/src/style.css'), 'utf8');

test('mobile shell exposes four small-screen primary destinations', () => {
  const nav = html.match(/<nav class="bottom-nav-bar">([\s\S]*?)<\/nav>/)?.[1] || '';
  assert.equal((nav.match(/class="nav-btn/g) || []).length, 4);
  for (const label of ['今日', '申请', '日历', '我的']) assert.match(nav, new RegExp(`>${label}<`));
  assert.doesNotMatch(nav, /招聘会|审核管理|全景档案/);
});

test('daily home keeps action, focused applications and inbox in one vertical flow', () => {
  assert.match(html, /id="daily-week-strip"/);
  assert.match(html, /id="daily-timeline-list"/);
  assert.match(html, /id="daily-focused-list"/);
  assert.match(html, /id="daily-inbox-banner"/);
  assert.doesNotMatch(html, /id="daily-waiting-list"|id="daily-waiting-title"/);
  assert.doesNotMatch(app, /waitingList|daily-waiting-card/);
  assert.match(app, /function renderDailyHome\(\)/);
  assert.match(app, /function buildDailyTimelineItem\(/);
  assert.match(styles, /\.daily-timeline-item/);
});

test('daily home exposes a collapsible focused applications section', () => {
  assert.match(html, /id="daily-focused-title"/);
  assert.match(html, /id="daily-focused-toggle"[\s\S]*aria-expanded="true"/);
  assert.match(html, /id="daily-focused-list"/);
  assert.match(app, /\.filter\(\(\{ app \}\) => app\.is_focused\)/);
  assert.match(app, /window\.toggleDailyFocusedApplications = function/);
  assert.match(app, /focusedApps\.slice\(0, 3\)/);
  assert.match(styles, /\.daily-focused-list\[hidden\]/);
  assert.match(styles, /\.daily-focused-card/);
});

test('secondary tools remain reachable without crowding the primary navigation', () => {
  assert.match(html, /onclick="window\.switchToTab\('view-review'\)"/);
  assert.match(html, /onclick="window\.switchToTab\('view-events'\)"/);
  assert.match(html, /id="view-applications"/);
});

test('mobile cards omit company avatars and profile uses one fixed visual system', () => {
  assert.doesNotMatch(app, /company-logo-avatar|daily-company-avatar|timeline-header-avatar/);
  assert.doesNotMatch(html, /company-logo-avatar|daily-company-avatar|timeline-header-avatar/);
  assert.doesNotMatch(html, /视觉主题与风格切换|theme-card-creamy|theme-card-classic/);
  assert.doesNotMatch(app, /switchAppTheme|offerpilot_theme|initTheme/);
  assert.match(html, /class="profile-overview-card"/);
  assert.match(html, /仅统计已审核准入的真实申请/);
  assert.match(app, /const profiledApps = state\.applications\.map/);
});

test('profile uses grouped mobile settings and hides advanced cloud credentials by default', () => {
  assert.match(html, /class="profile-sync-badge"/);
  assert.match(html, /class="settings-section-label">工作台/);
  assert.match(html, /class="settings-section-label">提醒与反馈/);
  assert.match(html, /class="settings-section-label">数据与同步/);
  assert.match(html, /<details class="settings-disclosure" id="cloud-config-disclosure">/);
  assert.match(html, /高级设置 · 仅在首次连接或更换数据库时需要修改/);
  assert.match(styles, /\.settings-disclosure\[open\] > summary \.setting-row-chevron/);
  assert.match(app, /profileConnectionLabel\.textContent = cfg\.isConfigured/);
});

test('mobile timeline numbers visible rounds continuously while preserving parallel groups', () => {
  const start = app.indexOf('function buildVisibleStageSequenceMap(stages)');
  const end = app.indexOf('\nfunction getScheduleType(', start);
  const context = {};
  vm.runInNewContext(`${app.slice(start, end)}; this.buildMap = buildVisibleStageSequenceMap;`, context);

  const map = context.buildMap([
    { seq: 1, stage_status: 'passed' },
    { seq: 2, stage_status: 'ignored' },
    { seq: 3, stage_status: 'awaiting_result' },
    { seq: 3, stage_status: 'scheduled' },
  ]);
  assert.equal(map.get(1), 1);
  assert.equal(map.has(2), false);
  assert.equal(map.get(3), 2);
});

test('application detail timeline uses compact localized rows', () => {
  const parseStart = app.indexOf('function parseScheduleDate(value)');
  const parseEnd = app.indexOf('\nfunction formatCalendarKey(', parseStart);
  const formatStart = app.indexOf('function getScheduleType(stage)');
  const formatEnd = app.indexOf('\nfunction updateKPIStats(', formatStart);
  const context = { Date, URL };
  vm.runInNewContext(
    `${app.slice(parseStart, parseEnd)}\n${app.slice(formatStart, formatEnd)}; this.formatSchedule = formatTimelineSchedule; this.formatMeeting = formatTimelineMeetingInfo;`,
    context
  );

  assert.equal(context.formatSchedule({ stage_name: '综合面试', schedule_time: '2026-09-16 08:30' }), '开始 · 9月16日 08:30');
  assert.equal(context.formatMeeting('https://cmbnt.cmbchina.com/room/42'), 'cmbnt.cmbchina.com');
  assert.match(app, /第 \$\{displaySeq\} 轮/);
  assert.doesNotMatch(app, /Stage \$\{displaySeq\}/);
  assert.match(styles, /\.timeline-bubble-item \{[\s\S]*margin-bottom: 10px/);
  assert.match(styles, /\.bubble-porcelain-card \{[\s\S]*padding: 11px 13px/);
});

test('application cards place readable time below the title and open a detail dialog', () => {
  assert.match(app, /class="mobile-card-schedule-row"/);
  assert.match(styles, /\.mobile-card-schedule-row \.time-pill-badge[\s\S]*max-width: none/);
  assert.match(app, /return `\$\{parsed\.getMonth\(\) \+ 1\}月\$\{parsed\.getDate\(\)\}日/);
  assert.match(html, /class="application-detail-sheet" role="dialog" aria-modal="true"/);
  assert.match(app, /modal\.classList\.add\('is-open'\)/);
  assert.match(app, /window\.closeCompanyTimelineModal = function/);
  assert.match(app, /const latestStages = appStages\.filter/);
  assert.match(styles, /\.application-detail-modal\.is-open/);
});

test('application list cards use a compact mobile summary instead of a full labeled pipeline', () => {
  assert.match(app, /class="compact-card-progress"/);
  assert.match(app, /const visibleStages = validStages\.slice\(-5\)/);
  assert.match(app, />\$\{visibleRoundCount\} 轮 · \$\{item\.stages\.length\} 个环节</);
  assert.doesNotMatch(app, /求职时序: 第 \$\{item\.stages\.length\} 轮推进/);
  assert.match(styles, /#view-applications \.porcelain-job-card \{[^}]*padding: 11px 12px 9px/);
  assert.match(styles, /#view-applications \.stepper-dot \{[^}]*width: 8px; height: 8px/);
});

test('application status filter returns when the user scrolls upward', () => {
  assert.match(html, /id="application-smart-filter-dock"/);
  assert.match(app, /function initApplicationSmartFilterDock\(\)/);
  assert.match(app, /delta < -5[\s\S]*classList\.remove\('is-scroll-hidden'\)/);
  assert.match(app, /delta > 5[\s\S]*classList\.add\('is-scroll-hidden'\)/);
  assert.match(styles, /#view-applications \.bento-grid-wrapper[\s\S]*position: sticky/);
  assert.match(styles, /\.bento-grid-wrapper\.is-scroll-docked/);
});

test('changing an application filter positions the first result below the sticky dock', () => {
  const bentoStart = app.indexOf('function setBentoFilter');
  const progressStart = app.indexOf('function setProgressFilter');
  const scrollStart = app.indexOf('function scrollToFirstFilteredApplication');
  assert.match(app.slice(bentoStart, progressStart), /renderDashboard\(\);\s*scrollToFirstFilteredApplication\(\);/);
  assert.match(app.slice(progressStart, scrollStart), /renderDashboard\(\);\s*scrollToFirstFilteredApplication\(\);/);
  assert.match(app.slice(scrollStart), /querySelector\('\.porcelain-job-card'\)/);
  assert.match(app.slice(scrollStart), /const visibleChromeOffset = Math\.max\(dock\?\.offsetHeight \|\| 0, stickyHeader\?\.offsetHeight \|\| 0\) \+ 14/);
  assert.match(app.slice(scrollStart), /getBoundingClientRect\(\)\.top - visibleChromeOffset/);
  assert.match(app.slice(scrollStart), /behavior: 'instant'/);
});

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

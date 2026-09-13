const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

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

test('daily home keeps action, waiting feedback and inbox in one vertical flow', () => {
  assert.match(html, /id="daily-week-strip"/);
  assert.match(html, /id="daily-timeline-list"/);
  assert.match(html, /id="daily-waiting-list"/);
  assert.match(html, /id="daily-inbox-banner"/);
  assert.match(app, /function renderDailyHome\(\)/);
  assert.match(app, /function buildDailyTimelineItem\(/);
  assert.match(styles, /\.daily-timeline-item/);
});

test('secondary tools remain reachable without crowding the primary navigation', () => {
  assert.match(html, /onclick="window\.switchToTab\('view-review'\)"/);
  assert.match(html, /onclick="window\.switchToTab\('view-events'\)"/);
  assert.match(html, /id="view-applications"/);
});

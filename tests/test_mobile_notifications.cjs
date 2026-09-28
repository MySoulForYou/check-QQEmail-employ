const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const serviceSource = fs.readFileSync(path.join(__dirname, '../android-app/src/supabase.js'), 'utf8')
  .replace('export const supabaseService = new SupabaseMobileService();', 'this.SupabaseMobileService = SupabaseMobileService;');
const appSource = fs.readFileSync(path.join(__dirname, '../android-app/src/app.js'), 'utf8');

function createService(fetch) {
  const store = new Map([
    ['offerpilot_supabase_url', 'https://example.supabase.co'],
    ['offerpilot_supabase_key', 'anon-key']
  ]);
  const context = vm.createContext({
    fetch,
    console,
    WebSocket: class {},
    clearInterval() {},
    clearTimeout() {},
    setInterval() {},
    setTimeout() {},
    localStorage: {
      getItem: key => store.get(key) || '',
      setItem: (key, value) => store.set(key, value),
      removeItem: key => store.delete(key)
    }
  });
  vm.runInContext(serviceSource, context);
  return new context.SupabaseMobileService();
}

function loadReviewHelpers(state) {
  const start = appSource.indexOf('const REVIEW_EVENT_META');
  const end = appSource.indexOf('window.switchReviewTab');
  const context = {
    state,
    Date,
    sortReviewItemsByTime(items) {
      return [...items].sort((a, b) => new Date(b.received_at || b.created_at || 0) - new Date(a.received_at || a.created_at || 0));
    }
  };
  vm.runInNewContext(
    `${appSource.slice(start, end)}; this.getReviewItems = getReviewItems;`,
    context
  );
  return context;
}

function loadNotificationUpdateHelpers(state) {
  const start = appSource.indexOf('function findNotificationTargetStage');
  const end = appSource.indexOf('async function approveStageNotification');
  const context = { state, Date };
  vm.runInNewContext(
    `${appSource.slice(start, end)}; this.findTarget = findNotificationTargetStage; this.buildUpdate = buildStageUpdateFromNotification;`,
    context
  );
  return context;
}

function loadApprovalWorkflow(state, supabaseService) {
  const start = appSource.indexOf('function findNotificationTargetStage');
  const end = appSource.indexOf('// 复制会议号');
  const context = { state, supabaseService, Date, Error, Object, Math };
  vm.runInNewContext(
    `${appSource.slice(start, end)}; this.approve = approveStageNotification;`,
    context
  );
  return context;
}

test('mobile load includes new stage notifications without breaking older databases', async () => {
  const service = createService(async url => {
    if (url.includes('stage_notifications')) {
      return { ok: true, json: async () => [{ id: 'notice-1', review_status: 'pending' }] };
    }
    return { ok: true, json: async () => [] };
  });
  const current = await service.fetchApplicationsWithStages();
  assert.equal(current.stageNotifications[0].id, 'notice-1');

  const legacyService = createService(async url => ({
    ok: !url.includes('stage_notifications'),
    json: async () => []
  }));
  const legacy = await legacyService.fetchApplicationsWithStages();
  assert.equal(legacy.stageNotifications.length, 0);
});

test('mobile review hall combines legacy stages and new notifications', () => {
  const helpers = loadReviewHelpers({
    stages: [{ id: 'legacy', stage_status: 'pending', created_at: '2026-09-01T00:00:00Z' }],
    stageNotifications: [{ id: 'notice', review_status: 'pending', proposed_stage_name: '技术一面', received_at: '2026-09-02T00:00:00Z' }]
  });
  const items = helpers.getReviewItems('pending');
  assert.equal(items.length, 2);
  assert.equal(items[0]._reviewKind, 'notification');
  assert.equal(items[0].stage_name, '技术一面');
  assert.equal(items[1]._reviewKind, 'legacy_stage');
});

test('mobile notification updates reuse visible stages for reschedules and results', () => {
  const stage = { id: 'stage-2', application_id: 'app-1', seq: 2, stage_name: '技术一面', stage_status: 'scheduled' };
  const helpers = loadNotificationUpdateHelpers({ stages: [
    { id: 'ignored', application_id: 'app-1', seq: 3, stage_name: '技术一面', stage_status: 'ignored' },
    stage
  ] });

  assert.equal(helpers.findTarget({ application_id: 'app-1', proposed_stage_name: '技术一面' }).id, 'stage-2');
  const reschedule = helpers.buildUpdate({
    event_type: 'reschedule',
    schedule_time: '2026-09-30 10:00',
    schedule_type: 'start'
  });
  assert.equal(reschedule.schedule_time, '2026-09-30 10:00');
  assert.equal(Object.hasOwn(reschedule, 'stage_status'), false);
  assert.equal(helpers.buildUpdate({ event_type: 'result', proposed_stage_status: 'passed' }).stage_status, 'passed');
});

test('mobile notification mutations target stage_notifications', async () => {
  let request;
  const service = createService(async (url, options) => {
    request = { url, options };
    return { ok: true, json: async () => [{ id: 'notice-1', review_status: 'ignored' }] };
  });
  await service.updateStageNotification('notice-1', { review_status: 'ignored' });
  assert.match(request.url, /stage_notifications\?id=eq\.notice-1$/);
  assert.equal(request.options.method, 'PATCH');
  assert.equal(JSON.parse(request.options.body).review_status, 'ignored');
});

test('approving a new mobile notification creates one real stage and links the audit row', async () => {
  const calls = [];
  const notification = {
    id: 'notice-1', application_id: 'app-1', event_type: 'new_stage', review_status: 'pending',
    proposed_stage_name: '技术一面', proposed_stage_status: 'scheduled', schedule_time: '2026-10-01 10:00'
  };
  const state = { stages: [], stageNotifications: [notification] };
  const service = {
    async createStage(payload) {
      calls.push(['createStage', payload]);
      return { id: 'stage-1', ...payload };
    },
    async updateStage() { throw new Error('新阶段不应更新旧阶段'); },
    async updateStageNotification(id, payload) {
      calls.push(['updateStageNotification', id, payload]);
      return { ...notification, ...payload };
    },
    async updateApplication(id, payload) {
      calls.push(['updateApplication', id, payload]);
      return { id, ...payload };
    }
  };

  const workflow = loadApprovalWorkflow(state, service);
  await workflow.approve('notice-1');
  await workflow.approve('notice-1');
  assert.equal(state.stages.length, 1);
  assert.equal(state.stages[0].stage_name, '技术一面');
  assert.equal(calls.filter(([name]) => name === 'createStage').length, 1);
  const auditCall = calls.find(([name]) => name === 'updateStageNotification');
  assert.equal(auditCall[2].stage_id, 'stage-1');
  assert.equal(auditCall[2].review_status, 'approved');
});

test('approving a reschedule notification updates its linked stage without adding a round', async () => {
  const calls = [];
  const stage = { id: 'stage-1', application_id: 'app-1', seq: 1, stage_name: '技术一面', stage_status: 'scheduled' };
  const notification = {
    id: 'notice-2', application_id: 'app-1', stage_id: 'stage-1', event_type: 'reschedule', review_status: 'pending',
    proposed_stage_name: '技术一面', schedule_time: '2026-10-02 14:00', schedule_type: 'start'
  };
  const state = { stages: [stage], stageNotifications: [notification] };
  const service = {
    async createStage() { throw new Error('改期邮件不应创建新阶段'); },
    async updateStage(id, payload) {
      calls.push(['updateStage', id, payload]);
      return { ...stage, ...payload };
    },
    async updateStageNotification(id, payload) {
      calls.push(['updateStageNotification', id, payload]);
      return { ...notification, ...payload };
    },
    async updateApplication() { return {}; }
  };

  await loadApprovalWorkflow(state, service).approve('notice-2');
  assert.equal(state.stages.length, 1);
  assert.equal(stage.schedule_time, '2026-10-02 14:00');
  assert.equal(calls.filter(([name]) => name === 'updateStage').length, 1);
});

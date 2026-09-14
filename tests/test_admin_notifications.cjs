const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../client/admin/app.js'), 'utf8');

function loadReviewHelpers(stages, notifications) {
    const start = source.indexOf('const REVIEW_EVENT_META');
    const end = source.indexOf('function renderReviews(stages)');
    const context = { allStages: stages, allStageNotifications: notifications };
    vm.runInNewContext(
        `${source.slice(start, end)}; this.getItems = getReviewItems; this.toDisplay = toReviewDisplayItem;`,
        context
    );
    return context;
}

function loadStageUpdateHelpers(stageMap) {
    const start = source.indexOf('function findNotificationTargetStage(notification)');
    const end = source.indexOf('async function approveStageNotification');
    const context = { appStagesMap: stageMap };
    vm.runInNewContext(
        `${source.slice(start, end)}; this.findTarget = findNotificationTargetStage; this.buildUpdate = buildStageUpdateFromNotification;`,
        context
    );
    return context;
}

test('review hall combines legacy pending stages with pending mail events', () => {
    const helpers = loadReviewHelpers(
        [{ id: 'legacy', stage_status: 'pending', created_at: '2026-09-01T00:00:00Z' }],
        [
            { id: 'notice', review_status: 'pending', proposed_stage_name: '技术一面', received_at: '2026-09-02T00:00:00Z' },
            { id: 'done', review_status: 'approved', proposed_stage_name: '在线测评', received_at: '2026-09-03T00:00:00Z' },
        ]
    );

    const items = helpers.getItems('pending');
    assert.equal(items.length, 2);
    assert.equal(items[0]._reviewKind, 'legacy_stage');
    assert.equal(items[1]._reviewKind, 'notification');
    assert.equal(items[1].stage_name, '技术一面');
});

test('reminders do not mutate a stage while reschedules only update arrangements', () => {
    const stage = { id: 'stage-2', seq: 2, stage_name: '技术一面', stage_status: 'scheduled' };
    const helpers = loadStageUpdateHelpers({ app: [stage] });
    const target = helpers.findTarget({ application_id: 'app', stage_id: 'stage-2', proposed_stage_name: '技术一面' });

    assert.equal(target.id, 'stage-2');
    assert.equal(Object.keys(helpers.buildUpdate({ event_type: 'reminder' }, target)).length, 0);
    const update = helpers.buildUpdate({
        event_type: 'reschedule',
        schedule_time: '2026-09-12 10:00',
        schedule_type: 'start',
        meeting_info: 'https://example.com',
    }, target);
    assert.equal(update.schedule_time, '2026-09-12 10:00');
    assert.equal(update.schedule_type, 'start');
    assert.equal(update.meeting_info, 'https://example.com');
    assert.equal(Object.hasOwn(update, 'stage_status'), false);
});

test('result and cancel events update status without creating round metadata', () => {
    const helpers = loadStageUpdateHelpers({});
    const resultUpdate = helpers.buildUpdate({ event_type: 'result', proposed_stage_status: 'passed' }, {});
    const cancelUpdate = helpers.buildUpdate({ event_type: 'cancel' }, {});

    assert.equal(resultUpdate.stage_status, 'passed');
    assert.equal(cancelUpdate.stage_status, 'cancelled');
    assert.equal(Object.hasOwn(resultUpdate, 'seq'), false);
    assert.equal(Object.hasOwn(cancelUpdate, 'seq'), false);
});

test('approved notifications choose a round from visible stages only', () => {
    const start = source.indexOf('async function approveStageNotification');
    const end = source.indexOf('async function ignoreStageNotification');
    const approvalSource = source.slice(start, end);
    assert.match(approvalSource, /stage_status !== 'ignored' && stage\.stage_status !== 'pending'/);
});

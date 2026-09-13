const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../android-app/src/supabase.js'), 'utf8')
    .replace('export const supabaseService = new SupabaseMobileService();', 'this.SupabaseMobileService = SupabaseMobileService;');

function createService(fetch) {
    const store = new Map([
        ['offerpilot_supabase_url', 'https://example.supabase.co'],
        ['offerpilot_supabase_key', 'anon-key']
    ]);
    const context = vm.createContext({
        fetch, console, WebSocket: class {}, clearInterval() {}, clearTimeout() {}, setInterval() {}, setTimeout() {},
        localStorage: { getItem: key => store.get(key) || '', setItem: (key, value) => store.set(key, value), removeItem: key => store.delete(key) }
    });
    vm.runInContext(source, context);
    return new context.SupabaseMobileService();
}

test('mobile data load includes independent recruitment events', async () => {
    const urls = [];
    const service = createService(async url => {
        urls.push(url);
        const body = url.includes('recruitment_events') ? [{ id: 'event-1', title: '双选会' }] : [];
        return { ok: true, json: async () => body };
    });
    const result = await service.fetchApplicationsWithStages();
    assert.equal(result.recruitmentEvents[0].id, 'event-1');
    assert.equal(urls.some(url => url.includes('/rest/v1/recruitment_events?')), true);
});

test('mobile focus update writes the shared application flag', async () => {
    let request;
    const service = createService(async (url, options) => {
        request = { url, options };
        return { ok: true, json: async () => [{ id: 'app-1', is_focused: true }] };
    });
    const row = await service.updateApplicationFocus('app-1', true);
    assert.match(request.url, /applications\?id=eq\.app-1$/);
    assert.equal(request.options.method, 'PATCH');
    assert.deepEqual(JSON.parse(request.options.body), { is_focused: true });
    assert.equal(row.is_focused, true);
});

test('mobile recruitment event writes calendar and focus choices together', async () => {
    let request;
    const service = createService(async (url, options) => {
        request = { url, options };
        return { ok: true, json: async () => [{ id: 'event-1' }] };
    });
    await service.saveRecruitmentEvent({ title: '招聘会', is_focused: true, in_calendar: true });
    assert.match(request.url, /recruitment_events$/);
    assert.equal(request.options.method, 'POST');
    assert.deepEqual(JSON.parse(request.options.body), { title: '招聘会', is_focused: true, in_calendar: true });
});

test('mobile stage creation ignores pending and ignored rows when choosing the next round', async () => {
    let sequenceQuery = '';
    let insertedStage = null;
    const service = createService(async (url, options = {}) => {
        if (url.includes('/applications?company=')) {
            return { ok: true, json: async () => [{ id: 'app-1', current_stage_name: '邮箱验证' }] };
        }
        if (url.includes('/application_stages?application_id=')) {
            sequenceQuery = url;
            return { ok: true, json: async () => [{ seq: 1 }] };
        }
        if (url.endsWith('/application_stages') && options.method === 'POST') {
            insertedStage = JSON.parse(options.body);
            return { ok: true, json: async () => [insertedStage] };
        }
        return { ok: true, json: async () => [{ id: 'app-1' }] };
    });

    await service.createApplicationWithStage(
        { company: '示例公司', position: '产品经理' },
        { stage_name: '技术一面', stage_status: 'scheduled' }
    );

    assert.match(sequenceQuery, /stage_status=not\.in\.\(pending,ignored\)/);
    assert.equal(insertedStage.seq, 2);
});

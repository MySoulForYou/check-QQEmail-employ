const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../client/admin/recruitment-events.js'), 'utf8');
function setup() {
    const message = { textContent: '' };
    const context = vm.createContext({
        console, Date,
        document: { getElementById: id => id === 'event-form-message' ? message : null },
        escapeHTML: text => String(text).replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
        normalizeWebsite: value => /^https?:\/\//.test(value) ? value : '',
        formatCalendarKey: date => date.getFullYear() + '-' + String(date.getMonth()+1).padStart(2,'0') + '-' + String(date.getDate()).padStart(2,'0'),
        renderCalendar: () => {}, showAdminToast: () => {},
        supabase: {},
    });
    vm.runInContext(source + '\nthis.api = {getRecruitmentEventCalendarEntries, renderRecruitmentEventAgenda, saveRecruitmentEvent, setEvents: value => recruitmentEvents = value};', context);
    return { context, api: context.api, message };
}
test('calendar only includes opted-in planned and attended events', () => {
    const { api } = setup();
    const base = { starts_at: '2026-09-06T09:00:00+08:00', in_calendar: true };
    api.setEvents([
        { ...base, id: '1', status: 'planned' },
        { ...base, id: '2', status: 'attended' },
        { ...base, id: '3', status: 'cancelled' },
        { ...base, id: '4', status: 'planned', in_calendar: false },
        { ...base, id: '5', status: 'planned', starts_at: 'bad' },
    ]);
    assert.deepEqual(Array.from(api.getRecruitmentEventCalendarEntries(), x => x.event.id), ['1','2']);
});
test('calendar opens event details and escapes activity text', () => {
    const { api } = setup();
    const html = api.renderRecruitmentEventAgenda({ date: new Date(), event: { id: 'id', title: '<script>', location: '<img>', status: 'planned' } });
    assert.match(html, /openRecruitmentEvent/);
    assert.doesNotMatch(html, /openTimelineDrawer|<script>|<img>/);
});
test('invalid end time prevents writes', async () => {
    const { api, context, message } = setup();
    context.supabase.from = () => { throw new Error('must not write'); };
    await api.saveRecruitmentEvent({
        preventDefault() {},
        currentTarget: {
            elements: { title: { value: '招聘会' }, starts_at: { value: '2026-09-06T10:00' }, ends_at: { value: '2026-09-06T09:00' } },
            querySelector: () => ({ disabled: false })
        }
    });
    assert.match(message.textContent, /结束时间不能早于/);
});
test('save persists one independent event and calendar choice', async () => {
    const { api, context } = setup();
    let saved;
    context.supabase.from = table => {
        assert.equal(table, 'recruitment_events');
        return { insert: async rows => { saved = rows; return { data: [{ id: 'new' }] }; } };
    };
    vm.runInContext('loadRecruitmentEvents = async () => {};', context);
    const values = { id: '', title: ' 校园双选会 ', organizer: '学校', event_type: '双选会', location: '体育馆', url: '', notes: '', starts_at: '2026-09-06T10:00', ends_at: '', status: 'planned' };
    const fields = Object.fromEntries(Object.entries(values).map(([key,value]) => [key,{value}]));
    fields.in_calendar = { checked: true };
    await api.saveRecruitmentEvent({ preventDefault() {}, currentTarget: { elements: fields, querySelector: () => ({disabled:false}) } });
    assert.equal(saved.length, 1);
    assert.equal(saved[0].title, '校园双选会');
    assert.equal(saved[0].in_calendar, true);
    assert.equal(saved[0].ends_at, null);
    assert.equal(saved[0].starts_at, new Date(values.starts_at).toISOString());
    assert.equal(saved[0].application_id, undefined);
});

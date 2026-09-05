// 独立活动记录，不混入 ATS 投递环节。
let recruitmentEvents = [];
let recruitmentEventFilter = 'planned';
let recruitmentEventsError = '';
const eventStatusLabels = { planned: '待参加', attended: '已参加', cancelled: '已取消' };

async function loadRecruitmentEvents() {
    if (!supabase) return;
    const result = await supabase.from('recruitment_events').select('*').order('starts_at', { ascending: true });
    if (result.error) {
        recruitmentEventsError = '招聘会数据暂不可用。首次启用请在 Supabase 执行 supabase/recruitment_events.sql；否则请检查连接与权限。';
    } else {
        recruitmentEvents = result.data || [];
        recruitmentEventsError = '';
    }
    renderRecruitmentEvents();
}

function setRecruitmentEventFilter(value) {
    recruitmentEventFilter = value;
    renderRecruitmentEvents();
}

function eventTimeText(value) {
    if (!value) return '待定';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '待定';
    return date.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
}

function renderRecruitmentEvents() {
    const list = document.getElementById('events-list');
    if (!list) return;
    document.getElementById('events-message').textContent = recruitmentEventsError || (!supabase ? '请先在设置中连接 Supabase。' : '');
    const query = (document.getElementById('events-search').value || '').trim().toLowerCase();
    document.querySelectorAll('#events-tabs button').forEach((button, index) => {
        button.classList.toggle('active', ['planned', 'attended', 'cancelled'][index] === recruitmentEventFilter);
    });
    const items = recruitmentEvents.filter(event => event.status === recruitmentEventFilter &&
        [event.title, event.organizer, event.location].some(value => String(value || '').toLowerCase().includes(query)))
        .sort((a, b) => Number(Boolean(b.is_focused)) - Number(Boolean(a.is_focused)) || new Date(a.starts_at) - new Date(b.starts_at));
    list.innerHTML = items.length ? items.map(event => {
        const url = normalizeWebsite(event.url);
        return '<article class="event-card' + (event.is_focused ? ' is-focused' : '') + '">' +
            '<div class="event-card-top"><span class="badge-tag badge-purple">' + escapeHTML(event.event_type) + '</span><div class="event-card-top-actions">' +
            '<button type="button" class="focus-toggle' + (event.is_focused ? ' is-active' : '') + '" onclick="toggleRecruitmentEventFocus(\'' + event.id + '\', this)" aria-label="' + (event.is_focused ? '取消重点关心' : '设为重点关心') + '" aria-pressed="' + Boolean(event.is_focused) + '" title="' + (event.is_focused ? '取消重点关心' : '设为重点关心') + '">★</button>' +
            '<span class="time-hint">' + (event.in_calendar && event.status !== 'cancelled' ? '已加入日历' : '未加入日历') + '</span></div></div>' +
            '<h2>' + escapeHTML(event.title) + '</h2><p>' + escapeHTML(event.organizer || '主办方未填写') + '</p>' +
            '<p class="event-time">开始 · ' + escapeHTML(eventTimeText(event.starts_at)) + (event.ends_at ? '<br>结束 · ' + escapeHTML(eventTimeText(event.ends_at)) : '') + '</p>' +
            '<p>地点 · ' + escapeHTML(event.location || '线上 / 待补充') + '</p>' +
            (event.notes ? '<p class="event-notes">' + escapeHTML(event.notes) + '</p>' : '') +
            '<div class="event-actions"><button class="btn-action-pill" onclick="openRecruitmentEvent(\'' + event.id + '\')">编辑 / 详情</button>' +
            (url ? '<a class="btn-action-pill" href="' + escapeHTML(url) + '" target="_blank" rel="noopener noreferrer">活动链接 ↗</a>' : '') +
            (event.status !== 'cancelled' ? '<button class="btn-action-pill" onclick="updateRecruitmentEvent(\'' + event.id + '\', {in_calendar:' + !event.in_calendar + '}, this)">' + (event.in_calendar ? '移出日历' : '加入日历') + '</button>' : '') +
            (event.status === 'planned' ? '<button class="btn-action-pill" onclick="updateRecruitmentEvent(\'' + event.id + '\', {status:\'attended\'}, this)">✓ 标为已参加</button>' : '') +
            '</div></article>';
    }).join('') : '<div class="events-empty">暂无匹配的招聘会。点击右上角“新增招聘会”记录活动。</div>';
}

function eventLocalInput(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return formatCalendarKey(date) + 'T' + String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
}

function openRecruitmentEvent(id) {
    const event = recruitmentEvents.find(item => item.id === id) || {};
    if (id && !event.id) return;
    let modal = document.getElementById('recruitment-event-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'recruitment-event-modal';
        modal.className = 'modal-backdrop';
        document.body.appendChild(modal);
    }
    modal.innerHTML = '<div class="modal-box" role="dialog" aria-modal="true" aria-labelledby="event-modal-title">' +
        '<div class="modal-header"><h3 id="event-modal-title">' + (id ? '招聘会详情与编辑' : '新增招聘会') + '</h3><button type="button" class="modal-close-x" onclick="closeRecruitmentEvent()" aria-label="关闭">×</button></div>' +
        '<form id="event-form"><div class="modal-body">' +
        '<input name="id" type="hidden">' +
        '<label class="event-field">活动名称 *<input name="title" required maxlength="160" placeholder="例如：秋季校园双选会"></label>' +
        '<label class="event-field">活动类型<select name="event_type"><option>招聘会</option><option>双选会</option><option>宣讲会</option></select></label>' +
        '<label class="event-field">主办方<input name="organizer" maxlength="160"></label>' +
        '<div class="form-row"><label class="event-field form-col">开始时间 *<input type="datetime-local" name="starts_at" required></label><label class="event-field form-col">结束时间<input type="datetime-local" name="ends_at"></label></div>' +
        '<label class="event-field">地点<input name="location" maxlength="300" placeholder="例如：学校体育馆二层"></label>' +
        '<label class="event-field">线上 / 活动链接<input name="url" type="url" placeholder="https://…"></label>' +
        '<label class="event-field">参加状态<select name="status"><option value="planned">待参加</option><option value="attended">已参加</option><option value="cancelled">已取消</option></select></label>' +
        '<label class="event-field">备注<textarea name="notes" rows="3" placeholder="目标企业、简历份数、注意事项"></textarea></label>' +
        '<label><input name="is_focused" type="checkbox"> 设为重点关心（在列表中优先显示）</label>' +
        '<label><input name="in_calendar" type="checkbox"> 加入求职日历（取消活动后自动隐藏）</label>' +
        '<p id="event-form-message" role="status"></p></div>' +
        '<div class="modal-footer"><button type="button" class="btn-modal-cancel" onclick="closeRecruitmentEvent()">取消</button><button type="submit" class="btn-modal-submit">保存活动</button></div></form></div>';
    const form = document.getElementById('event-form');
    ['id', 'title', 'organizer', 'location', 'url', 'notes'].forEach(key => form.elements[key].value = event[key] || '');
    form.elements.event_type.value = event.event_type || '招聘会';
    form.elements.status.value = event.status || 'planned';
    form.elements.starts_at.value = eventLocalInput(event.starts_at);
    form.elements.ends_at.value = eventLocalInput(event.ends_at);
    form.elements.is_focused.checked = Boolean(event.is_focused);
    form.elements.in_calendar.checked = event.in_calendar !== false;
    form.onsubmit = saveRecruitmentEvent;
    modal.style.display = 'flex';
    form.elements.title.focus();
}

function closeRecruitmentEvent() {
    const modal = document.getElementById('recruitment-event-modal');
    if (modal) modal.style.display = 'none';
}

async function saveRecruitmentEvent(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const fields = form.elements;
    const message = document.getElementById('event-form-message');
    const button = form.querySelector('[type="submit"]');
    if (!supabase) { message.textContent = '请先连接 Supabase。'; return; }
    const start = new Date(fields.starts_at.value);
    const end = fields.ends_at.value ? new Date(fields.ends_at.value) : null;
    if (!fields.title.value.trim() || Number.isNaN(start.getTime()) || (end && (Number.isNaN(end.getTime()) || end < start))) {
        message.textContent = '请填写活动名称和有效的开始时间；结束时间不能早于开始时间。';
        return;
    }
    const url = normalizeWebsite(fields.url.value.trim());
    if (fields.url.value.trim() && !url) { message.textContent = '活动链接仅支持 HTTP(S) 网址。'; return; }
    const payload = {
        title: fields.title.value.trim(), organizer: fields.organizer.value.trim(),
        event_type: fields.event_type.value, location: fields.location.value.trim(), url,
        notes: fields.notes.value.trim(), starts_at: start.toISOString(), ends_at: end ? end.toISOString() : null,
        status: fields.status.value, is_focused: Boolean(fields.is_focused?.checked),
        in_calendar: fields.in_calendar.checked, updated_at: new Date().toISOString()
    };
    button.disabled = true;
    try {
        const result = fields.id.value
            ? await supabase.from('recruitment_events').update(payload).eq('id', fields.id.value)
            : await supabase.from('recruitment_events').insert([payload]);
        if (result.error) throw result.error;
        if (!result.data?.length) throw new Error('未保存记录，请检查权限并刷新后重试。');
        closeRecruitmentEvent();
        await loadRecruitmentEvents();
        renderCalendar();
        showAdminToast('招聘会已保存', '活动与日历使用同一条记录');
    } catch (error) {
        message.textContent = '保存失败：' + (error.message || '请检查数据库连接') + '。首次启用请执行 recruitment_events.sql。';
    } finally { button.disabled = false; }
}

async function updateRecruitmentEvent(id, changes, button, successMessage = '招聘会已更新') {
    if (!supabase || !recruitmentEvents.some(event => event.id === id)) return;
    button.disabled = true;
    try {
        const result = await supabase.from('recruitment_events').update({ ...changes, updated_at: new Date().toISOString() }).eq('id', id);
        if (result.error) throw result.error;
        if (!result.data?.length) throw new Error('记录未更新，请刷新后重试。');
        await loadRecruitmentEvents();
        renderCalendar();
        if (successMessage) showAdminToast(successMessage);
    } catch (error) { showAdminToast('更新失败', error.message); }
    finally { button.disabled = false; }
}

async function toggleRecruitmentEventFocus(id, button) {
    const event = recruitmentEvents.find(item => item.id === id);
    if (!event) return;
    const isFocused = !event.is_focused;
    await updateRecruitmentEvent(id, { is_focused: isFocused }, button, '');
    if (recruitmentEvents.find(item => item.id === id)?.is_focused === isFocused) {
        showAdminToast(isFocused ? '已设为重点关心' : '已取消重点关心', event.title);
    }
}

function getRecruitmentEventCalendarEntries() {
    return recruitmentEvents.filter(event => event.in_calendar && event.status !== 'cancelled').flatMap(event => {
        const date = new Date(event.starts_at);
        if (Number.isNaN(date.getTime())) return [];
        return [{ event, date, key: formatCalendarKey(date) }];
    });
}

function renderRecruitmentEventAgenda(item) {
    return '<button type="button" class="calendar-agenda-item" onclick="openRecruitmentEvent(\'' + item.event.id + '\')">' +
        '<span class="calendar-agenda-time">' + escapeHTML(item.date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })) + '</span>' +
        '<strong>' + (item.event.is_focused ? '★ ' : '') + '招聘会 · ' + escapeHTML(item.event.title) + '</strong><small>' +
        escapeHTML(eventStatusLabels[item.event.status] + ' · ' + (item.event.location || '线上 / 待补充')) + '</small></button>';
}

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(
    path.join(__dirname, '../client/admin/supabase.js'),
    'utf8'
);

test('realtime join subscribes to the requested business tables', () => {
    const sockets = [];
    class FakeWebSocket {
        static OPEN = 1;
        constructor(url) {
            this.url = url;
            this.readyState = 1;
            this.messages = [];
            sockets.push(this);
        }
        send(message) { this.messages.push(JSON.parse(message)); }
        close() {}
    }

    const window = {};
    vm.runInNewContext(source, {
        window,
        WebSocket: FakeWebSocket,
        setInterval: () => 1,
        clearInterval: () => {},
        setTimeout: () => 1,
        console,
    });

    window.supabase.createClient('https://example.supabase.co', 'anon-key')
        .channel('admin_realtime')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'applications' }, () => {})
        .on('postgres_changes', { event: '*', schema: 'public', table: 'application_stages' }, () => {})
        .subscribe();

    sockets[0].onopen();
    const join = sockets[0].messages.find(message => message.event === 'phx_join');
    assert.deepEqual(
        Array.from(join.payload.config.postgres_changes, item => item.table),
        ['applications', 'application_stages']
    );
    assert.equal(join.payload.config.postgres_changes.some(item => item.table === 'tasks'), false);
});

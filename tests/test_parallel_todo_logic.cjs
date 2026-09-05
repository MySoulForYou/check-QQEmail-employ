const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadHelper(relativePath, nextFunction) {
    const source = fs.readFileSync(path.join(__dirname, relativePath), 'utf8');
    const start = source.indexOf('function getLatestStageContext');
    const end = source.indexOf(`function ${nextFunction}`, start);
    assert.ok(start >= 0 && end > start, `helper not found in ${relativePath}`);
    const context = vm.createContext({ Math });
    vm.runInContext(`${source.slice(start, end)}\nthis.helper = getLatestStageContext;`, context);
    return context.helper;
}

for (const [name, file, nextFunction] of [
    ['Web', '../client/admin/app.js', 'updateKPICards'],
    ['Android', '../android-app/src/app.js', 'getScheduleType']
]) {
    test(`${name} treats any scheduled stage in the latest parallel group as todo`, () => {
        const getLatestStageContext = loadHelper(file, nextFunction);
        const context = getLatestStageContext([
            { id: 'old', seq: 1, stage_status: 'awaiting_result' },
            { id: 'assessment', seq: 2, stage_status: 'awaiting_result' },
            { id: 'written', seq: 2, stage_status: 'scheduled' }
        ]);
        assert.equal(context.status, 'scheduled');
        assert.equal(context.representative.id, 'written');
        assert.deepEqual(Array.from(context.latestStages, stage => stage.id), ['assessment', 'written']);
    });
}

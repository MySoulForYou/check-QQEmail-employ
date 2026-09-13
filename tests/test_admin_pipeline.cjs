const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(
    path.join(__dirname, '../client/admin/app.js'),
    'utf8'
);
const functionStart = source.indexOf('function generatePipelineHTML(stages)');
const functionEnd = source.indexOf('function getPipelinePopover(trigger)');
const generatePipelineSource = source.slice(functionStart, functionEnd);

function createRenderer() {
    const context = {
        getStageStatusMeta: stage => ({
            category: stage.stage_status === 'offered' ? 'offer' : 'progress',
            timelineStatusText: stage.stage_status === 'scheduled' ? '待处理' : '已完成',
        }),
        escapeHTML: value => String(value || '').replace(/[&<>'"]/g, char => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;',
        }[char])),
    };

    vm.runInNewContext(
        `let pipelinePopoverSequence = 0; ${generatePipelineSource}; this.renderPipeline = generatePipelineHTML;`,
        context
    );
    return context.renderPipeline;
}

test('keeps a short two-round pipeline directly visible', () => {
    const renderPipeline = createRenderer();
    const html = renderPipeline([
        { seq: 1, stage_name: '投递邀请', stage_status: 'completed' },
        { seq: 2, stage_name: '第一轮面试', stage_status: 'scheduled' },
    ]);

    assert.match(html, /投递邀请/);
    assert.match(html, /第一轮面试/);
    assert.doesNotMatch(html, /pipeline-history-trigger/);
});

test('collapses earlier rounds into an accessible history popover', () => {
    const renderPipeline = createRenderer();
    const html = renderPipeline([
        { seq: 1, stage_name: '投递邀请', stage_status: 'completed' },
        { seq: 2, stage_name: '在线测评', stage_status: 'completed' },
        { seq: 3, stage_name: '在线笔试', stage_status: 'completed' },
        { seq: 4, stage_name: '第一轮面试', stage_status: 'scheduled' },
    ]);

    assert.match(html, /已完成 3 项/);
    assert.match(html, /popover="manual"/);
    assert.match(html, /aria-haspopup="dialog"/);
    assert.match(html, /此前进展/);
    assert.match(html, /第一轮面试/);
});

test('counts parallel hidden stages while retaining their round grouping', () => {
    const renderPipeline = createRenderer();
    const html = renderPipeline([
        { seq: 1, stage_name: '投递邀请', stage_status: 'completed' },
        { seq: 2, stage_name: '在线测评', stage_status: 'completed' },
        { seq: 2, stage_name: '性格测评', stage_status: 'completed' },
        { seq: 3, stage_name: '业务面试', stage_status: 'scheduled' },
    ]);

    assert.match(html, /已完成 3 项/);
    assert.match(html, /2 轮 · 3 项/);
    assert.match(html, /在线测评/);
    assert.match(html, /性格测评/);
});


(function (global) {
function approvedStageStatus(stage) {
    const name = (stage.stage_name || '').trim();
    if (/未通过|不通过|淘汰|拒绝|感谢信|流程终止/.test(name)) return 'failed';
    if (/已通过|通过通知|录用通知|正式offer/i.test(name)) return 'passed';
    if (/已完成|已提交|投递成功|提交成功|完成通知/.test(name)) return 'awaiting_result';
    return 'scheduled';
}

function confirmedSnapshot(stages) {
    const latest = stages.filter(s => !['pending', 'ignored'].includes(s.stage_status))
        .sort((a, b) => (a.seq || 1) - (b.seq || 1)).pop();
    return {
        current_stage_name: latest ? latest.stage_name : '待推进',
        overall_status: !latest ? 'active' : latest.stage_status === 'failed' ? 'failed'
            : latest.stage_status === 'passed' && /offer|录用|录取|入职/i.test(latest.stage_name) ? 'offered' : 'active'
    };
}

function isConfirmedOffer(app, stage) {
    if (app && ['archived', 'failed'].includes(app.overall_status)) return false;
    return Boolean((app && app.overall_status === 'offered') || (stage && (
        stage.stage_status === 'offered' || stage.stage_status === 'passed' && /offer|录用|录取|入职/i.test(stage.stage_name))));
}

global.OfferPilotProgress = { approvedStageStatus, confirmedSnapshot, isConfirmedOffer };
})(globalThis);

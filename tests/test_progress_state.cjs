const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const code = fs.readFileSync('client/admin/app.js', 'utf8');
function harness(stages, failApp = false) {
    const db = {application_stages: structuredClone(stages), applications: [{id:'a', overall_status:'active',updated_at:'old-app'}]};
    const alerts=[];
    const scope = {allStages:structuredClone(stages), allApplications:structuredClone(db.applications), console,
        confirm:()=>true, alert:m=>alerts.push(m), showAdminToast(){},loadAllData:async()=>{},
        setTimeout(){}, openTimelineDrawer(){}, escapeHTML:s=>s,
        supabase:{from(table) {
            let patch, filters=[];
            const q = {update(p){patch=p;return q},eq(k,v){filters.push(r=>r[k]===v);return q},select(){return q},
                then(resolve,reject){
                    if(table==='applications' && failApp) return Promise.resolve({error:{message:'offline'}}).then(resolve,reject);
                    const rows=db[table].filter(r=>filters.every(f=>f(r)));
                    rows.forEach(r=>Object.assign(r,patch));
                    return Promise.resolve({data:rows,error:null}).then(resolve,reject);
                }};
            return q;
        }}
    };
    vm.createContext(scope);
    vm.runInContext(fs.readFileSync('client/admin/progress.js','utf8'),scope);
    Object.assign(scope, scope.OfferPilotProgress);
    vm.runInContext(code.slice(code.indexOf('// 两表写入失败'),code.indexOf('function generatePipelineHTML')),scope);
    vm.runInContext(code.slice(code.indexOf('async function batchApproveAllStages'),code.indexOf('// 忽略归档底层函数')),scope);
    vm.runInContext(code.slice(code.indexOf('async function rollbackCurrentStage'),code.indexOf('// 投递单整体归档')),scope);
    return {scope, db, alerts};
}
const stage=(id,seq,status,name='在线笔试')=>({id,seq,stage_status:status,stage_name:name,application_id:'a',updated_at:'old'});
test('single and batch approvals retain invitations as todo, never pass earlier records',async()=>{
    const rows=[stage('s1',1,'ignored'),stage('s2',2,'pending','面试邀请')];
    const single=harness(rows), batch=harness(rows);
    await single.scope.approveStage('s2'); await batch.scope.batchApproveAllStages();
    for(const h of [single,batch]) {
        assert.equal(h.db.application_stages[0].stage_status,'ignored');
        assert.equal(h.db.application_stages[1].stage_status,'scheduled');
    }
});
test('conservative approval separates explicit completion and result from scheduling',()=>{
    const {scope}=harness([]);
    for(const [name,status] of [['投递邀请','scheduled'],['综合测评','scheduled'],['投递成功','awaiting_result'],['笔试已通过','passed'],['面试未通过','failed'],['HR面试','scheduled']])
        assert.equal(scope.approvedStageStatus({stage_name:name}),status);
});
test('parent failure restores stage and does not report success',async()=>{
    const h=harness([stage('s',1,'pending')],true);
    assert.equal(await h.scope.approveStage('s'),false);
    assert.equal(h.db.application_stages[0].stage_status,'pending');
    assert.match(h.alerts[0],/offline/);
});
test('rollback keeps previous status and removes stale offered snapshot',async()=>{
    const h=harness([stage('s1',1,'scheduled','一面'),stage('s2',2,'passed','正式Offer'),stage('s3',3,'pending')]);
    h.db.applications[0].overall_status='offered';
    await h.scope.rollbackCurrentStage('a','s2');
    assert.equal(h.db.application_stages[0].stage_status,'scheduled');
    assert.equal(h.db.application_stages[2].stage_status,'pending');
    assert.equal(h.db.applications[0].current_stage_name,'一面');
    assert.equal(h.db.applications[0].overall_status,'active');
});
test('editing historical stage does not overwrite latest confirmed snapshot',async()=>{
    const h=harness([stage('s1',1,'passed'),stage('s2',2,'scheduled','二面')]);
    await h.scope.saveStageChange(h.scope.allStages[0],{stage_name:'在线测评'});
    assert.equal(h.db.applications[0].current_stage_name,'二面');
});
test('passed is not awaiting result and HR interview is not offer',()=>{
    const {scope}=harness([]);
    assert.equal(scope.getStageStatusMeta(stage('s',1,'passed','一面')).timelineStatusText,'已通过');
    assert.notEqual(scope.getStageStatusMeta(stage('s',1,'scheduled','HR面试')).category,'offer');
});
test('database mutation HTTP failure rejects even if caller ignores returned error',async()=>{
    const scope={fetch:async()=>({ok:false,text:async()=>'{"message":"denied"}'})};
    vm.createContext(scope); vm.runInContext(fs.readFileSync('client/admin/supabase.js','utf8'),scope);
    await assert.rejects(async()=>await scope.supabase.createClient('http://invalid','fake').from('application_stages').update({stage_status:'passed'}).eq('id','s'),/denied/);
});

test('stale stage edits are rejected without overwriting concurrent changes',async()=>{
    const h=harness([stage('s',1,'scheduled')]);
    h.db.application_stages[0].updated_at='external';
    await assert.rejects(h.scope.saveStageChange(h.scope.allStages[0],{stage_status:'passed'}),/已变化/);
    assert.equal(h.db.application_stages[0].stage_status,'scheduled');
});
test('offer invitation is not counted as confirmed offer',()=>{
    const {scope}=harness([]);
    assert.equal(scope.isConfirmedOffer({overall_status:'active'},stage('s',1,'scheduled','Offer沟通')),false);
    assert.equal(scope.isConfirmedOffer({overall_status:'active'},stage('s',1,'passed','正式Offer')),true);
});

test('editing an archived application does not implicitly reactivate it',async()=>{
    const h=harness([stage('s',1,'scheduled')]);
    h.scope.allApplications[0].overall_status='archived';
    h.db.applications[0].overall_status='archived';
    await h.scope.saveStageChange(h.scope.allStages[0],{stage_name:'一面'});
    assert.equal(h.db.applications[0].overall_status,'archived');
});

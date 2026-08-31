const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
function service() {
    const scope={localStorage:{getItem:()=>''},fetch:async()=>{throw new Error('unexpected network')}};
    vm.createContext(scope);
    vm.runInContext(fs.readFileSync('client/admin/progress.js','utf8'),scope);
    const source=fs.readFileSync('android-app/src/supabase.js','utf8').replace(/^import .*;\n/,'').replace('export const supabaseService =','globalThis.service =');
    vm.runInContext(source,scope);
    return {service:scope.service,scope};
}
test('mobile edit restores previous stage when parent save fails',async()=>{
    const {service:s}=service();
    const stage={id:'s',application_id:'a',stage_name:'一面',stage_status:'scheduled',seq:1,updated_at:'old'};
    s.fetchApplicationsWithStages=async()=>({stages:[structuredClone(stage)]});
    s.writeRecord=async(table,query,patch)=>{if(table==='applications')throw new Error('offline');Object.assign(stage,patch);return [stage]};
    await assert.rejects(s.updateStageStatus('s','awaiting_result'),/offline/);
    assert.equal(stage.stage_status,'scheduled');assert.equal(stage.updated_at,'old');
});
test('mobile creation keeps different roles separate and does not auto-pass previous stages',async()=>{
    const {service:s}=service();
    s.fetchApplicationsWithStages=async()=>({applications:[{id:'old',company:'公司',position:'开发',department:'',overall_status:'active'}],stages:[]});
    const writes=[];
    s.writeRecord=async(table,query,data)=>{writes.push({table,data});return [{...data,id:table==='applications'?'new':'s'}]};
    s.updateStageStatus=async()=>{};
    await s.createApplicationWithStage({company:'公司',position:'测试',department:''},{stage_name:'网申',stage_status:'scheduled'});
    assert.equal(writes[0].table,'applications');
    assert.equal(writes[1].data.application_id,'new');
    assert.equal(writes[1].data.stage_status,'pending');
});
test('mobile batch and single approval share conservative result mapping',async()=>{
    const {service:s}=service();
    s.fetchApplicationsWithStages=async()=>({stages:[{id:'s',stage_name:'投递邀请',stage_status:'pending'}]});
    const writes=[];s.updateStageStatus=async(id,status)=>writes.push(status);
    await s.approveStage('s');await s.batchApproveStages(['s']);
    assert.deepEqual(writes,['scheduled','scheduled']);
});
test('mobile deletion is recoverable ignore and HTTP errors reject',async()=>{
    const {service:s,scope}=service();
    s.updateStageStatus=async(id,status)=>assert.equal(status,'ignored');await s.deleteStage('s');
    s.url='https://invalid';s.key='fake';scope.fetch=async()=>({ok:false,status:403});
    await assert.rejects(s.writeRecord('applications','id=eq.a',{}),/403/);
});

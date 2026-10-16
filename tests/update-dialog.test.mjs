import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createUpdateDialog} from '../web/update-dialog.js';
function setup({reply,save=true,error=null}={}){
 const nodes=new Map(),$=id=>{if(!nodes.has(id))nodes.set(id,{showModal(){this.open=true;},close(){this.open=false;},removeAttribute(name){delete this[name];}});return nodes.get(id);};
 let installs=0,saves=0;const busy=[];
 const dialog=createUpdateDialog({document:{getElementById:$},onBusy:value=>busy.push(value),hasPhotos:()=>true,beforeInstall:async()=>{saves++;return save;},invoke:async command=>{if(command==='check_app_update'){if(error)throw error;return reply;}if(command==='install_app_update')installs++;}});
 return {$,dialog,busy,get installs(){return installs;},get saves(){return saves;}};
}
test('unconfigured and network failures never report up to date or permit install',async()=>{
 for(const config of [{reply:{current:'0.1.0',configured:false}},{error:Error('Offline')}]){
  const s=setup(config);await s.dialog.open();assert.equal(s.$('updateInstall').disabled,true);assert.doesNotMatch(s.$('updateMessage').textContent,/latest version/);s.$('updateClose').onclick();assert.equal(s.busy.at(-1),false);
 }
});
test('development mode cannot install a reported update',async()=>{
 const s=setup({reply:{current:'0.1.0',configured:true,version:'0.2.0',can_install:false}});await s.dialog.open();assert.equal(s.$('updateInstall').disabled,true);await s.$('updateInstall').onclick();assert.equal(s.installs,0);
});
test('project save cancellation postpones install; success allows install',async()=>{
 for(const save of [false,true]){const s=setup({save,reply:{current:'0.1.0',configured:true,version:'0.2.0',can_install:true,notes:'<script>plain text notes</script>'}});await s.dialog.open();assert.equal(s.$('updateNotes').textContent,'<script>plain text notes</script>');await s.$('updateInstall').onclick();assert.equal(s.saves,1);assert.equal(s.installs,save?1:0);}
});

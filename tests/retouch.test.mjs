import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {retouchPixels,createRetouchDialog} from '../web/retouch.js';
import {defaultTone,validTone} from '../web/tone.js';
function portrait(){const data=new Uint8ClampedArray(9*9*4);for(let i=0;i<data.length;i+=4)data.set([210,160,130,255],i);data.set([198,148,118,255],(4*9+4)*4);data.set([0,0,0,255],0);data.set([0,110,230,255],4);data.set([210,160,130,0],8);return data;}
test('retouch smooths small skin variation, preserves hard edges, alpha, zero strength and dimensions',()=>{
 const original=portrait(),zero=portrait();retouchPixels(zero,9,9,0);assert.deepEqual(zero,original);
 const low=portrait(),high=portrait();retouchPixels(low,9,9,20);retouchPixels(high,9,9,100);
 const p=(4*9+4)*4;assert.ok(high[p]>low[p]&&low[p]>original[p]);
 assert.deepEqual(high.slice(0,12),original.slice(0,12));assert.equal(high.length,original.length);assert.equal(high.reduce((sum,v,i)=>sum+v*(i+1),0),9934394);
 assert.throws(()=>retouchPixels(high,9,9,NaN));assert.equal(validTone({...defaultTone(),retouch:101}),false);
 assert.equal(validTone({...defaultTone(),retouch:40}),true);
});
test('Before and Cancel preserve existing edits; Apply commits slider even with Before selected',async()=>{
 const elements=new Map();for(const [,id] of fs.readFileSync(new URL('../web/index.html',import.meta.url),'utf8').matchAll(/id="([^"]+)"/g))elements.set(id,{value:'',checked:false,showModal(){},close(){}});
 const $=id=>elements.get(id),previews=[],closed=[];
 const dialog=createRetouchDialog({document:{getElementById:$},onPreview:t=>previews.push(t),onClose:apply=>closed.push(apply)});
 const original={...defaultTone(),retouch:12};dialog.open(original);
 $('retouchStrength').value='60';$('retouchStrength').oninput();$('retouchAfter').checked=false;$('retouchBefore').checked=true;$('retouchBefore').onchange();assert.equal(previews.at(-1).retouch,12);
 $('retouchApply').onclick();assert.equal(previews.at(-1).retouch,60);assert.deepEqual(closed,[true]);
 dialog.open(original);$('retouchStrength').value='90';$('retouchStrength').oninput();$('retouchCancel').onclick();assert.equal(previews.at(-1).retouch,12);
 const count=previews.length;await new Promise(r=>setTimeout(r,60));assert.equal(previews.length,count);assert.equal(original.retouch,12);
});

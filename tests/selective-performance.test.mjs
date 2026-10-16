import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applySelective,selectivePixel,defaultSelective,createSelectiveDialog,colorRanges} from '../web/selective-color.js';
test('optimized pixel buffer matches reference for all ranges and both methods',()=>{
 for(const method of ['relative','absolute'])for(const range of [...colorRanges,'all']){
  const s=defaultSelective();s.method=method;
  for(const name of range==='all'?colorRanges:[range])s.ranges[name]=[37,-61,22,-13];
  const data=new Uint8ClampedArray(4096),expected=new Uint8ClampedArray(data.length);
  for(let i=0;i<data.length;i++)data[i]=(i*37+(i>>>5))%256;
  expected.set(data);
  for(let i=0;i<data.length;i+=4)expected.set(selectivePixel([...data.subarray(i,i+3)],s),i);
  applySelective(data,s);assert.deepEqual(data,expected,method+' '+range);
 }
});
test('slider events coalesce; Apply and Cancel discard pending callbacks',()=>{
 const elements=new Map(),$=id=>{if(!elements.has(id))elements.set(id,{value:'',close(){},showModal(){}});return elements.get(id);};
 const frames=new Map(),seen=[];let sequence=0;
 const dialog=createSelectiveDialog({document:{getElementById:$},onPreview:(t,options)=>seen.push({t,options}),onClose(){},schedule:fn=>{frames.set(++sequence,fn);return sequence;},cancel:id=>frames.delete(id)});
 const original={selective:defaultSelective()};dialog.open(original);
 for(let i=1;i<=20;i++){$('selectiveCyan').value=String(i);$('selectiveCyan').oninput();}
 assert.equal(frames.size,1);assert.equal(seen.length,0);
 const callback=[...frames.values()][0];frames.clear();callback();assert.equal(seen[0].t.selective.ranges.reds[0],20);
 $('selectiveCyan').value='45';$('selectiveCyan').oninput();$('selectiveApply').onclick();assert.equal(frames.size,0);assert.equal(seen.at(-1).t.selective.ranges.reds[0],45);assert.equal(seen.at(-1).options,undefined);
 dialog.open(original);$('selectiveCyan').value='80';$('selectiveCyan').oninput();const stale=[...frames.values()][0];$('selectiveCancel').onclick();stale();assert.equal(frames.size,0);assert.deepEqual(seen.at(-1).t,original);
});

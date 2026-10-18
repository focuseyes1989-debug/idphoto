import fs from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyBrushes,validBrushes,brushedCanvas} from '../web/brush.js';
import {defaultTone,validTone} from '../web/tone.js';
function source(){const a=new Uint8ClampedArray(20*20*4);for(let y=0;y<20;y++)for(let x=0;x<20;x++)a.set([x<10?50:200,100,100,255],(y*20+x)*4);return a;}
const stroke=kind=>({kind,radius:.2,strength:.8,points:[[.45,.5],[.6,.5]]});
test('soft brush tools affect painted region with distinct results and preserve alpha',()=>{
 const original=source(),outputs=[];
 for(const kind of ['Blur','Sharpen','Smudge']){
  const a=source();applyBrushes(a,20,20,[stroke(kind)]);assert.notDeepEqual(a,original);assert.deepEqual(a.slice(0,80),original.slice(0,80));
  for(let p=3;p<a.length;p+=4)assert.equal(a[p],255);assert.equal(a.reduce((sum,v,i)=>sum+v*(i+1),0),{Blur:186313631,Sharpen:186297549,Smudge:184877122}[kind]);outputs.push(a);
 }
 assert.notDeepEqual(outputs[0],outputs[1]);assert.notDeepEqual(outputs[0],outputs[2]);
 assert.equal(validTone({...defaultTone(),brushes:[stroke('Blur')]}),true);
 assert.equal(validBrushes([{...stroke('Blur'),points:[[NaN,0]]}]),false);
 assert.equal(validBrushes([{...stroke('Blur'),radius:5}]),false);
 const zero=source();applyBrushes(zero,20,20,[{...stroke('Blur'),strength:0}]);assert.deepEqual(zero,original);
});

test('brush buttons belong to the left toolbar and Tools menu entries have icons',()=>{
 const html=fs.readFileSync(new URL('../web/index.html',import.meta.url),'utf8');
 const toolbar=html.match(/<nav class="tool-bar"[\s\S]*?<\/nav>/)?.[0];
 assert.ok(toolbar);
 for(const kind of ['Blur','Sharpen','Smudge']){
  assert.ok(toolbar.includes('id="tool'+kind+'"'));
  assert.equal(html.split('id="tool'+kind+'"').length-1,1);
  assert.match(html,new RegExp('<button id="menu'+kind+'" class="menu-icon-item"><svg'));
 }
});

test('incremental brush cache matches full replay, reuses unchanged pixels and resets on Undo',()=>{
 let writes=0;
 const base={width:20,height:20};
 const document={createElement(){let pixels;return {width:0,height:0,getContext(){return {drawImage(){pixels=source();},getImageData(){return {data:pixels.slice()};},putImageData(p){pixels=p.data.slice();writes++;}};},pixels(){return pixels;}};}};
 const first={...stroke('Blur'),points:[[.45,.5]]};
 const c=brushedCanvas(document,base,[first]);const before=writes;assert.equal(brushedCanvas(document,base,[first]),c);assert.equal(writes,before);
 first.points.push([.6,.5]);const extended=brushedCanvas(document,base,[first]);const expected=source();applyBrushes(expected,20,20,[first]);assert.deepEqual(extended.pixels(),expected);
 const second=stroke('Smudge');const composed=brushedCanvas(document,base,[first,second]);applyBrushes(expected,20,20,[second]);assert.deepEqual(composed.pixels(),expected);
 const undone=brushedCanvas(document,base,[first]);const undoExpected=source();applyBrushes(undoExpected,20,20,[first]);assert.deepEqual(undone.pixels(),undoExpected);
});

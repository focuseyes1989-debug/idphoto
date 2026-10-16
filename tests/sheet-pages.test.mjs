import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mixedSheetPages,defaultPaper,paperBounds} from '../web/geometry.js';
test('eight people with three copies paginate without dropping or overlapping photos',()=>{
 const items=Array.from({length:8},()=>({width_mm:27.94,height_mm:33.02,count:3}));
 const paper={...defaultPaper(),left_mm:5.08,right_mm:5.08,top_mm:2.54,bottom_mm:2.54};
 const result=mixedSheetPages(items,300,2.54,paper),bounds=paperBounds(paper,300);
 assert.equal(result.error,null);assert.deepEqual(result.pages.map(p=>p.length),[12,12]);
 const all=result.pages.flat();for(let i=0;i<8;i++)assert.equal(all.filter(p=>p.index===i).length,3);
 for(const page of result.pages){
  assert.deepEqual([page[0].x,page[0].y],[60,30]);
  for(const [i,a] of page.entries()){
   assert.ok(a.x+a.width<=bounds.left+bounds.usableWidth&&a.y+a.height<=bounds.top+bounds.usableHeight);
   for(const b of page.slice(i+1))assert.ok(a.x+a.width<=b.x||b.x+b.width<=a.x||a.y+a.height<=b.y||b.y+b.height<=a.y);
  }
 }
 assert.equal(mixedSheetPages(items,300,2.54,{...paper,left_mm:90}).pages.length,0);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {cropRect,sheetLayout,validSettings,toMillimeters,fromMillimeters,normalizeAngle,rotatedSize,mixedSheetLayout,paperBounds,defaultPaper,zoomSheetView} from '../web/geometry.js';
test('crop preserves target aspect ratio and stays in image at edges',()=>{for(const pan of [{x:0,y:0},{x:1,y:1},{x:.5,y:.5}])for(const zoom of [1,2,4]){const r=cropRect(1600,900,35/45,zoom,pan);assert.ok(Math.abs(r.width*1600/(r.height*900)-35/45)<1e-9);assert.ok(r.x>=0&&r.y>=0&&r.x+r.width<=1.000001&&r.y+r.height<=1.000001);}});
test('35 × 45 mm fits six photos and 2 inch squares fit six without gaps',()=>{assert.deepEqual([sheetLayout({width_mm:35,height_mm:45,dpi:300,gap_mm:3}).cols,sheetLayout({width_mm:35,height_mm:45,dpi:300,gap_mm:3}).rows],[2,3]);const s=sheetLayout({width_mm:50.8,height_mm:50.8,dpi:300,gap_mm:0});assert.equal(s.cols*s.rows,6);});
test('invalid sizes are blocked',()=>{assert.equal(validSettings({width_mm:0,height_mm:45,dpi:300,gap_mm:3}),false);});
test('sheet viewport zoom anchors the mouse position and respects zoom limits',()=>{
 const initial={zoom:1,x:20,y:-10},anchor={x:100,y:50};
 const zoomed=zoomSheetView(initial,2,anchor);
 assert.equal((anchor.x-zoomed.x)/zoomed.zoom,(anchor.x-initial.x)/initial.zoom);
 assert.equal((anchor.y-zoomed.y)/zoomed.zoom,(anchor.y-initial.y)/initial.zoom);
 assert.deepEqual(zoomSheetView(zoomed,1,anchor),initial);
 assert.equal(zoomSheetView(initial,100,anchor).zoom,8);assert.equal(zoomSheetView(initial,.01,anchor).zoom,.25);
});
test('A4 asymmetric margins match export bounds and constrain both sheet layouts',()=>{
 const paper={width_mm:210,height_mm:297,left_mm:10,right_mm:20,top_mm:15,bottom_mm:5};
 assert.deepEqual(paperBounds(paper,300),{width:2480,height:3508,left:118,top:177,usableWidth:2126,usableHeight:3272,error:null});
 const s={width_mm:35,height_mm:45,dpi:300,gap_mm:3,paper};const single=sheetLayout(s);assert.equal(single.cols,4);assert.equal(single.rows,5);
 const mixed=mixedSheetLayout([{width_mm:35,height_mm:45,count:2}],300,3,paper);assert.equal(mixed.error,null);assert.equal(mixed.placements[0].x,118);assert.equal(mixed.placements[0].y,177);
 assert.ok(paperBounds({...paper,left_mm:210},300).error);
 assert.ok(mixedSheetLayout([{width_mm:35,height_mm:45,count:1}],300,3,{...defaultPaper(),left_mm:80}).error);
});
test('mixed sheet matches export coordinates and rejects incomplete or excessive quantities',()=>{
 const a={width_mm:35,height_mm:45,count:2},b={width_mm:35,height_mm:45,count:4};
 const layout=mixedSheetLayout([a,b],300,3);assert.equal(layout.error,null);assert.equal(layout.placements.length,6);
 assert.deepEqual(layout.placements[0],{index:0,x:0,y:0,width:413,height:531});
 assert.deepEqual(layout.placements.map(p=>p.index),[0,0,1,1,1,1]);
 assert.ok(mixedSheetLayout([{...a,count:7}],300,3).error);
 for(const count of [0,-1,.5,NaN,101])assert.ok(mixedSheetLayout([{...a,count}],300,3).error);
 const none=mixedSheetLayout([{width_mm:NaN,height_mm:NaN,count:0},a],300,3);assert.equal(none.error,null);
});
test('free rotation bounds support both directions and exact quarter turns',()=>{
 assert.deepEqual(rotatedSize(700,900,90),{width:900,height:700});
 assert.deepEqual(rotatedSize(700,900,0),{width:700,height:900});
 assert.deepEqual(rotatedSize(700,900,12.5),rotatedSize(700,900,-12.5));
 assert.equal(normalizeAngle(359.9),-.1);assert.equal(normalizeAngle(-181),179);
});
test('equivalent inch, cm and mm sizes produce identical print layouts',()=>{
 const layouts=[['in',2,2,0.1],['cm',5.08,5.08,0.254],['mm',50.8,50.8,2.54]].map(([unit,w,h,g])=>{
  const s={width_mm:toMillimeters(w,unit),height_mm:toMillimeters(h,unit),gap_mm:toMillimeters(g,unit),dpi:300};
  assert.ok(validSettings(s));assert.equal(Math.round(s.width_mm/25.4*s.dpi),600);return sheetLayout(s);
 });
 assert.deepEqual(layouts[0],layouts[1]);assert.deepEqual(layouts[1],layouts[2]);
 assert.equal(fromMillimeters(35,'cm'),3.5);assert.equal(fromMillimeters(50.8,'in'),2);
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {defaultPaper,sheetLayout,mixedSheetLayout,sheetGaps,paperBounds} from '../web/geometry.js';
import {loadPaperPreferences,savePaperPreferences} from '../web/preferences.js';

test('independent column and row gaps use identical single/mixed pixel spacing',()=>{
 const paper={...defaultPaper(),column_gap_mm:2,row_gap_mm:7};
 const single=sheetLayout({paper,width_mm:35,height_mm:45,dpi:300,gap_mm:3});
 assert.equal(single.cols,2);assert.equal(single.rows,3);
 const mixed=mixedSheetLayout([{width_mm:35,height_mm:45,count:6}],300,3,paper);
 assert.equal(mixed.error,null);assert.equal(mixed.placements[1].x,437);assert.equal(mixed.placements[2].y,614);
 assert.ok(mixedSheetLayout([{width_mm:35,height_mm:45,count:6}],300,3,{...paper,row_gap_mm:20}).error);
 assert.equal(sheetLayout({paper:{...paper,row_gap_mm:20},width_mm:35,height_mm:45,dpi:300,gap_mm:3}).rows,2);
 assert.ok(paperBounds({...paper,column_gap_mm:-1}).error);assert.ok(paperBounds({...paper,row_gap_mm:NaN}).error);
});
test('old gap preferences fall back; axis overrides survive storage round trip',()=>{
 const data=new Map(),storage={setItem:(k,v)=>data.set(k,v),getItem:k=>data.get(k)};
 const prefs={version:1,paper:defaultPaper(),unit:'in',orientation:'portrait',preset:'101.6,152.4',linked:false,gap_mm:3};
 assert.equal(savePaperPreferences(storage,prefs),true);assert.deepEqual(sheetGaps(3,loadPaperPreferences(storage).paper),{column:3,row:3});
 prefs.paper.column_gap_mm=2;prefs.paper.row_gap_mm=7;assert.equal(savePaperPreferences(storage,prefs),true);
 assert.deepEqual(sheetGaps(3,loadPaperPreferences(storage).paper),{column:2,row:7});
 prefs.paper.row_gap_mm=21;assert.equal(savePaperPreferences(storage,prefs),false);
 assert.deepEqual(sheetGaps(3,loadPaperPreferences(storage).paper),{column:2,row:7});
});

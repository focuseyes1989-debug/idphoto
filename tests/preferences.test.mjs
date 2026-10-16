import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadPaperPreferences,savePaperPreferences,PAPER_SETTINGS_KEY} from '../web/preferences.js';
const settings=()=>({version:1,paper:{width_mm:297,height_mm:210,left_mm:10,right_mm:10,top_mm:10,bottom_mm:10},unit:'in',orientation:'landscape',preset:'210,297',linked:true,gap_mm:2.54,dpi:600,sheet_mode:'mixed',panel_visible:true,sheet_contents_visible:true,paper_settings_visible:true,background_strength:40,background_color:'red',photo_size:{width_mm:40,height_mm:33.02,unit:'cm',preset:'custom'}});
test('paper settings survive storage round trip including link and custom size',()=>{
 const data=new Map(),storage={getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)};
 assert.equal(loadPaperPreferences(storage),null);
 const value=settings();assert.equal(savePaperPreferences(storage,value),true);assert.deepEqual(loadPaperPreferences(storage),value);
 value.linked=false;value.paper.right_mm=15;value.preset='custom';value.paper.width_mm=250;
 savePaperPreferences(storage,value);assert.deepEqual(loadPaperPreferences(storage),value);
 const invalid={...value,paper:{...value.paper,left_mm:300}};
 assert.equal(savePaperPreferences(storage,invalid),false);assert.deepEqual(loadPaperPreferences(storage),value);
 data.set(PAPER_SETTINGS_KEY,'invalid json');assert.equal(loadPaperPreferences(storage),null);
 data.set(PAPER_SETTINGS_KEY,JSON.stringify({...value,version:99}));assert.equal(loadPaperPreferences(storage),null);
});
test('older paper preferences receive print defaults without losing paper settings',()=>{
 const legacy=settings();delete legacy.gap_mm;delete legacy.dpi;delete legacy.sheet_mode;delete legacy.background_strength;delete legacy.background_color;delete legacy.photo_size;
 const restored=loadPaperPreferences({getItem:()=>JSON.stringify(legacy)});
 assert.deepEqual(restored.paper,legacy.paper);assert.equal(restored.linked,true);
 assert.deepEqual(restored.photo_size,{width_mm:27.94,height_mm:33.02,unit:'in',preset:'27.94,33.02'});assert.equal(restored.background_color,'white');assert.equal(restored.background_strength,100);assert.equal(restored.gap_mm,3);assert.equal(restored.dpi,300);assert.equal(restored.sheet_mode,'single');
 for(const invalid of [{photo_size:{width_mm:0,height_mm:33.02,unit:'in',preset:'custom'}},{photo_size:{width_mm:40,height_mm:33.02,unit:'cm',preset:'35,45'}},{background_color:'green'},{gap_mm:-1},{dpi:0},{sheet_mode:'unknown'},{background_strength:-1},{background_strength:101},{background_strength:0.5},{background_strength:NaN}])assert.equal(savePaperPreferences({setItem(){throw Error('Must not save invalid preferences');}},{...settings(),...invalid}),false);
});

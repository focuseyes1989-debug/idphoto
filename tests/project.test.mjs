import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validProject,decodeProjectPhotos} from '../web/project.js';
import {defaultPaper} from '../web/geometry.js';
import {defaultTone} from '../web/tone.js';
const fixture=()=>({version:1,active:0,viewMode:'sheet',sheetView:{zoom:2,x:30,y:-20},settings:{version:1,paper:defaultPaper(),unit:'in',orientation:'portrait',preset:'101.6,152.4',linked:false},documents:[{id:1,name:'Portrait.png',sheetCount:3,edits:{zoom:1.5,pan:{x:.4,y:.6},rotation:12.5,backgroundRemoved:true,backgroundStrength:45,background:'blue',tool:'Rotate',unit:'in',preset:'27.94,33.02',dpi:'300',physical:{width_mm:27.94,height_mm:33.02,gap_mm:3},adjustments:defaultTone()}}]});
test('project metadata and prepared images restore independent editable state',async()=>{
 const manifest=fixture();manifest.documents[0].edits.tool='Smudge';manifest.documents[0].edits.adjustments.brushes=[{kind:'Smudge',radius:.1,strength:.3,points:[[.4,.5],[.5,.5]]}];assert.equal(validProject(manifest),true);
 const photos=[{id:42,name:'Portrait.png',width:700,height:900,preview:'source',cutout_preview:'cutout'}];
 class Image {async decode(){}}
 const restored=await decodeProjectPhotos({manifest,photos},Image);
 assert.equal(restored[0].id,42);assert.equal(restored[0].cutoutStrength,45);assert.equal(restored[0].sheetCount,3);assert.deepEqual(restored[0].edits,manifest.documents[0].edits);
 restored[0].edits.pan.x=.9;assert.equal(manifest.documents[0].edits.pan.x,.4);
});
test('corrupt metadata, missing cutouts and failed image decoding reject before commit',async()=>{
 const p=fixture();p.documents[0].edits.pan.x=NaN;assert.equal(validProject(p),false);
 const future=fixture();future.version=2;assert.equal(validProject(future),false);
 const image={id:2,width:700,height:900,preview:'bad'};
 class Image {async decode(){}}
 await assert.rejects(decodeProjectPhotos({manifest:fixture(),photos:[image]},Image),/missing/);
 class BrokenImage {async decode(){throw Error('decode failed');}}
 await assert.rejects(decodeProjectPhotos({manifest:fixture(),photos:[image]},BrokenImage),/decode failed/);
});

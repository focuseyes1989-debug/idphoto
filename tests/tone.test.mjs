import {test} from 'node:test';
import assert from 'node:assert/strict';
import {defaultTone,toneLut,applyTone,validTone} from '../web/tone.js';

test('identity preserves all tones; levels adjust gamma and clip endpoints',()=>{
 assert.deepEqual([...toneLut(defaultTone())],Array.from({length:256},(_,i)=>i));
 const lut=toneLut({...defaultTone(),black:20,white:220,gamma:2});
 assert.equal(lut[0],0);assert.equal(lut[20],0);assert.equal(lut[120],180);assert.equal(lut[220],255);
 assert.equal(validTone({...defaultTone(),black:255}),false);
});
test('curves pass through anchors and preserve transparency',()=>{
 const tone={...defaultTone(),curve:[0,40,150,220,255]},lut=toneLut(tone);
 assert.equal(lut[64],40);assert.equal(lut[128],150);assert.equal(lut[192],220);
 const pixels={data:new Uint8ClampedArray([64,128,192,37])};let written;
 applyTone({width:1,height:1,getContext:()=>({getImageData:()=>pixels,putImageData:p=>written=p})},tone);
 assert.deepEqual([...written.data],[40,150,220,37]);
});

test('free curve points interpolate and RGB channels stay independent',()=>{
 const tone={...defaultTone(),points:[[0,0],[100,160],[255,255]],channels:{red:{...defaultTone(),output_white:128}}};
 const lut=toneLut(tone);assert.equal(lut[100],160);assert.equal(lut[255],255);
 const pixels={data:new Uint8ClampedArray([100,100,100,99])};
 applyTone({width:1,height:1,getContext:()=>({getImageData:()=>pixels,putImageData(){}})},tone);
 assert.deepEqual([...pixels.data],[80,160,160,99]);
 assert.equal(validTone({...tone,points:[[0,0],[100,60],[100,80],[255,255]]}),false);
});

test('selective color targets color ranges, supports methods and preserves alpha',async()=>{
 const {defaultSelective,selectivePixel,validSelective}=await import('../web/selective-color.js');
 const selective=defaultSelective();selective.ranges.reds=[50,0,0,0];
 assert.deepEqual(selectivePixel([200,50,50],selective),[141,50,50]);assert.deepEqual(selectivePixel([50,200,50],selective),[50,200,50]);
 const pixels={data:new Uint8ClampedArray([200,50,50,37])};applyTone({width:1,height:1,getContext:()=>({getImageData:()=>pixels,putImageData(){}})},{...defaultTone(),selective});assert.deepEqual([...pixels.data],[141,50,50,37]);
 selective.method='absolute';assert.deepEqual(selectivePixel([200,50,50],selective),[125,50,50]);
 for(const rgb of [[255,255,255],[128,128,128],[0,0,0]])assert.deepEqual(selectivePixel(rgb,selective),rgb);
 selective.ranges.reds[0]=101;assert.equal(validSelective(selective),false);
});

// Manual CPU benchmark; no timing thresholds in correctness tests.
import {performance} from 'node:perf_hooks';
import {defaultSelective,selectivePixel,applySelective} from '../web/selective-color.js';
const source=new Uint8ClampedArray(1600*1200*4);
for(let i=0;i<source.length;i++)source[i]=(i*37+(i>>>8))%256;
function reference(data,s){for(let i=0;i<data.length;i+=4){const rgb=selectivePixel([data[i],data[i+1],data[i+2]],s);data[i]=rgb[0];data[i+1]=rgb[1];data[i+2]=rgb[2];}}
for(const count of [1,9]){
 const s=defaultSelective();Object.keys(s.ranges).slice(0,count).forEach(k=>s.ranges[k]=[25,-15,10,5]);
 const results={};
 for(const [name,fn] of [['previous',reference],['optimized',applySelective]]){
  fn(source.slice(0,40000),s);const samples=[];
  for(let i=0;i<3;i++){const data=source.slice(),start=performance.now();fn(data,s);samples.push(performance.now()-start);}
  samples.sort((a,b)=>a-b);results[name]=Math.round(samples[1]);
 }
 console.log(JSON.stringify({pixels:1600*1200,activeRanges:count,medianMs:results,speedup:(results.previous/results.optimized).toFixed(1)}));
}

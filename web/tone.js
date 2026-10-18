import {validBrushes} from './brush.js';
import {validRetouch,retouchPixels} from './retouch.js';
import {validSelective,activeSelective,applySelective} from './selective-color.js';
export const curveInputs=[0,64,128,192,255];
export const defaultTone=()=>({black:0,white:255,gamma:1,output_black:0,output_white:255,curve:[...curveInputs]});
export const copyTone=value=>structuredClone(value);
export function validTone(t){return !!t&&(t.brushes===undefined||validBrushes(t.brushes))&&(t.retouch===undefined||validRetouch(t.retouch))&&[t.black,t.white,t.gamma,t.output_black,t.output_white,...(t.curve||[])].every(Number.isFinite)&&t.black>=0&&t.white<=255&&t.black<t.white&&t.gamma>=.1&&t.gamma<=5&&t.output_black>=0&&t.output_white<=255&&t.output_black<t.output_white&&Array.isArray(t.curve)&&t.curve.length===5&&t.curve.every(y=>y>=0&&y<=255)&&(!t.points||validPoints(t.points))&&(!t.channels||Object.values(t.channels).every(validTone))&&(!t.selective||validSelective(t.selective));}
export function validPoints(p){return Array.isArray(p)&&p.length>=2&&p.length<=16&&p[0][0]===0&&p.at(-1)[0]===255&&p.every((v,i)=>v.length===2&&v.every(Number.isFinite)&&v.every(n=>n>=0&&n<=255)&&(!i||v[0]>p[i-1][0]));}
export function toneLut(t){
 if(!validTone(t))throw Error('Check Levels and Curves values. Black must be below white.');
 const x=t.points?t.points.map(p=>p[0]):curveInputs,y=t.points?t.points.map(p=>p[1]):t.curve,n=x.length,z=Array(n).fill(0),u=Array(n).fill(0);
 for(let i=1;i<n-1;i++){const span=x[i+1]-x[i-1],sig=(x[i]-x[i-1])/span,p=sig*z[i-1]+2;z[i]=(sig-1)/p;u[i]=(6*((y[i+1]-y[i])/(x[i+1]-x[i])-(y[i]-y[i-1])/(x[i]-x[i-1]))/span-sig*u[i-1])/p;}
 for(let i=n-2;i>=0;i--)z[i]=z[i]*z[i+1]+u[i];
 return Uint8Array.from({length:256},(_,v)=>{
  const level=t.output_black+Math.pow(Math.max(0,Math.min(1,(v-t.black)/(t.white-t.black))),1/t.gamma)*(t.output_white-t.output_black);
  let i=0;while(i<n-2&&level>x[i+1])i++;
  const h=x[i+1]-x[i],a=(x[i+1]-level)/h,b=(level-x[i])/h;
  return Math.round(Math.max(0,Math.min(255,a*y[i]+b*y[i+1]+((a*a*a-a)*z[i]+(b*b*b-b)*z[i+1])*h*h/6)));
 });
}
export function applyTone(canvas,t){
 const master=toneLut(t),luts=['red','green','blue'].map(c=>{const channel=toneLut(t.channels?.[c]||defaultTone());return Uint8Array.from(master,v=>channel[v]);});const selective=activeSelective(t.selective);if(!(t.retouch>0)&&!selective&&luts.every(lut=>lut.every((v,i)=>v===i)))return;
 const context=canvas.getContext('2d'),pixels=context.getImageData(0,0,canvas.width,canvas.height);
 if(t.retouch>0)retouchPixels(pixels.data,canvas.width,canvas.height,t.retouch);
 for(let i=0;i<pixels.data.length;i+=4){pixels.data[i]=luts[0][pixels.data[i]];pixels.data[i+1]=luts[1][pixels.data[i+1]];pixels.data[i+2]=luts[2][pixels.data[i+2]];}
 if(selective)applySelective(pixels.data,t.selective);
 context.putImageData(pixels,0,0);
}

export const brushKinds=['Blur','Sharpen','Smudge'];
export function validBrushes(strokes){return Array.isArray(strokes)&&strokes.length<=500&&strokes.reduce((n,s)=>n+(s.points?.length||0),0)<=10000&&strokes.every(s=>brushKinds.includes(s.kind)&&Number.isFinite(s.radius)&&s.radius>0&&s.radius<=4&&Number.isFinite(s.strength)&&s.strength>=0&&s.strength<=1&&Array.isArray(s.points)&&s.points.length>0&&s.points.every(p=>Array.isArray(p)&&p.length===2&&p.every(v=>Number.isFinite(v)&&v>=0&&v<=1)));}
export function applyBrushes(data,width,height,strokes=[],skipFirst=false){
 if(!validBrushes(strokes))throw Error('Invalid brush strokes');
 const size=Math.max(width,height);
 function dab(s,x,y,dx,dy){
  const radius=Math.max(1,s.radius*size),step=Math.max(1,Math.round(radius*.15));
  const left=Math.max(0,Math.floor(x-radius-Math.abs(dx)-step-2)),top=Math.max(0,Math.floor(y-radius-Math.abs(dy)-step-2)),right=Math.min(width,Math.ceil(x+radius+Math.abs(dx)+step+3)),bottom=Math.min(height,Math.ceil(y+radius+Math.abs(dy)+step+3)),sw=right-left;
  const source=new Uint8ClampedArray(sw*(bottom-top)*4);
  for(let row=top;row<bottom;row++)source.set(data.subarray((row*width+left)*4,(row*width+right)*4),(row-top)*sw*4);
  const at=i=>{const pixel=Math.floor(i/4);return source[((Math.floor(pixel/width)-top)*sw+pixel%width-left)*4+i%4];};
  for(let yy=Math.max(0,Math.floor(y-radius));yy<=Math.min(height-1,Math.ceil(y+radius));yy++)for(let xx=Math.max(0,Math.floor(x-radius));xx<=Math.min(width-1,Math.ceil(x+radius));xx++){
   const distance=Math.hypot(xx-x,yy-y)/radius;if(distance>=1)continue;
   const p=(yy*width+xx)*4,weight=(1-distance*distance)*s.strength;if(!at(p+3))continue;
   if(s.kind==='Smudge'){
    const sx=Math.max(0,Math.min(width-1,Math.round(xx-dx))),sy=Math.max(0,Math.min(height-1,Math.round(yy-dy))),q=(sy*width+sx)*4;
    for(let c=0;c<3;c++)data[p+c]=Math.round(at(p+c)+(at(q+c)-at(p+c))*weight*at(q+3)/255);
   }else{
    const sum=[0,0,0];let count=0;
    for(let j=-1;j<=1;j++)for(let i=-1;i<=1;i++){const sx=Math.max(0,Math.min(width-1,xx+i*step)),sy=Math.max(0,Math.min(height-1,yy+j*step)),q=(sy*width+sx)*4;if(!at(q+3))continue;count++;for(let c=0;c<3;c++)sum[c]+=at(q+c);}
    for(let c=0;c<3;c++){const delta=sum[c]/count-at(p+c);data[p+c]=Math.round(Math.max(0,Math.min(255,at(p+c)+delta*weight*(s.kind==='Sharpen'?-1:1))));}
   }
  }
 }
 for(const s of strokes){let last=s.points[0];if(!skipFirst&&s.kind!=='Smudge')dab(s,last[0]*width,last[1]*height,0,0);
  for(const p of s.points.slice(1)){const dx=(p[0]-last[0])*width,dy=(p[1]-last[1])*height,n=Math.max(1,Math.ceil(Math.hypot(dx,dy)/Math.max(1,s.radius*size*.35)));
   for(let i=1;i<=n;i++)dab(s,last[0]*width+dx*i/n,last[1]*height+dy*i/n,dx/n,dy/n);last=p;
  }
 }
}
const brushCache=new WeakMap();
export function brushedCanvas(document,base,strokes){
 if(!strokes?.length)return base;
 const key=JSON.stringify(strokes);let cache=brushCache.get(base);
 if(cache?.key===key)return cache.canvas;
 let added=strokes,skip=false;
 if(cache){
  const previous=cache.strokes,n=previous.length;
  if(strokes.length===n+1&&JSON.stringify(strokes.slice(0,n))===JSON.stringify(previous))added=[strokes[n]];
  else if(strokes.length===n&&n&&JSON.stringify(strokes.slice(0,n-1))===JSON.stringify(previous.slice(0,n-1))){
   const old=previous[n-1],next=strokes[n-1],count=old.points.length;
   if(old.kind===next.kind&&old.radius===next.radius&&old.strength===next.strength&&next.points.length>count&&JSON.stringify(next.points.slice(0,count))===JSON.stringify(old.points)){added=[{...next,points:next.points.slice(count-1)}];skip=true;}else cache=null;
  }else cache=null;
 }
 if(!cache){const canvas=document.createElement('canvas'),scale=Math.min(1,1000/Math.max(base.width,base.height));canvas.width=Math.max(1,Math.round(base.width*scale));canvas.height=Math.max(1,Math.round(base.height*scale));const context=canvas.getContext('2d');context.drawImage(base,0,0,canvas.width,canvas.height);cache={canvas};added=strokes;skip=false;}
 const c=cache.canvas,context=c.getContext('2d'),pixels=context.getImageData(0,0,c.width,c.height);
 applyBrushes(pixels.data,c.width,c.height,added,skip);context.putImageData(pixels,0,0);
 cache.key=key;cache.strokes=structuredClone(strokes);brushCache.set(base,cache);return c;
}

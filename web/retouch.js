// Conservative skin-color gating and edge-aware smoothing. No pixel displacement.
export const validRetouch=s=>Number.isFinite(s)&&s>=0&&s<=100;
export function retouchPixels(data,width,height,strength){
 if(!validRetouch(strength))throw Error('Retouch strength must be 0 to 100.');
 if(!strength)return;
 const source=new Uint8ClampedArray(data),step=Math.max(1,Math.round(Math.min(width,height)/600));
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const p=(y*width+x)*4,r=source[p],g=source[p+1],b=source[p+2];
  const cb=128-.168736*r-.331264*g+.5*b,cr=128+.5*r-.418688*g-.081312*b;
  const skin=Math.max(0,Math.min(1,(cb-75)/10,(130-cb)/10,(cr-130)/10,(175-cr)/10,(r-35)/20));
  if(!skin||!source[p+3])continue;
  let sum=[0,0,0],weight=0;
  for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){
   const xx=x+dx*step,yy=y+dy*step;if(xx<0||yy<0||xx>=width||yy>=height)continue;
   const q=(yy*width+xx)*4;if(source[q+3]!==source[p+3])continue;
   const distance=(r-source[q])**2+(g-source[q+1])**2+(b-source[q+2])**2;
   if(distance>=1200)continue;
   const w=(1-distance/1200)/(1+dx*dx+dy*dy);weight+=w;
   for(let c=0;c<3;c++)sum[c]+=w*source[q+c];
  }
  for(let c=0;c<3;c++)data[p+c]=Math.round(source[p+c]+(sum[c]/weight-source[p+c])*skin*strength/100*.65);
 }
}
export function createRetouchDialog({document,onPreview,onClose}){
 const $=id=>document.getElementById(id);let original,strength=35,timer=null,opened=false;
 function stop(){clearTimeout(timer);timer=null;}
 function render(){if(!opened)return;const t=structuredClone(original);if($('retouchAfter').checked)t.retouch=strength;onPreview(t,{interactive:true});}
 function fields(){ $('retouchValue').textContent=strength+'%'; }
 $('retouchStrength').oninput=()=>{strength=Number($('retouchStrength').value);fields();stop();timer=setTimeout(render,40);};
 $('retouchBefore').onchange=$('retouchAfter').onchange=()=>{stop();render();};
 function close(apply){stop();if(!opened)return;opened=false;const t=structuredClone(original);if(apply)t.retouch=strength;onPreview(t);$('retouchDialog').close();onClose(apply);}
 $('retouchApply').onclick=()=>close(true);$('retouchCancel').onclick=()=>close(false);$('retouchDialog').oncancel=e=>{e.preventDefault();close(false);};
 return {open(t){stop();original=structuredClone(t);strength=t.retouch??35;opened=true;$('retouchStrength').value=strength;fields();$('retouchAfter').checked=true;$('retouchBefore').checked=false;$('retouchDialog').showModal();render();}};
}

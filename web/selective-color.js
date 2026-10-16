export const colorRanges=['reds','yellows','greens','cyans','blues','magentas','whites','neutrals','blacks'];
export const defaultSelective=()=>({method:'relative',ranges:Object.fromEntries(colorRanges.map(c=>[c,[0,0,0,0]]))});
export function validSelective(s){return !!s&&['relative','absolute'].includes(s.method)&&!!s.ranges&&Object.entries(s.ranges).every(([k,v])=>colorRanges.includes(k)&&Array.isArray(v)&&v.length===4&&v.every(n=>Number.isFinite(n)&&n>=-100&&n<=100));}
export const activeSelective=s=>s&&Object.values(s.ranges).some(v=>v.some(n=>n!==0));
// Compile only nonzero ranges once per image, rather than allocating arrays per pixel.
export function applySelective(data,s){
 const active=[];
 for(let i=0;i<colorRanges.length;i++){
  const a=s.ranges[colorRanges[i]];if(!a||!a.some(n=>n!==0))continue;
  active.push([i,-(a[0]/100+a[3]/100),-(a[1]/100+a[3]/100),-(a[2]/100+a[3]/100)]);
 }
 if(!active.length)return;
 const absolute=s.method==='absolute';
 for(let p=0;p<data.length;p+=4){
  const r=data[p]/255,g=data[p+1]/255,b=data[p+2]/255;
  let dr=0,dg=0,db=0;
  for(let i=0;i<active.length;i++){
   const a=active[i];let w;
   switch(a[0]){
    case 0:w=r-Math.max(g,b);break;case 1:w=Math.min(r,g)-b;break;
    case 2:w=g-Math.max(r,b);break;case 3:w=Math.min(g,b)-r;break;
    case 4:w=b-Math.max(r,g);break;case 5:w=Math.min(r,b)-g;break;
    case 6:w=(Math.min(r,g,b)-.5)*2;break;
    case 7:w=1-(Math.abs(Math.max(r,g,b)-.5)+Math.abs(Math.min(r,g,b)-.5));break;
    case 8:w=(.5-Math.max(r,g,b))*2;break;
   }
   if(w<=0)continue;
   dr+=w*a[1]*(absolute?1:a[1]<0?r:1-r);
   dg+=w*a[2]*(absolute?1:a[2]<0?g:1-g);
   db+=w*a[3]*(absolute?1:a[3]<0?b:1-b);
  }
  data[p]=Math.round(Math.max(0,Math.min(1,r+dr))*255);
  data[p+1]=Math.round(Math.max(0,Math.min(1,g+dg))*255);
  data[p+2]=Math.round(Math.max(0,Math.min(1,b+db))*255);
 }
}
export function selectivePixel(rgb,s){
 const v=rgb.map(n=>n/255),[r,g,b]=v,max=Math.max(...v),min=Math.min(...v);
 const weights=[Math.max(0,r-Math.max(g,b)),Math.max(0,Math.min(r,g)-b),Math.max(0,g-Math.max(r,b)),Math.max(0,Math.min(g,b)-r),Math.max(0,b-Math.max(r,g)),Math.max(0,Math.min(r,b)-g),Math.max(0,(min-.5)*2),Math.max(0,1-(Math.abs(max-.5)+Math.abs(min-.5))),Math.max(0,(.5-max)*2)];
 const delta=[0,0,0];
 colorRanges.forEach((name,i)=>{const a=s.ranges[name];if(!a)return;for(let c=0;c<3;c++){const ink=a[c]/100,k=a[3]/100;const change=-(ink+k);const scale=s.method==='absolute'?1:change<0?v[c]:1-v[c];delta[c]+=weights[i]*change*scale;}});
 return v.map((n,c)=>Math.round(Math.max(0,Math.min(1,n+delta[c]))*255));
}
export function createSelectiveDialog({document,onPreview,onClose,schedule=globalThis.requestAnimationFrame?.bind(globalThis),cancel=globalThis.cancelAnimationFrame?.bind(globalThis)}){
 const $=id=>document.getElementById(id);let value,original,pending=null,opened=false;
 function stop(){if(pending!==null){cancel?.(pending);pending=null;}}
 function render(){pending=null;if(!opened||!validSelective(value))return;const t=structuredClone(original);t.selective=$('selectivePreview').checked?structuredClone(value):original.selective;onPreview(t,{interactive:true});}
 function syncColor(){const range=$('selectiveRange').value;$('selectiveRangeLabel').textContent=range[0].toUpperCase()+range.slice(1);$('selectiveRangeSwatch').className='color-swatch swatch-'+range;for(const c of colorRanges)$('selectiveOption'+c[0].toUpperCase()+c.slice(1)).setAttribute?.('aria-selected',String(c===range));}
 function picker(show,focus=false){$('selectiveRangeList').hidden=!show;$('selectiveRangeButton').setAttribute?.('aria-expanded',String(show));if(show&&focus)$('selectiveOption'+$('selectiveRangeLabel').textContent).focus?.();}
 $('selectiveRangeButton').onclick=()=>picker($('selectiveRangeList').hidden,true);
 $('selectiveRangeButton').onkeydown=e=>{if(['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();picker(true,true);}};
 colorRanges.forEach((c,i)=>{const option=$('selectiveOption'+c[0].toUpperCase()+c.slice(1));option.onclick=()=>{$('selectiveRange').value=c;fields();picker(false);$('selectiveRangeButton').focus?.();};option.onkeydown=e=>{let next=i;if(e.key==='ArrowDown')next=(i+1)%9;else if(e.key==='ArrowUp')next=(i+8)%9;else if(e.key==='Home')next=0;else if(e.key==='End')next=8;else if(e.key==='Escape'){e.preventDefault();e.stopPropagation?.();picker(false);$('selectiveRangeButton').focus?.();return;}else return;e.preventDefault();const name=colorRanges[next];$('selectiveOption'+name[0].toUpperCase()+name.slice(1)).focus?.();};});
 $('selectiveRangeList').onfocusout=e=>{if(!e.currentTarget.contains?.(e.relatedTarget)&&e.relatedTarget!==$('selectiveRangeButton'))picker(false);};
 function fields(){syncColor();const a=value.ranges[$('selectiveRange').value]||[0,0,0,0];['Cyan','Magenta','Yellow','Black'].forEach((name,i)=>{ $('selective'+name).value=a[i];$('selective'+name+'Number').value=a[i];});$('selectiveMethod').value=value.method;}
 function preview(){const valid=validSelective(value);$('selectiveApply').disabled=!valid;$('selectiveError').textContent=valid?'Adjust the selected color range.':'Enter values from -100 to +100.';if(valid){if(schedule){if(pending===null)pending=schedule(render);}else render();}else stop();}
 for(const [i,name] of ['Cyan','Magenta','Yellow','Black'].entries())for(const suffix of ['', 'Number'])$('selective'+name+suffix).oninput=()=>{const input=$('selective'+name+suffix);value.ranges[$('selectiveRange').value][i]=input.value===''?NaN:Number(input.value);$('selective'+name+(suffix?'':'Number')).value=input.value;preview();};
 function settle(){stop();if(!opened||!validSelective(value))return;const t=structuredClone(original);t.selective=$('selectivePreview').checked?structuredClone(value):original.selective;onPreview(t);}
 for(const name of ['Cyan','Magenta','Yellow','Black'])for(const suffix of ['', 'Number'])$('selective'+name+suffix).onchange=settle;
 $('selectiveRange').onchange=fields;$('selectiveMethod').onchange=()=>{value.method=$('selectiveMethod').value;preview();};$('selectivePreview').onchange=preview;
 $('selectiveReset').onclick=()=>{value=defaultSelective();fields();preview();};
 function close(apply){if(apply&&!validSelective(value))return;stop();opened=false;picker(false);const t=structuredClone(original);if(apply)t.selective=structuredClone(value);onPreview(t);$('selectiveDialog').close();onClose(apply);}
 $('selectiveApply').onclick=()=>close(true);$('selectiveCancel').onclick=()=>close(false);$('selectiveDialog').oncancel=e=>{e.preventDefault();close(false);};
 return {open(t){stop();picker(false);opened=true;original=structuredClone(t);value=t.selective?structuredClone(t.selective):defaultSelective();for(const c of colorRanges)value.ranges[c]??=[0,0,0,0];$('selectiveRange').value='reds';$('selectivePreview').checked=true;$('selectiveApply').disabled=false;$('selectiveError').textContent='Adjust the selected color range.';fields();$('selectiveDialog').showModal();}};
}

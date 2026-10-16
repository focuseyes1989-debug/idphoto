import {paperBounds,mixedSheetPages,fromMillimeters,toMillimeters} from './geometry.js';

export const LAST_PRINTER_KEY='id-photo-studio.last-printer.v1';

export function createPrintDialog({document,invoke,storage,onApply=()=>{}}){
 const $=id=>document.getElementById(id),dialog=$('printDialog');
 let pageCount=1,base=null,paper=null,unit='in',printers=[],working=false,timer=null,revision=0,validPreview=false,onClose=()=>{};
 const message=value=>{$('printMessage').textContent=value;};
 const viewport=$('printPreviewViewport'),pages=$('printPreviewPages'),firstPreview=$('printPreview');
 let previewZoom=1,previewDrag=null,previewImages=[];
 const previewCache=new Map();let preparedPages=null,preparedKey=null,contentKey='';
 const previewKey=()=>JSON.stringify({request:request(),contentKey});
 function cachePreview(key,value){previewCache.set(key,value);while(previewCache.size>4)previewCache.delete(previewCache.keys().next().value);}
 function applyPreviewView(){
  if(!paper)return;
  const box=viewport.getBoundingClientRect(),ratio=paper.height_mm/paper.width_mm;
  const fit=Math.max(60,Math.min(box.width-48,(box.height-48)/ratio));
  const width=Math.round(fit*previewZoom);
  pages.style.width=Math.max(box.width-20,width+48)+'px';
  for(const image of previewImages){image.style.width=width+'px';image.style.height=Math.round(width*ratio)+'px';}
  $('printZoomValue').textContent=Math.round(previewZoom*100)+'%';
  viewport.style.cursor=previewDrag?'grabbing':'grab';
 }
 function endDrag(){previewDrag=null;viewport.style.cursor='grab';}
 function fitPreview(){previewZoom=1;endDrag();applyPreviewView();viewport.scrollLeft=0;viewport.scrollTop=0;}
 $('printFit').onclick=()=>{if(!working)fitPreview();};
 viewport.onwheel=e=>{
  if(!dialog.open||working||!e.ctrlKey)return;
  e.preventDefault();
  const box=viewport.getBoundingClientRect(),delta=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?box.height:1);
  if(!Number.isFinite(delta))return;
  const old=previewZoom,x=e.clientX-box.left,y=e.clientY-box.top;
  const left=viewport.scrollLeft||0,top=viewport.scrollTop||0;
  previewZoom=Math.max(.25,Math.min(8,old*Math.exp(-delta*.0015)));applyPreviewView();
  viewport.scrollLeft=(left+x)*previewZoom/old-x;viewport.scrollTop=(top+y)*previewZoom/old-y;
 };
 viewport.onpointerdown=e=>{
  if(!dialog.open||working||e.button!==0||e.target===viewport)return;
  previewDrag={id:e.pointerId,x:e.clientX,y:e.clientY,left:viewport.scrollLeft||0,top:viewport.scrollTop||0};
  viewport.setPointerCapture(e.pointerId);viewport.focus();applyPreviewView();
 };
 viewport.onpointermove=e=>{if(!previewDrag||e.pointerId!==previewDrag.id)return;viewport.scrollLeft=previewDrag.left+previewDrag.x-e.clientX;viewport.scrollTop=previewDrag.top+previewDrag.y-e.clientY;};
 viewport.onpointerup=endDrag;viewport.onpointercancel=endDrag;viewport.onlostpointercapture=endDrag;
 viewport.onkeydown=e=>{if(e.key==='0'&&!working){e.preventDefault();fitPreview();}else if(e.key==='Escape'&&previewDrag){e.preventDefault();e.stopPropagation();endDrag();}};
 if(typeof ResizeObserver!=='undefined')new ResizeObserver(()=>{if(dialog.open)applyPreviewView();}).observe(viewport);
 function selected(){return printers.find(p=>p.name===$('printPrinter').value);}
 function savedPrinter(){
  try{const name=storage?.getItem(LAST_PRINTER_KEY);return typeof name==='string'&&name.length>0&&name.length<=1024&&!name.includes('\0')?name:null;}catch{return null;}
 }
 function controls(){
  for(const id of ['printPrinter','printProperties','printPaperPreset','printOrientation','printUnit','printWidth','printHeight','printMarginLeft','printMarginRight','printMarginTop','printMarginBottom','printCopies','printCancel'])$(id).disabled=working;
 $('printProperties').disabled=working||!selected();$('printFit').disabled=working||!previewImages.length;
  const copies=Number($('printCopies').value);
  $('printSubmit').disabled=working||!selected()||!validPreview||!Number.isInteger(copies)||copies<1||copies>100;
 }
 function fields(){
  for(const [id,key] of pairs)$(id).value=Number(fromMillimeters(paper[key],unit).toFixed(6)).toString();
  for(const id of ['printWidthLabel','printHeightLabel','printMarginLeftLabel','printMarginRightLabel','printMarginTopLabel','printMarginBottomLabel'])$(id).textContent=$(id).textContent.split(' · ')[0]+' · '+unit;
  $('printDimensions').textContent=`${Number(fromMillimeters(paper.width_mm,unit).toFixed(3))} × ${Number(fromMillimeters(paper.height_mm,unit).toFixed(3))} ${unit} · Actual size`;
 }
 function request(){return {...base,crop:{...base.crop,paper:{...paper}}};}
 async function refreshPreview(){
  clearTimeout(timer);const token=++revision;validPreview=false;controls();
  const layout=base.items?mixedSheetPages(base.items.map(i=>({...i.crop,count:i.count})),base.crop.dpi,base.crop.gap_mm,paper):null;pageCount=Math.max(1,layout?.pages.length||1);controls();
  const invalid=paperBounds(paper,base.crop.dpi).error||layout?.error;
  if(invalid){previewImages=[];controls();$('printPreviewPages').replaceChildren();firstPreview.hidden=true;message(invalid);return;}
  const pending=request(),key=previewKey(),cached=previewCache.get(key)||(key===preparedKey?preparedPages:null),completed=[];previewImages=[];endDrag();$('printPreviewPages').replaceChildren();firstPreview.hidden=true;
  message('Preparing sheet previews (0 / '+pageCount+')…');
  try{
   for(let index=0;index<pageCount;index++){
    const stored=cached?.[index];
    const data=stored||await invoke('prepare_print',{...pending,previewOnly:true,pageIndex:index});
    if(token!==revision||!dialog.open)return;
    const image=typeof data==='string'?(index===0?firstPreview:document.createElement('img')):data;
    if(typeof data==='string'){image.src=data;await image.decode();}
    completed.push(data);
    if(token!==revision||!dialog.open)return;
    const label=document.createElement('div');label.className='print-sheet-label';label.textContent='Page '+(index+1)+' / '+pageCount;
    image.alt='Print sheet '+(index+1);image.hidden=false;
    $('printPreviewPages').append(label,image);previewImages.push(image);applyPreviewView();controls();
    message('Preparing sheet previews ('+(index+1)+' / '+pageCount+')…');
   }
   cachePreview(key,completed);validPreview=true;message('Ready · '+pageCount+' sheets · Print at actual size.');
  }catch(error){if(token===revision){message(String(error));}}
  finally{if(token===revision)controls();}
 }

 function schedule(){validPreview=false;++revision;controls();clearTimeout(timer);timer=setTimeout(refreshPreview,180);fields();}
 async function refreshPrinters(){
  working=true;controls();message('Loading Windows printers…');
  try{
   const previous=savedPrinter()||$('printPrinter').value;printers=await invoke('list_printers');$('printPrinter').replaceChildren();
   for(const printer of printers){const option=document.createElement('option');option.value=printer.name;option.textContent=printer.name+(printer.is_default?' (Default)':'');$('printPrinter').append(option);}
   $('printPrinter').value=printers.find(p=>p.name===previous)?.name||printers.find(p=>p.is_default)?.name||printers[0]?.name||'';
   message(printers.length?`${printers.length} Windows printers found`:'No printers installed. Add a printer in Windows, then Refresh.');
  }catch(error){printers=[];message(String(error));}
  finally{working=false;controls();}
 }
 const pairs=[['printWidth','width_mm'],['printHeight','height_mm'],['printMarginLeft','left_mm'],['printMarginRight','right_mm'],['printMarginTop','top_mm'],['printMarginBottom','bottom_mm']];
 for(const [id,key] of pairs)$(id).oninput=()=>{paper[key]=$(id).value===''?NaN:toMillimeters(Number($(id).value),unit);if(key==='width_mm'||key==='height_mm')$('printPaperPreset').value='custom';schedule();};
 $('printUnit').onchange=()=>{unit=$('printUnit').value;fields();};
 $('printPaperPreset').onchange=()=>{
  if($('printPaperPreset').value!=='custom'){const [w,h]=$('printPaperPreset').value.split(',').map(Number);paper.width_mm=w;paper.height_mm=h;if($('printOrientation').value==='landscape')[paper.width_mm,paper.height_mm]=[h,w];}
  schedule();
 };
 $('printOrientation').onchange=()=>{const min=Math.min(paper.width_mm,paper.height_mm),max=Math.max(paper.width_mm,paper.height_mm);paper.width_mm=$('printOrientation').value==='landscape'?max:min;paper.height_mm=$('printOrientation').value==='landscape'?min:max;schedule();};
 $('printCopies').oninput=controls;

 $('printPrinter').onchange=()=>{
  controls();if(!selected())return;
  try{storage?.setItem(LAST_PRINTER_KEY,selected().name);}catch{message('Printer selected, but could not save the printer preference on this computer.');return;}
  message('Printer selected · Properties controls paper tray, media type and color.');
 };
 async function driverAction(command,args){working=true;controls();try{return await invoke(command,args);}finally{working=false;controls();}}
 $('printProperties').onclick=async()=>{
  if(working||!selected())return;
  try{const result=await driverAction('printer_properties',{printer:selected().name,paper:{...paper}});
   if(result){paper.width_mm=result.width_mm;paper.height_mm=result.height_mm;$('printPaperPreset').value='custom';$('printOrientation').value=paper.width_mm>paper.height_mm?'landscape':'portrait';await refreshPreview();fields();}
  }catch(error){message(String(error));}
 };
 function close(job){if(working)return;endDrag();clearTimeout(timer);++revision;dialog.close();const callback=onClose;onClose=()=>{};callback(job);}
 $('printCancel').onclick=()=>close();dialog.oncancel=e=>{e.preventDefault();close();};
 $('printSubmit').onclick=async()=>{
  if($('printSubmit').disabled||working)return;
  working=true;controls();message('Sending all full-resolution sheets to printer…');
  try{
   const job=await invoke('submit_print',{...request(),printer:selected().name,copies:Number($('printCopies').value)});
   onApply({...paper},unit,$('printPaperPreset').value);working=false;close(job);return job;
  }catch(error){message(String(error));}finally{working=false;controls();}
 };
 return {async open(value,options={}){
  pageCount=1;base=value;paper={...value.crop.paper};contentKey=options.contentKey||'';preparedPages=options.preparedPages||null;preparedKey=previewKey();unit=options.unit||'in';onClose=options.onClose||(()=>{});validPreview=false;
  $('printUnit').value=unit;$('printCopies').value='1';$('printPaperPreset').value=options.preset||'custom';$('printOrientation').value=paper.width_mm>paper.height_mm?'landscape':'portrait';
  previewImages=[];firstPreview.hidden=true;fields();dialog.showModal();fitPreview();controls();
  await Promise.all([refreshPrinters(),refreshPreview()]);
 }};
}

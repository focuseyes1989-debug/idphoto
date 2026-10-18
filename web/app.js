import {brushKinds,brushedCanvas} from './brush.js';
import {createRetouchDialog} from './retouch.js';
import {EditHistory} from './history.js';
import {createUpdateDialog} from './update-dialog.js';
import {validProject,decodeProjectPhotos} from './project.js';
import {createSelectiveDialog} from './selective-color.js';
import {defaultTone,copyTone,applyTone} from './tone.js';
import {createToneDialog} from './tone-dialog.js';
import {createPrintDialog} from './print-dialog.js';
import { validPhotoSize,loadPaperPreferences, savePaperPreferences } from './preferences.js';
import { cropRect, sheetLayout, sheetGaps, validSettings, toMillimeters, fromMillimeters, normalizeAngle, rotatedSize, mixedSheetPages, defaultPaper, paperBounds } from './geometry.js';
const $ = id => document.getElementById(id);
const invoke = (command, args) => window.__TAURI_INTERNALS__.invoke(command, args);
let photo = null, zoom = 1, pan = {x:0.5,y:0.5}, busy = false, drag = null, rotation = 0, backgroundRemoved = false;
let adjustments=defaultTone();
const editHistory=new EditHistory(40),retainedDocuments=new Map();
let historyRestoring=false,historyGroup=null,editGesture=0;
let loadingPhotos=false,followOpeningPhotos=true;
function holdPhoto(){if(loadingPhotos)followOpeningPhotos=false;}
let defaultPhotoSize={width_mm:27.94,height_mm:33.02,unit:'in',preset:'27.94,33.02'};
let defaultBackgroundColor='white';
let defaultBackgroundStrength=100,backgroundStrength=100,backgroundAdjusting=false,strengthWorking=false,strengthTimer=null;
const backgroundColors={white:'#ffffff',blue:'#2372d2',red:'#d22f37'};
const canvas = $('crop'), ctx = canvas.getContext('2d'), sheet = document.createElement('canvas'), sc = sheet.getContext('2d');
const menus=['menuFile','menuEdit','menuTools','menuAdjustments','menuView','menuHelp'].map($);
function closeMenus(except=null){for(const menu of menus)if(menu!==except)menu.open=false;}
for(const menu of menus){
 menu.onclick=e=>{if(e.target.closest('summary')&&!menu.open)closeMenus(menu);};
 menu.ontoggle=()=>{if(menu.open)closeMenus(menu);};
}
document.onpointerdown=e=>{if(!e.target.closest('.menu-bar'))closeMenus();};
let activeTool='Move',viewMode='photo';
const largeSheet=$('largeSheet');
const sheetViewport=$('editorViewport'),sheetPages=$('sheetPages');
let pageCanvases=[largeSheet];
let sheetView={zoom:1,x:0,y:0},sheetDrag=null,lastSheetSize='';
function applySheetView(){
 const box=sheetViewport.getBoundingClientRect(),ratio=paper.height_mm/paper.width_mm;
 const fit=Math.max(80,Math.min(box.width-48,(box.height-60)/ratio));
 const width=Math.round(fit*sheetView.zoom);
 sheetPages.style.width=Math.max(box.width-20,width+48)+'px';
 for(const page of pageCanvases){page.style.width=width+'px';page.style.height=Math.round(width*ratio)+'px';}
 $('sheetZoomValue').textContent=Math.round(sheetView.zoom*100)+'%';
 sheetViewport.style.cursor=viewMode==='sheet'?(sheetDrag?'grabbing':'grab'):'';
}
function fitSheet(){sheetView={zoom:1,x:0,y:0};sheetDrag=null;sheetViewport.scrollTop=0;sheetViewport.scrollLeft=0;applySheetView();}
$('fitSheet').onclick=()=>{if(!busy)fitSheet();};
if(typeof ResizeObserver!=='undefined')new ResizeObserver(()=>{if(viewMode==='sheet')applySheetView();else if(photo)updatePhotoView();}).observe(sheetViewport);
sheetViewport.onwheel=e=>{
 if(viewMode==='photo'&&e.ctrlKey&&!busy&&photo){e.preventDefault();zoomPhoto(photoViewZoom*Math.exp(-e.deltaY*.0015));return;}if(viewMode!=='sheet'||busy||!e.ctrlKey)return;e.preventDefault();
 const delta=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?sheetViewport.getBoundingClientRect().height:1);
 if(!Number.isFinite(delta))return;
 const old=sheetView.zoom;sheetView.zoom=Math.max(.25,Math.min(8,old*Math.exp(-delta*.0015)));applySheetView();
 const anchor=e.clientY-sheetViewport.getBoundingClientRect().top;sheetViewport.scrollTop=((sheetViewport.scrollTop||0)+anchor)*sheetView.zoom/old-anchor;
};
sheetViewport.onpointerdown=e=>{
 if(viewMode!=='sheet'||busy||e.button!==0||e.target===sheetViewport)return;
 sheetDrag={x:e.clientX,y:e.clientY,view:{...sheetView},left:sheetViewport.scrollLeft||0,top:sheetViewport.scrollTop||0};sheetViewport.setPointerCapture(e.pointerId);largeSheet.focus();applySheetView();
};
sheetViewport.onpointermove=e=>{if(!sheetDrag||viewMode!=='sheet'||busy)return;sheetViewport.scrollLeft=sheetDrag.left+sheetDrag.x-e.clientX;sheetViewport.scrollTop=sheetDrag.top+sheetDrag.y-e.clientY;applySheetView();};
sheetViewport.onpointerup=()=>{sheetDrag=null;applySheetView();};
sheetViewport.onpointercancel=()=>{if(sheetDrag)sheetView=sheetDrag.view;sheetDrag=null;applySheetView();};
sheetViewport.onlostpointercapture=()=>{sheetDrag=null;applySheetView();};
largeSheet.onkeydown=e=>{if(viewMode!=='sheet'||busy)return;if(e.key==='0'){e.preventDefault();fitSheet();}else if(e.key==='Escape'&&sheetDrag){sheetView=sheetDrag.view;sheetDrag=null;applySheetView();}};
const tools={Move:{title:'Move photo',canvas:'Position your photo',hint:'Move · Drag the photo or use arrow keys to reposition.'},Crop:{title:'Crop & size',canvas:'Perfect the frame',hint:'Crop · Set the photo size and zoom, then drag to frame your photo.'},Rotate:{title:'Rotate photo',canvas:'Adjust the angle',hint:'Rotate · Drag the round handle. Hold Shift to snap to 15°.'},Background:{title:'Background',canvas:'Change the background',hint:'Background · Remove the background, then choose a color.'}};
for(const kind of brushKinds)tools[kind]={title:kind+' brush',canvas:kind+' photo details',hint:kind+' · Paint with a soft brush. Adjust brush size and strength above.'};
let brushTimer=null,brushCursor=null;
for(const kind of brushKinds){const key=kind.toLowerCase();$(key+'Strength').oninput=()=>{$(key+'StrengthValue').textContent=$(key+'Strength').value+'%';};}
tools.Zoom={title:'Zoom photo',canvas:'Inspect photo details',hint:'Zoom · Click to zoom in, Alt+click to zoom out. Drag to pan.'};
let photoViewZoom=1;
function updatePhotoView(){
 const stage=$('photoPreviewStage');stage.hidden=viewMode!=='photo'||!photo;
 sheetViewport.setAttribute('data-photo',String(viewMode==='photo'&&!!photo));
 const box=sheetViewport.getBoundingClientRect(),scale=Math.max(.1,Math.min((box.width-32)/600,(box.height-32)/500))*photoViewZoom;
 const density=Math.max(1,Math.min(4,photoViewZoom));if(canvas.width!==Math.round(600*density)){canvas.width=Math.round(600*density);canvas.height=Math.round(500*density);ctx.setTransform?.(density,0,0,density,0,0);}
 canvas.style.width=Math.round(600*scale)+'px';canvas.style.height=Math.round(500*scale)+'px';
 stage.style.width=Math.max(box.width-20,600*scale+32)+'px';stage.style.minHeight=(500*scale+32)+'px';
 $('photoZoomValue').textContent=Math.round(photoViewZoom*100)+'%';
}
function zoomPhoto(value){if(busy||!photo)return;photoViewZoom=Math.max(.25,Math.min(8,value));updatePhotoView();draw(true);}
$('photoZoomIn').onclick=()=>zoomPhoto(photoViewZoom*1.25);$('photoZoomOut').onclick=()=>zoomPhoto(photoViewZoom/1.25);
$('photoZoomFit').onclick=()=>{zoomPhoto(1);sheetViewport.scrollLeft=0;sheetViewport.scrollTop=0;};
function setTool(name,force=false){
 if((busy&&!force)||!tools[name])return;if(!force)holdPhoto();cancelTransform();activeTool=name;if(!force)viewMode='photo';
 for(const tool of Object.keys(tools)){$('tool'+tool).setAttribute('aria-pressed',String(tool===name));$('panel'+tool).hidden=tool!==name;}
 $('toolTitle').textContent=tools[name].title;$('canvasTitle').textContent=tools[name].canvas;
 $('activeToolName').textContent=name;$('toolHint').textContent=tools[name].hint.split(' · ')[1];
 closeMenus();
 brushCursor=null;canvas.style.cursor=brushKinds.includes(name)?'crosshair':name==='Zoom'?'zoom-in':name==='Move'||name==='Crop'?'grab':'default';
 canvas.setAttribute('aria-label',tools[name].hint);draw();status(tools[name].hint);
}
for(const name of Object.keys(tools))$('tool'+name).onclick=()=>setTool(name);
$('goCrop').onclick=()=>setTool('Crop');
for(const name of Object.keys(tools))$('menu'+name).onclick=()=>setTool(name);
$('menuOpen').onclick=()=>{$('menuFile').open=false;return open();};
$('menuOpenProject').onclick=()=>{closeMenus();return openProject();};
$('menuSaveProject').onclick=()=>{closeMenus();return saveProject();};
$('menuSave').onclick=()=>{closeMenus();return savePhoto(false);};
$('menuSaveAs').onclick=()=>{closeMenus();return savePhoto(true);};
$('menuExportPhoto').onclick=()=>{$('menuFile').open=false;return exportImage(false);};
$('menuClose').onclick=()=>{closeMenus();return photo?closeDocument(photo.id):undefined;};
$('menuExportSheet').onclick=()=>{$('menuFile').open=false;return exportImage(true);};
$('menuPrint').onclick=()=>{closeMenus();return printCurrentSheet();};
document.onkeydown=e=>{
 const editingText=e.target?.isContentEditable||['INPUT','TEXTAREA','SELECT'].includes(e.target?.tagName);
 if((e.ctrlKey||e.metaKey)&&!e.altKey&&!editingText){const key=e.key.toLowerCase();if(['z','y','c','v','x'].includes(key)){e.preventDefault();if(key==='z'||key==='y')restoreHistory(key==='y'||e.shiftKey);else if(key==='v')pastePhoto();else copyPhoto(key==='x');return;}}

 if((e.ctrlKey||e.metaKey)&&e.altKey&&e.key.toLowerCase()==='s'){e.preventDefault();saveProject();return;}
 if((e.ctrlKey||e.metaKey)&&e.shiftKey&&e.key.toLowerCase()==='o'){e.preventDefault();openProject();return;}
 if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();savePhoto(!!e.shiftKey);return;}
 if(e.key==='F8'&&!e.repeat){e.preventDefault();togglePrintLayout();return;}
 if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='p'){e.preventDefault();printCurrentSheet();return;}
 if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='w'){e.preventDefault();if(photo)closeDocument(photo.id);return;}
 if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='o'){e.preventDefault();open();return;}
 if(e.ctrlKey&&e.key==='Tab'&&documents.length){e.preventDefault();const index=documents.indexOf(photo);activateDocument(documents[(index+(e.shiftKey?-1:1)+documents.length)%documents.length].id);return;}
 if(e.key==='Escape'){closeMenus();return;}
 if(e.ctrlKey||e.metaKey||e.altKey||e.repeat||e.target?.isContentEditable||['INPUT','SELECT','TEXTAREA'].includes(e.target?.tagName))return;
 const name={v:'Move',c:'Crop',r:'Rotate',b:'Background'}[e.key.toLowerCase()];if(name){e.preventDefault();setTool(name);}
};
// Keep exact physical sizes in millimeters; switching display units never rounds them.
const physical = {width_mm:27.94,height_mm:33.02,gap_mm:3};
const paper=defaultPaper();
let marginsLinked=false,quantitiesLinked=false;
let printLayoutVisible=true;
let sheetContentsVisible=true;
let paperSettingsVisible=true;
function applyPaperSettingsVisibility(){
 $('paperSettingsBody').hidden=!paperSettingsVisible;
 $('togglePaperSettings').setAttribute('aria-expanded',String(paperSettingsVisible));
 $('paperSettingsChevron').textContent=paperSettingsVisible?'▾':'▸';
 $('togglePaperSettings').title=(paperSettingsVisible?'Hide':'Show')+' Paper size & margins';
 $('togglePaperSettings').setAttribute('aria-label',$('togglePaperSettings').title);
}
$('togglePaperSettings').onclick=()=>{if(busy)return;paperSettingsVisible=!paperSettingsVisible;applyPaperSettingsVisibility();persistPaperPreferences();};
function applySheetContentsVisibility(){
 $('sheetContentsBody').hidden=!sheetContentsVisible;
 $('toggleSheetContents').setAttribute('aria-expanded',String(sheetContentsVisible));
 $('sheetContentsChevron').textContent=sheetContentsVisible?'▾':'▸';
 $('toggleSheetContents').title=(sheetContentsVisible?'Hide':'Show')+' Sheet contents';
 $('toggleSheetContents').setAttribute('aria-label',$('toggleSheetContents').title);
}
$('toggleSheetContents').onclick=()=>{if(busy)return;sheetContentsVisible=!sheetContentsVisible;applySheetContentsVisibility();persistPaperPreferences();};
function applyPrintLayoutVisibility(){
 $('workspaceLayout').setAttribute('data-panel-collapsed',String(!printLayoutVisible));
 $('printLayoutPanel').hidden=!printLayoutVisible;$('printLayoutRail').hidden=printLayoutVisible;
 $('menuTogglePrintLayout').setAttribute('aria-checked',String(printLayoutVisible));
 $('menuTogglePrintLayoutLabel').textContent=(printLayoutVisible?'Hide':'Show')+' Print layout (F8)';
}
function togglePrintLayout(){
 if(busy)return;printLayoutVisible=!printLayoutVisible;closeMenus();applyPrintLayoutVisibility();persistPaperPreferences();
 $(printLayoutVisible?'collapsePrintLayout':'expandPrintLayout').focus();
}
$('collapsePrintLayout').onclick=togglePrintLayout;$('expandPrintLayout').onclick=togglePrintLayout;$('menuTogglePrintLayout').onclick=togglePrintLayout;
const marginKeys=['left_mm','right_mm','top_mm','bottom_mm'];
function updateMarginLinkButton(){
 $('linkMargins').setAttribute('aria-pressed',String(marginsLinked));
 $('linkMargins').setAttribute('aria-label',marginsLinked?'Unlink margins':'Link all margins');
 $('linkMargins').title=marginsLinked?'Margins linked · click to edit each side separately':'Link all margins using the Left value';
}
function persistPaperPreferences(){
 try{savePaperPreferences(window.localStorage,projectSettings());}
 catch{status('Could not save paper preferences on this computer.');}
}
function projectSettings(){return {version:1,paper:{...paper},unit:$('paperUnit').value||'in',orientation:$('paperOrientation').value||'portrait',preset:$('paperPreset').value||'101.6,152.4',linked:marginsLinked,quantities_linked:quantitiesLinked,gap_mm:physical.gap_mm,dpi:Number($('dpi').value),sheet_mode:$('sheetMode').value||'single',panel_visible:printLayoutVisible,sheet_contents_visible:sheetContentsVisible,paper_settings_visible:paperSettingsVisible,background_strength:defaultBackgroundStrength,background_color:defaultBackgroundColor,photo_size:{...defaultPhotoSize}};
}
function restorePaperPreferences(saved=null){
 if(!saved)try{saved=loadPaperPreferences(window.localStorage);}catch{return;}
 if(!saved)return;delete paper.column_gap_mm;delete paper.row_gap_mm;Object.assign(paper,saved.paper);marginsLinked=saved.linked;quantitiesLinked=saved.quantities_linked??false;updateQuantityLink();
 defaultPhotoSize={...saved.photo_size};physical.width_mm=defaultPhotoSize.width_mm;physical.height_mm=defaultPhotoSize.height_mm;$('unit').value=defaultPhotoSize.unit;$('preset').value=defaultPhotoSize.preset;
 defaultBackgroundColor=saved.background_color;$('background').value=defaultBackgroundColor;
 defaultBackgroundStrength=saved.background_strength;backgroundStrength=defaultBackgroundStrength;
 printLayoutVisible=saved.panel_visible;
 sheetContentsVisible=saved.sheet_contents_visible;paperSettingsVisible=saved.paper_settings_visible;
 physical.gap_mm=saved.gap_mm;$('dpi').value=String(saved.dpi);$('sheetMode').value=saved.sheet_mode;
 $('paperUnit').value=saved.unit;$('paperOrientation').value=saved.orientation;$('paperPreset').value=saved.preset;updateMarginLinkButton();
}
$('linkMargins').onclick=()=>{
 if(busy)return;marginsLinked=!marginsLinked;
 if(marginsLinked){for(const key of marginKeys)paper[key]=paper.left_mm;updatePaperFields();}
 $('linkMargins').setAttribute('aria-pressed',String(marginsLinked));
 $('linkMargins').setAttribute('aria-label',marginsLinked?'Unlink margins':'Link all margins');
 $('linkMargins').title=marginsLinked?'Margins linked · click to edit each side separately':'Link all margins using the Left value';
 viewMode='sheet';draw();persistPaperPreferences();
};
function settings(){return {...physical,dpi:Number($('dpi').value),paper:{...paper}};}
function displayNumber(mm){return Number(fromMillimeters(mm,$('unit').value).toFixed(6)).toString();}
function updateUnits(){
 const unit=$('unit').value;
 for(const [id,key,min,max] of [['width','width_mm',10,101.6],['height','height_mm',10,152.4],['gap','gap_mm',0,20]]){
  $(id).value=Number.isFinite(physical[key])?displayNumber(physical[key]):'';
  $(id).min=fromMillimeters(min,unit);$(id).max=fromMillimeters(max,unit);$(id).step='any';
  $(id+'Label').textContent=`${id[0].toUpperCase()+id.slice(1)} · ${unit}`;
 }
 for(const option of $('preset').options){if(option.value==='custom')continue;const [w,h]=option.value.split(',').map(Number);const name=option.value==='27.94,33.02'?'ID (default)':option.value==='35,45'?'Passport':option.value==='50.8,50.8'?'Square':'ID';option.textContent=`${name} · ${displayNumber(w)} × ${displayNumber(h)} ${unit}`;}
 updateGapFields();updatePaperFields();
}
function updateGapFields(){const unit=$('unit').value,gaps=sheetGaps(physical.gap_mm,paper);for(const [id,key,label] of [['columnGap','column','Column gap'],['rowGap','row','Row gap']]){$(id).value=Number.isFinite(gaps[key])?Number(fromMillimeters(gaps[key],unit).toFixed(6)):'';$(id).min=0;$(id).max=fromMillimeters(20,unit);$(id+'Label').textContent=label+' · '+unit;}}
function paperSizeLabel(){const unit=$('paperUnit').value||'in';return Number(fromMillimeters(paper.width_mm,unit).toFixed(6))+' × '+Number(fromMillimeters(paper.height_mm,unit).toFixed(6))+' '+unit;}
function updatePaperFields(){
 const unit=$('paperUnit').value||'mm',number=mm=>Number(fromMillimeters(mm,unit).toFixed(6)).toString();
 for(const [id,key,name] of [['paperWidth','width_mm','Width'],['paperHeight','height_mm','Height'],['marginLeft','left_mm','Left'],['marginRight','right_mm','Right'],['marginTop','top_mm','Top'],['marginBottom','bottom_mm','Bottom']]){
  $(id).value=Number.isFinite(paper[key])?number(paper[key]):'';$(id+'Label').textContent=name+' · '+unit;
  $(id).min=id.startsWith('paper')?fromMillimeters(25.4,unit):0;$(id).max=fromMillimeters(420,unit);
 }

}
function applyOrientation(){const portrait=$('paperOrientation').value!=='landscape';if((portrait&&paper.width_mm>paper.height_mm)||(!portrait&&paper.width_mm<paper.height_mm))[paper.width_mm,paper.height_mm]=[paper.height_mm,paper.width_mm];}
$('paperPreset').onchange=()=>{if($('paperPreset').value!=='custom'){[paper.width_mm,paper.height_mm]=$('paperPreset').value.split(',').map(Number);applyOrientation();}updatePaperFields();viewMode='sheet';draw();persistPaperPreferences();};
$('paperOrientation').onchange=()=>{applyOrientation();updatePaperFields();draw();persistPaperPreferences();};
$('paperUnit').onchange=()=>{updatePaperFields();draw();persistPaperPreferences();};
for(const [id,key] of [['paperWidth','width_mm'],['paperHeight','height_mm'],['marginLeft','left_mm'],['marginRight','right_mm'],['marginTop','top_mm'],['marginBottom','bottom_mm']])$(id).oninput=()=>{
 paper[key]=$(id).value===''?NaN:toMillimeters(Number($(id).value),$('paperUnit').value||'mm');
 if(marginsLinked&&marginKeys.includes(key)){
  for(const margin of marginKeys)paper[margin]=paper[key];
  for(const [field,margin] of [['marginLeft','left_mm'],['marginRight','right_mm'],['marginTop','top_mm'],['marginBottom','bottom_mm']]){
   if(field!==id)$(field).value=Number.isFinite(paper[margin])?Number(fromMillimeters(paper[margin],$('paperUnit').value||'mm').toFixed(6)).toString():'';
  }
 }
 if(id.startsWith('paper')){$('paperPreset').value='custom';$('paperOrientation').value=paper.width_mm>paper.height_mm?'landscape':'portrait';}
 viewMode='sheet';draw();persistPaperPreferences();
};
function sheetError(){if(isMixed())return mixedLayout().error;if(!validSettings(settings()))return 'Check photo size and print settings.';return sheetLayout(settings()).error;}
function status(message){$('status').textContent=message;}
function controls(){
 $('menuUndo').disabled=busy||loadingPhotos||!editHistory.canUndo;$('menuRedo').disabled=busy||loadingPhotos||!editHistory.canRedo;
 $('menuCopy').disabled=$('menuCut').disabled=busy||loadingPhotos||!photo||!validSettings(settings());$('menuPaste').disabled=busy||loadingPhotos;

 for(const id of ['menuLevels','menuCurves','menuSelectiveColor','menuRetouch','menuResetAdjustments'])$(id).disabled=busy||!photo;
 $('toggleSheetContents').disabled=busy;$('togglePaperSettings').disabled=busy;
 for(const id of ['collapsePrintLayout','expandPrintLayout','menuTogglePrintLayout'])$(id).disabled=busy;
 $('linkMargins').disabled=busy;$('linkQuantities').disabled=busy||!documents.length;updateQuantityLink();
 $('viewPhoto').disabled=busy;
 $('viewSheet').disabled=$('fitSheet').disabled=busy||!photo;
 for(const entry of quantityControls)entry.input.disabled=busy;
 for(const id of ['paperPreset','paperOrientation','paperUnit','paperWidth','paperHeight','marginLeft','marginRight','marginTop','marginBottom'])$(id).disabled=busy;
 $('sheetMode').disabled=busy;
 for(const button of tabControls)button.disabled=busy||(loadingPhotos&&button.className==='document-tab-close');
 $('menuClose').disabled=busy||loadingPhotos||!photo;
 for(const name of Object.keys(tools))$('tool'+name).disabled=busy;
 for(const name of Object.keys(tools))$('menu'+name).disabled=busy;
 $('menuCheckUpdates').disabled=busy||loadingPhotos;
 $('menuOpenProject').disabled=busy||loadingPhotos;
 $('menuSaveProject').disabled=busy||loadingPhotos||!photo;
 $('menuOpen').disabled=busy||loadingPhotos;
 $('menuSave').disabled=$('menuSaveAs').disabled=busy||loadingPhotos||!photo||!validSettings(settings());
 $('menuExportPhoto').disabled=$('menuExportSheet').disabled=busy||loadingPhotos||!photo||!validSettings(settings());
 $('openEmpty').disabled=busy||loadingPhotos;
 $('goCrop').disabled=busy;
 for(const id of ['unit','preset','width','height','gap','columnGap','rowGap','dpi','zoom']) $(id).disabled=busy;
 for(const id of ['reset']) $(id).disabled=busy||!photo||!validSettings(settings());
 for(const id of ['rotateLeft','rotateRight','rotationAngle','rotationSlider','resetRotation']) $(id).disabled=busy||!photo;
 $('backgroundStrength').disabled=!photo||(busy&&!backgroundAdjusting);
 $('removeBackground').disabled=busy||!photo||backgroundRemoved;
 $('restoreBackground').disabled=busy||!photo||!backgroundRemoved;
 $('background').disabled=busy||!photo||!backgroundRemoved;
 $('menuExportSheet').disabled=busy||loadingPhotos||!photo||!!sheetError();
 $('menuPrint').disabled=$('menuExportSheet').disabled;
}
function resetCrop(){zoom=1;pan={x:.5,y:.5};$('zoom').value=1;$('zoomValue').value='100%';}
function rebuildPhoto(maxSide=Infinity){
 const base=brushedCanvas(document,backgroundRemoved?photo.cutoutImage:photo.originalImage,adjustments.brushes);
 const working=document.createElement('canvas');
 const size=rotatedSize(photo.originalWidth,photo.originalHeight,rotation);
 const scale=Math.min(base.width/photo.originalWidth,base.height/photo.originalHeight,maxSide/size.width,maxSide/size.height);
 working.width=Math.max(1,Math.round(size.width*scale));working.height=Math.max(1,Math.round(size.height*scale));
 const painter=working.getContext('2d');painter.scale(working.width/size.width,working.height/size.height);painter.translate(size.width/2,size.height/2);painter.rotate(rotation*Math.PI/180);painter.drawImage(base,-photo.originalWidth/2,-photo.originalHeight/2,photo.originalWidth,photo.originalHeight);
 applyTone(working,adjustments);
 photo.image=working;photo.width=size.width;photo.height=size.height;
 $('rotationValue').value=`${rotation}°`;$('rotationAngle').value=rotation;$('rotationSlider').value=rotation;
 $('source').textContent=`${photo.originalWidth} × ${photo.originalHeight} original`;
}
function rect(){return cropRect(photo.width,photo.height,settings().width_mm/settings().height_mm,zoom,pan);}
function frame(){const ratio=settings().width_mm/settings().height_mm;const h=Math.min(420,480/ratio);return {x:(600-h*ratio)/2,y:(500-h)/2,w:h*ratio,h};}
function draw(previewOnly=false){
 if(!photo)viewMode='photo';
 if(!previewOnly)recordWorkspace();
 if(!previewOnly){controls();updateSheet();updateCanvasView();updatePhotoView();}
 if(viewMode==='sheet')return;
 if(!validSettings(settings())){const unit=$('unit').value;status(`Enter a valid size (${displayNumber(10)}–${displayNumber(101.6)} × ${displayNumber(10)}–${displayNumber(152.4)} ${unit}) and gap (0–${displayNumber(20)} ${unit}).`);return;}
 const s=settings();
 $('photoPixels').textContent=`${Math.round(s.width_mm/25.4*s.dpi)} × ${Math.round(s.height_mm/25.4*s.dpi)} px`;
 if(!photo)return;
 const r=rect(),f=frame();ctx.fillStyle='#252525';ctx.fillRect(0,0,600,500);
 ctx.save();ctx.beginPath();ctx.rect(f.x,f.y,f.w,f.h);ctx.clip();ctx.fillStyle=backgroundColors[$('background').value];ctx.fillRect(f.x,f.y,f.w,f.h);ctx.drawImage(photo.image,r.x*photo.image.width,r.y*photo.image.height,r.width*photo.image.width,r.height*photo.image.height,f.x,f.y,f.w,f.h);
 if(activeTool==='Crop'||activeTool==='Rotate'){ctx.strokeStyle='#ffffff77';ctx.lineWidth=1;for(let i=1;i<3;i++){ctx.beginPath();ctx.moveTo(f.x+f.w*i/3,f.y);ctx.lineTo(f.x+f.w*i/3,f.y+f.h);ctx.moveTo(f.x,f.y+f.h*i/3);ctx.lineTo(f.x+f.w,f.y+f.h*i/3);ctx.stroke();}}ctx.restore();ctx.strokeStyle='#fff';ctx.lineWidth=3;ctx.strokeRect(f.x,f.y,f.w,f.h);
 if(brushKinds.includes(activeTool)&&brushCursor){ctx.save();ctx.beginPath();ctx.arc(brushCursor.x,brushCursor.y,Math.max(1,Math.min(2000,Number($(activeTool.toLowerCase()+'Size').value)||40))/2,0,Math.PI*2);ctx.strokeStyle='#ffffff';ctx.lineWidth=1;ctx.stroke();ctx.restore();}
 if(activeTool==='Rotate'){const handle=rotationHandle();ctx.strokeStyle='#61aaf0';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(handle.x,f.y);ctx.lineTo(handle.x,handle.y);ctx.stroke();ctx.beginPath();ctx.arc(handle.x,handle.y,9,0,Math.PI*2);ctx.fillStyle='#ffffff';ctx.fill();ctx.stroke();}
}

const documents=[];
const tabControls=[];
const quantityControls=[];
function isMixed(){return $('sheetMode').value==='mixed';}
function editsFor(doc){return doc===photo?{zoom,pan,rotation,backgroundRemoved,backgroundStrength,adjustments:copyTone(adjustments),physical:{...physical},background:$('background').value}:doc.edits;}
function mixedItems(){return documents.map(doc=>{
 const edits=editsFor(doc),size=rotatedSize(doc.originalWidth,doc.originalHeight,edits.rotation);
 return {doc_id:doc.id,count:doc.sheetCount,crop:{...cropRect(size.width,size.height,edits.physical.width_mm/edits.physical.height_mm,edits.zoom,edits.pan),...edits.physical,dpi:Number($('dpi').value),rotation:edits.rotation,remove_background:edits.backgroundRemoved,background:edits.background,adjustments:edits.adjustments}};
});}
function mixedLayout(){return mixedSheetPages(mixedItems().map(item=>({...item.crop,count:item.count})),Number($('dpi').value),physical.gap_mm,paper);}
function updateQuantityLink(){
 const button=$('linkQuantities');button.setAttribute('aria-pressed',String(quantitiesLinked));
 button.setAttribute('aria-label',quantitiesLinked?'Unlink photo quantities':'Link photo quantities');
 button.title=quantitiesLinked?'Quantities linked - change one to update all':'Link quantities using the active photo value';
}
$('linkQuantities').onclick=()=>{
 if(busy||!documents.length)return;quantitiesLinked=!quantitiesLinked;
 if(quantitiesLinked){const count=photo?.sheetCount??documents[0].sheetCount;for(const doc of documents)doc.sheetCount=Number.isInteger(count)&&count>=0&&count<=100?count:1;}
 updateQuantityLink();renderQuantities();draw();persistPaperPreferences();
};
function newPhotoQuantity(){return quantitiesLinked?(photo?.sheetCount??documents[0]?.sheetCount??1):1;}
function renderQuantities(){
 const list=$('sheetQuantities');list.replaceChildren();quantityControls.length=0;
 for(const doc of documents){
  const row=document.createElement('div');row.className='quantity-row';
  const thumb=document.createElement('img');thumb.src=doc.preview;thumb.alt='';
  const name=document.createElement('button');name.className='quantity-name';name.textContent=doc.name;name.title=doc.name;name.onclick=()=>activateDocument(doc.id);
  const size=document.createElement('span');size.className='quantity-size';
  const info=document.createElement('div');info.append(name,size);
  const input=document.createElement('input');input.type='number';input.min=0;input.max=100;input.step=1;input.value=doc.sheetCount;input.setAttribute('aria-label','Copies of '+doc.name);input.disabled=busy;
  input.oninput=()=>{const value=input.value===''?NaN:Number(input.value);if(quantitiesLinked){for(const other of documents)other.sheetCount=value;for(const entry of quantityControls)entry.input.value=input.value;}else{doc.sheetCount=value;}draw();};
  row.append(thumb,info,input);list.append(row);quantityControls.push({doc,input,size});
 }
}
function sheetPreviewImage(doc,edits){
 if(doc===photo)return photo.image;
 const source=edits.backgroundRemoved?doc.cutoutImage:doc.originalImage;
 const base=source;
 const toneKey=JSON.stringify(edits.adjustments||defaultTone());
 if(doc.sheetPreview?.base===base&&doc.sheetPreview?.rotation===edits.rotation&&doc.sheetPreview?.toneKey===toneKey)return doc.sheetPreview.image;
 const size=rotatedSize(doc.originalWidth,doc.originalHeight,edits.rotation),scale=Math.min(base.width/doc.originalWidth,base.height/doc.originalHeight),working=document.createElement('canvas');
 working.width=Math.max(1,Math.round(size.width*scale));working.height=Math.max(1,Math.round(size.height*scale));
 const painter=working.getContext('2d');painter.scale(working.width/size.width,working.height/size.height);painter.translate(size.width/2,size.height/2);painter.rotate(edits.rotation*Math.PI/180);painter.drawImage(brushedCanvas(document,base,edits.adjustments?.brushes),-doc.originalWidth/2,-doc.originalHeight/2,doc.originalWidth,doc.originalHeight);
 applyTone(working,edits.adjustments||defaultTone());
 doc.sheetPreview={base,toneKey,rotation:edits.rotation,image:working};return working;
}
function updateCanvasView(){
 const showingSheet=viewMode==='sheet';
 const pageCount=isMixed()?mixedLayout().pages.length:1;$('sheetPageLabel').textContent=Math.max(1,pageCount)+' pages';
 sheetPages.hidden=!showingSheet;sheetViewport.setAttribute('data-sheet',String(showingSheet));
 $('viewPhoto').setAttribute('aria-pressed',String(!showingSheet));$('viewSheet').setAttribute('aria-pressed',String(showingSheet));
 largeSheet.hidden=!showingSheet;canvas.hidden=showingSheet||!photo;$('empty').hidden=showingSheet||!!photo;
 $('sheetViewControls').hidden=!showingSheet;if(!showingSheet)sheetDrag=null;applySheetView();
 $('canvasTitle').textContent=showingSheet?'Paper layout · '+paperSizeLabel():tools[activeTool].canvas;
 $('canvasViewHint').textContent=showingSheet?'Scroll to browse pages · Ctrl + wheel to zoom · Drag to pan':'Fit to workspace';
 const bounds=paperBounds(paper,Number($('dpi').value));
 $('source').textContent=showingSheet?(bounds.error?'Invalid paper settings':bounds.width+' × '+bounds.height+' px · '+$('dpi').value+' DPI'):(photo?photo.originalWidth+' × '+photo.originalHeight+' original':'No photo selected');
 $('largeSheetMessage').textContent=showingSheet?(sheetError()||''):'';$('largeSheetMessage').hidden=!showingSheet||!$('largeSheetMessage').textContent;
}
function setCanvasView(mode){if(busy||(mode==='sheet'&&!photo))return;cancelTransform();viewMode=mode;draw();}
$('viewPhoto').onclick=()=>setCanvasView('photo');$('viewSheet').onclick=()=>setCanvasView('sheet');
function updateSheet(){
 renderSheetTarget(sheet,sc,240);
 if(viewMode==='sheet'){
  const size=paper.width_mm+'x'+paper.height_mm;if(size!==lastSheetSize){lastSheetSize=size;fitSheet();}
  const count=Math.max(1,isMixed()?mixedLayout().pages.length:1);
  const width=Math.min(1200,Math.max(240,Math.floor(Math.sqrt(16000000/count/(paper.height_mm/paper.width_mm)))));
  const previousScroll=sheetViewport.scrollTop;
  const nodes=[];pageCanvases=[];
  for(let index=0;index<count;index++){
   const page=index===0?largeSheet:document.createElement('canvas');pageCanvases.push(page);
   const label=document.createElement('div');label.className='sheet-page-label';label.textContent='Page '+(index+1)+' / '+count;
   page.className='sheet-page-canvas';page.setAttribute('aria-label','Sheet page '+(index+1));
   renderSheetTarget(page,page.getContext('2d'),width,index);
   const bounds=paperBounds(paper,Number($('dpi').value));
   if(!bounds.error){const context=page.getContext('2d'),scale=page.width/bounds.width;context.save();context.strokeStyle='#2996d6';context.lineWidth=2;context.setLineDash([8,6]);context.strokeRect(bounds.left*scale,bounds.top*scale,bounds.usableWidth*scale,bounds.usableHeight*scale);context.restore();}
   nodes.push(label,page);
  }
  sheetPages.replaceChildren(...nodes);applySheetView();sheetViewport.scrollTop=previousScroll;
 }
}
function renderSheetTarget(sheet,sc,width,pageIndex=0){
 const bounds=paperBounds(paper,Number($('dpi').value));
 sheet.width=width;sheet.height=bounds.error?Math.round(width*1.5):Math.round(width*bounds.height/bounds.width);
 sc.fillStyle='white';sc.fillRect(0,0,sheet.width,sheet.height);$('mixedPhotos').hidden=!isMixed();
 if(bounds.error){$('sheetMessage').textContent=bounds.error;$('sheetMessage').setAttribute('data-error','true');return;}
 for(const {doc,size} of quantityControls){const e=editsFor(doc);size.textContent=e.physical.width_mm+' × '+e.physical.height_mm+' mm';}
 if(isMixed()){
  const items=mixedItems(),layout=mixedLayout(),dpi=Number($('dpi').value),scale=sheet.width/bounds.width;
  const total=items.reduce((sum,item)=>sum+(Number.isFinite(item.count)?item.count:0),0);
  $('count').textContent=total+' photos · '+layout.pages.length+' sheets';$('sheetMessage').textContent=layout.error||(layout.pages.length>1?total+' photos across '+layout.pages.length+' sheets. Export saves all pages in a ZIP.':'All selected copies fit on one sheet.');$('sheetMessage').setAttribute('data-error',String(!!layout.error));
  for(const p of layout.pages[pageIndex]||[]){const doc=documents[p.index],e=editsFor(doc),img=sheetPreviewImage(doc,e),r=items[p.index].crop;
   sc.fillStyle=backgroundColors[e.background];sc.fillRect(p.x*scale,p.y*scale,p.width*scale,p.height*scale);
   sc.drawImage(img,r.x*img.width,r.y*img.height,r.width*img.width,r.height*img.height,p.x*scale,p.y*scale,p.width*scale,p.height*scale);
  }return;
 }
 $('sheetMessage').textContent='';$('sheetMessage').setAttribute('data-error','false');
 if(!photo||!validSettings(settings())){$('count').textContent='Sheet preview';return;}
 const s=settings(),layout=sheetLayout(s),r=rect(),scale=sheet.width/bounds.width,px=v=>Math.round(v/25.4*s.dpi),pw=px(s.width_mm),ph=px(s.height_mm),gaps=sheetGaps(s.gap_mm,paper),gx=px(gaps.column),gy=px(gaps.row);$('count').textContent=layout.cols*layout.rows+' photos';
 $('sheetMessage').textContent=layout.error||'';$('sheetMessage').setAttribute('data-error',String(!!layout.error));
 for(let row=0;row<layout.rows;row++)for(let col=0;col<layout.cols;col++){
  const x=(bounds.left+col*(pw+gx))*scale,y=(bounds.top+row*(ph+gy))*scale;
  sc.fillStyle=backgroundColors[$('background').value];sc.fillRect(x,y,pw*scale,ph*scale);
  sc.drawImage(photo.image,r.x*photo.image.width,r.y*photo.image.height,r.width*photo.image.width,r.height*photo.image.height,x,y,pw*scale,ph*scale);
 }
}
$('sheetMode').onchange=()=>{viewMode='sheet';draw();persistPaperPreferences();};
async function exportMixedSheet(){
 if(busy||loadingPhotos)return;const layout=mixedLayout();if(layout.error){status(layout.error);return;}
 const items=mixedItems().filter(item=>item.count>0),dpi=Number($('dpi').value),gapMm=physical.gap_mm;busy=true;controls();status('Preparing mixed sheet…');
 try{const path=await invoke('export_mixed_sheet',{items,dpi,gapMm,paper:{...paper}});status(path?'Saved: '+path:'Export canceled');}catch(e){status('Export failed: '+e);}finally{busy=false;controls();}
}
const retouchDialog=createRetouchDialog({document,onPreview:(value,options)=>{adjustments=value;rebuildPhoto(options?.interactive?800:Infinity);draw(!!options?.interactive);},onClose:apply=>{busy=false;draw();status(apply?'Auto Retouch applied':'Auto Retouch canceled');}});
$('menuRetouch').onclick=()=>{if(busy||!photo)return;holdPhoto();cancelTransform();closeMenus();viewMode='photo';busy=true;controls();draw();retouchDialog.open(adjustments);};
const selectiveDialog=createSelectiveDialog({document,onPreview:(value,options)=>{adjustments=value;rebuildPhoto(options?.interactive?800:Infinity);draw(!!options?.interactive);},onClose:apply=>{busy=false;draw();status(apply?'Selective Color applied':'Selective Color canceled');}});
$('menuSelectiveColor').onclick=()=>{if(busy||!photo)return;holdPhoto();cancelTransform();closeMenus();viewMode='photo';busy=true;controls();draw();selectiveDialog.open(adjustments);};
const toneDialog=createToneDialog({document,onPreview:value=>{adjustments=value;rebuildPhoto();draw();},onClose:apply=>{busy=false;draw();status(apply?'Adjustments applied':'Adjustment canceled');}});
function openAdjustment(mode){if(busy||!photo)return;holdPhoto();cancelTransform();closeMenus();viewMode='photo';busy=true;controls();draw();toneDialog.open(mode,adjustments,photo.cutoutImage||photo.originalImage);}
$('menuLevels').onclick=()=>openAdjustment('levels');$('menuCurves').onclick=()=>openAdjustment('curves');
$('menuResetAdjustments').onclick=()=>{if(busy||!photo)return;holdPhoto();adjustments=defaultTone();rebuildPhoto();draw();status('Adjustments reset');};
const customPrintDialog=createPrintDialog({document,invoke,storage:{getItem:key=>window.localStorage.getItem(key),setItem:(key,value)=>window.localStorage.setItem(key,value)},onApply:(value,unit,preset)=>{
 Object.assign(paper,value);$('paperUnit').value=unit;$('paperPreset').value=preset;$('paperOrientation').value=paper.width_mm>paper.height_mm?'landscape':'portrait';
 if(marginsLinked&&['right_mm','top_mm','bottom_mm'].some(key=>paper[key]!==paper.left_mm))marginsLinked=false;
 updateMarginLinkButton();updatePaperFields();persistPaperPreferences();
}});
const printCanvasCache=new Map();
function preparedPrintPages(request){
 const key=JSON.stringify({request,edits:documents.map(doc=>({id:doc.id,edits:editsFor(doc),strength:doc.cutoutStrength}))});
 if(printCanvasCache.has(key))return {key,pages:printCanvasCache.get(key)};
 const count=isMixed()?mixedLayout().pages.length:1,pages=[];
 for(let index=0;index<count;index++){
  const preview=document.createElement('canvas');renderSheetTarget(preview,preview.getContext('2d'),Math.min(600,Math.max(120,Math.floor(Math.sqrt(8000000/count/(paper.height_mm/paper.width_mm))))),index);pages.push(preview);
 }
 printCanvasCache.set(key,pages);
 // Keep a small, bounded set of already composed sheet previews.
 while(printCanvasCache.size>4)printCanvasCache.delete(printCanvasCache.keys().next().value);
 return {key,pages};
}
async function printCurrentSheet(){
 if(busy||loadingPhotos||!photo)return;
 if(isMixed()){const layout=mixedLayout();if(layout.error){status(layout.error);return;}}
 else if(sheetError()){status('Check photo size and print settings before printing.');return;}
 const request={docId:photo.id,crop:{...rect(),...settings(),rotation,remove_background:backgroundRemoved,background:$('background').value,adjustments:copyTone(adjustments)},items:isMixed()?mixedItems().filter(item=>item.count>0):null};
 busy=true;controls();status('Print dialog opened');
 try{const prepared=preparedPrintPages(request);await customPrintDialog.open(request,{preparedPages:prepared.pages,contentKey:prepared.key,unit:$('paperUnit').value,preset:$('paperPreset').value,onClose:job=>{busy=false;controls();draw();status(job?'Print job '+job+' queued':'Print canceled');}});}
 catch(e){status('Could not open print dialog: '+e);busy=false;controls();}
}
function saveActiveDocument(){
 if(!photo)return;
 photo.edits={zoom,pan:{...pan},rotation,backgroundRemoved,backgroundStrength,adjustments:copyTone(adjustments),physical:{...physical},unit:$('unit').value,dpi:$('dpi').value,preset:$('preset').value,background:$('background').value,tool:activeTool};
}
function renderTabs(){
 renderQuantities();const container=$('documentTabs');container.replaceChildren();tabControls.length=0;
 if(!documents.length){const placeholder=document.createElement('span');placeholder.className='no-documents';placeholder.textContent='No documents · Open photos to begin';container.append(placeholder);return;}
 for(const doc of documents){
  const item=document.createElement('div');item.className='document-tab-item';
  const tab=document.createElement('button');tab.className='document-tab-button';tab.textContent=doc.name;tab.title=doc.name;tab.id='document-'+doc.id;
  tab.setAttribute('role','tab');tab.setAttribute('aria-selected',String(doc===photo));tab.tabIndex=doc===photo?0:-1;tab.disabled=busy;
  tab.onclick=()=>activateDocument(doc.id);
  tab.onkeydown=e=>{const index=documents.indexOf(doc);let next;if(e.key==='ArrowRight')next=(index+1)%documents.length;if(e.key==='ArrowLeft')next=(index-1+documents.length)%documents.length;if(e.key==='Home')next=0;if(e.key==='End')next=documents.length-1;if(next!==undefined){e.preventDefault();activateDocument(documents[next].id);$('document-'+documents[next].id)?.focus();}};
  const close=document.createElement('button');close.className='document-tab-close';close.textContent='×';close.title='Close '+doc.name;close.setAttribute('aria-label','Close '+doc.name);close.disabled=busy||loadingPhotos;close.onclick=()=>closeDocument(doc.id);
  item.setAttribute('data-active',String(doc===photo));item.append(tab,close);container.append(item);tabControls.push(tab,close);
 }
}
function activateDocument(id,force=false){
 if(busy&&!force)return;if(loadingPhotos&&!force)followOpeningPhotos=false;const next=documents.find(doc=>doc.id===id);if(!next)return;
 cancelTransform();saveActiveDocument();photo=next;viewMode='photo';
 const edits=next.edits;zoom=edits.zoom;pan={...edits.pan};rotation=edits.rotation;backgroundRemoved=edits.backgroundRemoved;adjustments=copyTone(edits.adjustments||defaultTone());backgroundStrength=edits.backgroundStrength??100;updateStrengthLabel();physical.width_mm=edits.physical.width_mm;physical.height_mm=edits.physical.height_mm;
 $('unit').value=edits.unit;$('preset').value=edits.preset;$('background').value=edits.background;
 $('zoom').value=zoom;$('zoomValue').value=Math.round(zoom*100)+'%';updateUnits();rebuildPhoto();
 $('empty').hidden=true;canvas.hidden=false;$('fileName').textContent=photo.name;
 setTool(edits.tool,true);renderTabs();draw();status(photo.name+' · Ready');
 $('document-'+id)?.scrollIntoView({block:'nearest',inline:'nearest'});
}
async function closeDocument(id){
 if(busy||loadingPhotos)return;const index=documents.findIndex(doc=>doc.id===id);if(index<0)return;
 busy=true;controls();closeMenus();
 try{await invoke('close_photo',{docId:id});const wasActive=photo?.id===id;documents.splice(index,1);editHistory.reset();retainedDocuments.delete(id);
  if(wasActive){photo=null;if(documents.length)activateDocument(documents[Math.min(index,documents.length-1)].id,true);else{
   rotation=0;backgroundRemoved=false;resetCrop();$('rotationValue').value='0°';$('rotationAngle').value=0;$('rotationSlider').value=0;$('background').value='white';
   $('empty').hidden=false;canvas.hidden=true;$('source').textContent='No photo selected';$('fileName').textContent='Untitled';
  }}
  renderTabs();status(documents.length?'Photo closed · '+documents.length+' open':'All photos closed · Open photos to begin');
 }catch(e){status('Could not close photo: '+e);}finally{busy=false;controls();draw();}
}
function showOpenProgress(title,detail,value=null){
 $('openLoading').hidden=false;$('openLoadingTitle').textContent=title;$('openLoadingDetail').textContent=detail;
 if(value===null)$('openLoadingProgress').removeAttribute('value');else $('openLoadingProgress').value=value;
}
async function open(){
 if(busy||loadingPhotos)return;
 saveActiveDocument();loadingPhotos=true;followOpeningPhotos=true;controls();
 showOpenProgress('Opening photos','Choose photos to open...');status('Opening photos...');
 let opening=true,pollTask=null,ready=0,total=0;
 const errors=[];
 async function addPreviews(photos){
  for(const opened of photos){
   try{
    const previewStart=performance.now(),img=new Image();img.src=opened.preview;await img.decode();
    if(opened.timings)console.debug('Photo preview loading',{backend:opened.timings,browser_decode_ms:performance.now()-previewStart});
    documents.push({...opened,sheetCount:newPhotoQuantity(),originalImage:img,originalWidth:opened.width,originalHeight:opened.height,cutoutImage:null,cutoutStrength:null,edits:{zoom:1,pan:{x:.5,y:.5},rotation:0,backgroundRemoved:false,backgroundStrength:defaultBackgroundStrength,adjustments:defaultTone(),physical:{width_mm:defaultPhotoSize.width_mm,height_mm:defaultPhotoSize.height_mm,gap_mm:3},unit:defaultPhotoSize.unit,dpi:'300',preset:defaultPhotoSize.preset,background:defaultBackgroundColor,tool:activeTool}});
    ready++;if(followOpeningPhotos&&!busy)activateDocument(opened.id,true);else{renderTabs();draw();}
   }catch(e){errors.push(opened.name+': '+e);try{await invoke('close_photo',{docId:opened.id});}catch{}}
   controls();
   showOpenProgress('Opening photos',`${ready} ready / ${Math.max(ready,total)} selected - ${opened.name}`,Math.min(99,ready/Math.max(1,total)*100));
   // Yield for painting each new tab/preview before decoding the next image.
   await new Promise(resolve=>setTimeout(resolve,0));
  }
 }
 const timer=setInterval(()=>{
  if(!opening||pollTask)return;
  pollTask=(async()=>{try{
   const progress=await invoke('open_progress');total=progress.total;
   if(total>0)showOpenProgress('Loading photos',`${progress.completed} / ${total} processed - ${progress.name}`,Math.min(99,progress.completed/total*100));
   await addPreviews(progress.photos||[]);
  }catch(e){console.debug('Photo loading progress unavailable',e);}finally{pollTask=null;}})();
 },100);
 try{
  const result=await invoke('open_photo');opening=false;clearInterval(timer);
  // A progress response may already own previews not included in the final response.
  if(pollTask)await pollTask;
  if(result){errors.push(...result.errors);await addPreviews(result.photos);
   if(!busy)status((ready?documents.length+' photos open':'No photos opened')+(errors.length?' - Could not open: '+errors.join('; '):''));
  }else if(!busy)status('Open canceled');
 }catch(e){opening=false;clearInterval(timer);if(pollTask)await pollTask;if(!busy)status('Could not open photos: '+e);}
 finally{opening=false;clearInterval(timer);loadingPhotos=false;$('openLoading').hidden=true;controls();draw();}
}
$('openEmpty').onclick=open;
function rememberPhotoSize(){holdPhoto();const size={width_mm:physical.width_mm,height_mm:physical.height_mm,unit:$('unit').value,preset:$('preset').value};if(validPhotoSize(size)){defaultPhotoSize=size;persistPaperPreferences();}}
$('unit').onchange=()=>{updateUnits();draw();rememberPhotoSize();};
$('preset').onchange=()=>{if($('preset').value!=='custom'){const [w,h]=$('preset').value.split(',').map(Number);physical.width_mm=w;physical.height_mm=h;updateUnits();zoom=1;$('zoom').value=1;$('zoomValue').value='100%';pan={x:.5,y:.5};}draw();rememberPhotoSize();};
for(const [id,key] of [['width','width_mm'],['height','height_mm'],['gap','gap_mm']])$(id).oninput=()=>{physical[key]=$(id).value===''?NaN:toMillimeters(Number($(id).value),$('unit').value);if(id==='width'||id==='height')$('preset').value='custom';if(id==='gap'){paper.column_gap_mm=physical.gap_mm;paper.row_gap_mm=physical.gap_mm;updateGapFields();}draw();if(id==='gap')persistPaperPreferences();else rememberPhotoSize();};
$('dpi').oninput=()=>{draw();persistPaperPreferences();};
$('zoom').oninput=()=>{holdPhoto();zoom=Number($('zoom').value);$('zoomValue').value=`${Math.round(zoom*100)}%`;draw();};
$('reset').onclick=()=>{holdPhoto();resetCrop();draw();};
function setRotation(angle){if(busy||!photo||!Number.isFinite(angle))return;holdPhoto();rotation=normalizeAngle(angle);rebuildPhoto();draw();status(`Rotation: ${rotation}°`);}
$('rotateLeft').onclick=()=>setRotation(rotation-90);$('rotateRight').onclick=()=>setRotation(rotation+90);
$('rotationAngle').oninput=()=>{const input=$('rotationAngle'),text=input.value;if(text!==''&&Number.isFinite(Number(text))){setRotation(Number(text));input.value=text;}};
$('rotationAngle').onchange=()=>{$('rotationAngle').value=rotation;};
$('rotationSlider').oninput=()=>setRotation(Number($('rotationSlider').value));
$('resetRotation').onclick=()=>setRotation(0);
$('background').onchange=()=>{holdPhoto();defaultBackgroundColor=$('background').value;persistPaperPreferences();draw();status(`Background: ${$('background').value}`);};
function updateStrengthLabel(){$('backgroundStrength').value=backgroundStrength;$('backgroundStrengthValue').value=backgroundStrength+'%';}
async function cutoutAtStrength(strength){const preview=await invoke('remove_background',{docId:photo.id,strength});const image=new Image();image.src=preview;await image.decode();return image;}
async function applyBackgroundStrength(){
 clearTimeout(strengthTimer);
 if(strengthWorking||!photo||!backgroundRemoved||(busy&&!backgroundAdjusting))return;
 strengthWorking=true;backgroundAdjusting=true;busy=true;controls();status('Refining hair and background edges…');
 try{let appliedStrength=photo.cutoutStrength;while(appliedStrength!==backgroundStrength){const target=backgroundStrength;const image=await cutoutAtStrength(target);appliedStrength=target;
  if(target===backgroundStrength){photo.cutoutImage=image;photo.cutoutStrength=target;rebuildPhoto();draw();}
 }status('Background strength: '+backgroundStrength+'% · Lower preserves more fine hair.');}
 catch(e){backgroundStrength=photo.cutoutStrength??100;updateStrengthLabel();status('Could not update strength: '+e);}
 finally{strengthWorking=false;backgroundAdjusting=false;busy=false;draw();}
}
$('backgroundStrength').oninput=()=>{
 holdPhoto(); backgroundStrength=Number($('backgroundStrength').value);defaultBackgroundStrength=backgroundStrength;updateStrengthLabel();persistPaperPreferences();
 if(!photo||!backgroundRemoved)return;
 busy=true;backgroundAdjusting=true;controls();clearTimeout(strengthTimer);
 if(!strengthWorking)strengthTimer=setTimeout(applyBackgroundStrength,180);
};
$('backgroundStrength').onchange=()=>applyBackgroundStrength();
$('removeBackground').onclick=async()=>{
 if(busy||!photo||backgroundRemoved)return;holdPhoto();busy=true;controls();status('Removing background locally… Please wait.');
 try{if(!photo.cutoutImage||photo.cutoutStrength!==backgroundStrength){photo.cutoutImage=await cutoutAtStrength(backgroundStrength);photo.cutoutStrength=backgroundStrength;}
 backgroundRemoved=true;rebuildPhoto();status('Background removed · Choose white, blue or red.');}
 catch(e){status(String(e));}finally{busy=false;draw();}
};
$('restoreBackground').onclick=()=>{if(busy||!photo)return;holdPhoto();backgroundRemoved=false;rebuildPhoto();draw();status('Original background restored.');};
function rotationHandle(){const f=frame();return {x:f.x+f.w/2,y:Math.max(14,f.y-24)};}
function canvasPoint(e){const box=canvas.getBoundingClientRect(),scale=Math.min(box.width/600,box.height/500);return {x:(e.clientX-box.left-(box.width-600*scale)/2)/scale,y:(e.clientY-box.top-(box.height-500*scale)/2)/scale};}
function pointerAngle(p){return Math.atan2(p.y-250,p.x-300)*180/Math.PI;}
function brushPoint(p){
 const f=frame();if(p.x<f.x||p.y<f.y||p.x>f.x+f.w||p.y>f.y+f.h)return null;
 const r=rect(),x=(r.x+(p.x-f.x)/f.w*r.width-.5)*photo.width,y=(r.y+(p.y-f.y)/f.h*r.height-.5)*photo.height;
 const angle=rotation*Math.PI/180,c=Math.cos(angle),sin=Math.sin(angle);
 const point=[(c*x+sin*y)/photo.originalWidth+.5,(-sin*x+c*y)/photo.originalHeight+.5];
 return point.every(v=>v>=0&&v<=1)?point:null;
}
function refreshBrush(interactive=true){clearTimeout(brushTimer);brushTimer=null;rebuildPhoto(interactive?800:Infinity);draw(interactive);}
function finishBrush(cancel=false){if(drag?.mode!=='brush')return false;clearTimeout(brushTimer);if(cancel)adjustments=drag.original;drag=null;brushCursor=null;refreshBrush(false);return true;}
canvas.onpointerleave=()=>{if(!drag){brushCursor=null;draw(true);}};
function appendBrush(p){const point=brushPoint(p);if(!point||drag.stroke.points.length>=1000)return;const last=drag.stroke.points.at(-1);if(last&&Math.hypot((point[0]-last[0])*photo.originalWidth,(point[1]-last[1])*photo.originalHeight)<drag.stroke.radius*Math.max(photo.originalWidth,photo.originalHeight)*.15)return;drag.stroke.points.push(point);if(!brushTimer)brushTimer=setTimeout(()=>refreshBrush(),16);}
canvas.onpointerdown=e=>{if(viewMode!=='photo'||busy||!photo||!validSettings(settings())||e.button!==0||activeTool==='Background')return;holdPhoto();const p=canvasPoint(e),h=rotationHandle();if(activeTool==='Zoom'){drag={mode:'viewpan',x:e.clientX,y:e.clientY,left:sheetViewport.scrollLeft||0,top:sheetViewport.scrollTop||0,alt:e.altKey,moved:false};canvas.setPointerCapture(e.pointerId);return;}if(brushKinds.includes(activeTool)){const point=brushPoint(p);if(!point)return;if((adjustments.brushes?.length||0)>=500||(adjustments.brushes||[]).reduce((n,s)=>n+s.points.length,0)>=9000){status('Brush history is full. Undo or save a flattened photo.');return;}const f=frame(),r=rect(),size=Math.max(1,Math.min(2000,Number($(activeTool.toLowerCase()+'Size').value)||40));const original=copyTone(adjustments),stroke={kind:activeTool,radius:Math.min(4,size/2/f.w*r.width*photo.width/Math.max(photo.originalWidth,photo.originalHeight)),strength:Number($(activeTool.toLowerCase()+'Strength').value)/100,points:[point]};adjustments.brushes??=[];adjustments.brushes.push(stroke);drag={mode:'brush',stroke,original};canvas.focus();canvas.setPointerCapture(e.pointerId);refreshBrush();return;}if(activeTool==='Rotate'&&Math.hypot(p.x-h.x,p.y-h.y)>16)return;drag={mode:activeTool==='Rotate'?'rotate':'pan',point:p,angle:pointerAngle(p),rotation,pan:{...pan}};canvas.focus();canvas.setPointerCapture(e.pointerId);};
canvas.onpointermove=e=>{
 if(viewMode!=='photo'||busy||!photo||!validSettings(settings()))return;const p=canvasPoint(e),h=rotationHandle();
 if(drag?.mode==='viewpan'){const dx=e.clientX-drag.x,dy=e.clientY-drag.y;drag.moved ||= Math.hypot(dx,dy)>3;sheetViewport.scrollLeft=drag.left-dx;sheetViewport.scrollTop=drag.top-dy;return;}if(activeTool==='Zoom'){canvas.style.cursor=e.altKey?'zoom-out':'zoom-in';return;}if(brushKinds.includes(activeTool)){brushCursor=p;canvas.style.cursor='crosshair';if(drag?.mode==='brush')appendBrush(p);draw(true);return;}
 canvas.style.cursor=activeTool==='Rotate'?(drag||Math.hypot(p.x-h.x,p.y-h.y)<=16?'crosshair':'default'):activeTool==='Background'?'default':'grab';
 if(!drag)return;
 if(drag.mode==='rotate'){let angle=drag.rotation+pointerAngle(p)-drag.angle;if(e.shiftKey)angle=Math.round(angle/15)*15;setRotation(angle);return;}
 const f=frame(),r=rect();pan.x=Math.max(0,Math.min(1,drag.pan.x-(p.x-drag.point.x)/f.w*r.width));pan.y=Math.max(0,Math.min(1,drag.pan.y-(p.y-drag.point.y)/f.h*r.height));draw();
};
function cancelTransform(){if(drag?.mode==='viewpan'){drag=null;return;}if(finishBrush(true))return;if(drag){const previous=drag;drag=null;pan=previous.pan;setRotation(previous.rotation);}}
canvas.onpointerup=()=>{if(drag?.mode==='viewpan'){const zoomDrag=drag;drag=null;if(!zoomDrag.moved)zoomPhoto(photoViewZoom*(zoomDrag.alt?.8:1.25));return;}if(finishBrush())return;drag=null;draw();};canvas.onpointercancel=cancelTransform;canvas.onlostpointercapture=()=>{if(finishBrush())return;drag=null;draw();};
canvas.onkeydown=e=>{if(viewMode!=='photo'||busy||!photo)return;if(e.key==='Escape'){cancelTransform();return;}holdPhoto();if(activeTool==='Rotate'&&['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();setRotation(rotation+(e.key==='ArrowLeft'?-1:1)*(e.shiftKey?1:.1));return;}const moves={ArrowLeft:[-.01,0],ArrowRight:[.01,0],ArrowUp:[0,-.01],ArrowDown:[0,.01]};if((activeTool==='Move'||activeTool==='Crop')&&moves[e.key]){e.preventDefault();pan.x=Math.max(0,Math.min(1,pan.x+moves[e.key][0]));pan.y=Math.max(0,Math.min(1,pan.y+moves[e.key][1]));draw();}};
async function exportImage(isSheet){if(isSheet&&sheetError()){status(sheetError());return;}if(isSheet&&isMixed())return exportMixedSheet();if(busy||loadingPhotos||!photo||!validSettings(settings()))return;busy=true;controls();status('Preparing full-resolution PNG…');try{const path=await invoke('export_photo',{docId:photo.id,crop:{...rect(),...settings(),rotation,remove_background:backgroundRemoved,background:$('background').value,adjustments:copyTone(adjustments)},sheet:isSheet});status(path?`Saved: ${path}`:'Export canceled');}catch(e){status(`Export failed: ${e}`);}finally{busy=false;controls();}}
$('unit').value='in';$('paperUnit').value='in';$('preset').value='27.94,33.02';restorePaperPreferences();updateStrengthLabel();applyPrintLayoutVisibility();applySheetContentsVisibility();applyPaperSettingsVisibility();updateUnits();renderTabs();setTool('Move');

async function savePhoto(saveAs){
 if(busy||loadingPhotos||!photo||!validSettings(settings()))return;
 busy=true;controls();status('Saving full-resolution photo...');
 try{const path=await invoke('save_photo',{docId:photo.id,saveAs,crop:{...rect(),...settings(),rotation,remove_background:backgroundRemoved,background:$('background').value,adjustments:copyTone(adjustments)}});status(path?'Saved: '+path:'Save canceled');}
 catch(e){status('Save failed: '+e);}finally{busy=false;controls();}
}

async function saveProject(forUpdate=false){
 if((busy&&!forUpdate)||loadingPhotos||!photo)return false;cancelTransform();saveActiveDocument();
 const manifest={version:1,active:documents.indexOf(photo),viewMode,sheetView:{...sheetView},settings:projectSettings(),documents:documents.map(d=>({id:d.id,name:d.name,sheetCount:d.sheetCount,edits:structuredClone(d.edits)}))};
 if(!validProject(manifest)){status('Check photo and paper settings before saving a project.');return;}
 busy=true;controls();status('Saving project with full-resolution photos...');showOpenProgress('Saving project','Embedding photos and edits...');
 try{const path=await invoke('save_project',{manifest});status(path?'Project saved: '+path:'Project save canceled');return !!path;}
 catch(e){status('Could not save project: '+e);}finally{busy=false;$('openLoading').hidden=true;controls();}
}
async function openProject(){
 if(busy||loadingPhotos)return;cancelTransform();saveActiveDocument();busy=true;controls();showOpenProgress('Opening project','Choose an ID Photo project...');status('Opening project...');let result=null,committed=false;
 try{
  result=await invoke('open_project');if(!result){status('Open project canceled');return;}
  showOpenProgress('Opening project','Restoring photo previews...');const prepared=await decodeProjectPhotos(result);
  // Keep existing edits, but exclude old tabs from the restored project sheet.
  photo=null;for(const doc of documents)doc.sheetCount=0;documents.push(...prepared);committed=true;const p=result.manifest;restorePaperPreferences(loadPaperPreferences({getItem:()=>JSON.stringify(p.settings)}));updatePaperFields();applyPrintLayoutVisibility();applyPaperSettingsVisibility();applySheetContentsVisibility();
  activateDocument(prepared[p.active].id,true);viewMode=p.viewMode;lastSheetSize=paper.width_mm+'x'+paper.height_mm;sheetView={...p.sheetView};applySheetView();draw();persistPaperPreferences();status('Project opened: '+prepared.length+' photos restored');
 }catch(e){if(result&&!committed)for(const opened of result.photos||[])try{await invoke('close_photo',{docId:opened.id});}catch{}status('Could not open project: '+e);}
 finally{busy=false;$('openLoading').hidden=true;recordWorkspace();controls();}
}

const updateDialog=createUpdateDialog({document,invoke,onBusy:value=>{busy=value;controls();},beforeInstall:()=>saveProject(true),hasPhotos:()=>documents.length>0});
$('menuCheckUpdates').onclick=()=>{if(busy||loadingPhotos)return;closeMenus();return updateDialog.open();};

for(const [id,key] of [['columnGap','column_gap_mm'],['rowGap','row_gap_mm']])$(id).oninput=()=>{paper[key]=$(id).value===''?NaN:toMillimeters(Number($(id).value),$('unit').value);draw();persistPaperPreferences();};

function workspaceState(){
 saveActiveDocument();
 return {settings:projectSettings(),active:photo?.id,viewMode,sheetView:{...sheetView},docs:documents.map(doc=>({doc,edits:structuredClone(doc.edits),count:doc.sheetCount}))};
}
function recordWorkspace(){
 if(busy||historyRestoring||drag||strengthWorking)return;
 const state=workspaceState(),manifest={version:1,active:Math.max(0,documents.indexOf(photo)),viewMode,sheetView,settings:state.settings,documents:state.docs.map(d=>({id:d.doc.id,name:d.doc.name,sheetCount:d.count,edits:d.edits}))};
 if(state.docs.length&&!validProject(manifest))return;
 const key=JSON.stringify({settings:state.settings,docs:manifest.documents.map(d=>({...d,edits:{...d.edits,tool:undefined,dpi:undefined,physical:{width_mm:d.edits.physical.width_mm,height_mm:d.edits.physical.height_mm}}}))});
 editHistory.record(state,key,historyGroup);
 for(const {doc} of state.docs)retainedDocuments.set(doc.id,doc);
 const reachable=new Set(documents.map(d=>d.id));for(const entry of editHistory.entries)for(const d of entry.state.docs)reachable.add(d.doc.id);
 for(const [id] of retainedDocuments)if(!reachable.has(id)){retainedDocuments.delete(id);invoke('close_photo',{docId:id}).catch(()=>{});}
}
async function restoreHistory(redo=false){
 if(busy||loadingPhotos||!(redo?editHistory.canRedo:editHistory.canUndo))return;
 const target=editHistory.target(redo);busy=true;historyRestoring=true;controls();
 try{
  // Restore Rust's cached matte too, so full-resolution export matches Undo preview.
  for(const {doc,edits} of target.docs)if(edits.backgroundRemoved&&doc.cutoutStrength!==edits.backgroundStrength){const data=await invoke('remove_background',{docId:doc.id,strength:edits.backgroundStrength});const image=new Image();image.src=data;await image.decode();doc.cutoutImage=image;doc.cutoutStrength=edits.backgroundStrength;}
  photo=null;documents.splice(0,documents.length,...target.docs.map(d=>{d.doc.edits=structuredClone(d.edits);d.doc.sheetCount=d.count;return d.doc;}));
  restorePaperPreferences(target.settings);updatePaperFields();applyPrintLayoutVisibility();applyPaperSettingsVisibility();applySheetContentsVisibility();
  if(documents.length)activateDocument(documents.find(d=>d.id===target.active)?.id||documents[0].id,true);
  else{renderTabs();canvas.hidden=true;$('empty').hidden=false;$('fileName').textContent='Untitled';}
  viewMode=target.viewMode;sheetView={...target.sheetView};applySheetView();editHistory.commit(redo);persistPaperPreferences();draw();status(redo?'Redo':'Undo');
 }catch(e){status('Could not restore edit: '+e);}finally{historyRestoring=false;busy=false;controls();}
}
async function copyPhoto(cut=false){
 if(busy||loadingPhotos||!photo||!validSettings(settings()))return;
 recordWorkspace();const doc=photo;busy=true;controls();closeMenus();
 try{
  await invoke('copy_photo',{docId:doc.id,crop:{...rect(),...settings(),rotation,remove_background:backgroundRemoved,background:$('background').value,adjustments:copyTone(adjustments)}});
  if(cut){saveActiveDocument();const index=documents.indexOf(doc);documents.splice(index,1);photo=null;if(documents.length)activateDocument(documents[Math.min(index,documents.length-1)].id,true);else{renderTabs();canvas.hidden=true;$('empty').hidden=false;$('fileName').textContent='Untitled';}}
  status(cut?'Photo cut to clipboard. Undo restores its editable tab.':'Edited photo copied to Windows clipboard.');
 }catch(e){status('Clipboard copy failed: '+e);}finally{busy=false;draw();}
}
async function pastePhoto(){
 if(busy||loadingPhotos)return;recordWorkspace();busy=true;controls();closeMenus();let opened;
 try{
  opened=await invoke('paste_photo');const image=new Image();image.src=opened.preview;await image.decode();
  documents.push({...opened,sheetCount:newPhotoQuantity(),originalImage:image,originalWidth:opened.width,originalHeight:opened.height,cutoutImage:null,cutoutStrength:null,edits:{zoom:1,pan:{x:.5,y:.5},rotation:0,backgroundRemoved:false,backgroundStrength:defaultBackgroundStrength,adjustments:defaultTone(),physical:{width_mm:defaultPhotoSize.width_mm,height_mm:defaultPhotoSize.height_mm,gap_mm:physical.gap_mm},unit:defaultPhotoSize.unit,dpi:$('dpi').value,preset:defaultPhotoSize.preset,background:defaultBackgroundColor,tool:activeTool}});
  activateDocument(opened.id,true);status('Clipboard image pasted as a new photo tab.');
 }catch(e){if(opened)try{await invoke('close_photo',{docId:opened.id});}catch{}status('Clipboard paste failed: '+e);}finally{busy=false;draw();}
}
$('menuUndo').onclick=()=>{closeMenus();return restoreHistory(false);};$('menuRedo').onclick=()=>{closeMenus();return restoreHistory(true);};$('menuCopy').onclick=()=>copyPhoto(false);$('menuCut').onclick=()=>copyPhoto(true);$('menuPaste').onclick=pastePhoto;
// Range drags form one history step. Number typing stays grouped until blur/change.
for(const id of ['zoom','rotationSlider','rotationAngle','width','height','backgroundStrength','gap','columnGap','rowGap','paperWidth','paperHeight','marginLeft','marginRight','marginTop','marginBottom']){
 const input=$(id),previousChange=input.onchange;
 input.onfocus=()=>{historyGroup=++editGesture;};input.onpointerdown=()=>{historyGroup=++editGesture;};
 input.onchange=async(...args)=>{if(previousChange)await previousChange(...args);historyGroup=null;};input.onblur=()=>{historyGroup=null;};
}



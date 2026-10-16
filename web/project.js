import {validTone} from './tone.js';
import {validPaperPreferences,validPhotoSize} from './preferences.js';
import {validSettings} from './geometry.js';
export function validProject(p){
 if(!p||p.version!==1||!validPaperPreferences(p.settings)||!Array.isArray(p.documents)||!p.documents.length||!Number.isInteger(p.active)||p.active<0||p.active>=p.documents.length||!['photo','sheet'].includes(p.viewMode))return false;
 if(!p.sheetView||![p.sheetView.zoom,p.sheetView.x,p.sheetView.y].every(Number.isFinite)||p.sheetView.zoom<.25||p.sheetView.zoom>8)return false;
 return p.documents.every(d=>{const e=d.edits;return typeof d.name==='string'&&Number.isInteger(d.sheetCount)&&d.sheetCount>=0&&d.sheetCount<=100&&!!e&&Number.isFinite(e.zoom)&&e.zoom>=1&&e.zoom<=10&&Number.isFinite(e.rotation)&&Math.abs(e.rotation)<=180&&e.pan&&[e.pan.x,e.pan.y].every(n=>Number.isFinite(n)&&n>=0&&n<=1)&&typeof e.backgroundRemoved==='boolean'&&Number.isInteger(e.backgroundStrength)&&e.backgroundStrength>=0&&e.backgroundStrength<=100&&['white','blue','red'].includes(e.background)&&['Move','Crop','Rotate','Background'].includes(e.tool)&&validSettings({...e.physical,dpi:Number(e.dpi)})&&validPhotoSize({...e.physical,unit:e.unit,preset:e.preset})&&validTone(e.adjustments);});
}
export async function decodeProjectPhotos(result,ImageType=Image){
 if(!validProject(result.manifest)||!Array.isArray(result.photos)||result.photos.length!==result.manifest.documents.length)throw Error('Invalid project settings or missing photos.');
 const prepared=[];
 for(let i=0;i<result.photos.length;i++){
  const opened=result.photos[i],saved=result.manifest.documents[i],img=new ImageType();img.src=opened.preview;await img.decode();
  let cutout=null;if(opened.cutout_preview){cutout=new ImageType();cutout.src=opened.cutout_preview;await cutout.decode();}
  if(saved.edits.backgroundRemoved&&!cutout)throw Error('Project is missing a removed-background image.');
  prepared.push({...opened,name:saved.name,sheetCount:saved.sheetCount,originalImage:img,originalWidth:opened.width,originalHeight:opened.height,cutoutImage:cutout,cutoutStrength:cutout?saved.edits.backgroundStrength:null,edits:structuredClone(saved.edits)});
 }
 return prepared;
}

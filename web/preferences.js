import { paperBounds } from './geometry.js';
export const PAPER_SETTINGS_KEY='id-photo-studio.paper-settings.v1';
const presets=['101.6,152.4','127,177.8','152.4,203.2','203.2,254','148,210','210,297','297,420','215.9,279.4','custom'];
export function validPhotoSize(value){
 return !!value&&Number.isFinite(value.width_mm)&&value.width_mm>=10&&value.width_mm<=101.6&&Number.isFinite(value.height_mm)&&value.height_mm>=10&&value.height_mm<=152.4&&['mm','cm','in'].includes(value.unit)&&['27.94,33.02','20.32,22.86','35,45','25,35','30,40','50.8,50.8','custom'].includes(value.preset)&&(value.preset==='custom'||value.preset===`${value.width_mm},${value.height_mm}`);
}
export function validPaperPreferences(value){
 if(!value||value.version!==1||!value.paper||paperBounds(value.paper,300).error)return false;
 if(!['mm','cm','in'].includes(value.unit)||!['portrait','landscape'].includes(value.orientation)||!presets.includes(value.preset)||typeof value.linked!=='boolean')return false;
 if(value.linked&&['right_mm','top_mm','bottom_mm'].some(key=>value.paper[key]!==value.paper.left_mm))return false;
 if(value.gap_mm!==undefined&&(!Number.isFinite(value.gap_mm)||value.gap_mm<0||value.gap_mm>20))return false;
 if(value.dpi!==undefined&&![150,300,600].includes(value.dpi))return false;
 if(value.quantities_linked!==undefined&&typeof value.quantities_linked!=='boolean')return false;
 if(value.sheet_mode!==undefined&&!['single','mixed'].includes(value.sheet_mode))return false;
 if(value.panel_visible!==undefined&&typeof value.panel_visible!=='boolean')return false;
 if(value.paper_settings_visible!==undefined&&typeof value.paper_settings_visible!=='boolean')return false;
 if(value.sheet_contents_visible!==undefined&&typeof value.sheet_contents_visible!=='boolean')return false;
 if(value.background_strength!==undefined&&(!Number.isInteger(value.background_strength)||value.background_strength<0||value.background_strength>100))return false;
 if(value.background_color!==undefined&&!['white','blue','red'].includes(value.background_color))return false;
 if(value.photo_size!==undefined&&!validPhotoSize(value.photo_size))return false;
 return true;
}
export function loadPaperPreferences(storage){
 try{const value=JSON.parse(storage.getItem(PAPER_SETTINGS_KEY));return validPaperPreferences(value)?{...value,photo_size:value.photo_size??{width_mm:27.94,height_mm:33.02,unit:'in',preset:'27.94,33.02'},background_color:value.background_color??'white',background_strength:value.background_strength??100,gap_mm:value.gap_mm??3,dpi:value.dpi??300,sheet_mode:value.sheet_mode??'single',panel_visible:value.panel_visible??true,sheet_contents_visible:value.sheet_contents_visible??true,paper_settings_visible:value.paper_settings_visible??true}:null;}catch{return null;}
}
export function savePaperPreferences(storage,value){
 if(!validPaperPreferences(value))return false;
 storage.setItem(PAPER_SETTINGS_KEY,JSON.stringify(value));return true;
}

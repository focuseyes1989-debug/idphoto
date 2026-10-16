export function validSettings(s){return [s.width_mm,s.height_mm,s.dpi,s.gap_mm].every(Number.isFinite)&&s.width_mm>=10&&s.width_mm<=101.6&&s.height_mm>=10&&s.height_mm<=152.4&&s.gap_mm>=0&&s.gap_mm<=20&&[150,300,600].includes(s.dpi);}
export function cropRect(w,h,ratio,zoom,pan){let cw=Math.min(w,h*ratio)/zoom,ch=cw/ratio;return {x:Math.max(0,Math.min(w-cw,pan.x*w-cw/2))/w,y:Math.max(0,Math.min(h-ch,pan.y*h-ch/2))/h,width:cw/w,height:ch/h};}
export function sheetGaps(gap,paper={}){return {column:paper.column_gap_mm??gap,row:paper.row_gap_mm??gap};}
export function sheetLayout(s){const bounds=paperBounds(s.paper,s.dpi);if(bounds.error)return {cols:0,rows:0,left:0,top:0,error:bounds.error};const px=mm=>Math.round(mm/25.4*s.dpi),pw=px(s.width_mm),ph=px(s.height_mm),gaps=sheetGaps(s.gap_mm,s.paper),gx=px(gaps.column),gy=px(gaps.row);const cols=Math.floor((bounds.usableWidth+gx)/(pw+gx)),rows=Math.floor((bounds.usableHeight+gy)/(ph+gy));return {cols,rows,left:bounds.left*25.4/s.dpi,top:bounds.top*25.4/s.dpi,error:cols&&rows?null:'Photo does not fit inside the paper margins.'};}
export function defaultPaper(){return {width_mm:101.6,height_mm:152.4,left_mm:0,right_mm:0,top_mm:0,bottom_mm:0};}
export function paperBounds(paper=defaultPaper(),dpi=300){
 const p=paper,fail=error=>({error});
 if([p.column_gap_mm,p.row_gap_mm].some(v=>v!=null&&(!Number.isFinite(v)||v<0||v>20)))return fail('Column and row gaps must be between 0 and 20 mm.');
 if(![p.width_mm,p.height_mm,p.left_mm,p.right_mm,p.top_mm,p.bottom_mm].every(Number.isFinite)||p.width_mm<25.4||p.width_mm>420||p.height_mm<25.4||p.height_mm>420||[p.left_mm,p.right_mm,p.top_mm,p.bottom_mm].some(v=>v<0)||p.left_mm+p.right_mm>=p.width_mm||p.top_mm+p.bottom_mm>=p.height_mm)return fail('Check paper size and margins. Margins must leave space for photos.');
 const px=v=>Math.round(v/25.4*dpi),width=px(p.width_mm),height=px(p.height_mm),left=px(p.left_mm),top=px(p.top_mm),usableWidth=width-left-px(p.right_mm),usableHeight=height-top-px(p.bottom_mm);
 if(usableWidth<=0||usableHeight<=0)return fail('Margins leave no space for photos.');
 return {width,height,left,top,usableWidth,usableHeight,error:null};
}
export const unitScale = { mm: 1, cm: 10, in: 25.4 };
export function toMillimeters(value, unit){return value*unitScale[unit];}
export function fromMillimeters(value, unit){return value/unitScale[unit];}
export function normalizeAngle(degrees){return Math.round((((degrees+180)%360+360)%360-180)*10)/10;}
export function rotatedSize(width,height,degrees){const radians=degrees*Math.PI/180,c=Math.abs(Math.cos(radians)),s=Math.abs(Math.sin(radians));return {width:Math.ceil(width*c+height*s-1e-8),height:Math.ceil(width*s+height*c-1e-8)};}
export function zoomSheetView(view,zoom,anchor){
 const next=Math.max(.25,Math.min(8,zoom)),ratio=next/view.zoom;
 return {zoom:next,x:anchor.x-(anchor.x-view.x)*ratio,y:anchor.y-(anchor.y-view.y)*ratio};
}
// Row packing uses integer print pixels, matching the Rust export exactly.
export function mixedSheetLayout(items,dpi,gapMm,paper=defaultPaper()){
 const result=mixedSheetPages(items,dpi,gapMm,paper);if(result.error)return {placements:[],error:result.error};
 return result.pages.length>1?{placements:[],error:'These photos do not fit the paper margins. Reduce quantities, sizes, gap or margins.'}:{placements:result.pages[0],error:null};
}
export function mixedSheetPages(items,dpi,gapMm,paper=defaultPaper()){
 const fail=error=>({pages:[],placements:[],error});
 if(![150,300,600].includes(dpi)||!Number.isFinite(gapMm)||gapMm<0||gapMm>20)return fail('Enter a valid print resolution and gap.');
 if(items.some(item=>!Number.isInteger(item.count)||item.count<0||item.count>100))return fail('Quantities must be whole numbers from 0 to 100.');
 const total=items.reduce((sum,item)=>sum+item.count,0);
 if(!total)return fail('Set a quantity above 0 for at least one photo.');
 if(total>100)return fail('Choose at most 100 photos per print job.');
 const bounds=paperBounds(paper,dpi);if(bounds.error)return fail(bounds.error);
 const gaps=sheetGaps(gapMm,paper),gx=Math.round(gaps.column/25.4*dpi),gy=Math.round(gaps.row/25.4*dpi),sw=bounds.usableWidth,sh=bounds.usableHeight,rows=[];let row={width:0,height:0,items:[]};
 for(let index=0;index<items.length;index++){
  const item=items[index];if(!item.count)continue;
  if(!Number.isFinite(item.width_mm)||!Number.isFinite(item.height_mm)||item.width_mm<10||item.height_mm<10||item.width_mm>101.6||item.height_mm>152.4)return fail('Check the sizes of the selected photos.');
  const w=Math.round(item.width_mm/25.4*dpi),h=Math.round(item.height_mm/25.4*dpi);
  if(w>sw||h>sh)return fail('A photo does not fit inside the paper margins.');
  for(let n=0;n<item.count;n++){
   if(row.items.length&&row.width+gx+w>sw){rows.push(row);row={width:0,height:0,items:[]};}
   const x=row.items.length?row.width+gx:0;row.items.push({index,x,width:w,height:h});row.width=x+w;row.height=Math.max(row.height,h);
  }
 }
 if(row.items.length)rows.push(row);
 const pages=[];let placements=[],used=0;
 for(const r of rows){
  if(placements.length&&used+gy+r.height>sh){pages.push(placements);placements=[];used=0;}
  const y=bounds.top+used+(placements.length?gy:0);
  for(const item of r.items)placements.push({...item,x:bounds.left+item.x,y});
  used=y-bounds.top+r.height;
 }
 if(placements.length)pages.push(placements);
 return {pages,placements:pages[0]||[],error:null};
}

import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createPrintDialog,LAST_PRINTER_KEY} from '../web/print-dialog.js';

function fixture(storage){
 const elements=new Map();
 const make=()=>({value:'',textContent:'',style:{},scrollLeft:0,scrollTop:0,getBoundingClientRect:()=>({left:0,top:0,width:600,height:500}),focus(){},setPointerCapture(){},children:[],hidden:false,disabled:false,open:false,append(...nodes){this.children.push(...nodes);},replaceChildren(){this.children=[];},showModal(){this.open=true;},close(){this.open=false;},async decode(){}});
 for(const [,id] of fs.readFileSync(new URL('../web/index.html',import.meta.url),'utf8').matchAll(/id="([^"]+)"/g))elements.set(id,make());
 for(const [id,label] of Object.entries({printWidthLabel:'Width',printHeightLabel:'Height',printMarginLeftLabel:'Left',printMarginRightLabel:'Right',printMarginTopLabel:'Top',printMarginBottomLabel:'Bottom'}))elements.get(id).textContent=label;
 const firstPreview=elements.get('printPreview'),pages=elements.get('printPreviewPages');
 let attached=true;
 pages.replaceChildren=()=>{pages.children=[];attached=false;};
 pages.append=(...nodes)=>{pages.children.push(...nodes);if(nodes.includes(firstPreview))attached=true;};
 const $=id=>id==='printPreview'&&!attached?null:elements.get(id),calls=[];
 let failPreview=false,failPrint=false;
 const invoke=async(command,args)=>{
  calls.push({command,args});
  if(command==='list_printers')return [{name:'Local',is_default:true,network:false},{name:'\\\\Server\\photo',is_default:false,network:true}];
  if(command==='prepare_print'){if(failPreview)throw Error('Photos do not fit');return 'data:image/png;base64,preview';}
  if(command==='printer_properties')return {width_mm:210,height_mm:297};
  if(command==='check_printer'){if(!args.reconnect)throw Error('Access denied (Windows error 5)');return 'Connected';}
  if(command==='submit_print'){if(failPrint)throw Error('Printer offline');return 77;}
  throw Error('Unexpected command: '+command);
 };
 let applied,closed;
 const dialog=createPrintDialog({document:{getElementById:$,createElement:make},invoke,storage,onApply:(...args)=>{applied=args;}});
 const request={docId:1,crop:{dpi:300,gap_mm:3,paper:{width_mm:101.6,height_mm:152.4,left_mm:5.08,right_mm:5.08,top_mm:5.08,bottom_mm:5.08}},items:[{doc_id:1,count:2,crop:{width_mm:27.94,height_mm:33.02}}]};
 return {$,firstPreview,calls,dialog,request,open:()=>dialog.open(request,{unit:'in',preset:'101.6,152.4',onClose:job=>{closed=job;}}),failPreview:value=>{failPreview=value;},failPrint:value=>{failPrint=value;},get applied(){return applied;},get closed(){return closed;}};
}
test('custom print dialog previews without printing, uses driver settings and submits copies only on Print',async()=>{
 const f=fixture(),{$,calls}=f;await f.open();
 assert.equal($('printDialog').open,true);assert.equal($('printPrinter').children.length,2);
 assert.equal($('printWidth').value,'4');assert.equal($('printMarginLeft').value,'0.2');
 assert.equal($('printWidthLabel').textContent,'Width \u00b7 in');
 $('printUnit').value='cm';$('printUnit').onchange();assert.equal($('printWidth').value,'10.16');assert.equal($('printWidthLabel').textContent,'Width \u00b7 cm');
 $('printUnit').value='in';$('printUnit').onchange();assert.equal($('printWidthLabel').textContent,'Width \u00b7 in');
 assert.equal($('printPreview').hidden,false);assert.equal($('printReconnect'),undefined);assert.equal($('printRefresh'),undefined);assert.equal($('printCheck'),undefined);
 assert.equal(calls.filter(c=>c.command==='submit_print').length,0);
 $('printPrinter').value='\\\\Server\\photo';$('printPrinter').onchange();
 await $('printProperties').onclick();assert.equal(Number($('printWidth').value),Number((210/25.4).toFixed(6)));
 assert.equal(calls.filter(c=>c.command==='prepare_print').at(-1).args.crop.paper.height_mm,297);
 $('printCopies').value='2';$('printCopies').oninput();await $('printSubmit').onclick();
 const job=calls.find(c=>c.command==='submit_print').args;
 assert.equal(job.copies,2);assert.equal(job.printer,'\\\\Server\\photo');assert.equal(job.crop.paper.width_mm,210);
 assert.equal(job.crop.paper.left_mm,5.08);assert.equal(job.crop.dpi,300);assert.deepEqual(job.items,f.request.items);
 assert.equal($('printDialog').open,false);assert.equal(f.closed,77);assert.equal(f.applied[0].height_mm,297);
});
test('invalid margins/copies and failed previews cannot print; failed jobs stay open for retry',async()=>{
 const f=fixture(),{$,calls}=f;await f.open();
 $('printCopies').value='0';$('printCopies').oninput();assert.equal($('printSubmit').disabled,true);
 await $('printSubmit').onclick();assert.equal(calls.some(c=>c.command==='submit_print'),false);
 $('printCopies').value='1';$('printCopies').oninput();
 $('printMarginLeft').value='100';$('printMarginLeft').oninput();await new Promise(resolve=>setTimeout(resolve,210));
 assert.equal($('printSubmit').disabled,true);assert.equal(f.firstPreview.hidden,true);assert.equal($('printPreview'),null);
 $('printMarginLeft').value='0.21';f.failPreview(true);$('printMarginLeft').oninput();await new Promise(resolve=>setTimeout(resolve,210));
 assert.equal($('printSubmit').disabled,true);assert.match($('printMessage').textContent,/Photos do not fit/);
 f.failPreview(false);$('printMarginLeft').oninput();await new Promise(resolve=>setTimeout(resolve,210));
 f.failPrint(true);await $('printSubmit').onclick();assert.equal($('printDialog').open,true);assert.match($('printMessage').textContent,/offline/);
 $('printCancel').onclick();assert.equal($('printDialog').open,false);assert.equal(f.closed,undefined);
});

test('last selected printer survives dialog recreation and Cancel; missing printer falls back to Windows default',async()=>{
 const data=new Map(),storage={getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)};
 const first=fixture(storage);await first.open();assert.equal(first.$('printPrinter').value,'Local');
 first.$('printPrinter').value='\\\\Server\\photo';first.$('printPrinter').onchange();
 assert.equal(data.get(LAST_PRINTER_KEY),'\\\\Server\\photo');first.$('printCancel').onclick();
 const restarted=fixture(storage);await restarted.open();assert.equal(restarted.$('printPrinter').value,'\\\\Server\\photo');
 assert.equal(restarted.calls.some(c=>c.command==='submit_print'),false);restarted.$('printCancel').onclick();
 data.set(LAST_PRINTER_KEY,'Unavailable printer');const missing=fixture(storage);await missing.open();
 assert.equal(missing.$('printPrinter').value,'Local');assert.equal(data.get(LAST_PRINTER_KEY),'Unavailable printer');missing.$('printCancel').onclick();
 const blocked=fixture({getItem(){throw Error('Storage unavailable');},setItem(){throw Error('Storage unavailable');}});await blocked.open();
 assert.equal(blocked.$('printPrinter').value,'Local');blocked.$('printPrinter').value='\\\\Server\\photo';blocked.$('printPrinter').onchange();
 assert.match(blocked.$('printMessage').textContent,/could not save/);assert.equal(blocked.$('printSubmit').disabled,false);blocked.$('printCancel').onclick();
});

test('multi-page print preview scrolls all sheets while submission retains all requested copies',async()=>{
 const f=fixture();f.request.items[0].count=24;await f.open();
 assert.equal(f.$('printNext'),undefined);
 assert.equal(f.$('printPreviewPages').children.length,4);
 assert.equal(f.$('printPreviewPages').children[0].textContent,'Page 1 / 2');
 assert.equal(f.$('printPreviewPages').children[2].textContent,'Page 2 / 2');
 assert.deepEqual(f.calls.filter(c=>c.command==='prepare_print').map(c=>c.args.pageIndex),[0,1]);
 await f.$('printSubmit').onclick();
 assert.equal(f.calls.find(c=>c.command==='submit_print').args.items[0].count,24);
});

test('print preview zoom and pan are local, normal wheel scrolls and Fit resets the view',async()=>{
 const f=fixture();f.request.items[0].count=24;await f.open();
 const viewport=f.$('printPreviewViewport'),image=f.$('printPreviewPages').children[1];
 const width=parseInt(image.style.width),calls=f.calls.length;
 viewport.onwheel({ctrlKey:false,preventDefault(){throw Error('Normal wheel must scroll');}});
 viewport.onwheel({ctrlKey:true,deltaY:-120,deltaMode:0,clientX:300,clientY:250,preventDefault(){}});
 assert.equal(f.$('printZoomValue').textContent,'120%');assert.ok(parseInt(image.style.width)>width);
 const left=viewport.scrollLeft,top=viewport.scrollTop;
 viewport.onpointerdown({button:0,target:image,pointerId:7,clientX:300,clientY:250});
 viewport.onpointermove({pointerId:7,clientX:250,clientY:200});
 assert.equal(viewport.scrollLeft,left+50);assert.equal(viewport.scrollTop,top+50);
 viewport.onpointerup();viewport.onpointermove({pointerId:7,clientX:10,clientY:10});assert.equal(viewport.scrollTop,top+50);
 assert.equal(f.calls.length,calls);
 f.$('printFit').onclick();assert.equal(f.$('printZoomValue').textContent,'100%');assert.equal(viewport.scrollTop,0);assert.equal(viewport.scrollLeft,0);assert.equal(parseInt(image.style.width),width);
 await f.$('printSubmit').onclick();assert.deepEqual(f.calls.find(c=>c.command==='submit_print').args.items,f.request.items);
});

test('print dialog keeps its first preview reference after DOM removal, errors and reopening',async()=>{
 const f=fixture();await f.open();
 await f.$('printProperties').onclick();assert.equal(f.$('printPreview'),f.firstPreview);
 f.$('printMarginLeft').value='100';f.$('printMarginLeft').oninput();await new Promise(r=>setTimeout(r,210));
 assert.equal(f.$('printPreview'),null);f.$('printCancel').onclick();
 await f.open();assert.equal(f.$('printPreview'),f.firstPreview);assert.equal(f.$('printSubmit').disabled,false);
 f.$('printCancel').onclick();await f.open();assert.equal(f.$('printDialog').open,true);
 assert.equal(f.calls.some(c=>c.command==='submit_print'),false);
});

test('prepared canvases bypass backend rendering and cache invalidates on layout or photo changes',async()=>{
 const f=fixture(),canvas={style:{},width:600,height:900};
 await f.dialog.open(f.request,{preparedPages:[canvas],contentKey:'photo-v1'});
 assert.equal(f.$('printPreviewPages').children[1],canvas);assert.equal(f.calls.filter(c=>c.command==='prepare_print').length,0);
 f.$('printCancel').onclick();await f.dialog.open(f.request,{contentKey:'photo-v1'});
 assert.equal(f.$('printPreviewPages').children[1],canvas);assert.equal(f.calls.filter(c=>c.command==='prepare_print').length,0);
 f.$('printMarginLeft').value='0.21';f.$('printMarginLeft').oninput();await new Promise(r=>setTimeout(r,210));
 assert.equal(f.calls.filter(c=>c.command==='prepare_print').length,1);
 f.$('printCancel').onclick();await f.dialog.open(f.request,{contentKey:'photo-v2'});
 assert.equal(f.calls.filter(c=>c.command==='prepare_print').length,2);
 f.$('printCancel').onclick();await f.dialog.open(f.request,{contentKey:'photo-v2'});
 assert.equal(f.calls.filter(c=>c.command==='prepare_print').length,2);
});

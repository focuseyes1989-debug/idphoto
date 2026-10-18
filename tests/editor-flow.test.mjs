import { test } from 'node:test';

import assert from 'node:assert/strict';

import fs from 'node:fs';



test('editing preserves size, rotation and background through export and restore',async()=>{

 const elements=new Map();

 const context={clearRect(){},getImageData(){return {data:new Uint8ClampedArray([100,100,100,255])};},putImageData(){},fillRect(){},drawImage(){},save(){},restore(){},beginPath(){},rect(){},clip(){},moveTo(){},lineTo(){},stroke(){},strokeRect(){},setLineDash(){},translate(){},rotate(){},scale(){},arc(){},fill(){}};

 const makeCanvas=()=>({textContent:'',width:700,height:900,showModal(){this.open=true;},close(){this.open=false;},getContext:()=>context,style:{},children:[],async decode(){},set id(value){elements.set(value,this);},append(...items){this.children.push(...items);},replaceChildren(...items){this.children=[...items];},scrollIntoView(){},removeAttribute(name){delete this[name];},setAttribute(name,value){this[name]=value;},focus(){},setPointerCapture(){},getBoundingClientRect:()=>({left:0,top:0,width:600,height:500})});

 const html=fs.readFileSync(new URL('../web/index.html',import.meta.url),'utf8');

 for(const [,id] of html.matchAll(/id="([^"]+)"/g))elements.set(id,{value:'',...makeCanvas()});

 const el=id=>elements.get(id);

 el('unit').value='mm';el('dpi').value='300';el('background').value='white';

 el('preset').options=['27.94,33.02','20.32,22.86','35,45','25,35','30,40','50.8,50.8','custom'].map(value=>({value}));

 const printCss={href:'http://tauri.localhost/print.css',cssRules:[],insertRule(rule,index){this.cssRules.splice(index,0,rule);},deleteRule(index){this.cssRules.splice(index,1);}};

 globalThis.document={getElementById:el,createElement:makeCanvas,styleSheets:[printCss]};

 globalThis.Image=class {width=700;height=900;async decode(){}};

 let clipboardRequest,clipboardFail=false;let projectManifest,projectCanceled=false;let savedRequest,saveResult="saved-photo.png",exported,mixedExport,printRequest,printCalls=0,nextId=0,opens=0,pendingCutout=null,delayRemoval=false;const closed=[],removals=[];

 const stored=new Map();

 globalThis.window={localStorage:{getItem:key=>stored.get(key)??null,setItem:(key,value)=>stored.set(key,value)},print(){printCalls++;},__TAURI_INTERNALS__:{async invoke(command,args){

  if(command==='open_photo')return {photos:Array.from({length:opens++===0?1:2},()=>({id:++nextId,preview:'original',width:700,height:900,name:'portrait-'+nextId+'.png'})),errors:[]};

  if(command==='close_photo'){closed.push(args.docId);return;}

  if(command==='remove_background'){removals.push(args);if(delayRemoval)return new Promise(resolve=>{pendingCutout=resolve;});return 'cutout';}

  if(command==='copy_photo'){if(clipboardFail)throw Error('Clipboard busy');clipboardRequest=args;return;}

  if(command==='paste_photo')return {id:1000,name:'Clipboard photo.png',width:330,height:390,preview:'clipboard'};

  if(command==='save_project'){projectManifest=structuredClone(args.manifest);return 'session.idphoto';}

  if(command==='open_project')return projectCanceled?null:{manifest:structuredClone(projectManifest),photos:projectManifest.documents.map(d=>({id:++nextId,name:d.name,width:700,height:900,preview:'original',cutout_preview:d.edits.backgroundRemoved?'cutout':null}))};

  if(command==='save_photo'){savedRequest=args;return saveResult;}

  if(command==='export_photo'){exported=args;return 'saved.png';}

  if(command==='export_mixed_sheet'){mixedExport=args;return 'mixed.png';}

  if(command==='list_printers')return [{name:'Test printer',is_default:true,network:false}];

  if(command==='submit_print'){printCalls++;printRequest=args;return printCalls;}

  if(command==='prepare_print'){printRequest=args;return 'data:image/png;base64,test';}

  throw Error('Unexpected command');

 }}};

 await import('../web/app.js');

 assert.equal(el('unit').value,'in');assert.equal(el('paperUnit').value,'in');assert.equal(el('paperWidth').value,'4');assert.equal(el('paperHeight').value,'6');

 // Opening another menu closes the previous popup before the native click toggles it.

 el('menuFile').open=true;

 el('menuTools').onclick({target:{closest:()=>({})}});

 assert.equal(el('menuFile').open,false);

 el('menuTools').open=true;el('menuHelp').open=true;el('menuHelp').ontoggle();

 assert.equal(el('menuTools').open,false);assert.equal(el('menuHelp').open,true);

 document.onpointerdown({target:{closest:()=>null}});assert.equal(el('menuHelp').open,false);

 el('menuFile').open=true;document.onkeydown({key:'Escape',target:{tagName:'INPUT'}});

 assert.equal(el('menuFile').open,false);

 assert.equal(el('panelMove').hidden,false);assert.equal(el('panelRotate').hidden,true);

 assert.equal(el('removeBackground').disabled,true);

 assert.equal(el('menuPrint').disabled,true);

 assert.equal(el('viewSheet').disabled,true);el('viewSheet').onclick();assert.equal(el('largeSheet').hidden,true);assert.equal(el('empty').hidden,false);
 el('paperUnit').value='mm';el('paperUnit').onchange();el('paperUnit').value='in';el('paperUnit').onchange();assert.equal(el('largeSheet').hidden,true);
 await el('menuOpen').onclick();assert.equal(el('viewSheet').disabled,false);

 await el('menuPrint').onclick();assert.equal(el('printDialog').open,true);assert.equal(printCalls,0);await el('printSubmit').onclick();assert.equal(printCalls,1);assert.equal(printRequest.items,null);assert.equal(printRequest.docId,1);assert.equal(el('printPreviewPages').children[1].width,600);

 assert.equal(el('removeBackground').disabled,false);

 assert.equal(el('width').value,'1.1');assert.equal(el('height').value,'1.3');

 el('toolRotate').onclick();el('rotateRight').onclick();assert.equal(el('rotationValue').value,'90°');

 await el('menuUndo').onclick();assert.equal(el('rotationValue').value,'0°');await el('menuRedo').onclick();assert.equal(el('rotationValue').value,'90°');await el('menuUndo').onclick();assert.equal(el('rotationValue').value,'0°');

 document.onkeydown({key:'c',ctrlKey:true,target:{tagName:'INPUT'},preventDefault(){throw Error('Native text copy must stay available');}});assert.equal(clipboardRequest,undefined);



 el('preset').value='20.32,22.86';el('preset').onchange();

 await el('menuExportPhoto').onclick();assert.equal(exported.crop.width_mm,20.32);assert.equal(exported.crop.height_mm,22.86);assert.equal(el('photoPixels').textContent,'240 × 270 px');

 el('preset').value='27.94,33.02';el('preset').onchange();

 el('toolRotate').onclick();assert.equal(el('toolRotate')['aria-pressed'],'true');

 assert.equal(el('panelMove').hidden,true);assert.equal(el('panelRotate').hidden,false);

 el('rotateRight').onclick();assert.equal(el('rotationValue').value,'90°');

 assert.equal(el('source').textContent,'700 × 900 original');

 el('toolBackground').onclick();await el('removeBackground').onclick();assert.equal(el('background').disabled,false);

 assert.equal(removals.at(-1).strength,100);

 await el('menuUndo').onclick();await el('menuExportPhoto').onclick();assert.equal(exported.crop.remove_background,false);await el('menuRedo').onclick();



 // Rapidly returning to the previous value must restore that matte in Rust too.

 delayRemoval=true;el('backgroundStrength').value='25';el('backgroundStrength').oninput();const strengthJob=el('backgroundStrength').onchange();

 assert.equal(el('menuExportPhoto').disabled,true);assert.equal(el('backgroundStrength').disabled,false);

 el('backgroundStrength').value='100';el('backgroundStrength').oninput();delayRemoval=false;pendingCutout('cutout');await strengthJob;

 assert.deepEqual(removals.slice(-2).map(r=>r.strength),[25,100]);

 el('backgroundStrength').value='40';el('backgroundStrength').oninput();await el('backgroundStrength').onchange();assert.equal(el('backgroundStrengthValue').value,'40%');

 await el('menuUndo').onclick();assert.equal(el('backgroundStrength').value,100);assert.equal(removals.at(-1).strength,100);

 await el('menuRedo').onclick();assert.equal(el('backgroundStrength').value,40);assert.equal(removals.at(-1).strength,40);

 el('background').value='blue';el('background').onchange();

 el('toolCrop').onclick();for(let i=0;i<20;i++){el('unit').value='in';el('unit').onchange();el('unit').value='mm';el('unit').onchange();}

 assert.equal(el('width').value,'27.94');assert.equal(el('height').value,'33.02');

 await el('menuExportSheet').onclick();

 assert.equal(exported.sheet,true);assert.equal(exported.crop.rotation,90);

 assert.equal(exported.crop.remove_background,true);assert.equal(exported.crop.background,'blue');

 assert.equal(exported.crop.width_mm,27.94);assert.equal(exported.crop.height_mm,33.02);

 assert.ok(Math.abs(exported.crop.width*900/(exported.crop.height*700)-27.94/33.02)<1e-9);

 el('restoreBackground').onclick();assert.equal(el('background').disabled,true);

 await el('menuExportPhoto').onclick();assert.equal(exported.crop.remove_background,false);

 el('toolRotate').onclick();el('rotateLeft').onclick();assert.equal(el('rotationValue').value,'0°');

 el('zoom').value='2';el('zoom').oninput();

 el('rotationAngle').value='12.5';el('rotationAngle').oninput();

 assert.equal(el('rotationValue').value,'12.5°');assert.equal(el('zoom').value,'2');

 await el('menuExportPhoto').onclick();assert.equal(exported.crop.rotation,12.5);

 // The round handle is at (300,16); moving clockwise to the right rotates 90°.

 const event=(x,y,shiftKey=false)=>({clientX:x,clientY:y,button:0,pointerId:1,shiftKey});

 el('crop').onpointerdown(event(300,16));el('crop').onpointermove(event(534,250,true));

 assert.equal(el('rotationValue').value,'105°');

 el('crop').onkeydown({key:'Escape'});assert.equal(el('rotationValue').value,'12.5°');

 el('crop').onkeydown({key:'ArrowRight',altKey:true,preventDefault(){}});

 assert.equal(el('rotationValue').value,'12.6°');

 el('resetRotation').onclick();assert.equal(el('rotationValue').value,'0°');

 // Shortcuts leave text input alone and switch tools without changing the photo.

 document.onkeydown({key:'b',target:{tagName:'INPUT'},preventDefault(){throw Error('Should not intercept typing');}});

 assert.equal(el('panelRotate').hidden,false);

 document.onkeydown({key:'b',target:{tagName:'CANVAS'},preventDefault(){}});

 assert.equal(el('panelBackground').hidden,false);assert.equal(el('panelRotate').hidden,true);

 await el('menuExportPhoto').onclick();const previousCrop={...exported.crop};

 el('crop').onpointerdown(event(300,16));el('crop').onpointermove(event(534,250));el('crop').onpointerup();

 await el('menuExportPhoto').onclick();assert.deepEqual(exported.crop,previousCrop);

 el('toolMove').onclick();el('goCrop').onclick();assert.equal(el('panelCrop').hidden,false);

 el('toolRotate').onclick();el('rotationAngle').value='-17.2';el('rotationAngle').oninput();

 el('toolCrop').onclick();el('unit').value='cm';el('unit').onchange();el('width').value='4';el('width').oninput();

 el('toolBackground').onclick();await el('removeBackground').onclick();el('background').value='red';el('background').onchange();

 el('menuCurves').onclick();el('curveGraph').onpointerdown(event(300,150));el('curveGraph').onpointerup();

 assert.equal(Number(el('curveInput').value),128);assert.equal(Number(el('curveOutput').value),179);

 el('curveDelete').onclick();el('tonePreview').checked=false;el('tonePreview').onchange();el('toneCancel').onclick();

 el('menuLevels').onclick();assert.equal(el('toneDialog').open,true);

 el('levelBlack').value='20';el('levelBlack').oninput();el('toneApply').onclick();

 el('menuLevels').onclick();el('levelBlack').value='255';el('levelBlack').oninput();assert.equal(el('toneApply').disabled,true);el('toneCancel').onclick();

 el('menuCurves').onclick();el('curve2').value='150';el('curve2').oninput();el('toneApply').onclick();

 await el('menuExportPhoto').onclick();assert.equal(exported.crop.adjustments.black,20);assert.equal(exported.crop.adjustments.curve[2],150);

 el('menuSelectiveColor').onclick();assert.equal(el('selectiveDialog').open,true);

 el('selectiveCyan').value='25';el('selectiveCyan').oninput();

 el('selectiveRange').value='blues';el('selectiveRange').onchange();el('selectiveBlackNumber').value='-10';el('selectiveBlackNumber').oninput();

 el('selectivePreview').checked=false;el('selectivePreview').onchange();el('selectiveApply').onclick();

 await el('menuExportPhoto').onclick();assert.equal(exported.crop.adjustments.black,20);assert.equal(exported.crop.adjustments.selective.ranges.reds[0],25);assert.equal(exported.crop.adjustments.selective.ranges.blues[3],-10);

 await el('menuUndo').onclick();await el('menuExportPhoto').onclick();assert.equal(exported.crop.adjustments.selective,undefined);assert.equal(exported.crop.adjustments.black,20);
 await el('menuRedo').onclick();await el('menuExportPhoto').onclick();assert.equal(exported.crop.adjustments.selective.ranges.reds[0],25);
 el('menuSelectiveColor').onclick();el('selectiveReset').onclick();el('selectiveCancel').onclick();

 await el('menuSave').onclick();assert.equal(savedRequest.docId,1);assert.equal(savedRequest.saveAs,false);assert.equal(savedRequest.crop.adjustments.selective.ranges.reds[0],25);assert.equal(savedRequest.crop.rotation,-17.2);assert.equal(savedRequest.crop.width_mm,40);

 await el('menuSaveAs').onclick();assert.equal(savedRequest.saveAs,true);

 saveResult=null;await el('menuSaveAs').onclick();assert.equal(el('status').textContent,'Save canceled');assert.equal(el('menuSave').disabled,false);saveResult='saved-photo.png';

 document.onkeydown({ctrlKey:true,shiftKey:true,key:'S',preventDefault(){}});assert.equal(savedRequest.saveAs,true);await new Promise(resolve=>setTimeout(resolve,0));



 await el('menuExportPhoto').onclick();assert.equal(exported.crop.adjustments.selective.ranges.reds[0],25);

 await el('menuOpen').onclick();assert.equal(el('background').value,'red');assert.equal(el('removeBackground').disabled,false);

 assert.equal(el('documentTabs').children.length,3);

 await el('menuExportPhoto').onclick();assert.equal(exported.docId,3);assert.equal(exported.crop.rotation,0);assert.equal(exported.crop.adjustments.black,0);assert.equal(exported.crop.adjustments.selective,undefined);

 el('document-1').onclick();assert.equal(el('rotationValue').value,'-17.2°');assert.equal(el('unit').value,'cm');assert.equal(el('width').value,'4');assert.equal(el('zoom').value,2);

 assert.equal(el('backgroundStrength').value,40);

 assert.equal(el('background').value,'red');assert.equal(el('restoreBackground').disabled,false);

 await el('menuExportPhoto').onclick();assert.equal(exported.docId,1);assert.equal(exported.crop.width_mm,40);

 el('menuRetouch').onclick();assert.equal(el('retouchDialog').open,true);
 el('retouchStrength').value='55';el('retouchStrength').oninput();el('retouchApply').onclick();
 await el('menuExportPhoto').onclick();assert.equal(exported.crop.adjustments.retouch,55);
 await el('menuUndo').onclick();await el('menuExportPhoto').onclick();assert.equal(exported.crop.adjustments.retouch??0,0);
 await el('menuRedo').onclick();await el('menuExportPhoto').onclick();assert.equal(exported.crop.adjustments.retouch,55);
 el('menuRetouch').onclick();el('retouchStrength').value='90';el('retouchStrength').oninput();el('retouchCancel').onclick();
 await el('menuExportPhoto').onclick();assert.equal(exported.crop.adjustments.retouch,55);
 const originalCrop=JSON.stringify(exported.crop);
 el('toolZoom').onclick();assert.equal(el('panelZoom').hidden,false);el('photoZoomIn').onclick();assert.equal(el('photoZoomValue').textContent,'125%');
 await el('menuExportPhoto').onclick();assert.equal(JSON.stringify(exported.crop),originalCrop);
 el('photoZoomOut').onclick();assert.equal(el('photoZoomValue').textContent,'100%');el('photoZoomFit').onclick();assert.equal(el('editorViewport').scrollTop,0);
 el('toolBlur').onclick();assert.equal(el('panelBlur').hidden,false);
 const brushBox=el('crop').getBoundingClientRect();
 el('crop').onpointerdown({button:0,clientX:300,clientY:250,pointerId:9});el('crop').onpointerup();
 await el('menuExportPhoto').onclick();assert.equal(exported.crop.adjustments.brushes.length,1);assert.equal(exported.crop.adjustments.brushes[0].kind,'Blur');
 await el('menuUndo').onclick();await el('menuExportPhoto').onclick();assert.equal(exported.crop.adjustments.brushes?.length??0,0);
 await el('menuRedo').onclick();await el('menuExportPhoto').onclick();assert.equal(exported.crop.adjustments.brushes.length,1);
 el('toolSmudge').onclick();el('crop').onpointerdown({button:0,clientX:300,clientY:250,pointerId:10});el('crop').onpointercancel();
 await el('menuExportPhoto').onclick();assert.equal(exported.crop.adjustments.brushes.length,1);
 el('sheetMode').value='mixed';el('sheetMode').onchange();

 const quantity=index=>el('sheetQuantities').children[index].children[2];

 assert.equal(el('linkQuantities')['aria-pressed'],'false');
 el('linkQuantities').onclick();assert.equal(el('linkQuantities')['aria-pressed'],'true');
 quantity(0).value='3';quantity(0).oninput();
 await el('menuExportSheet').onclick();assert.deepEqual(mixedExport.items.map(i=>i.count),[3,3,3]);
 assert.deepEqual(el('sheetQuantities').children.map(row=>Number(row.children[2].value)),[3,3,3]);
 el('linkQuantities').onclick();quantity(1).value='1';quantity(1).oninput();quantity(2).value='1';quantity(2).oninput();
 assert.equal(el('linkQuantities')['aria-pressed'],'false');
 quantity(0).value='2';quantity(0).oninput();

 await el('menuExportSheet').onclick();assert.equal(mixedExport.items.length,3);assert.equal(mixedExport.items[0].count,2);

 assert.equal(mixedExport.items[0].crop.adjustments.selective.ranges.reds[0],25);assert.equal(mixedExport.items[0].crop.adjustments.black,20);assert.equal(mixedExport.items[0].crop.adjustments.curve[2],150);assert.equal(mixedExport.items[2].crop.adjustments.black,0);assert.equal(mixedExport.items[0].crop.rotation,-17.2);assert.equal(mixedExport.items[0].crop.background,'red');assert.equal(mixedExport.items[0].crop.width_mm,40);

 quantity(0).value='20';quantity(0).oninput();assert.equal(el('menuExportSheet').disabled,false);assert.ok(el('sheetMessage').textContent.includes('across'));assert.ok(el('sheetPages').children.length>2);assert.equal(el('sheetPages').children[0].textContent,'Page 1 / '+el('sheetPages').children.length/2);assert.equal(el('sheetPages').hidden,false);assert.equal(el('sheetPrevious'),undefined);

 assert.equal(el('menuPrint').disabled,false);await el('menuPrint').onclick();el('printCancel').onclick();assert.equal(printCalls,1);

 quantity(0).value='2';quantity(0).oninput();quantity(1).value='0';quantity(1).oninput();

 await el('menuExportSheet').onclick();assert.deepEqual(mixedExport.items.map(item=>item.doc_id),[1,3]);

 assert.equal(el('menuExportSheet').disabled,false);

 let printShortcutPrevented=false;document.onkeydown({ctrlKey:true,key:'p',preventDefault(){printShortcutPrevented=true;}});await new Promise(r=>setTimeout(r,0));assert.equal(printShortcutPrevented,true);assert.equal(el('printDialog').open,true);await el('printSubmit').onclick();assert.equal(printCalls,2);assert.deepEqual(printRequest.items.map(item=>item.doc_id),[1,3]);assert.equal(printRequest.items[0].count,2);

 el('paperUnit').value='mm';el('paperUnit').onchange();

 el('paperPreset').value='210,297';el('paperPreset').onchange();

 assert.equal(el('viewSheet')['aria-pressed'],'true');assert.equal(el('largeSheet').hidden,false);assert.equal(el('crop').hidden,true);assert.equal(el('largeSheet').width,1200);assert.ok(el('largeSheet').height>1200);

 el('marginLeft').value='10';el('marginLeft').oninput();el('marginRight').value='20';el('marginRight').oninput();el('marginTop').value='15';el('marginTop').oninput();el('marginBottom').value='5';el('marginBottom').oninput();

 await el('menuExportSheet').onclick();assert.equal(mixedExport.paper.width_mm,210);assert.equal(mixedExport.paper.bottom_mm,5);

 await el('menuPrint').onclick();assert.equal(Number(el('printMarginLeft').value),10);assert.equal(Number(el('printWidth').value),210);el('printCancel').onclick();

 el('paperUnit').value='in';el('paperUnit').onchange();el('paperUnit').value='mm';el('paperUnit').onchange();assert.equal(el('marginTop').value,'15');

 el('paperOrientation').value='landscape';el('paperOrientation').onchange();assert.equal(el('paperWidth').value,'297');assert.equal(el('paperHeight').value,'210');

 assert.ok(el('largeSheet').width>el('largeSheet').height);

 el('marginRight').value='290';el('marginRight').oninput();assert.equal(el('menuExportSheet').disabled,true);assert.equal(el('menuPrint').disabled,true);

 assert.equal(el('largeSheetMessage').hidden,false);

 el('marginRight').value='20';el('marginRight').oninput();assert.equal(el('menuPrint').disabled,false);

 assert.equal(el('largeSheetMessage').hidden,true);

 await el('menuExportSheet').onclick();const unchangedSheet=JSON.stringify(mixedExport);

 el('editorViewport').onwheel({deltaY:-120,deltaMode:0,ctrlKey:true,offsetY:300,clientX:400,clientY:300,preventDefault(){}});

 assert.equal(el('sheetZoomValue').textContent,'120%');

 const scrollBefore=el('editorViewport').scrollTop;

 el('editorViewport').onpointerdown({button:0,clientX:300,clientY:250,pointerId:2});

 el('editorViewport').onpointermove({clientX:340,clientY:280});el('editorViewport').onpointerup();

 assert.equal(el('editorViewport').scrollTop,scrollBefore-30);

 await el('menuExportSheet').onclick();assert.equal(JSON.stringify(mixedExport),unchangedSheet);

 el('fitSheet').onclick();assert.equal(el('sheetZoomValue').textContent,'100%');assert.equal(el('editorViewport').scrollTop,0);

 el('viewPhoto').onclick();assert.equal(el('crop').hidden,false);assert.equal(el('largeSheet').hidden,true);assert.equal(el('rotationValue').value,'-17.2°');

 el('editorViewport').onwheel({deltaY:-120,clientX:400,clientY:300,preventDefault(){throw Error('Should not zoom photo workspace');}});

 el('viewSheet').onclick();assert.equal(el('largeSheet').hidden,false);

 el('toolRotate').onclick();assert.equal(el('viewPhoto')['aria-pressed'],'true');assert.equal(el('crop').hidden,false);

 el('linkMargins').onclick();assert.equal(el('linkMargins')['aria-pressed'],'true');

 assert.equal(el('marginRight').value,'10');assert.equal(el('marginBottom').value,'10');

 el('marginBottom').value='12';el('marginBottom').oninput();assert.equal(el('marginLeft').value,'12');assert.equal(el('marginTop').value,'12');

 el('paperUnit').value='cm';el('paperUnit').onchange();assert.equal(el('marginLeft').value,'1.2');

 el('marginTop').value='2';el('marginTop').oninput();assert.equal(el('marginRight').value,'2');

 el('linkMargins').onclick();assert.equal(el('linkMargins')['aria-pressed'],'false');

 el('marginRight').value='1.5';el('marginRight').oninput();assert.equal(el('marginLeft').value,'2');

 el('paperUnit').value='mm';el('paperUnit').onchange();

 await el('menuExportSheet').onclick();assert.equal(mixedExport.paper.left_mm,20);assert.equal(mixedExport.paper.right_mm,15);assert.equal(mixedExport.paper.bottom_mm,20);

 el('columnGap').value='0.2';el('columnGap').oninput();el('rowGap').value='0.7';el('rowGap').oninput();

 await el('menuUndo').onclick();assert.equal(Number(el('rowGap').value),0.3);await el('menuRedo').onclick();assert.equal(Number(el('rowGap').value),0.7);
 await el('menuExportSheet').onclick();assert.equal(mixedExport.paper.column_gap_mm,2);assert.equal(mixedExport.paper.row_gap_mm,7);

 await el('menuPrint').onclick();assert.equal(el('printDialog').open,true);el('printCancel').onclick();

 await el('menuSaveProject').onclick();assert.equal(projectManifest.documents.length,3);assert.equal(projectManifest.documents[0].edits.rotation,-17.2);assert.equal(projectManifest.documents[0].edits.adjustments.selective.ranges.reds[0],25);assert.equal(projectManifest.settings.paper.left_mm,20);

 // Closing an inactive tab keeps the current image and its edits.

 await el('documentTabs').children[1].children[1].onclick();assert.deepEqual(closed,[2]);

 await el('menuExportPhoto').onclick();assert.equal(exported.docId,1);assert.equal(exported.crop.rotation,-17.2);

 await el('menuClose').onclick();

 assert.equal(el('documentTabs').children.length,1);await el('menuExportPhoto').onclick();assert.equal(exported.docId,3);

 await el('menuClose').onclick();assert.equal(el('empty').hidden,false);assert.equal(el('crop').hidden,true);assert.equal(el('viewSheet').disabled,true);assert.equal(el('largeSheet').hidden,true);assert.equal(el('menuExportPhoto').disabled,true);

 await el('menuOpenProject').onclick();assert.equal(el('documentTabs').children.length,3);

 await el('menuExportPhoto').onclick();assert.equal(exported.crop.rotation,-17.2);assert.equal(exported.crop.adjustments.selective.ranges.reds[0],25);assert.equal(exported.crop.background,'red');

 await el('menuExportSheet').onclick();assert.deepEqual(mixedExport.items.map(d=>d.count),[2,1]);assert.equal(mixedExport.paper.left_mm,20);assert.equal(mixedExport.paper.right_mm,15);assert.equal(mixedExport.paper.column_gap_mm,2);assert.equal(mixedExport.paper.row_gap_mm,7);

 projectCanceled=true;await el('menuOpenProject').onclick();assert.equal(el('documentTabs').children.length,3);projectCanceled=false;

 delete projectManifest.settings.paper.column_gap_mm;delete projectManifest.settings.paper.row_gap_mm;

 await el('menuOpenProject').onclick();assert.equal(el('documentTabs').children.length,6);await el('menuExportSheet').onclick();assert.deepEqual(mixedExport.items.map(d=>d.count),[2,1]);assert.equal(mixedExport.paper.column_gap_mm,undefined);assert.equal(mixedExport.paper.row_gap_mm,undefined);assert.equal(Number(el('columnGap').value),0.3);assert.equal(Number(el('rowGap').value),0.3);

 for(let i=0;i<6;i++)await el('menuClose').onclick();

 el('linkMargins').onclick();el('paperUnit').value='in';el('paperUnit').onchange();

 el('unit').value='in';el('unit').onchange();el('gap').value='0.1';el('gap').oninput();

 el('dpi').value='600';el('dpi').oninput();el('sheetMode').value='mixed';el('sheetMode').onchange();

 el('collapsePrintLayout').onclick();assert.equal(el('printLayoutPanel').hidden,true);assert.equal(el('printLayoutRail').hidden,false);assert.equal(el('workspaceLayout')['data-panel-collapsed'],'true');

 el('toggleSheetContents').onclick();assert.equal(el('sheetContentsBody').hidden,true);assert.equal(el('toggleSheetContents')['aria-expanded'],'false');

 el('togglePaperSettings').onclick();assert.equal(el('paperSettingsBody').hidden,true);assert.equal(el('togglePaperSettings')['aria-expanded'],'false');

 const persisted=JSON.parse([...stored.values()][0]);assert.deepEqual(persisted.photo_size,{width_mm:40,height_mm:33.02,unit:'in',preset:'custom'});assert.equal(persisted.background_color,'red');assert.equal(persisted.background_strength,40);assert.equal(persisted.linked,true);assert.equal(persisted.paper.width_mm,297);

 await el('menuPaste').onclick();assert.equal(el('documentTabs').children.length,1);

 await el('menuCopy').onclick();assert.equal(clipboardRequest.docId,1000);assert.equal(clipboardRequest.crop.adjustments.black,0);

 clipboardFail=true;await el('menuCut').onclick();assert.equal(el('documentTabs').children.length,1);clipboardFail=false;

 el('viewSheet').onclick();await el('menuCut').onclick();assert.equal(el('empty').hidden,false);assert.equal(el('viewSheet').disabled,true);assert.equal(el('largeSheet').hidden,true);

 await el('menuUndo').onclick();assert.equal(el('documentTabs').children.length,1);await el('menuExportPhoto').onclick();assert.equal(exported.docId,1000);

 await el('menuRedo').onclick();assert.equal(el('empty').hidden,false);await el('menuUndo').onclick();await el('menuClose').onclick();

 await import('../web/app.js?restart-test');

 assert.equal(el('background').value,'red');assert.equal(el('preset').value,'custom');assert.equal(el('width').value,Number((40/25.4).toFixed(6)).toString());

 assert.equal(Number(el('backgroundStrength').value),40);

 assert.equal(el('paperSettingsBody').hidden,true);el('togglePaperSettings').onclick();assert.equal(el('paperSettingsBody').hidden,false);assert.equal(el('sheetContentsBody').hidden,true);

 assert.equal(el('sheetContentsBody').hidden,true);el('toggleSheetContents').onclick();assert.equal(el('sheetContentsBody').hidden,false);

 assert.equal(el('printLayoutPanel').hidden,true);assert.equal(el('menuTogglePrintLayout')['aria-checked'],'false');

 el('expandPrintLayout').onclick();assert.equal(el('printLayoutPanel').hidden,false);assert.equal(el('printLayoutRail').hidden,true);

 document.onkeydown({key:'F8',preventDefault(){}});assert.equal(el('printLayoutPanel').hidden,true);

 el('menuTogglePrintLayout').onclick();assert.equal(el('printLayoutPanel').hidden,false);

 assert.equal(el('paperPreset').value,'210,297');assert.equal(el('paperOrientation').value,'landscape');assert.equal(el('paperUnit').value,'in');

 assert.equal(el('gap').value,'0.1');assert.equal(el('dpi').value,'600');assert.equal(el('sheetMode').value,'mixed');

 assert.equal(el('linkMargins')['aria-pressed'],'true');assert.equal(el('marginLeft').value,el('marginBottom').value);

 assert.equal(el('paperWidth').value,Number((297/25.4).toFixed(6)).toString());

 // Restored linking applies to future edits as well as the icon state.

 el('marginTop').value='0.5';el('marginTop').oninput();assert.equal(el('marginLeft').value,'0.5');

 await el('menuOpen').onclick();assert.equal(el('preset').value,'custom');assert.equal(el('width').value,Number((40/25.4).toFixed(6)).toString());assert.equal(Number(el('backgroundStrength').value),40);assert.equal(el('background').value,'red');

 // Verify a second restart with the commonly used preset and a different color/strength.

 el('preset').value='20.32,22.86';el('preset').onchange();

 el('background').value='blue';el('background').onchange();

 el('backgroundStrength').value='65';el('backgroundStrength').oninput();

 await el('backgroundStrength').onchange();

 await import('../web/app.js?second-restart-test');

 assert.equal(el('preset').value,'20.32,22.86');assert.equal(el('unit').value,'in');

 assert.equal(el('width').value,'0.8');assert.equal(el('height').value,'0.9');

 assert.equal(el('background').value,'blue');assert.equal(Number(el('backgroundStrength').value),65);

 await el('menuOpen').onclick();

 assert.equal(el('preset').value,'20.32,22.86');assert.equal(el('width').value,'0.8');assert.equal(el('height').value,'0.9');

 assert.equal(el('background').value,'blue');assert.equal(Number(el('backgroundStrength').value),65);



 // Loading remains visible while the backend is pending, then clears on cancel/error.

 const normalInvoke=window.__TAURI_INTERNALS__.invoke;

 let finishOpen;

 window.__TAURI_INTERNALS__.invoke=(command,args)=>command==='open_photo'?new Promise(resolve=>{finishOpen=resolve;}):command==='open_progress'?Promise.resolve({total:3,completed:1,name:'second.png'}):normalInvoke(command,args);

 const loadingJob=el('menuOpen').onclick();assert.equal(el('openLoading').hidden,false);

 assert.equal(el('menuOpen').disabled,true);

 await new Promise(resolve=>setTimeout(resolve,180));

 assert.match(el('openLoadingDetail').textContent,/1 \/ 3 processed/);

 assert.ok(el('openLoadingProgress').value>0);

 finishOpen(null);await loadingJob;assert.equal(el('openLoading').hidden,true);

 window.__TAURI_INTERNALS__.invoke=async()=>{throw Error('Test opening failure');};

 await el('menuOpen').onclick();assert.equal(el('openLoading').hidden,true);assert.equal(el('menuOpen').disabled,false);

 window.__TAURI_INTERNALS__.invoke=normalInvoke;



 // Completed files become selectable tabs while the rest of the batch is pending.

 const beforeBatch=el('documentTabs').children.length;

 const streamedFirst={id:++nextId,preview:'stream-first',width:700,height:900,name:'stream-first.png'};

 const streamedSecond={id:++nextId,preview:'stream-second',width:700,height:900,name:'stream-second.png'};

 const finalPhoto={id:++nextId,preview:'stream-final',width:700,height:900,name:'stream-final.png'};

 let queued=[streamedFirst],releaseDecode,decodeStarted=false,finishBatch;

 const NormalImage=globalThis.Image;

 globalThis.Image=class extends NormalImage {async decode(){if(this.src==='stream-second'){decodeStarted=true;await new Promise(resolve=>{releaseDecode=resolve;});}}};

 const waitUntil=async check=>{for(let n=0;n<100;n++){if(check())return;await new Promise(resolve=>setTimeout(resolve,10));}assert.fail('Timed out waiting for streamed preview');};

 window.__TAURI_INTERNALS__.invoke=(command,args)=>command==='open_photo'?new Promise(resolve=>{finishBatch=resolve;}):command==='open_progress'?Promise.resolve({total:4,completed:queued.length?1:2,name:'loading.png',photos:queued.splice(0)}):normalInvoke(command,args);

 const streamJob=el('menuOpen').onclick();

 await waitUntil(()=>el('documentTabs').children.length===beforeBatch+1);

 assert.equal(el('crop').hidden,false);assert.equal(el('openLoading').hidden,false);

 assert.equal(el('document-'+streamedFirst.id).disabled,false);assert.equal(el('menuOpen').disabled,true);

 // Editing alone pins the active photo; no explicit tab selection is needed.

 assert.equal(el('toolCrop').disabled,false);assert.equal(el('rotationAngle').disabled,false);

 el('toolCrop').onclick();el('width').value='1.2';el('width').oninput();

 el('zoom').value='1.4';el('zoom').oninput();

 el('crop').onkeydown({key:'ArrowRight',preventDefault(){}});

 el('toolRotate').onclick();el('rotationAngle').value='23';el('rotationAngle').oninput();

 el('toolBackground').onclick();delayRemoval=true;

 const backgroundJob=el('removeBackground').onclick();

 assert.equal(removals.at(-1).docId,streamedFirst.id);

 assert.equal(el('document-'+streamedFirst.id).disabled,true);

 queued.push(streamedSecond);await waitUntil(()=>decodeStarted);

 // Final command response arrives before a polled preview has finished decoding.

 let batchFinished=false;streamJob.then(()=>{batchFinished=true;});

 finishBatch({photos:[finalPhoto],errors:['broken.png: invalid image']});

 await new Promise(resolve=>setTimeout(resolve,10));assert.equal(batchFinished,false);

 releaseDecode();await streamJob;

 // Import completion must not clear the independent background-operation lock.

 assert.equal(el('toolCrop').disabled,true);assert.equal(el('menuOpen').disabled,true);

 assert.equal(el('document-'+streamedFirst.id)['aria-selected'],'true');

 assert.equal(el('documentTabs').children.length,beforeBatch+3);

 delayRemoval=false;pendingCutout('cutout');await backgroundJob;

 assert.equal(el('toolCrop').disabled,false);

 el('background').value='red';el('background').onchange();

 el('backgroundStrength').value='40';el('backgroundStrength').oninput();await el('backgroundStrength').onchange();

 await el('menuExportPhoto').onclick();

 assert.equal(exported.docId,streamedFirst.id);assert.equal(exported.crop.rotation,23);

 assert.ok(Math.abs(exported.crop.width_mm-30.48)<1e-9);

 assert.equal(exported.crop.remove_background,true);assert.equal(exported.crop.background,'red');

 el('document-'+finalPhoto.id).onclick();assert.equal(el('removeBackground').disabled,false);

 el('document-'+streamedFirst.id).onclick();assert.equal(parseFloat(el('rotationValue').value),23);

 assert.equal(Number(el('zoom').value),1.4);assert.equal(Number(el('backgroundStrength').value),40);

 assert.equal(el('background').value,'red');

 assert.equal(el('document-'+streamedFirst.id)['aria-selected'],'true');

 assert.equal(el('document-'+streamedSecond.id).disabled,false);assert.equal(el('document-'+finalPhoto.id).disabled,false);

 assert.equal(el('openLoading').hidden,true);

 globalThis.Image=NormalImage;window.__TAURI_INTERNALS__.invoke=normalInvoke;



 // Finishing a strength adjustment must not enable another import mid-batch.

 let finishLaterBatch;

 window.__TAURI_INTERNALS__.invoke=(command,args)=>command==='open_photo'?new Promise(resolve=>{finishLaterBatch=resolve;}):command==='open_progress'?Promise.resolve({total:2,completed:0,name:'remaining.png',photos:[]}):normalInvoke(command,args);

 const laterJob=el('menuOpen').onclick();

 el('backgroundStrength').value='55';el('backgroundStrength').oninput();await el('backgroundStrength').onchange();

 assert.equal(el('menuOpen').disabled,true);assert.equal(el('toolCrop').disabled,false);

 assert.equal(el('document-'+streamedFirst.id).disabled,false);

 finishLaterBatch(null);await laterJob;assert.equal(Number(el('backgroundStrength').value),55);

 window.__TAURI_INTERNALS__.invoke=normalInvoke;



});


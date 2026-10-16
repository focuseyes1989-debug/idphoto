export function createUpdateDialog({document,invoke,onBusy,beforeInstall,hasPhotos}){
 const $=id=>document.getElementById(id);let available=false,working=false;
 function close(){if(working)return;$('updateDialog').close();onBusy(false);}
 $('updateClose').onclick=close;$('updateDialog').oncancel=e=>{e.preventDefault();close();};
 async function check(){
  working=true;available=false;onBusy(true);$('updateInstall').disabled=true;$('updateCheck').disabled=true;$('updateClose').disabled=true;$('updateMessage').textContent='Checking for updates...';$('updateProgress').hidden=true;
  try{const r=await invoke('check_app_update');$('updateCurrent').textContent='Current version: '+r.current;$('updateNotes').textContent=r.notes||'';
   if(!r.configured)$('updateMessage').textContent='GitHub repository and update signing public key have not been configured yet.';
   else if(!r.version)$('updateMessage').textContent='You are using the latest version.';
   else{$('updateMessage').textContent='Version '+r.version+' is available.'+(r.can_install?'':' Install updates from the installed release app; cargo run is development mode.');available=r.can_install;}
   $('updateInstall').textContent=hasPhotos()?'Save project and install':'Download and install';
  }catch(e){$('updateMessage').textContent='Could not check for updates: '+e;}finally{working=false;$('updateInstall').disabled=!available;$('updateCheck').disabled=false;$('updateClose').disabled=false;}
 }
 $('updateCheck').onclick=check;
 $('updateInstall').onclick=async()=>{
  if(working||!available)return;working=true;$('updateInstall').disabled=true;$('updateCheck').disabled=true;$('updateClose').disabled=true;let timer=null,polling=false;
  try{
   if(hasPhotos()&&!await beforeInstall()){$('updateMessage').textContent='Update postponed. Save a project before installing.';return;}
   onBusy(true);$('updateMessage').textContent='Downloading update...';$('updateProgress').hidden=false;$('updateProgress').removeAttribute('value');
   timer=setInterval(async()=>{if(polling)return;polling=true;try{const p=await invoke('update_progress');$('updateMessage').textContent=p.phase+'...';if(p.total){$('updateProgress').max=p.total;$('updateProgress').value=p.downloaded;}else $('updateProgress').removeAttribute('value');}catch{}finally{polling=false;}},200);
   await invoke('install_app_update');$('updateMessage').textContent='Installer started. The app will close.';
  }catch(e){$('updateMessage').textContent='Update failed: '+e;}finally{if(timer)clearInterval(timer);working=false;$('updateInstall').disabled=!available;$('updateCheck').disabled=false;$('updateClose').disabled=false;onBusy(true);}
 };
 return {async open(){$('updateDialog').showModal();await check();}};
}

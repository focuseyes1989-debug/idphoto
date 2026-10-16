use serde::Serialize;
use std::sync::Mutex;
use tauri_plugin_updater::{Update,UpdaterExt};
#[derive(Default)]
pub struct Updates(Mutex<State>);
#[derive(Default)]
struct State {pending:Option<Update>,progress:Progress,busy:bool}
#[derive(Clone,Default,Serialize)]
pub struct Progress {phase:String,downloaded:u64,total:Option<u64>}
#[derive(Serialize)]
pub struct CheckResult {current:String,version:Option<String>,notes:Option<String>,configured:bool,can_install:bool}
fn configured(c:Option<&serde_json::Value>)->bool {
 let Some(c)=c else{return false;};
 c.get("pubkey").and_then(|v|v.as_str()).is_some_and(|s|!s.trim().is_empty())&&c.get("endpoints").and_then(|v|v.as_array()).is_some_and(|a|!a.is_empty()&&a.iter().all(|v|v.as_str().is_some_and(|s|s.starts_with("https://"))))
}
#[tauri::command]
pub async fn check_app_update(app:tauri::AppHandle,state:tauri::State<'_,Updates>)->Result<CheckResult,String>{
 let current=app.package_info().version.to_string();
 if !configured(app.config().plugins.0.get("updater")){return Ok(CheckResult{current,version:None,notes:None,configured:false,can_install:false});}
 {let mut s=state.0.lock().map_err(|e|e.to_string())?;if s.busy{return Err("Update operation is already running".into());}s.busy=true;s.pending=None;}
 let result=async {app.updater_builder().timeout(std::time::Duration::from_secs(120)).build().map_err(|e|e.to_string())?.check().await.map_err(|e|e.to_string())}.await;
 let mut s=state.0.lock().map_err(|e|e.to_string())?;s.busy=false;
 let update=result?;let version=update.as_ref().map(|u|u.version.clone());let notes=update.as_ref().and_then(|u|u.body.clone());s.pending=update;
 Ok(CheckResult{current,version,notes,configured:true,can_install:!cfg!(debug_assertions)})
}
#[tauri::command]
pub fn update_progress(state:tauri::State<'_,Updates>)->Result<Progress,String>{Ok(state.0.lock().map_err(|e|e.to_string())?.progress.clone())}
#[tauri::command]
pub async fn install_app_update(app:tauri::AppHandle,state:tauri::State<'_,Updates>)->Result<(),String>{
 if cfg!(debug_assertions){return Err("Install updates from the installed release app, not cargo run".into());}
 let update={let mut s=state.0.lock().map_err(|e|e.to_string())?;if s.busy{return Err("Update operation is already running".into());}let u=s.pending.take().ok_or("Check for updates first")?;s.busy=true;s.progress=Progress{phase:"Downloading".into(),..Default::default()};u};
 use tauri::Manager;
 let progress_app=app.clone();let finished_app=app.clone();
 let result=update.download_and_install(move|chunk,total|{let state=progress_app.state::<Updates>();if let Ok(mut s)=state.0.lock(){s.progress.downloaded+=chunk as u64;s.progress.total=total;};},move||{let state=finished_app.state::<Updates>();if let Ok(mut s)=state.0.lock(){s.progress.phase="Verifying and installing".into();};}).await.map_err(|e|e.to_string());
 let mut s=state.0.lock().map_err(|e|e.to_string())?;s.busy=false;if result.is_err(){s.pending=Some(update);s.progress.phase="Failed".into();}result
}
#[cfg(test)]
mod tests {#[test]fn unconfigured_source_does_not_contact_a_placeholder_endpoint(){assert!(!super::configured(None));assert!(!super::configured(Some(&serde_json::json!({"pubkey":"", "endpoints":[]}))));assert!(super::configured(Some(&serde_json::json!({"pubkey":"key", "endpoints":["https://github.com/owner/repo/releases/latest/download/latest.json"]}))));}}

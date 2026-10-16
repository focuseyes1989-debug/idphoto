use crate::{Photo,PhotoData,png_data};
use base64::{engine::general_purpose::STANDARD,Engine};
use image::{DynamicImage,GenericImageView,ImageFormat};
use serde::{Deserialize,Serialize};
use serde_json::Value;
use std::io::Cursor;

#[derive(Serialize,Deserialize)]
struct Asset {original:String,cutout:Option<String>,mask:Option<String>}
#[derive(Serialize,Deserialize)]
struct Project {format:String,version:u32,manifest:Value,assets:Vec<Asset>}
#[derive(Serialize)]
pub struct RestoredPhoto {id:u64,name:String,width:u32,height:u32,preview:String,cutout_preview:Option<String>}
#[derive(Serialize)]
pub struct OpenProject {manifest:Value,photos:Vec<RestoredPhoto>}
fn encode(image:&DynamicImage)->Result<String,String>{let mut bytes=Cursor::new(Vec::new());image.write_to(&mut bytes,ImageFormat::Png).map_err(|e|e.to_string())?;Ok(STANDARD.encode(bytes.into_inner()))}
fn decode(encoded:&str)->Result<DynamicImage,String>{let bytes=STANDARD.decode(encoded).map_err(|e|e.to_string())?;let mut reader=image::ImageReader::with_format(Cursor::new(bytes),ImageFormat::Png);let mut limits=image::Limits::default();limits.max_alloc=Some(512*1024*1024);reader.limits(limits);reader.decode().map_err(|e|e.to_string())}
fn asset(photo:&PhotoData)->Result<Asset,String>{Ok(Asset{original:encode(&photo.original)?,cutout:photo.cutout.as_ref().map(encode).transpose()?,mask:photo.mask.as_ref().map(|m|encode(&DynamicImage::ImageLuma8(m.clone()))).transpose()?})}
fn restore(a:Asset)->Result<PhotoData,String>{let original=decode(&a.original)?;let cutout=a.cutout.as_deref().map(decode).transpose()?;let mask=a.mask.as_deref().map(decode).transpose()?.map(|i|i.to_luma8());if cutout.as_ref().is_some_and(|i|i.dimensions()!=original.dimensions())||mask.as_ref().is_some_and(|i|i.dimensions()!=original.dimensions()){return Err("Project image dimensions do not match".into());}Ok(PhotoData{original,cutout,mask})}
#[tauri::command]
pub async fn save_project(state:tauri::State<'_,Photo>,manifest:Value)->Result<Option<String>,String>{
 let docs=manifest.get("documents").and_then(Value::as_array).ok_or("Invalid project documents")?;
 if docs.is_empty(){return Err("Open a photo before saving a project".into());}
 let ids:Vec<u64>=docs.iter().map(|d|d.get("id").and_then(Value::as_u64).ok_or("Invalid photo ID")).collect::<Result<_,_>>()?;
 let Some(file)=rfd::AsyncFileDialog::new().add_filter("ID Photo project", &["idphoto"]).set_file_name("Untitled.idphoto").save_file().await else{return Ok(None);};
 let path=file.path().to_path_buf();if !path.extension().is_some_and(|e|e.eq_ignore_ascii_case("idphoto")){return Err("Use the .idphoto project extension".into());}
 let data=state.0.clone();let target=path.clone();
 tauri::async_runtime::spawn_blocking(move||{
  let snapshots={let guard=data.lock().map_err(|e|e.to_string())?;ids.iter().map(|id|guard.photos.get(id).map(|p|PhotoData{original:p.original.clone(),cutout:p.cutout.clone(),mask:p.mask.clone()}).ok_or("Photo is closed")).collect::<Result<Vec<_>,_>>()?};
  let assets=snapshots.iter().map(asset).collect::<Result<Vec<_>,_>>()?;
  let project=Project{format:"id-photo-studio".into(),version:1,manifest,assets};
  let bytes=serde_json::to_vec(&project).map_err(|e|e.to_string())?;
  crate::write_atomic(&target,|output|{use std::io::Write;output.write_all(&bytes).map_err(|e|e.to_string())})
 }).await.map_err(|e|e.to_string())??;
 Ok(Some(path.display().to_string()))
}
#[tauri::command]
pub async fn open_project(state:tauri::State<'_,Photo>)->Result<Option<OpenProject>,String>{
 let Some(file)=rfd::AsyncFileDialog::new().add_filter("ID Photo project", &["idphoto"]).pick_file().await else{return Ok(None);};let path=file.path().to_path_buf();let data=state.0.clone();
 tauri::async_runtime::spawn_blocking(move||{
  if std::fs::metadata(&path).map_err(|e|e.to_string())?.len()>1024*1024*1024{return Err("Project exceeds the 1 GB limit".into());}
  let project:Project=serde_json::from_slice(&std::fs::read(path).map_err(|e|e.to_string())?).map_err(|e|format!("Invalid project: {e}"))?;
  if project.format!="id-photo-studio"||project.version!=1{return Err("Unsupported project format or version".into());}
  let docs=project.manifest.get("documents").and_then(Value::as_array).ok_or("Invalid project documents")?;
  if docs.is_empty()||docs.len()!=project.assets.len(){return Err("Project images are missing".into());}
  // Decode every asset before changing the store; damaged projects leave open photos intact.
  let mut pending=Vec::new();
  for (doc,a) in docs.iter().zip(project.assets){let photo=restore(a)?;let (width,height)=photo.original.dimensions();let preview=png_data(&photo.original.thumbnail(1600,1600))?;let cutout_preview=photo.cutout.as_ref().map(|i|png_data(&i.thumbnail(1600,1600))).transpose()?;pending.push((photo,RestoredPhoto{id:0,name:doc.get("name").and_then(Value::as_str).unwrap_or("Photo").to_owned(),width,height,preview,cutout_preview}));}
  let mut guard=data.lock().map_err(|e|e.to_string())?;let photos=pending.into_iter().map(|(photo,mut opened)|{opened.id=guard.insert(photo);opened}).collect();
  Ok(Some(OpenProject{manifest:project.manifest,photos}))
 }).await.map_err(|e|e.to_string())?
}
#[cfg(test)]
mod tests{
 use super::*;
 #[test] fn embedded_images_masks_and_transparency_round_trip(){let original=DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(3,4,image::Rgba([23,45,67,89])));let photo=PhotoData{original:original.clone(),cutout:Some(original),mask:Some(image::GrayImage::from_pixel(3,4,image::Luma([120])))};let restored=restore(asset(&photo).unwrap()).unwrap();assert_eq!(restored.original.to_rgba8(),photo.original.to_rgba8());assert_eq!(restored.cutout.unwrap().to_rgba8(),photo.cutout.unwrap().to_rgba8());assert_eq!(restored.mask,photo.mask);assert!(restore(Asset{original:"bad".into(),cutout:None,mask:None}).is_err());}
}

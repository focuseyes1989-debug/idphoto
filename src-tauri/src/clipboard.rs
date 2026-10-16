use crate::{Photo,PhotoData,Crop,Opened,render,png_data,preview};
use image::{DynamicImage,GenericImageView};
#[tauri::command]
pub async fn copy_photo(state:tauri::State<'_,Photo>,doc_id:u64,crop:Crop)->Result<(),String>{
 let data=state.0.clone();
 tauri::async_runtime::spawn_blocking(move||{
  let source={let guard=data.lock().map_err(|e|e.to_string())?;let photo=guard.photos.get(&doc_id).ok_or("Photo is closed")?;if crop.remove_background{photo.cutout.as_ref().ok_or("Remove background first")?.clone()}else{photo.original.clone()}};
  let rgba=render(&source,&crop,false)?.to_rgba8();let (width,height)=rgba.dimensions();
  arboard::Clipboard::new().map_err(|e|e.to_string())?.set_image(arboard::ImageData{width:width as usize,height:height as usize,bytes:std::borrow::Cow::Owned(rgba.into_raw())}).map_err(|e|e.to_string())
 }).await.map_err(|e|e.to_string())?
}
#[tauri::command]
pub async fn paste_photo(state:tauri::State<'_,Photo>)->Result<Opened,String>{
 let data=state.0.clone();
 tauri::async_runtime::spawn_blocking(move||{
  let content=arboard::Clipboard::new().map_err(|e|e.to_string())?.get_image().map_err(|_|"Clipboard does not contain an image. Copy an image first.".to_string())?;
  let image=decode_image(content.width,content.height,content.bytes.into_owned())?;
  let (width,height)=image.dimensions();let preview=png_data(&image.thumbnail(1600,1600))?;
  let id=data.lock().map_err(|e|e.to_string())?.insert(PhotoData{original:image,cutout:None,mask:None});
  Ok(Opened{id,name:"Clipboard photo.png".into(),width,height,preview,timings:preview::LoadTimings::default()})
 }).await.map_err(|e|e.to_string())?
}
fn decode_image(width:usize,height:usize,bytes:Vec<u8>)->Result<DynamicImage,String>{
 let pixels=width.checked_mul(height).ok_or("Clipboard image is too large")?;
 if width==0||height==0||pixels>128*1024*1024||width>u32::MAX as usize||height>u32::MAX as usize||pixels.checked_mul(4)!=Some(bytes.len()){return Err("Invalid or oversized clipboard image".into());}
 Ok(DynamicImage::ImageRgba8(image::RgbaImage::from_raw(width as u32,height as u32,bytes).ok_or("Invalid clipboard pixels")?))
}
#[cfg(test)]
mod tests {#[test]fn clipboard_rgba_validation(){assert_eq!(super::decode_image(1,1,vec![12,34,56,78]).unwrap().to_rgba8().get_pixel(0,0).0,[12,34,56,78]);assert!(super::decode_image(2,2,vec![0;4]).is_err());assert!(super::decode_image(usize::MAX,2,vec![]).is_err());}}

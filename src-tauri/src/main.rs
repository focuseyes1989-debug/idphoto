#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use base64::{engine::general_purpose::STANDARD, Engine};
use image::{imageops::FilterType, DynamicImage, GenericImageView};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    io::Cursor,
    sync::{Arc, Mutex},
};
mod background;
mod clipboard;
mod native_printer;
mod preview;
mod project;
mod updater;
mod printing;
mod sheet;
mod tone;
mod retouch;
mod brush;
mod selective_color;

#[derive(Default)]
struct Photo(Arc<Mutex<DocumentStore>>, Arc<Mutex<OpenProgress>>);
#[derive(Default, Serialize)]
struct OpenProgress {
    completed: usize,
    total: usize,
    name: String,
    photos: Vec<Opened>,
}
#[tauri::command]
fn open_progress(state: tauri::State<'_, Photo>) -> Result<OpenProgress, String> {
    let mut progress = state.1.lock().map_err(|e| e.to_string())?;
    Ok(OpenProgress {
        completed: progress.completed,
        total: progress.total,
        name: progress.name.clone(),
        photos: std::mem::take(&mut progress.photos),
    })
}
#[derive(Default)]
struct DocumentStore {
    next_id: u64,
    photos: HashMap<u64, PhotoData>,
    sources: HashMap<u64,std::path::PathBuf>,
    saved: HashMap<u64,std::path::PathBuf>,
}
impl DocumentStore {
    fn insert(&mut self, photo: PhotoData) -> u64 {
        self.next_id += 1;
        let id = self.next_id;
        self.photos.insert(id, photo);
        id
    }
}
struct PhotoData {
    original: DynamicImage,
    cutout: Option<DynamicImage>,
    mask: Option<image::GrayImage>,
}
#[derive(Serialize)]
struct Opened {
    id: u64,
    preview: String,
    width: u32,
    height: u32,
    name: String,
    timings: preview::LoadTimings,
}
#[derive(Deserialize, Clone)]
struct Crop {
    #[serde(default)]
    adjustments: tone::Tone,
    #[serde(default)]
    paper: sheet::Paper,
    #[serde(default)]
    rotation: f64,
    #[serde(default)]
    remove_background: bool,
    #[serde(default = "default_background")]
    background: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    width_mm: f64,
    height_mm: f64,
    dpi: u32,
    gap_mm: f64,
}
fn default_background() -> String {
    "white".into()
}
fn background_color(name: &str) -> Result<[u8; 3], String> {
    match name {
        "white" => Ok([255, 255, 255]),
        "blue" => Ok([35, 114, 210]),
        "red" => Ok([210, 47, 55]),
        _ => Err("Unknown background color".into()),
    }
}
fn rotated(img: &DynamicImage, rotation: f64) -> Result<DynamicImage, String> {
    if !rotation.is_finite() || rotation.abs() > 360.0 {
        return Err("Invalid rotation".into());
    }
    let degrees = rotation.rem_euclid(360.0);
    if degrees == 0.0 {
        return Ok(img.clone());
    }
    if degrees == 90.0 {
        return Ok(img.rotate90());
    }
    if degrees == 180.0 {
        return Ok(img.rotate180());
    }
    if degrees == 270.0 {
        return Ok(img.rotate270());
    }
    let (sin, cos) = degrees.to_radians().sin_cos();
    let (w, h) = img.dimensions();
    let rw = (w as f64 * cos.abs() + h as f64 * sin.abs() - 1e-8).ceil() as u32;
    let rh = (w as f64 * sin.abs() + h as f64 * cos.abs() - 1e-8).ceil() as u32;
    let source = img.to_rgba8();
    let output = image::RgbaImage::from_fn(rw, rh, |x, y| {
        let dx = x as f64 + 0.5 - rw as f64 / 2.0;
        let dy = y as f64 + 0.5 - rh as f64 / 2.0;
        let sx = cos * dx + sin * dy + w as f64 / 2.0 - 0.5;
        let sy = -sin * dx + cos * dy + h as f64 / 2.0 - 0.5;
        let ix = sx.floor() as i64;
        let iy = sy.floor() as i64;
        let fx = sx - sx.floor();
        let fy = sy - sy.floor();
        let mut alpha = 0.0;
        let mut rgb = [0.0; 3];
        for (ox, oy, weight) in [
            (0, 0, (1.0 - fx) * (1.0 - fy)),
            (1, 0, fx * (1.0 - fy)),
            (0, 1, (1.0 - fx) * fy),
            (1, 1, fx * fy),
        ] {
            let px = ix + ox;
            let py = iy + oy;
            if px >= 0 && py >= 0 && px < w as i64 && py < h as i64 {
                let p = source.get_pixel(px as u32, py as u32);
                let a = p[3] as f64 * weight;
                alpha += a;
                for i in 0..3 {
                    rgb[i] += p[i] as f64 * a;
                }
            }
        }
        if alpha <= 1e-8 {
            image::Rgba([0, 0, 0, 0])
        } else {
            image::Rgba([
                (rgb[0] / alpha).round() as u8,
                (rgb[1] / alpha).round() as u8,
                (rgb[2] / alpha).round() as u8,
                alpha.round() as u8,
            ])
        }
    });
    Ok(DynamicImage::ImageRgba8(output))
}
fn png_data(img: &DynamicImage) -> Result<String, String> {
    let mut out = Cursor::new(Vec::new());
    img.write_to(&mut out, image::ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    Ok(format!(
        "data:image/png;base64,{}",
        STANDARD.encode(out.into_inner())
    ))
}
#[derive(Serialize)]
struct OpenBatch {
    photos: Vec<Opened>,
    errors: Vec<String>,
}
fn load_photo(path: &std::path::Path) -> Result<(Opened, PhotoData), String> {
    let (img, preview, timings) = preview::load(path)?;
    let (width, height) = img.dimensions();
    #[cfg(debug_assertions)]
    eprintln!("Photo loading: {:?}", timings);
    Ok((
        Opened {
            id: 0,
            preview,
            timings,
            width,
            height,
            name: path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned(),
        },
        PhotoData {
            original: img,
            mask: None,
            cutout: None,
        },
    ))
}
#[tauri::command]
async fn open_photo(state: tauri::State<'_, Photo>) -> Result<Option<OpenBatch>, String> {
    *state.1.lock().map_err(|e| e.to_string())? = OpenProgress::default();
    let Some(files) = rfd::AsyncFileDialog::new()
        .add_filter("Photos", &["jpg", "jpeg", "png", "webp"])
        .pick_files()
        .await
    else {
        return Ok(None);
    };
    let store = state.0.clone();
    let progress = state.1.clone();
    *progress.lock().map_err(|e| e.to_string())? = OpenProgress {
        total: files.len(),
        ..Default::default()
    };
    tauri::async_runtime::spawn_blocking(move || {
        let mut batch = OpenBatch {
            photos: Vec::new(),
            errors: Vec::new(),
        };
        for (index, file) in files.into_iter().enumerate() {
            {
                let mut current = progress.lock().map_err(|e| e.to_string())?;
                current.completed = index;
                current.name = file.file_name();
            }
            match load_photo(file.path()) {
                Ok((mut opened, data)) => {
                    {let mut guard=store.lock().map_err(|e|e.to_string())?;opened.id=guard.insert(data);guard.sources.insert(opened.id,file.path().to_path_buf());}
                    progress
                        .lock()
                        .map_err(|e| e.to_string())?
                        .photos
                        .push(opened);
                }
                Err(e) => batch.errors.push(format!("{}: {e}", file.file_name())),
            }
            progress.lock().map_err(|e| e.to_string())?.completed = index + 1;
        }
        batch.photos = std::mem::take(&mut progress.lock().map_err(|e| e.to_string())?.photos);
        Ok(Some(batch))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
fn close_photo(state: tauri::State<'_, Photo>, doc_id: u64) -> Result<(), String> {
    state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .photos
        .remove(&doc_id)
        .ok_or("Photo is already closed")?;
    {let mut guard=state.0.lock().map_err(|e|e.to_string())?;guard.sources.remove(&doc_id);guard.saved.remove(&doc_id);}
    Ok(())
}
#[tauri::command]
async fn remove_background(
    state: tauri::State<'_, Photo>,
    doc_id: u64,
    strength: u8,
) -> Result<String, String> {
    let data = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if strength > 100 {
            return Err("Invalid removal strength".into());
        }
        // Snapshot briefly; inference must not hold the store lock needed by imports.
        let (original, mask) = {
            let guard = data.lock().map_err(|e| e.to_string())?;
            let photo = guard.photos.get(&doc_id).ok_or("Photo is closed")?;
            (photo.original.clone(), photo.mask.clone())
        };
        let mask = match mask {
            Some(mask) => mask,
            None => background::generate_mask(&original)?,
        };
        let cutout = background::apply_strength(&original, &mask, strength)?;
        let preview = png_data(&cutout.thumbnail(1600, 1600))?;
        {
            let mut guard = data.lock().map_err(|e| e.to_string())?;
            let photo = guard.photos.get_mut(&doc_id).ok_or("Photo is closed")?;
            photo.mask = Some(mask);
            photo.cutout = Some(cutout);
        }
        Ok(preview)
    })
    .await
    .map_err(|e| e.to_string())?
}
fn pixels(mm: f64, dpi: u32) -> u32 {
    (mm / 25.4 * dpi as f64).round() as u32
}
fn render(img: &DynamicImage, c: &Crop, sheet: bool) -> Result<DynamicImage, String> {
    let background = background_color(&c.background)?;
    let brushed=if c.adjustments.brushes.is_empty(){None}else{Some(brush::apply(img,&c.adjustments.brushes)?)};
    let img = c.adjustments.apply(rotated(brushed.as_ref().unwrap_or(img), c.rotation)?)?;
    if ![
        c.x,
        c.y,
        c.width,
        c.height,
        c.width_mm,
        c.height_mm,
        c.gap_mm,
    ]
    .iter()
    .all(|v| v.is_finite())
        || !(72..=600).contains(&c.dpi)
        || c.width_mm < 10.0
        || c.height_mm < 10.0
        || c.width_mm > 101.6
        || c.height_mm > 152.4
        || c.gap_mm < 0.0
        || c.gap_mm > 20.0
        || c.x < 0.0
        || c.y < 0.0
        || c.width <= 0.0
        || c.height <= 0.0
        || c.x + c.width > 1.00001
        || c.y + c.height > 1.00001
    {
        return Err("Invalid crop or print dimensions".into());
    }
    let (w, h) = img.dimensions();
    let x = (c.x * w as f64).round() as u32;
    let y = (c.y * h as f64).round() as u32;
    let cw = ((c.width * w as f64).round() as u32).min(w.saturating_sub(x));
    let ch = ((c.height * h as f64).round() as u32).min(h.saturating_sub(y));
    if cw == 0 || ch == 0 {
        return Err("Crop is empty".into());
    }
    let pw = pixels(c.width_mm, c.dpi);
    let ph = pixels(c.height_mm, c.dpi);
    let rgba = img
        .crop_imm(x, y, cw, ch)
        .resize_exact(pw, ph, FilterType::Lanczos3)
        .to_rgba8();
    let photo = image::RgbImage::from_fn(pw, ph, |x, y| {
        let p = rgba.get_pixel(x, y);
        let alpha = p[3] as u32;
        image::Rgb(std::array::from_fn(|i| {
            ((p[i] as u32 * alpha + background[i] as u32 * (255 - alpha) + 127) / 255) as u8
        }))
    });
    if !sheet {
        return Ok(DynamicImage::ImageRgb8(photo));
    }
    let bounds = c.paper.bounds(c.dpi)?;
    let sw = bounds.width;
    let sh = bounds.height;
    let (gx,gy) = c.paper.gaps(c.gap_mm,c.dpi)?;
    let cols = (bounds.usable_width + gx) / (pw + gx);
    let rows = (bounds.usable_height + gy) / (ph + gy);
    if cols == 0 || rows == 0 {
        return Err("Photo does not fit inside the paper margins".into());
    }
    let mut paper = image::RgbImage::from_pixel(sw, sh, image::Rgb([255, 255, 255]));
    let left = bounds.left;
    let top = bounds.top;
    for row in 0..rows {
        for col in 0..cols {
            image::imageops::replace(
                &mut paper,
                &photo,
                (left + col * (pw + gx)) as i64,
                (top + row * (ph + gy)) as i64,
            );
        }
    }
    Ok(DynamicImage::ImageRgb8(paper))
}
#[tauri::command]
async fn save_photo(state:tauri::State<'_,Photo>,doc_id:u64,crop:Crop,save_as:bool)->Result<Option<String>,String>{
    let (previous,name)={let guard=state.0.lock().map_err(|e|e.to_string())?;if !guard.photos.contains_key(&doc_id){return Err("Photo is closed".into());}(guard.saved.get(&doc_id).cloned(),guard.sources.get(&doc_id).and_then(|p|p.file_stem()).map(|n|format!("{}-edited.png",n.to_string_lossy())).unwrap_or_else(||"id-photo-edited.png".into()))};
    let path=if !save_as&&previous.is_some(){previous.unwrap()}else{
        let mut dialog=rfd::AsyncFileDialog::new().add_filter("PNG image", &["png"]).set_file_name(&name);
        if let Some(parent)=previous.as_ref().and_then(|p|p.parent()){dialog=dialog.set_directory(parent);}
        let Some(file)=dialog.save_file().await else{return Ok(None);};file.path().to_path_buf()
    };
    if !path.extension().is_some_and(|e|e.eq_ignore_ascii_case("png")){return Err("Please save with a .png extension".into());}
    let data=state.0.clone();let target=path.clone();
    tauri::async_runtime::spawn_blocking(move||{
        let source={let guard=data.lock().map_err(|e|e.to_string())?;
            let resolved=std::fs::canonicalize(&target).unwrap_or_else(|_|target.clone());
            if guard.sources.values().any(|p|std::fs::canonicalize(p).unwrap_or_else(|_|p.clone()).to_string_lossy().eq_ignore_ascii_case(&resolved.to_string_lossy())){return Err("Choose another filename to keep the original photo unchanged".into());}
            let photo=guard.photos.get(&doc_id).ok_or("Photo is closed")?;
            if crop.remove_background{photo.cutout.as_ref().ok_or("Remove the background first")?.clone()}else{photo.original.clone()}
        };
        let image=render(&source,&crop,false)?;write_saved_png(&target,&image,crop.dpi)?;
        data.lock().map_err(|e|e.to_string())?.saved.insert(doc_id,target);Ok::<(),String>(())
    }).await.map_err(|e|e.to_string())??;
    Ok(Some(path.display().to_string()))
}
fn write_saved_png(path:&std::path::Path,image:&DynamicImage,dpi:u32)->Result<(),String>{
    write_atomic(path,|file|encode_png(file,image,dpi))
}
fn write_atomic(path:&std::path::Path,write:impl FnOnce(&mut std::fs::File)->Result<(),String>)->Result<(),String>{
    let parent=path.parent().ok_or("Invalid save path")?;
    let stamp=std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|e|e.to_string())?.as_nanos();
    let temp=parent.join(format!(".id-photo-save-{}-{stamp}.tmp",std::process::id()));
    let result=(||{let mut file=std::fs::OpenOptions::new().write(true).create_new(true).open(&temp).map_err(|e|e.to_string())?;
        write(&mut file)?;file.sync_all().map_err(|e|e.to_string())?;drop(file);std::fs::rename(&temp,path).map_err(|e|e.to_string())})();
    if result.is_err(){let _=std::fs::remove_file(&temp);}result
}
#[tauri::command]
async fn export_photo(
    state: tauri::State<'_, Photo>,
    crop: Crop,
    sheet: bool,
    doc_id: u64,
) -> Result<Option<String>, String> {
    let img = {
        let guard = state.0.lock().map_err(|e| e.to_string())?;
        let photo = guard.photos.get(&doc_id).ok_or("Photo is closed")?;
        let img = if crop.remove_background {
            photo.cutout.as_ref().ok_or("Remove the background first")?
        } else {
            &photo.original
        };
        render(img, &crop, sheet)?
    };
    save_png(
        img,
        crop.dpi,
        if sheet {
            "id-sheet.png"
        } else {
            "id-photo.png"
        },
    )
    .await
}
#[tauri::command]
async fn export_mixed_sheet(
    state: tauri::State<'_, Photo>,
    items: Vec<sheet::SheetItem>,
    dpi: u32,
    gap_mm: f64,
    paper: sheet::Paper,
) -> Result<Option<String>, String> {
    let pages=sheet::layout_pages(&items,dpi,gap_mm,&paper)?.len();
    if pages==1 {
        let data=state.0.clone();let image=tauri::async_runtime::spawn_blocking(move||{let guard=data.lock().map_err(|e|e.to_string())?;sheet::compose_page(&guard,&items,dpi,gap_mm,&paper,0)}).await.map_err(|e|e.to_string())??;
        return save_png(image,dpi,"id-mixed-sheet.png").await;
    }
    let Some(file)=rfd::AsyncFileDialog::new().add_filter("PNG sheets (ZIP)",&["zip"]).set_file_name("id-photo-sheets.zip").save_file().await else{return Ok(None);};
    let path=file.path().to_path_buf();if !path.extension().is_some_and(|e|e.eq_ignore_ascii_case("zip")){return Err("Save multiple sheets as a .zip file".into());}
    let data=state.0.clone();let target=path.clone();
    tauri::async_runtime::spawn_blocking(move||{write_atomic(&target,|file|{
        let mut archive=zip::ZipWriter::new(file);
        for page in 0..pages {
            let image={let guard=data.lock().map_err(|e|e.to_string())?;sheet::compose_page(&guard,&items,dpi,gap_mm,&paper,page)?};
            let mut bytes=Vec::new();encode_png(&mut bytes,&image,dpi)?;
            archive.start_file(format!("sheet-{:02}.png",page+1),zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored)).map_err(|e|e.to_string())?;
            use std::io::Write;archive.write_all(&bytes).map_err(|e|e.to_string())?;
        }
        archive.finish().map_err(|e|e.to_string())?;Ok(())
    })}).await.map_err(|e|e.to_string())??;
    Ok(Some(path.display().to_string()))
}

fn print_page_for(
    store: &DocumentStore,
    doc_id: u64,
    crop: &Crop,
    items: Option<&[sheet::SheetItem]>,
    page: usize,
) -> Result<DynamicImage, String> {
    if let Some(items) = items {
        sheet::compose_page(store, items, crop.dpi, crop.gap_mm, &crop.paper,page)
    } else {
        if page!=0{return Err("Invalid sheet page".into());}
        let photo = store.photos.get(&doc_id).ok_or("Photo is closed")?;
        let source = if crop.remove_background {
            photo.cutout.as_ref().ok_or("Remove the background first")?
        } else {
            &photo.original
        };
        render(source, crop, true)
    }
}
#[tauri::command]
async fn list_printers() -> Result<Vec<native_printer::Printer>, String> {
    tauri::async_runtime::spawn_blocking(native_printer::enumerate)
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn check_printer(printer: String, reconnect: bool) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if reconnect {
            native_printer::reconnect(&printer)
        } else {
            native_printer::check(&printer)
        }
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn printer_properties(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, native_printer::PrinterSettings>,
    printer: String,
    paper: sheet::Paper,
) -> Result<Option<native_printer::PaperSize>, String> {
    let hwnd = window.hwnd().map_err(|e| e.to_string())?.0 as isize;
    let saved = state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .get(&printer)
        .cloned();
    let name = printer.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        native_printer::properties(&name, hwnd, &paper, saved)
    })
    .await
    .map_err(|e| e.to_string())??;
    if let Some((settings, paper)) = result {
        state
            .0
            .lock()
            .map_err(|e| e.to_string())?
            .insert(printer, settings);
        Ok(Some(paper))
    } else {
        Ok(None)
    }
}
#[tauri::command]
async fn submit_print(
    state: tauri::State<'_, Photo>,
    settings: tauri::State<'_, native_printer::PrinterSettings>,
    doc_id: u64,
    crop: Crop,
    items: Option<Vec<sheet::SheetItem>>,
    printer: String,
    copies: u32,
) -> Result<i32, String> {
    if !(1..=100).contains(&copies) {
        return Err("Copies must be between 1 and 100".into());
    }
    let data = state.0.clone();
    let saved = settings
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .get(&printer)
        .cloned();
    tauri::async_runtime::spawn_blocking(move || {
        let pages=if let Some(items)=&items{sheet::layout_pages(items,crop.dpi,crop.gap_mm,&crop.paper)?.len()}else{1};
        native_printer::print_pages(&printer,copies,&crop.paper,pages,|page|{let store=data.lock().map_err(|e|e.to_string())?;print_page_for(&store,doc_id,&crop,items.as_deref(),page)},saved)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn prepare_print(
    state: tauri::State<'_, Photo>,
    doc_id: u64,
    crop: Crop,
    items: Option<Vec<sheet::SheetItem>>,
    preview_only: Option<bool>,
    page_index: Option<usize>,
) -> Result<String, String> {
    let data = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let guard = data.lock().map_err(|e| e.to_string())?;
        let start=std::time::Instant::now();
        let image=if preview_only.unwrap_or(false) {
            if let Some(items)=items.as_deref(){sheet::compose_page_preview(&guard,items,crop.dpi,crop.gap_mm,&crop.paper,page_index.unwrap_or(0),true)?}
            else{let photo=guard.photos.get(&doc_id).ok_or("Photo is closed")?;let source=if crop.remove_background{photo.cutout.as_ref().ok_or("Remove the background first")?}else{&photo.original};render(&source.thumbnail(1200,1200),&crop,true)?}
        }else{print_page_for(&guard, doc_id, &crop, items.as_deref(),page_index.unwrap_or(0))?};
        drop(guard);
        let render_ms=start.elapsed().as_millis();let encode_start=std::time::Instant::now();
        if preview_only.unwrap_or(false) && (image.width() > 1000 || image.height() > 1000) {
            let result=png_data(&image.thumbnail(1000,1000));eprintln!("Print preview render={}ms encode={}ms",render_ms,encode_start.elapsed().as_millis());result
        } else {
            let result=png_data(&image);eprintln!("Print preview render={}ms encode={}ms",render_ms,encode_start.elapsed().as_millis());result
        }
    })
    .await
    .map_err(|e| e.to_string())?
}
async fn save_png(img: DynamicImage, dpi: u32, name: &str) -> Result<Option<String>, String> {
    let Some(file) = rfd::AsyncFileDialog::new()
        .add_filter("PNG image", &["png"])
        .set_file_name(name)
        .save_file()
        .await
    else {
        return Ok(None);
    };
    let path = file.path().to_path_buf();
    if !path
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("png"))
    {
        return Err("Please save with a .png extension".into());
    }
    let output = std::fs::File::create(&path).map_err(|e| e.to_string())?;
    encode_png(output, &img, dpi)?;
    Ok(Some(path.display().to_string()))
}
fn encode_png(output: impl std::io::Write, img: &DynamicImage, dpi: u32) -> Result<(), String> {
    let rgb = img.to_rgb8();
    let mut encoder = png::Encoder::new(output, rgb.width(), rgb.height());
    encoder.set_color(png::ColorType::Rgb);
    encoder.set_depth(png::BitDepth::Eight);
    encoder.set_pixel_dims(Some(png::PixelDimensions {
        xppu: (dpi as f64 / 0.0254).round() as u32,
        yppu: (dpi as f64 / 0.0254).round() as u32,
        unit: png::Unit::Meter,
    }));
    encoder
        .write_header()
        .map_err(|e| e.to_string())?
        .write_image_data(rgb.as_raw())
        .map_err(|e| e.to_string())?;
    Ok(())
}
#[cfg(test)]
mod save_tests {
 use super::*;
 #[test]
 fn save_replaces_png_and_cleans_failed_temporary_file(){
  let dir=std::env::temp_dir().join(format!("id-photo-save-test-{}-{}",std::process::id(),std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));std::fs::create_dir(&dir).unwrap();
  let path=dir.join("photo.png");let image=DynamicImage::ImageRgb8(image::RgbImage::from_pixel(2,3,image::Rgb([210,30,40])));
  write_saved_png(&path,&image,300).unwrap();
  let updated=DynamicImage::ImageRgb8(image::RgbImage::from_pixel(4,5,image::Rgb([20,180,40])));write_saved_png(&path,&updated,300).unwrap();
  assert_eq!(image::open(&path).unwrap().dimensions(),(4,5));
  let invalid=dir.join("directory.png");std::fs::create_dir(&invalid).unwrap();assert!(write_saved_png(&invalid,&image,300).is_err());
  assert_eq!(std::fs::read_dir(&dir).unwrap().count(),2);
  std::fs::remove_file(path).unwrap();std::fs::remove_dir(invalid).unwrap();std::fs::remove_dir(dir).unwrap();
 }
}
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(updater::Updates::default())
        .manage(Photo::default())
        .manage(native_printer::PrinterSettings::default())
        .setup(|app| {
            #[cfg(windows)]
            {
                use tauri::Manager;
                if let Some(window) = app.get_webview_window("main") {
                    printing::configure_shortcuts(&window)?;
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            updater::check_app_update,
            updater::update_progress,
            updater::install_app_update,
            clipboard::copy_photo,
            clipboard::paste_photo,
            open_photo,
            open_progress,
            close_photo,
            remove_background,
            export_photo,
            save_photo,
            project::save_project,
            project::open_project,
            export_mixed_sheet,
            prepare_print,
            printing::show_print_dialog,
            list_printers,
            check_printer,
            printer_properties,
            submit_print
        ])
        .run(tauri::generate_context!())
        .expect("Failed to start ID Photo Studio");
}
#[cfg(test)]
mod tests {

    #[test]
    #[ignore = "Manual preview stage timing; requires ID_PHOTO_PROFILE_FILES"]
    fn profile_photo_loading() {
        use image::ImageDecoder;
        use image::ImageEncoder;
        use std::time::Instant;
        let files = std::env::var("ID_PHOTO_PROFILE_FILES").expect("Set ID_PHOTO_PROFILE_FILES");
        for path in files.split(';') {
            for run in 1..=3 {
                let start = Instant::now();
                let mut decoder = image::ImageReader::open(path)
                    .unwrap()
                    .into_decoder()
                    .unwrap();
                let orientation = decoder.orientation().unwrap();
                let read_ms = start.elapsed().as_secs_f64() * 1000.0;
                let start = Instant::now();
                let mut img = DynamicImage::from_decoder(decoder).unwrap();
                let decode_ms = start.elapsed().as_secs_f64() * 1000.0;
                let start = Instant::now();
                img.apply_orientation(orientation);
                let orient_ms = start.elapsed().as_secs_f64() * 1000.0;
                let start = Instant::now();
                let preview = img.thumbnail(1600, 1600);
                let resize_ms = start.elapsed().as_secs_f64() * 1000.0;
                let start = Instant::now();
                let mut old = Cursor::new(Vec::new());
                preview.write_to(&mut old, image::ImageFormat::Png).unwrap();
                let png_ms = start.elapsed().as_secs_f64() * 1000.0;
                let start = Instant::now();
                let encoded = STANDARD.encode(old.get_ref());
                let base64_ms = start.elapsed().as_secs_f64() * 1000.0;
                let start = Instant::now();
                let rgba = preview.to_rgba8();
                let mut fast = Vec::new();
                image::codecs::png::PngEncoder::new_with_quality(
                    &mut fast,
                    image::codecs::png::CompressionType::Fast,
                    image::codecs::png::FilterType::Adaptive,
                )
                .write_image(
                    &rgba,
                    rgba.width(),
                    rgba.height(),
                    image::ExtendedColorType::Rgba8,
                )
                .unwrap();
                let fast_ms = start.elapsed().as_secs_f64() * 1000.0;
                let start = Instant::now();
                let rgb = preview.to_rgb8();
                let mut jpeg = Vec::new();
                image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, 90)
                    .encode_image(&rgb)
                    .unwrap();
                let jpeg_ms = start.elapsed().as_secs_f64() * 1000.0;
                let (_, _, optimized) = preview::load(std::path::Path::new(path)).unwrap();
                println!("OPTIMIZED run={} {:?}", run, optimized);
                println!("PROFILE {} run={} dimensions={}x{} read={:.1} decode={:.1} orientation={:.1} resize={:.1} png={:.1} base64={:.1} fast_png={:.1} jpeg={:.1} bytes_old={} bytes_fast={} bytes_jpeg={} base64_bytes={}",std::path::Path::new(path).file_name().unwrap().to_string_lossy(),run,img.width(),img.height(),read_ms,decode_ms,orient_ms,resize_ms,png_ms,base64_ms,fast_ms,jpeg_ms,old.get_ref().len(),fast.len(),jpeg.len(),encoded.len());
            }
        }
    }
    use super::*;
    #[test]
    fn document_store_keeps_images_and_masks_independent() {
        let mut store = DocumentStore::default();
        let first = store.insert(PhotoData {
            original: DynamicImage::new_rgb8(20, 30),
            mask: None,
            cutout: Some(DynamicImage::new_rgba8(20, 30)),
        });
        let second = store.insert(PhotoData {
            original: DynamicImage::new_rgb8(40, 50),
            mask: None,
            cutout: None,
        });
        assert_ne!(first, second);
        assert!(store.photos[&first].cutout.is_some());
        assert!(store.photos[&second].cutout.is_none());
        store.photos.remove(&first);
        assert_eq!(store.photos[&second].original.dimensions(), (40, 50));
        let third = store.insert(PhotoData {
            original: DynamicImage::new_rgb8(10, 10),
            mask: None,
            cutout: None,
        });
        assert!(third > second);
        assert!(!store.photos.contains_key(&first));
    }
    fn crop() -> Crop {
        Crop {
            adjustments: tone::Tone::default(),
            paper: sheet::Paper::default(),
            rotation: 0.0,
            remove_background: false,
            background: default_background(),
            x: 0.0,
            y: 0.0,
            width: 1.0,
            height: 1.0,
            width_mm: 35.0,
            height_mm: 45.0,
            dpi: 300,
            gap_mm: 3.0,
        }
    }
    #[test]
    fn photo_and_sheet_dimensions() {
        let img = DynamicImage::new_rgb8(700, 900);
        assert_eq!(
            render(&img, &crop(), false).unwrap().dimensions(),
            (413, 531)
        );
        assert_eq!(
            render(&img, &crop(), true).unwrap().dimensions(),
            (1200, 1800)
        );
    }
    #[test]
    fn single_sheet_respects_paper_size_and_all_margins() {
        let mut c = crop();
        c.paper = sheet::Paper {
            width_mm: 210.0,
            height_mm: 297.0,
            left_mm: 10.0,
            right_mm: 20.0,
            top_mm: 15.0,
            bottom_mm: 5.0,
            ..sheet::Paper::default()
        };
        let output = render(&DynamicImage::new_rgb8(70, 90), &c, true)
            .unwrap()
            .to_rgb8();
        assert_eq!(output.dimensions(), (2480, 3508));
        assert_eq!(output.get_pixel(0, 0).0, [255, 255, 255]);
        assert_eq!(output.get_pixel(118, 177).0, [0, 0, 0]);
        assert_eq!(output.get_pixel(2479, 3507).0, [255, 255, 255]);
        c.paper.left_mm = 200.0;
        assert!(render(&DynamicImage::new_rgb8(70, 90), &c, true).is_err());
    }
    #[test]
    fn rejects_outside_crop() {
        let mut c = crop();
        c.x = 0.5;
        assert!(render(&DynamicImage::new_rgb8(700, 900), &c, false).is_err());
    }
    #[test]
    fn exported_png_has_print_metadata_and_white_margins() {
        let img = render(&DynamicImage::new_rgb8(700, 900), &crop(), true).unwrap();
        assert_eq!(img.to_rgb8().get_pixel(0, 0).0, [0, 0, 0]);
        assert_eq!(img.to_rgb8().get_pixel(1199, 1799).0, [255, 255, 255]);
        let mut bytes = Vec::new();
        encode_png(&mut bytes, &img, 300).unwrap();
        let decoder = png::Decoder::new(Cursor::new(&bytes));
        let reader = decoder.read_info().unwrap();
        assert_eq!((reader.info().width, reader.info().height), (1200, 1800));
        let density = reader.info().pixel_dims.unwrap();
        assert_eq!(density.xppu, 11811);
        assert_eq!(density.unit, png::Unit::Meter);
        assert_eq!(
            image::load_from_memory(&bytes).unwrap().dimensions(),
            (1200, 1800)
        );
    }
    #[test]
    fn transparent_photo_exports_on_white() {
        let img = render(&DynamicImage::new_rgba8(700, 900), &crop(), false).unwrap();
        assert_eq!(img.to_rgb8().get_pixel(0, 0).0, [255, 255, 255]);
    }
    #[test]
    fn rotation_maps_pixels_and_dimensions() {
        let img = DynamicImage::ImageRgb8(image::RgbImage::from_fn(2, 3, |x, y| {
            image::Rgb([x as u8, y as u8, 0])
        }));
        let turn = rotated(&img, 90.0).unwrap().to_rgb8();
        assert_eq!(turn.dimensions(), (3, 2));
        assert_eq!(turn.get_pixel(2, 0).0, [0, 0, 0]);
        let restored = rotated(&rotated(&img, 90.0).unwrap(), 270.0).unwrap();
        assert_eq!(restored.to_rgb8(), img.to_rgb8());
    }
    #[test]
    fn colored_backgrounds_keep_sheet_gaps_white() {
        for color in ["blue", "red"] {
            let mut c = crop();
            c.background = color.into();
            c.rotation = 90.0;
            let photo = render(&DynamicImage::new_rgba8(700, 900), &c, false)
                .unwrap()
                .to_rgb8();
            assert_eq!(
                photo.get_pixel(100, 100).0,
                background_color(color).unwrap()
            );
            let sheet = render(&DynamicImage::new_rgba8(700, 900), &c, true)
                .unwrap()
                .to_rgb8();
            assert_eq!(sheet.get_pixel(430, 10).0, [255, 255, 255]);
            assert_eq!(
                sheet.get_pixel(200, 200).0,
                background_color(color).unwrap()
            );
        }
    }
    #[test]
    fn arbitrary_rotation_preserves_center_and_has_transparent_corners() {
        let img = DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
            101,
            81,
            image::Rgba([240, 50, 20, 255]),
        ));
        let result = rotated(&img, 12.5).unwrap().to_rgba8();
        let angle = 12.5_f64.to_radians();
        assert_eq!(
            result.dimensions(),
            (
                (101.0 * angle.cos() + 81.0 * angle.sin()).ceil() as u32,
                (101.0 * angle.sin() + 81.0 * angle.cos()).ceil() as u32
            )
        );
        assert_eq!(result.get_pixel(0, 0)[3], 0);
        assert_eq!(
            result.get_pixel(result.width() / 2, result.height() / 2).0,
            [240, 50, 20, 255]
        );
        // Interpolated edges retain color rather than picking up black halos.
        let edge = result.pixels().find(|p| p[3] > 0 && p[3] < 255).unwrap();
        assert_eq!([edge[0], edge[1], edge[2]], [240, 50, 20]);
        assert!(rotated(&img, f64::NAN).is_err());
        let mut c = crop();
        c.rotation = -12.5;
        assert_eq!(render(&img, &c, false).unwrap().dimensions(), (413, 531));
    }
}

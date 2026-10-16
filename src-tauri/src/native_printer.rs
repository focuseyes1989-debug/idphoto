use crate::sheet::Paper;
use serde::Serialize;
use std::{collections::HashMap, sync::Mutex};
use windows_sys::Win32::{
    Foundation::GetLastError,
    Graphics::{Gdi::*, Printing::*},
    Storage::Xps::*,
};

#[derive(Default)]
pub struct PrinterSettings(pub Mutex<HashMap<String, Vec<u8>>>);
#[derive(Serialize)]
pub struct Printer {
    pub name: String,
    pub is_default: bool,
    pub network: bool,
}
#[derive(Serialize)]
pub struct PaperSize {
    pub width_mm: f64,
    pub height_mm: f64,
}
fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(Some(0)).collect()
}
unsafe fn text(ptr: *const u16) -> String {
    if ptr.is_null() {
        return String::new();
    }
    let mut len = 0;
    while *ptr.add(len) != 0 {
        len += 1;
    }
    String::from_utf16_lossy(std::slice::from_raw_parts(ptr, len))
}
fn error(action: &str) -> String {
    let code = unsafe { GetLastError() };
    if code == 5 {
        format!("{action}: Access denied (Windows error 5). Sign in to the print server with an account allowed to print; then retry the connection.")
    } else if code == 0 {
        format!("{action}: printer driver rejected the request without a Windows error code. Check or reinstall this printer driver.")
    } else {
        format!(
            "{action}: {} (Windows error {code})",
            std::io::Error::from_raw_os_error(code as i32)
        )
    }
}
struct Buffer {
    data: Vec<u64>,
    len: usize,
}
impl Buffer {
    fn new(len: usize) -> Self {
        Self {
            data: vec![0; len.div_ceil(8)],
            len,
        }
    }
    fn ptr(&mut self) -> *mut u8 {
        self.data.as_mut_ptr().cast()
    }
    fn bytes(&self) -> Vec<u8> {
        unsafe { std::slice::from_raw_parts(self.data.as_ptr().cast(), self.len).to_vec() }
    }
    fn from_bytes(bytes: &[u8]) -> Self {
        let mut buffer = Self::new(bytes.len());
        unsafe {
            std::ptr::copy_nonoverlapping(bytes.as_ptr(), buffer.ptr(), bytes.len());
        }
        buffer
    }
}
struct Handle(PRINTER_HANDLE);
impl Drop for Handle {
    fn drop(&mut self) {
        unsafe {
            ClosePrinter(self.0);
        }
    }
}
fn open(name: &str) -> Result<Handle, String> {
    if name.is_empty() || name.contains('\0') {
        return Err("Select a valid printer".into());
    }
    let mut handle = PRINTER_HANDLE::default();
    if unsafe { OpenPrinterW(wide(name).as_ptr(), &mut handle, std::ptr::null()) } == 0 {
        return Err(error("Opening printer"));
    }
    Ok(Handle(handle))
}
struct Dc(HDC);
impl Drop for Dc {
    fn drop(&mut self) {
        unsafe {
            DeleteDC(self.0);
        }
    }
}
fn dc(name: &str, mode: &mut Buffer) -> Result<Dc, String> {
    let value = unsafe {
        CreateDCW(
            wide("WINSPOOL").as_ptr(),
            wide(name).as_ptr(),
            std::ptr::null(),
            mode.ptr().cast(),
        )
    };
    if value.is_null() {
        return Err(error("Reading printer settings"));
    }
    Ok(Dc(value))
}
fn dimensions(dc: HDC) -> Result<PaperSize, String> {
    let (x, y, w, h) = unsafe {
        (
            GetDeviceCaps(dc, LOGPIXELSX as i32),
            GetDeviceCaps(dc, LOGPIXELSY as i32),
            GetDeviceCaps(dc, PHYSICALWIDTH as i32),
            GetDeviceCaps(dc, PHYSICALHEIGHT as i32),
        )
    };
    if x <= 0 || y <= 0 || w <= 0 || h <= 0 {
        return Err("Printer reported invalid paper dimensions".into());
    }
    Ok(PaperSize {
        width_mm: w as f64 / x as f64 * 25.4,
        height_mm: h as f64 / y as f64 * 25.4,
    })
}
fn mode(name: &str, handle: &Handle, saved: Option<Vec<u8>>) -> Result<Buffer, String> {
    let printer = wide(name);
    let len = unsafe {
        DocumentPropertiesW(
            std::ptr::null_mut(),
            handle.0,
            printer.as_ptr(),
            std::ptr::null_mut(),
            std::ptr::null(),
            0,
        )
    };
    if len < std::mem::size_of::<DEVMODEW>() as i32 {
        return Err(error("Reading printer driver properties"));
    }
    let mut result = Buffer::new(len as usize);
    if unsafe {
        DocumentPropertiesW(
            std::ptr::null_mut(),
            handle.0,
            printer.as_ptr(),
            result.ptr().cast(),
            std::ptr::null(),
            DM_OUT_BUFFER,
        )
    } != 1
    {
        return Err(error("Reading printer driver defaults"));
    }
    if let Some(saved) = saved {
        if saved.len() == result.len {
            result = Buffer::from_bytes(&saved);
        }
    }
    Ok(result)
}
pub fn enumerate() -> Result<Vec<Printer>, String> {
    unsafe {
        let (mut needed, mut count) = (0, 0);
        EnumPrintersW(
            PRINTER_ENUM_LOCAL | PRINTER_ENUM_CONNECTIONS,
            std::ptr::null(),
            4,
            std::ptr::null_mut(),
            0,
            &mut needed,
            &mut count,
        );
        if needed == 0 {
            if GetLastError() == 0 {
                return Ok(Vec::new());
            }
            return Err(error("Listing printers"));
        }
        let mut buffer = Buffer::new(needed as usize);
        if EnumPrintersW(
            PRINTER_ENUM_LOCAL | PRINTER_ENUM_CONNECTIONS,
            std::ptr::null(),
            4,
            buffer.ptr(),
            needed,
            &mut needed,
            &mut count,
        ) == 0
        {
            return Err(error("Listing printers"));
        }
        let mut size = 0;
        GetDefaultPrinterW(std::ptr::null_mut(), &mut size);
        let mut default = vec![0; size as usize];
        let default = if size > 0 && GetDefaultPrinterW(default.as_mut_ptr(), &mut size) != 0 {
            text(default.as_ptr())
        } else {
            String::new()
        };
        let mut printers = Vec::new();
        for n in 0..count as usize {
            let info = &*buffer.ptr().cast::<PRINTER_INFO_4W>().add(n);
            let name = text(info.pPrinterName);
            printers.push(Printer {
                is_default: name == default,
                network: name.starts_with("\\\\"),
                name,
            });
        }
        printers.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        Ok(printers)
    }
}
fn apply_paper(name: &str, mode: &mut Buffer, paper: &Paper) {
    unsafe {
        let width = (paper.width_mm.min(paper.height_mm) * 10.0).round() as i16;
        let height = (paper.width_mm.max(paper.height_mm) * 10.0).round() as i16;
        let count = DeviceCapabilitiesW(
            wide(name).as_ptr(),
            std::ptr::null(),
            DC_PAPERS,
            std::ptr::null_mut(),
            mode.ptr().cast(),
        );
        let mut paper_id = 0;
        if count > 0 {
            let mut ids = vec![0u16; count as usize];
            let mut sizes = vec![windows_sys::Win32::Foundation::POINT::default(); count as usize];
            if DeviceCapabilitiesW(
                wide(name).as_ptr(),
                std::ptr::null(),
                DC_PAPERS,
                ids.as_mut_ptr(),
                mode.ptr().cast(),
            ) == count
                && DeviceCapabilitiesW(
                    wide(name).as_ptr(),
                    std::ptr::null(),
                    DC_PAPERSIZE,
                    sizes.as_mut_ptr().cast(),
                    mode.ptr().cast(),
                ) == count
            {
                for (id, size) in ids.into_iter().zip(sizes) {
                    if (size.x - width as i32).abs() <= 2 && (size.y - height as i32).abs() <= 2 {
                        paper_id = id as i16;
                        break;
                    }
                }
            }
        }
        let dev = &mut *mode.ptr().cast::<DEVMODEW>();
        dev.dmFields |=
            DM_ORIENTATION | DM_PAPERSIZE | DM_PAPERWIDTH | DM_PAPERLENGTH | DM_COPIES | DM_SCALE;
        dev.dmFields &= !DM_FORMNAME;
        let settings = &mut dev.Anonymous1.Anonymous1;
        settings.dmOrientation = if paper.width_mm > paper.height_mm {
            DMORIENT_LANDSCAPE as i16
        } else {
            DMORIENT_PORTRAIT as i16
        };
        settings.dmPaperSize = if paper_id > 0 {
            paper_id
        } else {
            DMPAPER_USER as i16
        };
        settings.dmPaperWidth = width;
        settings.dmPaperLength = height;
        settings.dmCopies = 1;
        settings.dmScale = 100;
    }
}
fn validate_mode(name: &str, handle: &Handle, mode: &mut Buffer) -> Result<(), String> {
    let mut output = Buffer::new(mode.len);
    if unsafe {
        DocumentPropertiesW(
            std::ptr::null_mut(),
            handle.0,
            wide(name).as_ptr(),
            output.ptr().cast(),
            mode.ptr().cast(),
            DM_IN_BUFFER | DM_OUT_BUFFER,
        )
    } != 1
    {
        return Err(error("Validating printer settings"));
    }
    *mode = output;
    Ok(())
}
pub fn properties(
    name: &str,
    hwnd: isize,
    paper: &Paper,
    saved: Option<Vec<u8>>,
) -> Result<Option<(Vec<u8>, PaperSize)>, String> {
    paper.bounds(300)?;
    let handle = open(name)?;
    let mut mode = mode(name, &handle, saved)?;
    apply_paper(name, &mut mode, paper);
    validate_mode(name, &handle, &mut mode)?;
    let mut output = Buffer::new(mode.len);
    let result = unsafe {
        DocumentPropertiesW(
            hwnd as _,
            handle.0,
            wide(name).as_ptr(),
            output.ptr().cast(),
            mode.ptr().cast(),
            DM_IN_BUFFER | DM_OUT_BUFFER | DM_IN_PROMPT,
        )
    };
    if result == 2 {
        return Ok(None);
    }
    if result != 1 {
        return Err(error("Opening Printer Properties"));
    }
    let context = dc(name, &mut output)?;
    let paper = dimensions(context.0)?;
    Ok(Some((output.bytes(), paper)))
}
pub fn reconnect(name: &str) -> Result<String, String> {
    if !name.starts_with("\\\\") {
        return Err("Reconnect is for shared server printers".into());
    }
    if unsafe { AddPrinterConnectionW(wide(name).as_ptr()) } == 0 {
        return Err(error("Reconnecting shared printer"));
    }
    let _handle = open(name)?;
    Ok("Printer connection is available".into())
}
pub fn check(name: &str) -> Result<String, String> {
    let handle = open(name)?;
    let mut mode = mode(name, &handle, None)?;
    let context = dc(name, &mut mode)?;
    let _ = dimensions(context.0)?;
    Ok("Printer connection and driver are available".into())
}
#[cfg(test)]
pub fn print_image(
    name: &str,
    copies: u32,
    paper: &Paper,
    image: &image::DynamicImage,
    saved: Option<Vec<u8>>,
) -> Result<i32, String> {
    print_pages(name,copies,paper,1,|_|Ok(image.clone()),saved)
}
pub fn print_pages(name:&str,copies:u32,paper:&Paper,page_count:usize,mut render_page:impl FnMut(usize)->Result<image::DynamicImage,String>,saved:Option<Vec<u8>>)->Result<i32,String>{
    if page_count==0||page_count>100{return Err("Invalid print page count".into());}
    if !(1..=100).contains(&copies) {
        return Err("Copies must be between 1 and 100".into());
    }
    paper.bounds(300)?;
    let handle = open(name)?;
    let mut mode = mode(name, &handle, saved)?;
    apply_paper(name, &mut mode, paper);
    validate_mode(name, &handle, &mut mode)?;
    let context = dc(name, &mut mode)?;
    let actual = dimensions(context.0)?;
    if (actual.width_mm - paper.width_mm).abs() > 2.0
        || (actual.height_mm - paper.height_mm).abs() > 2.0
    {
        return Err(format!("Driver selected {:.1} x {:.1} mm instead of {:.1} x {:.1} mm. Choose a supported paper in Printer Properties.",actual.width_mm,actual.height_mm,paper.width_mm,paper.height_mm));
    }
    let first=render_page(0)?;
    unsafe {
        let title = wide("ID Photo Studio - Photo sheet");
        let mut info = DOCINFOW::default();
        info.cbSize = std::mem::size_of::<DOCINFOW>() as i32;
        info.lpszDocName = title.as_ptr();
        let job = StartDocW(context.0, &info);
        if job <= 0 {
            return Err(error("Starting print job"));
        }
        let result = (|| {
            let dpi_x = GetDeviceCaps(context.0, LOGPIXELSX as i32);
            let dpi_y = GetDeviceCaps(context.0, LOGPIXELSY as i32);
            let x = -GetDeviceCaps(context.0, PHYSICALOFFSETX as i32);
            let y = -GetDeviceCaps(context.0, PHYSICALOFFSETY as i32);
            let width = (paper.width_mm / 25.4 * dpi_x as f64).round() as i32;
            let height = (paper.height_mm / 25.4 * dpi_y as f64).round() as i32;
            SetStretchBltMode(context.0, HALFTONE as i32);
            for _ in 0..copies {
                for page in 0..page_count {
                let image=if page==0{first.clone()}else{render_page(page)?};
                let mut bgra=image.to_rgba8().into_raw();for pixel in bgra.chunks_exact_mut(4){pixel.swap(0,2);}
                let mut bitmap=BITMAPINFO::default();bitmap.bmiHeader.biSize=std::mem::size_of::<BITMAPINFOHEADER>() as u32;bitmap.bmiHeader.biWidth=image.width() as i32;bitmap.bmiHeader.biHeight=-(image.height() as i32);bitmap.bmiHeader.biPlanes=1;bitmap.bmiHeader.biBitCount=32;bitmap.bmiHeader.biCompression=BI_RGB;
                if StartPage(context.0) <= 0 {
                    return Err(error("Starting print page"));
                }
                let rows = StretchDIBits(
                    context.0,
                    x,
                    y,
                    width,
                    height,
                    0,
                    0,
                    image.width() as i32,
                    image.height() as i32,
                    bgra.as_ptr().cast(),
                    &bitmap,
                    DIB_RGB_COLORS,
                    SRCCOPY,
                );
                if rows == 0 || rows == -1 {
                    return Err(error("Drawing print page"));
                }
                if EndPage(context.0) <= 0 {
                    return Err(error("Finishing print page"));
                }
            }
            }
            if EndDoc(context.0) <= 0 {
                return Err(error("Submitting print job"));
            }
            Ok(job)
        })();
        if result.is_err() {
            AbortDoc(context.0);
        }
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn invalid_copies_and_paper_are_rejected_before_a_job_can_start() {
        let image = image::DynamicImage::new_rgb8(10, 10);
        assert!(print_image("", 0, &Paper::default(), &image, None).is_err());
        assert!(print_image("", 101, &Paper::default(), &image, None).is_err());
        let paper = Paper {
            width_mm: f64::NAN,
            ..Default::default()
        };
        assert!(print_image("", 1, &paper, &image, None).is_err());
    }
    #[test]
    #[ignore = "Read-only local Windows printer diagnostics; no jobs are submitted"]
    fn diagnose_printers() {
        let printers = enumerate().unwrap();
        println!("Installed printers: {}", printers.len());
        for printer in printers {
            println!("{}: {:?}", printer.name, check(&printer.name));
        }
    }
    #[test]
    #[ignore = "Explicit reconnection of ID_PHOTO_RECONNECT_PRINTER; no jobs are submitted"]
    fn reconnect_selected_printer() {
        let printer =
            std::env::var("ID_PHOTO_RECONNECT_PRINTER").expect("Set a shared printer path");
        println!("Reconnect {}: {:?}", printer, reconnect(&printer));
        println!("Recheck {}: {:?}", printer, check(&printer));
    }
    #[test]
    #[ignore = "Read-only Microsoft Print to PDF driver paper negotiation; no jobs are submitted"]
    fn pdf_driver_supports_actual_paper_dimensions() {
        let name = "Microsoft Print to PDF";
        let handle = open(name).unwrap();
        for (width, height) in [(101.6, 152.4), (297.0, 210.0)] {
            let paper = Paper {
                width_mm: width,
                height_mm: height,
                ..Default::default()
            };
            let mut settings = mode(name, &handle, None).unwrap();
            apply_paper(name, &mut settings, &paper);
            validate_mode(name, &handle, &mut settings).unwrap();
            let context = dc(name, &mut settings).unwrap();
            let actual = dimensions(context.0).unwrap();
            println!(
                "Requested {width} x {height} mm; driver {:.2} x {:.2} mm",
                actual.width_mm, actual.height_mm
            );
            assert!((actual.width_mm - width).abs() < 2.0);
            assert!((actual.height_mm - height).abs() < 2.0);
        }
    }
}

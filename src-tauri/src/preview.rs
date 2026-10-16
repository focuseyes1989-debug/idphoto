use base64::{engine::general_purpose::STANDARD, Engine};
use image::{metadata::Orientation, DynamicImage, ImageDecoder, ImageEncoder, ImageFormat};
use serde::Serialize;
use std::{io::Cursor, path::Path, time::Instant};

const PREVIEW_EDGE: u32 = 1600;

#[derive(Debug, Default, Serialize)]
pub struct LoadTimings {
    pub read_ms: f64,
    pub decode_ms: f64,
    pub orient_ms: f64,
    pub resize_ms: f64,
    pub encode_ms: f64,
    pub base64_ms: f64,
    pub total_ms: f64,
    pub preview_bytes: usize,
    pub reused_original: bool,
}
fn elapsed(start: Instant) -> f64 {
    start.elapsed().as_secs_f64() * 1000.0
}

pub fn load(path: &Path) -> Result<(DynamicImage, String, LoadTimings), String> {
    let total = Instant::now();
    let mut timings = LoadTimings::default();
    let start = Instant::now();
    if std::fs::metadata(path).map_err(|e| e.to_string())?.len() > 512 * 1024 * 1024 {
        return Err("Photo file exceeds the 512 MB limit".into());
    }
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    timings.read_ms = elapsed(start);
    let start = Instant::now();
    let mut reader = image::ImageReader::new(Cursor::new(&bytes))
        .with_guessed_format()
        .map_err(|e| e.to_string())?;
    let format = reader.format().ok_or("Unknown photo format")?;
    let mut limits = image::Limits::default();
    limits.max_alloc = Some(512 * 1024 * 1024);
    reader.limits(limits);
    let mut decoder = reader.into_decoder().map_err(|e| e.to_string())?;
    let orientation = decoder.orientation().map_err(|e| e.to_string())?;
    let mut original = DynamicImage::from_decoder(decoder).map_err(|e| e.to_string())?;
    timings.decode_ms = elapsed(start);
    let start = Instant::now();
    original.apply_orientation(orientation);
    timings.orient_ms = elapsed(start);
    let mime = match format {
        ImageFormat::Jpeg => "image/jpeg",
        ImageFormat::Png => "image/png",
        ImageFormat::WebP => "image/webp",
        _ => return Err("Unsupported photo format".into()),
    };
    // Avoid upscaling and a full encode/transfer of an unnecessarily larger preview.
    let (mime, encoded) = if original.width() <= PREVIEW_EDGE
        && original.height() <= PREVIEW_EDGE
        && orientation == Orientation::NoTransforms
    {
        timings.reused_original = true;
        (mime, bytes)
    } else {
        let start = Instant::now();
        let preview = if original.width() > PREVIEW_EDGE || original.height() > PREVIEW_EDGE {
            original.thumbnail(PREVIEW_EDGE, PREVIEW_EDGE)
        } else {
            original.clone()
        };
        timings.resize_ms = elapsed(start);
        let start = Instant::now();
        let mut encoded = Vec::new();
        let mime = if preview.color().has_alpha() {
            let rgba = preview.to_rgba8();
            image::codecs::png::PngEncoder::new_with_quality(
                &mut encoded,
                image::codecs::png::CompressionType::Fast,
                image::codecs::png::FilterType::NoFilter,
            )
            .write_image(
                &rgba,
                rgba.width(),
                rgba.height(),
                image::ExtendedColorType::Rgba8,
            )
            .map_err(|e| e.to_string())?;
            "image/png"
        } else {
            image::codecs::jpeg::JpegEncoder::new_with_quality(&mut encoded, 90)
                .encode_image(&preview.to_rgb8())
                .map_err(|e| e.to_string())?;
            "image/jpeg"
        };
        timings.encode_ms = elapsed(start);
        (mime, encoded)
    };
    timings.preview_bytes = encoded.len();
    let start = Instant::now();
    let data = format!("data:{mime};base64,{}", STANDARD.encode(encoded));
    timings.base64_ms = elapsed(start);
    timings.total_ms = elapsed(total);
    Ok((original, data, timings))
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Fixture(std::path::PathBuf);
    impl Fixture {
        fn new(name: &str, bytes: &[u8]) -> Self {
            let dir = std::env::temp_dir()
                .join(format!("id-photo-preview-{}-{name}", std::process::id()));
            std::fs::create_dir_all(&dir).unwrap();
            let path = dir.join("photo");
            std::fs::write(&path, bytes).unwrap();
            Self(path)
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(self.0.parent().unwrap());
        }
    }
    fn png(img: &DynamicImage) -> Vec<u8> {
        let mut bytes = Cursor::new(Vec::new());
        img.write_to(&mut bytes, ImageFormat::Png).unwrap();
        bytes.into_inner()
    }
    fn decode_preview(data: &str) -> DynamicImage {
        image::load_from_memory(&STANDARD.decode(data.split_once(',').unwrap().1).unwrap()).unwrap()
    }
    #[test]
    fn small_preview_reuses_source_and_preserves_transparency() {
        let img = DynamicImage::ImageRgba8(image::RgbaImage::from_fn(41, 53, |x, y| {
            image::Rgba([x as u8, y as u8, 127, if x < 20 { 0 } else { 190 }])
        }));
        let bytes = png(&img);
        let file = Fixture::new("small", &bytes);
        let (original, preview, timing) = load(&file.0).unwrap();
        assert!(timing.reused_original);
        assert_eq!(timing.resize_ms, 0.0);
        assert_eq!(timing.encode_ms, 0.0);
        assert_eq!(
            STANDARD.decode(preview.split_once(',').unwrap().1).unwrap(),
            bytes
        );
        assert_eq!(decode_preview(&preview).to_rgba8(), img.to_rgba8());
        assert_eq!(original.to_rgba8(), img.to_rgba8());
    }
    #[test]
    fn large_preview_is_bounded_and_full_resolution_original_is_unchanged() {
        let img = DynamicImage::new_rgb8(1800, 600);
        let file = Fixture::new("large", &png(&img));
        let (original, preview, timing) = load(&file.0).unwrap();
        assert!(!timing.reused_original);
        assert!(preview.starts_with("data:image/jpeg;"));
        assert_eq!((original.width(), original.height()), (1800, 600));
        assert_eq!(original.to_rgb8(), img.to_rgb8());
        let decoded = decode_preview(&preview);
        assert!(decoded.width() <= 1600 && decoded.height() <= 1600);
    }
    #[test]
    fn rotated_exif_is_applied_once_and_preview_has_no_stale_orientation() {
        let mut bytes = Vec::new();
        let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut bytes, 90);
        // Little-endian TIFF, IFD0 Orientation = 6 (90 degrees clockwise).
        encoder
            .set_exif_metadata(vec![
                73, 73, 42, 0, 8, 0, 0, 0, 1, 0, 18, 1, 3, 0, 1, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0,
            ])
            .unwrap();
        encoder
            .encode_image(&DynamicImage::new_rgb8(40, 60))
            .unwrap();
        let file = Fixture::new("orientation", &bytes);
        let (original, preview, timing) = load(&file.0).unwrap();
        assert!(!timing.reused_original);
        assert_eq!((original.width(), original.height()), (60, 40));
        let decoded = decode_preview(&preview);
        assert_eq!((decoded.width(), decoded.height()), (60, 40));
    }
    #[test]
    fn large_transparent_preview_keeps_alpha() {
        let img = DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
            1601,
            30,
            image::Rgba([40, 80, 120, 64]),
        ));
        let file = Fixture::new("alpha", &png(&img));
        let (_, preview, timing) = load(&file.0).unwrap();
        assert!(!timing.reused_original);
        assert!(preview.starts_with("data:image/png;"));
        assert_eq!(decode_preview(&preview).to_rgba8().get_pixel(10, 10)[3], 64);
    }
}

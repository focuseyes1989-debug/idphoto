use anyhow::{anyhow, ensure};
use image::{imageops::FilterType, DynamicImage, GrayImage, ImageBuffer};
use tract_onnx::prelude::*;

/// U²-Net small model, running locally on the CPU. No photo upload or Python runtime.
#[cfg(test)]
pub fn remove_background(image: &DynamicImage) -> Result<DynamicImage, String> {
    apply_strength(image, &generate_mask(image)?, 100)
}
pub fn generate_mask(image: &DynamicImage) -> Result<GrayImage, String> {
    infer(image).map_err(|e| format!("Background removal failed: {e:#}"))
}
pub fn apply_strength(
    image: &DynamicImage,
    mask: &GrayImage,
    strength: u8,
) -> Result<DynamicImage, String> {
    if strength > 100 {
        return Err("Strength must be between 0 and 100".into());
    }
    Ok(DynamicImage::ImageRgba8(refine_cutout_at_strength(
        image, mask, strength,
    )))
}

fn infer(image: &DynamicImage) -> TractResult<GrayImage> {
    let mut model_bytes =
        std::io::Cursor::new(include_bytes!("../../models/u2netp.onnx").as_slice());
    let mut model = tract_onnx::onnx().model_for_read(&mut model_bytes)?;
    model.set_input_fact(0, f32::fact([1, 3, 320, 320]).into())?;
    let output = model.output_outlets()?[0];
    model.select_output_outlets(&[output])?;
    let model = model.into_optimized()?.into_runnable()?;
    let small = image.resize_exact(320, 320, FilterType::Lanczos3).to_rgb8();
    let maximum = small.as_raw().iter().copied().max().unwrap_or(1).max(1) as f32;
    let mean = [0.485, 0.456, 0.406];
    let std = [0.229, 0.224, 0.225];
    let input = tract_ndarray::Array4::from_shape_fn((1, 3, 320, 320), |(_, c, y, x)| {
        (small.get_pixel(x as u32, y as u32)[c] as f32 / maximum - mean[c]) / std[c]
    });
    let outputs = model.run(tvec!(input.into_tensor().into()))?;
    let values = outputs[0].to_plain_array_view::<f32>()?;
    ensure!(
        values.len() == 320 * 320,
        "Unexpected segmentation mask dimensions"
    );
    ensure!(
        values.iter().all(|v| v.is_finite()),
        "Model returned an invalid mask"
    );
    let min = values.iter().copied().fold(f32::INFINITY, f32::min);
    let max = values.iter().copied().fold(f32::NEG_INFINITY, f32::max);
    ensure!(max - min > 1e-6, "No subject detected. Try another photo.");
    let mask: GrayImage = ImageBuffer::from_raw(
        320,
        320,
        values
            .iter()
            .map(|v| (((v - min) / (max - min)).clamp(0.0, 1.0) * 255.0).round() as u8)
            .collect(),
    )
    .ok_or_else(|| anyhow!("Invalid mask buffer"))?;
    let mask = image::imageops::resize(&mask, image.width(), image.height(), FilterType::Lanczos3);
    Ok(mask)
}

fn smoothstep(low: f32, high: f32, value: f32) -> f32 {
    let t = ((value - low) / (high - low)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}
// Linear-time box means for a full-resolution, edge-aware guided matte.
fn box_mean(values: &[f32], w: usize, h: usize, r: usize) -> Vec<f32> {
    let mut horizontal = vec![0.0; w * h];
    let mut output = vec![0.0; w * h];
    for y in 0..h {
        let mut sum = 0.0;
        let (mut left, mut right) = (0, 0);
        for x in 0..w {
            let end = (x + r + 1).min(w);
            while right < end {
                sum += values[y * w + right];
                right += 1;
            }
            let start = x.saturating_sub(r);
            while left < start {
                sum -= values[y * w + left];
                left += 1;
            }
            horizontal[y * w + x] = sum / (right - left) as f32;
        }
    }
    for x in 0..w {
        let mut sum = 0.0;
        let (mut top, mut bottom) = (0, 0);
        for y in 0..h {
            let end = (y + r + 1).min(h);
            while bottom < end {
                sum += horizontal[bottom * w + x];
                bottom += 1;
            }
            let start = y.saturating_sub(r);
            while top < start {
                sum -= horizontal[top * w + x];
                top += 1;
            }
            output[y * w + x] = sum / (bottom - top) as f32;
        }
    }
    output
}
fn guided_matte(rgb: &image::RgbImage, mask: &GrayImage) -> Vec<f32> {
    if rgb.width().max(rgb.height()) > 1600 {
        let scale = 1600.0 / rgb.width().max(rgb.height()) as f64;
        let (w, h) = (
            (rgb.width() as f64 * scale).round().max(1.0) as u32,
            (rgb.height() as f64 * scale).round().max(1.0) as u32,
        );
        let small = image::imageops::resize(rgb, w, h, FilterType::Triangle);
        let small_mask = image::imageops::resize(mask, w, h, FilterType::Triangle);
        let matte = image::ImageBuffer::<image::Luma<f32>, Vec<f32>>::from_raw(
            w,
            h,
            guided_matte(&small, &small_mask),
        )
        .expect("Guided matte dimensions");
        return image::imageops::resize(&matte, rgb.width(), rgb.height(), FilterType::Triangle)
            .into_raw();
    }
    let (w, h) = (rgb.width() as usize, rgb.height() as usize);
    let r = ((w.max(h) / 160).clamp(3, 16)).min(w.min(h).saturating_sub(1));
    let guide: Vec<f32> = rgb
        .pixels()
        .map(|p| (0.299 * p[0] as f32 + 0.587 * p[1] as f32 + 0.114 * p[2] as f32) / 255.0)
        .collect();
    let alpha: Vec<f32> = mask.pixels().map(|p| p[0] as f32 / 255.0).collect();
    let mean_i = box_mean(&guide, w, h, r);
    let mean_p = box_mean(&alpha, w, h, r);
    let ii: Vec<_> = guide.iter().map(|v| v * v).collect();
    let ip: Vec<_> = guide.iter().zip(&alpha).map(|(a, b)| a * b).collect();
    let corr_i = box_mean(&ii, w, h, r);
    let corr_ip = box_mean(&ip, w, h, r);
    let a: Vec<_> = (0..guide.len())
        .map(|i| {
            (corr_ip[i] - mean_i[i] * mean_p[i])
                / ((corr_i[i] - mean_i[i] * mean_i[i]).max(0.0) + 0.001)
        })
        .collect();
    let b: Vec<_> = (0..guide.len())
        .map(|i| mean_p[i] - a[i] * mean_i[i])
        .collect();
    let mean_a = box_mean(&a, w, h, r);
    let mean_b = box_mean(&b, w, h, r);
    (0..guide.len())
        .map(|i| {
            let refined = (mean_a[i] * guide[i] + mean_b[i]).clamp(0.0, 1.0);
            // Keep confident foreground/background, refine only the transition.
            if alpha[i] < 0.01 {
                0.0
            } else if alpha[i] > 0.99 {
                1.0
            } else {
                smoothstep(0.03, 0.97, refined)
            }
        })
        .collect()
}
// Activate chroma cleanup only when the AI-confirmed border consistently contains
// a saturated green/blue screen. Ordinary portraits never use color keying.
fn screen_channel(rgb: &image::RgbImage, mask: &GrayImage) -> Option<usize> {
    let (w, h) = rgb.dimensions();
    let band = (w.min(h) / 30).max(1);
    let mut total = 0;
    let mut votes = [0usize; 2];
    for y in 0..h {
        for x in 0..w {
            if x >= band && x < w - band && y >= band && y < h - band {
                continue;
            }
            if mask.get_pixel(x, y)[0] > 40 {
                continue;
            }
            total += 1;
            let p = rgb.get_pixel(x, y);
            for (c, v) in [(1, 0), (2, 1)] {
                let other = if c == 1 {
                    p[0].max(p[2])
                } else {
                    p[0].max(p[1])
                };
                if p[c] > 60
                    && p[c] as f32 - other as f32 > 35.0
                    && (p[c] as f32 - other as f32) / p[c] as f32 > 0.28
                {
                    votes[v] += 1;
                }
            }
        }
    }
    if total < 32 {
        return None;
    }
    if votes[0] as f32 / total as f32 > 0.7 {
        Some(1)
    } else if votes[1] as f32 / total as f32 > 0.7 {
        Some(2)
    } else {
        None
    }
}
#[cfg(test)]
fn refine_cutout(image: &DynamicImage, mask: &GrayImage) -> image::RgbaImage {
    refine_cutout_at_strength(image, mask, 100)
}
fn refine_cutout_at_strength(
    image: &DynamicImage,
    mask: &GrayImage,
    strength: u8,
) -> image::RgbaImage {
    let strength = strength as f32 / 100.0;
    let rgb = image.to_rgb8();
    let alpha = guided_matte(&rgb, mask);
    let screen = screen_channel(&rgb, mask);
    let proximity = screen.map(|_| {
        let background: Vec<_> = mask
            .pixels()
            .map(|p| if p[0] < 250 { 1.0 } else { 0.0 })
            .collect();
        box_mean(
            &background,
            rgb.width() as usize,
            rgb.height() as usize,
            (rgb.width().max(rgb.height()) as usize / 16).clamp(3, 48),
        )
    });
    let mut result = image.to_rgba8();
    for (i, (_, _, p)) in result.enumerate_pixels_mut().enumerate() {
        let mut matte = if strength == 1.0 {
            alpha[i]
        } else {
            alpha[i].powf(0.7 + 0.3 * strength)
        };
        if let Some(c) = screen {
            let other = if c == 1 {
                p[0].max(p[2])
            } else {
                p[0].max(p[1])
            } as f32;
            let dominant = p[c] as f32;
            let excess = (dominant - other).max(0.0);
            let saturation = excess / dominant.max(1.0);
            // Saturated screen remnants disappear even where the small AI mask
            // incorrectly included a band of background around dark hair.
            // Screen cloth in shadow is less saturated than the border sample.
            // Remove it decisively rather than leaving a translucent gray veil.
            let key = strength
                * smoothstep(0.18 - 0.06 * strength, 0.65 - 0.23 * strength, saturation)
                * smoothstep(12.0 - 4.0 * strength, 40.0 - 12.0 * strength, excess);
            let boundary = mask.as_raw()[i] < 250
                || proximity.as_ref().is_some_and(|values| values[i] > 0.015);
            if boundary {
                matte *= 1.0 - key;
            }
            // Despill soft edges while leaving opaque foreground colors intact.
            if boundary && matte > 0.0 && key > 0.01 && excess > 0.0 {
                let strength = (1.0 - matte * 0.25).clamp(0.0, 1.0);
                p[c] = (dominant - excess * strength).round().clamp(0.0, 255.0) as u8;
            }
        }
        p[3] = (p[3] as f32 * matte).round().clamp(0.0, 255.0) as u8;
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn strength_preserves_hair_at_low_values_and_removes_screen_at_high_values() {
        let image = DynamicImage::ImageRgb8(image::RgbImage::from_fn(100, 100, |x, y| {
            if (30..70).contains(&x) && (20..80).contains(&y) {
                image::Rgb([190, 140, 110])
            } else {
                image::Rgb([40, 90, 45])
            }
        }));
        let mask = GrayImage::from_fn(100, 100, |x, y| {
            image::Luma([if (20..80).contains(&x) && (10..90).contains(&y) {
                255
            } else {
                0
            }])
        });
        let gentle = apply_strength(&image, &mask, 0).unwrap().to_rgba8();
        let strong = apply_strength(&image, &mask, 100).unwrap().to_rgba8();
        assert!(gentle.get_pixel(24, 50)[3] > strong.get_pixel(24, 50)[3]);
        assert_eq!(gentle.get_pixel(50, 50), strong.get_pixel(50, 50));
        assert!(apply_strength(&image, &mask, 101).is_err());
    }
    #[test]
    fn green_screen_cleanup_removes_halo_but_preserves_confident_subject() {
        let image = DynamicImage::ImageRgb8(image::RgbImage::from_fn(100, 100, |x, y| {
            if (30..70).contains(&x) && (20..80).contains(&y) {
                image::Rgb([190, 140, 110])
            } else {
                image::Rgb([20, 180, 35])
            }
        }));
        let mask = GrayImage::from_fn(100, 100, |x, y| {
            image::Luma([if (20..80).contains(&x) && (10..90).contains(&y) {
                255
            } else {
                0
            }])
        });
        let output = refine_cutout(&image, &mask);
        assert_eq!(output.get_pixel(24, 50)[3], 0);
        assert_eq!(output.get_pixel(50, 50).0, [190, 140, 110, 255]);
        // Darker, less saturated screen cloth must not remain as a gray veil.
        let mut shadow = image.to_rgb8();
        shadow.put_pixel(24, 50, image::Rgb([40, 90, 45]));
        assert_eq!(
            refine_cutout(&DynamicImage::ImageRgb8(shadow), &mask).get_pixel(24, 50)[3],
            0
        );
        let mut green_subject = image.to_rgb8();
        green_subject.put_pixel(50, 50, image::Rgb([20, 180, 35]));
        assert_eq!(
            refine_cutout(&DynamicImage::ImageRgb8(green_subject), &mask)
                .get_pixel(50, 50)
                .0,
            [20, 180, 35, 255]
        );
        let ordinary = DynamicImage::ImageRgb8(image::RgbImage::from_pixel(
            100,
            100,
            image::Rgb([200, 200, 200]),
        ));
        assert_eq!(screen_channel(&ordinary.to_rgb8(), &mask), None);
    }
    #[test]
    fn cleanup_preserves_original_transparency() {
        let image = DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
            10,
            10,
            image::Rgba([120, 100, 80, 100]),
        ));
        let mask = GrayImage::from_pixel(10, 10, image::Luma([255]));
        assert_eq!(refine_cutout(&image, &mask).get_pixel(5, 5)[3], 100);
    }
    #[test]
    #[ignore = "Manual local visual QA; requires ID_PHOTO_QA_SOURCE"]
    fn visual_background_qa() {
        let mut source = image::open(std::env::var("ID_PHOTO_QA_SOURCE").unwrap()).unwrap();
        if let Ok(region) = std::env::var("ID_PHOTO_QA_CROP") {
            let parts: Vec<u32> = region.split(',').map(|s| s.parse().unwrap()).collect();
            source = source.crop_imm(parts[0], parts[1], parts[2], parts[3]);
        }
        let cutout = remove_background(&source).unwrap().to_rgba8();
        let output = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("target/qa");
        std::fs::create_dir_all(&output).unwrap();
        source.save(output.join("background-source.png")).unwrap();
        cutout.save(output.join("background-cutout.png")).unwrap();
        let white = image::RgbImage::from_fn(cutout.width(), cutout.height(), |x, y| {
            let p = cutout.get_pixel(x, y);
            let a = p[3] as u32;
            image::Rgb(std::array::from_fn(|i| {
                ((p[i] as u32 * a + 255 * (255 - a) + 127) / 255) as u8
            }))
        });
        white.save(output.join("background-white.png")).unwrap();
    }
    #[test]
    fn bundled_model_produces_foreground_and_background() {
        let image =
            image::load_from_memory(include_bytes!("../../tests/fixtures/portrait.png")).unwrap();
        let result = remove_background(&image).unwrap().to_rgba8();
        assert_eq!(result.dimensions(), (700, 900));
        let transparent = result.pixels().filter(|p| p[3] < 32).count();
        let opaque = result.pixels().filter(|p| p[3] > 223).count();
        assert!(transparent > 10000, "Expected background pixels");
        assert!(opaque > 10000, "Expected foreground pixels");
    }
}

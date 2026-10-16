# Preview loading measurements

Measured locally on 2026-10-16 using the development profile used by `cargo run -p id-photo-editor`. Three sequential runs per file, warm filesystem cache; approximate median times. These are Rust file read/decode/orientation/resize/encode/base64 timings, excluding chooser interaction, IPC serialization, WebView decoding, and canvas drawing. They are not total click-to-visible latency guarantees.

| Photo dimensions and format | Previous pipeline | Optimized pipeline | Previous preview bytes | New preview bytes |
| --- | ---: | ---: | ---: | ---: |
| 413 x 531 PNG | 1,199 ms | 22 ms | 1,295,857 | 259,933 |
| 960 x 1280 JPEG | 1,674 ms | 375 ms | 1,796,538 | 145,584 |
| 1152 x 1365 PNG | 1,707 ms | 148 ms | 2,617,525 | 2,143,311 |

The previous `thumbnail(1600, 1600)` enlarged these smaller source images. Median resize times were approximately 515/543/589 ms, and default PNG encoding took 647/747/946 ms. File header access and base64 conversion were much smaller contributors. Simply using Fast PNG compression with adaptive filtering was slower in this debug profile, so that approach was not selected for opaque previews.

The optimized pipeline reuses the source JPEG/PNG/WebP bytes when both dimensions are <=1600 and EXIF orientation needs no transformation. It decodes the full original once for subsequent editing/export but skips resizing and encoding. Larger images are downscaled; opaque previews use JPEG quality 90, while alpha images use PNG to preserve transparency. EXIF transforms are applied before regenerated previews, preventing double rotation. The full-resolution original stays in Rust for exports and AI processing.

`Opened.timings` reports each backend stage, total time, payload bytes, and whether original bytes were reused. Debug builds print these timings to the cargo terminal. The frontend logs WebView `Image.decode()` duration in its developer console separately.

## Reproduce

Set `ID_PHOTO_PROFILE_FILES` to semicolon-separated local image paths, then run:

```powershell
cargo test -p id-photo-editor profile_photo_loading -- --ignored --nocapture
```

This explicit ignored benchmark compares the previous path and encoding alternatives with the production optimized loader. It does not modify the source photos. Larger files still incur full-resolution decoding, and multiple files are loaded sequentially to bound peak memory use.

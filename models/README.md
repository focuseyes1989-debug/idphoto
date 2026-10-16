# Background removal model

`u2netp.onnx` is the small U²-Net model (4.7 MB) from the [rembg model release](https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx), based on [U²-Net by Xuebin Qin et al.](https://github.com/xuebinqin/U-2-Net).

Verified MD5: `8e83ca70e441ab06c318d82300c84806` (matches the upstream rembg session).

The unchanged model is included at compile time. Inference uses the pure Rust `tract-onnx` CPU backend, so background removal needs no network access, Python, GPU or external DLL. Input preprocessing follows the [rembg U2netp session](https://github.com/danielgatis/rembg/blob/main/rembg/sessions/u2netp.py): 320 × 320 RGB, ImageNet mean and standard deviation, and a normalized output mask resized to the original dimensions. Existing alpha is multiplied by the predicted mask.

U²-Net is distributed under Apache-2.0; see `U2NET-LICENSE`. This lightweight model may miss fine hair or confuse a subject with a complicated background. Restore original background is available in the UI.

The output matte is refined using image-guided filtering instead of plain mask enlargement. For consistently saturated green/blue backgrounds confirmed at the AI background border, boundary color-key cleanup removes screen remnants and suppresses colored edge spill. Confident interior foreground is protected from color cleanup. Guided-filter work buffers are capped at a 1600-pixel long edge for larger source photos. This improves screen-background portraits without claiming perfect hair extraction from every image.

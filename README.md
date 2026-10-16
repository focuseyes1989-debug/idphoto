# ID Photo Studio

Windows desktop ID photo editor built with Tauri 2, Rust and a dependency-free HTML/CSS/JavaScript interface.

## Run

Install Rust (MSVC toolchain), Visual Studio C++ Build Tools and Microsoft Edge WebView2 as described in the [Tauri Windows prerequisites](https://v2.tauri.app/start/prerequisites/).

```powershell
cargo run -p id-photo-editor
```

Run this command from the repository root. The frontend and background removal model are embedded; no Node/npm installation is needed to run the app. No release executable or installer is needed for development. The first build downloads Rust dependencies and compiles the local inference engine; later runs reuse the build cache.

## Use

The primary photo presets are **1.1 × 1.3 inches (default)** and **0.8 × 0.9 inches**. Every newly opened document starts at 1.1 × 1.3 inches. Select the smaller preset from the Crop tool's Photo size list; each document keeps its own selection. These sizes correspond to 27.94 × 33.02 mm and 20.32 × 22.86 mm, respectively.

Open photos with **File → Open photos** or **Ctrl+O**. Select multiple files in the Windows dialog with Ctrl/Shift. Each image opens in its own tab; click a tab or use **Ctrl+Tab** / **Ctrl+Shift+Tab** to switch. Each tab keeps its own crop, rotation, background, dimensions and units. Single-photo export uses the active tab; sheet export follows the selected sheet mode. Close an image with its **×**, **File → Close photo**, or **Ctrl+W**; the adjacent tab becomes active. Closing releases that photo from memory without changing its source file. Edits are held for the current session; export before closing if you want to keep the result. Invalid files in a multi-file selection are reported while valid files still open.

To mix different photos on one sheet, choose **Print layout → Sheet contents → Mix open photos · quantities**. Set each photo's copy count (0 excludes it). The sheet uses each document's edited size, crop, rotation and background. Copies are packed in rows in tab order starting inside the top-left paper margins. DPI and gap are shared sheet settings across tabs. Preview and Rust export use the same integer pixel positions. A selection that does not fit is reported and cannot be exported until adjusted; copies are never silently dropped. Closing a document removes it from the mixed sheet. **Fill with active photo** keeps the original repeated-photo layout, while **Export single photo** always exports the active tab.

The desktop workspace uses a dark editing layout: File/Tools/Help menus and an active-tool options bar across the top, a compact icon toolbar on the left, a document canvas in the center, selected-tool properties across the top options bar, and a Print layout panel on the right. File provides Open and both PNG export actions. Sheet preview is displayed in the center canvas; export actions are in File.

Select a tool from the left toolbar: **Move (V)** to reposition, **Crop (C)** for dimensions and zoom, **Rotate (R)** for free rotation, or **Background (B)** for removal and colors. Only the selected tool's controls appear in the top options bar. The bar scrolls horizontally on narrower windows. Rotation handles and crop guides appear when their tools are selected. Switching tools preserves all edits. Keyboard shortcuts are ignored while typing in form controls. Print settings and the sheet preview stay available in the right panel.

1. Open a JPG, PNG or WebP image. EXIF orientation is applied automatically.
2. Select the Crop tool and use the top options bar to select millimeters, centimeters or inches, then choose a preset or enter custom dimensions. The unit applies to photo dimensions and the print gap. Switching units preserves the exact physical size.
3. Drag the photo within the crop frame and adjust zoom. Arrow keys move the crop when the preview has focus.
4. Select Rotate, then drag the round handle above the photo to rotate freely, use the rotation slider, or enter an angle in degrees (0.1° precision). Hold Shift while dragging to snap to 15° increments. Left/Right fine-tunes by 0.1°; Shift + Left/Right changes by 1° when the preview has focus. The 90° buttons are still available. Rotation keeps your crop zoom and position; Reset rotation returns to 0°. Escape cancels an active drag. Exposed corners use the selected background color.
5. Click **Remove background**, wait for local CPU processing, and choose **White**, **Blue** or **Red**. Use **Restore original background** to undo the removal. The cutout is cached for the current photo, so changing colors does not repeat inference. Hair and complex backgrounds may need a cleaner source photo.
6. Set print resolution and the space between photos. The sheet fills the selected paper within its margins, with copies starting at the top-left of the usable area.
7. Export a single photo or a sheet as PNG. Rotation and background color are applied to both exports; the paper margins remain white. Print at **actual size / 100%** with scaling disabled.

The original image stays in memory; Rust crops and resizes it with Lanczos3 for export. PNG includes DPI metadata. Previews use a smaller image. Processing is local. Background removal uses the bundled U²-Net small model with pure Rust CPU inference; see [model information](models/README.md). Size presets are dimensional templates, not a guarantee of passport or ID compliance. Direct printing is not included yet.

The Background tool includes **Removal strength (0–100%)**. Lower values preserve more fine hair and soft edges but may leave background traces; higher values remove more screen residue. The AI mask is cached for each photo, so the slider refines existing results instead of rerunning inference. Preview, mixed sheets, exports and prints use the same latest applied cutout. Each open document remembers its strength for the current session. The last selected strength is saved across app restarts and becomes the default for newly opened photos; switching tabs preserves each existing photo�s own strength.

## Paper size and margins

Collapse the right Print layout panel with its **»** button and reopen it from the narrow **Print layout** rail. **View → Show/Hide Print layout** or **F8** toggles the same panel. The canvas expands into the freed space, all settings remain intact, and the panel's visibility is remembered across launches.

The **Sheet contents** group has its own **▾ / ▸** toggle. It independently hides or shows layout mode, quantities, DPI and gap without changing their values, and remembers its collapsed state on restart.

**Paper size & margins** has a separate **▾ / ▸** toggle too. Click anywhere on either group’s title bar to expand or collapse it. The title bars are keyboard buttons (Enter/Space). Both groups remember their own expanded state independently of the entire right panel.

Use **Photo / Sheet preview** above the center canvas to switch between photo editing and a large paper preview. Changing paper size, orientation or margins automatically opens the sheet view; mixed mode also opens it. The center view shows the selected paper layout. Its dashed blue rectangle marks the usable area inside margins and is only a preview guide; it is excluded from PNG export and printing. Paper/layout errors appear over the large preview. Choose a photo tool or document tab to return to editing; edits stay intact.

In Sheet preview, use the mouse wheel to zoom around the pointer (25–800% relative to fitted size), and drag with the left mouse button to pan. **Fit to canvas** recenters the sheet and resets the view; press **0** when the sheet has keyboard focus for the same action. Changing paper dimensions or orientation fits the new sheet automatically; changing margins preserves your view. Preview zoom and pan do not change photo edits, quantities, exported pixels or printed dimensions.

In the right Print layout panel choose 4 × 6, 5 × 7, 6 × 8, 8 × 10 inches, A5, A4, A3, Letter or Custom. Select Portrait/Landscape and mm/cm/inches, then set Left, Right, Top and Bottom margins. Photo and paper units default to inches; changing units preserves physical sizes. Custom dimensions support 25.4–420 mm per side. Paper and margin settings are shared across open tabs. Margins are included in the rendered sheet; do not add them a second time in the printer dialog. Preview, PNG export and print use the same paper dimensions and printable bounds. A photo that cannot fit within those bounds blocks sheet export and printing until corrected.

Use the chain icon beside **Margins** to link or unlink all four sides. Linking first copies the Left margin to every side; subsequent edits to any margin update all four. Unlinking preserves current values and allows separate adjustments. The linked state stays the same when changing units or paper size.

Paper preset/custom dimensions, orientation, paper unit, all four margins and link/unlink are saved automatically in this Windows user's local app storage and restored on the next launch. Only valid paper/margin combinations replace the saved settings, so an incomplete input cannot erase the last usable configuration. Missing or damaged saved data falls back to the default 4 × 6 inch paper with zero margins. Open photos and their edits remain session-only.

Gap (stored as its physical millimeter value), DPI and Sheet contents mode are also restored on startup. Older saved settings keep their paper/margins and use defaults for these newly added fields. Selecting Mixed on startup does not reopen closed photos; open photos to populate the sheet again.

Use **Adjustments > Levels** for input black/white, midtone gamma and output levels. **Adjustments > Curves** provides up to 16 freely positioned curve points with smooth interpolation and Input/Output values. Changes preview live. Apply keeps changes; Cancel restores previous values; Reset resets the current adjustment. Reset adjustments clears both. Each photo keeps independent adjustments for preview, sheet export and printing, preserving transparency and replacement background colors. Photo edits remain session-only.

## Print

Choose **File > Print** or **Ctrl+P** to open the custom Windows Print dialog described below. Printing uses the full-resolution Rust sheet composition, including mixed-photo quantities.

## Checks

```powershell
node --test tests/*.test.mjs
cargo test -p id-photo-editor
```

The last selected background color (white, blue or red) is also saved across restarts and used for newly opened photos. Existing photo tabs keep their individual color selections.

The last valid photo size, including custom width/height and measurement unit, is saved across restarts and used for new photos. Existing photo tabs retain their own sizes. Invalid or incomplete size inputs do not replace the saved default.

Opening photos shows a loading overlay with file processing counts and preview preparation progress. Canceling the file chooser or an opening error clears the overlay.

Preview loading avoids enlarging small photos and reuses their original encoded bytes. Larger previews are bounded to 1600 px; alpha and EXIF orientation are preserved. See [preview performance measurements](docs/preview-performance.md) for stage timings and benchmark instructions.

Batch opening displays each completed photo immediately in its tab and canvas while later files continue loading. The compact progress card leaves previews visible. Completed tabs can be selected during loading; choosing a tab keeps it selected as later photos arrive. Crop, rotation, and background editing remain available on completed photos while importing. Editing pins the active photo so later arrivals do not interrupt it. Background inference runs outside the shared document-store lock so importing can continue. Closing photos, exporting/printing, and starting another import remain disabled until the batch finishes; background processing briefly locks editing and tab switching until its result is applied.



## Custom Windows Print dialog

**File > Print / Ctrl+P** opens the app's own modal dialog with all installed local and server printers, a sheet preview, paper presets/custom sizes, orientation, inch/mm/cm units, four margins, and sheet copies (1-100). Driver **Printer Properties** opens per-job media, tray, and color settings. Paper selected there is reflected back into the dialog. The app controls final sheet size and copies. No print job is sent until **Print** is clicked; Cancel sends nothing.

Native Windows GDI printing renders the full-resolution composed sheet at actual physical size using the device DPI and physical page offset. Driver-specific DEVMODE private settings are preserved. If the driver negotiates a different paper size, submission is rejected rather than silently scaled. Printer hardware margins may clip content outside the device's printable area; use suitable layout margins and media settings. Successful submission reports a queued job, not a guarantee that a physical sheet was produced. Successful Print applies paper settings back to the main layout preferences.

The dialog shows only **Printer Properties** below the printer selector; printer enumeration refreshes each time the dialog opens. Server printer repair tools remain internal maintenance commands. On this machine all four Server queues initially returned Windows error 5; reconnecting each existing queue restored printer/driver access on 2026-10-16 without submitting physical jobs. GA-E200's separate driver configuration problem remains.

Read-only printer diagnostics and Microsoft Print to PDF paper negotiation are explicit ignored tests (`diagnose_printers`, `pdf_driver_supports_actual_paper_dimensions`). Neither submits print jobs. `reconnect_selected_printer` is an explicit maintenance test requiring `ID_PHOTO_RECONNECT_PRINTER`; it changes that connection and must not run as part of normal CI.

The last manually selected printer is saved locally, including when the Print dialog is canceled, and restored across app restarts. If that queue is absent, the dialog selects the Windows default printer (or the first installed queue). A temporary absence does not overwrite the saved preference. This does not change the Windows default printer.

Levels and Curves include RGB/Red/Green/Blue channel selection, source histograms, Preview toggle and contrast/lighter/darker presets. Levels input black/midtone/white handles are draggable; output levels have sliders. Click the Curves graph to add a point, drag in both directions, and delete interior points using Delete point or the Delete key. Endpoint input positions stay at 0 and 255.

Selective Color: Adjustments > Selective Color provides Reds, Yellows, Greens, Cyans, Blues, Magentas, Whites, Neutrals and Blacks with Cyan/Magenta/Yellow/Black percentages (-100 to +100), Relative/Absolute methods, Preview, Apply, Cancel and Reset. Each photo keeps independent settings during the session. The same weighted RGB color-range algorithm runs in JavaScript preview and Rust export/print after Levels/Curves, preserving alpha and replacement background colors. Controls follow the Photoshop workflow; numerical output is not an exact Adobe color-engine match.

Selective Color preview performance: only nonzero ranges are compiled and processed, without per-pixel arrays. Slider input is coalesced to one render per animation frame and uses a preview capped at 800 pixels on its longest side. Releasing the slider/committing the number, Apply, or Cancel restores the normal preview resolution. Interactive frames skip hidden sheet redraws; export/print still use full-resolution Rust processing. Run `node tests/selective-performance.mjs` for a repeatable CPU-only before/after benchmark (not end-to-end UI latency).

Save: File > Save (Ctrl+S) saves the active edited photo as a PNG. The first Save asks for a destination; subsequent Saves update that same destination for this open document. File > Save As (Ctrl+Shift+S) always asks for a new destination, which becomes the next Save target. The original open image cannot be overwritten by Save. PNG writing uses a temporary file in the destination directory before replacement, preserving the previous file on failure. Canceling Save As preserves the previous target. Saving includes crop, rotation, background, tone and selective-color settings in the rendered pixels and embeds DPI. This saves an image, not an editable project; save destinations are session-only and Export remains separate.

Editable projects: File > Save Project (Ctrl+Alt+S) saves a self-contained `.idphoto` file; File > Open Project (Ctrl+Shift+O) restores it. Projects include lossless full-resolution originals, cutouts and masks, per-photo dimensions/crop/pan/zoom/rotation/background strength/color/Levels/Curves/Selective Color, tab order and quantities, active tab, paper/orientation/units/margins/link/DPI/gap/layout mode, panel visibility and sheet viewport. Project save asks for a destination each time and uses atomic replacement. Existing tabs stay open when opening a project; restored tabs are appended and project-wide sheet settings take effect. Existing tabs are assigned zero sheet copies so the restored sheet matches the project; their photo edits remain available. PNG Save destinations are not restored, so saving a restored photo asks for a destination. Projects up to 1 GB can be opened; image decoding is bounded. Invalid settings or assets are rejected without removing existing tabs.

Online updates: Help > Check for Updates uses signed GitHub Releases from focuseyes1989-debug/idphoto. The public key and HTTPS endpoint are configured; signed releases and latest.json are published (latest verified version 0.1.3). The update dialog shows version/release notes and download progress. Installation is disabled in development mode. Open photos must be saved to an editable project before installing. The real installed-app upgrade from 0.1.0 to 0.1.3 was verified, including project recovery; see releases/ONLINE-UPDATE-QA.md. See UPDATES.md for packaging, signing-key backup and publishing instructions.

Independent sheet spacing: Gap sets both horizontal and vertical spacing. Column gap then overrides horizontal spacing; Row gap overrides vertical spacing. All use the photo measurement unit (in/mm/cm), with 0-20 mm physical limits. Axis spacing is shared across documents, saved in preferences and editable projects, and passed unchanged to single/mixed sheet preview, PNG export and print-dialog composition. Older preferences/projects without axis overrides use their existing Gap value for both directions.

Edit menu: Undo (Ctrl+Z), Redo (Ctrl+Shift+Z or Ctrl+Y), Copy photo (Ctrl+C), Paste photo (Ctrl+V), Cut photo (Ctrl+X). Clipboard copy renders the active edited photo at output resolution into the Windows image clipboard, including crop/rotation/background/adjustments. Paste opens a flattened clipboard image as a new editable tab at the current default photo size; images copied from other applications are supported. Cut copies first and removes the tab only on successful copy; Undo restores its original editable document. Source files are never cut/deleted. Text input shortcuts keep native behavior.

Undo/Redo stores up to 40 workspace metadata steps, including photo edits, sheet paper/margins/gaps and quantities. Dragged sliders and canvas transforms are grouped into one step. Adjustment dialog Apply is one step; Cancel adds none. Restoring background strength also restores the Rust matte so exports match the preview. A new edit after Undo clears Redo. Explicit Close photo clears the undo timeline and releases images; Cut remains undoable. History is session-only and is not included in project files.

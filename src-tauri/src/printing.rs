#[cfg(windows)]
pub fn configure_shortcuts(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    use webview2_com::{
        AcceleratorKeyPressedEventHandler,
        Microsoft::Web::WebView2::Win32::{
            COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN, COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_DOWN,
        },
    };
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetKeyState, VK_CONTROL, VK_MENU};
    let target = window.clone();
    window.with_webview(move |webview| {
        let handler = AcceleratorKeyPressedEventHandler::create(Box::new(move |_, args| {
            if let Some(args) = args {
                unsafe {
                    let mut key = 0;
                    let mut kind = COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN;
                    args.VirtualKey(&mut key)?;
                    args.KeyEventKind(&mut kind)?;
                    if key == 0x50
                        && GetKeyState(VK_CONTROL as i32) < 0
                        && GetKeyState(VK_MENU as i32) >= 0
                    {
                        args.SetHandled(true)?;
                        if kind == COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN
                            || kind == COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_DOWN
                        {
                            let action = target.clone();
                            let _ = target.run_on_main_thread(move || {
                                let _ = action.eval("document.getElementById('menuPrint').click()");
                            });
                        }
                    }
                }
            }
            Ok(())
        }));
        let mut token = 0;
        if let Err(error) = unsafe {
            webview
                .controller()
                .add_AcceleratorKeyPressed(&handler, &mut token)
        } {
            eprintln!("Could not configure app print shortcut: {error}");
        }
    })
}

/// Opens the operating system printer picker for the prepared print-only document.
/// This only shows UI; the user must explicitly submit the print job there.
#[tauri::command]
pub async fn show_print_dialog(window: tauri::WebviewWindow) -> Result<(), String> {
    #[cfg(windows)]
    {
        use webview2_com::Microsoft::Web::WebView2::Win32::{
            ICoreWebView2_16, COREWEBVIEW2_PRINT_DIALOG_KIND_SYSTEM,
        };
        use windows_core::Interface;
        let (sender, receiver) = std::sync::mpsc::channel();
        window
            .with_webview(move |webview| {
                // Tauri dispatches this closure on the WebView's UI thread, as COM requires.
                let result = (|| unsafe {
                    let core = webview
                        .controller()
                        .CoreWebView2()
                        .map_err(|e| e.to_string())?;
                    let printing = core.cast::<ICoreWebView2_16>().map_err(|e| {
                        format!(
                            "Windows system printing is unavailable in this WebView2 runtime: {e}"
                        )
                    })?;
                    printing
                        .ShowPrintUI(COREWEBVIEW2_PRINT_DIALOG_KIND_SYSTEM)
                        .map_err(|e| format!("Could not open Windows print dialog: {e}"))
                })();
                let _ = sender.send(result);
            })
            .map_err(|e| e.to_string())?;
        tauri::async_runtime::spawn_blocking(move || {
            receiver
                .recv()
                .map_err(|e| format!("Windows print dialog did not respond: {e}"))
        })
        .await
        .map_err(|e| e.to_string())??
    }
    #[cfg(not(windows))]
    {
        let _ = window;
        Err("Windows system printing is only available on Windows".into())
    }
}

# Release 0.1.5 verification

- Source commit: 0cc803fbf127544590ff9c88047c0ebf1d92b987.
- 38 JavaScript, 35 Rust and 2 release metadata tests passed; 5 manual Rust tests ignored.
- Optimized Windows x64 NSIS installer built and signed with the existing Tauri updater key.
- Installer signature and signed version verified; modified installer rejected.
- Public latest-release feed returned 0.1.5. Its installer download matched local SHA-256 and passed signature verification.
- Release tag points to the source commit listed above.
- Installed-app install/restart was not repeated. No physical print jobs submitted.
- Signature is for the Tauri updater; Windows Authenticode signing is not configured.

# Online update verification — 2026-10-16

Repository: https://github.com/focuseyes1989-debug/idphoto

Initial installed release: **0.1.0**. Final installed release: **0.1.3**.

## Completed checks

- Built a Windows x64 NSIS installer with the existing Tauri signing key. Initial installer completed with exit code 0.
- Published installer, `.sig`, `latest.json` and `SHA256SUMS.txt` as GitHub Release assets. The final latest release is `v0.1.3`.
- Installed 0.1.0 displayed **Current version: 0.1.0 / You are using the latest version** before a newer version was published.
- Installed 0.1.0 detected **Version 0.1.3 is available** from the public GitHub feed, with release notes and an enabled install action.
- Opened a generated 350 × 450 synthetic test photo and applied a 17.5-degree rotation. No personal photos were used or uploaded.
- Clicking **Save project and install** opened the project-save dialog. Canceling it displayed **Update postponed. Save a project before installing** and kept the running app and photo intact.
- Saved the project locally as `releases/qa/Untitled.idphoto`. The updater displayed download progress, downloaded the installer from GitHub, verified its signature and launched installation. The app exited and restarted automatically.
- Windows uninstall metadata and executable product version became **0.1.3**.
- The restarted app displayed **Current version: 0.1.3 / You are using the latest version**.
- Reopened the saved project in the updated app: the synthetic photo, 17.5-degree rotation, 27.94 × 33.02 mm photo dimensions, mixed-sheet mode, one copy, 300 DPI and gap were restored.
- Downloaded the final public installer anonymously and matched its SHA256 to the locally built artifact.
- Verified 0.1.0 and 0.1.3 installer signatures with the same Minisign verification library used by Tauri. Signed versions matched; changing an installer byte caused verification to fail. No modified installer was uploaded or run.

## Release publisher fixes

GitHub normalizes spaces in uploaded filenames to periods, and draft asset URLs can contain temporary `untagged-*` tags. The publisher now uses the returned asset name with the final release tag, uploads the feed after installer assets, verifies upload digests, and supports metadata repair without changing the latest release. Two regression tests cover URL construction. Intermediate releases 0.1.1 and 0.1.2 remain available; their metadata was repaired. New clients should use 0.1.3.

The updater binary's embedded bundle marker is `NSS`; the unbundled build executable has `UNK`. These expected three marker bytes account for the installed/unbundled executable hash difference. Installer download hashes match exactly.

## Scope

This verifies the real **0.1.0 → 0.1.3** GitHub download/install/restart path on this Windows user account. It does not verify every Windows version or disconnected-network recovery through the native installer. Automated frontend tests cover network-check failures and postponed installation.

Signing is the **Tauri updater signature**, not Windows Authenticode publisher signing. The private key remains outside the repository at `C:/Users/Demon/.tauri/id-photo-studio.key`; it was not uploaded.

## Published artifacts

- [Initial release v0.1.0](https://github.com/focuseyes1989-debug/idphoto/releases/tag/v0.1.0)
- [Verified release v0.1.3](https://github.com/focuseyes1989-debug/idphoto/releases/tag/v0.1.3)
- [Installer](https://github.com/focuseyes1989-debug/idphoto/releases/download/v0.1.3/ID.Photo.Studio_0.1.3_x64-setup.exe)
- [Update feed](https://github.com/focuseyes1989-debug/idphoto/releases/latest/download/latest.json)

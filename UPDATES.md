# GitHub Releases updates

Help > Check for Updates checks only when requested. The installed Windows release can download and install a signed update. Development builds can check a configured feed but cannot install. If photos are open, the install action first asks to save an editable project. Canceling or failing that save postpones installation. No update is downloaded automatically.

Configured repository: `https://github.com/focuseyes1989-debug/idphoto`. The public signing key and latest-release endpoint are embedded in `src-tauri/tauri.conf.json`. The private signing key is stored outside the workspace at `C:/Users/Demon/.tauri/id-photo-studio.key`; back it up privately and do not regenerate it for future releases. Signed releases have been published. The final verified release is `v0.1.3`; the actual installed-app online upgrade from `0.1.0` to `0.1.3` completed successfully on 2026-10-16. See `releases/ONLINE-UPDATE-QA.md` for the UI, project-recovery and signature-verification results. An empty configuration displays a setup message rather than falsely reporting that the app is up to date.

## Initial setup on another machine

1. Choose a public GitHub repository for release assets. A private repository requires a separate authenticated feed; do not embed a GitHub token in the desktop app.
2. Install the Tauri CLI: `cargo install tauri-cli --version "^2" --locked`.
3. For a brand-new app only, generate a signing key outside the repository (this app already has its key; reuse the backup): `cargo tauri signer generate -w "$env:USERPROFILE\.tauri\id-photo-studio.key"`. Keep the private key and its password backed up privately. The `.pub` file is safe to share.
4. Configure the app using the public key:

```powershell
./scripts/configure-updates.ps1 -Repository 'OWNER/REPOSITORY' -PublicKeyPath "$env:USERPROFILE\.tauri\id-photo-studio.key.pub"
```

This embeds the public key and `https://github.com/OWNER/REPOSITORY/releases/latest/download/latest.json`. Commit those public settings before building the first installed version. No endpoint supplied by the UI is accepted.

## Build a release

Increase the version in both `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`. Use the same signing key for every update.

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = "$env:USERPROFILE\.tauri\id-photo-studio.key"
# Set TAURI_SIGNING_PRIVATE_KEY_PASSWORD privately if the key is password protected.
cargo tauri build --config src-tauri/tauri.release.conf.json
```

The release configuration enables the NSIS installer and updater artifacts without changing the development configuration's disabled bundling. Install the initial signed release manually once. Keep using `cargo run -p id-photo-editor` for local development.

## Publish

Upload the generated signed Windows installer and its signature to a new GitHub Release. Publish `latest.json` as another asset in the latest non-prerelease release:

```json
{
  "version": "0.2.0",
  "notes": "Describe the changes in this release.",
  "pub_date": "2026-10-16T00:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "CONTENTS_OF_THE_GENERATED_SIG_FILE",
      "url": "https://github.com/OWNER/REPOSITORY/releases/download/v0.2.0/GENERATED_INSTALLER_FILENAME.exe"
    }
  }
}
```

The version and installer filename above are examples; use the actual release version and generated filename. The updater verifies the signature and signed version before installation. Tauri's updater signature is separate from Windows Authenticode signing.

Before public distribution, test from an installed older release: no update, newer update, network failure, canceled project save, and successful signed installation. Local unit tests do not verify a real GitHub download or installer launch. The live update path was tested successfully from installed 0.1.0 to 0.1.3. Repeat this test when changing installer/updater behavior.

Reference: https://v2.tauri.app/plugin/updater/

## Publishing with the local GitHub login

`python scripts/publish-release.py --version 0.1.3 --installer "releases/0.1.3/ID Photo Studio_0.1.3_x64-setup.exe" --notes releases/0.1.3/NOTES.md` uses the existing Git Credential Manager login without printing tokens. It initializes an empty release repository if necessary, stages assets in a draft, and publishes after all assets are uploaded. It never uploads private signing keys or photo projects. Use `--no-make-latest` when repairing older-release metadata. GitHub may cache replaced assets, so fixes should be shipped in a fresh version.

## Version 0.1.4

Source is now tracked in the GitHub repository. This release adds multi-sheet layout, scroll/zoom print previews, prepared-canvas caching, linked quantities and edit history. Run the JavaScript, Rust and release-metadata tests before building. The existing updater signing key and public endpoint remain unchanged.

# Release 0.1.4 verification

- Source commit: 70fdb4925da41fd3e37f9018de6017cebfb370bc.
- JavaScript tests: 33 passed. Rust tests: 33 passed, 5 manual tests ignored. Release metadata tests: 2 passed.
- Optimized NSIS installer built using the existing updater signing key.
- Signature and signed version verified; tampered installer rejected.
- Public latest-release endpoint returned version 0.1.4.
- Installer downloaded through the public latest.json URL matched the local installer SHA-256 and passed signature/version verification.
- GitHub release tag points to the source commit above.
- Installed-app upgrade was not repeated for this release. Earlier installed-app upgrade QA is documented in releases/ONLINE-UPDATE-QA.md.
- No physical print jobs were submitted. Signing is the Tauri updater signature, not Windows Authenticode.

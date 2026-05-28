# Release And Operations Model

## Release Goal

A formal release is complete only when all user-facing install/update channels are coherent:

- Version files are aligned.
- Changelog has the new version section.
- macOS DMGs are signed, notarized, stapled, and Gatekeeper checked.
- macOS PKGs are signed, notarized, stapled, and install-checked.
- Tauri updater archives and signatures exist.
- Windows installer and signature assets exist.
- GitHub Release includes installer assets, updater assets, and current `latest.json`.
- The public updater feed URL returns the current version.

## Version Sources

Keep these aligned:

- `package.json`
- `package-lock.json`
- `src-tauri/Cargo.toml`
- `src-tauri/Cargo.lock`
- `src-tauri/tauri.conf.json`

Helper:

- `scripts/set-version.sh`

## Validation Commands

Core validation:

```bash
npm run build
npm test
cd src-tauri && cargo fmt -- --check
cd src-tauri && cargo test
```

Focused JavaScript/TypeScript tests:

```bash
npm run test:release-notes
npm run test:update-notes
npm run test:tab-state
npm run test:path-clipboard
npm run test:device-notes
npm run test:device-selection
npm run test:device-form-factor
npm run test:pair-connect-endpoints
npm run test:startup-adb-repair
npm run test:workbench-rewrite
```

Graph maintenance:

```bash
graphify update .
```

Run graphify from the repo root only when maintaining this repo's graph.

## macOS Release Flow

Main command:

```bash
npm run release:macos -- X.Y.Z
```

Script:

- `scripts/release-macos.sh`

Responsibilities:

1. Load `.env.release` if present.
2. Validate signing/notary environment.
3. Load Tauri updater private key.
4. Update version files.
5. Sign bundled scrcpy binaries.
6. Build app bundles and custom DMGs for Apple Silicon and Intel.
7. Build signed PKG installers.
8. Sign, notarize, staple, and verify final DMGs.
9. Notarize, staple, and verify final PKGs.
10. Verify app bundles with codesign and Gatekeeper.
11. Print final artifact paths.

Required local secrets/identities:

- `APPLE_SIGNING_IDENTITY`
- `APPLE_INSTALLER_SIGNING_IDENTITY`
- `APPLE_API_ISSUER`
- `APPLE_API_KEY`
- `APPLE_API_KEY_PATH`
- `TAURI_SIGNING_PRIVATE_KEY` or `~/.tauri/adb-manager-updater.key`

Do not commit or print secret values.

Timestamp gotcha:

- Local DNS/proxy can break Apple timestamping.
- `APPLE_CODESIGN_TIMESTAMP_URL` activates `scripts/release-shims/codesign`.
- `PRODUCTBUILD_TIMESTAMP_MODE=none` is used for productbuild timestamp issues.

## Updater Feed

Generator:

```bash
npm run generate:updater-json -- X.Y.Z
```

Script:

- `scripts/generate-updater-json.mjs`

Output directory:

- `src-tauri/target/release/bundle/updater/`

Feed asset:

- `latest.json`

Public endpoint:

- `https://github.com/burpeepoo/adb-devices/releases/latest/download/latest.json`

Platforms in feed:

- `darwin-aarch64`
- `darwin-x86_64`
- `windows-x86_64`

Release notes source order:

1. Explicit path passed to generator.
2. `UPDATER_RELEASE_NOTES_FILE`.
3. `release-notes/vX.Y.Z.txt`
4. `release-notes/X.Y.Z.txt`
5. `release-notes/vX.Y.Z.md`
6. `release-notes/X.Y.Z.md`
7. Matching `CHANGELOG.md` section.
8. Default `ADB Manager vX.Y.Z`.

## Asset Contract

Expected final GitHub Release assets:

- `ADB_Manager_X.Y.Z_aarch64.dmg`
- `ADB_Manager_X.Y.Z_x64.dmg`
- `ADB_Manager_X.Y.Z_aarch64.pkg`
- `ADB_Manager_X.Y.Z_x64.pkg`
- `ADB.Manager_X.Y.Z_x64-setup.exe`
- `ADB.Manager_X.Y.Z_x64-setup.exe.sig`
- `ADB.Manager_X.Y.Z_x64_en-US.msi`
- `ADB_Manager_X.Y.Z_aarch64.app.tar.gz`
- `ADB_Manager_X.Y.Z_aarch64.app.tar.gz.sig`
- `ADB_Manager_X.Y.Z_x64.app.tar.gz`
- `ADB_Manager_X.Y.Z_x64.app.tar.gz.sig`
- `latest.json`

GitHub may normalize spaces in uploaded asset names to dots.

## Windows Packaging

Normal path:

- The workflow first runs the `test` job: frontend tests, `cargo fmt -- --check`, and `cargo test`.
- GitHub Release event triggers `.github/workflows/build-packages.yml`.
- The package build job depends on that test job.
- Use the release-event run for tag `vX.Y.Z`.
- Download `windows-package`.
- Upload Windows NSIS `.exe`, `.exe.sig`, and MSI to the same GitHub Release.
- Copy Windows assets into local target search roots and regenerate `latest.json`.

Policy:

- Keep GitHub Actions as the official Windows path.
- Local NSIS fallback may be useful for emergencies, but normal releases should keep the existing CI-based Windows artifact flow.

## Update Runtime Behavior

Frontend hook:

- `src/hooks/useAppUpdater.ts`

Policy:

- `src/updaterPolicy.ts`

Behavior:

- Auto check defaults to enabled.
- Startup check delay: 2500 ms.
- Repeat interval: 6 hours.
- Manual check opens prompt when an update is available.
- Invalid release JSON can be treated as no update.
- Network/download failures get localized user-facing messages.
- Successful download/install relaunches the app.

## Operational Debugging Checklist

When update fails:

1. Fetch `latest.json` from the public endpoint.
2. Confirm `version` matches the latest release.
3. Confirm every platform URL exists as a release asset.
4. Confirm signatures match the actual assets.
5. Confirm the app version is lower than feed version when testing update availability.
6. Distinguish invalid feed from network/proxy failures.

When wireless ADB fails:

1. Confirm `adb devices -l`.
2. Confirm current pair port/code and connect port are not mixed.
3. Check `adb mdns services`.
4. Probe TCP reachability to the reported port.
5. If pair returns protocol fault on a reachable port, refresh the device-side wireless pairing dialog/session.
6. Use app restart/reconnect first.
7. Use host identity reset only when explicit fallback is needed.

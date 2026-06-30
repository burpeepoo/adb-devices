# ADB Manager Agent

Optional Android device-side helper for ADB Manager performance sampling.

Build output expected by the desktop app:

```text
src-tauri/resources/agent/adb-manager-agent.apk
```

The APK is a regular bundled desktop resource. `npm run build` first runs
`scripts/ensure-agent-apk.mjs`: if Android SDK build-tools and a JDK are
available, it rebuilds a missing or stale APK; otherwise it reuses the checked-in
APK and fails only when the APK is missing.

To refresh the APK explicitly:

```bash
npm run build:agent
```

The build script signs the APK with a local persistent debug keystore at
`agent-android/debug.keystore`. The keystore is ignored by git, but keeping it
stable on the release machine avoids unnecessary update-incompatible installs.

## Device Update Policy

ADB Manager treats the bundled Agent APK as an updatable same-package helper.
When Agent mode is enabled on a device that already has
`com.cozyla.adbmanager.agent`, the desktop app installs the bundled APK with:

```bash
adb install -r adb-manager-agent.apk
```

That Android update path preserves the Agent app data when the package name and
signing certificate are unchanged. If the certificate changes, Android reports
an update-incompatible install failure; the desktop app must surface that failure
and must not automatically uninstall the old Agent, because uninstalling deletes
the Agent app data.

When changing Agent APK behavior, keep these version markers aligned:

- `AgentService.AGENT_VERSION`
- `agent-android/build-agent-apk.sh --version-name`
- desktop `AGENT_BUNDLED_VERSION_NAME`

If an APK change includes data-schema changes, bump version metadata
monotonically and handle migration inside the APK before relying on desktop
upgrade detection.

ADB starts the exported `AgentBootstrapActivity`; that activity immediately
starts the private `AgentService` from the app UID and exits. The service itself
stays `exported=false` so external apps cannot start or bind to it directly.
The desktop start command also tries `appops set <agent> GET_USAGE_STATS allow`;
if the device rejects that app-op, Agent mode stays usable but reports
`permission_limited`.

V1 exposes a localhost-only local abstract socket through `adb forward`:

- `GET /health`
- `POST /target`
- `GET /samples/stream`
- `POST /stop`

The APK does not unlock system GPU counters. It reports its own permissions and
device-visible sampling data; desktop ADB probes continue to provide system
CPU, battery, thermal, storage, GPU, and `gfxinfo` fallback data.

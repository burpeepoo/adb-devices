Bundled ADB Manager Agent APK location:

```text
src-tauri/resources/agent/adb-manager-agent.apk
```

This APK is expected to be included in desktop packages. `npm run build` runs
`scripts/ensure-agent-apk.mjs` first; environments with Android SDK build-tools
and a JDK refresh stale APKs, while packaging environments without Android tools
reuse this checked-in APK.

The APK is started through `AgentBootstrapActivity`; the sampling service remains
private and communicates only through an ADB-forwarded local abstract socket.

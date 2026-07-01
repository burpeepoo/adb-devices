import type { AgentCopilotAttachment, AndroidAgentSkill, AndroidAgentSkillId } from "./types";

export const ANDROID_AGENT_SKILLS: AndroidAgentSkill[] = [
  {
    id: "device_report",
    title: "Device Report",
    summary: "Collects identity, build, display, storage, memory, battery, and package context.",
    localPath: "docs/agent-skills/device-report.md",
    requiresAgentApk: false,
    triggerKeywords: [
      "device report",
      "device info",
      "baseline",
      "inventory",
      "overview",
      "inspect device",
      "看看这台机器",
      "设备报告",
      "设备信息",
      "整机信息",
      "基础信息",
      "概览",
    ],
    steps: [
      {
        id: "identity",
        title: "Identity and build",
        command:
          "shell 'printf \"serial=\"; getprop ro.serialno; printf \"model=\"; getprop ro.product.model; printf \"android=\"; getprop ro.build.version.release; printf \"sdk=\"; getprop ro.build.version.sdk; printf \"fingerprint=\"; getprop ro.build.fingerprint'",
        why: "Confirms the exact device and software baseline before any diagnosis.",
      },
      {
        id: "display",
        title: "Display state",
        command: "shell 'wm size; wm density; dumpsys display | head -80'",
        why: "Captures the screen geometry and display service state.",
      },
      {
        id: "resources",
        title: "Resources",
        command: "shell 'df -h /data; free -m; cat /proc/meminfo | head -12; dumpsys battery | head -40'",
        why: "Surfaces storage, memory, and battery constraints that affect app behavior.",
      },
      {
        id: "packages",
        title: "Core package inventory",
        command: "shell 'cmd package list packages | grep -E \"cozyla|launcher|calendar|google|gms|play\" | head -120 || true'",
        why: "Checks whether expected system, Google, and Cozyla packages exist.",
      },
    ],
    acceptance: [
      "Device identity is present.",
      "Display and storage data are captured.",
      "Important package availability is visible.",
    ],
  },
  {
    id: "performance_triage",
    title: "Performance Triage",
    summary: "Samples CPU, memory, frame, SurfaceFlinger, thermal, and foreground process signals.",
    localPath: "docs/agent-skills/performance-triage.md",
    requiresAgentApk: true,
    triggerKeywords: [
      "slow",
      "lag",
      "jank",
      "fps",
      "frame",
      "performance",
      "cpu",
      "gpu",
      "thermal",
      "卡",
      "卡顿",
      "性能",
      "掉帧",
      "发热",
      "帧率",
      "慢",
    ],
    steps: [
      {
        id: "top",
        title: "CPU and process pressure",
        command: "shell 'top -b -n 1 -o PID,USER,PR,NI,VIRT,RES,SHR,S,%CPU,%MEM,ARGS | head -30'",
        why: "Finds hot processes without assuming the launcher is at fault.",
      },
      {
        id: "activity",
        title: "Foreground activity",
        command: "shell 'dumpsys activity activities | grep -E \"ResumedActivity|topResumedActivity|mFocusedApp\" | head -40 || true'",
        why: "Confirms what Android considers foreground during the slowdown.",
      },
      {
        id: "frames",
        title: "Frame rendering",
        command: "shell 'dumpsys gfxinfo framestats | head -160'",
        why: "Captures frame timing and jank evidence when gfxinfo is available.",
      },
      {
        id: "thermal",
        title: "Thermal and SurfaceFlinger",
        command: "shell 'dumpsys thermalservice | head -80; dumpsys SurfaceFlinger --latency-clear >/dev/null 2>&1; dumpsys SurfaceFlinger | head -120'",
        why: "Separates render pressure from thermal throttling and display composition state.",
      },
    ],
    acceptance: [
      "At least one CPU or frame signal is captured.",
      "Foreground activity is confirmed.",
      "Thermal/display state is recorded or its unavailability is visible.",
    ],
  },
  {
    id: "black_screen_triage",
    title: "Black Screen Triage",
    summary: "Checks display, window, activity, SurfaceFlinger, SystemUI, and crash evidence.",
    localPath: "docs/agent-skills/black-screen-triage.md",
    requiresAgentApk: false,
    triggerKeywords: [
      "black screen",
      "blank screen",
      "no display",
      "display hal",
      "surfaceflinger",
      "systemui",
      "黑屏",
      "白屏",
      "没画面",
      "无显示",
      "屏幕不亮",
      "桌面黑",
    ],
    steps: [
      {
        id: "window",
        title: "Window focus",
        command: "shell 'dumpsys window | grep -E \"mCurrentFocus|mFocusedApp|mDisplayFrozen|Screen\" | head -80 || true'",
        why: "Determines whether Android has a focused visible window.",
      },
      {
        id: "activity",
        title: "Activity stack",
        command: "shell 'dumpsys activity top | head -160'",
        why: "Shows whether the top app or launcher is alive and resumed.",
      },
      {
        id: "display",
        title: "Display and compositor",
        command: "shell 'dumpsys display | head -120; dumpsys SurfaceFlinger | grep -E \"Display|Layer|HWC|error|fatal\" | head -120 || true'",
        why: "Separates app/UI failure from display-composition failure.",
      },
      {
        id: "crashes",
        title: "Recent crash signals",
        command: "shell 'logcat -d -t 400 | grep -E \"FATAL EXCEPTION|ANR|SystemUI|SurfaceFlinger|Display|WindowManager\" | tail -120 || true'",
        why: "Captures recent fatal, ANR, and display-related log evidence.",
      },
    ],
    acceptance: [
      "Focused window or lack of focus is visible.",
      "Recent crash/ANR evidence is captured.",
      "Display service state is checked.",
    ],
  },
  {
    id: "calendar_sync_triage",
    title: "Calendar Sync Triage",
    summary: "Checks accounts, sync adapters, jobs, services, network hints, and calendar providers.",
    localPath: "docs/agent-skills/calendar-sync-triage.md",
    requiresAgentApk: false,
    triggerKeywords: [
      "calendar",
      "sync",
      "account",
      "google calendar",
      "workmanager",
      "jobscheduler",
      "日历",
      "同步",
      "账号",
      "谷歌日历",
      "不同步",
      "刷新失败",
    ],
    steps: [
      {
        id: "accounts",
        title: "Accounts and sync adapters",
        command: "shell 'dumpsys account | head -160; dumpsys content | grep -E \"SyncAdapter|calendar|com.google\" | head -120 || true'",
        why: "Confirms whether the account and Calendar sync adapter are known to Android.",
      },
      {
        id: "jobs",
        title: "Scheduler state",
        command: "shell 'dumpsys jobscheduler | grep -E \"calendar|google|sync|JobStatus\" | head -160 || true'",
        why: "Finds blocked or pending sync jobs.",
      },
      {
        id: "packages",
        title: "Calendar packages",
        command: "shell 'cmd package list packages | grep -E \"calendar|google|gms|gsf\" || true; dumpsys package com.google.android.calendar | head -120'",
        why: "Checks package presence and manifest/service state for Google Calendar.",
      },
      {
        id: "recentLogs",
        title: "Recent sync logs",
        command: "shell 'logcat -d -t 500 | grep -iE \"calendar|syncadapter|jobscheduler|workmanager|account\" | tail -120 || true'",
        why: "Captures the nearest runtime reason for sync failure.",
      },
    ],
    acceptance: [
      "Account and sync adapter evidence is captured.",
      "Scheduler state is visible.",
      "Recent sync logs are available or their absence is recorded.",
    ],
  },
  {
    id: "install_failure_triage",
    title: "Install Failure Triage",
    summary: "Checks install restrictions, package conflicts, storage, and recent PackageInstaller evidence.",
    localPath: "docs/agent-skills/install-failure-triage.md",
    requiresAgentApk: false,
    triggerKeywords: [
      "install failed",
      "apk install",
      "package installer",
      "user restricted",
      "INSTALL_FAILED",
      "安装失败",
      "装不上",
      "安装 apk",
      "无法安装",
      "包冲突",
      "签名冲突",
    ],
    steps: [
      {
        id: "restrictions",
        title: "Install restrictions",
        command: "shell 'getprop persist.sys.cozyla.osfull; dumpsys user | grep -iE \"restriction|install|unknown\" | head -120 || true'",
        why: "Checks firmware and user restrictions before retrying installation.",
      },
      {
        id: "storage",
        title: "Storage headroom",
        command: "shell 'df -h /data; pm list packages -f | wc -l'",
        why: "Rules out low storage or unusually large package inventory as install blockers.",
      },
      {
        id: "packageInstaller",
        title: "Installer package state",
        command: "shell 'dumpsys package com.google.android.packageinstaller | head -120; dumpsys package com.android.packageinstaller | head -120'",
        why: "Captures the installed package installer state on vendor builds.",
      },
      {
        id: "recentLogs",
        title: "Recent install logs",
        command: "shell 'logcat -d -t 500 | grep -iE \"PackageInstaller|PackageManager|INSTALL_FAILED|user restricted|apk\" | tail -160 || true'",
        why: "Finds the exact PackageManager reason from the latest install attempt.",
      },
    ],
    acceptance: [
      "Install policy/restriction state is visible.",
      "Storage headroom is captured.",
      "Recent PackageManager or installer errors are recorded when present.",
    ],
  },
  {
    id: "wireless_adb_triage",
    title: "Wireless ADB Triage",
    summary: "Checks device-side wireless debugging, network identity, adbd state, and pairing/connect hints.",
    localPath: "docs/agent-skills/wireless-adb-triage.md",
    requiresAgentApk: false,
    triggerKeywords: [
      "wireless adb",
      "adb pair",
      "adb connect",
      "pairing",
      "mdns",
      "wifi debug",
      "无线 adb",
      "无线调试",
      "配对",
      "连接不上",
      "adb 连接",
      "adb 配对",
    ],
    steps: [
      {
        id: "network",
        title: "Device network identity",
        command: "shell 'ip addr show wlan0 2>/dev/null | head -80; ip route | head -40; getprop dhcp.wlan0.ipaddress'",
        why: "Confirms whether the device has the expected Wi-Fi network identity.",
      },
      {
        id: "adbd",
        title: "adbd properties",
        command: "shell 'getprop | grep -iE \"adb|adbd|debuggable|service.adb.tcp.port\" | head -120 || true'",
        why: "Shows device-side ADB and debugging properties without changing them.",
      },
      {
        id: "wirelessSettings",
        title: "Wireless debugging settings",
        command: "shell 'settings get global adb_wifi_enabled; settings get global adb_enabled; settings get secure adb_enabled'",
        why: "Checks whether Android believes ADB or wireless ADB is enabled.",
      },
      {
        id: "recentLogs",
        title: "Recent adbd logs",
        command: "shell 'logcat -d -t 500 | grep -iE \"adbd|adb wifi|pair|mdns|tls\" | tail -120 || true'",
        why: "Captures pairing, TLS, and adbd runtime hints.",
      },
    ],
    acceptance: [
      "Device network identity is captured.",
      "adbd/debugging properties are visible.",
      "Recent pairing/connect evidence is recorded when present.",
    ],
  },
  {
    id: "input_touch_triage",
    title: "Input And Touch Triage",
    summary: "Checks touch devices, focused windows, input dispatch, accessibility, and UI hierarchy hints.",
    localPath: "docs/agent-skills/input-touch-triage.md",
    requiresAgentApk: false,
    triggerKeywords: [
      "touch",
      "tap",
      "input",
      "click",
      "accessibility",
      "uiautomator",
      "点不动",
      "不能点击",
      "触摸",
      "触控",
      "按键",
      "无响应",
      "辅助功能",
    ],
    steps: [
      {
        id: "inputDevices",
        title: "Input devices",
        command: "shell 'dumpsys input | head -180'",
        why: "Confirms whether Android sees touch and key input devices.",
      },
      {
        id: "windowFocus",
        title: "Input focus",
        command: "shell 'dumpsys window | grep -E \"mCurrentFocus|mFocusedApp|mInputMethodTarget|mTouchableInsets\" | head -120 || true'",
        why: "Checks whether input is routed to the expected window.",
      },
      {
        id: "accessibility",
        title: "Accessibility state",
        command: "shell 'settings get secure enabled_accessibility_services; settings get secure accessibility_enabled; dumpsys accessibility | head -120'",
        why: "Finds accessibility overlays or services that may intercept input.",
      },
      {
        id: "uiHierarchy",
        title: "UI hierarchy smoke dump",
        command: "shell 'uiautomator dump /dev/tty 2>/dev/null | head -120'",
        why: "Captures whether the current UI hierarchy is visible to automation.",
      },
    ],
    acceptance: [
      "Input device state is captured.",
      "Focused/touchable window state is visible.",
      "Accessibility interception is checked.",
    ],
  },
  {
    id: "package_state_triage",
    title: "Package State Triage",
    summary: "Checks package enablement, permissions, app ops, default handlers, and launcher visibility.",
    localPath: "docs/agent-skills/package-state-triage.md",
    requiresAgentApk: false,
    triggerKeywords: [
      "package",
      "permission",
      "appops",
      "launcher icon",
      "default app",
      "component",
      "包状态",
      "权限",
      "应用不见",
      "默认应用",
      "组件",
      "图标不显示",
    ],
    steps: [
      {
        id: "visiblePackages",
        title: "Visible package inventory",
        command: "shell 'cmd package list packages | grep -E \"cozyla|launcher|calendar|google|gms|play\" | head -160 || true'",
        why: "Lists the packages most often involved in Cozyla investigations.",
      },
      {
        id: "disabled",
        title: "Disabled and suspended packages",
        command: "shell 'cmd package list packages -d | head -120; dumpsys package packages | grep -E \"enabled=|suspended=\" | head -120 || true'",
        why: "Finds disabled, suspended, or hidden packages.",
      },
      {
        id: "appOps",
        title: "App ops and permissions",
        command: "shell 'cmd appops query-op --user 0 RUN_IN_BACKGROUND allow 2>/dev/null | head -120; dumpsys package com.elclcd.launcher | grep -E \"granted=|permission|enabled\" | head -160 || true'",
        why: "Checks common runtime permission and app-op clues without mutating state.",
      },
      {
        id: "defaults",
        title: "Default handlers",
        command: "shell 'cmd package resolve-activity --brief android.intent.action.MAIN -c android.intent.category.HOME; dumpsys role | head -120'",
        why: "Confirms default launcher and role ownership.",
      },
    ],
    acceptance: [
      "Relevant package presence is visible.",
      "Disabled/suspended state is checked.",
      "Default handler evidence is captured.",
    ],
  },
  {
    id: "network_triage",
    title: "Network Triage",
    summary: "Checks Wi-Fi, routes, DNS, connectivity service state, and recent network errors.",
    localPath: "docs/agent-skills/network-triage.md",
    requiresAgentApk: false,
    triggerKeywords: [
      "network",
      "wifi",
      "dns",
      "internet",
      "connectivity",
      "offline",
      "网络",
      "联网",
      "断网",
      "wifi",
      "dns",
      "无法访问",
      "没网",
    ],
    steps: [
      {
        id: "interfaces",
        title: "Interfaces and routes",
        command: "shell 'ip addr | head -160; ip route | head -80'",
        why: "Captures the device-side network shape before diagnosing app behavior.",
      },
      {
        id: "dns",
        title: "DNS properties",
        command: "shell 'getprop | grep -iE \"dns|net\\.\" | head -160 || true'",
        why: "Shows DNS and network properties exposed by Android.",
      },
      {
        id: "connectivity",
        title: "Connectivity service",
        command: "shell 'dumpsys connectivity | head -180'",
        why: "Checks Android's active network, validation, and transport state.",
      },
      {
        id: "recentLogs",
        title: "Recent network logs",
        command: "shell 'logcat -d -t 500 | grep -iE \"ConnectivityService|NetworkMonitor|DnsResolver|wifi|netd\" | tail -140 || true'",
        why: "Captures nearest DNS, validation, or Wi-Fi runtime failures.",
      },
    ],
    acceptance: [
      "Interfaces/routes are captured.",
      "Connectivity service state is visible.",
      "Recent network errors are recorded when present.",
    ],
  },
  {
    id: "logcat_crash_triage",
    title: "Crash And ANR Triage",
    summary: "Checks recent fatal exceptions, ANRs, tombstones, dropbox, and process restarts.",
    localPath: "docs/agent-skills/logcat-crash-triage.md",
    requiresAgentApk: false,
    triggerKeywords: [
      "crash",
      "anr",
      "fatal exception",
      "tombstone",
      "dropbox",
      "force close",
      "崩溃",
      "闪退",
      "无响应",
      "anr",
      "fatal",
      "墓碑",
    ],
    steps: [
      {
        id: "fatalLogs",
        title: "Recent fatal and ANR logs",
        command: "shell 'logcat -d -t 800 | grep -E \"FATAL EXCEPTION|ANR in|am_crash|am_anr|AndroidRuntime\" | tail -180 || true'",
        why: "Captures the nearest high-signal crash and ANR records.",
      },
      {
        id: "dropbox",
        title: "DropBox crash records",
        command: "shell 'dumpsys dropbox --print | grep -E \"system_app_crash|data_app_crash|system_app_anr|data_app_anr\" | tail -120 || true'",
        why: "Finds persisted crash/ANR breadcrumbs when logcat rolled over.",
      },
      {
        id: "tombstones",
        title: "Native tombstone inventory",
        command: "shell 'ls -lt /data/tombstones 2>/dev/null | head -30 || true'",
        why: "Checks whether native crashes exist without requiring privileged reads.",
      },
      {
        id: "processStarts",
        title: "Recent process restarts",
        command: "shell 'logcat -d -t 800 | grep -E \"ActivityManager|ProcessRecord|Start proc|Killing\" | tail -160 || true'",
        why: "Correlates crashes with restarts or low-memory kills.",
      },
    ],
    acceptance: [
      "Recent fatal/ANR evidence is captured or absent.",
      "DropBox/tombstone availability is checked.",
      "Restart/kill context is recorded.",
    ],
  },
  {
    id: "storage_pressure_triage",
    title: "Storage Pressure Triage",
    summary: "Checks /data usage, app cache pressure, media/storage service state, and low-storage logs.",
    localPath: "docs/agent-skills/storage-pressure-triage.md",
    requiresAgentApk: false,
    triggerKeywords: [
      "storage",
      "disk",
      "cache",
      "low storage",
      "no space",
      "存储",
      "空间不足",
      "磁盘",
      "缓存",
      "满了",
      "剩余空间",
    ],
    steps: [
      {
        id: "dataUsage",
        title: "/data usage",
        command: "shell 'df -h /data /sdcard 2>/dev/null; du -sh /sdcard/Android/data 2>/dev/null | head -20 || true'",
        why: "Shows whether app data or shared storage is close to capacity.",
      },
      {
        id: "storageService",
        title: "Storage service",
        command: "shell 'dumpsys diskstats | head -120; dumpsys mount | head -120'",
        why: "Captures Android's storage health and mount view.",
      },
      {
        id: "largeDirs",
        title: "Large shared-storage directories",
        command: "shell 'du -h -d 1 /sdcard 2>/dev/null | sort -h | tail -40 || true'",
        why: "Identifies visible shared-storage directories that consume space.",
      },
      {
        id: "recentLogs",
        title: "Recent storage logs",
        command: "shell 'logcat -d -t 500 | grep -iE \"low storage|no space|ENOSPC|diskstats|vold|StorageManager\" | tail -120 || true'",
        why: "Captures recent low-space or mount failures.",
      },
    ],
    acceptance: [
      "Storage capacity and visible usage are captured.",
      "Storage service state is visible.",
      "Recent low-storage evidence is recorded when present.",
    ],
  },
];

export function findAndroidAgentSkill(id: AndroidAgentSkillId): AndroidAgentSkill {
  return ANDROID_AGENT_SKILLS.find((skill) => skill.id === id) ?? ANDROID_AGENT_SKILLS[0];
}

export function recommendAndroidAgentSkill(
  prompt: string,
  attachments: Pick<AgentCopilotAttachment, "name" | "textPreview">[] = [],
): AndroidAgentSkill {
  return recommendAndroidAgentSkillCandidate(prompt, attachments) ?? ANDROID_AGENT_SKILLS[0];
}

export function recommendAndroidAgentSkillCandidate(
  prompt: string,
  attachments: Pick<AgentCopilotAttachment, "name" | "textPreview">[] = [],
): AndroidAgentSkill | null {
  const haystack = [prompt, ...attachments.flatMap((attachment) => [attachment.name, attachment.textPreview ?? ""])]
    .join("\n")
    .toLowerCase();
  if (!haystack.trim()) return null;

  let best = ANDROID_AGENT_SKILLS[0];
  let bestScore = 0;
  for (const skill of ANDROID_AGENT_SKILLS) {
    const score = skill.triggerKeywords.reduce((total, keyword) => {
      const normalized = keyword.toLowerCase();
      if (!haystack.includes(normalized)) return total;
      return total + Math.max(1, Math.min(5, Math.ceil(normalized.length / 4)));
    }, 0);
    if (score > bestScore) {
      best = skill;
      bestScore = score;
    }
  }

  return bestScore > 0 ? best : null;
}

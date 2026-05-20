# ADB Manager Mantine UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce Mantine and replace the current ADB Manager frame with a double-sidebar desktop shell while preserving existing ADB workflows.

**Architecture:** Keep `App.tsx` as the state owner for ADB availability, selected device, settings, global screenshot shortcut, and active tool. Add Mantine providers at the React root, then introduce focused layout/common components that receive state and callbacks from `App.tsx`. Migrate the shell, device panel, settings modal, and moderate pages first; keep complex tool internals behaviorally stable.

**Tech Stack:** Tauri 2, React 19, TypeScript 6, Vite 8, Tailwind 4, Mantine, Tabler icons, react-i18next.

---

## File Structure

Create:

- `src/components/layout/AppShellLayout.tsx` — desktop frame with tool rail, device panel, workspace, and status bar slots.
- `src/components/layout/AppShellLayout.css` — stable shell dimensions and responsive layout rules.
- `src/components/layout/ToolRail.tsx` — icon navigation for `TabKey` tools plus settings.
- `src/components/layout/DevicePanel.tsx` — Mantine version of device list, notes, selection, refresh, online/offline grouping.
- `src/components/layout/StatusBar.tsx` — global device and app status summary.
- `src/components/layout/PageHeader.tsx` — consistent title/context row for tool pages.
- `src/components/common/ResultAlert.tsx` — shared success/error/warning message display.
- `src/components/common/CommandOutput.tsx` — shared monospaced command/stdout/stderr output panel.
- `src/components/common/PathSelector.tsx` — shared save directory display plus change button.

Modify:

- `package.json` and `package-lock.json` — add Mantine and icon dependencies.
- `src/main.tsx` — import Mantine CSS and wrap app in providers.
- `src/index.css` — keep Tailwind import, add root height and shell-safe defaults.
- `src/App.tsx` — replace top tabs/sidebar frame with `AppShellLayout`.
- `src/components/Settings.tsx` — convert custom overlay to Mantine modal.
- `src/components/Screenshot.tsx` — convert surface, path row, buttons, and results to Mantine/common components.
- `src/components/ScreenRecord.tsx` — convert surface, path row, buttons, timer, and results to Mantine/common components.
- `src/components/PairConnect.tsx` — migrate outer surfaces, inputs, buttons, badges, and result display while keeping command logic intact.
- `src/locales/zh-CN.json` and `src/locales/en-US.json` — add shell labels used by new layout.

Remove:

- No files are removed in this plan. `src/components/DeviceList.tsx` can remain unused during the first pass to reduce risk; remove it in a cleanup pass only after the new `DevicePanel` is stable.

---

## Task 1: Install Mantine And Wire Providers

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/main.tsx`
- Modify: `src/index.css`

- [ ] **Step 1: Add dependencies**

Run:

```bash
npm install @mantine/core @mantine/hooks @mantine/notifications @mantine/modals @mantine/dropzone @tabler/icons-react
```

Expected:

- `package.json` contains the new dependencies.
- `package-lock.json` is updated.

- [ ] **Step 2: Wrap the React root with Mantine providers**

Replace `src/main.tsx` with:

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { MantineProvider, createTheme } from "@mantine/core";
import { ModalsProvider } from "@mantine/modals";
import { Notifications } from "@mantine/notifications";
import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import "@mantine/dropzone/styles.css";
import "./i18n";
import App from "./App";
import "./index.css";

const theme = createTheme({
  primaryColor: "blue",
  defaultRadius: "md",
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
  headings: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
  },
  components: {
    Button: {
      defaultProps: {
        size: "sm",
      },
    },
    ActionIcon: {
      defaultProps: {
        size: "sm",
      },
    },
    TextInput: {
      defaultProps: {
        size: "sm",
      },
    },
    Select: {
      defaultProps: {
        size: "sm",
      },
    },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <MantineProvider theme={theme}>
      <ModalsProvider>
        <Notifications position="top-right" />
        <App />
      </ModalsProvider>
    </MantineProvider>
  </React.StrictMode>
);
```

- [ ] **Step 3: Add shell-safe global CSS**

Replace `src/index.css` with:

```css
@import "tailwindcss";

:root {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  font-size: 14px;
  line-height: 1.5;
  color: #1a1a2e;
  background-color: #f8f9fa;
}

html,
body,
#root {
  min-height: 100%;
  height: 100%;
}

body {
  margin: 0;
  min-height: 100vh;
  overflow: hidden;
}

* {
  box-sizing: border-box;
}

::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: #c1c1c1;
  border-radius: 3px;
}

::-webkit-scrollbar-thumb:hover {
  background: #a1a1a1;
}
```

- [ ] **Step 4: Verify provider wiring**

Run:

```bash
npm run build
```

Expected:

- TypeScript completes.
- Vite build completes.
- No missing Mantine CSS import errors.

---

## Task 2: Create Shared Common Components

**Files:**

- Create: `src/components/common/ResultAlert.tsx`
- Create: `src/components/common/CommandOutput.tsx`
- Create: `src/components/common/PathSelector.tsx`

- [ ] **Step 1: Add ResultAlert**

Create `src/components/common/ResultAlert.tsx`:

```tsx
import { Alert } from "@mantine/core";
import { IconAlertCircle, IconCheck, IconInfoCircle } from "@tabler/icons-react";

export interface ResultMessage {
  ok: boolean;
  msg: string;
}

interface Props {
  result: ResultMessage | null;
  warning?: boolean;
  className?: string;
}

export default function ResultAlert({ result, warning = false, className }: Props) {
  if (!result) return null;

  const color = warning ? "yellow" : result.ok ? "green" : "red";
  const Icon = warning ? IconInfoCircle : result.ok ? IconCheck : IconAlertCircle;

  return (
    <Alert className={className} color={color} icon={<Icon size={16} />} radius="md" variant="light">
      {result.msg}
    </Alert>
  );
}
```

- [ ] **Step 2: Add CommandOutput**

Create `src/components/common/CommandOutput.tsx`:

```tsx
import { Box, Group, Text } from "@mantine/core";
import type { ReactNode } from "react";

interface Props {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  maxHeight?: number;
}

export default function CommandOutput({ title, action, children, maxHeight = 220 }: Props) {
  return (
    <Box
      style={{
        border: "1px solid var(--mantine-color-gray-3)",
        borderRadius: "var(--mantine-radius-md)",
        overflow: "hidden",
        background: "var(--mantine-color-white)",
      }}
    >
      <Group justify="space-between" px="sm" py={7} style={{ borderBottom: "1px solid var(--mantine-color-gray-2)" }}>
        <Text size="xs" fw={600} c="dimmed">
          {title}
        </Text>
        {action}
      </Group>
      <Box
        component="pre"
        m={0}
        p="sm"
        style={{
          maxHeight,
          overflow: "auto",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          background: "#111827",
          color: "#e5f0ff",
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
          fontSize: 12,
          lineHeight: 1.6,
        }}
      >
        {children}
      </Box>
    </Box>
  );
}
```

- [ ] **Step 3: Add PathSelector**

Create `src/components/common/PathSelector.tsx`:

```tsx
import { Button, Group, Text, TextInput } from "@mantine/core";
import { IconFolder } from "@tabler/icons-react";

interface Props {
  label: string;
  value: string;
  emptyLabel: string;
  actionLabel: string;
  disabled?: boolean;
  onSelect: () => void;
}

export default function PathSelector({ label, value, emptyLabel, actionLabel, disabled = false, onSelect }: Props) {
  return (
    <div>
      <Text size="xs" fw={600} c="dimmed" mb={4}>
        {label}
      </Text>
      <Group gap="xs" wrap="nowrap" align="start">
        <TextInput value={value || emptyLabel} readOnly styles={{ input: { cursor: "default" } }} style={{ flex: 1 }} />
        <Button leftSection={<IconFolder size={15} />} variant="light" disabled={disabled} onClick={onSelect}>
          {actionLabel}
        </Button>
      </Group>
    </div>
  );
}
```

- [ ] **Step 4: Build**

Run:

```bash
npm run build
```

Expected:

- New components type-check.

---

## Task 3: Add Layout Shell Components

**Files:**

- Create: `src/components/layout/AppShellLayout.tsx`
- Create: `src/components/layout/AppShellLayout.css`
- Create: `src/components/layout/ToolRail.tsx`
- Create: `src/components/layout/StatusBar.tsx`
- Create: `src/components/layout/PageHeader.tsx`
- Modify: `src/locales/zh-CN.json`
- Modify: `src/locales/en-US.json`

- [ ] **Step 1: Add layout locale keys**

Add this object after the existing `app` object in both locale files.

Chinese:

```json
"layout": {
  "tools": "工具",
  "settings": "设置",
  "selectedDevice": "当前设备",
  "noSelectedDevice": "未选择设备",
  "defaultDevice": "默认 ADB 设备",
  "adbReady": "ADB 可用",
  "deviceCount": "{{online}} 在线 / {{total}} 总计",
  "searchDevices": "搜索设备或备注...",
  "quickConnect": "快速连接",
  "openSettings": "打开设置"
}
```

English:

```json
"layout": {
  "tools": "Tools",
  "settings": "Settings",
  "selectedDevice": "Selected device",
  "noSelectedDevice": "No device selected",
  "defaultDevice": "Default ADB device",
  "adbReady": "ADB ready",
  "deviceCount": "{{online}} online / {{total}} total",
  "searchDevices": "Search devices or notes...",
  "quickConnect": "Quick connect",
  "openSettings": "Open settings"
}
```

Ensure commas around the inserted object keep valid JSON.

- [ ] **Step 2: Add AppShellLayout CSS**

Create `src/components/layout/AppShellLayout.css`:

```css
.app-shell-layout {
  display: grid;
  grid-template-rows: 1fr 28px;
  height: 100vh;
  min-height: 0;
  background: var(--mantine-color-gray-0);
  color: var(--mantine-color-gray-9);
}

.app-shell-layout__body {
  min-height: 0;
  display: grid;
  grid-template-columns: 64px 292px minmax(0, 1fr);
}

.app-shell-layout__rail {
  min-height: 0;
  border-right: 1px solid rgba(255, 255, 255, 0.08);
  background: #111827;
}

.app-shell-layout__devices {
  min-width: 0;
  min-height: 0;
  border-right: 1px solid var(--mantine-color-gray-3);
  background: var(--mantine-color-gray-0);
}

.app-shell-layout__workspace {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.app-shell-layout__content {
  min-height: 0;
  flex: 1;
  overflow: auto;
  padding: 16px;
}

@media (max-width: 940px) {
  .app-shell-layout__body {
    grid-template-columns: 56px 240px minmax(0, 1fr);
  }

  .app-shell-layout__content {
    padding: 12px;
  }
}
```

- [ ] **Step 3: Add AppShellLayout**

Create `src/components/layout/AppShellLayout.tsx`:

```tsx
import type { ReactNode } from "react";
import "./AppShellLayout.css";

interface Props {
  rail: ReactNode;
  devices: ReactNode;
  header: ReactNode;
  content: ReactNode;
  status: ReactNode;
}

export default function AppShellLayout({ rail, devices, header, content, status }: Props) {
  return (
    <div className="app-shell-layout">
      <div className="app-shell-layout__body">
        <aside className="app-shell-layout__rail">{rail}</aside>
        <aside className="app-shell-layout__devices">{devices}</aside>
        <main className="app-shell-layout__workspace">
          {header}
          <div className="app-shell-layout__content">{content}</div>
        </main>
      </div>
      {status}
    </div>
  );
}
```

- [ ] **Step 4: Add ToolRail**

Create `src/components/layout/ToolRail.tsx`:

```tsx
import { ActionIcon, Stack, Tooltip } from "@mantine/core";
import {
  IconAdjustmentsHorizontal,
  IconApps,
  IconCamera,
  IconClipboard,
  IconDeviceMobileCode,
  IconListDetails,
  IconPlayerRecord,
  IconPlugConnected,
  IconSettings,
  IconTerminal2,
  IconVideo,
} from "@tabler/icons-react";
import type { TabKey } from "../../types";

interface ToolConfig {
  key: TabKey;
  label: string;
  icon: typeof IconPlugConnected;
}

interface Props {
  tools: ToolConfig[];
  activeTool: TabKey;
  settingsLabel: string;
  onSelectTool: (tool: TabKey) => void;
  onOpenSettings: () => void;
}

export const toolIcons: Record<TabKey, ToolConfig["icon"]> = {
  pair: IconPlugConnected,
  workbench: IconTerminal2,
  install: IconApps,
  screenshot: IconCamera,
  record: IconPlayerRecord,
  mirror: IconVideo,
  clipboard: IconClipboard,
  logcat: IconListDetails,
  packages: IconDeviceMobileCode,
};

export default function ToolRail({ tools, activeTool, settingsLabel, onSelectTool, onOpenSettings }: Props) {
  return (
    <Stack h="100%" align="center" gap={8} p={8}>
      {tools.map((tool) => {
        const Icon = tool.icon;
        const active = tool.key === activeTool;
        return (
          <Tooltip key={tool.key} label={tool.label} position="right" withArrow openDelay={250}>
            <ActionIcon
              aria-label={tool.label}
              variant={active ? "filled" : "subtle"}
              color={active ? "blue" : "gray"}
              size={44}
              radius="md"
              onClick={() => onSelectTool(tool.key)}
              styles={{
                root: {
                  color: active ? "white" : "var(--mantine-color-gray-4)",
                },
              }}
            >
              <Icon size={22} />
            </ActionIcon>
          </Tooltip>
        );
      })}
      <div style={{ flex: 1 }} />
      <Tooltip label={settingsLabel} position="right" withArrow openDelay={250}>
        <ActionIcon aria-label={settingsLabel} variant="subtle" color="gray" size={40} radius="md" onClick={onOpenSettings}>
          <IconSettings size={21} />
        </ActionIcon>
      </Tooltip>
      <Tooltip label="ADB Manager" position="right" withArrow openDelay={250}>
        <ActionIcon aria-label="ADB Manager" variant="transparent" color="gray" size={40} radius="md">
          <IconAdjustmentsHorizontal size={21} />
        </ActionIcon>
      </Tooltip>
    </Stack>
  );
}
```

- [ ] **Step 5: Add PageHeader**

Create `src/components/layout/PageHeader.tsx`:

```tsx
import { Badge, Group, Paper, Stack, Text, Title } from "@mantine/core";

interface Props {
  title: string;
  selectedDeviceLabel: string;
  selectedDeviceValue: string;
  actions?: React.ReactNode;
}

export default function PageHeader({ title, selectedDeviceLabel, selectedDeviceValue, actions }: Props) {
  return (
    <Paper radius={0} px="md" py="sm" withBorder style={{ borderLeft: 0, borderRight: 0, borderTop: 0 }}>
      <Group justify="space-between" gap="md" wrap="nowrap">
        <Stack gap={2} style={{ minWidth: 0 }}>
          <Title order={3} size="h4">
            {title}
          </Title>
          <Group gap={6}>
            <Text size="xs" c="dimmed">
              {selectedDeviceLabel}
            </Text>
            <Badge variant="light" color="gray" radius="sm">
              {selectedDeviceValue}
            </Badge>
          </Group>
        </Stack>
        {actions}
      </Group>
    </Paper>
  );
}
```

- [ ] **Step 6: Add StatusBar**

Create `src/components/layout/StatusBar.tsx`:

```tsx
import { Group, Text } from "@mantine/core";
import type { DeviceInfo } from "../../types";

interface Props {
  devices: DeviceInfo[];
  adbReadyLabel: string;
  countLabel: string;
  autoRefreshLabel: string;
}

export default function StatusBar({ devices, adbReadyLabel, countLabel, autoRefreshLabel }: Props) {
  const online = devices.filter((device) => device.state === "device").length;
  return (
    <Group
      h={28}
      px="sm"
      justify="space-between"
      style={{
        borderTop: "1px solid var(--mantine-color-gray-3)",
        background: "var(--mantine-color-white)",
      }}
    >
      <Group gap="xs">
        <Text size="xs" c="dimmed">
          {adbReadyLabel}
        </Text>
        <Text size="xs" c="dimmed">
          {countLabel}
        </Text>
      </Group>
      <Text size="xs" c="dimmed">
        {autoRefreshLabel}
      </Text>
    </Group>
  );
}
```

- [ ] **Step 7: Build**

Run:

```bash
npm run build
```

Expected:

- Layout components type-check.
- Locale JSON remains valid.

---

## Task 4: Create Mantine DevicePanel

**Files:**

- Create: `src/components/layout/DevicePanel.tsx`

- [ ] **Step 1: Create DevicePanel from current DeviceList behavior**

Create `src/components/layout/DevicePanel.tsx`:

```tsx
import { ActionIcon, Badge, Box, Group, ScrollArea, Stack, Text, TextInput, Tooltip } from "@mantine/core";
import { IconRefresh, IconSearch } from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { getStore, saveStoreValue, STORE_KEYS } from "../../storage";
import type { DeviceInfo } from "../../types";

interface Props {
  devices: DeviceInfo[];
  loading: boolean;
  error: string | null;
  selectedDevice: string | null;
  mirroringDeviceSerial: string | null;
  onSelectDevice: (serial: string) => void;
  onRefresh: () => void;
}

type DeviceNotes = Record<string, string>;

export default function DevicePanel({
  devices,
  loading,
  error,
  selectedDevice,
  mirroringDeviceSerial,
  onSelectDevice,
  onRefresh,
}: Props) {
  const { t } = useTranslation();
  const [deviceNotes, setDeviceNotes] = useState<DeviceNotes>({});
  const [query, setQuery] = useState("");

  useEffect(() => {
    getStore()
      .then((store) => store.get<DeviceNotes>(STORE_KEYS.deviceNotes))
      .then((saved) => setDeviceNotes(saved || {}))
      .catch(() => undefined);
  }, []);

  const filteredDevices = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return devices;
    return devices.filter((device) => {
      const note = deviceNotes[deviceIdentityKey(device)] || "";
      return [device.serial, device.device_sn, device.model, device.product, note]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(needle));
    });
  }, [devices, deviceNotes, query]);

  const onlineDevices = filteredDevices.filter((device) => device.state === "device");
  const offlineDevices = filteredDevices.filter((device) => device.state !== "device");

  const handleNoteChange = (device: DeviceInfo, note: string) => {
    const key = deviceIdentityKey(device);
    setDeviceNotes((prev) => {
      const next = { ...prev, [key]: note };
      saveStoreValue(STORE_KEYS.deviceNotes, next).catch(() => undefined);
      return next;
    });
  };

  return (
    <Stack h="100%" gap={0}>
      <Box p="sm" style={{ borderBottom: "1px solid var(--mantine-color-gray-3)", background: "var(--mantine-color-white)" }}>
        <Group justify="space-between" mb="xs">
          <Text size="sm" fw={700}>
            {t("deviceList.title")}
          </Text>
          <Tooltip label={t("deviceList.refresh")} withArrow>
            <ActionIcon aria-label={t("deviceList.refresh")} variant="subtle" color="gray" loading={loading} onClick={onRefresh}>
              <IconRefresh size={17} />
            </ActionIcon>
          </Tooltip>
        </Group>
        <TextInput
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          leftSection={<IconSearch size={14} />}
          placeholder={t("layout.searchDevices")}
        />
      </Box>

      {error && (
        <Box px="sm" py={7} style={{ background: "var(--mantine-color-red-0)" }}>
          <Text size="xs" c="red">
            {error}
          </Text>
        </Box>
      )}

      <ScrollArea style={{ flex: 1 }}>
        <Stack gap={8} p="xs">
          <DeviceSection label={`${t("deviceList.online")} (${onlineDevices.length})`} />
          {onlineDevices.map((device) => (
            <DeviceRow
              key={device.serial}
              device={device}
              note={deviceNotes[deviceIdentityKey(device)] || ""}
              selected={selectedDevice === device.serial}
              mirroring={mirroringDeviceSerial === device.serial}
              online
              onSelect={() => onSelectDevice(device.serial)}
              onNoteChange={(note) => handleNoteChange(device, note)}
            />
          ))}

          {offlineDevices.length > 0 && <DeviceSection label={`${t("deviceList.offline")} (${offlineDevices.length})`} />}
          {offlineDevices.map((device) => (
            <DeviceRow
              key={device.serial}
              device={device}
              note={deviceNotes[deviceIdentityKey(device)] || ""}
              selected={false}
              mirroring={false}
              online={false}
              onNoteChange={(note) => handleNoteChange(device, note)}
            />
          ))}

          {devices.length === 0 && !loading && (
            <Box py="lg" ta="center">
              <Text size="sm" c="dimmed">
                {t("deviceList.noDevice")}
              </Text>
              <Text size="xs" c="dimmed">
                {t("deviceList.pleasePair")}
              </Text>
            </Box>
          )}
        </Stack>
      </ScrollArea>
    </Stack>
  );
}

function DeviceSection({ label }: { label: string }) {
  return (
    <Text size="10px" fw={700} tt="uppercase" c="dimmed" px={4} pt={6}>
      {label}
    </Text>
  );
}

function DeviceRow({
  device,
  note,
  selected,
  mirroring,
  online,
  onSelect,
  onNoteChange,
}: {
  device: DeviceInfo;
  note: string;
  selected: boolean;
  mirroring: boolean;
  online: boolean;
  onSelect?: () => void;
  onNoteChange: (note: string) => void;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note);
  const title = device.device_sn || device.serial;

  const commitEdit = () => {
    setEditing(false);
    if (draft !== note) onNoteChange(draft);
  };

  return (
    <Box
      p="xs"
      style={{
        border: selected ? "1px solid var(--mantine-color-blue-4)" : "1px solid transparent",
        borderRadius: "var(--mantine-radius-md)",
        background: selected ? "var(--mantine-color-blue-0)" : "var(--mantine-color-white)",
        opacity: online ? 1 : 0.6,
      }}
    >
      <Group align="flex-start" gap="xs" wrap="nowrap">
        <Box
          mt={7}
          style={{
            width: 9,
            height: 9,
            borderRadius: 99,
            flexShrink: 0,
            background: online ? "var(--mantine-color-green-6)" : "var(--mantine-color-red-5)",
          }}
        />
        <Box style={{ minWidth: 0, flex: 1 }}>
          <button
            type="button"
            onClick={onSelect}
            disabled={!online}
            style={{
              width: "100%",
              padding: 0,
              border: 0,
              background: "transparent",
              textAlign: "left",
              cursor: online ? "pointer" : "default",
            }}
          >
            <Group gap={6} wrap="nowrap">
              <Text size="sm" fw={selected ? 700 : 500} truncate title={title} style={{ minWidth: 0 }}>
                {title}
              </Text>
              <ConnectionBadge type={device.connection_type} />
              {mirroring && (
                <Badge color="red" size="xs" radius="sm">
                  {t("deviceList.mirroring")}
                </Badge>
              )}
            </Group>
            <Text size="xs" c="dimmed" truncate title={device.serial}>
              {t("deviceList.adb")}: {device.serial}
            </Text>
            {device.model && (
              <Text size="xs" c="dimmed" truncate title={device.model}>
                {t("deviceList.model")}: {device.model}
              </Text>
            )}
          </button>

          {editing ? (
            <TextInput
              mt={7}
              value={draft}
              onChange={(event) => setDraft(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") commitEdit();
                if (event.key === "Escape") setEditing(false);
              }}
              onBlur={commitEdit}
              placeholder={t("deviceList.notePlaceholder")}
              autoFocus
            />
          ) : (
            <Box
              mt={7}
              px={7}
              py={5}
              onClick={(event) => {
                event.stopPropagation();
                setDraft(note);
                setEditing(true);
              }}
              style={{
                minHeight: 28,
                borderRadius: "var(--mantine-radius-sm)",
                cursor: "text",
                background: selected ? "rgba(255,255,255,.55)" : "var(--mantine-color-gray-0)",
              }}
            >
              <Text size="xs" c={note ? "gray.7" : "dimmed"}>
                {note || t("deviceList.addNote")}
              </Text>
            </Box>
          )}
        </Box>
      </Group>
    </Box>
  );
}

function ConnectionBadge({ type }: { type: DeviceInfo["connection_type"] }) {
  const { t } = useTranslation();
  if (type === "wireless") {
    return (
      <Badge color="blue" size="xs" radius="sm">
        {t("deviceList.wireless")}
      </Badge>
    );
  }
  if (type === "usb") {
    return (
      <Badge color="gray" size="xs" radius="sm">
        {t("deviceList.usb")}
      </Badge>
    );
  }
  return (
    <Badge color="yellow" size="xs" radius="sm">
      {t("deviceList.unknown")}
    </Badge>
  );
}

function deviceIdentityKey(device: Pick<DeviceInfo, "serial" | "device_sn">) {
  return device.device_sn || device.serial;
}
```

- [ ] **Step 2: Build**

Run:

```bash
npm run build
```

Expected:

- `DevicePanel` type-checks.
- No store key names changed.

---

## Task 5: Integrate The Double-Sidebar Shell In App

**Files:**

- Modify: `src/App.tsx`

- [ ] **Step 1: Replace old frame imports**

In `src/App.tsx`, remove:

```tsx
import DeviceList from "./components/DeviceList";
```

Add:

```tsx
import AppShellLayout from "./components/layout/AppShellLayout";
import DevicePanel from "./components/layout/DevicePanel";
import PageHeader from "./components/layout/PageHeader";
import StatusBar from "./components/layout/StatusBar";
import ToolRail, { toolIcons } from "./components/layout/ToolRail";
```

- [ ] **Step 2: Add tool config inside `App` after `TAB_LABELS`**

Insert:

```tsx
const tools = (Object.keys(TAB_LABELS) as TabKey[]).map((key) => ({
  key,
  label: TAB_LABELS[key],
  icon: toolIcons[key],
}));
```

- [ ] **Step 3: Add render helper before the final return**

Insert below `handleSaveDirChange`:

```tsx
const selectedDeviceLabel = selectedDevice || t("layout.defaultDevice");

const renderActiveContent = () => {
  if (activeTab === "pair") return <PairConnect devices={devices} onConnected={refresh} />;
  if (activeTab === "workbench") return <AdbWorkbench deviceSerial={selectedDevice} />;
  if (activeTab === "install") {
    return (
      <ApkInstall
        deviceSerial={selectedDevice}
        recentApkDir={settings.recentApkDir}
        onRecentApkDirChange={(dir) => handleSaveDirChange("recentApkDir", dir)}
      />
    );
  }
  if (activeTab === "screenshot") {
    return (
      <Screenshot
        deviceSerial={selectedDevice}
        saveDir={settings.screenshotDir}
        shortcutResult={screenshotShortcutResult}
        onSaveDirChange={(dir) => handleSaveDirChange("screenshotDir", dir)}
      />
    );
  }
  if (activeTab === "record") {
    return (
      <ScreenRecord
        deviceSerial={selectedDevice}
        saveDir={settings.recordingDir}
        onSaveDirChange={(dir) => handleSaveDirChange("recordingDir", dir)}
      />
    );
  }
  if (activeTab === "mirror") {
    return <ScreenMirror deviceSerial={selectedDevice} onMirrorStateChange={setMirroringDeviceSerial} />;
  }
  if (activeTab === "clipboard") return <Clipboard deviceSerial={selectedDevice} />;
  if (activeTab === "logcat") return <Logcat deviceSerial={selectedDevice} />;
  if (activeTab === "packages") return <PackageList deviceSerial={selectedDevice} />;
  return null;
};
```

- [ ] **Step 4: Replace the final app frame JSX**

Replace the final `return (` block after the ADB availability gates with:

```tsx
return (
  <>
    <AppShellLayout
      rail={
        <ToolRail
          tools={tools}
          activeTool={activeTab}
          settingsLabel={t("layout.openSettings")}
          onSelectTool={setActiveTab}
          onOpenSettings={() => setShowSettings(true)}
        />
      }
      devices={
        <DevicePanel
          devices={devices}
          loading={loading}
          error={error}
          selectedDevice={selectedDevice}
          mirroringDeviceSerial={mirroringDeviceSerial}
          onSelectDevice={setSelectedDevice}
          onRefresh={refresh}
        />
      }
      header={
        <PageHeader
          title={TAB_LABELS[activeTab]}
          selectedDeviceLabel={selectedDevice ? t("layout.selectedDevice") : t("layout.noSelectedDevice")}
          selectedDeviceValue={selectedDeviceLabel}
        />
      }
      content={renderActiveContent()}
      status={
        <StatusBar
          devices={devices}
          adbReadyLabel={t("layout.adbReady")}
          countLabel={t("layout.deviceCount", {
            online: devices.filter((device) => device.state === "device").length,
            total: devices.length,
          })}
          autoRefreshLabel={t("app.autoRefresh")}
        />
      }
    />

    {showSettings && (
      <Settings
        settings={settings}
        onSettingsChange={handleSettingsChange}
        onClose={() => setShowSettings(false)}
      />
    )}
  </>
);
```

- [ ] **Step 5: Build**

Run:

```bash
npm run build
```

Expected:

- `App.tsx` type-checks.
- Old top tab bar is gone.
- `DeviceList` may remain unused without import errors.

---

## Task 6: Convert Settings To Mantine Modal

**Files:**

- Modify: `src/components/Settings.tsx`

- [ ] **Step 1: Replace Settings component**

Replace `src/components/Settings.tsx` with:

```tsx
import { Button, Group, Modal, Select, Stack, TextInput } from "@mantine/core";
import { IconFolder } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { AppSettings, LanguagePreference } from "../types";

interface Props {
  settings: AppSettings;
  onSettingsChange: (settings: AppSettings) => void;
  onClose: () => void;
}

export default function Settings({ settings, onSettingsChange, onClose }: Props) {
  const { t } = useTranslation();
  const [local, setLocal] = useState(settings);

  useEffect(() => {
    setLocal(settings);
  }, [settings]);

  const handleSelectDir = async (type: "screenshotDir" | "recordingDir") => {
    try {
      const dir = await invoke<string | null>("select_directory");
      if (dir) {
        setLocal((current) => ({ ...current, [type]: dir }));
      }
    } catch {
      // Directory selection cancellation should keep current settings.
    }
  };

  const handleSave = () => {
    onSettingsChange(local);
    onClose();
  };

  return (
    <Modal opened onClose={onClose} title={t("settings.title")} centered size="md">
      <Stack gap="md">
        <Select
          label={t("settings.language")}
          value={local.languagePreference || "system"}
          onChange={(value) =>
            setLocal({
              ...local,
              languagePreference: (value || "system") as LanguagePreference,
            })
          }
          data={[
            { value: "system", label: t("settings.languageSystem") },
            { value: "en-US", label: t("settings.languageEnglish") },
            { value: "zh-CN", label: t("settings.languageChinese") },
          ]}
        />

        <Group align="end" gap="xs" wrap="nowrap">
          <TextInput label={t("settings.screenshotDir")} value={local.screenshotDir || t("settings.notSet")} readOnly style={{ flex: 1 }} />
          <Button variant="light" leftSection={<IconFolder size={15} />} onClick={() => handleSelectDir("screenshotDir")}>
            {t("settings.select")}
          </Button>
        </Group>

        <Group align="end" gap="xs" wrap="nowrap">
          <TextInput label={t("settings.recordingDir")} value={local.recordingDir || t("settings.notSet")} readOnly style={{ flex: 1 }} />
          <Button variant="light" leftSection={<IconFolder size={15} />} onClick={() => handleSelectDir("recordingDir")}>
            {t("settings.select")}
          </Button>
        </Group>

        <Group justify="flex-end" mt="sm">
          <Button variant="subtle" color="gray" onClick={onClose}>
            {t("settings.cancel")}
          </Button>
          <Button onClick={handleSave}>{t("settings.save")}</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
```

- [ ] **Step 2: Build**

Run:

```bash
npm run build
```

Expected:

- Settings modal type-checks.
- `select_directory` behavior remains unchanged.

---

## Task 7: Migrate Screenshot And ScreenRecord Surfaces

**Files:**

- Modify: `src/components/Screenshot.tsx`
- Modify: `src/components/ScreenRecord.tsx`

- [ ] **Step 1: Update Screenshot imports**

Add Mantine/common imports to `src/components/Screenshot.tsx`:

```tsx
import { Button, Group, Paper, Stack, Text } from "@mantine/core";
import { IconCamera, IconExternalLink, IconPhoto } from "@tabler/icons-react";
import PathSelector from "./common/PathSelector";
import ResultAlert from "./common/ResultAlert";
```

- [ ] **Step 2: Replace Screenshot JSX return**

Keep all existing state and callbacks in `Screenshot.tsx`. Replace only the `return (` block with:

```tsx
return (
  <Stack maw={680} gap="md">
    <Paper withBorder radius="md" p="md">
      <Stack gap="md">
        <Text fw={700}>{t("screenshot.title")}</Text>

        <PathSelector
          label={t("screenshot.saveDir")}
          value={saveDir}
          emptyLabel={t("screenshot.notSet")}
          actionLabel={t("screenshot.changeDir")}
          onSelect={handleSelectSaveDir}
        />

        <Group grow>
          <Button leftSection={<IconCamera size={17} />} loading={taking} onClick={() => handleScreenshot(false)}>
            {t("screenshot.take")}
          </Button>
          <Button variant="dark" leftSection={<IconPhoto size={17} />} loading={taking} onClick={() => handleScreenshot(true)}>
            {t("screenshot.takeAndPreview")}
          </Button>
        </Group>

        <Paper withBorder radius="md" p="sm" bg="blue.0">
          <Text size="xs" fw={700} c="blue.8">
            {t("screenshot.shortcutTitle")}
          </Text>
          <Text size="xs" c="blue.8" mt={4}>
            {t("screenshot.shortcutHint")}
          </Text>
          <Group gap="xs" mt="xs">
            <Text size="xs" px={8} py={4} bg="white" style={{ borderRadius: "var(--mantine-radius-sm)" }}>
              {t("screenshot.shortcutMac")}
            </Text>
            <Text size="xs" px={8} py={4} bg="white" style={{ borderRadius: "var(--mantine-radius-sm)" }}>
              {t("screenshot.shortcutWindows")}
            </Text>
          </Group>
        </Paper>

        <ResultAlert result={result} />

        {lastPath && (
          <Button variant="subtle" size="xs" leftSection={<IconExternalLink size={14} />} onClick={handleOpenFolder} style={{ alignSelf: "flex-start" }}>
            {t("screenshot.showInFolder")}
          </Button>
        )}

        {!deviceSerial && <ResultAlert warning result={{ ok: true, msg: t("screenshot.noDevice") }} />}
      </Stack>
    </Paper>
  </Stack>
);
```

- [ ] **Step 3: Update ScreenRecord imports**

Add Mantine/common imports to `src/components/ScreenRecord.tsx`:

```tsx
import { Button, Group, Paper, Stack, Text, ThemeIcon } from "@mantine/core";
import { IconExternalLink, IconPlayerRecord, IconPlayerStop } from "@tabler/icons-react";
import PathSelector from "./common/PathSelector";
import ResultAlert from "./common/ResultAlert";
```

- [ ] **Step 4: Replace ScreenRecord JSX return**

Keep all existing state, callbacks, timer logic, and `showWarning` in `ScreenRecord.tsx`. Replace only the `return (` block with:

```tsx
return (
  <Stack maw={680} gap="md">
    <Paper withBorder radius="md" p="md">
      <Stack gap="md">
        <Text fw={700}>{t("screenRecord.title")}</Text>

        <PathSelector
          label={t("screenRecord.saveDir")}
          value={saveDir}
          emptyLabel={t("screenRecord.notSet")}
          actionLabel={t("screenRecord.changeDir")}
          disabled={recording}
          onSelect={handleSelectSaveDir}
        />

        {recording && (
          <Stack align="center" gap={6}>
            <Group gap="sm" px="md" py="xs" style={{ borderRadius: "var(--mantine-radius-md)", background: "var(--mantine-color-red-0)" }}>
              <ThemeIcon color="red" radius="xl" size="sm">
                <IconPlayerRecord size={12} fill="currentColor" />
              </ThemeIcon>
              <Text ff="monospace" fw={800} size="xl" c="red.8">
                {formatDuration(elapsed)}
              </Text>
            </Group>
            {showWarning && (
              <Text size="sm" c="yellow.8">
                {t("screenRecord.nearingLimit")}
              </Text>
            )}
          </Stack>
        )}

        {!recording ? (
          <Button color="red" leftSection={<IconPlayerRecord size={17} />} disabled={!deviceSerial} onClick={handleStart}>
            {t("screenRecord.startRecord")}
          </Button>
        ) : (
          <Button color="dark" leftSection={<IconPlayerStop size={17} />} loading={stopping} onClick={handleStop}>
            {t("screenRecord.stopRecord")}
          </Button>
        )}

        <ResultAlert result={result} />

        {lastPath && result?.ok && (
          <Button
            variant="subtle"
            size="xs"
            leftSection={<IconExternalLink size={14} />}
            onClick={async () => {
              try {
                await invoke("reveal_path", { path: lastPath });
              } catch {
                setResult({ ok: false, msg: t("screenRecord.openFolderFailed") });
              }
            }}
            style={{ alignSelf: "flex-start" }}
          >
            {t("screenRecord.showInFolder")}
          </Button>
        )}

        {!deviceSerial && !recording && <ResultAlert warning result={{ ok: true, msg: t("screenRecord.noDevice") }} />}
      </Stack>
    </Paper>

    <Paper withBorder radius="md" p="md" bg="gray.0">
      <Text size="sm" fw={600} c="dimmed" mb={4}>
        {t("screenRecord.notes")}
      </Text>
      <Stack gap={2}>
        <Text size="xs" c="dimmed">
          {t("screenRecord.note1")}
        </Text>
        <Text size="xs" c="dimmed">
          {t("screenRecord.note2")}
        </Text>
        <Text size="xs" c="dimmed">
          {t("screenRecord.note3")}
        </Text>
      </Stack>
    </Paper>
  </Stack>
);
```

- [ ] **Step 5: Build**

Run:

```bash
npm run build
```

Expected:

- Screenshot and screen recording still type-check.
- No callback names changed.

---

## Task 8: Migrate PairConnect Outer Presentation

**Files:**

- Modify: `src/components/PairConnect.tsx`

- [ ] **Step 1: Add Mantine imports without changing command logic**

Add these imports to `src/components/PairConnect.tsx`:

```tsx
import { Badge, Button, Group, Paper, Stack, Text, TextInput } from "@mantine/core";
import ResultAlert from "./common/ResultAlert";
```

Keep existing React, i18n, Tauri, storage, and type imports.

- [ ] **Step 2: Convert the top-level PairConnect frame**

In the main `return` statement, change the outer container:

```tsx
<div className="max-w-3xl space-y-5">
```

to:

```tsx
<Stack maw={980} gap="md">
```

Change each first-level `<section className="...">` wrapper inside that return to a `Paper` wrapper:

```tsx
<Paper withBorder radius="md" p="md">
```

Change each corresponding closing `</section>` to `</Paper>`.

Change the final closing wrapper from:

```tsx
</div>
```

to:

```tsx
</Stack>
```

- [ ] **Step 3: Replace `MdnsRow`**

Replace the entire `MdnsRow` function with:

```tsx
function MdnsRow({
  device,
  busy,
  disabled,
  connected,
  onConnect,
}: {
  device: MdnsDevice;
  busy: boolean;
  disabled: boolean;
  connected: boolean;
  onConnect: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Paper withBorder radius="md" p="sm">
      <Group justify="space-between" gap="md" wrap="nowrap">
        <div style={{ minWidth: 0 }}>
          <Group gap={6} wrap="nowrap">
            <Text size="sm" fw={600} truncate>
              {device.service_name}
            </Text>
            <Badge color="green" size="sm" variant="light">
              {t("pairConnect.connectable")}
            </Badge>
            <Badge color={connected ? "blue" : "gray"} size="sm" variant="light">
              {connected ? t("pairConnect.connected") : t("pairConnect.notConnected")}
            </Badge>
          </Group>
          <Text size="xs" c="dimmed" mt={4} truncate>
            {device.address} · {device.service_type}
          </Text>
        </div>
        <Button size="sm" loading={busy} disabled={disabled || connected} onClick={onConnect}>
          {connected ? t("pairConnect.connected") : t("pairConnect.oneClickConnect")}
        </Button>
      </Group>
    </Paper>
  );
}
```

- [ ] **Step 4: Replace `MdnsPairRow`**

Replace the entire `MdnsPairRow` function with:

```tsx
function MdnsPairRow({
  device,
  busy,
  disabled,
  code,
  onCodeChange,
  onCodeFocus,
  onCodeBlur,
  onPair,
}: {
  device: MdnsDevice;
  busy: boolean;
  disabled: boolean;
  code: string;
  onCodeChange: (code: string) => void;
  onCodeFocus: () => void;
  onCodeBlur: () => void;
  onPair: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Paper withBorder radius="md" p="sm">
      <Group justify="space-between" gap="md" align="flex-end">
        <div style={{ minWidth: 0, flex: 1 }}>
          <Group gap={6} wrap="nowrap">
            <Text size="sm" fw={600} truncate>
              {device.service_name}
            </Text>
            <Badge color="yellow" size="sm" variant="light">
              {t("pairConnect.needPair")}
            </Badge>
          </Group>
          <Text size="xs" c="dimmed" mt={4} truncate>
            {device.address} · {device.service_type}
          </Text>
        </div>
        <Group gap="xs" align="flex-end">
          <TextInput
            value={code}
            onChange={(event) => onCodeChange(event.currentTarget.value)}
            onFocus={onCodeFocus}
            onBlur={onCodeBlur}
            placeholder={t("pairConnect.pairCode")}
            maxLength={8}
            inputMode="numeric"
            autoComplete="one-time-code"
            w={116}
          />
          <Button loading={busy} disabled={disabled || !code.trim()} onClick={onPair}>
            {t("pairConnect.pair")}
          </Button>
        </Group>
      </Group>
    </Paper>
  );
}
```

- [ ] **Step 5: Replace `Field`**

Replace the entire `Field` function with:

```tsx
function Field({
  label,
  value,
  onChange,
  onFocus,
  onBlur,
  placeholder,
  maxLength,
  inputMode,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  placeholder: string;
  maxLength?: number;
  inputMode?: HTMLAttributes<HTMLInputElement>["inputMode"];
  autoComplete?: string;
}) {
  return (
    <TextInput
      label={label}
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
      onFocus={onFocus}
      onBlur={onBlur}
      placeholder={placeholder}
      maxLength={maxLength}
      inputMode={inputMode}
      autoComplete={autoComplete}
    />
  );
}
```

- [ ] **Step 6: Replace `PairRepairAction` and `ResultMessage`**

Replace `PairRepairAction` with:

```tsx
function PairRepairAction({
  repairing,
  onRestartAdbAndScan,
}: {
  repairing: boolean;
  onRestartAdbAndScan: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Button mt="sm" size="xs" color="red" loading={repairing} onClick={onRestartAdbAndScan}>
      {t("pairConnect.restartAdbAndScan")}
    </Button>
  );
}
```

Replace `ResultMessage` with:

```tsx
function ResultMessage({
  result,
  children,
}: {
  result: { ok: boolean; msg: string };
  children?: ReactNode;
}) {
  return (
    <ResultAlert result={result} className="mt-3">
      {children}
    </ResultAlert>
  );
}
```

If `ResultAlert` does not accept children at execution time, update it in `src/components/common/ResultAlert.tsx` to:

```tsx
interface Props {
  result: ResultMessage | null;
  warning?: boolean;
  className?: string;
  children?: React.ReactNode;
}

export default function ResultAlert({ result, warning = false, className, children }: Props) {
  if (!result) return null;

  const color = warning ? "yellow" : result.ok ? "green" : "red";
  const Icon = warning ? IconInfoCircle : result.ok ? IconCheck : IconAlertCircle;

  return (
    <Alert className={className} color={color} icon={<Icon size={16} />} radius="md" variant="light">
      <div>{result.msg}</div>
      {children}
    </Alert>
  );
}
```

- [ ] **Step 7: Keep behavior handlers unchanged**

After the presentation changes, verify these identifiers still exist in `src/components/PairConnect.tsx`:

- `handleConnectIpChange`
- `handleConnectPortChange`
- `handlePair`
- `handleConnect`
- `fillConnectEndpoint`
- `savePairConnect`
- `handleMdnsConnect`
- `handleMdnsPair`
- `handleMdnsAutoConnect`
- `handleScan`

- [ ] **Step 8: Build**

Run:

```bash
npm run build
```

Expected:

- Pair/connect logic still type-checks.
- No Tauri invoke name changes.
- `discoverMdns`, `handleAutoConnect`, `handleMdnsConnect`, `handleMdnsPair`, `handlePair`, and `handleConnect` remain in the file.

---

## Task 9: Manual UI Verification

**Files:**

- No file changes.

- [ ] **Step 1: Start dev server**

Run:

```bash
npm run dev
```

Expected:

- Vite prints a local URL.
- The process remains running for browser verification.

- [ ] **Step 2: Open the app in Browser**

Open the Vite URL and verify:

- The left rail is visible.
- The device panel is visible.
- Tool navigation changes the active page.
- Settings opens as a Mantine modal.
- Existing complex pages still render inside the new shell.

- [ ] **Step 3: Verify core workflows manually**

Run through:

- Device refresh.
- Device selection.
- Device note edit, blur, reload.
- Settings language switch and save.
- Screenshot directory change.
- Screenshot action and reveal button.
- Screen record start disabled with no selected device.
- Screen record start/stop with a selected device when a device is available.
- Pair/connect manual form values persist.
- mDNS scan button still runs without duplicate concurrent operations.

- [ ] **Step 4: Stop dev server**

Stop the `npm run dev` session with Ctrl+C after verification.

---

## Task 10: Final Verification And Graph Update

**Files:**

- Modify: `graphify-out/` generated graph files.

- [ ] **Step 1: Build**

Run:

```bash
npm run build
```

Expected:

- TypeScript passes.
- Vite build passes.

- [ ] **Step 2: Update graphify**

Run:

```bash
graphify update .
```

Expected:

- Graphify completes without API cost.
- `graphify-out/` reflects the changed frontend files.

- [ ] **Step 3: Inspect git status**

Run:

```bash
git status --short
```

Expected:

- Relevant tracked/untracked files are visible.
- `.superpowers/` visual brainstorming artifacts are not included in implementation changes.
- Existing unrelated untracked files such as `.claude/` and `baidu_search_screenshot.png` remain untouched.

- [ ] **Step 4: Summarize**

Report:

- What changed.
- Which workflows were verified.
- Any manual workflow that could not be tested because no Android device was available.

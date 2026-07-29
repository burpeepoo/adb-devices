import { Accordion, Badge, Button, Group, Paper, SimpleGrid, Stack, Text, TextInput, ThemeIcon, Tooltip } from "@mantine/core";
import {
  IconActivityHeartbeat,
  IconBolt,
  IconBug,
  IconCamera,
  IconClipboard,
  IconDeviceMobile,
  IconDeviceMobileCode,
  IconDeviceTablet,
  IconDeviceTv,
  IconDevicesPc,
  IconListDetails,
  IconMessageCircle,
  IconPackages,
  IconPhotoUp,
  IconPlugConnected,
  IconRobot,
  IconStethoscope,
  IconTerminal2,
  IconVideo,
} from "@tabler/icons-react";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { classifyDeviceFormFactor, type DeviceFormFactor } from "../deviceFormFactor";
import { deviceIdentityKey, type DeviceNotes } from "../deviceNotes";
import type { DeviceInfo, DeviceSummary, TabKey } from "../types";
import SectionTitle from "./common/SectionTitle";
import PairConnect from "./PairConnect";

interface Props {
  devices: DeviceInfo[];
  selectedDeviceSerial: string | null;
  deviceNotes: DeviceNotes;
  onConnected: () => void | Promise<DeviceInfo[] | void>;
  onSelectTool: (tool: TabKey) => void;
  onOpenScout: (mode: "chat" | "walkthrough" | "bug_repro") => void;
  onDeviceNoteChange: (device: DeviceInfo, note: string) => void;
}

export default function DeviceConsole({
  devices,
  selectedDeviceSerial,
  deviceNotes,
  onConnected,
  onSelectTool,
  onOpenScout,
  onDeviceNoteChange,
}: Props) {
  const { t } = useTranslation();
  const [editingNote, setEditingNote] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [summary, setSummary] = useState<DeviceSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const selectedDevice = useMemo(
    () => devices.find((device) => device.serial === selectedDeviceSerial) || null,
    [devices, selectedDeviceSerial],
  );
  const selectedOnlineSerial = selectedDevice?.state === "device" ? selectedDevice.serial : null;
  const identity = selectedDevice ? deviceIdentityKey(selectedDevice) : "";
  const note = identity ? deviceNotes[identity]?.trim() || "" : "";
  const title = note || identity;

  useEffect(() => {
    if (!editingNote) {
      setNoteDraft(note);
    }
  }, [editingNote, note]);

  useEffect(() => {
    let cancelled = false;
    setSummary(null);
    setSummaryError(null);

    if (!selectedOnlineSerial) {
      setSummaryLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setSummaryLoading(true);
    invoke<DeviceSummary>("adb_device_summary", { deviceSerial: selectedOnlineSerial })
      .then((nextSummary) => {
        if (!cancelled) {
          setSummary(nextSummary);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setSummaryError(String(error));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setSummaryLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedOnlineSerial]);

  if (!selectedDevice) {
    return (
      <Stack maw={1040} gap="md">
        <Paper withBorder radius="md" p="md">
          <SectionTitle icon={<IconPlugConnected size={17} />} label={t("deviceConsole.connectTitle")} />
          <Text size="sm" c="dimmed" mt={4}>
            {t("deviceConsole.connectDesc")}
          </Text>
        </Paper>
        <PairConnect devices={devices} onConnected={onConnected} />
      </Stack>
    );
  }

  const statusColor = selectedDevice.state === "device" ? "green" : selectedDevice.state === "unauthorized" ? "yellow" : "red";
  const formFactor = classifyDeviceFormFactor(
    summary?.display_size || "",
    summary?.display_density || "",
    summary?.display_physical_size_mm || "",
  );
  const DeviceIcon = deviceIcon(formFactor);

  const saveNote = () => {
    onDeviceNoteChange(selectedDevice, noteDraft);
    setEditingNote(false);
  };

  const cancelNoteEdit = () => {
    setNoteDraft(note);
    setEditingNote(false);
  };

  return (
    <Stack className="device-console-root" gap="md">
      <Paper withBorder radius="md" p="md" className="device-console-hero">
        <Group justify="space-between" gap="md" align="flex-start">
          <Group gap="sm" align="flex-start" wrap="nowrap" style={{ minWidth: 0, flex: 1 }}>
            <Tooltip label={t(formFactorLabelKey(formFactor))} openDelay={70} withArrow>
              <ThemeIcon variant="light" color={formFactorColor(formFactor)} size={38} radius="md" style={{ flex: "0 0 auto" }}>
                <DeviceIcon size={21} />
              </ThemeIcon>
            </Tooltip>
            <div style={{ minWidth: 0 }}>
              {editingNote ? (
                <Group gap="xs" align="flex-start" wrap="nowrap">
                  <TextInput
                    value={noteDraft}
                    onChange={(event) => setNoteDraft(event.currentTarget.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") saveNote();
                      if (event.key === "Escape") cancelNoteEdit();
                    }}
                    placeholder={t("deviceConsole.notePlaceholder")}
                    aria-label={t("deviceConsole.notePlaceholder")}
                    autoFocus
                    style={{ minWidth: 260 }}
                  />
                  <Button onClick={saveNote}>{t("deviceConsole.saveNote")}</Button>
                  <Button variant="subtle" color="gray" onClick={cancelNoteEdit}>
                    {t("deviceConsole.cancelEdit")}
                  </Button>
                </Group>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setNoteDraft(note);
                    setEditingNote(true);
                  }}
                  style={{
                    maxWidth: "100%",
                    padding: 0,
                    border: 0,
                    background: "transparent",
                    cursor: "text",
                    textAlign: "left",
                  }}
                >
                  <Tooltip
                    label={title}
                    disabled={!title}
                    openDelay={70}
                    closeDelay={0}
                    withArrow
                    multiline
                    styles={{ tooltip: { maxWidth: 520, wordBreak: "break-word" } }}
                  >
                    <Text fw={750} size="lg" truncate>
                      {title}
                    </Text>
                  </Tooltip>
                </button>
              )}
              {note && (
                <Tooltip
                  label={identity}
                  disabled={!identity}
                  openDelay={70}
                  closeDelay={0}
                  withArrow
                  multiline
                  styles={{ tooltip: { maxWidth: 520, wordBreak: "break-word" } }}
                >
                  <Text size="xs" c="dimmed" mt={2} truncate>
                    {identity}
                  </Text>
                </Tooltip>
              )}
            </div>
          </Group>
          <Group gap="xs">
            <Badge color={statusColor} variant="light">
              {selectedDevice.state}
            </Badge>
            <ConnectionBadge type={selectedDevice.connection_type} />
          </Group>
        </Group>

        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="sm" mt="md" className="device-console-identity-grid">
          <InfoField label={t("deviceConsole.adbSerial")} value={selectedDevice.serial} />
          <InfoField label={t("deviceConsole.deviceSn")} value={selectedDevice.device_sn} />
          <InfoField label={t("deviceConsole.model")} value={selectedDevice.model} />
          <InfoField label={t("deviceConsole.product")} value={selectedDevice.product} />
          <InfoField label={t("deviceConsole.connection")} value={connectionLabel(t, selectedDevice.connection_type)} />
          <InfoField label={t("deviceConsole.state")} value={selectedDevice.state} />
        </SimpleGrid>
      </Paper>

      <Paper withBorder radius="md" p="md" className="device-console-section">
        <SectionTitle icon={<IconRobot size={17} />} label={t("deviceConsole.scoutTasks")} mb="md" />
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
          <button type="button" className="device-console-task-card" onClick={() => onOpenScout("chat")}>
            <span className="device-console-task-icon">
              <IconMessageCircle size={22} />
            </span>
            <span className="device-console-task-copy">
              <Text fw={850} size="lg">
                {t("deviceConsole.taskChatTitle")}
              </Text>
            </span>
          </button>
          <button type="button" className="device-console-task-card" onClick={() => onOpenScout("walkthrough")}>
            <span className="device-console-task-icon">
              <IconRobot size={22} />
            </span>
            <span className="device-console-task-copy">
              <Text fw={850} size="lg">
                {t("deviceConsole.taskWalkthroughTitle")}
              </Text>
            </span>
          </button>
          <button type="button" className="device-console-task-card" onClick={() => onOpenScout("bug_repro")}>
            <span className="device-console-task-icon">
              <IconBug size={22} />
            </span>
            <span className="device-console-task-copy">
              <Text fw={850} size="lg">
                {t("deviceConsole.taskBugReproTitle")}
              </Text>
            </span>
          </button>
        </SimpleGrid>
      </Paper>

      <Paper withBorder radius="md" p="md" className="device-console-section">
        <SectionTitle icon={<IconBolt size={17} />} label={t("deviceConsole.workflowTools")} mb="sm" />
        <SimpleGrid cols={{ base: 1, lg: 3 }} spacing="md" className="device-console-tool-groups">
          {buildToolGroups(t).map((group) => (
            <Stack key={group.title} gap="sm" className="device-console-tool-group">
              <Text fw={800} ta="left">
                {group.title}
              </Text>
              <SimpleGrid cols={1} spacing="xs" className="device-console-tool-grid">
                {group.tools.map((tool) => {
                  const Icon = tool.icon;
                  return (
                    <Button
                      key={tool.key}
                      variant="default"
                      leftSection={<Icon size={16} />}
                      onClick={() => onSelectTool(tool.key)}
                      justify="flex-start"
                      mih={40}
                    >
                      {tool.label}
                    </Button>
                  );
                })}
              </SimpleGrid>
            </Stack>
          ))}
        </SimpleGrid>
      </Paper>

      <Accordion variant="separated" className="device-console-details">
        <Accordion.Item value="diagnostics">
          <Accordion.Control>
            <Group gap={8} wrap="nowrap">
              <IconStethoscope size={16} />
              <span>{t("deviceConsole.diagnostics")}</span>
            </Group>
          </Accordion.Control>
          <Accordion.Panel>
            {summaryLoading && (
              <Text size="xs" c="dimmed">
                {t("deviceConsole.loadingStatus")}
              </Text>
            )}
            {summaryError && (
              <Text size="xs" c="red">
                {t("deviceConsole.statusFailed")}
              </Text>
            )}
            {!summaryLoading && !summaryError && (
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                <InfoField label={t("deviceConsole.securityPatch")} value={summary?.security_patch} />
                <InfoField label={t("deviceConsole.selinux")} value={summary?.selinux} />
                <InfoField label={t("deviceConsole.uptime")} value={summary?.uptime} />
                <InfoField label={t("deviceConsole.cpuAbi")} value={summary?.cpu_abi} />
                <InfoField label={t("deviceConsole.verifiedBoot")} value={summary?.verified_boot_state} />
                <InfoField label={t("deviceConsole.vbmeta")} value={summary?.vbmeta_device_state} />
                <InfoField label={t("deviceConsole.bootloader")} value={summary?.bootloader_state} />
                <InfoField label={t("deviceConsole.buildFingerprint")} value={summary?.build_fingerprint} />
              </SimpleGrid>
            )}
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>

      <Accordion variant="separated">
        <Accordion.Item value="connection">
          <Accordion.Control>
            <Group gap={8} wrap="nowrap">
              <IconPlugConnected size={16} />
              <span>{t("deviceConsole.connectTitle")}</span>
            </Group>
          </Accordion.Control>
          <Accordion.Panel>
            <PairConnect devices={devices} onConnected={onConnected} />
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
    </Stack>
  );
}

function buildToolGroups(t: (key: string) => string) {
  return [
    {
      title: t("deviceConsole.captureTools"),
      tools: [
        { key: "screenshot" as const, label: t("tabs.screenshot"), icon: IconCamera },
        { key: "record" as const, label: t("tabs.screenRecord"), icon: IconVideo },
        { key: "mirror" as const, label: t("tabs.screenMirror"), icon: IconDevicesPc },
        { key: "remote" as const, label: t("tabs.remoteControl"), icon: IconDeviceMobileCode },
      ],
    },
    {
      title: t("deviceConsole.diagnosticTools"),
      tools: [
        { key: "workbench" as const, label: t("tabs.workbench"), icon: IconTerminal2 },
        { key: "logcat" as const, label: t("tabs.logcat"), icon: IconListDetails },
        { key: "performance" as const, label: t("tabs.performance"), icon: IconActivityHeartbeat },
        { key: "clipboard" as const, label: t("tabs.clipboard"), icon: IconClipboard },
      ],
    },
    {
      title: t("deviceConsole.appTools"),
      tools: [
        { key: "install" as const, label: t("tabs.apkInstall"), icon: IconBolt },
        { key: "packages" as const, label: t("tabs.packageList"), icon: IconPackages },
        { key: "imageCast" as const, label: t("tabs.imageCast"), icon: IconPhotoUp },
      ],
    },
  ];
}

function InfoField({ label, value }: { label: string; value?: string | null }) {
  const { t } = useTranslation();
  const displayValue = value || t("deviceConsole.unknown");
  return (
    <div style={{ minWidth: 0 }}>
      <Text size="10px" fw={700} tt="uppercase" c="dimmed">
        {label}
      </Text>
      <Tooltip
        label={value}
        disabled={!value}
        openDelay={70}
        closeDelay={0}
        withArrow
        multiline
        styles={{ tooltip: { maxWidth: 520, wordBreak: "break-word" } }}
      >
        <Text size="sm" fw={600} truncate>
          {displayValue}
        </Text>
      </Tooltip>
    </div>
  );
}

function ConnectionBadge({ type }: { type: DeviceInfo["connection_type"] }) {
  const { t } = useTranslation();
  const color = type === "wireless" ? "blue" : type === "usb" ? "gray" : "yellow";
  return (
    <Badge color={color} variant="light">
      {connectionLabel(t, type)}
    </Badge>
  );
}

function connectionLabel(t: (key: string) => string, type: DeviceInfo["connection_type"]) {
  if (type === "wireless") return t("deviceList.wireless");
  if (type === "usb") return t("deviceList.usb");
  return t("deviceList.unknown");
}

function deviceIcon(formFactor: DeviceFormFactor) {
  if (formFactor === "largeScreen") return IconDeviceTv;
  if (formFactor === "tablet") return IconDeviceTablet;
  return IconDeviceMobile;
}

function formFactorColor(formFactor: DeviceFormFactor) {
  if (formFactor === "largeScreen") return "violet";
  if (formFactor === "tablet") return "blue";
  return "gray";
}

function formFactorLabelKey(formFactor: DeviceFormFactor) {
  if (formFactor === "largeScreen") return "deviceConsole.largeScreen";
  if (formFactor === "tablet") return "deviceConsole.tablet";
  return "deviceConsole.phone";
}

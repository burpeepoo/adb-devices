import { Accordion, Badge, Group, Paper, SimpleGrid, Stack, Text } from "@mantine/core";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { getStore, STORE_KEYS } from "../storage";
import type { DeviceInfo, TabKey } from "../types";
import DeviceConsoleShortcuts from "./DeviceConsoleShortcuts";
import PairConnect from "./PairConnect";

interface Props {
  devices: DeviceInfo[];
  selectedDeviceSerial: string | null;
  onConnected: () => void | Promise<void>;
  onSelectTool: (tool: TabKey) => void;
}

type DeviceNotes = Record<string, string>;

export default function DeviceConsole({ devices, selectedDeviceSerial, onConnected, onSelectTool }: Props) {
  const { t } = useTranslation();
  const [deviceNotes, setDeviceNotes] = useState<DeviceNotes>({});
  const selectedDevice = useMemo(
    () => devices.find((device) => device.serial === selectedDeviceSerial) || null,
    [devices, selectedDeviceSerial],
  );

  useEffect(() => {
    getStore()
      .then((store) => store.get<DeviceNotes>(STORE_KEYS.deviceNotes))
      .then((saved) => setDeviceNotes(saved || {}))
      .catch(() => undefined);
  }, []);

  if (!selectedDevice) {
    return (
      <Stack maw={1040} gap="md">
        <Paper withBorder radius="md" p="md">
          <Text fw={700}>{t("deviceConsole.connectTitle")}</Text>
          <Text size="sm" c="dimmed" mt={4}>
            {t("deviceConsole.connectDesc")}
          </Text>
        </Paper>
        <PairConnect devices={devices} onConnected={onConnected} />
      </Stack>
    );
  }

  const identity = deviceIdentityKey(selectedDevice);
  const note = deviceNotes[identity]?.trim();
  const title = note || identity;
  const statusColor = selectedDevice.state === "device" ? "green" : selectedDevice.state === "unauthorized" ? "yellow" : "red";

  return (
    <Stack maw={1040} gap="md">
      <Paper withBorder radius="md" p="md">
        <Group justify="space-between" gap="md" align="flex-start">
          <div style={{ minWidth: 0 }}>
            <Text fw={750} size="lg" truncate title={title}>
              {title}
            </Text>
            {note && (
              <Text size="xs" c="dimmed" mt={2} truncate title={identity}>
                {identity}
              </Text>
            )}
          </div>
          <Group gap="xs">
            <Badge color={statusColor} variant="light">
              {selectedDevice.state}
            </Badge>
            <ConnectionBadge type={selectedDevice.connection_type} />
          </Group>
        </Group>

        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="sm" mt="md">
          <InfoField label={t("deviceConsole.adbSerial")} value={selectedDevice.serial} />
          <InfoField label={t("deviceConsole.deviceSn")} value={selectedDevice.device_sn} />
          <InfoField label={t("deviceConsole.model")} value={selectedDevice.model} />
          <InfoField label={t("deviceConsole.product")} value={selectedDevice.product} />
          <InfoField label={t("deviceConsole.connection")} value={connectionLabel(t, selectedDevice.connection_type)} />
          <InfoField label={t("deviceConsole.state")} value={selectedDevice.state} />
        </SimpleGrid>
      </Paper>

      <Paper withBorder radius="md" p="md">
        <Text fw={700} mb="sm">
          {t("deviceConsole.shortcuts")}
        </Text>
        <DeviceConsoleShortcuts onSelectTool={onSelectTool} />
      </Paper>

      <Paper withBorder radius="md" p="md">
        <Text fw={700}>{t("deviceConsole.status")}</Text>
        <Text size="sm" c="dimmed" mt={4}>
          {t("deviceConsole.summaryPending")}
        </Text>
      </Paper>

      <Accordion variant="separated">
        <Accordion.Item value="diagnostics">
          <Accordion.Control>{t("deviceConsole.diagnostics")}</Accordion.Control>
          <Accordion.Panel>
            <Stack gap={8}>
              <InfoField label={t("deviceConsole.adbSerial")} value={selectedDevice.serial} />
              <InfoField label={t("deviceConsole.deviceSn")} value={selectedDevice.device_sn} />
              <InfoField label={t("deviceConsole.model")} value={selectedDevice.model} />
              <InfoField label={t("deviceConsole.product")} value={selectedDevice.product} />
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>
        <Accordion.Item value="connection">
          <Accordion.Control>{t("deviceConsole.connectTitle")}</Accordion.Control>
          <Accordion.Panel>
            <PairConnect devices={devices} onConnected={onConnected} />
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
    </Stack>
  );
}

function InfoField({ label, value }: { label: string; value?: string | null }) {
  const { t } = useTranslation();
  return (
    <div style={{ minWidth: 0 }}>
      <Text size="10px" fw={700} tt="uppercase" c="dimmed">
        {label}
      </Text>
      <Text size="sm" fw={600} truncate title={value || undefined}>
        {value || t("deviceConsole.unknown")}
      </Text>
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

function deviceIdentityKey(device: DeviceInfo) {
  return device.device_sn || device.serial;
}

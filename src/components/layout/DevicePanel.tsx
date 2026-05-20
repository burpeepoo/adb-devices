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

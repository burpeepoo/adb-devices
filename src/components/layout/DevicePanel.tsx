import { ActionIcon, Box, Group, ScrollArea, Stack, Text, TextInput, Tooltip } from "@mantine/core";
import { IconRefresh, IconSearch } from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { deviceIdentityKey, type DeviceNotes } from "../../deviceNotes";
import type { DeviceInfo } from "../../types";
import "./DevicePanel.css";

interface Props {
  devices: DeviceInfo[];
  loading: boolean;
  error: string | null;
  selectedDevice: string | null;
  mirroringDeviceSerial: string | null;
  deviceNotes: DeviceNotes;
  onSelectDevice: (serial: string) => void;
  onDeviceNoteChange: (device: DeviceInfo, note: string) => void;
  onRefresh: () => void;
}

export default function DevicePanel({
  devices,
  loading,
  error,
  selectedDevice,
  mirroringDeviceSerial,
  deviceNotes,
  onSelectDevice,
  onDeviceNoteChange,
  onRefresh,
}: Props) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");

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

  return (
    <Stack className="device-panel" h="100%" gap={0}>
      <Box className="device-panel__header">
        <Group justify="space-between" mb="xs" wrap="nowrap">
          <Text className="device-panel__title" size="sm" fw={800}>
            {t("deviceList.title")}
          </Text>
          <Tooltip label={t("deviceList.refresh")} withArrow>
            <ActionIcon className="device-panel__refresh" aria-label={t("deviceList.refresh")} variant="subtle" loading={loading} onClick={onRefresh}>
              <IconRefresh size={17} />
            </ActionIcon>
          </Tooltip>
        </Group>
        <TextInput
          className="device-panel__search"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          leftSection={<IconSearch size={14} />}
          placeholder={t("layout.searchDevices")}
        />
      </Box>

      {error && (
        <Box className="device-panel__error">
          <Text size="xs">
            {error}
          </Text>
        </Box>
      )}

      <ScrollArea className="device-panel__scroll">
        <Stack className="device-panel__list" gap={8}>
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
              onNoteChange={(note) => onDeviceNoteChange(device, note)}
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
              onNoteChange={(note) => onDeviceNoteChange(device, note)}
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
    <Text className="device-panel__section" size="xs" fw={700}>
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
      className={`device-panel-row${selected ? " is-selected" : ""}${online ? "" : " is-offline"}`}
    >
      <Group align="flex-start" gap="xs" wrap="nowrap">
        <Box
          className={`device-panel-row__status${online ? " is-online" : " is-offline"}`}
        />
        <Box className="device-panel-row__body">
          <button
            type="button"
            onClick={onSelect}
            disabled={!online}
            className="device-panel-row__button"
          >
            <Group gap={8} wrap="nowrap">
              <Text className="device-panel-row__title" size="sm" fw={selected ? 800 : 700} truncate title={title}>
                {title}
              </Text>
              <ConnectionLabel type={device.connection_type} />
              {mirroring && <span className="device-panel-row__inline-state is-mirroring">{t("deviceList.mirroring")}</span>}
            </Group>
            <Text className="device-panel-row__meta" size="xs" truncate title={device.serial}>
              {t("deviceList.adb")}: {device.serial}
            </Text>
            {device.model && (
              <Text className="device-panel-row__meta" size="xs" truncate title={device.model}>
                {t("deviceList.model")}: {device.model}
              </Text>
            )}
          </button>

          {editing ? (
            <TextInput
              className="device-panel-row__note-input"
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
              className={`device-panel-row__note${note ? " has-note" : ""}`}
              onClick={(event) => {
                event.stopPropagation();
                setDraft(note);
                setEditing(true);
              }}
            >
              <Text size="xs">
                {note || t("deviceList.addNote")}
              </Text>
            </Box>
          )}
        </Box>
      </Group>
    </Box>
  );
}

function ConnectionLabel({ type }: { type: DeviceInfo["connection_type"] }) {
  const { t } = useTranslation();
  if (type === "wireless") {
    return (
      <span className="device-panel-row__connection is-wireless">
        {t("deviceList.wireless")}
      </span>
    );
  }
  if (type === "usb") {
    return (
      <span className="device-panel-row__connection is-usb">
        {t("deviceList.usb")}
      </span>
    );
  }
  return (
    <span className="device-panel-row__connection is-unknown">
      {t("deviceList.unknown")}
    </span>
  );
}

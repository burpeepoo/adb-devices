import { Badge, Group, Paper, Stack, Text } from "@mantine/core";
import { IconAlertTriangle, IconDeviceMobile } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import type { DeviceTargetState } from "../../deviceTarget.ts";

interface Props {
  target: DeviceTargetState;
  className?: string;
}

export default function DeviceTargetBanner({ target, className }: Props) {
  const { t } = useTranslation();
  const ready = target.status === "ready";
  const messageKey =
    target.blockReason === "selected-device-not-online"
      ? "deviceTarget.selectedUnavailable"
      : "deviceTarget.selectOnlineDevice";

  return (
    <Paper
      withBorder
      radius="md"
      p="sm"
      className={className}
      bg={ready ? "green.0" : "yellow.0"}
      style={{ borderColor: ready ? "var(--mantine-color-green-2)" : "var(--mantine-color-yellow-3)" }}
    >
      <Group gap="sm" align="flex-start" wrap="nowrap">
        {ready ? <IconDeviceMobile size={18} /> : <IconAlertTriangle size={18} />}
        <Stack gap={3} style={{ minWidth: 0, flex: 1 }}>
          <Group gap="xs" wrap="nowrap">
            <Text size="xs" fw={700} c={ready ? "green.9" : "yellow.9"}>
              {t("deviceTarget.title")}
            </Text>
            <Badge size="xs" color={ready ? "green" : "yellow"} variant="light">
              {ready ? t("deviceTarget.ready") : t("deviceTarget.blocked")}
            </Badge>
          </Group>

          {ready ? (
            <>
              <Text size="sm" fw={700} truncate>
                {target.label}
              </Text>
              <Text size="xs" c="dimmed" truncate>
                {[target.identity, target.model, target.product, connectionLabel(t, target.connectionType)]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
            </>
          ) : (
            <Text size="sm" c="yellow.9">
              {t(messageKey, { count: target.onlineDeviceCount })}
            </Text>
          )}
        </Stack>
      </Group>
    </Paper>
  );
}

function connectionLabel(t: ReturnType<typeof useTranslation>["t"], connectionType: DeviceTargetState["connectionType"]) {
  if (!connectionType) return "";
  return t(`deviceTarget.connection.${connectionType}`);
}

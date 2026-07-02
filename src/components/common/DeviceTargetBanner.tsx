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
      px="sm"
      py="xs"
      className={`device-target-banner${className ? ` ${className}` : ""}`}
      style={{
        background: "var(--color-cloud)",
        borderColor: ready ? "var(--color-edge)" : "var(--color-citrus)",
      }}
    >
      <Group gap="sm" align="flex-start" wrap="nowrap">
        {ready ? <IconDeviceMobile size={18} color="var(--color-indigo)" /> : <IconAlertTriangle size={18} color="var(--color-citrus)" />}
        <Stack gap={3} style={{ minWidth: 0, flex: 1 }}>
          <Group gap="xs" wrap="nowrap">
            <Text size="xs" fw={700} style={{ color: ready ? "var(--text-strong)" : "var(--color-citrus)" }}>
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
            <Text size="sm" style={{ color: "var(--color-citrus)" }}>
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

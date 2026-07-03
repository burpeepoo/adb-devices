import { Group, Text } from "@mantine/core";
import type { DeviceInfo } from "../../types";

interface Props {
  devices: DeviceInfo[];
  adbReadyLabel: string;
  countLabel: string;
  autoRefreshLabel: string;
}

export default function StatusBar({ adbReadyLabel, countLabel, autoRefreshLabel }: Props) {
  return (
    <Group
      h={28}
      px="md"
      justify="space-between"
      wrap="nowrap"
      style={{
        minWidth: 0,
        border: "var(--border-hairline)",
        borderRadius: "var(--radius-pill)",
        background: "var(--color-cloud)",
        boxShadow: "var(--shadow-tier-1)",
      }}
    >
      <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
        <Text size="xs" c="dimmed">
          {adbReadyLabel}
        </Text>
        <Text size="xs" c="dimmed" truncate>
          {countLabel}
        </Text>
      </Group>
      <Text size="xs" c="dimmed" truncate style={{ flex: "0 1 auto" }}>
        {autoRefreshLabel}
      </Text>
    </Group>
  );
}

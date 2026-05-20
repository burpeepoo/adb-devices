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

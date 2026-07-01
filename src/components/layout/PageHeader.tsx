import { Badge, Group, Paper, Text } from "@mantine/core";
import type { ReactNode } from "react";

interface Props {
  selectedDeviceLabel: string;
  selectedDeviceValue: string;
  actions?: ReactNode;
}

export default function PageHeader({ selectedDeviceLabel, selectedDeviceValue, actions }: Props) {
  return (
    <Paper
      className="app-page-header"
      px="md"
      py="xs"
      withBorder
      style={{
        flex: "0 0 auto",
        marginBottom: 12,
      }}
    >
      <Group justify="space-between" gap="md" wrap="nowrap">
        <Group gap={6} style={{ minWidth: 0 }}>
          <Text size="xs" c="dimmed">
            {selectedDeviceLabel}
          </Text>
          <Badge variant="light" color="gray" style={{ minWidth: 0 }}>
            {selectedDeviceValue}
          </Badge>
        </Group>
        {actions}
      </Group>
    </Paper>
  );
}

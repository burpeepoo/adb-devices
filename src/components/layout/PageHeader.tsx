import { Badge, Group, Paper, Text } from "@mantine/core";
import type { ReactNode } from "react";

interface Props {
  selectedDeviceLabel: string;
  selectedDeviceValue: string;
  actions?: ReactNode;
}

export default function PageHeader({ selectedDeviceLabel, selectedDeviceValue, actions }: Props) {
  return (
    <Paper radius={0} px="md" py="sm" withBorder style={{ borderLeft: 0, borderRight: 0, borderTop: 0 }}>
      <Group justify="space-between" gap="md" wrap="nowrap">
        <Group gap={6} style={{ minWidth: 0 }}>
          <Text size="xs" c="dimmed">
            {selectedDeviceLabel}
          </Text>
          <Badge variant="light" color="gray" radius="sm" style={{ minWidth: 0 }}>
            {selectedDeviceValue}
          </Badge>
        </Group>
        {actions}
      </Group>
    </Paper>
  );
}

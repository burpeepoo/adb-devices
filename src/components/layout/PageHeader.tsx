import { Badge, Group, Paper, Stack, Text, Title } from "@mantine/core";
import type { ReactNode } from "react";

interface Props {
  title: string;
  selectedDeviceLabel: string;
  selectedDeviceValue: string;
  actions?: ReactNode;
}

export default function PageHeader({ title, selectedDeviceLabel, selectedDeviceValue, actions }: Props) {
  return (
    <Paper radius={0} px="md" py="sm" withBorder style={{ borderLeft: 0, borderRight: 0, borderTop: 0 }}>
      <Group justify="space-between" gap="md" wrap="nowrap">
        <Stack gap={2} style={{ minWidth: 0 }}>
          <Title order={3} size="h4">
            {title}
          </Title>
          <Group gap={6}>
            <Text size="xs" c="dimmed">
              {selectedDeviceLabel}
            </Text>
            <Badge variant="light" color="gray" radius="sm">
              {selectedDeviceValue}
            </Badge>
          </Group>
        </Stack>
        {actions}
      </Group>
    </Paper>
  );
}

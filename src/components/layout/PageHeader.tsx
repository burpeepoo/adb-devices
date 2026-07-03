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
      <Group justify="space-between" gap="sm" wrap="wrap">
        <Group gap={8} style={{ minWidth: 0, flex: "1 1 260px" }}>
          <Text size="xs" c="dimmed">
            {selectedDeviceLabel}
          </Text>
          <Badge
            variant="light"
            color="gray"
            style={{
              minWidth: 0,
              maxWidth: "min(58vw, 520px)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {selectedDeviceValue}
          </Badge>
        </Group>
        {actions ? <Group gap="xs" wrap="wrap">{actions}</Group> : null}
      </Group>
    </Paper>
  );
}

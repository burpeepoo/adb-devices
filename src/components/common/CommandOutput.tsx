import { Box, Group, Text } from "@mantine/core";
import type { ReactNode } from "react";

interface Props {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  maxHeight?: number;
}

export default function CommandOutput({ title, action, children, maxHeight = 220 }: Props) {
  return (
    <Box
      style={{
        border: "var(--border-hairline)",
        borderRadius: "var(--radius-card)",
        overflow: "hidden",
        background: "var(--color-cloud)",
        boxShadow: "none",
      }}
    >
      <Group justify="space-between" px="md" py={10} style={{ borderBottom: "var(--border-hairline)" }}>
        <Text size="xs" fw={600} c="dimmed">
          {title}
        </Text>
        {action}
      </Group>
      <Box
        component="pre"
        m={0}
        p="sm"
        style={{
          maxHeight,
          overflow: "auto",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          background: "var(--surface-sunken)",
          color: "var(--text-strong)",
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
          fontSize: 12,
          lineHeight: 1.6,
        }}
      >
        {children}
      </Box>
    </Box>
  );
}

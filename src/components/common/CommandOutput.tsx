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
        border: "1px solid var(--mantine-color-gray-3)",
        borderRadius: "var(--mantine-radius-md)",
        overflow: "hidden",
        background: "var(--mantine-color-white)",
      }}
    >
      <Group justify="space-between" px="sm" py={7} style={{ borderBottom: "1px solid var(--mantine-color-gray-2)" }}>
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
          background: "#111827",
          color: "#e5f0ff",
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

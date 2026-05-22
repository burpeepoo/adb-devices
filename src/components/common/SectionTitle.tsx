import { Group, Text, ThemeIcon } from "@mantine/core";
import type { ReactNode } from "react";

interface Props {
  icon: ReactNode;
  label: ReactNode;
  description?: ReactNode;
  mb?: number | string;
  color?: string;
}

export default function SectionTitle({ icon, label, description, mb = 0, color = "blue" }: Props) {
  return (
    <Group gap={8} mb={mb} wrap="nowrap" align={description ? "flex-start" : "center"}>
      <ThemeIcon variant="light" color={color} size={28} radius="md" style={{ flex: "0 0 auto" }}>
        {icon}
      </ThemeIcon>
      <div style={{ minWidth: 0 }}>
        <Text fw={700}>{label}</Text>
        {description && (
          <Text size="xs" c="dimmed" mt={4}>
            {description}
          </Text>
        )}
      </div>
    </Group>
  );
}

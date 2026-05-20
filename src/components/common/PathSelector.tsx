import { Button, Group, Text, TextInput } from "@mantine/core";
import { IconFolder } from "@tabler/icons-react";

interface Props {
  label: string;
  value: string;
  emptyLabel: string;
  actionLabel: string;
  disabled?: boolean;
  onSelect: () => void;
}

export default function PathSelector({ label, value, emptyLabel, actionLabel, disabled = false, onSelect }: Props) {
  return (
    <div>
      <Text size="xs" fw={600} c="dimmed" mb={4}>
        {label}
      </Text>
      <Group gap="xs" wrap="nowrap" align="start">
        <TextInput value={value || emptyLabel} readOnly styles={{ input: { cursor: "default" } }} style={{ flex: 1 }} />
        <Button leftSection={<IconFolder size={15} />} variant="light" disabled={disabled} onClick={onSelect}>
          {actionLabel}
        </Button>
      </Group>
    </div>
  );
}

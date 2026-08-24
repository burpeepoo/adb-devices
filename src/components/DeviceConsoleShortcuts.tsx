import { Button, SimpleGrid } from "@mantine/core";
import { useTranslation } from "react-i18next";
import type { TabKey } from "../types";
import { toolIcons, toolLabelKeys } from "../toolMetadata";

interface Props {
  onSelectTool: (tool: TabKey) => void;
}

const SHORTCUT_TABS: TabKey[] = [
  "files",
  "install",
  "screenshot",
  "record",
  "mirror",
  "remote",
  "imageCast",
  "clipboard",
  "logcat",
  "agent",
  "performance",
  "packages",
];

export default function DeviceConsoleShortcuts({ onSelectTool }: Props) {
  const { t } = useTranslation();

  return (
    <SimpleGrid cols={{ base: 2, sm: 3, lg: 4 }} spacing="sm">
      {SHORTCUT_TABS.map((tab) => {
        const Icon = toolIcons[tab];
        return (
          <Button
            key={tab}
            variant="light"
            color="blue"
            leftSection={<Icon size={17} />}
            onClick={() => onSelectTool(tab)}
            justify="flex-start"
            h={42}
          >
            {t(toolLabelKeys[tab])}
          </Button>
        );
      })}
    </SimpleGrid>
  );
}

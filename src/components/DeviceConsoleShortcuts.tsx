import { Button, SimpleGrid } from "@mantine/core";
import { useTranslation } from "react-i18next";
import type { TabKey } from "../types";
import { toolIcons } from "./layout/ToolRail";

interface Props {
  onSelectTool: (tool: TabKey) => void;
}

const SHORTCUT_TABS: TabKey[] = [
  "install",
  "screenshot",
  "record",
  "mirror",
  "imageCast",
  "clipboard",
  "logcat",
  "packages",
];

const TAB_LABEL_KEYS: Record<TabKey, string> = {
  pair: "tabs.pairConnect",
  workbench: "tabs.workbench",
  install: "tabs.apkInstall",
  screenshot: "tabs.screenshot",
  record: "tabs.screenRecord",
  mirror: "tabs.screenMirror",
  imageCast: "tabs.imageCast",
  clipboard: "tabs.clipboard",
  logcat: "tabs.logcat",
  packages: "tabs.packageList",
};

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
            {t(TAB_LABEL_KEYS[tab])}
          </Button>
        );
      })}
    </SimpleGrid>
  );
}

import { ActionIcon, Box, Stack, Tooltip } from "@mantine/core";
import {
  IconAdjustmentsHorizontal,
  IconApps,
  IconCamera,
  IconClipboard,
  IconDeviceMobileCode,
  IconDevicesPc,
  IconListDetails,
  IconPhotoUp,
  IconPlugConnected,
  IconSettings,
  IconTerminal2,
  IconVideo,
} from "@tabler/icons-react";
import type { TabKey } from "../../types";

interface ToolConfig {
  key: TabKey;
  label: string;
  icon: typeof IconPlugConnected;
}

interface Props {
  tools: ToolConfig[];
  activeTool: TabKey;
  settingsLabel: string;
  onSelectTool: (tool: TabKey) => void;
  onOpenSettings: () => void;
}

export const toolIcons: Record<TabKey, ToolConfig["icon"]> = {
  pair: IconPlugConnected,
  workbench: IconTerminal2,
  install: IconApps,
  screenshot: IconCamera,
  record: IconVideo,
  mirror: IconDevicesPc,
  imageCast: IconPhotoUp,
  clipboard: IconClipboard,
  logcat: IconListDetails,
  packages: IconDeviceMobileCode,
};

export default function ToolRail({ tools, activeTool, settingsLabel, onSelectTool, onOpenSettings }: Props) {
  return (
    <Stack h="100%" align="center" gap={8} p={8}>
      {tools.map((tool) => {
        const Icon = tool.icon;
        const active = tool.key === activeTool;
        return (
          <Tooltip key={tool.key} label={tool.label} position="right" withArrow openDelay={250}>
            <ActionIcon
              aria-label={tool.label}
              variant={active ? "filled" : "subtle"}
              color={active ? "blue" : "gray"}
              size={44}
              radius="md"
              onClick={() => onSelectTool(tool.key)}
              styles={{
                root: {
                  color: active ? "white" : "var(--mantine-color-gray-4)",
                },
              }}
            >
              <Icon size={22} />
            </ActionIcon>
          </Tooltip>
        );
      })}
      <div style={{ flex: 1 }} />
      <Tooltip label={settingsLabel} position="right" withArrow openDelay={250}>
        <ActionIcon
          aria-label={settingsLabel}
          variant="subtle"
          color="gray"
          size={40}
          radius="md"
          onClick={onOpenSettings}
          styles={{
            root: {
              color: "var(--mantine-color-gray-4)",
            },
          }}
        >
          <IconSettings size={21} />
        </ActionIcon>
      </Tooltip>
      <Box
        aria-hidden="true"
        style={{
          width: 40,
          height: 40,
          display: "grid",
          placeItems: "center",
          color: "rgba(209, 213, 219, 0.6)",
        }}
      >
        <IconAdjustmentsHorizontal size={21} />
      </Box>
    </Stack>
  );
}

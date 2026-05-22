import { ActionIcon, Indicator, Stack, Tooltip } from "@mantine/core";
import {
  IconApps,
  IconBrandGithub,
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
  githubLabel: string;
  hasUpdate?: boolean;
  onSelectTool: (tool: TabKey) => void;
  onOpenSettings: () => void;
  onOpenGithub: () => void;
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

export default function ToolRail({
  tools,
  activeTool,
  settingsLabel,
  githubLabel,
  hasUpdate = false,
  onSelectTool,
  onOpenSettings,
  onOpenGithub,
}: Props) {
  return (
    <Stack h="100%" align="center" gap={8} p={8}>
      {tools.map((tool) => {
        const Icon = tool.icon;
        const active = tool.key === activeTool;
        return (
          <Tooltip key={tool.key} label={tool.label} position="right" withArrow openDelay={250}>
            <button
              type="button"
              aria-label={tool.label}
              onClick={() => onSelectTool(tool.key)}
              style={{
                width: active ? "100%" : 44,
                height: 44,
                alignSelf: active ? "stretch" : "center",
                border: 0,
                borderRadius: "var(--mantine-radius-md)",
                display: "flex",
                alignItems: "center",
                justifyContent: active ? "flex-start" : "center",
                gap: 8,
                padding: active ? "0 12px" : 0,
                color: active ? "white" : "var(--mantine-color-gray-4)",
                background: active ? "var(--mantine-color-blue-6)" : "transparent",
                cursor: "pointer",
                transition: "background 120ms ease, color 120ms ease",
              }}
            >
              <Icon size={22} style={{ flex: "0 0 auto" }} />
              {active && (
                <span
                  style={{
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    fontSize: 13,
                    fontWeight: 700,
                  }}
                >
                  {tool.label}
                </span>
              )}
            </button>
          </Tooltip>
        );
      })}
      <div style={{ flex: 1 }} />
      <Tooltip label={settingsLabel} position="right" withArrow openDelay={250}>
        <Indicator color="red" size={8} offset={7} disabled={!hasUpdate} position="top-end">
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
        </Indicator>
      </Tooltip>
      <Tooltip label={githubLabel} position="right" withArrow openDelay={250}>
        <ActionIcon
          aria-label={githubLabel}
          variant="subtle"
          color="gray"
          size={40}
          radius="md"
          onClick={onOpenGithub}
          styles={{
            root: {
              color: "var(--mantine-color-gray-4)",
            },
          }}
        >
          <IconBrandGithub size={21} />
        </ActionIcon>
      </Tooltip>
    </Stack>
  );
}

import { Indicator, Stack, Tooltip } from "@mantine/core";
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
import "./ToolRail.css";

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
  remote: IconDeviceMobileCode,
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
    <Stack h="100%" align="stretch" gap={6} p={8}>
      {tools.map((tool) => {
        const Icon = tool.icon;
        const active = tool.key === activeTool;
        return (
          <Tooltip key={tool.key} label={tool.label} position="right" withArrow openDelay={250}>
            <button
              type="button"
              aria-label={tool.label}
              className="tool-rail__button"
              data-active={active ? "true" : "false"}
              onClick={() => onSelectTool(tool.key)}
            >
              <Icon size={21} style={{ flex: "0 0 auto" }} />
              <span className="tool-rail__label">{tool.label}</span>
            </button>
          </Tooltip>
        );
      })}
      <div style={{ flex: 1 }} />
      <Indicator color="red" size={8} offset={8} disabled={!hasUpdate} position="top-end" style={{ width: "100%" }}>
        <button
          type="button"
          aria-label={settingsLabel}
          className="tool-rail__button tool-rail__button--utility"
          onClick={onOpenSettings}
        >
          <IconSettings size={21} style={{ flex: "0 0 auto" }} />
          <span className="tool-rail__label">{settingsLabel}</span>
        </button>
      </Indicator>
      <button
        type="button"
        aria-label={githubLabel}
        className="tool-rail__button tool-rail__button--utility"
        onClick={onOpenGithub}
      >
        <IconBrandGithub size={21} style={{ flex: "0 0 auto" }} />
        <span className="tool-rail__label">{githubLabel}</span>
      </button>
    </Stack>
  );
}

import { Indicator, Stack, Tooltip } from "@mantine/core";
import {
  IconBrandGithub,
  IconSettings,
} from "@tabler/icons-react";
import type { TabKey } from "../../types";
import type { ToolIcon } from "../../toolMetadata";
import "./ToolRail.css";

interface ToolConfig {
  key: TabKey;
  label: string;
  icon: ToolIcon;
  groupLabel?: string;
  emphasis?: "primary" | "tool";
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
  const renderedGroups: string[] = [];
  return (
    <Stack className="rail-card" h="100%" align="stretch" gap={4} p={8}>
      <div className="tool-rail__scroll">
        {tools.map((tool) => {
          const Icon = tool.icon;
          const active = tool.key === activeTool;
          const groupLabel = tool.groupLabel || "";
          const showGroupLabel = groupLabel && !renderedGroups.includes(groupLabel);
          if (showGroupLabel) {
            renderedGroups.push(groupLabel);
          }
          return (
            <div key={tool.key} className="tool-rail__item">
              {showGroupLabel ? <div className="tool-rail__section-label">{groupLabel}</div> : null}
              <Tooltip label={tool.label} position="right" withArrow openDelay={250}>
                <button
                  type="button"
                  aria-label={tool.label}
                  className="tool-rail__button"
                  data-active={active ? "true" : "false"}
                  data-emphasis={tool.emphasis || "tool"}
                  onClick={() => onSelectTool(tool.key)}
                >
                  <Icon size={tool.emphasis === "primary" ? 22 : 19} style={{ flex: "0 0 auto" }} />
                  <span className="tool-rail__label">{tool.label}</span>
                </button>
              </Tooltip>
            </div>
          );
        })}
      </div>
      <div className="tool-rail__footer">
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
      </div>
    </Stack>
  );
}

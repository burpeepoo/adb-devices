import { Stack, Tooltip } from "@mantine/core";
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
  const primaryTools = tools.filter((tool) => tool.emphasis === "primary");
  const scrollableTools = tools.filter((tool) => tool.emphasis !== "primary");

  const renderTools = (items: ToolConfig[]) => {
    const renderedGroups = new Set<string>();
    return items.map((tool) => {
      const Icon = tool.icon;
      const active = tool.key === activeTool;
      const groupLabel = tool.groupLabel || "";
      const showGroupLabel = groupLabel && !renderedGroups.has(groupLabel);
      if (showGroupLabel) {
        renderedGroups.add(groupLabel);
      }
      return (
        <div key={tool.key} className="tool-rail__item">
          {showGroupLabel ? <div className="tool-rail__section-label">{groupLabel}</div> : null}
          <Tooltip label={tool.label} position="right" withArrow openDelay={250}>
            <button
              type="button"
              aria-label={tool.label}
              className={`tool-rail__button${active ? " tool-rail__button--active" : ""}`}
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
    });
  };

  return (
    <Stack className="rail-card" h="100%" align="stretch" gap={4} p={8}>
      {primaryTools.length > 0 ? (
        <div className="tool-rail__primary">{renderTools(primaryTools)}</div>
      ) : null}
      <div className="tool-rail__scroll">{renderTools(scrollableTools)}</div>
      <div className="tool-rail__footer">
        <button
          type="button"
          aria-label={settingsLabel}
          className="tool-rail__button tool-rail__button--utility"
          data-update={hasUpdate ? "true" : undefined}
          onClick={onOpenSettings}
        >
          <IconSettings size={21} style={{ flex: "0 0 auto" }} />
          <span className="tool-rail__label">{settingsLabel}</span>
          {hasUpdate ? <span className="tool-rail__update-dot" aria-hidden="true" /> : null}
        </button>
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

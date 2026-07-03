import {
  ActionIcon,
  Badge,
  Button,
  Code,
  CopyButton,
  Divider,
  Group,
  Loader,
  Modal,
  Paper,
  ScrollArea,
  SegmentedControl,
  Select,
  Stack,
  Text,
  Textarea,
  Title,
  Tooltip,
} from "@mantine/core";
import {
  IconCheck,
  IconPaperclip,
  IconPlus,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { invoke } from "@tauri-apps/api/core";
import { type ChangeEvent, type CompositionEvent, type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { normalizeAgentCliSettings, resolveAgentCliProfile } from "../agentCliSettings";
import {
  isAgentApiProviderConfigured,
  normalizeAgentProviderSettings,
} from "../agentProviderSettings";
import {
  ANDROID_AGENT_SKILLS,
  recommendAndroidAgentSkill,
} from "../androidAgentSkills";
import type { DeviceTargetState } from "../deviceTarget";
import { getStore, saveStoreValue, STORE_KEYS } from "../storage";
import { mergePerformanceAgentSample, normalizePerformanceAgentStatus } from "../performanceSampling";
import { toolIcons } from "../toolMetadata";
import type {
  AgentCopilotAttachment,
  AgentApprovalRequest,
  AgentCopilotMessage,
  AgentCopilotSession,
  AgentCliProfile,
  AndroidAgentSkill,
  AppSettings,
  EvidenceArtifact,
  EvidenceSession,
  EvidenceSessionKind,
  EvidenceScribeIntensity,
  PerformanceAgentStatusResponse,
  PerformanceSample,
  PerformanceStreamSnapshot,
  ScoutTaskPermissionLevel,
} from "../types";

interface Props {
  deviceTarget: DeviceTargetState;
  settings: AppSettings;
  onSettingsChange: (settings: AppSettings) => void;
}

interface WorkbenchCommandResult {
  command: string;
  risk: "low" | "medium" | "high";
  exit_code: number | null;
  stdout: string;
  stderr: string;
}

interface AgentCliAnalysisResult {
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

interface AgentCliProbeResult {
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  ok: boolean;
}

interface AgentRuntimeProbeCliResult {
  id: string;
  name: string;
  command: string;
  ok: boolean;
  message: string;
}

interface AgentRuntimeProbeApiResult {
  id: string;
  name: string;
  ok: boolean;
  message: string;
}

interface AgentRuntimeProbeState {
  checkedAt: number;
  available: boolean;
  cliResults: AgentRuntimeProbeCliResult[];
  apiResults: AgentRuntimeProbeApiResult[];
}

type ScoutAccessibilityStatusKind = "unknown" | "checking" | "enabled" | "disabled" | "failed";

interface ScoutAccessibilityStatus {
  status: ScoutAccessibilityStatusKind;
  message?: string;
  raw?: string;
  checkedAt?: number;
}

interface EvidenceExportPackageResult {
  path: string;
  assetCount: number;
  skippedAssets: string[];
}

interface AgentToolCall {
  id: string;
  tool: string;
  args: Record<string, unknown>;
}

interface AgentToolResult {
  id: string;
  tool: string;
  ok: boolean;
  summary: string;
  data?: unknown;
  error?: string;
  approval?: AgentApprovalRequest;
}

type CopilotMode = "chat" | "walkthrough" | "bug_repro";

const SESSION_LIMIT = 250;
const OUTPUT_LIMIT = 3600;
const ATTACHMENT_LIMIT = 8;
const ATTACHMENT_TEXT_LIMIT = 2400;
const ATTACHMENT_TEXT_READ_LIMIT = 512 * 1024;
const SUGGESTED_PROMPT_LIMIT = 5;
const AGENT_ANALYSIS_OUTPUT_LIMIT = 6000;
const AGENT_CONVERSATION_CONTEXT_LIMIT = 18000;
const AGENT_TOOL_RESULT_LIMIT = 8000;
const EVIDENCE_SESSION_LIMIT = 80;
const DEFAULT_CONTEXT_TOOL_RESULT_LIMIT = 5;
const EVIDENCE_TIMELINE_PROMPT_LIMIT = 20;
const SCRIBE_LIVE_INTERVAL_MS = 15_000;
const DEFAULT_SCRIBE_INTENSITY: EvidenceScribeIntensity = "key_moments";
const DEFAULT_SCOUT_TASK_PERMISSION_LEVEL: ScoutTaskPermissionLevel = "semi_auto";
const AGENT_ACCESSIBILITY_COMPONENT = "com.cozyla.adbmanager.agent/com.cozyla.adbmanager.agent.AgentAccessibilityService";
const AGENT_RUNTIME_PROBE_MODAL_Z_INDEX = 1200;
const AGENT_RUNTIME_PROBE_COMMAND_MISSING_PATTERN =
  /no such file or directory|os error 2|command not found|not found/i;

function buildAgentRuntimeProbeCliMissingMessage(
  rawMessage: string,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  if (AGENT_RUNTIME_PROBE_COMMAND_MISSING_PATTERN.test(rawMessage)) {
    return t("agent.runtimeProbeCliCommandMissing");
  }
  return t("agent.runtimeProbeCliMissing", {
    message: trimForPrompt(rawMessage, 240),
  });
}

function evidenceKindForCopilotMode(mode: CopilotMode): EvidenceSessionKind | null {
  return mode === "walkthrough" || mode === "bug_repro" ? mode : null;
}

function copilotModeForEvidenceKind(kind: EvidenceSessionKind): CopilotMode {
  return kind;
}

export default function AgentCopilot({ deviceTarget, settings, onSettingsChange }: Props) {
  const { t, i18n } = useTranslation();
  const AgentIcon = toolIcons.agent;
  const [sessions, setSessions] = useState<AgentCopilotSession[]>([]);
  const [evidenceSessions, setEvidenceSessions] = useState<EvidenceSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [copilotMode, setCopilotMode] = useState<CopilotMode>("walkthrough");
  const [draft, setDraft] = useState("");
  const [evidenceGoalDraft, setEvidenceGoalDraft] = useState("");
  const [activeEvidenceGoalDraft, setActiveEvidenceGoalDraft] = useState("");
  const [editingEvidenceGoal, setEditingEvidenceGoal] = useState(false);
  const [evidenceIntensityDraft, setEvidenceIntensityDraft] = useState<EvidenceScribeIntensity>(DEFAULT_SCRIBE_INTENSITY);
  const [evidencePermissionDraft, setEvidencePermissionDraft] = useState<ScoutTaskPermissionLevel>(DEFAULT_SCOUT_TASK_PERMISSION_LEVEL);
  const [evidenceNoteDraft, setEvidenceNoteDraft] = useState("");
  const [evidenceRecording, setEvidenceRecording] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<AgentCopilotAttachment[]>([]);
  const [running, setRunning] = useState(false);
  const [scribeRunning, setScribeRunning] = useState(false);
  const [agentApkStatus, setAgentApkStatus] = useState<PerformanceAgentStatusResponse | null>(null);
  const [agentApkBusy, setAgentApkBusy] = useState(false);
  const [accessibilityStatus, setAccessibilityStatus] = useState<ScoutAccessibilityStatus>({ status: "unknown" });
  const [accessibilityBusy, setAccessibilityBusy] = useState(false);
  const [runtimeProbeModalOpen, setRuntimeProbeModalOpen] = useState(false);
  const [runtimeProbeRunning, setRuntimeProbeRunning] = useState(false);
  const [runtimeProbeResult, setRuntimeProbeResult] = useState<AgentRuntimeProbeState | null>(null);
  const [suggestionSeed, setSuggestionSeed] = useState(() => newPromptSuggestionSeed());
  const sessionsRef = useRef<AgentCopilotSession[]>([]);
  const evidenceSessionsRef = useRef<EvidenceSession[]>([]);
  const scribeReviewRunningRef = useRef(false);
  const liveScribeLastSignatureRef = useRef<string | null>(null);
  const liveScribeLastManualCountRef = useRef(0);
  const messageViewportRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const composerComposingRef = useRef(false);
  const ignoreNextComposerEnterRef = useRef(false);
  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? null;
  const deviceKey = deviceTarget.identity || deviceTarget.serial || null;
  const agentCli = normalizeAgentCliSettings(settings.agentCli);
  const agentProviders = useMemo(
    () => normalizeAgentProviderSettings(settings.agentProviders),
    [settings.agentProviders],
  );
  const profileOptions = agentCli.profiles.map((profile) => ({
    value: profile.id,
    label: profile.name,
  }));
  const cliProfile = resolveAgentCliProfile(agentCli, deviceKey);
  const cliConfigured = Boolean(cliProfile.command.trim());
  const recommendedSkill = useMemo(
    () => recommendAndroidAgentSkill(draft, pendingAttachments),
    [draft, pendingAttachments],
  );
  const promptSuggestionPool = useMemo(
    () => normalizePromptSuggestions(t("agent.promptSuggestions", { returnObjects: true }) as unknown),
    [i18n.resolvedLanguage, t],
  );
  const visiblePromptSuggestions = useMemo(
    () => pickRandomPromptSuggestions(promptSuggestionPool, suggestionSeed, SUGGESTED_PROMPT_LIMIT),
    [promptSuggestionPool, suggestionSeed],
  );
  const scribeIntensityOptions = useMemo(
    () => buildScribeIntensityOptions(t),
    [i18n.resolvedLanguage, t],
  );
  const scoutTaskPermissionOptions = useMemo(
    () => buildScoutTaskPermissionOptions(t),
    [i18n.resolvedLanguage, t],
  );
  const currentContextLabel = t("agent.title");
  const activeConversationTitle = activeSession ? sessionDisplayTitle(activeSession, t) : t("agent.conversationTitle");
  const visibleEvidenceKind = evidenceKindForCopilotMode(copilotMode) ?? "walkthrough";
  const activeEvidenceSessionForDevice = useMemo(
    () =>
      evidenceSessions.find(
        (session) =>
          session.status === "active" &&
          (deviceKey ? session.deviceKey === deviceKey || session.deviceSerial === deviceTarget.serial : true),
      ) ?? null,
    [deviceKey, deviceTarget.serial, evidenceSessions],
  );
  const activeEvidenceSession = useMemo(
    () =>
      evidenceSessions.find(
        (session) =>
          session.status === "active" &&
          session.kind === visibleEvidenceKind &&
          (deviceKey ? session.deviceKey === deviceKey || session.deviceSerial === deviceTarget.serial : true),
      ) ?? null,
    [deviceKey, deviceTarget.serial, evidenceSessions, visibleEvidenceKind],
  );
  const activeEvidenceSessionForPrompt = copilotMode === "chat" ? activeEvidenceSessionForDevice : activeEvidenceSession;
  const activeEvidenceScribe = activeEvidenceSession ? normalizeEvidenceScribe(activeEvidenceSession.scribe) : null;
  const configuredApiProvider = agentProviders.apiProviders.find(isAgentApiProviderConfigured) ?? null;
  const agentApkReady = Boolean(deviceTarget.serial && isAgentApkUsableForScoutTask(agentApkStatus));
  const accessibilityReady = Boolean(deviceTarget.serial && accessibilityStatus.status === "enabled");
  const runtimeReady = runtimeProbeResult?.available ?? Boolean(cliConfigured || configuredApiProvider);
  const runtimeReadinessLabel = runtimeProbeRunning
    ? t("agent.runtimeProbeChecking")
    : runtimeReady
      ? cliConfigured
        ? cliProfile.name
        : configuredApiProvider?.name ?? t("agent.runtimeProbeReady")
      : t("agent.runtimeProbeMissing");
  const agentApkNeedsInstall = Boolean(
    deviceTarget.serial &&
      agentApkStatus &&
      (!agentApkStatus.installed ||
        agentApkStatus.status === "missing" ||
        agentApkStatus.update_available ||
        agentApkStatus.status === "update_available" ||
        agentApkStatus.status === "failed"),
  );
  const deviceCliOverrideValue = deviceKey ? agentCli.perDeviceProfileIds[deviceKey] || "__global__" : "__global__";
  const deviceCliOptions = useMemo(
    () => [{ value: "__global__", label: t("agent.cliUseGlobal") }, ...profileOptions],
    [i18n.resolvedLanguage, profileOptions, t],
  );

  useEffect(() => {
    setEditingEvidenceGoal(false);
    setActiveEvidenceGoalDraft(activeEvidenceScribe?.goal ?? "");
  }, [activeEvidenceSession?.id, activeEvidenceScribe?.goal]);

  const recentEvidenceSessions = useMemo(
    () =>
      evidenceSessions
        .filter(
          (session) =>
            session.kind === visibleEvidenceKind &&
            (deviceKey ? session.deviceKey === deviceKey || session.deviceSerial === deviceTarget.serial : true),
        )
        .slice(0, 12),
    [deviceKey, deviceTarget.serial, evidenceSessions, visibleEvidenceKind],
  );

  const refreshPromptSuggestions = useCallback(() => {
    setSuggestionSeed(newPromptSuggestionSeed());
  }, []);

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  useEffect(() => {
    evidenceSessionsRef.current = evidenceSessions;
  }, [evidenceSessions]);

  const latestMessage = activeSession?.messages.length
    ? activeSession.messages[activeSession.messages.length - 1]
    : null;

  useEffect(() => {
    const viewport = messageViewportRef.current;
    if (!viewport) return;
    window.requestAnimationFrame(() => {
      viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" });
    });
  }, [activeSessionId, activeSession?.messages.length, latestMessage?.body, latestMessage?.thinking]);

  useEffect(() => {
    getStore()
      .then((store) => store.get<AgentCopilotSession[]>(STORE_KEYS.agentCopilotSessions))
      .then((saved) => {
        const next = normalizeSessions(saved);
        setSessions(next);
        sessionsRef.current = next;
        setActiveSessionId(next[0]?.id ?? null);
      })
      .catch(() => undefined);
  }, []);

  const refreshAgentApkStatus = useCallback(async () => {
    if (!deviceTarget.serial) {
      setAgentApkStatus(null);
      return null;
    }
    try {
      const nextStatus = await invoke<PerformanceAgentStatusResponse>("adb_agent_status", {
        deviceSerial: deviceTarget.serial,
      });
      nextStatus.status = normalizePerformanceAgentStatus(nextStatus.status);
      setAgentApkStatus(nextStatus);
      return nextStatus;
    } catch (error) {
      const failedStatus = buildFailedAgentApkStatus(deviceTarget.serial, String(error));
      setAgentApkStatus(failedStatus);
      return failedStatus;
    }
  }, [deviceTarget.serial]);

  useEffect(() => {
    void refreshAgentApkStatus();
  }, [refreshAgentApkStatus]);

  const refreshAccessibilityStatus = useCallback(async () => {
    if (!deviceTarget.serial) {
      setAccessibilityStatus({ status: "unknown", message: t("agent.accessibilityNoDeviceDescription") });
      return null;
    }
    setAccessibilityBusy(true);
    setAccessibilityStatus({ status: "checking", message: t("agent.accessibilityCheckingDescription") });
    try {
      const result = await invoke<WorkbenchCommandResult>("adb_workbench_execute", {
        command:
          "shell 'echo enabled_services=$(settings get secure enabled_accessibility_services); echo accessibility_enabled=$(settings get secure accessibility_enabled)'",
        deviceSerial: deviceTarget.serial,
        allowHighRisk: false,
      });
      const raw = [result.stdout, result.stderr].filter(Boolean).join("\n");
      const enabled = isAgentAccessibilityEnabled(raw);
      const nextStatus: ScoutAccessibilityStatus = {
        status: enabled ? "enabled" : "disabled",
        message: enabled ? t("agent.accessibilityEnabledDescription") : t("agent.accessibilityDisabledDescription"),
        raw,
        checkedAt: Date.now(),
      };
      setAccessibilityStatus(nextStatus);
      return nextStatus;
    } catch (error) {
      const failedStatus: ScoutAccessibilityStatus = {
        status: "failed",
        message: t("agent.accessibilityFailedDescription", { reason: String(error) }),
        checkedAt: Date.now(),
      };
      setAccessibilityStatus(failedStatus);
      return failedStatus;
    } finally {
      setAccessibilityBusy(false);
    }
  }, [deviceTarget.serial, t]);

  useEffect(() => {
    if (!deviceTarget.serial) {
      setAccessibilityStatus({ status: "unknown" });
      return;
    }
    void refreshAccessibilityStatus();
  }, [deviceTarget.serial, refreshAccessibilityStatus]);

  const openAccessibilitySettings = useCallback(async () => {
    if (!deviceTarget.serial || accessibilityBusy) return;
    setAccessibilityBusy(true);
    try {
      await invoke<WorkbenchCommandResult>("adb_workbench_execute", {
        command: "shell am start -a android.settings.ACCESSIBILITY_SETTINGS",
        deviceSerial: deviceTarget.serial,
        allowHighRisk: false,
      });
      setAccessibilityStatus((current) => ({
        ...current,
        message: t("agent.accessibilitySettingsOpenedDescription"),
      }));
    } catch (error) {
      setAccessibilityStatus({
        status: "failed",
        message: t("agent.accessibilityFailedDescription", { reason: String(error) }),
        checkedAt: Date.now(),
      });
    } finally {
      setAccessibilityBusy(false);
    }
  }, [accessibilityBusy, deviceTarget.serial, t]);

  const runAgentRuntimeProbe = useCallback(async () => {
    setRuntimeProbeModalOpen(true);
    setRuntimeProbeRunning(true);
    const cliResults = await Promise.all(
      agentCli.profiles
        .filter((profile) => profile.command.trim())
        .map(async (profile): Promise<AgentRuntimeProbeCliResult> => {
          try {
            const result = await invoke<AgentCliProbeResult>("agent_cli_probe", {
              request: {
                command: profile.command,
                cwd: profile.cwd || null,
              },
            });
            return {
              id: profile.id,
              name: profile.name,
              command: result.command || profile.command,
              ok: result.ok,
              message: result.ok
                ? t("agent.runtimeProbeCliReady", { command: result.command || profile.command })
                : buildAgentRuntimeProbeCliMissingMessage(
                    result.stderr || result.stdout || `exit ${result.exitCode ?? "-"}`,
                    t,
                  ),
            };
          } catch (error) {
            return {
              id: profile.id,
              name: profile.name,
              command: profile.command,
              ok: false,
              message: buildAgentRuntimeProbeCliMissingMessage(String(error), t),
            };
          }
        }),
    );
    const apiResults = agentProviders.apiProviders.map((provider): AgentRuntimeProbeApiResult => {
      const configured = isAgentApiProviderConfigured(provider);
      return {
        id: provider.id,
        name: provider.name,
        ok: configured,
        message: configured
          ? t("agent.runtimeProbeApiReady", { model: provider.model })
          : t("agent.runtimeProbeApiMissing"),
      };
    });
    setRuntimeProbeResult({
      checkedAt: Date.now(),
      available: cliResults.some((result) => result.ok) || apiResults.some((result) => result.ok),
      cliResults,
      apiResults,
    });
    setRuntimeProbeRunning(false);
  }, [agentCli.profiles, agentProviders.apiProviders, t]);

  const installAgentApk = useCallback(async () => {
    if (!deviceTarget.serial || agentApkBusy) return;
    setAgentApkBusy(true);
    try {
      let nextStatus = await invoke<PerformanceAgentStatusResponse>("adb_agent_install", {
        deviceSerial: deviceTarget.serial,
      });
      nextStatus.status = normalizePerformanceAgentStatus(nextStatus.status);
      setAgentApkStatus(nextStatus);
      if (nextStatus.status === "failed") return;

      nextStatus = await invoke<PerformanceAgentStatusResponse>("adb_agent_start", {
        deviceSerial: deviceTarget.serial,
      });
      nextStatus.status = normalizePerformanceAgentStatus(nextStatus.status);
      setAgentApkStatus(nextStatus);

      nextStatus = await invoke<PerformanceAgentStatusResponse>("adb_agent_connect", {
        deviceSerial: deviceTarget.serial,
      });
      nextStatus.status = normalizePerformanceAgentStatus(nextStatus.status);
      setAgentApkStatus(nextStatus);
    } catch (error) {
      setAgentApkStatus(buildFailedAgentApkStatus(deviceTarget.serial, String(error)));
    } finally {
      setAgentApkBusy(false);
    }
  }, [agentApkBusy, deviceTarget.serial]);

  const ensureAgentApkBeforeTask = useCallback(
    async (kind: EvidenceSessionKind) => {
      if (!deviceTarget.serial) return true;
      const latestStatus = await refreshAgentApkStatus();
      if (isAgentApkUsableForScoutTask(latestStatus)) return true;
      return window.confirm(
        t("agent.agentApkTaskGateConfirm", {
          kind: t(`agent.evidenceKind.${kind}`),
          status: agentApkStatusLabel(latestStatus, true, t),
        }),
      );
    },
    [deviceTarget.serial, refreshAgentApkStatus, t],
  );

  useEffect(() => {
    getStore()
      .then((store) => store.get<EvidenceSession[]>(STORE_KEYS.evidenceSessions))
      .then((saved) => {
        const next = normalizeEvidenceSessions(saved);
        setEvidenceSessions(next);
        evidenceSessionsRef.current = next;
      })
      .catch(() => undefined);
  }, []);

  const commitSessions = useCallback(async (nextSessions: AgentCopilotSession[]) => {
    const bounded = nextSessions
      .slice()
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, SESSION_LIMIT);
    sessionsRef.current = bounded;
    setSessions(bounded);
    await saveStoreValue(STORE_KEYS.agentCopilotSessions, bounded).catch(() => undefined);
  }, []);

  const commitEvidenceSessions = useCallback(async (nextSessions: EvidenceSession[]) => {
    const bounded = nextSessions
      .slice()
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, EVIDENCE_SESSION_LIMIT);
    evidenceSessionsRef.current = bounded;
    setEvidenceSessions(bounded);
    await saveStoreValue(STORE_KEYS.evidenceSessions, bounded).catch(() => undefined);
  }, []);

  const appendMessage = useCallback(
    async (sessionId: string, message: AgentCopilotMessage) => {
      const next = sessionsRef.current.map((session) =>
        session.id === sessionId
          ? {
              ...session,
              title: session.title || message.body.slice(0, 48),
              updatedAt: message.createdAt,
              messages: [...session.messages, message],
            }
          : session,
      );
      await commitSessions(next);
    },
    [commitSessions],
  );

  const updateMessage = useCallback(
    async (sessionId: string, messageId: string, updater: (message: AgentCopilotMessage) => AgentCopilotMessage) => {
      const next = sessionsRef.current.map((session) =>
        session.id === sessionId
          ? {
              ...session,
              updatedAt: Date.now(),
              messages: session.messages.map((message) => (message.id === messageId ? updater(message) : message)),
            }
          : session,
      );
      await commitSessions(next);
    },
    [commitSessions],
  );

  const appendThinkingMessage = useCallback(
    async (sessionId: string, skillId: AndroidAgentSkill["id"]) => {
      const now = Date.now();
      const message: AgentCopilotMessage = {
        id: `msg-${now}-thinking`,
        role: "assistant",
        body: t("agent.thinking"),
        createdAt: now,
        skillId,
        thinking: true,
      };
      await appendMessage(sessionId, message);
      return message.id;
    },
    [appendMessage, t],
  );

  const appendEvidenceArtifact = useCallback(
    async (sessionId: string, artifact: EvidenceArtifact): Promise<EvidenceSession | null> => {
      const now = Date.now();
      let updatedSession: EvidenceSession | null = null;
      const next = evidenceSessionsRef.current.map((session) =>
        session.id === sessionId
          ? (updatedSession = {
              ...session,
              updatedAt: Math.max(now, artifact.createdAt),
              artifacts: [...session.artifacts, artifact],
            })
          : session,
      );
      await commitEvidenceSessions(next);
      return updatedSession;
    },
    [commitEvidenceSessions],
  );

  const updateEvidenceScribe = useCallback(
    async (sessionId: string, updater: (session: EvidenceSession) => EvidenceSession): Promise<EvidenceSession | null> => {
      let updatedSession: EvidenceSession | null = null;
      const next = evidenceSessionsRef.current.map((session) => {
        if (session.id !== sessionId) return session;
        updatedSession = updater(session);
        return updatedSession;
      });
      await commitEvidenceSessions(next);
      return updatedSession;
    },
    [commitEvidenceSessions],
  );

  const captureScribeScreenState = useCallback(
    async (
      session: EvidenceSession,
      reason: string,
      options: { includeScreenshot: boolean; lightweight?: boolean },
    ): Promise<EvidenceArtifact> => {
      const now = Date.now();
      const lines = [
        `Reason: ${reason}`,
        `Context: ${currentContextLabel}`,
        `Device: ${deviceTarget.label || t("agent.noDevice")}`,
        `Serial: ${deviceTarget.serial || "-"}`,
      ];
      const metadata: Record<string, unknown> = {
        reason,
        contextLabel: currentContextLabel,
        deviceLabel: deviceTarget.label || null,
        deviceSerial: deviceTarget.serial || null,
      };
      let screenshotPath: string | null = null;

      if (!deviceTarget.serial) {
        lines.push(t("agent.toolDeviceRequired"));
      } else {
        try {
          const foreground = await invoke<WorkbenchCommandResult>("adb_workbench_execute", {
            command:
              "shell \"dumpsys window | grep -E 'mCurrentFocus|mFocusedApp|topResumedActivity|mResumedActivity' | head -8\"",
            deviceSerial: deviceTarget.serial,
            allowHighRisk: false,
          });
          metadata.foreground = trimForPrompt(foreground.stdout || foreground.stderr || "", 1200);
          lines.push("Foreground/window:", trimForPrompt(foreground.stdout || foreground.stderr || "-", 1200));
        } catch (error) {
          metadata.foregroundError = String(error);
          lines.push(`Foreground/window error: ${String(error)}`);
        }

        if (!options.lightweight) {
          const performance = await collectPerformanceContextResult(
            `screen-state-${now}`,
            "performance.sample",
            deviceTarget.serial,
            null,
            t,
          );
          metadata.performanceSummary = performance.summary;
          metadata.performanceOk = performance.ok;
          lines.push(`Performance: ${performance.summary}`);
          if (performance.error) lines.push(`Performance error: ${trimForPrompt(performance.error, 800)}`);
        }

        if (agentApkStatus) {
          metadata.agentApkStatus = agentApkStatus.status;
          metadata.agentApkInstalled = agentApkStatus.installed;
          lines.push(`Agent APK: ${agentApkStatus.status} · installed=${agentApkStatus.installed}`);
        }

        if (options.includeScreenshot && settings.screenshotDir) {
          try {
            screenshotPath = await invoke<string>("adb_screenshot", {
              saveDir: settings.screenshotDir,
              deviceSerial: deviceTarget.serial,
            });
            metadata.screenshotPath = screenshotPath;
            lines.push(`Screenshot: ${screenshotPath}`);
          } catch (error) {
            metadata.screenshotError = String(error);
            lines.push(`Screenshot error: ${String(error)}`);
          }
        } else if (options.includeScreenshot && !settings.screenshotDir) {
          lines.push(t("agent.toolScreenshotDirMissing"));
        }
      }

      return {
        id: `artifact-${now}-screen-state`,
        type: "screen_state",
        title: t("agent.evidenceScreenState"),
        body: lines.join("\n"),
        path: screenshotPath ?? undefined,
        createdAt: now,
        metadata: {
          ...metadata,
          signature: buildScreenStateSignature(metadata),
          scribeGoal: session.scribe?.goal ?? "",
        },
      };
    },
    [agentApkStatus, currentContextLabel, deviceTarget.label, deviceTarget.serial, settings.screenshotDir, t],
  );

  const runEvidenceScribeReview = useCallback(
    async (session: EvidenceSession, reason: string, finalReport: boolean) => {
      if (!session.scribe?.enabled || scribeReviewRunningRef.current) return session;
      scribeReviewRunningRef.current = true;
      setScribeRunning(true);
      const now = Date.now();
      const reviewedArtifactId = latestReviewableArtifactId(session);
      try {
        if (!cliConfigured) {
          const body = t("agent.scribeCliUnavailable", { cli: cliProfile.name });
          const updatedWithGap = await appendEvidenceArtifact(session.id, {
            id: `artifact-${now}-scribe-gap`,
            type: "agent_note",
            title: t("agent.evidenceScribeRuntimeGap"),
            body,
            createdAt: now,
            metadata: { reason, finalReport, runtimeGap: true },
          });
          if (activeSessionId) {
            await appendMessage(activeSessionId, {
              id: `msg-${now}-scribe-gap`,
              role: "assistant",
              body,
              createdAt: now,
            });
          }
          await updateEvidenceScribe(session.id, (current) => ({
            ...current,
            scribe: {
              ...normalizeEvidenceScribe(current.scribe),
              lastReviewedArtifactId: reviewedArtifactId,
              gapsSummary: body,
              nextAction: t("agent.scribeConfigureCliNextAction"),
            },
          }));
          return updatedWithGap ?? session;
        }

        const prompt = buildEvidenceScribePrompt({
          session,
          reason,
          finalReport,
          deviceLabel: deviceTarget.label || t("agent.noDevice"),
          deviceSerial: deviceTarget.serial,
          contextLabel: currentContextLabel,
          locale: i18n.resolvedLanguage || i18n.language,
        });
        const output = await runAgentCliTurn(cliProfile, prompt, t);
        const body = output || t("agent.agentRuntimeEmpty");
        const updatedWithNote = await appendEvidenceArtifact(session.id, {
          id: `artifact-${Date.now()}-${finalReport ? "qa-report" : "scribe-note"}`,
          type: "agent_note",
          title: finalReport ? t("agent.evidenceQaReport") : t("agent.evidenceScribeNote"),
          body,
          createdAt: Date.now(),
          metadata: { reason, finalReport, reviewedArtifactId },
        });
        if (activeSessionId) {
          await appendMessage(activeSessionId, {
            id: `msg-${Date.now()}-${finalReport ? "qa-report" : "scribe-note"}`,
            role: "assistant",
            body,
            createdAt: Date.now(),
          });
        }
        const updated = await updateEvidenceScribe(session.id, (current) => ({
          ...current,
          scribe: {
            ...normalizeEvidenceScribe(current.scribe),
            lastReviewedArtifactId: reviewedArtifactId,
            coverageSummary: finalReport ? body : normalizeEvidenceScribe(current.scribe).coverageSummary,
            gapsSummary: finalReport ? normalizeEvidenceScribe(current.scribe).gapsSummary : trimForPrompt(body, 500),
            nextAction: extractScribeNextAction(body),
          },
        }));
        return updated ?? updatedWithNote ?? session;
      } finally {
        scribeReviewRunningRef.current = false;
        setScribeRunning(false);
      }
    },
    [
      activeSessionId,
      appendEvidenceArtifact,
      appendMessage,
      cliConfigured,
      cliProfile,
      currentContextLabel,
      deviceTarget.label,
      deviceTarget.serial,
      i18n.language,
      i18n.resolvedLanguage,
      t,
      updateEvidenceScribe,
    ],
  );

  const maybeRunEvidenceScribeReview = useCallback(
    async (session: EvidenceSession | null, reason: string, options?: { finalReport?: boolean }) => {
      if (!session?.scribe?.enabled) return session;
      const finalReport = Boolean(options?.finalReport);
      const intensity = session.scribe.intensity;
      if (!finalReport && intensity === "quiet") return session;
      const shouldReview =
        finalReport ||
        reason === "start" ||
        reason === "issue" ||
        intensity === "live" ||
        countReviewableArtifactsSince(session, session.scribe.lastReviewedArtifactId ?? null) >= 3;
      if (!shouldReview) return session;
      return runEvidenceScribeReview(session, reason, finalReport);
    },
    [runEvidenceScribeReview],
  );

  const createEvidenceSession = useCallback(
    async (
      kind: EvidenceSessionKind,
      options?: { goal?: string; intensity?: EvidenceScribeIntensity; permissionLevel?: ScoutTaskPermissionLevel; requestedByAgent?: boolean },
    ) => {
      const now = Date.now();
      const goal = (options?.goal ?? "").trim();
      const intensity = options?.intensity ?? DEFAULT_SCRIBE_INTENSITY;
      const permissionLevel = options?.permissionLevel ?? DEFAULT_SCOUT_TASK_PERMISSION_LEVEL;
      setCopilotMode(copilotModeForEvidenceKind(kind));
      const session: EvidenceSession = {
        id: `evidence-${now}`,
        kind,
        status: "active",
        title: goal || t(`agent.evidenceKind.${kind}`),
        createdAt: now,
        updatedAt: now,
        deviceKey,
        deviceSerial: deviceTarget.serial,
        capturePolicy: {
          screenshots: true,
          remoteAudit: true,
          logcatOnIssue: kind === "bug_repro",
        },
        scribe: buildDefaultEvidenceScribe(goal, intensity, permissionLevel),
        artifacts: [],
      };
      await commitEvidenceSessions([session, ...evidenceSessionsRef.current]);
      if (activeSessionId) {
        await appendMessage(activeSessionId, {
          id: `msg-${now}-evidence-start`,
          role: "assistant",
          body: t("agent.evidenceStarted", { kind: t(`agent.evidenceKind.${kind}`) }),
          createdAt: now,
        });
      }
      let updatedSession = await appendEvidenceArtifact(
        session.id,
        await captureScribeScreenState(session, "start", { includeScreenshot: true }),
      );
      updatedSession = await maybeRunEvidenceScribeReview(updatedSession ?? session, "start");
      setEvidenceGoalDraft("");
      setEvidenceIntensityDraft(DEFAULT_SCRIBE_INTENSITY);
      setEvidencePermissionDraft(DEFAULT_SCOUT_TASK_PERMISSION_LEVEL);
      liveScribeLastSignatureRef.current = null;
      liveScribeLastManualCountRef.current = 0;
      return updatedSession ?? session;
    },
    [
      activeSessionId,
      appendEvidenceArtifact,
      appendMessage,
      captureScribeScreenState,
      commitEvidenceSessions,
      deviceKey,
      deviceTarget.serial,
      maybeRunEvidenceScribeReview,
      t,
    ],
  );

  const closeEvidenceSession = useCallback(async (sessionOverride?: EvidenceSession) => {
    const sessionToClose = sessionOverride ?? activeEvidenceSession;
    if (!sessionToClose) return;
    await maybeRunEvidenceScribeReview(sessionToClose, "end", { finalReport: true });
    const now = Date.now();
    const next = evidenceSessionsRef.current.map((session) =>
      session.id === sessionToClose.id
        ? {
            ...session,
            status: "closed" as const,
            updatedAt: now,
            closedAt: now,
          }
        : session,
    );
    await commitEvidenceSessions(next);
  }, [activeEvidenceSession, commitEvidenceSessions, maybeRunEvidenceScribeReview]);

  const startEvidenceFromUi = useCallback(
    async (kind: EvidenceSessionKind) => {
      const canStart = await ensureAgentApkBeforeTask(kind);
      if (!canStart) return;
      await createEvidenceSession(kind, {
        goal: evidenceGoalDraft,
        intensity: evidenceIntensityDraft,
        permissionLevel: evidencePermissionDraft,
      });
    },
    [createEvidenceSession, ensureAgentApkBeforeTask, evidenceGoalDraft, evidenceIntensityDraft, evidencePermissionDraft],
  );

  const updateActiveScribeIntensity = useCallback(
    async (intensity: EvidenceScribeIntensity) => {
      if (!activeEvidenceSession) return;
      await updateEvidenceScribe(activeEvidenceSession.id, (session) => ({
        ...session,
        scribe: {
          ...normalizeEvidenceScribe(session.scribe),
          intensity,
        },
      }));
    },
    [activeEvidenceSession, updateEvidenceScribe],
  );

  const updateActiveTaskPermissionLevel = useCallback(
    async (permissionLevel: ScoutTaskPermissionLevel) => {
      if (!activeEvidenceSession) return;
      await updateEvidenceScribe(activeEvidenceSession.id, (session) => ({
        ...session,
        scribe: {
          ...normalizeEvidenceScribe(session.scribe),
          permissionLevel,
        },
      }));
    },
    [activeEvidenceSession, updateEvidenceScribe],
  );

  const startEditingActiveEvidenceGoal = useCallback(() => {
    setActiveEvidenceGoalDraft(activeEvidenceScribe?.goal ?? "");
    setEditingEvidenceGoal(true);
  }, [activeEvidenceScribe?.goal]);

  const saveActiveEvidenceGoal = useCallback(async () => {
    if (!activeEvidenceSession) return;
    const goal = activeEvidenceGoalDraft.trim();
    await updateEvidenceScribe(activeEvidenceSession.id, (session) => ({
      ...session,
      title: goal || t(`agent.evidenceKind.${session.kind}`),
      updatedAt: Date.now(),
      scribe: {
        ...normalizeEvidenceScribe(session.scribe),
        goal,
      },
    }));
    setEditingEvidenceGoal(false);
  }, [activeEvidenceGoalDraft, activeEvidenceSession, t, updateEvidenceScribe]);

  const cancelEditingActiveEvidenceGoal = useCallback(() => {
    setActiveEvidenceGoalDraft(activeEvidenceScribe?.goal ?? "");
    setEditingEvidenceGoal(false);
  }, [activeEvidenceScribe?.goal]);

  useEffect(() => {
    const session = activeEvidenceSessionForDevice;
    if (!session?.scribe?.enabled || session.scribe.intensity !== "live") {
      liveScribeLastSignatureRef.current = null;
      liveScribeLastManualCountRef.current = 0;
      return;
    }
    const timer = window.setInterval(() => {
      const current = evidenceSessionsRef.current.find((item) => item.id === session.id);
      if (!current || current.status !== "active" || current.scribe?.intensity !== "live") return;
      void (async () => {
        const artifact = await captureScribeScreenState(current, "live_poll", {
          includeScreenshot: false,
          lightweight: true,
        });
        const signature = String(artifact.metadata?.signature ?? "");
        const manualCount = countManualEvidenceArtifacts(current);
        if (signature === liveScribeLastSignatureRef.current && manualCount === liveScribeLastManualCountRef.current) {
          return;
        }
        liveScribeLastSignatureRef.current = signature;
        liveScribeLastManualCountRef.current = manualCount;
        const updated = await appendEvidenceArtifact(current.id, artifact);
        await maybeRunEvidenceScribeReview(updated, "live_poll");
      })();
    }, SCRIBE_LIVE_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [activeEvidenceSessionForDevice, appendEvidenceArtifact, captureScribeScreenState, maybeRunEvidenceScribeReview]);

  const addEvidenceNote = useCallback(async () => {
    if (!activeEvidenceSession) return;
    const body = evidenceNoteDraft.trim();
    if (!body) return;
    const now = Date.now();
    const updatedSession = await appendEvidenceArtifact(activeEvidenceSession.id, {
      id: `artifact-${now}-note`,
      type: "note",
      title: t("agent.evidenceNote"),
      body,
      createdAt: now,
      metadata: buildEvidenceEventMetadata("note", deviceTarget, currentContextLabel),
    });
    setEvidenceNoteDraft("");
    await maybeRunEvidenceScribeReview(updatedSession, "artifact");
  }, [activeEvidenceSession, appendEvidenceArtifact, currentContextLabel, deviceTarget, evidenceNoteDraft, maybeRunEvidenceScribeReview, t]);

  const captureEvidenceScreenshot = useCallback(async () => {
    if (!activeEvidenceSession || !deviceTarget.serial) return;
    if (!settings.screenshotDir) {
      const now = Date.now();
      const updatedSession = await appendEvidenceArtifact(activeEvidenceSession.id, {
        id: `artifact-${now}-screenshot-gap`,
        type: "screenshot",
        title: t("agent.toolScreenshotDirMissing"),
        body: t("agent.toolScreenshotDirMissing"),
        createdAt: now,
        metadata: buildEvidenceEventMetadata("screenshot", deviceTarget, currentContextLabel),
      });
      await maybeRunEvidenceScribeReview(updatedSession, "artifact");
      return;
    }
    const path = await invoke<string>("adb_screenshot", {
      saveDir: settings.screenshotDir,
      deviceSerial: deviceTarget.serial,
    });
    const now = Date.now();
    const updatedSession = await appendEvidenceArtifact(activeEvidenceSession.id, {
      id: `artifact-${now}-screenshot`,
      type: "screenshot",
      title: t("agent.evidenceScreenshot"),
      path,
      createdAt: now,
      metadata: buildEvidenceEventMetadata("screenshot", deviceTarget, currentContextLabel),
    });
    await maybeRunEvidenceScribeReview(updatedSession, "artifact");
  }, [activeEvidenceSession, appendEvidenceArtifact, currentContextLabel, deviceTarget, maybeRunEvidenceScribeReview, settings.screenshotDir, t]);

  const startEvidenceRecording = useCallback(async () => {
    if (!activeEvidenceSession || !deviceTarget.serial) return;
    const now = Date.now();
    try {
      await invoke<string>("adb_start_recording", {
        deviceSerial: deviceTarget.serial,
      });
      setEvidenceRecording(true);
      await appendEvidenceArtifact(activeEvidenceSession.id, {
        id: `artifact-${now}-recording-start`,
        type: "recording",
        title: t("agent.evidenceRecordingStarted"),
        body: t("agent.evidenceRecordingStarted"),
        createdAt: now,
        metadata: buildEvidenceEventMetadata("recording", deviceTarget, currentContextLabel),
      });
    } catch (error) {
      await appendEvidenceArtifact(activeEvidenceSession.id, {
        id: `artifact-${now}-recording-start-gap`,
        type: "recording",
        title: t("agent.evidenceRecordingStartFailed"),
        body: String(error),
        createdAt: now,
        metadata: buildEvidenceEventMetadata("recording", deviceTarget, currentContextLabel),
      });
    }
  }, [activeEvidenceSession, appendEvidenceArtifact, currentContextLabel, deviceTarget, t]);

  const stopEvidenceRecording = useCallback(async () => {
    if (!activeEvidenceSession || !deviceTarget.serial) return;
    if (!settings.recordingDir) {
      const now = Date.now();
      const updatedSession = await appendEvidenceArtifact(activeEvidenceSession.id, {
        id: `artifact-${now}-recording-gap`,
        type: "recording",
        title: t("agent.evidenceRecordingDirMissing"),
        body: t("agent.evidenceRecordingDirMissing"),
        createdAt: now,
        metadata: buildEvidenceEventMetadata("recording", deviceTarget, currentContextLabel),
      });
      await maybeRunEvidenceScribeReview(updatedSession, "artifact");
      return;
    }
    const now = Date.now();
    try {
      const path = await invoke<string>("adb_stop_recording", {
        saveDir: settings.recordingDir,
        deviceSerial: deviceTarget.serial,
      });
      setEvidenceRecording(false);
      const updatedSession = await appendEvidenceArtifact(activeEvidenceSession.id, {
        id: `artifact-${now}-recording`,
        type: "recording",
        title: t("agent.evidenceRecording"),
        path,
        createdAt: now,
        metadata: buildEvidenceEventMetadata("recording", deviceTarget, currentContextLabel),
      });
      await maybeRunEvidenceScribeReview(updatedSession, "artifact");
    } catch (error) {
      const updatedSession = await appendEvidenceArtifact(activeEvidenceSession.id, {
        id: `artifact-${now}-recording-stop-gap`,
        type: "recording",
        title: t("agent.evidenceRecordingStopFailed"),
        body: String(error),
        createdAt: now,
        metadata: buildEvidenceEventMetadata("recording", deviceTarget, currentContextLabel),
      });
      await maybeRunEvidenceScribeReview(updatedSession, "artifact");
    }
  }, [activeEvidenceSession, appendEvidenceArtifact, currentContextLabel, deviceTarget, maybeRunEvidenceScribeReview, settings.recordingDir, t]);

  const attachRemoteAuditSnapshot = useCallback(async () => {
    if (!activeEvidenceSession) return;
    const now = Date.now();
    try {
      const status = await invoke<{ audit?: unknown[] }>("remote_control_status");
      const updatedSession = await appendEvidenceArtifact(activeEvidenceSession.id, {
        id: `artifact-${now}-remote-audit`,
        type: "remote_audit",
        title: t("agent.evidenceRemoteAudit"),
        body: JSON.stringify((status.audit ?? []).slice(-20), null, 2),
        createdAt: now,
        metadata: { ...buildEvidenceEventMetadata("remote_audit", deviceTarget, currentContextLabel), count: status.audit?.length ?? 0 },
      });
      await maybeRunEvidenceScribeReview(updatedSession, "artifact");
    } catch (error) {
      const updatedSession = await appendEvidenceArtifact(activeEvidenceSession.id, {
        id: `artifact-${now}-remote-audit-gap`,
        type: "remote_audit",
        title: t("agent.evidenceRemoteAudit"),
        body: String(error),
        createdAt: now,
        metadata: buildEvidenceEventMetadata("remote_audit", deviceTarget, currentContextLabel),
      });
      await maybeRunEvidenceScribeReview(updatedSession, "artifact");
    }
  }, [activeEvidenceSession, appendEvidenceArtifact, currentContextLabel, deviceTarget, maybeRunEvidenceScribeReview, t]);

  const markEvidenceIssue = useCallback(async () => {
    if (!activeEvidenceSession) return;
    const now = Date.now();
    let updatedSession = await appendEvidenceArtifact(activeEvidenceSession.id, {
      id: `artifact-${now}-issue`,
      type: "issue",
      title: t("agent.evidenceIssue"),
      body: evidenceNoteDraft.trim() || t("agent.evidenceIssueDefault"),
      createdAt: now,
      metadata: buildEvidenceEventMetadata("issue", deviceTarget, currentContextLabel),
    });
    if (activeEvidenceSession.kind === "bug_repro" && deviceTarget.serial) {
      try {
        const entries = await invoke<unknown[]>("adb_read_logcat", {
          deviceSerial: deviceTarget.serial,
          logcatFilter: null,
          lineLimit: 500,
        });
        updatedSession = await appendEvidenceArtifact(activeEvidenceSession.id, {
          id: `artifact-${now}-logcat`,
          type: "logcat",
          title: t("agent.evidenceIssueLogcat"),
          body: JSON.stringify(entries.slice(-200), null, 2),
          createdAt: now + 1,
          metadata: { ...buildEvidenceEventMetadata("logcat", deviceTarget, currentContextLabel), count: entries.length },
        });
      } catch (error) {
        updatedSession = await appendEvidenceArtifact(activeEvidenceSession.id, {
          id: `artifact-${now}-logcat-gap`,
          type: "logcat",
          title: t("agent.evidenceIssueLogcat"),
          body: String(error),
          createdAt: now + 1,
          metadata: buildEvidenceEventMetadata("logcat", deviceTarget, currentContextLabel),
        });
      }
    }
    setEvidenceNoteDraft("");
    await maybeRunEvidenceScribeReview(updatedSession, "issue");
  }, [activeEvidenceSession, appendEvidenceArtifact, currentContextLabel, deviceTarget, evidenceNoteDraft, maybeRunEvidenceScribeReview, t]);

  const exportEvidenceReport = useCallback(async () => {
    if (!activeEvidenceSession) return;
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const result = await invoke<EvidenceExportPackageResult | null>("export_evidence_package", {
      request: {
        defaultName: `evidence_${activeEvidenceSession.kind}_${timestamp}.zip`,
        reportMarkdown: buildEvidenceSessionReport(activeEvidenceSession, t),
        assets: buildEvidenceExportAssets(activeEvidenceSession),
      },
    });
    if (result && activeSessionId) {
      await appendMessage(activeSessionId, {
        id: `msg-${Date.now()}-evidence-export`,
        role: "assistant",
        body: t("agent.evidencePackageExported", {
          path: result.path,
          count: result.assetCount,
          skipped: result.skippedAssets.length,
        }),
        createdAt: Date.now(),
      });
    }
  }, [activeEvidenceSession, activeSessionId, appendMessage, t]);

  const updateSessionSkill = useCallback(
    async (sessionId: string, skill: AndroidAgentSkill) => {
      const next = sessionsRef.current.map((session) =>
        session.id === sessionId
          ? {
              ...session,
              skillId: skill.id,
              cliProfileId: cliProfile.id,
              updatedAt: Date.now(),
            }
          : session,
      );
      await commitSessions(next);
    },
    [cliProfile.id, commitSessions],
  );

  const createSession = useCallback(
    async (skill: AndroidAgentSkill, title?: string) => {
      const now = Date.now();
      const session: AgentCopilotSession = {
        id: `agent-${now}`,
        title: title?.trim() || t("agent.conversationTitle"),
        createdAt: now,
        updatedAt: now,
        deviceKey,
        deviceSerial: deviceTarget.serial,
        skillId: skill.id,
        cliProfileId: cliProfile.id,
        messages: [
          {
            id: `msg-${now}-system`,
            role: "system",
            body: t("agent.sessionStarted", {
              cli: cliProfile.name,
              device: deviceTarget.label || t("agent.noDevice"),
            }),
            createdAt: now,
            skillId: skill.id,
          },
        ],
      };
      await commitSessions([session, ...sessionsRef.current]);
      setActiveSessionId(session.id);
      refreshPromptSuggestions();
      return session;
    },
    [cliProfile.id, cliProfile.name, commitSessions, deviceKey, deviceTarget.label, deviceTarget.serial, refreshPromptSuggestions, t],
  );

  const updateCurrentDeviceProfile = useCallback(
    (profileId: string | null) => {
      if (!deviceKey) return;
      const nextPerDeviceProfileIds = { ...agentCli.perDeviceProfileIds };
      if (!profileId || profileId === "__global__") {
        delete nextPerDeviceProfileIds[deviceKey];
      } else {
        nextPerDeviceProfileIds[deviceKey] = profileId;
      }
      onSettingsChange({
        ...settings,
        agentCli: normalizeAgentCliSettings({
          ...agentCli,
          perDeviceProfileIds: nextPerDeviceProfileIds,
        }),
      });
    },
    [agentCli, deviceKey, onSettingsChange, settings],
  );

  const deleteSession = useCallback(
    async (sessionId: string) => {
      const next = sessionsRef.current.filter((session) => session.id !== sessionId);
      await commitSessions(next);
      setActiveSessionId((current) => (current === sessionId ? next[0]?.id ?? null : current));
    },
    [commitSessions],
  );

  const handleFilesSelected = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    if (!files.length) return;
    const attachments = await Promise.all(files.map(readAttachment));
    setPendingAttachments((current) => [...current, ...attachments].slice(0, ATTACHMENT_LIMIT));
  }, []);

  const removePendingAttachment = useCallback((attachmentId: string) => {
    setPendingAttachments((current) => current.filter((attachment) => attachment.id !== attachmentId));
  }, []);

  const approveAgentCommand = useCallback(
    async (sessionId: string, messageId: string, approval: AgentApprovalRequest) => {
      if (approval.tool === "evidence.start_session") {
        await updateMessage(sessionId, messageId, (message) => ({
          ...message,
          approval: message.approval ? { ...message.approval, status: "running" } : message.approval,
        }));
        const kind = approval.evidenceKind ?? "walkthrough";
        await createEvidenceSession(kind, { requestedByAgent: true });
        await updateMessage(sessionId, messageId, (message) => ({
          ...message,
          approval: message.approval ? { ...message.approval, status: "approved" } : message.approval,
        }));
        await appendMessage(sessionId, {
          id: `msg-${Date.now()}-evidence-approved`,
          role: "command",
          body: t("agent.evidenceStarted", { kind: t(`agent.evidenceKind.${kind}`) }),
          createdAt: Date.now(),
          command: approval.command,
          ok: true,
        });
        return;
      }

      if (!deviceTarget.serial) {
        await appendMessage(sessionId, {
          id: `msg-${Date.now()}-approval-missing-device`,
          role: "command",
          body: t("agent.toolDeviceRequired"),
          createdAt: Date.now(),
          command: approval.command,
          ok: false,
        });
        return;
      }

      await updateMessage(sessionId, messageId, (message) => ({
        ...message,
        approval: message.approval ? { ...message.approval, status: "running" } : message.approval,
      }));

      try {
        const result = await invoke<WorkbenchCommandResult>("adb_workbench_execute", {
          command: approval.command,
          deviceSerial: deviceTarget.serial,
          allowHighRisk: true,
        });
        await updateMessage(sessionId, messageId, (message) => ({
          ...message,
          approval: message.approval ? { ...message.approval, status: "approved" } : message.approval,
        }));
        await appendMessage(sessionId, {
          id: `msg-${Date.now()}-approved-command`,
          role: "command",
          body: [
            t("agent.approvalExecuted"),
            formatAgentWorkbenchCommandResult(result),
          ].join("\n\n"),
          createdAt: Date.now(),
          command: result.command,
          ok: (result.exit_code ?? 0) === 0,
        });
      } catch (error) {
        await updateMessage(sessionId, messageId, (message) => ({
          ...message,
          approval: message.approval ? { ...message.approval, status: "pending" } : message.approval,
        }));
        await appendMessage(sessionId, {
          id: `msg-${Date.now()}-approved-command-failed`,
          role: "command",
          body: `${t("agent.toolFailed", { tool: approval.tool })}\n\n${String(error)}`,
          createdAt: Date.now(),
          command: approval.command,
          ok: false,
        });
      }
    },
    [appendMessage, createEvidenceSession, deviceTarget.serial, t, updateMessage],
  );

  const denyAgentCommand = useCallback(
    async (sessionId: string, messageId: string, approval: AgentApprovalRequest) => {
      await updateMessage(sessionId, messageId, (message) => ({
        ...message,
        approval: message.approval ? { ...message.approval, status: "denied" } : message.approval,
      }));
      await appendMessage(sessionId, {
        id: `msg-${Date.now()}-approval-denied`,
        role: "command",
        body: t("agent.approvalDeniedResult", { command: approval.command }),
        createdAt: Date.now(),
        command: approval.command,
        ok: false,
      });
    },
    [appendMessage, t, updateMessage],
  );

  const executeAgentToolCall = useCallback(
    async (call: AgentToolCall): Promise<AgentToolResult> => {
      const deviceSerial = deviceTarget.serial;
      if (call.tool === "evidence.get_active_record") {
        if (!activeEvidenceSessionForPrompt) {
          return {
            id: call.id,
            tool: call.tool,
            ok: false,
            summary: t("agent.evidenceNoActive"),
            error: t("agent.evidenceNoActive"),
          };
        }
        return {
          id: call.id,
          tool: call.tool,
          ok: true,
          summary: t("agent.toolEvidenceRecord", { count: activeEvidenceSessionForPrompt.artifacts.length }),
          data: serializeEvidenceSessionForTool(activeEvidenceSessionForPrompt),
        };
      }
      if (!deviceSerial) {
        return {
          id: call.id,
          tool: call.tool,
          ok: false,
          summary: t("agent.toolDeviceRequired"),
          error: t("agent.toolDeviceRequired"),
        };
      }

      try {
        switch (call.tool) {
          case "device.get_summary": {
            const summary = await invoke<unknown>("adb_device_summary", { deviceSerial });
            return {
              id: call.id,
              tool: call.tool,
              ok: true,
              summary: t("agent.toolDeviceSummary"),
              data: summary,
            };
          }
          case "device.get_foreground_app": {
            const result = await invoke<WorkbenchCommandResult>("adb_workbench_execute", {
              command:
                "shell \"dumpsys window | grep -E 'mCurrentFocus|mFocusedApp|topResumedActivity|mResumedActivity' | head -8\"",
              deviceSerial,
              allowHighRisk: false,
            });
            return {
              id: call.id,
              tool: call.tool,
              ok: (result.exit_code ?? 0) === 0,
              summary: t("agent.toolForegroundApp"),
              data: result,
            };
          }
          case "screen.capture": {
            if (!settings.screenshotDir) {
              return {
                id: call.id,
                tool: call.tool,
                ok: false,
                summary: t("agent.toolScreenshotDirMissing"),
                error: t("agent.toolScreenshotDirMissing"),
              };
            }
            const path = await invoke<string>("adb_screenshot", {
              saveDir: settings.screenshotDir,
              deviceSerial,
            });
            return {
              id: call.id,
              tool: call.tool,
              ok: true,
              summary: t("agent.toolScreenshotCaptured", { path }),
              data: { path },
            };
          }
          case "logcat.snapshot": {
            const entries = await invoke<unknown[]>("adb_read_logcat", {
              deviceSerial,
              logcatFilter: stringArg(call.args.filter) || null,
              lineLimit: numberArg(call.args.lineLimit, 400, 100, 1200),
            });
            return {
              id: call.id,
              tool: call.tool,
              ok: true,
              summary: t("agent.toolLogcatSnapshot", { count: entries.length }),
              data: entries.slice(-120),
            };
          }
          case "package.list": {
            const packages = await invoke<string[]>("adb_list_packages", { deviceSerial });
            return {
              id: call.id,
              tool: call.tool,
              ok: true,
              summary: t("agent.toolPackageList", { count: packages.length }),
              data: packages.slice(0, 300),
            };
          }
          case "performance.sample": {
            return collectPerformanceContextResult(
              call.id,
              call.tool,
              deviceSerial,
              stringArg(call.args.targetPackage) || null,
              t,
            );
          }
          case "evidence.start_session": {
            const requestedKind = stringArg(call.args.kind);
            const evidenceKind: EvidenceSessionKind = requestedKind === "bug_repro" ? "bug_repro" : "walkthrough";
            const approval: AgentApprovalRequest = {
              id: call.id,
              tool: call.tool,
              command: `evidence.start_session ${evidenceKind}`,
              risk: "medium",
              reason: stringArg(call.args.reason) || t("agent.evidenceApprovalReason"),
              status: "pending",
              evidenceKind,
            };
            return {
              id: call.id,
              tool: call.tool,
              ok: false,
              summary: t("agent.toolApprovalRequired"),
              error: t("agent.toolApprovalRequired"),
              data: {
                approvalRequired: true,
                kind: evidenceKind,
              },
              approval,
            };
          }
          case "workbench.run_adb_command":
          case "workbench.request_adb_command": {
            const command = stringArg(call.args.command);
            if (!command) {
              return {
                id: call.id,
                tool: call.tool,
                ok: false,
                summary: t("agent.approvalCommandMissing"),
                error: t("agent.approvalCommandMissing"),
              };
            }
            const approval: AgentApprovalRequest = {
              id: call.id,
              tool: call.tool,
              command,
              risk: classifyAgentCommandRisk(command),
              reason: stringArg(call.args.reason) || t("agent.approvalReasonDefault"),
              status: "pending",
            };
            return {
              id: call.id,
              tool: call.tool,
              ok: false,
              summary: t("agent.toolApprovalRequired"),
              error: t("agent.toolApprovalRequired"),
              data: {
                approvalRequired: true,
                command,
                risk: approval.risk,
              },
              approval,
            };
          }
          default:
            return {
              id: call.id,
              tool: call.tool,
              ok: false,
              summary: t("agent.toolUnsupported", { tool: call.tool }),
              error: t("agent.toolUnsupported", { tool: call.tool }),
            };
        }
      } catch (error) {
        return {
          id: call.id,
          tool: call.tool,
          ok: false,
          summary: t("agent.toolFailed", { tool: call.tool }),
          error: String(error),
        };
      }
    },
    [activeEvidenceSessionForPrompt, deviceTarget.serial, settings.screenshotDir, t],
  );

  const runAgentConversation = useCallback(
    async (
      sessionId: string,
      prompt: string,
      attachments: AgentCopilotAttachment[],
      skill: AndroidAgentSkill,
    ) => {
      if (running) return;
      setRunning(true);
      const thinkingMessageId = await appendThinkingMessage(sessionId, skill.id);

      try {
        if (!cliConfigured) {
          await updateMessage(sessionId, thinkingMessageId, (message) => ({
            ...message,
            body: t("agent.agentRuntimeUnavailable", { cli: cliProfile.name }),
            thinking: false,
          }));
          return;
        }

        const session = sessionsRef.current.find((item) => item.id === sessionId);
        const defaultContextResults = await collectDefaultAgentContext(deviceTarget.serial, t);
        const firstPrompt = buildAgentConversationPrompt({
          prompt,
          attachments,
          session,
          toolResults: [],
          defaultContextResults,
          skill,
          deviceLabel: deviceTarget.label || t("agent.noDevice"),
          deviceSerial: deviceTarget.serial,
          contextLabel: currentContextLabel,
          evidenceSession: activeEvidenceSessionForPrompt,
          locale: i18n.resolvedLanguage || i18n.language,
        });
        const firstOutput = await runAgentCliTurn(cliProfile, firstPrompt, t);
        const firstToolRequest = extractAgentToolRequest(firstOutput);

        if (!firstToolRequest.calls.length) {
          await updateMessage(sessionId, thinkingMessageId, (message) => ({
            ...message,
            body: firstOutput || t("agent.agentRuntimeEmpty"),
            thinking: false,
          }));
          return;
        }

        if (firstToolRequest.message.trim()) {
          await updateMessage(sessionId, thinkingMessageId, (message) => ({
            ...message,
            body: firstToolRequest.message.trim(),
            thinking: false,
          }));
        } else {
          await updateMessage(sessionId, thinkingMessageId, (message) => ({
            ...message,
            body: t("agent.toolCallPlanMessage"),
            thinking: false,
          }));
        }

        const toolResults: AgentToolResult[] = [];
        for (const [index, call] of firstToolRequest.calls.entries()) {
          const result = await executeAgentToolCall(call);
          toolResults.push(result);
          await appendMessage(sessionId, {
            id: `msg-${Date.now()}-tool-${index}`,
            role: "command",
            body: formatAgentToolResult(result),
            createdAt: Date.now(),
            skillId: skill.id,
            command: call.tool,
            ok: result.ok,
            approval: result.approval,
          });
        }

        const secondThinkingMessageId = await appendThinkingMessage(sessionId, skill.id);
        const refreshedSession = sessionsRef.current.find((item) => item.id === sessionId) ?? session;
        const secondPrompt = buildAgentConversationPrompt({
          prompt,
          attachments,
          session: refreshedSession,
          toolResults,
          defaultContextResults,
          skill,
          deviceLabel: deviceTarget.label || t("agent.noDevice"),
          deviceSerial: deviceTarget.serial,
          contextLabel: currentContextLabel,
          evidenceSession: activeEvidenceSessionForPrompt,
          locale: i18n.resolvedLanguage || i18n.language,
        });
        const finalOutput = await runAgentCliTurn(cliProfile, secondPrompt, t);
        await updateMessage(sessionId, secondThinkingMessageId, (message) => ({
          ...message,
          body: extractAgentToolRequest(finalOutput).message || finalOutput || t("agent.agentRuntimeEmpty"),
          thinking: false,
        }));
      } finally {
        setRunning(false);
      }
    },
    [
      appendMessage,
      appendThinkingMessage,
      activeEvidenceSessionForPrompt,
      cliConfigured,
      cliProfile,
      deviceTarget.label,
      deviceTarget.serial,
      executeAgentToolCall,
      currentContextLabel,
      i18n.language,
      i18n.resolvedLanguage,
      running,
      t,
      updateMessage,
    ],
  );

  const submitPrompt = useCallback(async (promptOverride?: string) => {
    if (running) return;
    const prompt = (promptOverride ?? draft).trim() || (pendingAttachments.length ? t("agent.attachmentOnlyPrompt") : "");
    if (!prompt) return;
    const attachments = pendingAttachments;
    const skill = recommendAndroidAgentSkill(prompt, attachments);
    const session = activeSession ?? (await createSession(skill, prompt));
    if (activeSession && activeSession.skillId !== skill.id) {
      await updateSessionSkill(activeSession.id, skill);
    }
    const now = Date.now();
    setDraft("");
    setPendingAttachments([]);
    await appendMessage(session.id, {
      id: `msg-${now}-user`,
      role: "user",
      body: prompt,
      createdAt: now,
      skillId: skill.id,
      attachments,
    });
    await runAgentConversation(session.id, prompt, attachments, skill);
  }, [
    activeSession,
    appendMessage,
    cliConfigured,
    createSession,
    draft,
    pendingAttachments,
    running,
    runAgentConversation,
    t,
    updateSessionSkill,
  ]);

  const handlePrompt = useCallback(async () => {
    await submitPrompt();
  }, [submitPrompt]);

  const handleComposerKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      const nativeEvent = event.nativeEvent as KeyboardEvent<HTMLTextAreaElement>["nativeEvent"] & {
        isComposing?: boolean;
        keyCode?: number;
        which?: number;
      };
      const composing =
        composerComposingRef.current ||
        Boolean(nativeEvent.isComposing) ||
        nativeEvent.keyCode === 229 ||
        nativeEvent.which === 229;
      if (event.key !== "Enter") return;
      if (composing || ignoreNextComposerEnterRef.current) {
        if (ignoreNextComposerEnterRef.current) {
          ignoreNextComposerEnterRef.current = false;
          event.preventDefault();
        }
        return;
      }
      if (event.shiftKey) return;
      event.preventDefault();
      void submitPrompt();
    },
    [submitPrompt],
  );

  const handleComposerCompositionStart = useCallback((_event: CompositionEvent<HTMLTextAreaElement>) => {
    composerComposingRef.current = true;
    ignoreNextComposerEnterRef.current = false;
  }, []);

  const handleComposerCompositionEnd = useCallback((_event: CompositionEvent<HTMLTextAreaElement>) => {
    composerComposingRef.current = false;
    ignoreNextComposerEnterRef.current = true;
    window.setTimeout(() => {
      ignoreNextComposerEnterRef.current = false;
    }, 0);
  }, []);

  const startScribeAgentRun = useCallback(async () => {
    if (!activeEvidenceSession || running) return;
    const now = Date.now();
    const activeScribe = {
      ...normalizeEvidenceScribe(activeEvidenceSession.scribe),
      agentActive: cliConfigured,
      agentStartedAt: cliConfigured ? now : normalizeEvidenceScribe(activeEvidenceSession.scribe).agentStartedAt,
      agentStoppedAt: cliConfigured ? null : normalizeEvidenceScribe(activeEvidenceSession.scribe).agentStoppedAt,
    };
    const sessionForPrompt: EvidenceSession = {
      ...activeEvidenceSession,
      updatedAt: now,
      scribe: activeScribe,
    };

    if (cliConfigured) {
      await updateEvidenceScribe(activeEvidenceSession.id, (session) => ({
        ...session,
        updatedAt: now,
        scribe: activeScribe,
      }));
    }

    await submitPrompt(
      buildScribeAgentStartPrompt({
        session: sessionForPrompt,
        deviceLabel: deviceTarget.label || t("agent.noDevice"),
        deviceSerial: deviceTarget.serial,
        contextLabel: currentContextLabel,
        locale: i18n.resolvedLanguage || i18n.language,
      }),
    );
  }, [
    activeEvidenceSession,
    cliConfigured,
    currentContextLabel,
    deviceTarget.label,
    deviceTarget.serial,
    i18n.language,
    i18n.resolvedLanguage,
    running,
    submitPrompt,
    t,
    updateEvidenceScribe,
  ]);

  const stopScribeAgentRun = useCallback(async () => {
    if (!activeEvidenceSession || scribeRunning) return;
    const now = Date.now();
    const inactiveScribe = {
      ...normalizeEvidenceScribe(activeEvidenceSession.scribe),
      agentActive: false,
      agentStoppedAt: now,
    };
    const sessionForReport: EvidenceSession = {
      ...activeEvidenceSession,
      updatedAt: now,
      scribe: inactiveScribe,
    };
    const updatedSession = await updateEvidenceScribe(activeEvidenceSession.id, (session) => ({
      ...session,
      updatedAt: now,
      scribe: inactiveScribe,
    }));
    const prompt = buildScribeAgentStopPrompt({
      session: updatedSession ?? sessionForReport,
      deviceLabel: deviceTarget.label || t("agent.noDevice"),
      deviceSerial: deviceTarget.serial,
      contextLabel: currentContextLabel,
      locale: i18n.resolvedLanguage || i18n.language,
    });
    if (activeSessionId) {
      await appendMessage(activeSessionId, {
        id: `msg-${now}-scribe-stop`,
        role: "user",
        body: prompt,
        createdAt: now,
      });
    }
    await closeEvidenceSession(updatedSession ?? sessionForReport);
  }, [
    activeEvidenceSession,
    activeSessionId,
    appendMessage,
    closeEvidenceSession,
    currentContextLabel,
    deviceTarget.label,
    deviceTarget.serial,
    i18n.language,
    i18n.resolvedLanguage,
    scribeRunning,
    t,
    updateEvidenceScribe,
  ]);

  const handleSuggestedPrompt = useCallback(
    async (prompt: string) => {
      setDraft(prompt);
      await submitPrompt(prompt);
    },
    [submitPrompt],
  );

  const sessionList = (
    <Paper
      className="agent-copilot-card agent-copilot-session-list agent-copilot-workspace-task-rail"
      withBorder
      radius="md"
      p="sm"
      style={{ minHeight: 0, display: "flex", flexDirection: "column" }}
    >
      <Stack className="agent-copilot-workspace-intro" gap="sm">
        <Group justify="space-between" gap="xs" wrap="nowrap">
          <Group gap="xs" wrap="nowrap" style={{ minWidth: 0, flex: 1 }}>
            <span className="agent-copilot-title-badge">
              <AgentIcon size={20} />
            </span>
            <Stack gap={2} style={{ minWidth: 0 }}>
              <Title order={4} style={{ minWidth: 0, lineHeight: 1.25 }}>
                {t("agent.workspaceTitle")}
              </Title>
              <Text size="xs" c="dimmed" lineClamp={2}>
                {t("agent.workspaceSubtitle")}
              </Text>
            </Stack>
          </Group>
          <ActionIcon
            variant="light"
            aria-label={t("agent.newSession")}
            onClick={() => void createSession(recommendedSkill)}
            style={{ flex: "0 0 auto" }}
          >
            <IconPlus size={16} />
          </ActionIcon>
        </Group>

        <Group className="agent-copilot-readiness-row" gap={6} wrap="wrap">
          <ScoutReadinessPill
            label={t("agent.agentApkCardTitle")}
            value={agentApkStatusLabel(agentApkStatus, Boolean(deviceTarget.serial), t)}
            ok={agentApkReady}
            loading={agentApkBusy}
            onClick={() => {
              if (agentApkNeedsInstall) {
                void installAgentApk();
                return;
              }
              void refreshAgentApkStatus();
            }}
          />
          <ScoutReadinessPill
            label={t("agent.accessibilityCardTitle")}
            value={accessibilityStatusLabel(accessibilityStatus, Boolean(deviceTarget.serial), t)}
            ok={accessibilityReady}
            loading={accessibilityBusy}
            onClick={() => {
              if (deviceTarget.serial && accessibilityStatus.status !== "enabled") {
                void openAccessibilitySettings();
                return;
              }
              void refreshAccessibilityStatus();
            }}
          />
          <ScoutReadinessPill
            label={t("agent.cliSettings")}
            value={runtimeReadinessLabel}
            ok={runtimeReady}
            loading={runtimeProbeRunning}
            onClick={() => void runAgentRuntimeProbe()}
          />
        </Group>
      </Stack>

      <Stack className="agent-copilot-task-launcher" gap="xs">
        <button
          type="button"
          className={`agent-copilot-task-choice${copilotMode === "chat" ? " is-active" : ""}`}
          onClick={() => setCopilotMode("chat")}
        >
          <span className="agent-copilot-task-choice__mark">{t("agent.workspaceTaskChatIndex")}</span>
          <span className="agent-copilot-task-choice__copy">
            <Text component="span" size="sm" fw={800}>
              {t("agent.workspaceTaskChatTitle")}
            </Text>
            <Text component="span" size="xs" c="dimmed" lineClamp={2}>
              {t("agent.workspaceTaskChatDesc")}
            </Text>
          </span>
        </button>
        <button
          type="button"
          className={`agent-copilot-task-choice${copilotMode === "walkthrough" ? " is-active" : ""}`}
          onClick={() => setCopilotMode("walkthrough")}
        >
          <span className="agent-copilot-task-choice__mark">{t("agent.workspaceTaskWalkthroughIndex")}</span>
          <span className="agent-copilot-task-choice__copy">
            <Text component="span" size="sm" fw={800}>
              {t("agent.workspaceTaskWalkthroughTitle")}
            </Text>
            <Text component="span" size="xs" c="dimmed" lineClamp={2}>
              {t("agent.workspaceTaskWalkthroughDesc")}
            </Text>
          </span>
        </button>
        <button
          type="button"
          className={`agent-copilot-task-choice${copilotMode === "bug_repro" ? " is-active" : ""}`}
          onClick={() => setCopilotMode("bug_repro")}
        >
          <span className="agent-copilot-task-choice__mark">{t("agent.workspaceTaskBugReproIndex")}</span>
          <span className="agent-copilot-task-choice__copy">
            <Text component="span" size="sm" fw={800}>
              {t("agent.workspaceTaskBugReproTitle")}
            </Text>
            <Text component="span" size="xs" c="dimmed" lineClamp={2}>
              {t("agent.workspaceTaskBugReproDesc")}
            </Text>
          </span>
        </button>
      </Stack>

      <Divider my="sm" />

      <Group className="agent-copilot-recent-heading" justify="space-between" gap="xs" wrap="nowrap">
        <Text size="xs" fw={800}>
          {t("agent.workspaceRecentChats")}
        </Text>
        <Button size="compact-xs" variant="subtle" onClick={() => setCopilotMode("chat")}>
          {t("agent.copilotModeChat")}
        </Button>
      </Group>

      <ScrollArea style={{ flex: 1 }}>
        <Stack gap={6}>
          {sessions.map((session) => (
            <div
              key={session.id}
              className={`agent-copilot-session-card${activeSessionId === session.id ? " is-active" : ""}`}
              role="button"
              tabIndex={0}
              onClick={() => {
                setActiveSessionId(session.id);
                setCopilotMode("chat");
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setActiveSessionId(session.id);
                  setCopilotMode("chat");
                }
              }}
              style={{
                color: "inherit",
                cursor: "pointer",
                padding: 10,
                textAlign: "left",
              }}
            >
              <Group justify="space-between" gap="xs" wrap="nowrap">
                <Text size="sm" fw={700} lineClamp={1}>
                  {session.title}
                </Text>
                <ActionIcon
                  size="xs"
                  variant="subtle"
                  color="gray"
                  aria-label={t("agent.deleteSession")}
                  onClick={(event) => {
                    event.stopPropagation();
                    void deleteSession(session.id);
                  }}
                >
                  <IconTrash size={13} />
                </ActionIcon>
              </Group>
              <Text size="xs" c="dimmed" lineClamp={1}>
                {t("agent.contextLine", {
                  device: session.deviceKey || session.deviceSerial || t("agent.noDevice"),
                  cli: cliConfigured ? cliProfile.name : t("agent.cliMissing"),
                })}
              </Text>
            </div>
          ))}
        </Stack>
      </ScrollArea>
    </Paper>
  );

  const scribeActiveStrip = activeEvidenceSessionForDevice ? (
    <Paper className="agent-copilot-scribe-active-strip" withBorder radius="sm" p="xs" bg="gray.0">
      <Group justify="space-between" gap="xs" wrap="nowrap">
        <Group gap={6} wrap="wrap" style={{ minWidth: 0 }}>
          <Badge size="xs" color="green" variant="dot">
            {t(`agent.evidenceKind.${activeEvidenceSessionForDevice.kind}`)}
          </Badge>
          <Text size="xs" c="dimmed" lineClamp={1}>
            {t("agent.scribeActiveStrip", {
              kind: t(`agent.evidenceKind.${activeEvidenceSessionForDevice.kind}`),
              count: activeEvidenceSessionForDevice.artifacts.length,
            })}
          </Text>
          {scribeRunning ? (
            <Badge size="xs" color="blue" variant="light">
              {t("agent.scribeReviewing")}
            </Badge>
          ) : null}
        </Group>
        <Button
          size="xs"
          variant="light"
          onClick={() => setCopilotMode(copilotModeForEvidenceKind(activeEvidenceSessionForDevice.kind))}
          style={{ flex: "0 0 auto" }}
        >
          {t("agent.scribeOpenMode")}
        </Button>
      </Group>
    </Paper>
  ) : null;

  const activeMessages = activeSession?.messages ?? [];
  const showPromptSuggestions =
    copilotMode === "chat" &&
    visiblePromptSuggestions.length > 0 &&
    activeMessages.length <= 1 &&
    !draft.trim() &&
    pendingAttachments.length === 0;
  const pendingAttachmentBadges = pendingAttachments.length ? (
    <Group gap={6}>
      {pendingAttachments.map((attachment) => (
        <Badge
          key={attachment.id}
          variant="light"
          color="gray"
          rightSection={
            <ActionIcon
              size="xs"
              variant="transparent"
              color="gray"
              aria-label={t("agent.removeAttachment")}
              onClick={() => removePendingAttachment(attachment.id)}
            >
              <IconX size={10} />
            </ActionIcon>
          }
        >
          {attachment.name}
        </Badge>
      ))}
    </Group>
  ) : null;
  const promptSuggestionChips = showPromptSuggestions ? (
    <Group className="agent-copilot-prompt-suggestions" gap={6} wrap="wrap">
      {visiblePromptSuggestions.map((prompt) => (
        <Button
          key={prompt}
          size="xs"
          variant="light"
          color="gray"
          disabled={running}
          onClick={() => void handleSuggestedPrompt(prompt)}
          styles={{
            root: {
              height: "auto",
              minHeight: 28,
              maxWidth: "100%",
              paddingTop: 4,
              paddingBottom: 4,
            },
            label: {
              whiteSpace: "normal",
              overflowWrap: "anywhere",
              textAlign: "left",
              lineHeight: 1.25,
            },
          }}
        >
          {prompt}
        </Button>
      ))}
    </Group>
  ) : null;

  const chatConversationPanel = (
    <ScrollArea viewportRef={messageViewportRef} className="agent-copilot-mode-scroll agent-copilot-chat-scroll">
      <Stack gap="sm" pr="xs" style={{ minHeight: "100%" }}>
        {activeMessages.length ? (
          activeMessages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              onApprove={
                activeSession && message.approval?.status === "pending"
                  ? () => void approveAgentCommand(activeSession.id, message.id, message.approval!)
                  : undefined
              }
              onDeny={
                activeSession && message.approval?.status === "pending"
                  ? () => void denyAgentCommand(activeSession.id, message.id, message.approval!)
                  : undefined
              }
            />
          ))
        ) : (
          <Stack className="agent-copilot-empty-state" gap="xs">
            <Text size="sm" fw={700}>
              {t("agent.conversationTitle")}
            </Text>
            <Text size="xs" c="dimmed">
              {t("agent.promptPlaceholder")}
            </Text>
          </Stack>
        )}
        {promptSuggestionChips}
      </Stack>
    </ScrollArea>
  );

  const chatComposer = (
    <Stack className="agent-copilot-mode-footer" gap="xs">
      {pendingAttachmentBadges}
      <Group align="flex-end" gap="sm" wrap="nowrap">
        <input ref={fileInputRef} type="file" multiple hidden onChange={handleFilesSelected} />
        <Tooltip label={t("agent.attachFiles")}>
          <ActionIcon variant="light" size="lg" aria-label={t("agent.attachFiles")} onClick={() => fileInputRef.current?.click()}>
            <IconPaperclip size={18} />
          </ActionIcon>
        </Tooltip>
        <Textarea
          autosize
          minRows={2}
          maxRows={5}
          value={draft}
          placeholder={t("agent.promptPlaceholder")}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={handleComposerKeyDown}
          onCompositionStart={handleComposerCompositionStart}
          onCompositionEnd={handleComposerCompositionEnd}
          style={{ flex: 1 }}
        />
        <Button onClick={() => void handlePrompt()} disabled={running || (!draft.trim() && pendingAttachments.length === 0)}>
          {t("agent.send")}
        </Button>
      </Group>
    </Stack>
  );

  const evidenceModeTitle =
    visibleEvidenceKind === "bug_repro" ? t("agent.bugReproPanelTitle") : t("agent.scribePanelTitle");
  const evidenceModeStartLabel =
    visibleEvidenceKind === "bug_repro" ? t("agent.evidenceStartBugRepro") : t("agent.evidenceStartWalkthrough");
  const evidenceGoalPlaceholder =
    visibleEvidenceKind === "bug_repro" ? t("agent.bugReproGoalPlaceholder") : t("agent.scribeGoalPlaceholder");
  const activeEvidenceGoalEmpty =
    activeEvidenceSession?.kind === "bug_repro" ? t("agent.bugReproGoalEmpty") : t("agent.scribeGoalEmpty");
  const activeEvidenceGoalLabel =
    activeEvidenceSession?.kind === "bug_repro" ? t("agent.bugReproGoalLabel") : t("agent.scribeGoalLabel");
  const activeEvidenceAgentStartLabel =
    activeEvidenceSession?.kind === "bug_repro" ? t("agent.bugReproAgentStart") : t("agent.scribeAgentStart");
  const activeEvidenceAgentIdleHint =
    activeEvidenceSession?.kind === "bug_repro" ? t("agent.bugReproAgentIdleHint") : t("agent.scribeAgentIdleHint");
  const activeEvidenceAgentActiveHint =
    activeEvidenceSession?.kind === "bug_repro" ? t("agent.bugReproAgentActiveHint") : t("agent.scribeAgentActiveHint");
  const activeEvidenceGoalAction =
    activeEvidenceScribe?.goal && activeEvidenceScribe.goal.trim() ? t("agent.evidenceGoalEdit") : t("agent.evidenceGoalSet");
  const evidenceGoalHelper = activeEvidenceSession ? t("agent.evidenceGoalActiveHelper") : t("agent.evidenceGoalDraftHelper");

  const evidenceGoalCard =
    copilotMode === "chat" ? null : (
      <Stack className="agent-copilot-task-goal agent-copilot-goal-panel" gap={8}>
        <Group justify="space-between" gap="xs" wrap="nowrap">
          <Stack gap={2} style={{ minWidth: 0 }}>
            <Text size="xs" fw={800} className="agent-copilot-goal-label">
              {activeEvidenceSession
                ? activeEvidenceGoalLabel
                : t(visibleEvidenceKind === "bug_repro" ? "agent.bugReproGoalLabel" : "agent.scribeGoalLabel")}
            </Text>
            <Text size="xs" c="dimmed" lineClamp={1}>
              {evidenceGoalHelper}
            </Text>
          </Stack>
          {activeEvidenceSession ? (
            editingEvidenceGoal ? (
              <Group gap={6} wrap="nowrap">
                <Button size="compact-xs" variant="subtle" onClick={() => void saveActiveEvidenceGoal()}>
                  {t("agent.evidenceGoalSave")}
                </Button>
                <Button size="compact-xs" variant="subtle" onClick={cancelEditingActiveEvidenceGoal}>
                  {t("agent.evidenceGoalCancel")}
                </Button>
              </Group>
            ) : (
              <Button size="compact-xs" variant="subtle" onClick={startEditingActiveEvidenceGoal}>
                {activeEvidenceGoalAction}
              </Button>
            )
          ) : null}
        </Group>
        {activeEvidenceSession ? (
          editingEvidenceGoal ? (
            <Textarea
              autosize
              minRows={1}
              maxRows={3}
              value={activeEvidenceGoalDraft}
              placeholder={evidenceGoalPlaceholder}
              onChange={(event) => setActiveEvidenceGoalDraft(event.currentTarget.value)}
              className="agent-copilot-goal-input"
            />
          ) : (
            <Text
              size="sm"
              fw={700}
              lineClamp={2}
              className={activeEvidenceScribe?.goal ? "agent-copilot-goal-value" : "agent-copilot-goal-value agent-copilot-goal-value--empty"}
            >
              {activeEvidenceScribe?.goal || activeEvidenceGoalEmpty}
            </Text>
          )
        ) : (
          <Textarea
            autosize
            minRows={1}
            maxRows={3}
            value={evidenceGoalDraft}
            placeholder={evidenceGoalPlaceholder}
            onChange={(event) => setEvidenceGoalDraft(event.currentTarget.value)}
            className="agent-copilot-goal-input"
          />
        )}
      </Stack>
    );

  const scribePanel = (
    <ScrollArea className="agent-copilot-mode-scroll agent-copilot-scribe-scroll">
      <Stack gap="sm" pr="xs" style={{ minHeight: "100%" }}>
        {activeEvidenceSession ? (
          <>
            <Stack className="agent-copilot-scribe-summary" gap={6}>
              <Group justify="space-between" gap="xs" wrap="wrap">
                <Group gap={6} wrap="wrap">
                  <Badge size="xs" color={activeEvidenceSession.kind === "bug_repro" ? "red" : "green"} variant="light">
                    {t(`agent.evidenceKind.${activeEvidenceSession.kind}`)}
                  </Badge>
                  <Badge size="xs" color="gray" variant="light">
                    {t("agent.evidenceArtifactCount", { count: activeEvidenceSession.artifacts.length })}
                  </Badge>
                  {scribeRunning ? (
                    <Badge size="xs" color="blue" variant="dot">
                      {t("agent.scribeReviewing")}
                    </Badge>
                  ) : null}
                </Group>
                {activeEvidenceScribe ? (
                  <Group gap={6} wrap="wrap" justify="flex-end">
                    <SegmentedControl
                      size="xs"
                      value={activeEvidenceScribe.intensity}
                      data={scribeIntensityOptions}
                      onChange={(value) => void updateActiveScribeIntensity(value as EvidenceScribeIntensity)}
                    />
                    <SegmentedControl
                      size="xs"
                      value={activeEvidenceScribe.permissionLevel}
                      data={scoutTaskPermissionOptions}
                      onChange={(value) => void updateActiveTaskPermissionLevel(value as ScoutTaskPermissionLevel)}
                    />
                  </Group>
                ) : null}
              </Group>
              {activeEvidenceScribe?.nextAction ? (
                <Text size="xs" c="dimmed" lineClamp={2}>
                  {t("agent.scribeNextAction", { action: activeEvidenceScribe.nextAction })}
                </Text>
              ) : null}
            </Stack>
            <EvidenceRecordTimeline
              session={activeEvidenceSession}
              locale={i18n.resolvedLanguage}
              dense={false}
              fill={Boolean(activeEvidenceSession)}
              t={t}
            />
          </>
        ) : (
          <>
            <Stack className="agent-copilot-scribe-summary" gap={6}>
              <Group gap={6} wrap="wrap">
                <Badge size="xs" color={visibleEvidenceKind === "bug_repro" ? "red" : "green"} variant="light">
                  {t(`agent.evidenceKind.${visibleEvidenceKind}`)}
                </Badge>
                <Badge size="xs" color="gray" variant="light">
                  {t("agent.evidenceIdleStatus")}
                </Badge>
              </Group>
              <Text size="xs" c="dimmed" lineClamp={2}>
                {t("agent.evidenceIdleHint")}
              </Text>
            </Stack>
            <EvidenceRecordHistory sessions={recentEvidenceSessions} locale={i18n.resolvedLanguage} dense={false} fill t={t} />
          </>
        )}
      </Stack>
    </ScrollArea>
  );

  const scribeFooter = activeEvidenceSession ? (
    <Stack className="agent-copilot-mode-footer" gap="xs">
      {evidenceGoalCard}
      <Group gap={6} wrap="wrap">
        <Button size="xs" variant="default" onClick={() => void captureEvidenceScreenshot()}>
          {t("agent.evidenceCaptureScreenshot")}
        </Button>
        <Button size="xs" variant="default" onClick={() => void attachRemoteAuditSnapshot()}>
          {t("agent.evidenceAttachRemoteAudit")}
        </Button>
        {activeEvidenceSession.kind === "bug_repro" ? (
          evidenceRecording ? (
            <Button size="xs" variant="default" color="red" onClick={() => void stopEvidenceRecording()}>
              {t("agent.evidenceStopRecording")}
            </Button>
          ) : (
            <Button size="xs" variant="default" onClick={() => void startEvidenceRecording()}>
              {t("agent.evidenceStartRecording")}
            </Button>
          )
        ) : null}
        <Button size="xs" variant="default" color="red" onClick={() => void markEvidenceIssue()}>
          {t("agent.evidenceMarkIssue")}
        </Button>
        <Button size="xs" variant="default" onClick={() => void exportEvidenceReport()}>
          {t("agent.evidenceExport")}
        </Button>
      </Group>
      <Group align="flex-end" gap="xs" wrap="nowrap">
        <Textarea
          autosize
          minRows={1}
          maxRows={3}
          value={evidenceNoteDraft}
          placeholder={t("agent.evidenceNotePlaceholder")}
          onChange={(event) => setEvidenceNoteDraft(event.currentTarget.value)}
          style={{ flex: 1 }}
        />
        <Button size="xs" variant="light" disabled={!evidenceNoteDraft.trim()} onClick={() => void addEvidenceNote()}>
          {t("agent.evidenceAddNote")}
        </Button>
      </Group>
      {pendingAttachmentBadges}
      <Group align="center" gap="sm" wrap="nowrap">
        <input ref={fileInputRef} type="file" multiple hidden onChange={handleFilesSelected} />
        <Tooltip label={t("agent.attachFiles")}>
          <ActionIcon variant="light" size="lg" aria-label={t("agent.attachFiles")} onClick={() => fileInputRef.current?.click()}>
            <IconPaperclip size={18} />
          </ActionIcon>
        </Tooltip>
        <Text size="xs" c="dimmed" style={{ flex: 1 }}>
          {activeEvidenceScribe?.agentActive ? activeEvidenceAgentActiveHint : activeEvidenceAgentIdleHint}
        </Text>
        {activeEvidenceScribe?.agentActive ? (
          <Button color="red" onClick={() => void stopScribeAgentRun()} disabled={scribeRunning}>
            {t("agent.scribeAgentStop")}
          </Button>
        ) : (
          <Button color="blue" onClick={() => void startScribeAgentRun()} disabled={running}>
            {activeEvidenceAgentStartLabel}
          </Button>
        )}
      </Group>
    </Stack>
  ) : (
    <Stack className="agent-copilot-mode-footer" gap="xs">
      {evidenceGoalCard}
      <Group justify="space-between" gap="xs" wrap="wrap">
        <Text size="xs" fw={700}>
          {t("agent.scribeIntensityLabel")}
        </Text>
        <SegmentedControl
          size="xs"
          value={evidenceIntensityDraft}
          data={scribeIntensityOptions}
          onChange={(value) => setEvidenceIntensityDraft(value as EvidenceScribeIntensity)}
        />
      </Group>
      <Group justify="space-between" gap="xs" wrap="wrap">
        <Text size="xs" fw={700}>
          {t("agent.taskPermissionLabel")}
        </Text>
        <SegmentedControl
          size="xs"
          value={evidencePermissionDraft}
          data={scoutTaskPermissionOptions}
          onChange={(value) => setEvidencePermissionDraft(value as ScoutTaskPermissionLevel)}
        />
      </Group>
      <Button color="blue" onClick={() => void startEvidenceFromUi(visibleEvidenceKind)}>
        {evidenceModeStartLabel}
      </Button>
    </Stack>
  );

  const conversationPanel = (
    <Paper
      className="agent-copilot-card agent-copilot-panel"
      withBorder
      radius="md"
      p="md"
      style={{ minHeight: 0, height: "100%" }}
    >
      <Stack className="agent-copilot-layout" gap="sm">
        <Group className="agent-copilot-panel-header" justify="space-between" gap="sm" wrap="nowrap">
          <Stack gap={2} style={{ minWidth: 0 }}>
            <Group gap="xs" wrap="nowrap">
              {copilotMode !== "chat" ? (
                <span className="agent-copilot-title-badge agent-copilot-title-badge--compact">
                  <AgentIcon size={16} />
                </span>
              ) : null}
              <Title order={3} lineClamp={1}>
                {copilotMode === "chat" ? activeConversationTitle : evidenceModeTitle}
              </Title>
              <Badge color="gray" variant="light">
                {copilotMode === "chat" ? t("agent.conversationBadge") : t(`agent.evidenceKind.${visibleEvidenceKind}`)}
              </Badge>
            </Group>
            <Text size="xs" c="dimmed" lineClamp={1}>
              {t("agent.contextLine", {
                device: deviceTarget.label || t("agent.noDevice"),
                cli: cliConfigured ? cliProfile.name : t("agent.cliMissing"),
              })}
            </Text>
          </Stack>
        </Group>

        {copilotMode === "chat" && scribeActiveStrip ? <div className="agent-copilot-context-strip">{scribeActiveStrip}</div> : null}

        <div className="agent-copilot-mode-body">
          {copilotMode === "chat" ? chatConversationPanel : scribePanel}
        </div>
        {copilotMode === "chat" ? chatComposer : scribeFooter}
      </Stack>
    </Paper>
  );

  const runtimeProbeModal = (
    <AgentRuntimeProbeModal
      opened={runtimeProbeModalOpen}
      running={runtimeProbeRunning}
      result={runtimeProbeResult}
      cliValue={deviceCliOverrideValue}
      cliOptions={deviceCliOptions}
      cliDisabled={!deviceKey}
      onCliChange={updateCurrentDeviceProfile}
      onClose={() => setRuntimeProbeModalOpen(false)}
      onRetry={() => void runAgentRuntimeProbe()}
    />
  );

  return (
    <div className="agent-copilot-system" style={{ height: "100%", minHeight: 0, display: "grid", gridTemplateColumns: "280px minmax(0, 1fr)", gap: "var(--space-md)" }}>
      {sessionList}
      {conversationPanel}
      {runtimeProbeModal}
    </div>
  );
}

function ScoutReadinessPill({
  label,
  value,
  ok,
  loading,
  onClick,
}: {
  label: string;
  value: string;
  ok: boolean;
  loading: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`agent-copilot-readiness-pill${ok ? " is-ok" : " is-issue"}${loading ? " is-loading" : ""}`}
      onClick={onClick}
    >
      <span className="agent-copilot-readiness-pill__icon" aria-hidden="true">
        {loading ? <Loader size={12} /> : ok ? <IconCheck size={13} stroke={2.6} /> : <IconX size={13} stroke={2.6} />}
      </span>
      <span className="agent-copilot-readiness-pill__label">{label}</span>
      <span className="agent-copilot-readiness-pill__value">{value}</span>
    </button>
  );
}

function AgentRuntimeProbeModal({
  opened,
  running,
  result,
  cliValue,
  cliOptions,
  cliDisabled,
  onCliChange,
  onClose,
  onRetry,
}: {
  opened: boolean;
  running: boolean;
  result: AgentRuntimeProbeState | null;
  cliValue: string;
  cliOptions: Array<{ value: string; label: string }>;
  cliDisabled: boolean;
  onCliChange: (value: string | null) => void;
  onClose: () => void;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const cliResults = result?.cliResults ?? [];
  const apiResults = result?.apiResults ?? [];
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={t("agent.runtimeProbeTitle")}
      centered
      size="lg"
      zIndex={AGENT_RUNTIME_PROBE_MODAL_Z_INDEX}
      closeOnClickOutside
      closeOnEscape
      overlayProps={{ blur: 2 }}
    >
      <Stack gap="md">
        <Select
          label={t("agent.deviceCliOverride")}
          value={cliValue}
          data={cliOptions}
          disabled={cliDisabled}
          onChange={onCliChange}
        />

        <Text size="sm" c="dimmed">
          {t("agent.runtimeProbeDescription")}
        </Text>

        {running ? (
          <Group gap="sm" py="md" justify="center">
            <Loader size="sm" />
            <Text size="sm">{t("agent.runtimeProbeChecking")}</Text>
          </Group>
        ) : result ? (
          <Group gap="xs">
            <Badge color={result.available ? "green" : "yellow"} variant="light">
              {result.available ? t("agent.runtimeProbeReady") : t("agent.runtimeProbeMissing")}
            </Badge>
          </Group>
        ) : null}

        <Stack gap="xs">
          <Text size="sm" fw={700}>
            {t("agent.runtimeProbeCliSection")}
          </Text>
          {cliResults.length ? (
            cliResults.map((item) => (
              <RuntimeProbeRow
                key={item.id}
                name={item.name}
                ok={item.ok}
                message={item.message}
              />
            ))
          ) : (
            <Text size="xs" c="dimmed">
              {t("agent.runtimeProbeNoCli")}
            </Text>
          )}
        </Stack>

        <Stack gap="xs">
          <Text size="sm" fw={700}>
            {t("agent.runtimeProbeApiSection")}
          </Text>
          {apiResults.length ? (
            apiResults.map((item) => (
              <RuntimeProbeRow
                key={item.id}
                name={item.name}
                ok={item.ok}
                message={item.message}
              />
            ))
          ) : (
            <Text size="xs" c="dimmed">
              {t("agent.runtimeProbeNoApi")}
            </Text>
          )}
        </Stack>

        {!running && !result?.available ? (
          <Text size="xs" c="dimmed">
            {t("agent.runtimeProbeSettingsHint")}
          </Text>
        ) : null}

        <Group justify="flex-end" gap="xs">
          <Button variant="default" disabled={running} onClick={onRetry}>
            {t("agent.runtimeProbeRetry")}
          </Button>
          <Button onClick={onClose}>
            {t("agent.runtimeProbeContinue")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function RuntimeProbeRow({
  name,
  ok,
  message,
}: {
  name: string;
  ok: boolean;
  message: string;
}) {
  return (
    <Paper withBorder radius="sm" p="xs" bg={ok ? "green.0" : "gray.0"}>
      <Group justify="space-between" gap="sm" wrap="nowrap">
        <Stack gap={2} style={{ minWidth: 0, flex: 1 }}>
          <Text size="sm" fw={600} lineClamp={1}>
            {name}
          </Text>
          <Text size="xs" c="dimmed" lineClamp={2}>
            {message}
          </Text>
        </Stack>
        <Badge color={ok ? "green" : "gray"} variant="light" style={{ flex: "0 0 auto" }}>
          {ok ? "OK" : "-"}
        </Badge>
      </Group>
    </Paper>
  );
}

function EvidenceRecordTimeline({
  session,
  locale,
  dense,
  fill,
  t,
}: {
  session: EvidenceSession;
  locale?: string;
  dense: boolean;
  fill?: boolean;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  const artifacts = session.artifacts.slice().sort((a, b) => b.createdAt - a.createdAt);
  return (
    <Stack gap={6} style={{ flex: fill ? 1 : undefined, minHeight: fill ? 0 : undefined }}>
      <Group justify="space-between" gap="xs" wrap="wrap">
        <Group gap={6}>
          <Text size="xs" fw={700}>
            {t("agent.evidenceTimelineTitle")}
          </Text>
          <Badge size="xs" color="blue" variant="light">
            {t("agent.evidenceActiveStatus", { kind: t(`agent.evidenceKind.${session.kind}`) })}
          </Badge>
        </Group>
        <Text size="xs" c="dimmed">
          {t("agent.evidenceSessionMeta", {
            time: formatEvidenceTime(session.createdAt, locale),
            device: session.deviceSerial || "-",
          })}
        </Text>
      </Group>
      {artifacts.length ? (
        <Stack
          gap={6}
          style={{
            flex: fill ? 1 : undefined,
            minHeight: fill ? 0 : undefined,
            maxHeight: fill ? undefined : dense ? 180 : 260,
            overflowY: "auto",
            paddingRight: 2,
          }}
        >
          {artifacts.map((artifact) => (
            <EvidenceArtifactItem key={artifact.id} artifact={artifact} locale={locale} compact={dense} t={t} />
          ))}
        </Stack>
      ) : (
        <Paper withBorder radius="sm" p="xs" bg="gray.0">
          <Text size="xs" c="dimmed">
            {t("agent.evidenceNoArtifacts")}
          </Text>
        </Paper>
      )}
    </Stack>
  );
}

function EvidenceRecordHistory({
  sessions,
  locale,
  dense,
  fill,
  t,
}: {
  sessions: EvidenceSession[];
  locale?: string;
  dense: boolean;
  fill?: boolean;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  const visibleSessions = sessions.filter((session) => session.artifacts.length || session.status === "active");
  return (
    <Stack gap={6} style={{ flex: fill ? 1 : undefined, minHeight: fill ? 0 : undefined }}>
      <Text size="xs" fw={700}>
        {t("agent.evidenceHistoryTitle")}
      </Text>
      {visibleSessions.length ? (
        <Stack
          gap={6}
          style={{
            flex: fill ? 1 : undefined,
            minHeight: fill ? 0 : undefined,
            maxHeight: fill ? undefined : dense ? 260 : 360,
            overflowY: "auto",
            paddingRight: 2,
          }}
        >
          {visibleSessions.map((session) => (
            <Stack
              key={session.id}
              className="agent-copilot-evidence-session"
              gap={5}
              style={{
                padding: 8,
              }}
            >
              <Group justify="space-between" gap="xs" wrap="wrap">
                <Group gap={6}>
                  <Badge size="xs" color={session.status === "active" ? "green" : "gray"} variant="light">
                    {t(`agent.evidenceKind.${session.kind}`)}
                  </Badge>
                  <Text size="xs" c="dimmed">
                    {t("agent.evidenceArtifactCount", { count: session.artifacts.length })}
                  </Text>
                </Group>
                <Text size="xs" c="dimmed">
                  {formatEvidenceTime(session.updatedAt, locale)}
                </Text>
              </Group>
              {session.artifacts.length ? (
                <Stack gap={5} style={{ maxHeight: dense ? 120 : 180, overflowY: "auto", paddingRight: 2 }}>
                  {session.artifacts
                    .slice()
                    .sort((a, b) => b.createdAt - a.createdAt)
                    .slice(0, 3)
                    .map((artifact) => (
                      <EvidenceArtifactItem key={artifact.id} artifact={artifact} locale={locale} compact t={t} />
                    ))}
                </Stack>
              ) : (
                <Text size="xs" c="dimmed">
                  {t("agent.evidenceNoArtifacts")}
                </Text>
              )}
            </Stack>
          ))}
        </Stack>
      ) : (
        <Text size="xs" c="dimmed">
          {t("agent.evidenceHistoryEmpty")}
        </Text>
      )}
    </Stack>
  );
}

function EvidenceArtifactItem({
  artifact,
  locale,
  compact,
  t,
}: {
  artifact: EvidenceArtifact;
  locale?: string;
  compact: boolean;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  const isScreenshot = artifact.type === "screenshot" && Boolean(artifact.path) && !artifact.body;
  return (
    <Paper className="agent-copilot-evidence-item" withBorder radius="sm" p="xs">
      <Stack gap={6}>
        <Group justify="space-between" gap="xs" wrap="nowrap">
          <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
            <Badge size="xs" color={evidenceArtifactColor(artifact.type)} variant="light">
              {t(`agent.evidenceArtifactType.${artifact.type}`)}
            </Badge>
            <Text size="xs" fw={700} lineClamp={1}>
              {artifact.title}
            </Text>
          </Group>
          <Text size="xs" c="dimmed" style={{ flex: "0 0 auto" }}>
            {formatEvidenceTime(artifact.createdAt, locale)}
          </Text>
        </Group>
        {artifact.body ? (
          <Text
            size="xs"
            style={{
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
              maxHeight: compact ? 64 : 120,
              overflowY: "auto",
            }}
          >
            {trimForPrompt(artifact.body, compact ? 500 : 1200)}
          </Text>
        ) : null}
        {isScreenshot ? (
          <EvidenceArtifactImagePreview path={artifact.path!} title={artifact.title} compact={compact} t={t} />
        ) : null}
        {artifact.path ? (
          <Stack gap={4}>
            <Text size="xs" c="dimmed">
              {t("agent.evidenceArtifactPath")}
            </Text>
            <Text
              size="xs"
              style={{
                fontFamily: "var(--font-mono)",
                overflowWrap: "anywhere",
              }}
            >
              {artifact.path}
            </Text>
            <Group gap={6}>
              <Button size="compact-xs" variant="default" onClick={() => void openEvidenceArtifactPath(artifact.path!)}>
                {t("agent.evidenceOpenLocation")}
              </Button>
              <CopyButton value={artifact.path}>
                {({ copied, copy }) => (
                  <Button size="compact-xs" variant="subtle" onClick={copy}>
                    {copied ? t("agent.evidenceCopied") : t("agent.evidenceCopyPath")}
                  </Button>
                )}
              </CopyButton>
            </Group>
          </Stack>
        ) : null}
      </Stack>
    </Paper>
  );
}

function EvidenceArtifactImagePreview({
  path,
  title,
  compact,
  t,
}: {
  path: string;
  title: string;
  compact: boolean;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    setPreviewSrc(null);
    setPreviewError(null);
    invoke<string>("read_image_preview_data_url", { localPath: path })
      .then((dataUrl) => {
        if (!disposed) setPreviewSrc(dataUrl);
      })
      .catch((error) => {
        if (!disposed) setPreviewError(String(error));
      });
    return () => {
      disposed = true;
    };
  }, [path]);

  if (previewSrc) {
    return (
      <img
        src={previewSrc}
        alt={title}
        style={{
          width: "100%",
          maxHeight: compact ? 120 : 180,
          objectFit: "contain",
          borderRadius: "var(--radius-md)",
          border: "var(--border-hairline)",
          background: "var(--surface-sunken)",
        }}
      />
    );
  }

  return (
    <Paper
      className="agent-copilot-evidence-item"
      withBorder
      radius="sm"
      p="sm"
      style={{
        minHeight: compact ? 96 : 144,
        display: "grid",
        placeItems: "center",
      }}
    >
      {previewError ? (
        <Text size="xs" c="dimmed" ta="center">
          {t("agent.evidencePreviewUnavailable")}
        </Text>
      ) : (
        <Group gap="xs">
          <Loader size="xs" />
          <Text size="xs" c="dimmed">
            {t("agent.evidencePreviewLoading")}
          </Text>
        </Group>
      )}
    </Paper>
  );
}

function MessageBubble({
  message,
  onApprove,
  onDeny,
}: {
  message: AgentCopilotMessage;
  onApprove?: () => void;
  onDeny?: () => void;
}) {
  const { t } = useTranslation();
  const align = message.role === "user" ? "flex-end" : "flex-start";
  return (
    <Group justify={align}>
      <Paper
        className={`agent-copilot-message agent-copilot-message-${message.role}`}
        withBorder
        radius="md"
        p="sm"
        style={{
          maxWidth: message.role === "command" ? "100%" : "78%",
          width: message.role === "command" ? "100%" : undefined,
        }}
      >
        <Group gap="xs" mb={4}>
          <Badge size="xs" color={message.ok === false ? "red" : message.role === "command" ? "gray" : "blue"} variant="light">
            {message.role}
          </Badge>
          {message.command ? (
            <Code style={{ whiteSpace: "normal", wordBreak: "break-word" }}>{message.command}</Code>
          ) : null}
        </Group>
        {message.thinking ? <ThinkingIndicator label={t("agent.thinking")} /> : <MessageText body={displayMessageBody(message, t)} />}
        {message.approval ? (
          <>
            <Divider my="xs" />
            <Stack gap={8}>
              <Group justify="space-between" gap="xs" wrap="nowrap">
                <Text size="sm" fw={700}>
                  {t("agent.approvalTitle")}
                </Text>
                <Badge color={approvalRiskColor(message.approval.risk)} variant="light">
                  {t(`workbench.risk.${message.approval.risk}`)}
                </Badge>
              </Group>
              <Text size="xs" c="dimmed">
                {message.approval.reason}
              </Text>
              <Code block style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                {message.approval.command}
              </Code>
              <Group justify="space-between" gap="xs" wrap="wrap">
                <Badge color={approvalStatusColor(message.approval.status)} variant="dot">
                  {t(`agent.approvalStatus.${message.approval.status}`)}
                </Badge>
                <Group gap="xs">
                  <CopyButton value={message.approval.command}>
                    {({ copied, copy }) => (
                      <Button size="xs" variant="default" onClick={copy}>
                        {copied ? t("agent.approvalCopied") : t("agent.approvalCopyCommand")}
                      </Button>
                    )}
                  </CopyButton>
                  <Button
                    size="xs"
                    variant="default"
                    disabled={!onDeny || message.approval.status !== "pending"}
                    onClick={onDeny}
                  >
                    {t("agent.approvalDeny")}
                  </Button>
                  <Button
                    size="xs"
                    color="red"
                    disabled={!onApprove || message.approval.status !== "pending"}
                    loading={message.approval.status === "running"}
                    onClick={onApprove}
                  >
                    {t("agent.approvalAllowOnce")}
                  </Button>
                </Group>
              </Group>
            </Stack>
          </>
        ) : null}
        {message.attachments?.length ? (
          <Stack gap={4} mt="xs">
            {message.attachments.map((attachment) => (
              <Paper key={attachment.id} className="agent-copilot-evidence-item" withBorder radius="sm" p={6}>
                <Text size="xs" fw={700}>
                  {attachment.name} · {formatBytes(attachment.sizeBytes)}
                </Text>
                {attachment.textPreview ? (
                  <Text size="xs" c="dimmed" lineClamp={3} style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                    {attachment.textPreview}
                  </Text>
                ) : (
                  <Text size="xs" c="dimmed">
                    {t("agent.binaryAttachment")}
                  </Text>
                )}
              </Paper>
            ))}
          </Stack>
        ) : null}
      </Paper>
    </Group>
  );
}

function ThinkingIndicator({ label }: { label: string }) {
  return (
    <Group gap={6} align="center" aria-live="polite">
      <style>
        {`
          @keyframes agentThinkingDot {
            0%, 80%, 100% { opacity: 0.28; transform: translateY(0); }
            40% { opacity: 1; transform: translateY(-2px); }
          }
        `}
      </style>
      <Text size="sm" c="dimmed">
        {label}
      </Text>
      <Group gap={3}>
        {[0, 1, 2].map((index) => (
          <span
            key={index}
            style={{
              width: 5,
              height: 5,
              borderRadius: "50%",
              background: "var(--color-signal)",
              display: "inline-block",
              animation: "agentThinkingDot 1.2s infinite ease-in-out",
              animationDelay: `${index * 0.15}s`,
            }}
          />
        ))}
      </Group>
    </Group>
  );
}

function MessageText({ body }: { body: string }) {
  const parts = messageDocumentParts(body);
  return (
    <Text size="sm" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
      {parts.map((part, index) =>
        part.kind === "document" ? (
          <button
            key={`${part.text}-${index}`}
            type="button"
            onClick={() => void openMessageDocument(part.text)}
            style={{
              border: 0,
              background: "transparent",
              padding: 0,
              color: "var(--color-signal)",
              cursor: "pointer",
              font: "inherit",
              textDecoration: "underline",
            }}
          >
            {part.text}
          </button>
        ) : (
          <span key={`${part.text}-${index}`}>{part.text}</span>
        ),
      )}
    </Text>
  );
}

function normalizeSessions(value: AgentCopilotSession[] | undefined): AgentCopilotSession[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((session) => session && session.id && session.skillId && Array.isArray(session.messages))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, SESSION_LIMIT);
}

function normalizeEvidenceSessions(value: EvidenceSession[] | undefined): EvidenceSession[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((session) => session && session.id && session.kind && Array.isArray(session.artifacts))
    .map((session) => {
      const rawKind = String((session as { kind?: unknown }).kind ?? "");
      const kind: EvidenceSessionKind = rawKind === "bug_repro" ? "bug_repro" : "walkthrough";
      return {
        ...session,
        kind,
        title: rawKind === "checklist" ? "Walkthrough" : session.title,
        status: (session.status === "closed" ? "closed" : "active") as EvidenceSession["status"],
        capturePolicy: {
          screenshots: session.capturePolicy?.screenshots ?? true,
          remoteAudit: session.capturePolicy?.remoteAudit ?? true,
          logcatOnIssue: session.capturePolicy?.logcatOnIssue ?? kind === "bug_repro",
        },
        scribe: session.scribe ? normalizeEvidenceScribe(session.scribe) : undefined,
      };
    })
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, EVIDENCE_SESSION_LIMIT);
}

function normalizeEvidenceScribe(value: EvidenceSession["scribe"] | undefined) {
  const rawIntensity = String((value as { intensity?: unknown } | undefined)?.intensity ?? DEFAULT_SCRIBE_INTENSITY);
  const intensity: EvidenceScribeIntensity =
    rawIntensity === "quiet" || rawIntensity === "live" ? rawIntensity : DEFAULT_SCRIBE_INTENSITY;
  const rawPermissionLevel = String((value as { permissionLevel?: unknown } | undefined)?.permissionLevel ?? DEFAULT_SCOUT_TASK_PERMISSION_LEVEL);
  const permissionLevel: ScoutTaskPermissionLevel =
    rawPermissionLevel === "read_only" || rawPermissionLevel === "auto_execute"
      ? rawPermissionLevel
      : DEFAULT_SCOUT_TASK_PERMISSION_LEVEL;
  const agentStartedAt = typeof value?.agentStartedAt === "number" ? value.agentStartedAt : null;
  const agentStoppedAt = typeof value?.agentStoppedAt === "number" ? value.agentStoppedAt : null;
  return {
    enabled: value?.enabled ?? true,
    intensity,
    permissionLevel,
    goal: typeof value?.goal === "string" ? value.goal : "",
    agentActive: Boolean(value?.agentActive),
    agentStartedAt,
    agentStoppedAt,
    lastReviewedArtifactId: value?.lastReviewedArtifactId ?? null,
    coverageSummary: value?.coverageSummary ?? "",
    issuesSummary: value?.issuesSummary ?? "",
    gapsSummary: value?.gapsSummary ?? "",
    nextAction: value?.nextAction ?? "",
  };
}

function buildDefaultEvidenceScribe(
  goal: string,
  intensity: EvidenceScribeIntensity,
  permissionLevel: ScoutTaskPermissionLevel = DEFAULT_SCOUT_TASK_PERMISSION_LEVEL,
) {
  return {
    enabled: true,
    intensity,
    permissionLevel,
    goal,
    agentActive: false,
    agentStartedAt: null,
    agentStoppedAt: null,
    lastReviewedArtifactId: null,
    coverageSummary: "",
    issuesSummary: "",
    gapsSummary: "",
    nextAction: "",
  };
}

function normalizePromptSuggestions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => {
      if (!entry || seen.has(entry)) return false;
      seen.add(entry);
      return true;
    });
}

function pickRandomPromptSuggestions(pool: string[], seed: number, limit: number): string[] {
  if (pool.length <= limit) return pool;
  return pool
    .map((prompt, index) => ({
      prompt,
      score: seededPromptScore(seed, index),
    }))
    .sort((a, b) => a.score - b.score)
    .slice(0, limit)
    .map((item) => item.prompt);
}

function seededPromptScore(seed: number, index: number) {
  const value = Math.sin(seed + index * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

function newPromptSuggestionSeed() {
  return Date.now() + Math.random();
}

async function runAgentCliTurn(
  cliProfile: AgentCliProfile,
  prompt: string,
  t: ReturnType<typeof useTranslation>["t"],
) {
  try {
    const result = await invoke<AgentCliAnalysisResult>("agent_cli_analyze", {
      request: {
        kind: cliProfile.kind,
        command: cliProfile.command,
        args: cliProfile.args ?? [],
        cwd: cliProfile.cwd || null,
        prompt,
      },
    });
    const output = cleanAgentCliOutput(result.stdout);
    if ((result.exitCode ?? 0) === 0 && output) {
      return truncateAgentAnalysis(output);
    }
    const reason = cleanAgentCliOutput(result.stderr) || t("agent.analysisCliEmptyOutput");
    return t("agent.agentTurnCliUnavailable", {
      cli: cliProfile.name,
      reason: truncateAgentAnalysis(reason),
    });
  } catch (error) {
    return t("agent.agentTurnCliUnavailable", {
      cli: cliProfile.name,
      reason: String(error),
    });
  }
}

interface AgentConversationPromptInput {
  prompt: string;
  attachments: AgentCopilotAttachment[];
  session: AgentCopilotSession | undefined;
  toolResults: AgentToolResult[];
  defaultContextResults: AgentToolResult[];
  skill: AndroidAgentSkill;
  deviceLabel: string;
  deviceSerial: string | null;
  contextLabel: string;
  evidenceSession: EvidenceSession | null;
  locale: string;
}

interface EvidenceScribePromptInput {
  session: EvidenceSession;
  reason: string;
  finalReport: boolean;
  deviceLabel: string;
  deviceSerial: string | null;
  contextLabel: string;
  locale: string;
}

function buildAgentConversationPrompt(input: AgentConversationPromptInput) {
  const responseLanguage = input.locale.toLowerCase().startsWith("zh") ? "Chinese" : "English";
  const recentMessages = (input.session?.messages ?? [])
    .slice(-10)
    .map((message) => `${message.role}: ${trimForPrompt(message.body, 1200)}`)
    .join("\n\n");
  const attachments = input.attachments.length
    ? input.attachments
        .map((attachment) =>
          [
            `- ${attachment.name} (${formatBytes(attachment.sizeBytes)}, ${attachment.mimeType || "unknown type"})`,
            attachment.textPreview ? trimForPrompt(attachment.textPreview, 1200) : "(metadata only)",
          ].join("\n"),
        )
        .join("\n")
    : "(none)";
  const toolResults = input.toolResults.length
    ? serializeAgentToolResults(input.toolResults)
    : "(none yet)";
  const defaultContextResults = input.defaultContextResults.length
    ? serializeAgentToolResults(input.defaultContextResults)
    : "(none available)";
  const evidenceSession = input.evidenceSession
    ? buildEvidenceTimelineForPrompt(input.evidenceSession, input.locale)
    : "(none active)";
  return trimForPrompt(
    [
      "You are Scout inside ADB Manager, an evidence-first Android device task agent.",
      `Respond in ${responseLanguage}.`,
      "You are a conversational AI agent. Do not run a predefined diagnostic workflow by default.",
      "Decide whether to answer directly, ask a follow-up question, or request tools.",
      "ADB Manager is the tool executor. ADB and the optional APK Agent only provide data/actions; you are responsible for deciding what is needed.",
      "Ground conclusions in tool results when you use tools. If you need more data, request it explicitly.",
      "",
      "Available auto-approved read-only tools:",
      "- device.get_summary",
      "- device.get_foreground_app",
      "- screen.capture",
      "- logcat.snapshot args: {filter?: string, lineLimit?: number}",
      "- package.list",
      "- performance.sample args: {targetPackage?: string}. Returns current performance context by merging ADB system data, active performance stream data when present, and Agent APK sample data when available.",
      "- evidence.get_active_record. Returns the active Scout task evidence record with compact timeline, notes, screenshot paths, recordings, Logcat summaries, and task recorder state.",
      "",
      "Approval-gated session/expert tools:",
      "- evidence.start_session args: {kind: \"walkthrough\" | \"bug_repro\", reason?: string}. Use this to propose a capture session; ADB Manager will ask the user before starting.",
      "- workbench.request_adb_command args: {command: string, reason?: string}. Use this only for mutating, destructive, or expert ADB actions. ADB Manager will show the user an approval card before execution.",
      "",
      "High-risk or expert-only tools are not auto-approved. If the user asks for destructive or mutating actions, request approval instead of inventing a command result.",
      "",
      "When you need tools, include exactly one JSON block like:",
      '```json\n{"toolCalls":[{"id":"summary","tool":"device.get_summary","args":{}}]}\n```',
      "You may include a short sentence before the JSON block, but do not claim the result until tool output is returned.",
      "If you do not need tools, answer normally and do not include toolCalls.",
      "",
      `Current device: ${input.deviceLabel}`,
      `Current device serial: ${input.deviceSerial || "(none selected)"}`,
      `Current ADB Manager context: ${input.contextLabel}`,
      "Active evidence record:",
      evidenceSession,
      `Suggested optional evidence shortcut: ${input.skill.title} (${input.skill.id})`,
      "",
      "Default device context collected before this turn:",
      defaultContextResults,
      "",
      "Recent conversation:",
      recentMessages || "(new conversation)",
      "",
      "Current user message:",
      input.prompt,
      "",
      "Attachments:",
      attachments,
      "",
      "Tool results already returned:",
      toolResults,
    ].join("\n"),
    AGENT_CONVERSATION_CONTEXT_LIMIT,
  );
}

function buildEvidenceScribePrompt(input: EvidenceScribePromptInput) {
  const responseLanguage = input.locale.toLowerCase().startsWith("zh") ? "Chinese" : "English";
  const scribe = normalizeEvidenceScribe(input.session.scribe);
  const taskLabel = input.session.kind === "bug_repro" ? "bug reproduction" : "walkthrough";
  return trimForPrompt(
    [
      "You are the Scout task reviewer inside ADB Manager.",
      `Respond in ${responseLanguage}.`,
      "ADB Manager records only reliable local evidence. Do not claim physical touches or invisible user actions unless the evidence says so.",
      `Mode: ${input.finalReport ? "final QA report" : "short in-progress review"}`,
      `Review reason: ${input.reason}`,
      `Proactivity: ${scribe.intensity}`,
      `Permission level: ${scribe.permissionLevel}`,
      `Goal: ${scribe.goal || "(not specified)"}`,
      `Device: ${input.deviceLabel}`,
      `Serial: ${input.deviceSerial || "(none selected)"}`,
      `ADB Manager context: ${input.contextLabel}`,
      "",
      "Evidence record:",
      buildEvidenceTimelineForPrompt(input.session, input.locale),
      "",
      input.finalReport
        ? [
            "Write a QA report with:",
            `- ${taskLabel} scope`,
            "- Covered steps and evidence",
            "- Issues found",
            "- Evidence links/paths",
            "- Gaps and recommended next actions",
          ].join("\n")
        : [
            "Write a short task note only:",
            "- coverage progress",
            "- evidence gap or risk",
            "- one suggested next action",
            "- at most one question",
          ].join("\n"),
    ].join("\n"),
    AGENT_CONVERSATION_CONTEXT_LIMIT,
  );
}

function buildScribeAgentStartPrompt(input: Omit<EvidenceScribePromptInput, "reason" | "finalReport">) {
  const responseLanguage = input.locale.toLowerCase().startsWith("zh") ? "Chinese" : "English";
  const scribe = normalizeEvidenceScribe(input.session.scribe);
  const taskLabel = input.session.kind === "bug_repro" ? "bug reproduction" : "walkthrough";
  return trimForPrompt(
    [
      `I am starting a Scout ${taskLabel} task in ADB Manager.`,
      `Respond in ${responseLanguage}.`,
      "Important runtime rule: do not keep this CLI turn open waiting for me. ADB Manager will keep recording evidence locally, and I will send another turn when I stop or need guidance.",
      `Your job now is to acknowledge the ${taskLabel} scope, name the highest-value evidence to collect next, and wait for future evidence in later turns.`,
      "",
      `Goal: ${scribe.goal || "(not specified)"}`,
      `Proactivity: ${scribe.intensity}`,
      `Permission level: ${scribe.permissionLevel}`,
      `Device: ${input.deviceLabel}`,
      `Serial: ${input.deviceSerial || "(none selected)"}`,
      `ADB Manager context: ${input.contextLabel}`,
      `Current evidence count: ${input.session.artifacts.length}`,
      "",
      "Current evidence timeline:",
      buildEvidenceTimelineForPrompt(input.session, input.locale),
    ].join("\n"),
    AGENT_CONVERSATION_CONTEXT_LIMIT,
  );
}

function buildScribeAgentStopPrompt(input: Omit<EvidenceScribePromptInput, "reason" | "finalReport">) {
  const responseLanguage = input.locale.toLowerCase().startsWith("zh") ? "Chinese" : "English";
  const scribe = normalizeEvidenceScribe(input.session.scribe);
  const taskLabel = input.session.kind === "bug_repro" ? "bug reproduction" : "walkthrough";
  return trimForPrompt(
    [
      `I am stopping this Scout ${taskLabel} task now.`,
      `Respond in ${responseLanguage}.`,
      "Please generate the final QA report from the evidence record. Include covered scope, evidence paths, issues, gaps, and recommended next actions.",
      "",
      `Goal: ${scribe.goal || "(not specified)"}`,
      `Permission level: ${scribe.permissionLevel}`,
      `Device: ${input.deviceLabel}`,
      `Serial: ${input.deviceSerial || "(none selected)"}`,
      `ADB Manager context: ${input.contextLabel}`,
      "",
      "Final evidence timeline:",
      buildEvidenceTimelineForPrompt(input.session, input.locale),
    ].join("\n"),
    AGENT_CONVERSATION_CONTEXT_LIMIT,
  );
}

function serializeEvidenceSessionForTool(session: EvidenceSession) {
  const scribe = normalizeEvidenceScribe(session.scribe);
  return {
    id: session.id,
    kind: session.kind,
    status: session.status,
    title: session.title,
    deviceSerial: session.deviceSerial,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    scribe,
    artifacts: session.artifacts
      .slice()
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(-40)
      .map((artifact) => ({
        id: artifact.id,
        type: artifact.type,
        title: artifact.title,
        createdAt: artifact.createdAt,
        body: artifact.body ? trimForPrompt(artifact.body, 1600) : undefined,
        path: artifact.path,
        metadata: artifact.metadata,
      })),
  };
}

function buildEvidenceTimelineForPrompt(session: EvidenceSession, locale?: string) {
  const scribe = normalizeEvidenceScribe(session.scribe);
  const artifactLines = session.artifacts
    .slice()
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(-EVIDENCE_TIMELINE_PROMPT_LIMIT)
    .map((artifact) => formatEvidenceArtifactForPrompt(artifact, locale));
  return [
    `${session.title} (${session.kind}, ${session.status})`,
    `Task recorder: enabled=${scribe.enabled}, intensity=${scribe.intensity}, permission=${scribe.permissionLevel}, goal=${scribe.goal || "(none)"}`,
    `Last reviewed artifact: ${scribe.lastReviewedArtifactId || "(none)"}`,
    `Coverage summary: ${scribe.coverageSummary || "(none)"}`,
    `Issues summary: ${scribe.issuesSummary || "(none)"}`,
    `Gaps summary: ${scribe.gapsSummary || "(none)"}`,
    `Next action: ${scribe.nextAction || "(none)"}`,
    `Artifacts: ${session.artifacts.length}`,
    artifactLines.length ? artifactLines.join("\n") : "(no artifacts yet)",
  ].join("\n");
}

function formatEvidenceArtifactForPrompt(artifact: EvidenceArtifact, locale?: string) {
  return [
    `- [${formatEvidenceTime(artifact.createdAt, locale)}] ${artifact.type}: ${artifact.title}`,
    artifact.body ? `  body: ${trimForPrompt(artifact.body, 900).replace(/\n/g, " / ")}` : undefined,
    artifact.path ? `  path: ${artifact.path}` : undefined,
    artifact.metadata ? `  metadata: ${trimForPrompt(JSON.stringify(artifact.metadata), 700)}` : undefined,
  ]
    .filter(Boolean)
    .join("\n");
}

function serializeAgentToolResults(results: AgentToolResult[]) {
  return trimForPrompt(
    results
      .map((result) =>
        [
          `## ${result.id}: ${result.tool}`,
          `Status: ${result.ok ? "ok" : "failed"}`,
          `Summary: ${result.summary}`,
          result.error ? `Error: ${result.error}` : undefined,
          result.data === undefined ? undefined : `Data: ${trimForPrompt(JSON.stringify(result.data, null, 2), 5000)}`,
        ]
          .filter(Boolean)
          .join("\n"),
      )
      .join("\n\n"),
    AGENT_TOOL_RESULT_LIMIT,
  );
}

function extractAgentToolRequest(output: string): { message: string; calls: AgentToolCall[] } {
  const fenced = output.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [fenced?.[1], output.match(/\{[\s\S]*"toolCalls"[\s\S]*\}/)?.[0]].filter(
    (value): value is string => Boolean(value),
  );
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (!Array.isArray(parsed.toolCalls)) continue;
      const calls = parsed.toolCalls
        .map((entry: unknown, index: number): AgentToolCall | null => {
          if (!entry || typeof entry !== "object") return null;
          const item = entry as Record<string, unknown>;
          if (typeof item.tool !== "string") return null;
          const args = item.args && typeof item.args === "object" && !Array.isArray(item.args)
            ? (item.args as Record<string, unknown>)
            : {};
          return {
            id: typeof item.id === "string" && item.id.trim() ? item.id.trim() : `tool-${index + 1}`,
            tool: item.tool.trim(),
            args,
          };
        })
        .filter((entry: AgentToolCall | null): entry is AgentToolCall => Boolean(entry));
      if (!calls.length) continue;
      const message = fenced
        ? output.replace(fenced[0], "").trim()
        : output.replace(candidate, "").trim();
      return { message, calls };
    } catch {
      // Try the next candidate.
    }
  }
  return { message: output.trim(), calls: [] };
}

function formatAgentToolResult(result: AgentToolResult) {
  const body = [
    `${result.tool} · ${result.ok ? "ok" : "failed"}`,
    result.summary,
    result.error ? `error: ${result.error}` : undefined,
    result.data === undefined ? undefined : trimForPrompt(JSON.stringify(result.data, null, 2), OUTPUT_LIMIT),
  ]
    .filter(Boolean)
    .join("\n\n");
  return body.length > OUTPUT_LIMIT ? `${body.slice(0, OUTPUT_LIMIT)}\n...[truncated]` : body;
}

function formatAgentWorkbenchCommandResult(result: WorkbenchCommandResult) {
  return [
    `${result.command} · ${result.risk} · ${result.exit_code ?? "-"}`,
    result.stdout ? `stdout:\n${trimForPrompt(result.stdout, OUTPUT_LIMIT)}` : undefined,
    result.stderr ? `stderr:\n${trimForPrompt(result.stderr, OUTPUT_LIMIT)}` : undefined,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildEvidenceSessionReport(session: EvidenceSession, t: ReturnType<typeof useTranslation>["t"]) {
  const scribe = session.scribe ? normalizeEvidenceScribe(session.scribe) : null;
  const lines = [
    `# ${session.title}`,
    "",
    `- ${t("agent.evidenceReportKind")}: ${t(`agent.evidenceKind.${session.kind}`)}`,
    `- ${t("agent.evidenceReportStatus")}: ${session.status}`,
    `- ${t("agent.evidenceReportDevice")}: ${session.deviceSerial || "-"}`,
    `- ${t("agent.evidenceReportStarted")}: ${new Date(session.createdAt).toISOString()}`,
    session.closedAt ? `- ${t("agent.evidenceReportClosed")}: ${new Date(session.closedAt).toISOString()}` : undefined,
    scribe ? `- ${t("agent.scribeIntensityLabel")}: ${t(`agent.scribeIntensity.${scribe.intensity}`)}` : undefined,
    scribe ? `- ${t("agent.taskPermissionLabel")}: ${t(`agent.taskPermission.${scribe.permissionLevel}`)}` : undefined,
    scribe?.goal ? `- ${t("agent.scribeGoalLabel")}: ${scribe.goal}` : undefined,
    scribe?.nextAction ? `- ${t("agent.scribeNextActionLabel")}: ${scribe.nextAction}` : undefined,
    "",
  ].filter(Boolean) as string[];

  lines.push(`## ${t("agent.evidenceReportArtifacts")}`, "");
  if (!session.artifacts.length) {
    lines.push(`- ${t("agent.analysisNoEvidence")}`);
  }
  for (const artifact of session.artifacts) {
    lines.push(`### ${artifact.title}`);
    lines.push("");
    lines.push(`- ${t("agent.evidenceReportType")}: ${artifact.type}`);
    lines.push(`- ${t("agent.evidenceReportTime")}: ${new Date(artifact.createdAt).toISOString()}`);
    if (artifact.path) lines.push(`- ${t("agent.evidenceReportPath")}: ${artifact.path}`);
    if (artifact.body) {
      lines.push("", "```text", trimForPrompt(artifact.body, 6000), "```");
    }
    lines.push("");
  }
  return lines.join("\n");
}

function buildEvidenceExportAssets(session: EvidenceSession) {
  const seen = new Set<string>();
  return session.artifacts
    .filter((artifact) => Boolean(artifact.path))
    .flatMap((artifact) => {
      const path = artifact.path?.trim();
      if (!path || seen.has(path)) return [];
      seen.add(path);
      return [
        {
          path,
          title: artifact.title,
          kind: artifact.type,
        },
      ];
    });
}

async function collectDefaultAgentContext(deviceSerial: string | null, t: ReturnType<typeof useTranslation>["t"]) {
  if (!deviceSerial) return [];
  const results: AgentToolResult[] = [];
  results.push(await collectDeviceSummaryContextResult(deviceSerial, t));
  results.push(await collectPerformanceContextResult("default-performance", "performance.current_context", deviceSerial, null, t));
  return results.slice(0, DEFAULT_CONTEXT_TOOL_RESULT_LIMIT);
}

async function collectDeviceSummaryContextResult(deviceSerial: string, t: ReturnType<typeof useTranslation>["t"]): Promise<AgentToolResult> {
  try {
    const summary = await invoke<unknown>("adb_device_summary", { deviceSerial });
    return {
      id: "default-device-summary",
      tool: "device.get_summary",
      ok: true,
      summary: t("agent.toolDeviceSummary"),
      data: summary,
    };
  } catch (error) {
    return {
      id: "default-device-summary",
      tool: "device.get_summary",
      ok: false,
      summary: t("agent.toolFailed", { tool: "device.get_summary" }),
      error: String(error),
    };
  }
}

async function collectPerformanceContextResult(
  id: string,
  tool: string,
  deviceSerial: string,
  targetPackage: string | null,
  t: ReturnType<typeof useTranslation>["t"],
): Promise<AgentToolResult> {
  const errors: string[] = [];
  let agentStatus: PerformanceAgentStatusResponse | null = null;
  let agentSample: PerformanceSample | null = null;
  let adbSample: PerformanceSample | null = null;
  let streamSnapshot: PerformanceStreamSnapshot | null = null;

  try {
    agentStatus = await invoke<PerformanceAgentStatusResponse>("adb_agent_status", { deviceSerial });
    agentStatus.status = normalizePerformanceAgentStatus(agentStatus.status);
  } catch (error) {
    errors.push(`agent status: ${String(error)}`);
  }

  try {
    agentSample = await invoke<PerformanceSample>("adb_agent_sample", {
      deviceSerial,
      targetPackage,
      intervalMs: 1000,
    });
  } catch (error) {
    errors.push(`agent sample: ${String(error)}`);
  }

  try {
    streamSnapshot = await invoke<PerformanceStreamSnapshot>("adb_performance_stream_snapshot", { deviceSerial });
    adbSample = streamSnapshot.last_sample;
    if (streamSnapshot.last_error) {
      errors.push(`performance stream: ${streamSnapshot.last_error}`);
    }
  } catch {
    streamSnapshot = null;
  }

  if (!adbSample) {
    try {
      adbSample = await invoke<PerformanceSample>("adb_performance_sample", {
        deviceSerial,
        targetPackage,
        followForeground: !targetPackage,
        includeSlow: true,
        includeFrameStats: true,
      });
    } catch (error) {
      errors.push(`adb performance sample: ${String(error)}`);
    }
  }

  const mergedSample = adbSample || agentSample ? mergePerformanceAgentSample(adbSample, agentSample) : null;
  return {
    id,
    tool,
    ok: Boolean(mergedSample || agentStatus),
    summary: mergedSample
      ? t("agent.toolPerformanceContext", { source: mergedSample.sample_source })
      : t("agent.toolPerformanceContextUnavailable"),
    data: {
      agentStatus,
      agentSample,
      adbSample,
      mergedSample,
      streamActive: streamSnapshot?.active ?? false,
      streamLastError: streamSnapshot?.last_error ?? null,
      errors,
    },
    error: mergedSample || agentStatus ? undefined : errors.join("\n") || t("agent.toolPerformanceContextUnavailable"),
  };
}

function buildFailedAgentApkStatus(deviceSerial: string, message: string): PerformanceAgentStatusResponse {
  return {
    device_serial: deviceSerial,
    package_name: "com.cozyla.adbmanager.agent",
    status: "failed",
    installed: false,
    apk_available: false,
    forwarded_port: null,
    version_name: null,
    bundled_version_name: null,
    protocol_version: null,
    update_available: false,
    started_at_ms: null,
    message,
  };
}

function buildScribeIntensityOptions(t: ReturnType<typeof useTranslation>["t"]) {
  return [
    { value: "quiet", label: t("agent.scribeIntensity.quiet") },
    { value: "key_moments", label: t("agent.scribeIntensity.key_moments") },
    { value: "live", label: t("agent.scribeIntensity.live") },
  ];
}

function buildScoutTaskPermissionOptions(t: ReturnType<typeof useTranslation>["t"]) {
  return [
    { value: "read_only", label: t("agent.taskPermission.read_only") },
    { value: "semi_auto", label: t("agent.taskPermission.semi_auto") },
    { value: "auto_execute", label: t("agent.taskPermission.auto_execute") },
  ];
}

function buildEvidenceEventMetadata(reason: string, deviceTarget: DeviceTargetState, contextLabel: string) {
  return {
    reason,
    deviceSerial: deviceTarget.serial || null,
    deviceLabel: deviceTarget.label || null,
    contextLabel,
  };
}

function countManualEvidenceArtifacts(session: EvidenceSession) {
  return session.artifacts.filter((artifact) => artifact.type !== "screen_state" && artifact.type !== "agent_note").length;
}

function countReviewableArtifactsSince(session: EvidenceSession, lastReviewedArtifactId: string | null) {
  const reviewable = session.artifacts.filter((artifact) => artifact.type !== "agent_note");
  if (!lastReviewedArtifactId) return reviewable.length;
  const index = reviewable.findIndex((artifact) => artifact.id === lastReviewedArtifactId);
  return index < 0 ? reviewable.length : reviewable.slice(index + 1).length;
}

function latestReviewableArtifactId(session: EvidenceSession) {
  return session.artifacts
    .slice()
    .reverse()
    .find((artifact) => artifact.type !== "agent_note")?.id ?? null;
}

function buildScreenStateSignature(metadata: Record<string, unknown>) {
  return [
    metadata.deviceSerial,
    metadata.contextLabel,
    metadata.foreground,
    metadata.foregroundError,
  ]
    .filter(Boolean)
    .join("|");
}

function extractScribeNextAction(body: string) {
  const line = body
    .split(/\r?\n/)
    .map((item) => item.replace(/^[-*#\s]+/, "").trim())
    .find((item) => item.length > 0);
  return line ? trimForPrompt(line, 180) : "";
}

function evidenceArtifactColor(type: EvidenceArtifact["type"]) {
  switch (type) {
    case "screenshot":
      return "blue";
    case "recording":
      return "red";
    case "logcat":
      return "orange";
    case "issue":
      return "pink";
    case "remote_audit":
      return "violet";
    case "screen_state":
      return "teal";
    case "agent_note":
      return "indigo";
    case "note":
    default:
      return "gray";
  }
}

function formatEvidenceTime(timestamp: number, locale?: string) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat(locale || undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

async function openEvidenceArtifactPath(path: string) {
  await invoke("reveal_path", { path }).catch(() => undefined);
}

function isAgentApkUsableForScoutTask(status: PerformanceAgentStatusResponse | null) {
  if (!status) return false;
  if (!status.installed || status.update_available) return false;
  return status.status !== "missing" && status.status !== "failed" && status.status !== "update_available";
}

function agentApkStatusLabel(
  status: PerformanceAgentStatusResponse | null,
  deviceReady: boolean,
  t: ReturnType<typeof useTranslation>["t"],
) {
  if (!deviceReady) return t("agent.agentApkNoDeviceLabel");
  if (!status) return t("agent.agentApkCheckingLabel");
  if (!status.installed || status.status === "missing") return t("agent.agentApkMissingLabel");
  if (status.update_available || status.status === "update_available") return t("agent.agentApkUpdateLabel");
  if (status.status === "connected") return t("agent.agentApkReadyLabel");
  if (status.status === "permission_limited") return t("agent.agentApkLimitedLabel");
  if (status.status === "failed") return t("agent.agentApkFailedLabel");
  return t("agent.agentApkStartingLabel");
}

function isAgentAccessibilityEnabled(raw: string) {
  const normalized = raw.toLowerCase().replace(/\s+/g, "");
  return (
    normalized.includes(AGENT_ACCESSIBILITY_COMPONENT.toLowerCase()) ||
    normalized.includes("com.cozyla.adbmanager.agent/.agentaccessibilityservice")
  );
}

function accessibilityStatusLabel(
  status: ScoutAccessibilityStatus,
  deviceReady: boolean,
  t: ReturnType<typeof useTranslation>["t"],
) {
  if (!deviceReady) return t("agent.accessibilityNoDeviceLabel");
  if (status.status === "checking") return t("agent.accessibilityCheckingLabel");
  if (status.status === "enabled") return t("agent.accessibilityEnabledLabel");
  if (status.status === "disabled") return t("agent.accessibilityDisabledLabel");
  if (status.status === "failed") return t("agent.accessibilityFailedLabel");
  return t("agent.accessibilityUnknownLabel");
}

function classifyAgentCommandRisk(command: string): AgentApprovalRequest["risk"] {
  const lower = command.toLowerCase();
  if (
    /\bshell\s+pm\s+clear\b/.test(lower) ||
    /\bpm\s+clear\b/.test(lower) ||
    /\buninstall\b/.test(lower) ||
    /\breboot\b/.test(lower) ||
    /\bshell\s+rm\b/.test(lower) ||
    /\bshell\s+dd\b/.test(lower)
  ) {
    return "high";
  }
  if (
    /\bshell\s+setprop\b/.test(lower) ||
    /\bshell\s+settings\s+put\b/.test(lower) ||
    /\bforce-stop\b/.test(lower) ||
    /\bpm\s+(grant|revoke)\b/.test(lower) ||
    /\binstall\b/.test(lower) ||
    /\bpush\b/.test(lower)
  ) {
    return "medium";
  }
  return "low";
}

function approvalRiskColor(risk: AgentApprovalRequest["risk"]) {
  if (risk === "high") return "red";
  if (risk === "medium") return "yellow";
  return "green";
}

function approvalStatusColor(status: AgentApprovalRequest["status"]) {
  if (status === "approved") return "green";
  if (status === "denied") return "red";
  if (status === "running") return "blue";
  return "yellow";
}

function stringArg(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function numberArg(value: unknown, fallback: number, min: number, max: number) {
  const numeric = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

function trimForPrompt(value: string, limit: number) {
  const trimmed = value.trim();
  if (trimmed.length <= limit) return trimmed;
  return `${trimmed.slice(0, limit)}\n...[truncated]`;
}

function cleanAgentCliOutput(value: string) {
  return value.replace(/\u001b\[[0-9;]*m/g, "").trim();
}

function truncateAgentAnalysis(value: string) {
  if (value.length <= AGENT_ANALYSIS_OUTPUT_LIMIT) return value;
  return `${value.slice(0, AGENT_ANALYSIS_OUTPUT_LIMIT)}\n...[truncated]`;
}

function skillLabel(skill: AndroidAgentSkill, t: ReturnType<typeof useTranslation>["t"]) {
  return t(`agent.skills.${skill.id}.title`, { defaultValue: skill.title });
}

function sessionDisplayTitle(session: AgentCopilotSession, t: ReturnType<typeof useTranslation>["t"]) {
  const title = session.title?.trim();
  if (!title || isSkillDisplayName(title, t)) return t("agent.conversationTitle");
  return title;
}

function displayMessageBody(message: AgentCopilotMessage, t: ReturnType<typeof useTranslation>["t"]) {
  if (message.role !== "system") return message.body;
  return stripLegacySkillPrefix(message.body, t);
}

function stripLegacySkillPrefix(body: string, t: ReturnType<typeof useTranslation>["t"]) {
  for (const skill of ANDROID_AGENT_SKILLS) {
    const labels = [skillLabel(skill, t), skill.title];
    for (const label of labels) {
      const prefix = `${label} · `;
      if (body.startsWith(prefix)) return body.slice(prefix.length);
    }
  }
  return body;
}

function isSkillDisplayName(value: string, t: ReturnType<typeof useTranslation>["t"]) {
  return ANDROID_AGENT_SKILLS.some((skill) => value === skillLabel(skill, t) || value === skill.title);
}

async function readAttachment(file: File): Promise<AgentCopilotAttachment> {
  let textPreview: string | undefined;
  if (isTextLike(file) && file.size <= ATTACHMENT_TEXT_READ_LIMIT) {
    try {
      textPreview = (await file.text()).slice(0, ATTACHMENT_TEXT_LIMIT);
    } catch {
      textPreview = undefined;
    }
  }
  return {
    id: `att-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
    textPreview,
    createdAt: Date.now(),
  };
}

function isTextLike(file: File) {
  return (
    file.type.startsWith("text/") ||
    /\.(txt|md|markdown|json|jsonl|log|csv|xml|yaml|yml|ini|properties)$/i.test(file.name)
  );
}

function formatBytes(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

type MessagePart =
  | {
      kind: "text";
      text: string;
    }
  | {
      kind: "document";
      text: string;
    };

function messageDocumentParts(body: string): MessagePart[] {
  const pattern = /\b((?:docs|agent-android|graphify-out)\/[A-Za-z0-9_./-]+\.(?:md|markdown|txt|json|csv|log))\b/g;
  const parts: MessagePart[] = [];
  let lastIndex = 0;
  for (const match of body.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      parts.push({ kind: "text", text: body.slice(lastIndex, index) });
    }
    parts.push({ kind: "document", text: match[1] });
    lastIndex = index + match[1].length;
  }
  if (lastIndex < body.length) {
    parts.push({ kind: "text", text: body.slice(lastIndex) });
  }
  return parts.length ? parts : [{ kind: "text", text: body }];
}

async function openMessageDocument(path: string) {
  try {
    await invoke("open_file", { path });
  } catch {
    try {
      await invoke("reveal_path", { path });
    } catch {
      // Keep message rendering non-blocking if the desktop bridge is unavailable.
    }
  }
}

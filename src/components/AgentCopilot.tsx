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
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
  Title,
  Tooltip,
} from "@mantine/core";
import {
  IconBug,
  IconCheck,
  IconChevronDown,
  IconChevronUp,
  IconClipboardCheck,
  IconFile,
  IconFileExport,
  IconFolder,
  IconInfoCircle,
  IconLink,
  IconMessageCircle,
  IconPaperclip,
  IconPackage,
  IconPlus,
  IconSearch,
  IconSquare,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { type ChangeEvent, type ClipboardEvent, type CompositionEvent, type KeyboardEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  normalizeAgentCliSettings,
  resolveAgentCliProfile,
  resolveAutonomousScoutCliProfile,
} from "../agentCliSettings";
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
import {
  mergePerformanceAgentSample,
  normalizePerformanceAgentStatus,
  performanceAgentContextSample,
} from "../performanceSampling";
import {
  addScoutTaskArtifact,
  decideScoutToolExecution,
  deriveScoutTaskRunState,
  evaluateScoutTaskStartGate,
  failScoutTaskReport,
  hasDeterministicScoutCompletionEvidence,
  isBlockingSystemUiSnapshot,
  isProtectedScoutCommand,
  isProtectedScoutUiTarget,
  isScoutTerminalOutcomeResponse,
  planScoutCrashRecoveryAction,
  resolveActiveScoutTaskForMode,
  resolveScoutWalkthroughLaunchApp,
  resolveScoutUiTapTarget,
  SCOUT_CRASH_RECOVERY_LIMIT,
  SCOUT_EMPTY_UI_RECOVERY_LIMIT,
  shouldRecoverScoutEmptyUiSurface,
  startScoutTask,
  stopScoutTaskByUser,
  stopScoutTaskWithReport,
  type ScoutTaskGateResult,
  type ScoutTaskPorts,
  type ScoutTaskRunState,
} from "../scoutTask";
import { featureWalkthroughReviewPromptRules } from "../scoutTask/featureWalkthroughReview";
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
  LaunchableApp,
  PerformanceAgentStatusResponse,
  PerformanceSample,
  PerformanceStreamSnapshot,
  ScoutTaskPermissionLevel,
} from "../types";

interface Props {
  deviceTarget: DeviceTargetState;
  settings: AppSettings;
  onSettingsChange: (settings: AppSettings) => void;
  requestedMode?: CopilotMode;
  modeRequestId?: number;
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

interface AgentCliStreamEvent {
  phase?: "starting" | "working" | "completed";
  text?: string;
}

interface AgentUiNode {
  text: string;
  contentDesc: string;
  resourceId: string;
  className: string;
  bounds: string;
  clickable: boolean;
  enabled: boolean;
}

interface AgentUiSnapshot {
  deviceSerial: string;
  width: number;
  height: number;
  nodes: AgentUiNode[];
  xml: string;
  source: "accessibility" | "adb_uiautomator";
  fallbackAttempted?: boolean;
  fallbackError?: string | null;
}

interface AgentUiActionResult {
  action: "tap" | "swipe" | "back";
  deviceSerial: string;
  width: number;
  height: number;
  output: string;
  source: "accessibility" | "adb_input";
}

interface AgentCliProbeResult {
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  ok: boolean;
}

interface AgentFeishuReferenceResult {
  url: string;
  content: string;
  revisionId: number | null;
}

interface AgentFigmaMcpStatusResult {
  configured: boolean;
  authenticated: boolean;
  message: string;
  loginUrl: string;
}

interface AgentFigmaLoginLaunchResult {
  command: string;
  loginUrl: string;
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

interface AgentAttachmentFilePayload {
  name: string;
  mimeType: string;
  sizeBytes: number;
  textPreview?: string | null;
  previewKind?: AgentCopilotAttachment["previewKind"] | null;
  previewDataUrl?: string | null;
  sourcePath?: string | null;
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

interface AgentQueuedTurn {
  messageId: string;
  ready: Promise<void>;
  prompt: string;
  attachments: AgentCopilotAttachment[];
  skill: AndroidAgentSkill;
  workingDirectory: string | null;
}

type RunAgentConversation = (
  sessionId: string,
  prompt: string,
  attachments: AgentCopilotAttachment[],
  skill: AndroidAgentSkill,
  workingDirectory: string | null,
  queuedMessageId?: string,
) => Promise<void>;

type CopilotMode = "chat" | "walkthrough" | "bug_repro";
type CopilotWorkingDirectoryDrafts = Record<CopilotMode, string>;

const SESSION_LIMIT = 250;
const OUTPUT_LIMIT = 3600;
const ATTACHMENT_LIMIT = 8;
const ATTACHMENT_TEXT_LIMIT = 2400;
const ATTACHMENT_TEXT_READ_LIMIT = 512 * 1024;
const ATTACHMENT_IMAGE_PREVIEW_READ_LIMIT = 8 * 1024 * 1024;
const SUGGESTED_PROMPT_LIMIT = 5;
const AGENT_ANALYSIS_OUTPUT_LIMIT = 6000;
const AGENT_CONVERSATION_CONTEXT_LIMIT = 18000;
const AGENT_TOOL_RESULT_LIMIT = 8000;
const EVIDENCE_SESSION_LIMIT = 80;
const DEFAULT_CONTEXT_TOOL_RESULT_LIMIT = 5;
const EVIDENCE_TIMELINE_PROMPT_LIMIT = 20;
const EVIDENCE_IMAGE_PREVIEW_MAX_HEIGHT = 144;
const EVIDENCE_IMAGE_PREVIEW_COMPACT_MAX_HEIGHT = 96;
const SCRIBE_LIVE_INTERVAL_MS = 15_000;
const AGENT_AUTONOMOUS_TOOL_TURN_LIMIT = 24;
const AGENT_TERMINAL_SYNTHESIS_RETRY_LIMIT = 2;
const MESSAGE_COLLAPSE_THRESHOLD = 720;
const DEFAULT_SCRIBE_INTENSITY: EvidenceScribeIntensity = "key_moments";
const DEFAULT_SCOUT_TASK_PERMISSION_LEVEL: ScoutTaskPermissionLevel = "auto_execute";
const NEW_EVIDENCE_DRAFT_ID = "__new_evidence_draft__";
const DEFAULT_WORKING_DIRECTORIES: CopilotWorkingDirectoryDrafts = {
  chat: "",
  walkthrough: "",
  bug_repro: "",
};
const FIGMA_REFERENCE_URL_PATTERN = /figma\.com/i;
const LARK_REFERENCE_URL_PATTERN = /(feishu\.cn|larksuite\.com|larkoffice\.com)/i;
const EXTERNAL_REFERENCE_WORKFLOW_RULES = [
  "Design-reference workflow rules:",
  "- If the user is asking for a UI/interface/visual/style/prototype/design walkthrough and no UI reference URL or readable visual attachment is available, first suggest that they paste a prototype image, screenshot, Figma link, or Feishu/Lark link. This is advisory; continue with device evidence if the user proceeds.",
  "- If an image attachment is listed only as metadata and the current Agent CLI cannot inspect the visual content, ask the user for an accessible screenshot/export or design link before making UI-specific claims.",
  "- If a Figma link is provided, call reference.figma.mcp_status before claiming it is inaccessible. If it needs sign-in, request reference.figma.login so the user can start the global Codex Figma OAuth flow; do not invent a Figma comparison before access is confirmed.",
  "- If a Feishu/Lark link is provided, call reference.feishu.fetch before claiming the document is inaccessible. It uses the user's local lark-cli identity; report the actual tool error if it cannot be read.",
  "- During an autonomous walkthrough, external reference reads are supplemental. Start or continue device UI inspection and safe navigation first; never make device coverage wait for Feishu/Figma access.",
];

function featureWalkthroughExternalReferenceRules(kind: EvidenceSessionKind): string[] {
  return kind === "walkthrough" ? EXTERNAL_REFERENCE_WORKFLOW_RULES : [];
}

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

function scoutTaskGateMessage(result: Exclude<ScoutTaskGateResult, { ok: true }>, t: ReturnType<typeof useTranslation>["t"]) {
  return t(`agent.scoutTaskStartGate.${result.reason}`);
}

function normalizeWorkingDirectory(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeUiReferenceUrl(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeTargetPackage(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function uiReferenceHintKey(value: string): "uiReferenceFigmaMcpHint" | "uiReferenceFeishuCliHint" | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (FIGMA_REFERENCE_URL_PATTERN.test(trimmed)) return "uiReferenceFigmaMcpHint";
  if (LARK_REFERENCE_URL_PATTERN.test(trimmed)) return "uiReferenceFeishuCliHint";
  return null;
}

function workingDirectoryShortName(value: string): string {
  const normalized = normalizeWorkingDirectory(value);
  if (!normalized) return "";
  const parts = normalized.split(/[\\/]/).filter(Boolean);
  if (parts.length <= 2) return normalized;
  return `.../${parts.slice(-2).join("/")}`;
}

export default function AgentCopilot({
  deviceTarget,
  settings,
  onSettingsChange,
  requestedMode = "walkthrough",
  modeRequestId = 0,
}: Props) {
  const { t, i18n } = useTranslation();
  const AgentIcon = toolIcons.agent;
  const [sessions, setSessions] = useState<AgentCopilotSession[]>([]);
  const [evidenceSessions, setEvidenceSessions] = useState<EvidenceSession[]>([]);
  const [selectedEvidenceHistoryIds, setSelectedEvidenceHistoryIds] = useState<Partial<Record<EvidenceSessionKind, string>>>({});
  const [draftWorkingDirectories, setDraftWorkingDirectories] = useState<CopilotWorkingDirectoryDrafts>(DEFAULT_WORKING_DIRECTORIES);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [copilotMode, setCopilotMode] = useState<CopilotMode>(requestedMode);
  const [draft, setDraft] = useState("");
  const [evidenceGoalDraft, setEvidenceGoalDraft] = useState("");
  const [evidenceTargetPackageDraft, setEvidenceTargetPackageDraft] = useState("");
  const [targetPackagePickerOpen, setTargetPackagePickerOpen] = useState(false);
  const [evidenceUiReferenceUrlDraft, setEvidenceUiReferenceUrlDraft] = useState("");
  const [activeEvidenceGoalDraft, setActiveEvidenceGoalDraft] = useState("");
  const [editingEvidenceGoal, setEditingEvidenceGoal] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<AgentCopilotAttachment[]>([]);
  const [runningSessionIds, setRunningSessionIds] = useState<string[]>([]);
  const [scribeRunningEvidenceIds, setScribeRunningEvidenceIds] = useState<string[]>([]);
  const [liveAgentStreams, setLiveAgentStreams] = useState<Record<string, AgentCliStreamEvent>>({});
  const [liveScribeStreams, setLiveScribeStreams] = useState<Record<string, AgentCliStreamEvent>>({});
  const [reportingEvidenceId, setReportingEvidenceId] = useState<string | null>(null);
  const [stoppingEvidenceId, setStoppingEvidenceId] = useState<string | null>(null);
  const [reportFailureByEvidenceId, setReportFailureByEvidenceId] = useState<Record<string, string>>({});
  const [agentApkStatus, setAgentApkStatus] = useState<PerformanceAgentStatusResponse | null>(null);
  const [agentApkBusy, setAgentApkBusy] = useState(false);
  const [accessibilityStatus, setAccessibilityStatus] = useState<ScoutAccessibilityStatus>({ status: "unknown" });
  const [accessibilityBusy, setAccessibilityBusy] = useState(false);
  const [runtimeProbeModalOpen, setRuntimeProbeModalOpen] = useState(false);
  const [runtimeProbeRunning, setRuntimeProbeRunning] = useState(false);
  const [runtimeProbeResult, setRuntimeProbeResult] = useState<AgentRuntimeProbeState | null>(null);
  const [suggestionSeed, setSuggestionSeed] = useState(() => newPromptSuggestionSeed());
  const handleScribeStreamEvent = useCallback((event: AgentCliStreamEvent) => {
    const evidenceSessionId = activeEvidenceSessionIdRef.current;
    if (!evidenceSessionId) return;
    setLiveScribeStreams((current) => ({
      ...current,
      [evidenceSessionId]: {
        phase: event.phase ?? current[evidenceSessionId]?.phase,
        text: event.text ?? current[evidenceSessionId]?.text,
      },
    }));
  }, []);

  useEffect(() => {
    setCopilotMode(requestedMode);
  }, [requestedMode, modeRequestId]);
  const sessionsRef = useRef<AgentCopilotSession[]>([]);
  const evidenceSessionsRef = useRef<EvidenceSession[]>([]);
  const activeEvidenceSessionIdRef = useRef<string | null>(null);
  const stoppedEvidenceSessionIdsRef = useRef(new Set<string>());
  const runningSessionIdsRef = useRef(new Set<string>());
  const queuedAgentTurnsRef = useRef(new Map<string, AgentQueuedTurn[]>());
  const queuedAgentMessageIdsRef = useRef(new Set<string>());
  const ensureEvidenceAgentSessionPromisesRef = useRef(new Map<string, Promise<AgentCopilotSession>>());
  const deviceMutationChainsRef = useRef(new Map<string, Promise<void>>());
  const runAgentConversationRef = useRef<RunAgentConversation | null>(null);
  const scribeReviewRunningIdsRef = useRef(new Set<string>());
  const liveScribeLastSignatureRef = useRef<string | null>(null);
  const liveScribeLastManualCountRef = useRef(0);
  const messageViewportRef = useRef<HTMLDivElement | null>(null);
  const scribeViewportRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const composerComposingRef = useRef(false);
  const ignoreNextComposerEnterRef = useRef(false);
  const withDeviceMutationLock = useCallback(async <T,>(deviceSerial: string, action: () => Promise<T>): Promise<T> => {
    const previous = deviceMutationChainsRef.current.get(deviceSerial) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chain = previous.catch(() => undefined).then(() => gate);
    deviceMutationChainsRef.current.set(deviceSerial, chain);
    await previous.catch(() => undefined);
    try {
      return await action();
    } finally {
      release();
      if (deviceMutationChainsRef.current.get(deviceSerial) === chain) {
        deviceMutationChainsRef.current.delete(deviceSerial);
      }
    }
  }, []);
  const beginAgentSessionTurn = useCallback((sessionId: string) => {
    if (runningSessionIdsRef.current.has(sessionId)) return false;
    runningSessionIdsRef.current.add(sessionId);
    setRunningSessionIds(Array.from(runningSessionIdsRef.current));
    setLiveAgentStreams((current) => ({
      ...current,
      [sessionId]: { phase: "starting" },
    }));
    return true;
  }, []);
  const finishAgentSessionTurn = useCallback((sessionId: string) => {
    const queue = queuedAgentTurnsRef.current.get(sessionId) ?? [];
    const nextTurn = queue.shift();
    if (queue.length) queuedAgentTurnsRef.current.set(sessionId, queue);
    else queuedAgentTurnsRef.current.delete(sessionId);
    if (nextTurn) {
      setLiveAgentStreams((current) => ({ ...current, [sessionId]: { phase: "starting" } }));
      window.queueMicrotask(() => {
        void nextTurn.ready.then(() => {
          runningSessionIdsRef.current.delete(sessionId);
          const runNext = runAgentConversationRef.current;
          if (runNext) {
            return runNext(
              sessionId,
              nextTurn.prompt,
              nextTurn.attachments,
              nextTurn.skill,
              nextTurn.workingDirectory,
              nextTurn.messageId,
            );
          }
          setRunningSessionIds(Array.from(runningSessionIdsRef.current));
          return undefined;
        });
      });
      return;
    }
    runningSessionIdsRef.current.delete(sessionId);
    setRunningSessionIds(Array.from(runningSessionIdsRef.current));
    setLiveAgentStreams((current) => {
      const next = { ...current };
      delete next[sessionId];
      return next;
    });
  }, []);
  const taskAgentSessionIds = useMemo(
    () => new Set(evidenceSessions.map((session) => session.agentSessionId).filter((id): id is string => Boolean(id))),
    [evidenceSessions],
  );
  const chatSessions = useMemo(
    () => sessions.filter(
      (session) => session.scope !== "scout_task" && !taskAgentSessionIds.has(session.id),
    ),
    [sessions, taskAgentSessionIds],
  );
  const activeSession = chatSessions.find((session) => session.id === activeSessionId) ?? null;
  useEffect(() => {
    if (activeSessionId && !activeSession) {
      setActiveSessionId(chatSessions[0]?.id ?? null);
    }
  }, [activeSession, activeSessionId, chatSessions]);
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
  const currentContextLabel = t("agent.title");
  const activeConversationTitle = activeSession ? sessionDisplayTitle(activeSession, t) : t("agent.conversationTitle");
  const visibleEvidenceKind = evidenceKindForCopilotMode(copilotMode) ?? "walkthrough";

  useEffect(() => {
    setEvidenceTargetPackageDraft("");
    setTargetPackagePickerOpen(false);
  }, [deviceKey]);

  const activeEvidenceSessionForDevice = useMemo(
    () =>
      resolveActiveScoutTaskForMode(evidenceSessions, {
        mode: "chat",
        deviceKey,
        deviceSerial: deviceTarget.serial,
      }),
    [deviceKey, deviceTarget.serial, evidenceSessions],
  );
  const activeEvidenceSessionForSelectedMode = useMemo(
    () =>
      resolveActiveScoutTaskForMode(evidenceSessions, {
        mode: visibleEvidenceKind,
        deviceKey,
        deviceSerial: deviceTarget.serial,
      }),
    [deviceKey, deviceTarget.serial, evidenceSessions, visibleEvidenceKind],
  );
  const activeEvidenceSession = activeEvidenceSessionForSelectedMode;
  activeEvidenceSessionIdRef.current = activeEvidenceSession?.id ?? null;
  const activeEvidenceSessionForPrompt = copilotMode === "chat" ? activeEvidenceSessionForDevice : activeEvidenceSession;
  const activeEvidenceScribe = activeEvidenceSession ? normalizeEvidenceScribe(activeEvidenceSession.scribe) : null;
  const activeTaskAgentSession = activeEvidenceSession?.agentSessionId
    ? sessions.find((session) => session.id === activeEvidenceSession.agentSessionId) ?? null
    : null;
  const activeChatRunning = Boolean(activeSession && runningSessionIds.includes(activeSession.id));
  const activeTaskRunning = Boolean(activeTaskAgentSession && runningSessionIds.includes(activeTaskAgentSession.id));
  const activeScribeRunning = Boolean(activeEvidenceSession && scribeRunningEvidenceIds.includes(activeEvidenceSession.id));
  const visibleAgentStream = copilotMode === "chat"
    ? activeSession
      ? liveAgentStreams[activeSession.id]
      : null
    : activeTaskAgentSession
      ? liveAgentStreams[activeTaskAgentSession.id] ?? (activeEvidenceSession ? liveScribeStreams[activeEvidenceSession.id] : null)
      : activeEvidenceSession
        ? liveScribeStreams[activeEvidenceSession.id]
        : null;
  const visibleAgentStreamText = visibleAgentStream?.text
    ? formatAgentStreamPreview(visibleAgentStream.text, t)
    : "";
  const explicitWorkingDirectory =
    copilotMode === "chat"
      ? activeSession
        ? normalizeWorkingDirectory(activeSession.workingDirectory)
        : draftWorkingDirectories.chat
      : activeEvidenceSession
        ? normalizeWorkingDirectory(activeEvidenceSession.workingDirectory)
        : draftWorkingDirectories[visibleEvidenceKind];
  const fallbackWorkingDirectory = normalizeWorkingDirectory(cliProfile.cwd);
  const workingDirectoryIsInherited = !explicitWorkingDirectory && Boolean(fallbackWorkingDirectory);
  const activeScoutTaskRunState: ScoutTaskRunState = deriveScoutTaskRunState(activeEvidenceSession, {
    generatingReport: Boolean(activeEvidenceSession && reportingEvidenceId === activeEvidenceSession.id),
    failed: Boolean(activeEvidenceSession && reportFailureByEvidenceId[activeEvidenceSession.id]),
  });
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

  const resolveActiveEvidenceSessionForPrompt = useCallback(() => {
    const requiredKind = evidenceKindForCopilotMode(copilotMode);
    return resolveActiveScoutTaskForMode(evidenceSessionsRef.current, {
      mode: copilotMode === "chat" || !requiredKind ? "chat" : requiredKind,
      deviceKey,
      deviceSerial: deviceTarget.serial,
    });
  }, [copilotMode, deviceKey, deviceTarget.serial]);

  const resolveEvidenceSessionForAgentSession = useCallback((agentSessionId: string) => {
    return evidenceSessionsRef.current.find(
      (session) => session.status === "active" && session.agentSessionId === agentSessionId,
    ) ?? null;
  }, []);

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
            (session.artifacts.length || session.status === "active") &&
            (deviceKey ? session.deviceKey === deviceKey || session.deviceSerial === deviceTarget.serial : true),
        )
        .slice()
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 12),
    [deviceKey, deviceTarget.serial, evidenceSessions, visibleEvidenceKind],
  );
  const selectedEvidenceHistorySession = useMemo(() => {
    if (activeEvidenceSession) return null;
    const selectedId = selectedEvidenceHistoryIds[visibleEvidenceKind];
    if (selectedId === NEW_EVIDENCE_DRAFT_ID) return null;
    return recentEvidenceSessions.find((session) => session.id === selectedId) ?? recentEvidenceSessions[0] ?? null;
  }, [activeEvidenceSession, recentEvidenceSessions, selectedEvidenceHistoryIds, visibleEvidenceKind]);
  const newEvidenceDraftSelected = selectedEvidenceHistoryIds[visibleEvidenceKind] === NEW_EVIDENCE_DRAFT_ID;

  const selectEvidenceHistorySession = useCallback((session: EvidenceSession) => {
    setSelectedEvidenceHistoryIds((current) => ({
      ...current,
      [session.kind]: session.id,
    }));
    setCopilotMode(copilotModeForEvidenceKind(session.kind));
  }, []);

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

  const latestEvidenceArtifact = activeEvidenceSession?.artifacts[activeEvidenceSession.artifacts.length - 1];
  const latestActiveTaskMessage = activeTaskAgentSession?.messages[activeTaskAgentSession.messages.length - 1];
  useEffect(() => {
    if (!activeEvidenceSession) return;
    const viewport = scribeViewportRef.current;
    if (!viewport) return;
    window.requestAnimationFrame(() => {
      viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" });
    });
  }, [
    activeEvidenceSession?.id,
    activeEvidenceSession?.artifacts.length,
    latestEvidenceArtifact?.id,
    latestEvidenceArtifact?.body,
    activeTaskAgentSession?.messages.length,
    latestActiveTaskMessage?.body,
    latestActiveTaskMessage?.thinking,
    visibleAgentStream?.text,
    activeTaskRunning,
    activeScribeRunning,
  ]);

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

  const probeAgentCliProfile = useCallback(
    async (profile: typeof cliProfile): Promise<AgentRuntimeProbeCliResult> => {
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
            : buildAgentRuntimeProbeCliMissingMessage(result.stderr || result.stdout || `exit ${result.exitCode ?? "-"}`, t),
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
    },
    [t],
  );

  const buildRuntimeProbeApiResults = useCallback((): AgentRuntimeProbeApiResult[] => {
    return agentProviders.apiProviders.map((provider): AgentRuntimeProbeApiResult => {
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
  }, [agentProviders.apiProviders, t]);

  const runAgentRuntimeProbe = useCallback(async () => {
    setRuntimeProbeModalOpen(true);
    setRuntimeProbeRunning(true);
    const cliResults = await Promise.all(agentCli.profiles.filter((profile) => profile.command.trim()).map(probeAgentCliProfile));
    const apiResults = buildRuntimeProbeApiResults();
    setRuntimeProbeResult({
      checkedAt: Date.now(),
      available: cliResults.some((result) => result.ok) || apiResults.some((result) => result.ok),
      cliResults,
      apiResults,
    });
    setRuntimeProbeRunning(false);
  }, [agentCli.profiles, buildRuntimeProbeApiResults, probeAgentCliProfile]);

  const ensureCliRuntimeBeforeTask = useCallback(async () => {
    if (!cliConfigured) return false;
    setRuntimeProbeRunning(true);
    const cliResult = await probeAgentCliProfile(cliProfile);
    const apiResults = buildRuntimeProbeApiResults();
    setRuntimeProbeResult({
      checkedAt: Date.now(),
      available: cliResult.ok,
      cliResults: [cliResult],
      apiResults,
    });
    setRuntimeProbeRunning(false);
    if (!cliResult.ok) {
      setRuntimeProbeModalOpen(true);
      return false;
    }
    return true;
  }, [buildRuntimeProbeApiResults, cliConfigured, cliProfile, probeAgentCliProfile]);

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

  const ensureAgentApkBeforeTask = useCallback(async () => {
    if (deviceTarget.serial) await refreshAgentApkStatus();
    // Agent APK/accessibility is a capability, not a user approval gate. The
    // task can continue through the ADB/UIAutomator fallback and disclose the
    // lower-confidence control channel in its evidence.
    return true;
  }, [deviceTarget.serial, refreshAgentApkStatus]);

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

  const updateCurrentWorkingDirectory = useCallback(
    async (nextPath: string) => {
      const workingDirectory = normalizeWorkingDirectory(nextPath);
      if (copilotMode === "chat") {
        if (!activeSession) {
          setDraftWorkingDirectories((current) => ({ ...current, chat: workingDirectory }));
          return;
        }
        const next = sessionsRef.current.map((session) =>
          session.id === activeSession.id
            ? {
                ...session,
                workingDirectory: workingDirectory || null,
                updatedAt: Date.now(),
              }
            : session,
        );
        await commitSessions(next);
        return;
      }

      const currentEvidenceSession = activeEvidenceSession ?? resolveActiveScoutTaskForMode(evidenceSessionsRef.current, {
          mode: visibleEvidenceKind,
          deviceKey,
          deviceSerial: deviceTarget.serial,
        });
      if (!currentEvidenceSession) {
        setDraftWorkingDirectories((current) => ({ ...current, [visibleEvidenceKind]: workingDirectory }));
        return;
      }
      const next = evidenceSessionsRef.current.map((session) =>
        session.id === currentEvidenceSession.id
          ? {
              ...session,
              workingDirectory: workingDirectory || null,
              updatedAt: Date.now(),
            }
          : session,
      );
      await commitEvidenceSessions(next);
    },
    [activeEvidenceSession, activeSession, commitEvidenceSessions, commitSessions, copilotMode, deviceKey, deviceTarget.serial, visibleEvidenceKind],
  );

  const selectCurrentWorkingDirectory = useCallback(async () => {
    const dir = await invoke<string | null>("select_directory");
    if (dir) {
      await updateCurrentWorkingDirectory(dir);
    }
  }, [updateCurrentWorkingDirectory]);

  const clearCurrentWorkingDirectory = useCallback(async () => {
    await updateCurrentWorkingDirectory("");
  }, [updateCurrentWorkingDirectory]);

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
      let updatedSession: EvidenceSession | null = null;
      const next = evidenceSessionsRef.current.map((session) => {
        if (session.id !== sessionId) return session;
        const result = addScoutTaskArtifact(session, artifact, {
          deviceKey,
          deviceSerial: deviceTarget.serial,
        });
        updatedSession = result.session;
        return result.session;
      });
      await commitEvidenceSessions(next);
      return updatedSession;
    },
    [commitEvidenceSessions, deviceKey, deviceTarget.serial],
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

  const scoutTaskPorts = useMemo<ScoutTaskPorts>(
    () => ({
      loadTasks: async () => evidenceSessionsRef.current,
      saveTasks: commitEvidenceSessions,
      runAgentTurn: (prompt: string) =>
        runAgentCliTurn(cliProfile, prompt, t, activeEvidenceSessionForPrompt?.workingDirectory, handleScribeStreamEvent),
      executeWorkbenchCommand: (command: string, allowHighRisk: boolean) => {
        if (!deviceTarget.serial) throw new Error(t("agent.toolDeviceRequired"));
        return invoke<WorkbenchCommandResult>("adb_workbench_execute", {
          command,
          deviceSerial: deviceTarget.serial,
          allowHighRisk,
        });
      },
      captureScreenshot: () => {
        if (!deviceTarget.serial) throw new Error(t("agent.toolDeviceRequired"));
        if (!settings.screenshotDir) throw new Error(t("agent.toolScreenshotDirMissing"));
        return invoke<string>("adb_screenshot", {
          saveDir: settings.screenshotDir,
          deviceSerial: deviceTarget.serial,
        });
      },
      exportEvidencePackage: (session: EvidenceSession, reportMarkdown: string) =>
        invoke<EvidenceExportPackageResult | null>("export_evidence_package", {
          request: {
            defaultName: `evidence_${session.kind}_${new Date().toISOString().replace(/[:.]/g, "-")}.zip`,
            reportMarkdown,
            assets: buildEvidenceExportAssets(session),
          },
        }),
    }),
    [activeEvidenceSessionForPrompt?.workingDirectory, cliProfile, commitEvidenceSessions, deviceTarget.serial, handleScribeStreamEvent, settings.screenshotDir, t],
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

        if (agentApkStatus) {
          metadata.agentApkStatus = agentApkStatus.status;
          metadata.agentApkInstalled = agentApkStatus.installed;
          lines.push(`Agent APK: ${agentApkStatus.status} · installed=${agentApkStatus.installed}`);
        }

        if (options.includeScreenshot && settings.screenshotDir) {
          try {
            screenshotPath = await scoutTaskPorts.captureScreenshot();
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
    [agentApkStatus, currentContextLabel, deviceTarget.label, deviceTarget.serial, scoutTaskPorts, settings.screenshotDir, t],
  );

  const runEvidenceScribeReview = useCallback(
    async (session: EvidenceSession, reason: string, finalReport: boolean) => {
      if (!session.scribe?.enabled || scribeReviewRunningIdsRef.current.has(session.id)) return session;
      const linkedAgentSessionId = session.agentSessionId ?? null;
      if (linkedAgentSessionId && !beginAgentSessionTurn(linkedAgentSessionId)) return session;
      scribeReviewRunningIdsRef.current.add(session.id);
      setScribeRunningEvidenceIds(Array.from(scribeReviewRunningIdsRef.current));
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
          if (session.agentSessionId) {
            await appendMessage(session.agentSessionId, {
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
        const handleReviewStreamEvent = (event: AgentCliStreamEvent) => {
          if (linkedAgentSessionId) {
              setLiveAgentStreams((current) => ({
                ...current,
                [linkedAgentSessionId]: {
                  phase: event.phase ?? current[linkedAgentSessionId]?.phase,
                  text: event.text ?? current[linkedAgentSessionId]?.text,
                },
              }));
          } else {
            setLiveScribeStreams((current) => ({
              ...current,
              [session.id]: {
                phase: event.phase ?? current[session.id]?.phase,
                text: event.text ?? current[session.id]?.text,
              },
            }));
          }
        };
        if (!linkedAgentSessionId) {
          setLiveScribeStreams((current) => ({ ...current, [session.id]: { phase: "starting" } }));
        }
        const output = await runAgentCliTurn(cliProfile, prompt, t, session.workingDirectory, handleReviewStreamEvent);
        const currentSession = evidenceSessionsRef.current.find((item) => item.id === session.id) ?? null;
        if (
          stoppedEvidenceSessionIdsRef.current.has(session.id) ||
          !currentSession ||
          currentSession.status !== "active"
        ) {
          return currentSession ?? session;
        }
        const body = output || t("agent.agentRuntimeEmpty");
        const runtimeFailure = isAgentRuntimeFailureOutput(body);
        const updatedWithNote = await appendEvidenceArtifact(session.id, {
          id: `artifact-${Date.now()}-${finalReport ? "qa-report" : "scribe-note"}`,
          type: "agent_note",
          title: runtimeFailure
            ? t("agent.evidenceScribeRuntimeGap")
            : finalReport
              ? t("agent.evidenceQaReport")
              : t("agent.evidenceScribeNote"),
          body,
          createdAt: Date.now(),
          metadata: { reason, finalReport, reviewedArtifactId, runtimeGap: runtimeFailure },
        });
        if (session.agentSessionId) {
          await appendMessage(session.agentSessionId, {
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
            nextAction: runtimeFailure ? t("agent.scribeConfigureCliNextAction") : extractScribeNextAction(body),
            agentActive: runtimeFailure ? false : normalizeEvidenceScribe(current.scribe).agentActive,
            agentStoppedAt: runtimeFailure ? Date.now() : normalizeEvidenceScribe(current.scribe).agentStoppedAt,
          },
        }));
        return updated ?? updatedWithNote ?? session;
      } finally {
        scribeReviewRunningIdsRef.current.delete(session.id);
        setScribeRunningEvidenceIds(Array.from(scribeReviewRunningIdsRef.current));
        if (linkedAgentSessionId) finishAgentSessionTurn(linkedAgentSessionId);
        else {
          setLiveScribeStreams((current) => {
            const next = { ...current };
            delete next[session.id];
            return next;
          });
        }
      }
    },
    [
      appendEvidenceArtifact,
      appendMessage,
      beginAgentSessionTurn,
      cliConfigured,
      cliProfile,
      currentContextLabel,
      deviceTarget.label,
      deviceTarget.serial,
      finishAgentSessionTurn,
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
      options?: {
        goal?: string;
        targetPackage?: string | null;
        uiReferenceUrl?: string | null;
        intensity?: EvidenceScribeIntensity;
        permissionLevel?: ScoutTaskPermissionLevel;
        requestedByAgent?: boolean;
        workingDirectory?: string | null;
        skipInitialReview?: boolean;
      },
    ) => {
      const now = Date.now();
      const goal = (options?.goal ?? "").trim();
      const intensity = options?.intensity ?? DEFAULT_SCRIBE_INTENSITY;
      const permissionLevel = options?.permissionLevel ?? DEFAULT_SCOUT_TASK_PERMISSION_LEVEL;
      setCopilotMode(copilotModeForEvidenceKind(kind));
      const started = startScoutTask({
        id: `evidence-${now}`,
        kind,
        now,
        goal,
        deviceKey,
        deviceSerial: deviceTarget.serial,
        targetPackage: kind === "walkthrough" ? options?.targetPackage ?? null : null,
        uiReferenceUrl: kind === "walkthrough" ? options?.uiReferenceUrl ?? null : null,
        workingDirectory: options?.workingDirectory ?? null,
        permissionLevel,
      });
      const session: EvidenceSession = {
        ...started.session,
        title: goal || t(`agent.evidenceKind.${kind}`),
        scribe: {
          ...normalizeEvidenceScribe(started.session.scribe),
          intensity,
        },
      };
      setSelectedEvidenceHistoryIds((current) => ({
        ...current,
        [kind]: session.id,
      }));
      await commitEvidenceSessions([session, ...evidenceSessionsRef.current]);
      let updatedSession = await appendEvidenceArtifact(
        session.id,
        await captureScribeScreenState(session, "start", { includeScreenshot: true }),
      );
      if (!options?.skipInitialReview) {
        updatedSession = await maybeRunEvidenceScribeReview(updatedSession ?? session, "start");
      }
      setEvidenceGoalDraft("");
      if (kind === "walkthrough") {
        setEvidenceTargetPackageDraft("");
        setEvidenceUiReferenceUrlDraft("");
      }
      liveScribeLastSignatureRef.current = null;
      liveScribeLastManualCountRef.current = 0;
      return updatedSession ?? session;
    },
    [
      appendEvidenceArtifact,
      captureScribeScreenState,
      commitEvidenceSessions,
      deviceKey,
      deviceTarget.serial,
      maybeRunEvidenceScribeReview,
      t,
    ],
  );

  const prepareWalkthroughTargetSurface = useCallback(
    async (session: EvidenceSession) => {
      if (session.kind !== "walkthrough" || !deviceTarget.serial) return session;

      const targetPackage = normalizeEvidenceScribe(session.scribe).targetPackage?.trim();
      if (!targetPackage) return session;

      let updatedSession = session;
      try {
        const launchableApps = await invoke<LaunchableApp[]>("adb_list_launchable_apps", {
          deviceSerial: deviceTarget.serial,
        });
        const targetApp = launchableApps.find((app) => app.package_name === targetPackage);
        if (!targetApp) {
          return updatedSession;
        }

        await withDeviceMutationLock(deviceTarget.serial, async () => {
          const output = await invoke<string>("adb_launch_app", {
            deviceSerial: deviceTarget.serial,
            componentName: targetApp.component_name,
          });
          await waitForUiSettle();
          const snapshot = await invoke<AgentUiSnapshot>("adb_ui_snapshot", { deviceSerial: deviceTarget.serial }).catch(() => null);
          const screenState = await captureScribeScreenState(updatedSession, "target_app_launch", {
            includeScreenshot: true,
            lightweight: true,
          });
          updatedSession = (await appendEvidenceArtifact(updatedSession.id, screenState)) ?? updatedSession;
          updatedSession = (await appendEvidenceArtifact(updatedSession.id, {
            id: `artifact-${Date.now()}-target-app-launch`,
            type: "agent_note",
            title: t("agent.evidenceAppLaunch"),
            body: formatAppLaunchEvidence(targetApp, output, snapshot),
            createdAt: Date.now(),
            metadata: {
              packageName: targetApp.package_name,
              componentName: targetApp.component_name,
              visibleUiNodeCount: snapshot?.nodes.length ?? 0,
              screenshotPath: screenState.path ?? null,
              source: "scout_start_preflight",
            },
          })) ?? updatedSession;
        });
      } catch (error) {
        updatedSession = (await appendEvidenceArtifact(updatedSession.id, {
          id: `artifact-${Date.now()}-target-app-launch-failed`,
          type: "agent_note",
          title: t("agent.evidenceAppLaunch"),
          body: `Action: launch selected walkthrough package\nPackage: ${targetPackage}\nResult: failed\nError: ${String(error)}`,
          createdAt: Date.now(),
          metadata: {
            packageName: targetPackage,
            source: "scout_start_preflight",
            ok: false,
          },
        })) ?? updatedSession;
      }
      return updatedSession;
    },
    [appendEvidenceArtifact, captureScribeScreenState, deviceTarget.serial, t, withDeviceMutationLock],
  );

  const closeEvidenceSession = useCallback(async (
    sessionOverride?: EvidenceSession,
    options?: { reportBody?: string },
  ) => {
    const sessionToClose = sessionOverride ?? activeEvidenceSession;
    if (!sessionToClose) return;
    setReportingEvidenceId(sessionToClose.id);
    setReportFailureByEvidenceId((current) => {
      const next = { ...current };
      delete next[sessionToClose.id];
      return next;
    });
    try {
      const currentSession = evidenceSessionsRef.current.find((session) => session.id === sessionToClose.id) ?? sessionToClose;
      const reviewedSession = options?.reportBody
        ? currentSession
        : (await maybeRunEvidenceScribeReview(currentSession, "end", { finalReport: true })) ?? currentSession;
      const latestSession = evidenceSessionsRef.current.find((session) => session.id === sessionToClose.id) ?? null;
      if (
        stoppedEvidenceSessionIdsRef.current.has(sessionToClose.id) ||
        latestSession?.artifacts.some((artifact) => artifact.metadata?.taskStoppedByUser === true)
      ) {
        return latestSession ?? reviewedSession;
      }
      const reportArtifact = latestFinalReportArtifact(reviewedSession);
      const reportBody =
        options?.reportBody ||
        reportArtifact?.body ||
        normalizeEvidenceScribe(reviewedSession.scribe).coverageSummary ||
        t("agent.evidenceReportGeneratedFallback");
      const now = Date.now();
      const closed = stopScoutTaskWithReport(reviewedSession, {
        now,
        reportBody,
        reportArtifact: reportArtifact ?? undefined,
      });
      const next = evidenceSessionsRef.current.map((session) => (session.id === sessionToClose.id ? closed.session : session));
      await commitEvidenceSessions(next);
      return closed.session;
    } catch (error) {
      const reason = String(error);
      const now = Date.now();
      const failed = failScoutTaskReport(sessionToClose, { now, error: reason });
      const next = evidenceSessionsRef.current.map((session) => (session.id === sessionToClose.id ? failed.session : session));
      await commitEvidenceSessions(next);
      setReportFailureByEvidenceId((current) => ({ ...current, [sessionToClose.id]: reason }));
      if (sessionToClose.agentSessionId) {
        await appendMessage(sessionToClose.agentSessionId, {
          id: `msg-${now}-qa-report-failed`,
          role: "assistant",
          body: t("agent.evidenceReportFailed", { reason }),
          createdAt: now,
        });
      }
      return failed.session;
    } finally {
      setReportingEvidenceId(null);
    }
  }, [activeEvidenceSession, appendMessage, commitEvidenceSessions, maybeRunEvidenceScribeReview, t]);

  const stopActiveEvidenceTask = useCallback(async () => {
    const sessionToStop = activeEvidenceSession;
    if (!sessionToStop || stoppingEvidenceId === sessionToStop.id) return;
    setStoppingEvidenceId(sessionToStop.id);
    stoppedEvidenceSessionIdsRef.current.add(sessionToStop.id);

    const taskAgentSessionId = sessionToStop.agentSessionId ?? null;
    if (taskAgentSessionId) {
      const queuedTurns = queuedAgentTurnsRef.current.get(taskAgentSessionId) ?? [];
      queuedTurns.forEach((turn) => {
        if (turn.messageId) queuedAgentMessageIdsRef.current.delete(turn.messageId);
      });
      queuedAgentTurnsRef.current.delete(taskAgentSessionId);
      runningSessionIdsRef.current.delete(taskAgentSessionId);
      setRunningSessionIds(Array.from(runningSessionIdsRef.current));
      setLiveAgentStreams((current) => {
        const next = { ...current };
        delete next[taskAgentSessionId];
        return next;
      });
    }
    scribeReviewRunningIdsRef.current.delete(sessionToStop.id);
    setScribeRunningEvidenceIds(Array.from(scribeReviewRunningIdsRef.current));
    setLiveScribeStreams((current) => {
      const next = { ...current };
      delete next[sessionToStop.id];
      return next;
    });

    try {
      const stopped = stopScoutTaskByUser(sessionToStop, {
        now: Date.now(),
        title: t("agent.evidenceStoppedTitle"),
        summary: t("agent.evidenceStoppedSummary"),
      });
      const next = evidenceSessionsRef.current.map((session) =>
        session.id === sessionToStop.id ? stopped.session : session,
      );
      await commitEvidenceSessions(next);
    } catch (error) {
      stoppedEvidenceSessionIdsRef.current.delete(sessionToStop.id);
      window.alert(t("agent.evidenceStopFailed", { reason: String(error) }));
    } finally {
      setStoppingEvidenceId(null);
    }
  }, [activeEvidenceSession, commitEvidenceSessions, stoppingEvidenceId, t]);

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

  const exportEvidenceReport = useCallback(async (sessionOverride?: EvidenceSession) => {
    const sessionToExport = sessionOverride ?? activeEvidenceSession;
    if (!sessionToExport) return;
    const result = await scoutTaskPorts.exportEvidencePackage(
      sessionToExport,
      buildEvidenceSessionReport(sessionToExport, t),
    ) as EvidenceExportPackageResult | null;
    const taskAgentSessionId = sessionToExport.agentSessionId;
    if (result && taskAgentSessionId) {
      await appendMessage(taskAgentSessionId, {
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
  }, [activeEvidenceSession, appendMessage, scoutTaskPorts, t]);

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
    async (
      skill: AndroidAgentSkill,
      title?: string,
      options?: {
        workingDirectory?: string | null;
        scope?: AgentCopilotSession["scope"];
        evidenceSessionId?: string | null;
      },
    ) => {
      const now = Date.now();
      const workingDirectory = normalizeWorkingDirectory(options?.workingDirectory) || null;
      const session: AgentCopilotSession = {
        id: `agent-${now}`,
        title: title?.trim() || t("agent.conversationTitle"),
        createdAt: now,
        updatedAt: now,
        deviceKey,
        deviceSerial: deviceTarget.serial,
        skillId: skill.id,
        cliProfileId: cliProfile.id,
        scope: options?.scope ?? "chat",
        evidenceSessionId: options?.evidenceSessionId ?? null,
        workingDirectory,
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
      if (session.scope === "chat") {
        setActiveSessionId(session.id);
        refreshPromptSuggestions();
      }
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

  const deleteEvidenceHistorySession = useCallback(
    async (sessionId: string) => {
      const session = evidenceSessionsRef.current.find((item) => item.id === sessionId);
      if (!session || session.status === "active") return;

      const nextEvidenceSessions = evidenceSessionsRef.current.filter((item) => item.id !== sessionId);
      await commitEvidenceSessions(nextEvidenceSessions);
      setSelectedEvidenceHistoryIds((current) => {
        if (current[session.kind] !== sessionId) return current;
        const next = { ...current };
        delete next[session.kind];
        return next;
      });

      const linkedAgentSessionIds = new Set(
        sessionsRef.current
          .filter((item) => item.scope === "scout_task" && item.evidenceSessionId === sessionId)
          .map((item) => item.id),
      );
      if (session.agentSessionId) linkedAgentSessionIds.add(session.agentSessionId);
      if (!linkedAgentSessionIds.size) return;
      const nextAgentSessions = sessionsRef.current.filter((item) => !linkedAgentSessionIds.has(item.id));
      await commitSessions(nextAgentSessions);
      setActiveSessionId((current) => (
        current && linkedAgentSessionIds.has(current) ? nextAgentSessions[0]?.id ?? null : current
      ));
      setLiveAgentStreams((current) => {
        const next = { ...current };
        linkedAgentSessionIds.forEach((agentSessionId) => delete next[agentSessionId]);
        return next;
      });
    },
    [commitEvidenceSessions, commitSessions],
  );

  const appendPendingAttachments = useCallback((attachments: AgentCopilotAttachment[]) => {
    if (!attachments.length) return;
    setPendingAttachments((current) => [...current, ...attachments].slice(0, ATTACHMENT_LIMIT));
  }, []);

  const readSelectedAttachments = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.currentTarget.files ?? []);
      event.currentTarget.value = "";
      return files.length ? Promise.all(files.map(readAttachment)) : [];
    },
    [],
  );

  const handleFilesSelected = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      void readSelectedAttachments(event).then(appendPendingAttachments);
    },
    [appendPendingAttachments, readSelectedAttachments],
  );

  const handleAttachmentPaste = useCallback(
    (
      event: ClipboardEvent<HTMLTextAreaElement>,
      appendAttachments: (attachments: AgentCopilotAttachment[]) => void,
      setText: (updater: (current: string) => string) => void,
      isCurrent: () => boolean = () => true,
    ) => {
      const clipboard = event.clipboardData;
      if (!clipboard) return;

      const files = filesFromClipboardData(clipboard);
      const plainText = clipboard.getData("text/plain");
      const pathCandidates = clipboardPathCandidates(clipboard);
      const shouldProbeForFiles =
        files.length > 0 ||
        pathCandidates.length > 0 ||
        hasNativeFileClipboardSignal(clipboard) ||
        looksLikePastedFilename(plainText);

      if (!shouldProbeForFiles) return;

      event.preventDefault();
      const textarea = event.currentTarget;
      const selectionStart = textarea.selectionStart;
      const selectionEnd = textarea.selectionEnd;

      void (async () => {
        if (files.length) {
          const attachments = await Promise.all(files.map(readAttachment));
          if (isCurrent()) appendAttachments(attachments);
          return;
        }

        const pathAttachments = pathCandidates.length
          ? await invoke<AgentAttachmentFilePayload[]>("read_agent_attachment_files", { paths: pathCandidates })
              .then((payloads) => payloads.map(attachmentFromFilePayload))
              .catch(() => [])
          : [];
        if (pathAttachments.length) {
          if (isCurrent()) appendAttachments(pathAttachments);
          return;
        }

        const clipboardAttachments = await invoke<AgentAttachmentFilePayload[]>("read_clipboard_agent_attachment_files")
          .then((payloads) => payloads.map(attachmentFromFilePayload))
          .catch(() => []);
        if (clipboardAttachments.length) {
          if (isCurrent()) appendAttachments(clipboardAttachments);
          return;
        }

        if (plainText && isCurrent()) {
          insertTextIntoDraftAtSelection(plainText, selectionStart, selectionEnd, textarea, setText);
        }
      })();
    },
    [],
  );

  const handleComposerPaste = useCallback(
    (event: ClipboardEvent<HTMLTextAreaElement>) => {
      handleAttachmentPaste(event, appendPendingAttachments, setDraft);
    },
    [appendPendingAttachments, handleAttachmentPaste],
  );

  const handleEvidencePathPaste = useCallback(
    (
      event: ClipboardEvent<HTMLInputElement | HTMLTextAreaElement>,
      setValue: (updater: (current: string) => string) => void,
    ) => {
      const clipboard = event.clipboardData;
      if (!clipboard) return;

      const nativeFilePaste =
        filesFromClipboardData(clipboard).length > 0 ||
        clipboardPathCandidates(clipboard).length > 0 ||
        hasNativeFileClipboardSignal(clipboard) ||
        looksLikePastedFilename(clipboard.getData("text/plain"));
      if (!nativeFilePaste) return;

      event.preventDefault();
      const selectionStart = event.currentTarget.selectionStart;
      const selectionEnd = event.currentTarget.selectionEnd;
      const fallback = clipboardPathCandidates(clipboard)[0] ?? clipboard.getData("text/plain").trim();

      void invoke<string[]>("read_clipboard_local_paths")
        .then((paths) => paths[0] ?? fallback)
        .catch(() => fallback)
        .then((path) => {
          if (!path) return;
          setValue((current) => insertTextAtSelection(current, path, selectionStart, selectionEnd));
        });
    },
    [],
  );

  const removePendingAttachment = useCallback((attachmentId: string) => {
    setPendingAttachments((current) => current.filter((attachment) => attachment.id !== attachmentId));
  }, []);

  const executeUiActionForAgent = useCallback(
    async (
      tool: AgentToolCall["tool"],
      args: Record<string, unknown>,
      options: {
        allowSensitive?: boolean;
        evidenceSessionOverride?: EvidenceSession | null;
      } = {},
    ) => {
      const deviceSerial = deviceTarget.serial;
      if (!deviceSerial) throw new Error(t("agent.toolDeviceRequired"));
      return withDeviceMutationLock(deviceSerial, async () => {
      const beforeSnapshot = await invoke<AgentUiSnapshot>("adb_ui_snapshot", { deviceSerial });
      const resolvedArgs = validateUiActionAgainstSnapshot(
        tool,
        args,
        beforeSnapshot,
        Boolean(options.allowSensitive),
      );
      const action = await invokeAgentUiAction(tool, resolvedArgs, deviceSerial);
      const evidenceSession = options.evidenceSessionOverride !== undefined
        ? options.evidenceSessionOverride
        : activeEvidenceSessionForPrompt ?? resolveActiveEvidenceSessionForPrompt();
      let snapshot: AgentUiSnapshot | null = null;
      try {
        await waitForUiSettle();
        snapshot = await invoke<AgentUiSnapshot>("adb_ui_snapshot", { deviceSerial });
      } catch {
        // The input can be accepted while a vendor image temporarily blocks hierarchy inspection.
      }
      const verified = Boolean(snapshot && didUiSnapshotChange(beforeSnapshot, snapshot));
      if (evidenceSession) {
        const screenState = await captureScribeScreenState(evidenceSession, `ui_${action.action}`, {
          includeScreenshot: true,
          lightweight: true,
        });
        await appendEvidenceArtifact(evidenceSession.id, screenState);
        await appendEvidenceArtifact(evidenceSession.id, {
          id: `artifact-${Date.now()}-ui-${action.action}`,
          type: "agent_note",
          title: t("agent.evidenceUiAction"),
          body: formatUiActionEvidence(action, resolvedArgs, snapshot, verified),
          createdAt: Date.now(),
          metadata: {
            uiAction: action.action,
            uiArgs: resolvedArgs,
            uiNodeCount: snapshot?.nodes.length ?? 0,
            uiVerified: verified,
            screenshotPath: screenState.path ?? null,
          },
        });
      }
      return { action, snapshot, verified };
      });
    },
    [
      activeEvidenceSessionForPrompt,
      appendEvidenceArtifact,
      captureScribeScreenState,
      deviceTarget.serial,
      resolveActiveEvidenceSessionForPrompt,
      t,
      withDeviceMutationLock,
    ],
  );

  const approveAgentCommand = useCallback(
    async (sessionId: string, messageId: string, approval: AgentApprovalRequest) => {
      if (approval.tool === "reference.figma.login") {
        await updateMessage(sessionId, messageId, (message) => ({
          ...message,
          approval: message.approval ? { ...message.approval, status: "running" } : message.approval,
        }));
        try {
          const result = await invoke<AgentFigmaLoginLaunchResult>("agent_start_figma_mcp_login");
          await updateMessage(sessionId, messageId, (message) => ({
            ...message,
            approval: message.approval ? { ...message.approval, status: "approved" } : message.approval,
          }));
          await appendMessage(sessionId, {
            id: `msg-${Date.now()}-figma-login-started`,
            role: "command",
            body: `${t("agent.figmaLoginLaunched")}\n${result.loginUrl}`,
            createdAt: Date.now(),
            command: result.command,
            ok: true,
          });
        } catch (error) {
          await updateMessage(sessionId, messageId, (message) => ({
            ...message,
            approval: message.approval ? { ...message.approval, status: "pending" } : message.approval,
          }));
          await appendMessage(sessionId, {
            id: `msg-${Date.now()}-figma-login-failed`,
            role: "command",
            body: `${t("agent.figmaLoginFailed")}\n\n${String(error)}`,
            createdAt: Date.now(),
            command: approval.command,
            ok: false,
          });
        }
        return;
      }
      if (isAgentUiActionTool(approval.tool)) {
        await updateMessage(sessionId, messageId, (message) => ({
          ...message,
          approval: message.approval ? { ...message.approval, status: "running" } : message.approval,
        }));
        try {
          const result = await executeUiActionForAgent(approval.tool, approval.args ?? {}, {
            allowSensitive: true,
            evidenceSessionOverride: resolveEvidenceSessionForAgentSession(sessionId),
          });
          await updateMessage(sessionId, messageId, (message) => ({
            ...message,
            approval: message.approval ? { ...message.approval, status: "approved" } : message.approval,
          }));
          await appendMessage(sessionId, {
            id: `msg-${Date.now()}-approved-ui-action`,
            role: "command",
            body: `${t("agent.approvalExecuted")}\n\n${formatUiActionEvidence(result.action, approval.args ?? {}, result.snapshot, result.verified)}`,
            createdAt: Date.now(),
            command: approval.command,
            ok: true,
          });
        } catch (error) {
          await updateMessage(sessionId, messageId, (message) => ({
            ...message,
            approval: message.approval ? { ...message.approval, status: "pending" } : message.approval,
          }));
          await appendMessage(sessionId, {
            id: `msg-${Date.now()}-approved-ui-action-failed`,
            role: "command",
            body: `${t("agent.toolFailed", { tool: approval.tool })}\n\n${String(error)}`,
            createdAt: Date.now(),
            command: approval.command,
            ok: false,
          });
        }
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
      const approvalDeviceSerial = deviceTarget.serial;

      await updateMessage(sessionId, messageId, (message) => ({
        ...message,
        approval: message.approval ? { ...message.approval, status: "running" } : message.approval,
      }));

      try {
        const result = await withDeviceMutationLock(approvalDeviceSerial, () =>
          invoke<WorkbenchCommandResult>("adb_workbench_execute", {
            command: approval.command,
            deviceSerial: approvalDeviceSerial,
            allowHighRisk: true,
          }),
        );
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
    [
      appendMessage,
      deviceTarget.serial,
      executeUiActionForAgent,
      resolveEvidenceSessionForAgentSession,
      t,
      updateMessage,
      withDeviceMutationLock,
    ],
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
    async (
      call: AgentToolCall,
      evidenceSessionOverride?: EvidenceSession | null,
      permissionLevelOverride?: ScoutTaskPermissionLevel,
    ): Promise<AgentToolResult> => {
      const deviceSerial = deviceTarget.serial;
      const evidenceSessionForTool = evidenceSessionOverride !== undefined
        ? evidenceSessionOverride
        : activeEvidenceSessionForPrompt ?? resolveActiveEvidenceSessionForPrompt();
      const activePermission: ScoutTaskPermissionLevel = permissionLevelOverride ?? (
        evidenceSessionForTool ? "auto_execute" : "read_only"
      );
      if (call.tool === "evidence.get_active_record") {
        if (!evidenceSessionForTool) {
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
          summary: t("agent.toolEvidenceRecord", { count: evidenceSessionForTool.artifacts.length }),
          data: serializeEvidenceSessionForTool(evidenceSessionForTool),
        };
      }
      if (call.tool === "reference.feishu.fetch") {
        const url = stringArg(call.args.url);
        if (!url) {
          return {
            id: call.id,
            tool: call.tool,
            ok: false,
            summary: t("agent.referenceUrlMissing"),
            error: t("agent.referenceUrlMissing"),
          };
        }
        const result = await invoke<AgentFeishuReferenceResult>("agent_fetch_feishu_reference", { url });
        return {
          id: call.id,
          tool: call.tool,
          ok: true,
          summary: t("agent.toolFeishuReferenceFetched"),
          data: result,
        };
      }
      if (call.tool === "reference.figma.mcp_status") {
        const result = await invoke<AgentFigmaMcpStatusResult>("agent_get_figma_mcp_status");
        return {
          id: call.id,
          tool: call.tool,
          ok: result.configured && result.authenticated,
          summary: result.authenticated ? t("agent.toolFigmaMcpReady") : t("agent.toolFigmaMcpLoginRequired"),
          data: result,
          error: result.authenticated ? undefined : result.message,
        };
      }
      if (call.tool === "reference.figma.login") {
        if (activePermission === "auto_execute") {
          const command = "codex mcp login figma";
          return {
            id: call.id,
            tool: call.tool,
            ok: false,
            summary: t("agent.toolProtectedActionBlocked", { action: command }),
            error: t("agent.toolProtectedActionBlocked", { action: command }),
            data: {
              blocked: true,
              requiresHumanAction: true,
              humanAction: t("agent.protectedActionNextStep"),
              command,
              reason: "external_login",
            },
          };
        }
        const approval: AgentApprovalRequest = {
          id: call.id,
          tool: call.tool,
          command: "codex mcp login figma",
          risk: "low",
          reason: t("agent.figmaLoginApprovalReason"),
          status: "pending",
        };
        return {
          id: call.id,
          tool: call.tool,
          ok: false,
          summary: t("agent.toolApprovalRequired"),
          error: t("agent.toolApprovalRequired"),
          data: { approvalRequired: true, loginUrl: "https://www.figma.com/login" },
          approval,
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
            if (evidenceSessionForTool) {
              await appendEvidenceArtifact(evidenceSessionForTool.id, {
                id: `artifact-${Date.now()}-agent-screenshot`,
                type: "screenshot",
                title: t("agent.evidenceScreenshot"),
                path,
                createdAt: Date.now(),
                metadata: buildEvidenceEventMetadata("agent_screen_capture", deviceTarget, currentContextLabel),
              });
            }
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
          case "app.launch": {
            const packageName = stringArg(call.args.packageName);
            if (!isValidAndroidPackageName(packageName)) {
              return {
                id: call.id,
                tool: call.tool,
                ok: false,
                summary: t("agent.toolAppLaunchPackageMissing"),
                error: t("agent.toolAppLaunchPackageMissing"),
              };
            }
            if (activePermission !== "auto_execute") {
              return {
                id: call.id,
                tool: call.tool,
                ok: false,
                summary: t("agent.toolAppLaunchAutoTaskOnly"),
                error: t("agent.toolAppLaunchAutoTaskOnly"),
              };
            }
            const result = await withDeviceMutationLock(deviceSerial, async () => {
              const apps = await invoke<LaunchableApp[]>("adb_list_launchable_apps", { deviceSerial });
              const app = apps.find((candidate) => candidate.package_name === packageName);
              if (!app) throw new Error(t("agent.toolAppLaunchNotAvailable", { packageName }));

              const output = await invoke<string>("adb_launch_app", {
                deviceSerial,
                componentName: app.component_name,
              });
              await waitForUiSettle();
              const snapshot = await invoke<AgentUiSnapshot>("adb_ui_snapshot", { deviceSerial }).catch(() => null);
              const screenState = evidenceSessionForTool
                ? await captureScribeScreenState(evidenceSessionForTool, "app_launch", {
                    includeScreenshot: true,
                    lightweight: true,
                  })
                : null;
              if (evidenceSessionForTool && screenState) {
                await appendEvidenceArtifact(evidenceSessionForTool.id, screenState);
                await appendEvidenceArtifact(evidenceSessionForTool.id, {
                  id: `artifact-${Date.now()}-app-launch`,
                  type: "agent_note",
                  title: t("agent.evidenceAppLaunch"),
                  body: formatAppLaunchEvidence(app, output, snapshot),
                  createdAt: Date.now(),
                  metadata: {
                    packageName: app.package_name,
                    componentName: app.component_name,
                    visibleUiNodeCount: snapshot?.nodes.length ?? 0,
                    screenshotPath: screenState.path ?? null,
                  },
                });
              }
              return { app, output, snapshot };
            });
            const visibleNodeCount = result.snapshot?.nodes.length ?? 0;
            return {
              id: call.id,
              tool: call.tool,
              ok: true,
              summary: visibleNodeCount > 0
                ? t("agent.toolAppLaunched", { label: result.app.label, count: visibleNodeCount })
                : t("agent.toolAppLaunchedUiUnavailable", { label: result.app.label }),
              data: {
                packageName: result.app.package_name,
                componentName: result.app.component_name,
                output: result.output,
                snapshot: compactUiSnapshot(result.snapshot),
                visibleNodeCount,
              },
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
          case "ui.inspect": {
            const snapshot = await invoke<AgentUiSnapshot>("adb_ui_snapshot", { deviceSerial });
            return {
              id: call.id,
              tool: call.tool,
              ok: true,
              summary: t("agent.toolUiSnapshot", { count: snapshot.nodes.length }),
              data: compactUiSnapshot(snapshot),
            };
          }
          case "ui.tap":
          case "ui.swipe":
          case "ui.press_back": {
            const validationError = validateAgentUiAction(call.tool, call.args);
            if (validationError) {
              return {
                id: call.id,
                tool: call.tool,
                ok: false,
                summary: validationError,
                error: validationError,
              };
            }
            let beforeSnapshot: AgentUiSnapshot;
            try {
              beforeSnapshot = await invoke<AgentUiSnapshot>("adb_ui_snapshot", { deviceSerial });
              validateUiActionAgainstSnapshot(call.tool, call.args, beforeSnapshot, true);
            } catch (error) {
              return {
                id: call.id,
                tool: call.tool,
                ok: false,
                summary: String(error),
                error: String(error),
              };
            }
            const command = describeAgentUiAction(call.tool, call.args);
            const approval: AgentApprovalRequest = {
              id: call.id,
              tool: call.tool,
              command,
              risk: agentUiActionRisk(call.tool, call.args, beforeSnapshot),
              reason: stringArg(call.args.reason) || t("agent.uiActionApprovalReason"),
              status: "pending",
              args: call.args,
            };
            const executionDecision = decideScoutToolExecution({
              permissionLevel: activePermission,
              command,
              risk: approval.risk,
            });
            if (executionDecision.action === "auto_execute") {
              const result = await executeUiActionForAgent(call.tool, call.args, {
                evidenceSessionOverride: evidenceSessionForTool,
              });
              return {
                id: call.id,
                tool: call.tool,
                ok: result.verified,
                summary: result.verified
                  ? t("agent.toolUiActionExecuted", { action: result.action.action })
                  : t("agent.toolUiActionUnverified", { action: result.action.action }),
                data: {
                  action: result.action,
                  snapshot: compactUiSnapshot(result.snapshot),
                  verified: result.verified,
                },
              };
            }
            if (executionDecision.action === "block") {
              return {
                id: call.id,
                tool: call.tool,
                ok: false,
                summary: t("agent.toolProtectedActionBlocked", { action: command }),
                error: t("agent.toolProtectedActionBlocked", { action: command }),
                data: {
                  blocked: true,
                  requiresHumanAction: true,
                  humanAction: t("agent.protectedActionNextStep"),
                  command,
                  risk: approval.risk,
                  reason: executionDecision.reason,
                },
              };
            }
            return {
              id: call.id,
              tool: call.tool,
              ok: false,
              summary: t("agent.toolApprovalRequired"),
              error: t("agent.toolApprovalRequired"),
              data: { approvalRequired: true, command, risk: approval.risk },
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
            const executionDecision = decideScoutToolExecution({
              permissionLevel: activePermission,
              command,
              risk: approval.risk,
            });
            if (executionDecision.action === "auto_execute") {
              const result = await withDeviceMutationLock(deviceSerial, async () => {
                const commandResult = (await scoutTaskPorts.executeWorkbenchCommand(
                  command,
                  false,
                )) as WorkbenchCommandResult;
                if ((commandResult.exit_code ?? 0) === 0 && evidenceSessionForTool) {
                  const screenState = await captureScribeScreenState(evidenceSessionForTool, "auto_execute_action", {
                    includeScreenshot: true,
                  });
                  await appendEvidenceArtifact(evidenceSessionForTool.id, screenState);
                }
                return commandResult;
              });
              return {
                id: call.id,
                tool: call.tool,
                ok: (result.exit_code ?? 0) === 0,
                summary: t("agent.toolAutoExecuted", { command: result.command }),
                data: result,
              };
            }
            if (executionDecision.action === "block") {
              return {
                id: call.id,
                tool: call.tool,
                ok: false,
                summary: t("agent.toolProtectedActionBlocked", { action: command }),
                error: t("agent.toolProtectedActionBlocked", { action: command }),
                data: {
                  blocked: true,
                  requiresHumanAction: true,
                  humanAction: t("agent.protectedActionNextStep"),
                  command,
                  risk: approval.risk,
                  reason: executionDecision.reason,
                },
              };
            }
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
    [
      activeEvidenceSessionForPrompt,
      appendEvidenceArtifact,
      captureScribeScreenState,
      currentContextLabel,
      deviceTarget,
      deviceTarget.serial,
      executeUiActionForAgent,
      resolveActiveEvidenceSessionForPrompt,
      scoutTaskPorts,
      settings.screenshotDir,
      t,
      withDeviceMutationLock,
    ],
  );

  const runAgentConversation = useCallback(
    async (
      sessionId: string,
      prompt: string,
      attachments: AgentCopilotAttachment[],
      skill: AndroidAgentSkill,
      workingDirectory: string | null,
      queuedMessageId?: string,
    ) => {
      if (!beginAgentSessionTurn(sessionId)) return;
      const handleSessionStreamEvent = (event: AgentCliStreamEvent) => {
        setLiveAgentStreams((current) => ({
          ...current,
          [sessionId]: {
            phase: event.phase ?? current[sessionId]?.phase,
            text: event.text ?? current[sessionId]?.text,
          },
        }));
      };

      let conversationSession: AgentCopilotSession | undefined;
      let failureEvidenceSession: EvidenceSession | null = null;
      let closeFailureEvidence = false;
      let activeThinkingMessageId: string | null = null;
      let failureCliName = cliProfile.name;
      try {
        if (queuedMessageId) {
          queuedAgentMessageIdsRef.current.delete(queuedMessageId);
        }
        const session = sessionsRef.current.find((item) => item.id === sessionId);
        conversationSession = session;
        const conversationCliProfile = agentCli.profiles.find((profile) => profile.id === session?.cliProfileId) ?? cliProfile;
        failureCliName = conversationCliProfile.name;
        const sessionDeviceMatches =
          !session?.deviceKey ||
          !deviceKey ||
          session.deviceKey === deviceKey ||
          session.deviceSerial === deviceTarget.serial;
        if (!sessionDeviceMatches) {
          await appendMessage(sessionId, {
            id: `msg-${Date.now()}-device-changed`,
            role: "assistant",
            body: t("agent.taskDeviceChanged"),
            createdAt: Date.now(),
            skillId: skill.id,
          });
          return;
        }
        if (!conversationCliProfile.command.trim()) {
          const thinkingMessageId = await appendThinkingMessage(sessionId, skill.id);
          await updateMessage(sessionId, thinkingMessageId, (message) => ({
            ...message,
            body: t("agent.agentRuntimeUnavailable", { cli: conversationCliProfile.name }),
            thinking: false,
          }));
          return;
        }

        const linkedEvidenceSession = session?.evidenceSessionId
          ? evidenceSessionsRef.current.find((item) => item.id === session.evidenceSessionId) ?? null
          : resolveEvidenceSessionForAgentSession(sessionId);
        const taskScopedConversation = session?.scope === "scout_task" || Boolean(linkedEvidenceSession);
        const evidenceSessionForConversation = taskScopedConversation
          ? linkedEvidenceSession?.status === "active" ? linkedEvidenceSession : null
          : activeEvidenceSessionForPrompt ?? resolveActiveEvidenceSessionForPrompt();
        failureEvidenceSession = evidenceSessionForConversation;
        const targetPackage = normalizeEvidenceScribe(evidenceSessionForConversation?.scribe).targetPackage || null;
        const defaultContextResults = await collectDefaultAgentContext(
          deviceTarget.serial,
          targetPackage,
          t,
          { scoutTask: Boolean(evidenceSessionForConversation) },
        );
        const toolResults: AgentToolResult[] = [];
        const isAutonomousScoutTask = taskScopedConversation && Boolean(evidenceSessionForConversation);
        closeFailureEvidence = isAutonomousScoutTask;
        const taskWasStopped = () => Boolean(
          evidenceSessionForConversation &&
          (
            stoppedEvidenceSessionIdsRef.current.has(evidenceSessionForConversation.id) ||
            evidenceSessionsRef.current.find((item) => item.id === evidenceSessionForConversation.id)?.status !== "active"
          )
        );
        const actionTurnLimit = isAutonomousScoutTask ? AGENT_AUTONOMOUS_TOOL_TURN_LIMIT : 2;
        const terminalTurnLimit = isAutonomousScoutTask ? AGENT_TERMINAL_SYNTHESIS_RETRY_LIMIT : 1;
        const totalTurnLimit = actionTurnLimit + terminalTurnLimit;
        const autonomousScoutCliProfile = isAutonomousScoutTask
          ? resolveAutonomousScoutCliProfile(conversationCliProfile)
          : conversationCliProfile;
        const terminalOutcomeLabel = evidenceSessionForConversation?.kind === "bug_repro"
          ? "Bug repro outcome"
          : evidenceSessionForConversation?.kind === "walkthrough"
            ? "Walkthrough outcome"
            : "Agent turn outcome";

        const finalizeAgentTurn = async (
          thinkingMessageId: string,
          finalMessage: string,
          refreshedEvidenceSession: EvidenceSession | null,
        ) => {
          await updateMessage(sessionId, thinkingMessageId, (message) => ({
            ...message,
            body: finalMessage,
            thinking: false,
          }));
          if (isAutonomousScoutTask && refreshedEvidenceSession) {
            await closeEvidenceSession(refreshedEvidenceSession, { reportBody: finalMessage });
          }
        };

        const recordAgentRuntimeFailure = async (
          evidenceSession: EvidenceSession | null,
          output: string,
        ) => {
          if (!evidenceSession) return;
          const now = Date.now();
          await appendEvidenceArtifact(evidenceSession.id, {
            id: `artifact-${now}-agent-runtime-gap`,
            type: "agent_note",
            title: t("agent.evidenceScribeRuntimeGap"),
            body: output,
            createdAt: now,
            metadata: {
              runtimeGap: true,
              source: "agent_conversation",
              terminalOutcome: "FAILED",
            },
          });
          await updateEvidenceScribe(evidenceSession.id, (current) => ({
            ...current,
            updatedAt: now,
            scribe: {
              ...normalizeEvidenceScribe(current.scribe),
              agentActive: false,
              agentStoppedAt: now,
              gapsSummary: output,
              nextAction: t("agent.scribeConfigureCliNextAction"),
            },
          }));
        };

        let emptyUiRecoveryAttempts = 0;
        let autonomousFallbackAttempts = 0;
        const autonomousFallbackTargets = new Set<string>();

        const recordEmptyUiRecoveryFailure = async (
          source: string,
          summary: string,
          error: string,
          data: Record<string, unknown>,
        ) => {
          if (!evidenceSessionForConversation) return;
          const recoveryFailure: AgentToolResult = {
            id: `tool-${Date.now()}-${source}-empty-ui-recovery`,
            tool: "app.launch",
            ok: false,
            summary,
            error,
            data,
          };
          toolResults.push(recoveryFailure);
          await appendEvidenceArtifact(evidenceSessionForConversation.id, {
            id: `artifact-${Date.now()}-${source}-empty-ui-target-unresolved`,
            type: "agent_note",
            title: t("agent.evidenceAppLaunch"),
            body: recoveryFailure.summary,
            createdAt: Date.now(),
            metadata: data,
          });
          await appendMessage(sessionId, {
            id: `msg-${Date.now()}-${source}-empty-ui-target-unresolved`,
            role: "command",
            body: formatAgentToolResult(recoveryFailure),
            createdAt: Date.now(),
            skillId: skill.id,
            command: recoveryFailure.tool,
            ok: recoveryFailure.ok,
          });
        };

        const recoverEmptySurfaceWithSafeInput = async (source: string) => {
          const recoveryCommands = [
            "shell input keyevent KEYCODE_WAKEUP",
            "shell input keyevent KEYCODE_BACK",
          ];
          for (const [index, command] of recoveryCommands.entries()) {
            if (taskWasStopped()) return false;
            const recoveryResult = await executeAgentToolCall({
              id: `tool-${Date.now()}-${source}-safe-input-${index}`,
              tool: "workbench.request_adb_command",
              args: {
                command,
                reason: "Wake the device or exit a screensaver before continuing the Scout task.",
              },
            }, evidenceSessionForConversation, "auto_execute");
            toolResults.push(recoveryResult);
            await appendMessage(sessionId, {
              id: `msg-${Date.now()}-${source}-safe-input-${index}`,
              role: "command",
              body: formatAgentToolResult(recoveryResult),
              createdAt: Date.now(),
              skillId: skill.id,
              command: recoveryResult.tool,
              ok: recoveryResult.ok,
            });
            if (!recoveryResult.ok) continue;
            await waitForUiSettle();
            const inspection = await executeAgentToolCall({
              id: `tool-${Date.now()}-${source}-safe-input-inspect-${index}`,
              tool: "ui.inspect",
              args: {},
            }, evidenceSessionForConversation, "auto_execute");
            toolResults.push(inspection);
            await appendMessage(sessionId, {
              id: `msg-${Date.now()}-${source}-safe-input-inspect-${index}`,
              role: "command",
              body: formatAgentToolResult(inspection),
              createdAt: Date.now(),
              skillId: skill.id,
              command: inspection.tool,
              ok: inspection.ok,
            });
            if (!shouldRecoverScoutEmptyUiSurface(inspection.data)) return true;
          }
          return false;
        };

        const recoverEmptyWalkthroughSurface = async (snapshot: unknown, source: string) => {
          if (
            !isAutonomousScoutTask ||
            !evidenceSessionForConversation ||
            evidenceSessionForConversation.kind !== "walkthrough" ||
            !shouldRecoverScoutEmptyUiSurface(snapshot) ||
            emptyUiRecoveryAttempts >= SCOUT_EMPTY_UI_RECOVERY_LIMIT ||
            taskWasStopped()
          ) {
            return;
          }

          const scribe = normalizeEvidenceScribe(evidenceSessionForConversation.scribe);
          let launchableApps: LaunchableApp[];
          try {
            launchableApps = await invoke<LaunchableApp[]>("adb_list_launchable_apps", { deviceSerial: deviceTarget.serial });
          } catch (error) {
            emptyUiRecoveryAttempts += 1;
            const summary = t("agent.toolFailed", { tool: "app.launch" });
            await recordEmptyUiRecoveryFailure(source, summary, String(error), {
              source,
              targetPackage: scribe.targetPackage || null,
              goal: scribe.goal || null,
              stage: "resolve_launchable_apps",
            });
            return;
          }
          const launchTarget = resolveScoutWalkthroughLaunchApp({
            targetPackage: scribe.targetPackage,
            goal: scribe.goal,
            apps: launchableApps.map((app) => ({
              packageName: app.package_name,
              label: app.label,
              componentName: app.component_name,
            })),
          });
          emptyUiRecoveryAttempts += 1;

          if (!launchTarget) {
            const unresolvedTarget = scribe.targetPackage || scribe.goal || t("agent.evidenceAppLaunchTargetUnknown");
            if (await recoverEmptySurfaceWithSafeInput(source)) return;
            const summary = t("agent.evidenceAppLaunchTargetUnresolved", { target: unresolvedTarget });
            await recordEmptyUiRecoveryFailure(source, summary, summary, {
              source,
              targetPackage: scribe.targetPackage || null,
              goal: scribe.goal || null,
              stage: "resolve_target",
            });
            return;
          }

          const launchResult = await executeAgentToolCall({
            id: `tool-${Date.now()}-${source}-empty-ui-launch`,
            tool: "app.launch",
            args: {
              packageName: launchTarget.packageName,
              reason: "Recover a walkthrough from an inaccessible foreground surface.",
            },
          }, evidenceSessionForConversation, "auto_execute");
          toolResults.push(launchResult);
          await appendMessage(sessionId, {
            id: `msg-${Date.now()}-${source}-empty-ui-launch`,
            role: "command",
            body: formatAgentToolResult(launchResult),
            createdAt: Date.now(),
            skillId: skill.id,
            command: launchResult.tool,
            ok: launchResult.ok,
          });

          const launchInspection = await executeAgentToolCall({
            id: `tool-${Date.now()}-${source}-empty-ui-launch-inspect`,
            tool: "ui.inspect",
            args: {},
          }, evidenceSessionForConversation, "auto_execute");
          toolResults.push(launchInspection);
          await appendMessage(sessionId, {
            id: `msg-${Date.now()}-${source}-empty-ui-launch-inspect`,
            role: "command",
            body: formatAgentToolResult(launchInspection),
            createdAt: Date.now(),
            skillId: skill.id,
            command: launchInspection.tool,
            ok: launchInspection.ok,
          });
          if (shouldRecoverScoutEmptyUiSurface(launchInspection.data)) {
            await recoverEmptySurfaceWithSafeInput(`${source}-after-launch`);
          }
        };

        const recoverBlockingSystemUi = async (snapshot: unknown, source: string) => {
          let recoverySnapshot = snapshot;
          for (
            let attempt = 1;
            attempt <= SCOUT_CRASH_RECOVERY_LIMIT && isBlockingSystemUiSnapshot(recoverySnapshot);
            attempt += 1
          ) {
            if (taskWasStopped()) return;
            const recoveryAction = planScoutCrashRecoveryAction(recoverySnapshot);
            if (!recoveryAction) break;
            const blockingDialogRecovery = await executeAgentToolCall({
              id: `tool-${Date.now()}-${source}-crash-recovery-${attempt}`,
              tool: recoveryAction.tool,
              args: {
                ...recoveryAction.args,
                reason: t("agent.uiBlockingDialogRecoveryReason", {
                  attempt,
                  limit: SCOUT_CRASH_RECOVERY_LIMIT,
                }),
              },
            }, evidenceSessionForConversation);
            toolResults.push(blockingDialogRecovery);
            await appendMessage(sessionId, {
              id: `msg-${Date.now()}-${source}-crash-recovery-${attempt}`,
              role: "command",
              body: formatAgentToolResult(blockingDialogRecovery),
              createdAt: Date.now(),
              skillId: skill.id,
              command: blockingDialogRecovery.tool,
              ok: blockingDialogRecovery.ok,
              approval: blockingDialogRecovery.approval,
            });

            const recoveryInspection = await executeAgentToolCall({
              id: `tool-${Date.now()}-${source}-crash-recovery-inspect-${attempt}`,
              tool: "ui.inspect",
              args: {},
            }, evidenceSessionForConversation);
            recoverySnapshot = recoveryInspection.data;
            toolResults.push(recoveryInspection);
            await appendMessage(sessionId, {
              id: `msg-${Date.now()}-${source}-crash-recovery-inspect-${attempt}`,
              role: "command",
              body: formatAgentToolResult(recoveryInspection),
              createdAt: Date.now(),
              skillId: skill.id,
              command: recoveryInspection.tool,
              ok: recoveryInspection.ok,
            });
          }
          if (isBlockingSystemUiSnapshot(recoverySnapshot) && evidenceSessionForConversation) {
            const now = Date.now();
            await appendEvidenceArtifact(evidenceSessionForConversation.id, {
              id: `artifact-${now}-${source}-crash-recovery-exhausted`,
              type: "agent_note",
              title: t("agent.evidenceCrashRecoveryExhaustedTitle"),
              body: t("agent.evidenceCrashRecoveryExhausted", { count: SCOUT_CRASH_RECOVERY_LIMIT }),
              createdAt: now,
              metadata: {
                source: "crash_recovery",
                trigger: source,
                attempts: SCOUT_CRASH_RECOVERY_LIMIT,
                exhausted: true,
              },
            });
          }
        };

        const runAutonomousFallback = async (
          thinkingMessageId: string,
          evidenceSession: EvidenceSession | null,
          turn: number,
          message: string,
        ) => {
          if (
            !evidenceSession ||
            evidenceSession.kind !== "walkthrough" ||
            autonomousFallbackAttempts >= 3
          ) {
            return false;
          }
          const fallbackCall = suggestAutonomousFallbackToolCall(
            toolResults,
            normalizeEvidenceScribe(evidenceSession.scribe).goal,
            autonomousFallbackTargets,
          );
          if (!fallbackCall) return false;
          autonomousFallbackAttempts += 1;
          const fallbackTarget = stringArg(fallbackCall.args.target);
          if (fallbackTarget) autonomousFallbackTargets.add(fallbackTarget);
          await updateMessage(sessionId, thinkingMessageId, (current) => ({
            ...current,
            body: [message, t("agent.toolCallPlanMessage")].filter(Boolean).join("\n\n"),
            thinking: false,
          }));
          const fallbackResult = await executeAgentToolCall(
            fallbackCall,
            evidenceSession,
            "auto_execute",
          );
          toolResults.push(fallbackResult);
          await appendMessage(sessionId, {
            id: `msg-${Date.now()}-autonomous-fallback-${turn}`,
            role: "command",
            body: formatAgentToolResult(fallbackResult),
            createdAt: Date.now(),
            skillId: skill.id,
            command: fallbackCall.tool,
            ok: fallbackResult.ok,
          });
          if (isBlockingSystemUiSnapshot(fallbackResult.data)) {
            await recoverBlockingSystemUi(fallbackResult.data, `fallback-${turn}`);
          }
          await recoverEmptyWalkthroughSurface(fallbackResult.data, `fallback-${turn}`);
          return true;
        };

        if (isAutonomousScoutTask && evidenceSessionForConversation && !taskWasStopped()) {
          const initialUiSnapshot = await executeAgentToolCall({
            id: `tool-${Date.now()}-initial-ui-inspect`,
            tool: "ui.inspect",
            args: {},
          }, evidenceSessionForConversation);
          toolResults.push(initialUiSnapshot);
          await appendMessage(sessionId, {
            id: `msg-${Date.now()}-initial-ui-inspect`,
            role: "command",
            body: formatAgentToolResult(initialUiSnapshot),
            createdAt: Date.now(),
            skillId: skill.id,
            command: initialUiSnapshot.tool,
            ok: initialUiSnapshot.ok,
          });
          if (!initialUiSnapshot.ok) {
            await recoverEmptySurfaceWithSafeInput("initial-ui-inspect-failure");
          }
          await recoverBlockingSystemUi(initialUiSnapshot.data, "initial");
          await recoverEmptyWalkthroughSurface(initialUiSnapshot.data, "initial");
        }

        for (let turn = 0; turn < totalTurnLimit; turn += 1) {
          if (taskWasStopped()) return;
          const terminalOnly = turn >= actionTurnLimit;
          const finalTerminalAttempt = turn === totalTurnLimit - 1;
          const thinkingMessageId = await appendThinkingMessage(sessionId, skill.id);
          activeThinkingMessageId = thinkingMessageId;
          const refreshedSession = sessionsRef.current.find((item) => item.id === sessionId) ?? session;
          const refreshedEvidenceSession = evidenceSessionForConversation
            ? evidenceSessionsRef.current.find((item) => item.id === evidenceSessionForConversation.id) ?? evidenceSessionForConversation
            : null;
          const turnPrompt = buildAgentConversationPrompt({
            prompt,
            attachments,
            session: refreshedSession,
            toolResults,
            defaultContextResults,
            skill,
            deviceLabel: deviceTarget.label || t("agent.noDevice"),
            deviceSerial: deviceTarget.serial,
            contextLabel: currentContextLabel,
            evidenceSession: refreshedEvidenceSession,
            excludedMessageIds: queuedAgentMessageIdsRef.current,
            workingDirectory,
            locale: i18n.resolvedLanguage || i18n.language,
            executionPermission: isAutonomousScoutTask ? "auto_execute" : "read_only",
            terminalOnly,
          });
          const output = isAutonomousScoutTask
            ? await runAgentCliTurn(autonomousScoutCliProfile, turnPrompt, t, workingDirectory, handleSessionStreamEvent)
            : await runAgentCliTurn(conversationCliProfile, turnPrompt, t, workingDirectory, handleSessionStreamEvent);
          if (taskWasStopped()) {
            await updateMessage(sessionId, thinkingMessageId, (message) => ({
              ...message,
              body: t("agent.evidenceStoppedSummary"),
              thinking: false,
            }));
            return;
          }

          if (isAgentRuntimeFailureOutput(output)) {
            if (isAutonomousScoutTask && refreshedEvidenceSession) {
              await recordAgentRuntimeFailure(refreshedEvidenceSession, output);
              await finalizeAgentTurn(
                thinkingMessageId,
                `${output}\n\n${terminalOutcomeLabel}: FAILED`,
                refreshedEvidenceSession,
              );
              return;
            }
            await updateMessage(sessionId, thinkingMessageId, (message) => ({
              ...message,
              body: output,
              thinking: false,
            }));
            if (refreshedEvidenceSession) {
              await recordAgentRuntimeFailure(refreshedEvidenceSession, output);
            }
            return;
          }

          const toolRequest = extractAgentToolRequest(output);
          if (!toolRequest.calls.length) {
            const finalMessage = toolRequest.message || output || t("agent.agentRuntimeEmpty");
            if (isAutonomousScoutTask && !isScoutTerminalOutcomeResponse(finalMessage)) {
              if (await runAutonomousFallback(thinkingMessageId, refreshedEvidenceSession, turn, finalMessage)) continue;
              if (finalTerminalAttempt) {
                await finalizeAgentTurn(
                  thinkingMessageId,
                  buildAutonomousTerminalFallback(
                    toolResults,
                    terminalOutcomeLabel,
                    t,
                    normalizeEvidenceScribe(refreshedEvidenceSession?.scribe).goal,
                  ),
                  refreshedEvidenceSession,
                );
                return;
              }
              await updateMessage(sessionId, thinkingMessageId, (message) => ({
                ...message,
                body: `${finalMessage}\n\n${t("agent.autonomousTerminalRetry")}`,
                thinking: false,
              }));
              const forcedInspection = await executeAgentToolCall({
                id: `tool-${Date.now()}-forced-ui-inspect-${turn}`,
                tool: "ui.inspect",
                args: {},
              }, refreshedEvidenceSession, "auto_execute");
              toolResults.push(forcedInspection);
              await appendMessage(sessionId, {
                id: `msg-${Date.now()}-forced-ui-inspect-${turn}`,
                role: "command",
                body: formatAgentToolResult(forcedInspection),
                createdAt: Date.now(),
                skillId: skill.id,
                command: forcedInspection.tool,
                ok: forcedInspection.ok,
              });
              await recoverBlockingSystemUi(forcedInspection.data, `forced-${turn}`);
              await recoverEmptyWalkthroughSurface(forcedInspection.data, `forced-${turn}`);
              continue;
            }
            await finalizeAgentTurn(thinkingMessageId, finalMessage, refreshedEvidenceSession);
            return;
          }

          if (terminalOnly) {
            if (finalTerminalAttempt) {
              await finalizeAgentTurn(
                thinkingMessageId,
                buildAutonomousTerminalFallback(
                  toolResults,
                  terminalOutcomeLabel,
                  t,
                  normalizeEvidenceScribe(refreshedEvidenceSession?.scribe).goal,
                ),
                refreshedEvidenceSession,
              );
              return;
            }
            await updateMessage(sessionId, thinkingMessageId, (message) => ({
              ...message,
              body: [toolRequest.message.trim(), t("agent.autonomousTerminalRetry")].filter(Boolean).join("\n\n"),
              thinking: false,
            }));
            continue;
          }

          const repeatedUiInspect =
            isAutonomousScoutTask &&
            toolRequest.calls.length === 1 &&
            toolRequest.calls[0].tool === "ui.inspect" &&
            toolResults.some((result) => result.tool === "ui.inspect");
          if (repeatedUiInspect) {
            if (await runAutonomousFallback(thinkingMessageId, refreshedEvidenceSession, turn, toolRequest.message)) {
              continue;
            }
            if (isAutonomousScoutTask && refreshedEvidenceSession) {
              await finalizeAgentTurn(
                thinkingMessageId,
                buildAutonomousTerminalFallback(
                  toolResults,
                  terminalOutcomeLabel,
                  t,
                  normalizeEvidenceScribe(refreshedEvidenceSession?.scribe).goal,
                ),
                refreshedEvidenceSession,
              );
              return;
            }
          }

          await updateMessage(sessionId, thinkingMessageId, (message) => ({
            ...message,
            body: toolRequest.message.trim() || t("agent.toolCallPlanMessage"),
            thinking: false,
          }));

          const orderedToolCalls = isAutonomousScoutTask && refreshedEvidenceSession?.kind === "walkthrough"
            ? [...toolRequest.calls].sort((left, right) =>
                Number(isExternalReferenceTool(left.tool)) - Number(isExternalReferenceTool(right.tool)),
              )
            : toolRequest.calls;

          for (const [index, call] of orderedToolCalls.entries()) {
            if (taskWasStopped()) return;
            const result = await executeAgentToolCall(
              call,
              refreshedEvidenceSession,
              isAutonomousScoutTask ? "auto_execute" : "read_only",
            );
            toolResults.push(result);
            await appendMessage(sessionId, {
              id: `msg-${Date.now()}-tool-${turn}-${index}`,
              role: "command",
              body: formatAgentToolResult(result),
              createdAt: Date.now(),
              skillId: skill.id,
              command: call.tool,
              ok: result.ok,
              approval: result.approval,
            });
            if (
              isAutonomousScoutTask &&
              refreshedEvidenceSession &&
              isBlockingSystemUiSnapshot(result.data)
            ) {
              await recoverBlockingSystemUi(result.data, `turn-${turn}-tool-${index}`);
            }
            if (
              isAutonomousScoutTask &&
              refreshedEvidenceSession &&
              !result.ok &&
              (result.tool === "ui.inspect" || result.tool === "ui.tap" || result.tool === "ui.swipe" || result.tool === "ui.press_back")
            ) {
              await recoverEmptySurfaceWithSafeInput(`turn-${turn}-tool-${index}-ui-failure`);
            }
            if (isAutonomousScoutTask && refreshedEvidenceSession) {
              await recoverEmptyWalkthroughSurface(result.data, `turn-${turn}-tool-${index}`);
            }
          }
        }
      } catch (error) {
        const reason = String(error);
        const failureMessage = t("agent.agentTurnCliUnavailable", {
          cli: failureCliName,
          reason,
        });
        try {
          if (activeThinkingMessageId) {
            await updateMessage(sessionId, activeThinkingMessageId, (message) => ({
              ...message,
              body: failureMessage,
              thinking: false,
            }));
          } else if (conversationSession) {
            await appendMessage(sessionId, {
              id: `msg-${Date.now()}-agent-runtime-failure`,
              role: "assistant",
              body: failureMessage,
              createdAt: Date.now(),
              skillId: skill.id,
            });
          }
        } catch {
          // Preserve the evidence close even if conversation persistence fails.
        }

        if (closeFailureEvidence && failureEvidenceSession) {
          const currentEvidenceSession = evidenceSessionsRef.current.find(
            (item) => item.id === failureEvidenceSession?.id,
          ) ?? failureEvidenceSession;
          if (
            currentEvidenceSession.status === "active" &&
            !stoppedEvidenceSessionIdsRef.current.has(currentEvidenceSession.id)
          ) {
            const now = Date.now();
            const reportBody = `${failureMessage}\n\nWalkthrough outcome: FAILED`;
            try {
              await appendEvidenceArtifact(currentEvidenceSession.id, {
                id: `artifact-${now}-agent-unexpected-failure`,
                type: "agent_note",
                title: t("agent.evidenceScribeRuntimeGap"),
                body: failureMessage,
                createdAt: now,
                metadata: {
                  runtimeGap: true,
                  source: "agent_conversation_unhandled_error",
                  terminalOutcome: "FAILED",
                  error: reason,
                },
              });
              await updateEvidenceScribe(currentEvidenceSession.id, (current) => ({
                ...current,
                updatedAt: now,
                scribe: {
                  ...normalizeEvidenceScribe(current.scribe),
                  agentActive: false,
                  agentStoppedAt: now,
                  gapsSummary: failureMessage,
                  nextAction: t("agent.scribeConfigureCliNextAction"),
                },
              }));
              await closeEvidenceSession(currentEvidenceSession, { reportBody });
            } catch {
              // closeEvidenceSession owns its own report-failure persistence;
              // do not mask the original runtime error here.
            }
          }
        }
      } finally {
        finishAgentSessionTurn(sessionId);
      }
    },
    [
      appendMessage,
      appendThinkingMessage,
      activeEvidenceSessionForPrompt,
      agentCli.profiles,
      appendEvidenceArtifact,
      beginAgentSessionTurn,
      cliConfigured,
      cliProfile,
      closeEvidenceSession,
      deviceKey,
      deviceTarget.label,
      deviceTarget.serial,
      executeAgentToolCall,
      finishAgentSessionTurn,
      currentContextLabel,
      i18n.language,
      i18n.resolvedLanguage,
      resolveActiveEvidenceSessionForPrompt,
      resolveEvidenceSessionForAgentSession,
      t,
      updateEvidenceScribe,
      updateMessage,
    ],
  );

  useEffect(() => {
    runAgentConversationRef.current = runAgentConversation;
  }, [runAgentConversation]);

  const submitPrompt = useCallback(async (
    promptOverride?: string,
    options?: {
      workingDirectory?: string | null;
      session?: AgentCopilotSession | null;
      contextOnly?: boolean;
      preserveChatDraft?: boolean;
      attachments?: AgentCopilotAttachment[];
      clearAttachments?: () => void;
    },
  ): Promise<AgentCopilotSession | null> => {
    const attachments = options?.attachments ?? pendingAttachments;
    const prompt = (promptOverride ?? draft).trim() || (attachments.length ? t("agent.attachmentOnlyPrompt") : "");
    if (!prompt) return null;
    const skill = recommendAndroidAgentSkill(prompt, attachments);
    const preferredSession = options?.session ?? activeSession;
    const workingDirectory = normalizeWorkingDirectory(
      options?.workingDirectory ?? (preferredSession ? preferredSession.workingDirectory : draftWorkingDirectories.chat),
    );
    const session = preferredSession ?? (await createSession(skill, prompt, { workingDirectory }));
    if (session.skillId !== skill.id) {
      await updateSessionSkill(session.id, skill);
    }
    const now = Date.now();
    const messageId = `msg-${now}-user`;
    const queued = runningSessionIdsRef.current.has(session.id);
    let releaseQueueReady: () => void = () => undefined;
    const queueReady = new Promise<void>((resolve) => {
      releaseQueueReady = resolve;
    });
    if (queued) {
      queuedAgentMessageIdsRef.current.add(messageId);
      const queue = queuedAgentTurnsRef.current.get(session.id) ?? [];
      queuedAgentTurnsRef.current.set(session.id, [
        ...queue,
        { messageId, ready: queueReady, prompt, attachments, skill, workingDirectory },
      ]);
    }
    if (!options?.preserveChatDraft) setDraft("");
    if (options?.clearAttachments) options.clearAttachments();
    else setPendingAttachments([]);
    try {
      await appendMessage(session.id, {
        id: messageId,
        role: "user",
        body: prompt,
        createdAt: now,
        skillId: skill.id,
        attachments,
        contextOnly: options?.contextOnly,
      });
    } finally {
      releaseQueueReady();
    }
    if (!queued) {
      await runAgentConversation(session.id, prompt, attachments, skill, workingDirectory);
    }
    return session;
  }, [
    activeSession,
    appendMessage,
    cliConfigured,
    createSession,
    draft,
    draftWorkingDirectories.chat,
    pendingAttachments,
    runAgentConversation,
    t,
    updateSessionSkill,
  ]);

  const handlePrompt = useCallback(async () => {
    await submitPrompt();
  }, [submitPrompt]);

  const ensureEvidenceAgentSession = useCallback(
    async (evidenceSession: EvidenceSession) => {
      const inFlight = ensureEvidenceAgentSessionPromisesRef.current.get(evidenceSession.id);
      if (inFlight) return inFlight;
      const ensurePromise = (async () => {
        const latestEvidenceSession = evidenceSessionsRef.current.find((session) => session.id === evidenceSession.id) ?? evidenceSession;
        const linkedSession = latestEvidenceSession.agentSessionId
          ? sessionsRef.current.find((session) => session.id === latestEvidenceSession.agentSessionId) ?? null
          : null;
        if (linkedSession) {
          if (linkedSession.scope !== "scout_task" || linkedSession.evidenceSessionId !== latestEvidenceSession.id) {
            const migratedSession: AgentCopilotSession = {
              ...linkedSession,
              scope: "scout_task",
              evidenceSessionId: latestEvidenceSession.id,
            };
            await commitSessions(sessionsRef.current.map((session) => session.id === linkedSession.id ? migratedSession : session));
            return migratedSession;
          }
          return linkedSession;
        }
        const skill = recommendAndroidAgentSkill(normalizeEvidenceScribe(latestEvidenceSession.scribe).goal, []);
        const createdSession = await createSession(skill, latestEvidenceSession.title, {
          workingDirectory: latestEvidenceSession.workingDirectory,
          scope: "scout_task",
          evidenceSessionId: latestEvidenceSession.id,
        });
        await updateEvidenceScribe(latestEvidenceSession.id, (session) => ({
          ...session,
          updatedAt: Date.now(),
          agentSessionId: createdSession.id,
        }));
        return createdSession;
      })();
      ensureEvidenceAgentSessionPromisesRef.current.set(evidenceSession.id, ensurePromise);
      try {
        return await ensurePromise;
      } finally {
        ensureEvidenceAgentSessionPromisesRef.current.delete(evidenceSession.id);
      }
    },
    [commitSessions, createSession, updateEvidenceScribe],
  );

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

  const startScribeAgentRun = useCallback(async (sessionOverride?: EvidenceSession) => {
    const sessionToStart = sessionOverride ?? activeEvidenceSession;
    if (!sessionToStart) return;
    stoppedEvidenceSessionIdsRef.current.delete(sessionToStart.id);
    const taskAgentSession = await ensureEvidenceAgentSession(sessionToStart);
    if (runningSessionIdsRef.current.has(taskAgentSession.id)) return;
    const now = Date.now();
    const currentScribe = normalizeEvidenceScribe(sessionToStart.scribe);
    const activeScribe = {
      ...currentScribe,
      agentActive: cliConfigured,
      agentStartedAt: cliConfigured ? now : currentScribe.agentStartedAt,
      agentStoppedAt: cliConfigured ? null : currentScribe.agentStoppedAt,
    };
    const sessionForPrompt: EvidenceSession = {
      ...sessionToStart,
      updatedAt: now,
      scribe: activeScribe,
    };

    if (cliConfigured) {
      await updateEvidenceScribe(sessionToStart.id, (session) => ({
        ...session,
        updatedAt: now,
        scribe: activeScribe,
      }));
    }

    try {
      await submitPrompt(
        buildScribeAgentStartPrompt({
          session: sessionForPrompt,
          deviceLabel: deviceTarget.label || t("agent.noDevice"),
          deviceSerial: deviceTarget.serial,
          contextLabel: currentContextLabel,
          locale: i18n.resolvedLanguage || i18n.language,
        }),
        {
          workingDirectory: sessionForPrompt.workingDirectory,
          session: taskAgentSession,
          contextOnly: true,
          preserveChatDraft: true,
        },
      );
    } finally {
      const stoppedAt = Date.now();
      await updateEvidenceScribe(sessionToStart.id, (session) => ({
        ...session,
        updatedAt: stoppedAt,
        scribe: {
          ...normalizeEvidenceScribe(session.scribe),
          agentActive: false,
          agentStoppedAt: stoppedAt,
        },
      }));
    }
  }, [
    activeEvidenceSession,
    cliConfigured,
    currentContextLabel,
    deviceTarget.label,
    deviceTarget.serial,
    ensureEvidenceAgentSession,
    i18n.language,
    i18n.resolvedLanguage,
    submitPrompt,
    t,
    updateEvidenceScribe,
  ]);

  const startEvidenceFromUi = useCallback(
    async (kind: EvidenceSessionKind) => {
      const gate = evaluateScoutTaskStartGate({
        deviceSerial: deviceTarget.serial,
        cliConfigured,
        screenshotDir: settings.screenshotDir,
        goal: evidenceGoalDraft,
        runningTask: activeEvidenceSession,
      });
      if (!gate.ok) {
        window.alert(scoutTaskGateMessage(gate, t));
        return;
      }
      const cliRuntimeReady = await ensureCliRuntimeBeforeTask();
      if (!cliRuntimeReady) return;
      const canStart = await ensureAgentApkBeforeTask();
      if (!canStart) return;
      const createdSession = await createEvidenceSession(kind, {
        goal: evidenceGoalDraft,
        targetPackage: kind === "walkthrough" ? evidenceTargetPackageDraft : null,
        uiReferenceUrl: kind === "walkthrough" ? evidenceUiReferenceUrlDraft : null,
        intensity: DEFAULT_SCRIBE_INTENSITY,
        permissionLevel: "auto_execute",
        workingDirectory: draftWorkingDirectories[kind],
        skipInitialReview: true,
      });
      const preparedSession = await prepareWalkthroughTargetSurface(createdSession);
      await startScribeAgentRun(preparedSession);
    },
    [
      activeEvidenceSession,
      cliConfigured,
      createEvidenceSession,
      deviceTarget.serial,
      ensureAgentApkBeforeTask,
      ensureCliRuntimeBeforeTask,
      draftWorkingDirectories,
      evidenceGoalDraft,
      evidenceTargetPackageDraft,
      evidenceUiReferenceUrlDraft,
      prepareWalkthroughTargetSurface,
      settings.screenshotDir,
      startScribeAgentRun,
      t,
    ],
  );

  const startNewWorkspaceItem = useCallback(async () => {
    if (copilotMode === "chat") {
      await createSession(recommendedSkill);
      return;
    }

    const kind = evidenceKindForCopilotMode(copilotMode) ?? visibleEvidenceKind;
    if (activeEvidenceSession) {
      window.alert(t("agent.newEvidenceDraftBlocked", { kind: t(`agent.evidenceKind.${kind}`) }));
      return;
    }

    setSelectedEvidenceHistoryIds((current) => ({
      ...current,
      [kind]: NEW_EVIDENCE_DRAFT_ID,
    }));
    setCopilotMode(copilotModeForEvidenceKind(kind));
    setEvidenceGoalDraft("");
    setEvidenceTargetPackageDraft("");
    setEvidenceUiReferenceUrlDraft("");
    setEditingEvidenceGoal(false);
    setActiveEvidenceGoalDraft("");
  }, [activeEvidenceSession, copilotMode, createSession, recommendedSkill, t, visibleEvidenceKind]);

  const handleSuggestedPrompt = useCallback(
    async (prompt: string) => {
      setDraft(prompt);
      await submitPrompt(prompt);
    },
    [submitPrompt],
  );

  const taskModeOptions: Array<{ mode: CopilotMode; title: string; icon: ReactNode }> = [
    {
      mode: "chat",
      title: t("agent.workspaceTaskChatTitle"),
      icon: <IconMessageCircle size={16} />,
    },
    {
      mode: "walkthrough",
      title: t("agent.workspaceTaskWalkthroughTitle"),
      icon: <IconClipboardCheck size={16} />,
    },
    {
      mode: "bug_repro",
      title: t("agent.workspaceTaskBugReproTitle"),
      icon: <IconBug size={16} />,
    },
  ];
  const handleTaskTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, mode: CopilotMode) => {
    const currentIndex = taskModeOptions.findIndex((option) => option.mode === mode);
    if (currentIndex < 0) {
      return;
    }

    const lastIndex = taskModeOptions.length - 1;
    let nextIndex: number | null = null;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      nextIndex = currentIndex === lastIndex ? 0 : currentIndex + 1;
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      nextIndex = currentIndex === 0 ? lastIndex : currentIndex - 1;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = lastIndex;
    }

    if (nextIndex === null) {
      return;
    }

    event.preventDefault();
    const nextMode = taskModeOptions[nextIndex].mode;
    setCopilotMode(nextMode);
    window.requestAnimationFrame(() => {
      document.getElementById(`agent-task-tab-${nextMode}`)?.focus();
    });
  };
  const newWorkspaceItemLabel =
    copilotMode === "chat"
      ? t("agent.newSession")
      : t("agent.newEvidenceDraft", { kind: t(`agent.evidenceKind.${visibleEvidenceKind}`) });

  const sessionList = (
    <Paper
      className="agent-copilot-card agent-copilot-session-list agent-copilot-workspace-task-rail"
      withBorder
      radius="md"
      p="md"
      style={{ minHeight: 0, display: "flex", flexDirection: "column" }}
    >
      <Stack className="agent-copilot-workspace-intro" gap="sm">
        <Group justify="space-between" gap="xs" wrap="nowrap">
          <Group gap="xs" wrap="nowrap" style={{ minWidth: 0, flex: 1 }}>
            <span className="agent-copilot-title-badge">
              <AgentIcon size={20} />
            </span>
            <Title order={4} style={{ minWidth: 0, lineHeight: 1.25 }}>
              {t("agent.workspaceTitle")}
            </Title>
          </Group>
          <ActionIcon
            variant="light"
            aria-label={newWorkspaceItemLabel}
            onClick={() => void startNewWorkspaceItem()}
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

      <div className="agent-copilot-task-tabs" role="tablist" aria-label={t("agent.workspaceTaskSwitcherLabel")}>
        {taskModeOptions.map((option) => {
          const active = copilotMode === option.mode;
          return (
            <button
              id={`agent-task-tab-${option.mode}`}
              key={option.mode}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={`agent-task-panel-${option.mode}`}
              tabIndex={active ? 0 : -1}
              className={`agent-copilot-task-tab${active ? " is-active" : ""}`}
              onClick={() => setCopilotMode(option.mode)}
              onKeyDown={(event) => handleTaskTabKeyDown(event, option.mode)}
            >
              <span className="agent-copilot-task-tab__icon" aria-hidden="true">
                {option.icon}
              </span>
              <span className="agent-copilot-task-tab__copy">
                <Text component="span" size="sm" fw={800}>
                  {option.title}
                </Text>
              </span>
            </button>
          );
        })}
      </div>

      {copilotMode === "chat" ? (
        <>
          <Divider my="sm" />

          <Group className="agent-copilot-recent-heading" justify="space-between" gap="xs" wrap="nowrap">
            <Text size="xs" fw={800}>
              {t("agent.workspaceRecentChats")}
            </Text>
          </Group>

          <ScrollArea style={{ flex: 1 }}>
            <Stack gap={6}>
              {chatSessions.map((session) => (
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
        </>
      ) : (
        <>
          <Divider my="sm" />

          <EvidenceTaskHistoryList
            sessions={recentEvidenceSessions}
            kind={visibleEvidenceKind}
            selectedSessionId={activeEvidenceSession?.id ?? selectedEvidenceHistorySession?.id ?? null}
            locale={i18n.resolvedLanguage}
            onSelect={selectEvidenceHistorySession}
            onDelete={deleteEvidenceHistorySession}
            t={t}
          />
        </>
      )}
    </Paper>
  );

  const activeMessages = activeSession?.messages ?? [];
  const visibleMessages = activeMessages.filter((message) => message.role !== "system" && !message.contextOnly);
  const activeTaskConversationMessages = (activeTaskAgentSession?.messages ?? []).filter(
    (message) =>
      message.role !== "system" &&
      !message.contextOnly &&
      !message.thinking &&
      Boolean(activeEvidenceSession && message.createdAt >= activeEvidenceSession.createdAt),
  );
  const hasVisibleThinkingMessage = visibleMessages.some((message) => message.thinking);
  const showPromptSuggestions =
    copilotMode === "chat" &&
    visiblePromptSuggestions.length > 0 &&
    visibleMessages.length === 0 &&
    !draft.trim() &&
    pendingAttachments.length === 0;
  const pendingAttachmentCards = pendingAttachments.length ? (
    <Group className="agent-copilot-attachment-list" gap="xs" wrap="wrap">
      {pendingAttachments.map((attachment) => (
        <AttachmentPreviewCard
          key={attachment.id}
          attachment={attachment}
          removable
          onRemove={() => removePendingAttachment(attachment.id)}
          t={t}
        />
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
        {visibleMessages.length ? (
          visibleMessages.map((message) => (
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
        ) : activeChatRunning ? null : (
          <Stack className="agent-copilot-empty-state" gap="xs">
            <Text size="sm" fw={700}>
              {t("agent.conversationTitle")}
            </Text>
            <Text size="xs" c="dimmed">
              {t("agent.promptPlaceholder")}
            </Text>
          </Stack>
        )}
        {activeChatRunning && activeSession && !hasVisibleThinkingMessage ? (
          <MessageBubble
            key="agent-running-placeholder"
            message={{
              id: "agent-running-placeholder",
              role: "assistant",
              body: "",
              createdAt: Date.now(),
              thinking: true,
              skillId: activeSession.skillId,
            }}
          />
        ) : null}
        {promptSuggestionChips}
      </Stack>
    </ScrollArea>
  );

  const chatComposer = (
    <Stack className="agent-copilot-mode-footer" gap="xs">
      {pendingAttachmentCards}
      <Group className="agent-copilot-chat-composer" align="flex-end" gap="sm" wrap="nowrap">
        <input ref={fileInputRef} type="file" multiple hidden onChange={handleFilesSelected} />
        <Tooltip label={t("agent.attachFiles")}>
          <ActionIcon
            className="agent-copilot-chat-composer__attach"
            variant="light"
            size="lg"
            aria-label={t("agent.attachFiles")}
            onClick={() => fileInputRef.current?.click()}
          >
            <IconPaperclip size={18} />
          </ActionIcon>
        </Tooltip>
        <Textarea
          autosize
          minRows={1}
          maxRows={5}
          value={draft}
          placeholder={t("agent.promptPlaceholder")}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onPaste={handleComposerPaste}
          onKeyDown={handleComposerKeyDown}
          onCompositionStart={handleComposerCompositionStart}
          onCompositionEnd={handleComposerCompositionEnd}
          className="agent-copilot-chat-input"
          style={{ flex: 1 }}
        />
        <Button
          className="agent-copilot-chat-send"
          onClick={() => void handlePrompt()}
          disabled={!draft.trim() && pendingAttachments.length === 0}
        >
          {t("agent.send")}
        </Button>
      </Group>
      <AgentWorkingDirectoryBar
        workingDirectory={explicitWorkingDirectory}
        fallbackWorkingDirectory={fallbackWorkingDirectory}
        inherited={workingDirectoryIsInherited}
        onSelect={() => void selectCurrentWorkingDirectory()}
        onClear={() => void clearCurrentWorkingDirectory()}
        t={t}
      />
    </Stack>
  );

  const evidenceModeTitle =
    visibleEvidenceKind === "bug_repro" ? t("agent.bugReproPanelTitle") : t("agent.scribePanelTitle");
  const evidenceModeStartLabel =
    visibleEvidenceKind === "bug_repro" ? t("agent.evidenceStartBugRepro") : t("agent.evidenceStartWalkthrough");
  const evidenceGoalPlaceholder =
    visibleEvidenceKind === "bug_repro" ? t("agent.bugReproGoalPlaceholder") : t("agent.scribeGoalPlaceholder");
  const startTaskDisabled = runtimeProbeRunning;
  const activeEvidenceGoalEmpty =
    activeEvidenceSession?.kind === "bug_repro" ? t("agent.bugReproGoalEmpty") : t("agent.scribeGoalEmpty");
  const activeEvidenceGoalLabel =
    activeEvidenceSession?.kind === "bug_repro" ? t("agent.bugReproGoalLabel") : t("agent.scribeGoalLabel");
  const activeEvidenceGoalAction =
    activeEvidenceScribe?.goal && activeEvidenceScribe.goal.trim() ? t("agent.evidenceGoalEdit") : t("agent.evidenceGoalSet");
  const evidenceUiReferenceHintKey =
    visibleEvidenceKind === "walkthrough" ? uiReferenceHintKey(evidenceUiReferenceUrlDraft) : null;

  const activeEvidenceGoalPanel =
    activeEvidenceSession && copilotMode !== "chat" && (editingEvidenceGoal || Boolean(activeEvidenceScribe?.goal?.trim())) ? (
      <Stack className="agent-copilot-task-goal agent-copilot-goal-panel agent-copilot-goal-panel--compact" gap={6}>
        <Group justify="space-between" gap="xs" wrap="nowrap">
          <Stack gap={2} style={{ minWidth: 0 }}>
            <Text size="xs" fw={800} className="agent-copilot-goal-label">
              {activeEvidenceGoalLabel}
            </Text>
          </Stack>
          {editingEvidenceGoal ? (
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
          )}
        </Group>
        {editingEvidenceGoal ? (
          <Textarea
            autosize
            minRows={1}
            maxRows={2}
            value={activeEvidenceGoalDraft}
            placeholder={evidenceGoalPlaceholder}
            onChange={(event) => setActiveEvidenceGoalDraft(event.currentTarget.value)}
            onPaste={(event) => handleEvidencePathPaste(event, setActiveEvidenceGoalDraft)}
            className="agent-copilot-goal-input"
          />
        ) : (
          <Stack gap={6}>
            <Text
              size="sm"
              fw={700}
              lineClamp={1}
              className={activeEvidenceScribe?.goal ? "agent-copilot-goal-value" : "agent-copilot-goal-value agent-copilot-goal-value--empty"}
            >
              {activeEvidenceScribe?.goal || activeEvidenceGoalEmpty}
            </Text>
          </Stack>
        )}
      </Stack>
    ) : null;

  const activeTaskProjectDirectory = normalizeWorkingDirectory(activeEvidenceSession?.workingDirectory);
  const activeTaskEffectiveProjectDirectory = activeTaskProjectDirectory || fallbackWorkingDirectory;
  const activeTaskProjectDirectoryInherited = !activeTaskProjectDirectory && Boolean(activeTaskEffectiveProjectDirectory);
  const activeTaskContextPanel = activeEvidenceSession ? (
    <Paper className="agent-copilot-active-task-context" withBorder radius="sm" p="sm">
      <Group className="agent-copilot-active-task-context__header" justify="space-between" gap="xs" wrap="nowrap">
        <Group gap="xs" wrap="nowrap">
          <IconClipboardCheck size={15} aria-hidden="true" />
          <Text size="xs" fw={800}>
            {t("agent.activeTaskContextTitle")}
          </Text>
        </Group>
        <Badge size="xs" variant="light" color="gray">
          {t(`agent.evidenceKind.${activeEvidenceSession.kind}`)}
        </Badge>
      </Group>
      <div className="agent-copilot-active-task-context__grid">
        <AgentTaskContextField
          icon={<IconClipboardCheck size={14} aria-hidden="true" />}
          label={activeEvidenceGoalLabel}
          value={activeEvidenceScribe?.goal}
          emptyLabel={activeEvidenceGoalEmpty}
          lineClamp={2}
        />
        {activeEvidenceSession.kind === "walkthrough" ? (
          <>
            <AgentTaskContextField
              icon={<IconPackage size={14} aria-hidden="true" />}
              label={t("agent.targetPackageLabel")}
              value={activeEvidenceScribe?.targetPackage}
              emptyLabel={t("agent.activeTaskContextNotSet")}
            />
            <AgentTaskContextField
              icon={<IconLink size={14} aria-hidden="true" />}
              label={t("agent.uiReferenceUrlLabel")}
              value={activeEvidenceScribe?.uiReferenceUrl}
              emptyLabel={t("agent.activeTaskContextNotSet")}
            />
          </>
        ) : null}
        <AgentTaskContextField
          icon={<IconFolder size={14} aria-hidden="true" />}
          label={t("agent.projectAddressLabel")}
          value={activeTaskEffectiveProjectDirectory}
          emptyLabel={t("agent.activeTaskContextNotSet")}
          inherited={activeTaskProjectDirectoryInherited}
          inheritedPrefix={t("agent.activeTaskContextInheritedPrefix")}
        />
      </div>
    </Paper>
  ) : null;

  const scribePanel = (
    <ScrollArea viewportRef={scribeViewportRef} className="agent-copilot-mode-scroll agent-copilot-scribe-scroll">
      <Stack gap="sm" pr="xs" style={{ minHeight: "100%" }}>
        {activeEvidenceSession ? (
          <>
            {activeEvidenceGoalPanel}
            {reportFailureByEvidenceId[activeEvidenceSession.id] ? (
              <Text size="xs" c="red" lineClamp={2}>
                {t("agent.evidenceReportFailed", { reason: reportFailureByEvidenceId[activeEvidenceSession.id] })}
              </Text>
            ) : null}
            <EvidenceRecordTimeline
              session={activeEvidenceSession}
              locale={i18n.resolvedLanguage}
              dense={false}
              fill={Boolean(activeEvidenceSession)}
              statusBadge={
                <>
                  <Badge size="xs" color={scoutTaskRunStateColor(activeScoutTaskRunState)} variant="light">
                    {t(`agent.scoutTaskRunState.${activeScoutTaskRunState}`)}
                  </Badge>
                  <Badge size="xs" color="gray" variant="light">
                    {t("agent.evidenceArtifactCount", { count: activeEvidenceSession.artifacts.length })}
                  </Badge>
                  {activeScribeRunning ? (
                    <Badge size="xs" color="blue" variant="dot">
                      {t("agent.scribeReviewing")}
                    </Badge>
                  ) : null}
                  {activeEvidenceSession && (activeTaskRunning || activeScribeRunning) ? (
                    <Badge size="xs" color="blue" variant="dot">
                      {t("agent.scribeThinking")}
                    </Badge>
                  ) : null}
                </>
              }
              t={t}
            />
            {activeTaskContextPanel || activeTaskConversationMessages.length ? (
              <Stack className="agent-copilot-active-task-conversation" gap="xs">
                <Text size="xs" fw={800} c="dimmed">
                  {t("agent.activeTaskConversationTitle")}
                </Text>
                {activeTaskContextPanel}
                {activeTaskConversationMessages.map((message) => (
                  <MessageBubble
                    key={message.id}
                    message={message}
                    showApproval={false}
                  />
                ))}
              </Stack>
            ) : null}
            {activeTaskRunning || activeScribeRunning ? (
              <Paper className="agent-copilot-scribe-stream" withBorder radius="md" p="sm" aria-live="polite">
                <ThinkingIndicator label={t("agent.scribeThinking")} />
                {visibleAgentStreamText ? (
                  <Text className="agent-copilot-scribe-stream__text" size="sm" mt={6}>
                    {visibleAgentStreamText}
                  </Text>
                ) : (
                  <Text size="xs" c="dimmed" mt={4}>
                    {t("agent.scribeStreamWaiting")}
                  </Text>
                )}
              </Paper>
            ) : null}
          </>
        ) : (
          selectedEvidenceHistorySession ? (
            <Stack gap="xs" style={{ flex: 1, minHeight: 0 }}>
              <EvidenceRecordTimeline
                session={selectedEvidenceHistorySession}
                locale={i18n.resolvedLanguage}
                dense={false}
                fill
                statusBadge={
                  <>
                    <Badge size="xs" color={scoutTaskRunStateColor(deriveScoutTaskRunState(selectedEvidenceHistorySession))} variant="light">
                      {t(`agent.scoutTaskRunState.${deriveScoutTaskRunState(selectedEvidenceHistorySession)}`)}
                    </Badge>
                    <Badge size="xs" color="gray" variant="light">
                      {t("agent.evidenceArtifactCount", { count: selectedEvidenceHistorySession.artifacts.length })}
                    </Badge>
                  </>
                }
                t={t}
              />
              <Group justify="flex-end">
                <Button
                  size="xs"
                  variant="default"
                  leftSection={<IconFileExport size={14} />}
                  onClick={() => void exportEvidenceReport(selectedEvidenceHistorySession)}
                >
                  {t("agent.evidenceExport")}
                </Button>
              </Group>
            </Stack>
          ) : (
            newEvidenceDraftSelected ? (
              <Stack gap="xs" style={{ flex: 1, minHeight: 0 }}>
                <Group gap={6} wrap="nowrap" align="center">
                  <Text size="xs" fw={700}>
                    {t(`agent.evidenceHistoryTitle.${visibleEvidenceKind}`)}
                  </Text>
                  <Badge size="xs" color={scoutTaskRunStateColor("not_started")} variant="light">
                    {t("agent.evidenceIdleStatus")}
                  </Badge>
                </Group>
                <Text size="xs" c="dimmed">
                  {t("agent.evidenceNoActive")}
                </Text>
              </Stack>
            ) : (
              <EvidenceRecordHistory
                sessions={recentEvidenceSessions}
                kind={visibleEvidenceKind}
                locale={i18n.resolvedLanguage}
                dense={false}
                fill
                statusBadge={
                  <Badge size="xs" color={scoutTaskRunStateColor("not_started")} variant="light">
                    {t("agent.evidenceIdleStatus")}
                  </Badge>
                }
                t={t}
              />
            )
          )
        )}
      </Stack>
    </ScrollArea>
  );

  const scribeFooter = activeEvidenceSession ? (
    <Stack className="agent-copilot-mode-footer agent-copilot-runbar agent-copilot-runbar--active" gap="xs">
      <Group justify="space-between" gap="xs">
        <Button
          size="xs"
          color="red"
          variant="light"
          leftSection={<IconSquare size={13} />}
          loading={stoppingEvidenceId === activeEvidenceSession.id}
          onClick={() => void stopActiveEvidenceTask()}
        >
          {stoppingEvidenceId === activeEvidenceSession.id
            ? t("agent.evidenceStoppingTask")
            : t("agent.evidenceStopTask")}
        </Button>
        <Button size="xs" variant="default" leftSection={<IconFileExport size={14} />} onClick={() => void exportEvidenceReport()}>
          {t("agent.evidenceExport")}
        </Button>
      </Group>
    </Stack>
  ) : (
    <Stack className="agent-copilot-mode-footer agent-copilot-runbar agent-copilot-start-console" gap="xs">
      <div className="agent-copilot-runbar-main agent-copilot-start-console__controls">
        <Stack className="agent-copilot-start-console__goal-stack" gap={6}>
          <Textarea
            autosize
            minRows={1}
            maxRows={2}
            value={evidenceGoalDraft}
            placeholder={evidenceGoalPlaceholder}
            onChange={(event) => setEvidenceGoalDraft(event.currentTarget.value)}
            onPaste={(event) => handleEvidencePathPaste(event, setEvidenceGoalDraft)}
            className="agent-copilot-goal-input agent-copilot-runbar-goal"
          />
          {visibleEvidenceKind === "walkthrough" ? (
            <>
              <div className="agent-copilot-reference-row">
                <button
                  type="button"
                  className={`agent-copilot-package-picker${evidenceTargetPackageDraft ? " is-selected" : ""}`}
                  title={evidenceTargetPackageDraft || t("agent.targetPackageOptional")}
                  onClick={() => setTargetPackagePickerOpen(true)}
                >
                  <IconPackage size={16} aria-hidden="true" />
                  <span>{evidenceTargetPackageDraft || t("agent.targetPackageOptional")}</span>
                  <IconChevronDown size={14} aria-hidden="true" />
                </button>
                <TextInput
                  value={evidenceUiReferenceUrlDraft}
                  placeholder={t("agent.uiReferenceUrlPlaceholder")}
                  onChange={(event) => setEvidenceUiReferenceUrlDraft(event.currentTarget.value)}
                  onPaste={(event) => handleEvidencePathPaste(event, setEvidenceUiReferenceUrlDraft)}
                  leftSection={<IconLink size={16} aria-hidden="true" />}
                  className="agent-copilot-ui-reference-input"
                />
              </div>
              {evidenceUiReferenceHintKey ? (
                <Group className="agent-copilot-ui-reference-hint" gap={6} wrap="nowrap">
                  <IconInfoCircle size={14} aria-hidden="true" />
                  <Text size="xs">{t(`agent.${evidenceUiReferenceHintKey}`)}</Text>
                </Group>
              ) : null}
            </>
          ) : null}
        </Stack>
        <div className="agent-copilot-start-console__actions">
          <Button
            size="sm"
            color="blue"
            className="agent-copilot-start-action"
            leftSection={visibleEvidenceKind === "bug_repro" ? <IconBug size={15} /> : <IconClipboardCheck size={15} />}
            onClick={() => void startEvidenceFromUi(visibleEvidenceKind)}
            disabled={startTaskDisabled}
          >
            {evidenceModeStartLabel}
          </Button>
        </div>
      </div>
      <AgentWorkingDirectoryBar
        workingDirectory={explicitWorkingDirectory}
        fallbackWorkingDirectory={fallbackWorkingDirectory}
        inherited={workingDirectoryIsInherited}
        onSelect={() => void selectCurrentWorkingDirectory()}
        onClear={() => void clearCurrentWorkingDirectory()}
        t={t}
      />
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
              {copilotMode === "chat" ? (
                <Badge color="gray" variant="light">
                  {t("agent.conversationBadge")}
                </Badge>
              ) : null}
            </Group>
            {copilotMode === "chat" ? (
              <Text size="xs" c="dimmed" lineClamp={1}>
                {t("agent.contextLine", {
                  device: deviceTarget.label || t("agent.noDevice"),
                  cli: cliConfigured ? cliProfile.name : t("agent.cliMissing"),
                })}
              </Text>
            ) : null}
          </Stack>
        </Group>

        <div
          id={`agent-task-panel-${copilotMode}`}
          className="agent-copilot-mode-body"
          role="tabpanel"
          aria-labelledby={`agent-task-tab-${copilotMode}`}
        >
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

  const targetPackageModal = (
    <ScoutPackagePickerModal
      opened={targetPackagePickerOpen}
      deviceSerial={deviceTarget.serial}
      selectedPackage={evidenceTargetPackageDraft}
      onSelect={setEvidenceTargetPackageDraft}
      onClose={() => setTargetPackagePickerOpen(false)}
    />
  );

  return (
    <div className="agent-copilot-system" style={{ height: "100%", minHeight: 0, display: "grid", gridTemplateColumns: "280px minmax(0, 1fr)", gap: "var(--space-md)" }}>
      {sessionList}
      {conversationPanel}
      {runtimeProbeModal}
      {targetPackageModal}
    </div>
  );
}

function ScoutPackagePickerModal({
  opened,
  deviceSerial,
  selectedPackage,
  onSelect,
  onClose,
}: {
  opened: boolean;
  deviceSerial: string | null;
  selectedPackage: string;
  onSelect: (packageName: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [packages, setPackages] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!opened) return;
    setSearch("");
    setError("");
    if (!deviceSerial) {
      setPackages([]);
      setLoading(false);
      return;
    }
    let disposed = false;
    setLoading(true);
    invoke<string[]>("adb_list_packages", { deviceSerial })
      .then((items) => {
        if (!disposed) setPackages([...new Set(items)].sort((a, b) => a.localeCompare(b)));
      })
      .catch((loadError) => {
        if (!disposed) {
          setPackages([]);
          setError(String(loadError));
        }
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [deviceSerial, opened]);

  const normalizedSearch = search.trim().toLowerCase();
  const visiblePackages = normalizedSearch
    ? packages.filter((packageName) => packageName.toLowerCase().includes(normalizedSearch))
    : packages;
  const choosePackage = (packageName: string) => {
    onSelect(packageName);
    onClose();
  };

  return (
    <Modal opened={opened} onClose={onClose} title={t("agent.targetPackageDialogTitle")} centered size="md">
      <Stack gap="sm">
        <Text size="sm" c="dimmed">
          {t("agent.targetPackageDialogHint")}
        </Text>
        <TextInput
          value={search}
          onChange={(event) => setSearch(event.currentTarget.value)}
          placeholder={t("agent.targetPackageSearchPlaceholder")}
          leftSection={<IconSearch size={16} aria-hidden="true" />}
          className="agent-copilot-package-search"
          autoFocus
        />
        <button
          type="button"
          className={`agent-copilot-package-option agent-copilot-package-option--infer${selectedPackage ? "" : " is-selected"}`}
          aria-pressed={!selectedPackage}
          onClick={() => choosePackage("")}
        >
          <span>{t("agent.targetPackageInfer")}</span>
          {!selectedPackage ? <IconCheck size={15} aria-hidden="true" /> : null}
        </button>
        <ScrollArea h={320} type="auto" offsetScrollbars>
          <Stack gap={4} pr="xs">
            {loading ? (
              <Group justify="center" gap="xs" py="lg">
                <Loader size="sm" />
                <Text size="sm" c="dimmed">{t("agent.targetPackageLoading")}</Text>
              </Group>
            ) : !deviceSerial ? (
              <Text size="sm" c="dimmed" ta="center" py="lg">{t("agent.targetPackageNoDevice")}</Text>
            ) : error ? (
              <Text size="sm" c="red" ta="center" py="lg">
                {t("agent.targetPackageLoadFailed", { reason: error })}
              </Text>
            ) : visiblePackages.length ? (
              visiblePackages.map((packageName) => (
                <button
                  key={packageName}
                  type="button"
                  className={`agent-copilot-package-option${selectedPackage === packageName ? " is-selected" : ""}`}
                  aria-pressed={selectedPackage === packageName}
                  onClick={() => choosePackage(packageName)}
                >
                  <span title={packageName}>{packageName}</span>
                  {selectedPackage === packageName ? <IconCheck size={15} aria-hidden="true" /> : null}
                </button>
              ))
            ) : (
              <Text size="sm" c="dimmed" ta="center" py="lg">{t("agent.targetPackageEmpty")}</Text>
            )}
          </Stack>
        </ScrollArea>
      </Stack>
    </Modal>
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

function AgentWorkingDirectoryBar({
  workingDirectory,
  fallbackWorkingDirectory,
  inherited,
  onSelect,
  onClear,
  t,
}: {
  workingDirectory: string;
  fallbackWorkingDirectory: string;
  inherited: boolean;
  onSelect: () => void;
  onClear: () => void;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  const explicitPath = normalizeWorkingDirectory(workingDirectory);
  const fallbackPath = normalizeWorkingDirectory(fallbackWorkingDirectory);
  const displayPath = explicitPath || fallbackPath;
  const shortPath = workingDirectoryShortName(displayPath);
  const valueLabel = displayPath
    ? inherited
      ? t("agent.workingDirectoryInherited", { path: shortPath })
      : shortPath
    : t("agent.workingDirectoryNotSet");
  const tooltipLabel = displayPath
    ? inherited
      ? t("agent.workingDirectoryInherited", { path: displayPath })
      : displayPath
    : t("agent.workingDirectoryNotSet");

  return (
    <Group className="agent-copilot-working-directory" gap="xs" wrap="nowrap">
      <IconFolder size={15} aria-hidden="true" />
      <Text size="xs" fw={800} className="agent-copilot-working-directory__label">
        {t("agent.workingDirectoryLabel")}
      </Text>
      <Tooltip label={tooltipLabel} disabled={!displayPath}>
        <Text size="xs" className="agent-copilot-working-directory__path" lineClamp={1}>
          {valueLabel}
        </Text>
      </Tooltip>
      <Button size="compact-xs" variant="subtle" onClick={onSelect}>
        {displayPath ? t("agent.workingDirectoryChange") : t("agent.workingDirectoryChoose")}
      </Button>
      {explicitPath ? (
        <ActionIcon size="sm" variant="subtle" aria-label={t("agent.workingDirectoryClear")} onClick={onClear}>
          <IconX size={13} />
        </ActionIcon>
      ) : null}
    </Group>
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
    <Paper withBorder radius="sm" p="md" bg={ok ? "green.0" : "gray.0"}>
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

function AgentTaskContextField({
  icon,
  label,
  value,
  emptyLabel,
  inherited = false,
  inheritedPrefix,
  lineClamp = 1,
}: {
  icon: ReactNode;
  label: string;
  value?: string | null;
  emptyLabel: string;
  inherited?: boolean;
  inheritedPrefix?: string;
  lineClamp?: number;
}) {
  const normalizedValue = value?.trim() ?? "";
  const hasValue = Boolean(normalizedValue);
  const displayValue = hasValue
    ? inherited && inheritedPrefix
      ? `${inheritedPrefix}${normalizedValue}`
      : normalizedValue
    : emptyLabel;
  const stateClass = hasValue ? (inherited ? " is-inherited" : "") : " is-empty";

  return (
    <div className={`agent-copilot-active-task-context__field${stateClass}`}>
      <Group className="agent-copilot-active-task-context__field-label" gap={6} wrap="nowrap">
        <span className="agent-copilot-active-task-context__field-icon">{icon}</span>
        <Text size="xs" fw={800} lineClamp={1}>
          {label}
        </Text>
      </Group>
      <Text
        size="xs"
        lineClamp={lineClamp}
        className="agent-copilot-active-task-context__field-value"
        title={hasValue ? normalizedValue : emptyLabel}
      >
        {displayValue}
      </Text>
    </div>
  );
}

function EvidenceTaskHistoryList({
  sessions,
  kind,
  selectedSessionId,
  locale,
  onSelect,
  onDelete,
  t,
}: {
  sessions: EvidenceSession[];
  kind: EvidenceSessionKind;
  selectedSessionId: string | null;
  locale?: string;
  onSelect: (session: EvidenceSession) => void;
  onDelete: (sessionId: string) => void;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  return (
    <>
      <Group className="agent-copilot-recent-heading" justify="space-between" gap="xs" wrap="nowrap">
        <Text size="xs" fw={800}>
          {t(`agent.evidenceHistoryTitle.${kind}`)}
        </Text>
      </Group>

      <ScrollArea style={{ flex: 1 }}>
        {sessions.length ? (
          <Stack gap={6}>
            {sessions.map((session) => (
              <div
                key={session.id}
                className={`agent-copilot-session-card${selectedSessionId === session.id ? " is-active" : ""}`}
                role="button"
                tabIndex={0}
                onClick={() => onSelect(session)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelect(session);
                  }
                }}
                style={{
                  color: "inherit",
                  cursor: "pointer",
                  padding: 10,
                  textAlign: "left",
                }}
              >
                <Group className="agent-copilot-evidence-history-row" gap="xs" wrap="nowrap">
                  <Text className="agent-copilot-evidence-history-title" size="sm" fw={700} lineClamp={1}>
                    {session.title || t(`agent.evidenceKind.${session.kind}`)}
                  </Text>
                  <Text
                    className="agent-copilot-evidence-history-status"
                    size="xs"
                    c={session.status === "active" ? "green" : "dimmed"}
                    title={t(`agent.scoutTaskRunState.${deriveScoutTaskRunState(session)}`)}
                  >
                    {t(`agent.scoutTaskRunState.${deriveScoutTaskRunState(session)}`)}
                  </Text>
                  {session.status !== "active" ? (
                    <ActionIcon
                      className="agent-copilot-evidence-history-delete"
                      size="sm"
                      variant="subtle"
                      color="gray"
                      aria-label={t("agent.deleteEvidenceSession")}
                      title={t("agent.deleteEvidenceSession")}
                      onClick={(event) => {
                        event.stopPropagation();
                        void onDelete(session.id);
                      }}
                    >
                      <IconTrash size={14} />
                    </ActionIcon>
                  ) : null}
                </Group>
                <Text size="xs" c="dimmed" lineClamp={1}>
                  {t("agent.evidenceArtifactCount", { count: session.artifacts.length })} · {formatEvidenceTime(session.updatedAt, locale)}
                </Text>
              </div>
            ))}
          </Stack>
        ) : (
          <Text size="xs" c="dimmed">
            {t("agent.evidenceHistoryEmpty")}
          </Text>
        )}
      </ScrollArea>
    </>
  );
}

function EvidenceRecordTimeline({
  session,
  locale,
  dense,
  fill,
  statusBadge,
  t,
}: {
  session: EvidenceSession;
  locale?: string;
  dense: boolean;
  fill?: boolean;
  statusBadge?: ReactNode;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  const artifacts = session.artifacts.slice().sort((a, b) => b.createdAt - a.createdAt);
  return (
    <Stack gap="sm" style={{ flex: fill ? 1 : undefined, minHeight: fill ? 0 : undefined }}>
      <Group gap={6} wrap="wrap" align="center">
        <Text size="xs" fw={700}>
          {t(`agent.evidenceHistoryTitle.${session.kind}`)}
        </Text>
        {statusBadge}
      </Group>
      {artifacts.length ? (
        <Stack
          gap="sm"
          style={{
            flex: fill ? 1 : undefined,
            minHeight: fill ? 0 : undefined,
            paddingRight: 2,
          }}
        >
          {artifacts.map((artifact) => (
            <EvidenceArtifactItem key={artifact.id} artifact={artifact} locale={locale} compact={dense} expanded={!dense} t={t} />
          ))}
        </Stack>
      ) : (
        <Paper className="agent-copilot-evidence-item" withBorder radius="sm" p="md" bg="gray.0">
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
  kind,
  locale,
  dense,
  fill,
  statusBadge,
  t,
}: {
  sessions: EvidenceSession[];
  kind: EvidenceSessionKind;
  locale?: string;
  dense: boolean;
  fill?: boolean;
  statusBadge?: ReactNode;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  const visibleSessions = sessions.filter((session) => session.artifacts.length || session.status === "active");
  return (
    <Stack gap="sm" style={{ flex: fill ? 1 : undefined, minHeight: fill ? 0 : undefined }}>
      <Group gap={6} wrap="nowrap" align="center">
        <Text size="xs" fw={700}>
          {t(`agent.evidenceHistoryTitle.${kind}`)}
        </Text>
        {statusBadge}
      </Group>
      {visibleSessions.length ? (
        <Stack
          gap="sm"
          style={{
            flex: fill ? 1 : undefined,
            minHeight: fill ? 0 : undefined,
            paddingRight: 2,
          }}
        >
          {visibleSessions.map((session) => (
            <Stack
              key={session.id}
              className="agent-copilot-evidence-session"
              gap="sm"
              style={{
                padding: "var(--space-md)",
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
                <Stack gap="sm">
                  {session.artifacts
                    .slice()
                    .sort((a, b) => b.createdAt - a.createdAt)
                    .map((artifact) => (
                      <EvidenceArtifactItem key={artifact.id} artifact={artifact} locale={locale} compact={dense} expanded t={t} />
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
  expanded,
  t,
}: {
  artifact: EvidenceArtifact;
  locale?: string;
  compact: boolean;
  expanded?: boolean;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  const isPreviewableImage = isPreviewableEvidenceImagePath(artifact.path);
  const isScreenStateArtifact = artifact.type === "screen_state";
  const [showScreenStateDetails, setShowScreenStateDetails] = useState(
    isScreenStateArtifact && screenStateNeedsAttention(artifact.body ?? ""),
  );
  const showArtifactPath = Boolean(artifact.path) && (!isScreenStateArtifact || showScreenStateDetails);
  return (
    <Paper className="agent-copilot-evidence-item" withBorder radius="sm" p="md">
      <Stack gap="sm">
        <Group justify="space-between" gap="xs" wrap="nowrap">
          <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
            <Text size="xs" fw={700} lineClamp={1}>
              {artifact.title}
            </Text>
          </Group>
          <Text size="xs" c="dimmed" style={{ flex: "0 0 auto" }}>
            {formatEvidenceTime(artifact.createdAt, locale)}
          </Text>
        </Group>
        {isScreenStateArtifact ? (
          <Group justify="space-between" gap="xs" align="flex-start" wrap="nowrap">
            <Text size="xs" c="dimmed">
              {screenStateNeedsAttention(artifact.body ?? "")
                ? t("agent.evidenceScreenStateAttention")
                : t("agent.evidenceScreenStateSummary")}
            </Text>
            <Button
              size="compact-xs"
              variant="subtle"
              aria-expanded={showScreenStateDetails}
              onClick={() => setShowScreenStateDetails((current) => !current)}
              style={{ flex: "0 0 auto" }}
            >
              {showScreenStateDetails
                ? t("agent.evidenceScreenStateHideDetails")
                : t("agent.evidenceScreenStateDetails")}
            </Button>
          </Group>
        ) : artifact.body ? (
          <Text
            size="xs"
            style={{
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
              lineHeight: 1.48,
            }}
          >
            {expanded ? artifact.body : trimForPrompt(artifact.body, compact ? 500 : 1200)}
          </Text>
        ) : null}
        {isScreenStateArtifact && showScreenStateDetails ? (
          <Text
            size="xs"
            style={{
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
              lineHeight: 1.48,
            }}
          >
            {artifact.body ?? ""}
          </Text>
        ) : null}
        {isPreviewableImage ? (
          <EvidenceArtifactImagePreview path={artifact.path!} title={artifact.title} compact={compact} t={t} />
        ) : null}
        {showArtifactPath ? (
          <Stack gap={6}>
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
              <CopyButton value={artifact.path!}>
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

function screenStateNeedsAttention(body: string) {
  return /(?:error|failed|failure|crash|anr|blocked|unavailable|无响应|未响应|停止运行|失败|异常|阻塞)/i.test(body);
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
  const [previewOpen, setPreviewOpen] = useState(false);
  const previewMaxHeight = compact ? EVIDENCE_IMAGE_PREVIEW_COMPACT_MAX_HEIGHT : EVIDENCE_IMAGE_PREVIEW_MAX_HEIGHT;

  useEffect(() => {
    let disposed = false;
    setPreviewSrc(null);
    setPreviewError(null);
    setPreviewOpen(false);
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
      <>
        <button
          type="button"
          className="agent-copilot-image-preview-trigger"
          aria-label={t("agent.evidenceOpenImagePreview")}
          onClick={() => setPreviewOpen(true)}
        >
          <img
            src={previewSrc}
            alt={title}
            style={{
              width: "100%",
              maxHeight: previewMaxHeight,
              objectFit: "contain",
              borderRadius: "var(--radius-md)",
              border: "var(--border-hairline)",
              background: "var(--surface-sunken)",
            }}
          />
        </button>
        <Modal
          opened={previewOpen}
          onClose={() => setPreviewOpen(false)}
          title={t("agent.evidenceImagePreviewTitle")}
          size="xl"
          centered
        >
          <img
            src={previewSrc}
            alt={title}
            style={{
              width: "100%",
              maxHeight: "76vh",
              objectFit: "contain",
              borderRadius: "var(--radius-md)",
              border: "var(--border-hairline)",
              background: "var(--surface-sunken)",
            }}
          />
        </Modal>
      </>
    );
  }

  return (
    <Paper
      className="agent-copilot-evidence-item"
      withBorder
      radius="sm"
      p="md"
      style={{
        minHeight: previewMaxHeight,
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

function isPreviewableEvidenceImagePath(path?: string) {
  return Boolean(path?.match(/\.(png|jpe?g|webp)$/i));
}

function MessageBubble({
  message,
  onApprove,
  onDeny,
  showApproval = true,
}: {
  message: AgentCopilotMessage;
  onApprove?: () => void;
  onDeny?: () => void;
  showApproval?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const align = message.role === "user" ? "flex-end" : "flex-start";
  const timeLabel = formatAgentMessageTimeLabel(message, t, i18n.resolvedLanguage || i18n.language);
  const body = displayMessageBody(message, t);
  const collapsible = !message.thinking && message.role !== "user" && body.length > MESSAGE_COLLAPSE_THRESHOLD;
  const visibleBody = collapsible && !expanded ? `${body.slice(0, MESSAGE_COLLAPSE_THRESHOLD).trimEnd()}…` : body;
  return (
    <Group justify={align}>
      <Paper
        className={`agent-copilot-message agent-copilot-message-${message.role}`}
        withBorder
        radius="md"
        p="md"
        title={timeLabel}
        style={{
          maxWidth: message.role === "command" ? "100%" : "78%",
          width: message.role === "command" ? "100%" : undefined,
        }}
      >
        <Text className="agent-copilot-message-time" size="xs">
          {timeLabel}
        </Text>
        {message.command ? (
          <Group gap="xs" mb={4}>
            <Code style={{ whiteSpace: "normal", wordBreak: "break-word" }}>{message.command}</Code>
          </Group>
        ) : null}
        {message.thinking ? <ThinkingIndicator label={t("agent.thinking")} /> : <MessageText body={visibleBody} />}
        {collapsible ? (
          <Button
            variant="subtle"
            size="compact-xs"
            mt="xs"
            rightSection={expanded ? <IconChevronUp size={13} /> : <IconChevronDown size={13} />}
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? t("agent.messageCollapse") : t("agent.messageExpand")}
          </Button>
        ) : null}
        {showApproval && message.approval ? (
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
                    {message.approval.tool === "reference.figma.login" ? t("agent.figmaLoginAction") : t("agent.approvalAllowOnce")}
                  </Button>
                </Group>
              </Group>
            </Stack>
          </>
        ) : null}
        {message.attachments?.length ? (
          <Group className="agent-copilot-attachment-list" gap="xs" wrap="wrap" mt="xs">
            {message.attachments.map((attachment) => (
              <AttachmentPreviewCard key={attachment.id} attachment={attachment} t={t} />
            ))}
          </Group>
        ) : null}
      </Paper>
    </Group>
  );
}

function AttachmentPreviewCard({
  attachment,
  removable = false,
  onRemove,
  t,
}: {
  attachment: AgentCopilotAttachment;
  removable?: boolean;
  onRemove?: () => void;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const canPreviewImage = attachment.previewKind === "image" && Boolean(attachment.previewDataUrl);
  const canPreviewText = Boolean(attachment.textPreview);
  const previewLabel = canPreviewImage
    ? t("agent.attachmentImagePreview")
    : canPreviewText
      ? t("agent.attachmentTextPreview")
      : t("agent.attachmentPreviewUnavailable");

  return (
    <Paper className="agent-copilot-attachment-card" withBorder>
      <button
        type="button"
        className="agent-copilot-attachment-card__button"
        aria-label={t("agent.openAttachmentPreview", { name: attachment.name })}
        onClick={() => setPreviewOpen(true)}
      >
        <span className="agent-copilot-attachment-card__thumb" aria-hidden="true">
          {canPreviewImage ? (
            <img src={attachment.previewDataUrl} alt="" />
          ) : (
            <IconFile size={18} />
          )}
        </span>
        <span className="agent-copilot-attachment-card__meta">
          <span className="agent-copilot-attachment-card__name">{attachment.name}</span>
          <span className="agent-copilot-attachment-card__detail">
            {formatBytes(attachment.sizeBytes)}
            {attachment.mimeType ? ` · ${attachment.mimeType}` : ""}
          </span>
        </span>
      </button>
      {removable && onRemove ? (
        <ActionIcon
          className="agent-copilot-attachment-card__remove"
          size="sm"
          variant="subtle"
          color="gray"
          aria-label={t("agent.removeAttachment")}
          onClick={onRemove}
        >
          <IconX size={14} />
        </ActionIcon>
      ) : null}
      <Modal
        opened={previewOpen}
        onClose={() => setPreviewOpen(false)}
        title={t("agent.attachmentPreviewTitle", { name: attachment.name })}
        size="lg"
        centered
      >
        <Stack gap="sm">
          <Group gap="xs" wrap="wrap">
            <Badge variant="light" color="gray">
              {formatBytes(attachment.sizeBytes)}
            </Badge>
            {attachment.mimeType ? (
              <Badge variant="light" color="gray">
                {attachment.mimeType}
              </Badge>
            ) : null}
            <Badge variant="light" color={canPreviewImage || canPreviewText ? "green" : "gray"}>
              {previewLabel}
            </Badge>
          </Group>
          {canPreviewImage ? (
            <div className="agent-copilot-attachment-modal-image">
              <img src={attachment.previewDataUrl} alt={t("agent.attachmentImageAlt", { name: attachment.name })} />
            </div>
          ) : canPreviewText ? (
            <Paper className="agent-copilot-attachment-text-preview" withBorder>
              <Text size="xs" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                {attachment.textPreview}
              </Text>
            </Paper>
          ) : (
            <Text size="sm" c="dimmed">
              {t("agent.binaryAttachment")}
            </Text>
          )}
        </Stack>
      </Modal>
    </Paper>
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
        ) : part.kind === "url" ? (
          <button
            key={`${part.text}-${index}`}
            type="button"
            onClick={() => void openMessageUrl(part.text)}
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
    .map((session) => ({
      ...session,
      scope: (session as { scope?: unknown }).scope === "scout_task" ? "scout_task" as const : "chat" as const,
      evidenceSessionId:
        typeof (session as { evidenceSessionId?: unknown }).evidenceSessionId === "string"
          ? (session as { evidenceSessionId: string }).evidenceSessionId
          : null,
      workingDirectory: normalizeWorkingDirectory(session.workingDirectory) || null,
      messages: session.messages.map((message) => {
        const { queued: _legacyQueued, ...normalizedMessage } = message as AgentCopilotMessage & { queued?: boolean };
        return normalizedMessage;
      }),
    }))
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
        agentSessionId:
          typeof (session as { agentSessionId?: unknown }).agentSessionId === "string"
            ? (session as { agentSessionId: string }).agentSessionId
            : null,
        workingDirectory: normalizeWorkingDirectory((session as { workingDirectory?: unknown }).workingDirectory) || null,
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
  const permissionLevel: ScoutTaskPermissionLevel = "auto_execute";
  const agentStartedAt = typeof value?.agentStartedAt === "number" ? value.agentStartedAt : null;
  const agentStoppedAt = typeof value?.agentStoppedAt === "number" ? value.agentStoppedAt : null;
  return {
    enabled: value?.enabled ?? true,
    intensity,
    permissionLevel,
    goal: typeof value?.goal === "string" ? value.goal : "",
    targetPackage: normalizeTargetPackage((value as { targetPackage?: unknown } | undefined)?.targetPackage),
    uiReferenceUrl: normalizeUiReferenceUrl((value as { uiReferenceUrl?: unknown } | undefined)?.uiReferenceUrl),
    agentActive: Boolean(value?.agentActive),
    agentStartedAt,
    agentStoppedAt,
    lastReviewedArtifactId: value?.lastReviewedArtifactId ?? null,
    coverageSummary: value?.coverageSummary ?? "",
    issuesSummary: value?.issuesSummary ?? "",
    gapsSummary: value?.gapsSummary ?? "",
    nextAction: value?.nextAction ?? "",
    terminalOutcome:
      value?.terminalOutcome === "COMPLETED" || value?.terminalOutcome === "BLOCKED_NEEDS_HUMAN" || value?.terminalOutcome === "FAILED"
        ? value.terminalOutcome
        : undefined,
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
  workingDirectory?: string | null,
  onStream?: (event: AgentCliStreamEvent) => void,
) {
  const streamId = `stream-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  let unlisten: (() => void) | null = null;
  try {
    unlisten = await listen<AgentCliStreamEvent>(`agent-cli-stream-${streamId}`, (event) => {
      onStream?.(event.payload);
    });
    const cwd = normalizeWorkingDirectory(workingDirectory) || normalizeWorkingDirectory(cliProfile.cwd);
    const result = await invoke<AgentCliAnalysisResult>("agent_cli_analyze", {
      request: {
        kind: cliProfile.kind,
        command: cliProfile.command,
        args: cliProfile.args ?? [],
        modelOverride: cliProfile.modelOverride || null,
        reasoningEffortOverride: cliProfile.reasoningEffortOverride || null,
        cwd: cwd || null,
        prompt,
        streamId,
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
  } finally {
    unlisten?.();
  }
}

function isAgentRuntimeFailureOutput(output: string) {
  return /invalid_request_error|requires a newer version of Codex|Agent CLI[\s\S]*(?:did not return usable|没有返回可用)/i.test(output);
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
  excludedMessageIds?: ReadonlySet<string>;
  workingDirectory: string | null;
  locale: string;
  executionPermission: ScoutTaskPermissionLevel;
  terminalOnly?: boolean;
}

interface EvidenceScribePromptInput {
  session: EvidenceSession;
  reason: string;
  finalReport: boolean;
  deviceLabel: string;
  deviceSerial: string | null;
  contextLabel: string;
  workingDirectory?: string | null;
  locale: string;
}

function buildAgentConversationPrompt(input: AgentConversationPromptInput) {
  const responseLanguage = input.locale.toLowerCase().startsWith("zh") ? "Chinese" : "English";
  const activeTaskPermission = input.executionPermission;
  const autonomousWalkthroughPrompt = input.evidenceSession?.kind === "walkthrough" && activeTaskPermission === "auto_execute";
  const authoritativeScribe = input.evidenceSession
    ? normalizeEvidenceScribe(input.evidenceSession.scribe)
    : null;
  const authoritativeGoal = authoritativeScribe?.goal?.trim() || "(empty — only true when the user did not provide a goal)";
  const authoritativeTargetPackage = authoritativeScribe?.targetPackage?.trim() || "(not specified)";
  const authoritativeReference = authoritativeScribe?.uiReferenceUrl?.trim() || "(not specified)";
  const terminalOutcomeLabel = input.evidenceSession?.kind === "bug_repro"
    ? "Bug repro outcome"
    : "Walkthrough outcome";
  const recentMessages = (input.session?.messages ?? [])
    .filter((message) => !input.excludedMessageIds?.has(message.id))
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
  return trimAgentConversationPrompt(
    [
      "You are Scout inside ADB Manager, an evidence-first Android device task agent.",
      `Respond in ${responseLanguage}.`,
      "AUTHORITATIVE SCOUT TASK CONTEXT (do not infer these fields from the UI snapshot; do not replace a non-empty value with an empty one):",
      `- Goal: ${authoritativeGoal}`,
      `- Target package: ${authoritativeTargetPackage}`,
      `- UI reference: ${authoritativeReference}`,
      "A non-empty Goal is sufficient to start. If the goal above is non-empty, never ask what feature to review and never report that the current goal is empty. Infer the next safe coverage action from this goal and the latest UI evidence.",
      "",
      ...(autonomousWalkthroughPrompt
        ? [
            "AUTONOMOUS EXECUTION MODE: this is not a conversational turn. Continue the walkthrough now.",
            "At every nonterminal turn, request at least one virtual ADB Manager tool by emitting exactly one JSON toolCalls block. Do not answer with a plan, acknowledgement, or device-data intention.",
            "The host already performed the initial ui.inspect and will execute your JSON request; the CLI does not need an external plugin. Never say that tools are unavailable.",
          ]
        : [
            "You are a conversational AI agent. Do not run a predefined diagnostic workflow by default.",
            "Decide whether to answer directly, ask a follow-up question, or request tools.",
          ]),
      "ADB Manager is the tool executor. ADB and the optional APK Agent only provide data/actions; you are responsible for deciding what is needed.",
      "Ground conclusions in tool results when you use tools. If you need more data, request it explicitly.",
      "Tool-call protocol: a tool call is only a request. Before ADB Manager returns its tool result, never say or imply that an action was accepted, rejected, executed, failed, or did or did not change device state. Say only that the action is being prepared or awaiting its result.",
      "",
      ...EXTERNAL_REFERENCE_WORKFLOW_RULES,
      ...(input.evidenceSession?.kind === "walkthrough" ? featureWalkthroughReviewPromptRules("walkthrough") : []),
      "",
      "Available auto-approved read-only tools:",
      input.evidenceSession?.kind === "walkthrough"
        ? "- device.get_summary. Do not request this for a normal walkthrough; use only when a device-level condition is directly relevant to a reported symptom."
        : "- device.get_summary",
      "- device.get_foreground_app",
      "- screen.capture",
      "- logcat.snapshot args: {filter?: string, lineLimit?: number}",
      "- package.list",
      input.evidenceSession?.kind === "walkthrough"
        ? "- performance.sample args: {targetPackage?: string}. Walkthroughs may use this only after an explicit performance request or an observed slowness, jank, freeze, ANR, crash, or resource-related symptom; never use it as a default baseline."
        : "- performance.sample args: {targetPackage?: string}. Returns current performance context by merging ADB system data, active performance stream data when present, and Agent APK sample data when available.",
      "- ui.inspect. Returns the current display size plus a bounded list of visible UI nodes with text, content descriptions, resource IDs, bounds, enabled state, and clickability. Use this before the first UI action and again after every meaningful UI action.",
      "- evidence.get_active_record. Returns the active Scout task evidence record with compact timeline, notes, screenshot paths, recordings, Logcat summaries, and task recorder state.",
      "- reference.feishu.fetch args: {url: string}. Reads a Feishu/Lark document through the user's local lark-cli identity. Use for a supplied Feishu/Lark document before judging the referenced requirements or UI, but do not wait on it before starting device-side coverage.",
      "- reference.figma.mcp_status. Checks the global Codex Figma MCP registration and OAuth state. Use before saying a Figma link is inaccessible.",
      "",
      "Permission-controlled expert tools:",
      "- app.launch args: {packageName: string, reason?: string}. Starts a launchable installed app by package name. It is available only for an active Auto-execute Scout task. Use it to recover a walkthrough from a screensaver or another foreground surface with zero accessible UI nodes; inspect again after launch.",
      "- workbench.request_adb_command args: {command: string, reason?: string}. Use this only for mutating or expert ADB actions. Low/medium-risk requests run directly in Auto-execute; protected requests are returned as blocked without an approval card. Other permission levels still use approval cards.",
      "- reference.figma.login. Use only after reference.figma.mcp_status shows that Figma is not authenticated. In Auto-execute it is returned as a blocked external login without an approval card; record the reference gap and continue accessible device coverage.",
      "- ui.tap args: {target: string, x?: number, y?: number, reason?: string}. target is authoritative; x/y are optional hints from the latest ui.inspect result. Copy target exactly from that node's text, contentDesc, or resourceId when available; visible child labels are allowed because Scout resolves their clickable parent or visible label. If the page moved, Scout re-locates the target in the fresh snapshot before tapping, so do not retry stale coordinates. It is auto-executed only when the active Scout task has Auto-execute enabled; a protected target is returned as blocked without an approval card. Other permission levels use an approval card.",
      "- ui.swipe args: {x1: number, y1: number, x2: number, y2: number, purpose: string, durationMs?: number, reason?: string}. It follows the same permission rule as ui.tap.",
      "- ui.press_back args: {reason?: string}. It follows the same permission rule as ui.tap.",
      "",
      `Current Scout task execution permission: ${activeTaskPermission}.`,
      "In auto_execute mode, ADB Manager runs eligible low- and medium-risk requests immediately and never inserts an operation approval card. Protected or expert-only actions are returned as blocked tool results; continue any remaining safe coverage, then finish with BLOCKED_NEEDS_HUMAN only when that boundary prevents completion. State the protected step, the one action the user must complete, and that they can restart the task afterward; never make the user infer the next step.",
      "For an autonomous walkthrough, use a bounded observe → act → verify loop: inspect the UI, choose one reversible navigation action, then inspect again and rely on the post-action screenshot/evidence. UI snapshots are intentionally compact: nodeCount is the full visible-node count, nodes contains the actionable nodes and key labels, and nodesTruncated means non-actionable hierarchy rows were omitted for context size; it does not mean the UI tool failed. Prefer typed UI tools. If the latest ui.inspect still has zero actionable nodes after app launch/recovery, or the surface is visual-only, use workbench.request_adb_command as a safe input fallback for only `shell input keyevent`, `shell input tap`, or `shell input swipe`; wake/operate the page, then capture or inspect again. Never use raw ADB for destructive or protected operations. Swipes, Back, ordinary navigation, Submit, Confirm, and Continue are reversible flow actions and should run directly. Never auto-tap a destructive/data-loss, payment/purchase, account sign-in/sign-out, authorization/permission, reset, or equivalent target.",
      input.evidenceSession?.kind === "walkthrough" && activeTaskPermission === "auto_execute"
        ? `This is an Auto-execute walkthrough. The initial UI snapshot is already included in tool results. Continue with typed UI tools until accessible coverage is complete or a real blocker prevents further progress. A response without toolCalls is terminal: never use it to say that you are waiting for results. End every terminal response with exactly one line: ${terminalOutcomeLabel}: COMPLETED | BLOCKED_NEEDS_HUMAN | FAILED. A missing external reference does not prevent coverage of accessible device paths. ADB Manager automatically retries Android crash/ANR dialog recovery up to five times, preferring a visible Close app action and falling back to Back, with a fresh UI inspection after every attempt. For a zero-node foreground surface such as a screensaver, ADB Manager first starts the selected target app, or a unique goal-matched launchable app when none was selected, then re-inspects before you choose the next coverage action. If the hierarchy remains empty after recovery, use the safe ADB input fallback described above and verify the result with a fresh screenshot or foreground check. Never finish the walkthrough just because the starting foreground surface was inaccessible. Continue from the recovered state; report a blocker only when recovery evidence shows that coverage cannot continue. After an unverified action, inspect again before choosing a different safe action.`
        : input.evidenceSession?.kind === "bug_repro" && activeTaskPermission === "auto_execute"
          ? `This is an Auto-execute bug reproduction. The initial UI snapshot is already included in tool results. Continue with typed UI tools until the repro path is covered or a real blocker prevents further progress. A response without toolCalls is terminal and must end with exactly one line: ${terminalOutcomeLabel}: COMPLETED | BLOCKED_NEEDS_HUMAN | FAILED.`
        : "",
      input.terminalOnly
        ? activeTaskPermission === "auto_execute"
          ? `The tool-turn safety budget is exhausted. Do not request any more tools. Synthesize the returned evidence now, state covered scope and gaps, and finish with ${terminalOutcomeLabel}: COMPLETED | BLOCKED_NEEDS_HUMAN | FAILED. Use FAILED when evidence is insufficient and no specific human action can unblock it.`
          : "The tool-turn safety budget is exhausted. Do not request any more tools. Summarize the latest returned results and clearly state any pending user approval or unresolved gap."
        : "",
      "",
      "Tool results already returned:",
      toolResults,
      "",
      "When you need tools, include exactly one JSON block like:",
      '```json\n{"toolCalls":[{"id":"summary","tool":"device.get_summary","args":{}}]}\n```',
      "You may include a short sentence before the JSON block, but do not claim the result until tool output is returned.",
      "If you do not need tools, answer normally and do not include toolCalls.",
      "",
      `Current device: ${input.deviceLabel}`,
      `Current device serial: ${input.deviceSerial || "(none selected)"}`,
      `Current ADB Manager context: ${input.contextLabel}`,
      `Current working directory: ${normalizeWorkingDirectory(input.workingDirectory) || "(not specified)"}`,
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
      "EXECUTION CONTRACT FOR THIS TURN:",
      "The listed ADB Manager tools are virtual task tools executed by the host application. They are available even though the CLI itself has no external tool plugin. Do not say that tools are unavailable. To request an action, output exactly one JSON block with toolCalls; ADB Manager will execute it and return the result in the next turn.",
      'Example: ```json {"toolCalls":[{"id":"inspect-next","tool":"ui.inspect","args":{}}]} ```',
      "For a walkthrough, request ui.inspect first, then request one safe ui.tap, ui.swipe, or ui.press_back using the latest snapshot. Never finish with a tools-unavailable explanation when the host has returned a UI snapshot.",
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
      ...featureWalkthroughExternalReferenceRules(input.session.kind),
      ...featureWalkthroughReviewPromptRules(input.session.kind),
      `Mode: ${input.finalReport ? "final QA report" : "short in-progress review"}`,
      `Review reason: ${input.reason}`,
      `Proactivity: ${scribe.intensity}`,
      `Permission level: ${scribe.permissionLevel}`,
      `Goal: ${scribe.goal || "(not specified)"}`,
      input.session.kind === "walkthrough"
        ? `Target package: ${scribe.targetPackage || "(not specified; infer from the reference and device context)"}`
        : undefined,
      `UI reference URL: ${scribe.uiReferenceUrl || "(not specified)"}`,
      `Device: ${input.deviceLabel}`,
      `Serial: ${input.deviceSerial || "(none selected)"}`,
      `ADB Manager context: ${input.contextLabel}`,
      `Working directory: ${normalizeWorkingDirectory(input.session.workingDirectory) || "(not specified)"}`,
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
  const runtimeInstructions =
    scribe.permissionLevel === "auto_execute"
      ? [
          `In auto_execute mode, run a bounded autonomous ${taskLabel} loop now; do not stop after acknowledgement.`,
          input.session.kind === "walkthrough"
            ? "Treat the non-empty Goal as the authoritative feature and entry scope. The selected target package has already been launched when one was provided. Start with the initial ui.inspect result, then navigate toward the Goal using safe UI tools; do not block because a reference or detailed expected result is missing. Use the UI hierarchy and key-state screenshots as the primary evidence; do not establish a device-performance baseline. Read Feishu, Figma, or other references only when a configured integration makes them accessible."
            : "First establish current device state and the readable reference scope. Read Feishu, Figma, or other references only when a configured integration makes them accessible.",
          "Use toolCalls to collect and compare evidence, navigate only through low- or medium-risk device commands, and capture a screenshot after each meaningful device-state change.",
          "Keep iterating through accessible device paths even when an external reference or integration is unavailable. Record that evidence gap, but do not use it as the sole reason to stop device-side coverage.",
          "If Android reports a crash or ANR, ADB Manager will first retry recovery up to five times, preferring a visible Close app action and falling back to Back, and will inspect after every attempt. Continue from the recovered state; only treat it as a blocker after all five attempts fail.",
          "A non-empty Goal is sufficient to start. Do not return BLOCKED_NEEDS_HUMAN merely because the reference, exact expected result, or a text label is missing; record an evidence gap or assumption and continue safe coverage. Stop when accessible paths are covered, a concrete target issue is found, or safe recovery cannot reach the target surface. Never invent a comparison or finding.",
        ]
      : [
          "Important runtime rule: do not keep this CLI turn open waiting for me. ADB Manager will keep recording evidence locally, and I will send another turn when I stop or need guidance.",
          `Your job now is to acknowledge the ${taskLabel} scope, name the highest-value evidence to collect next, and wait for future evidence in later turns.`,
        ];
  return trimForPrompt(
    [
      `I am starting a Scout ${taskLabel} task in ADB Manager.`,
      `Respond in ${responseLanguage}.`,
      ...runtimeInstructions,
      ...featureWalkthroughExternalReferenceRules(input.session.kind),
      ...featureWalkthroughReviewPromptRules(input.session.kind),
      "",
      `Goal: ${scribe.goal || "(not specified)"}`,
      input.session.kind === "walkthrough"
        ? `Target package: ${scribe.targetPackage || "(not specified; infer from the reference and device context)"}`
        : undefined,
      `UI reference URL: ${scribe.uiReferenceUrl || "(not specified)"}`,
      `Proactivity: ${scribe.intensity}`,
      `Permission level: ${scribe.permissionLevel}`,
      `Device: ${input.deviceLabel}`,
      `Serial: ${input.deviceSerial || "(none selected)"}`,
      `ADB Manager context: ${input.contextLabel}`,
      `Working directory: ${normalizeWorkingDirectory(input.session.workingDirectory) || "(not specified)"}`,
      `Current evidence count: ${input.session.artifacts.length}`,
      "",
      "Current evidence timeline:",
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
    session.kind === "walkthrough"
      ? `Target package: ${scribe.targetPackage || "(none; infer from reference and device context)"}`
      : undefined,
    `UI reference URL: ${scribe.uiReferenceUrl || "(none)"}`,
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
  const serialized = results
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
    .join("\n\n")
    .trim();
  if (serialized.length <= AGENT_TOOL_RESULT_LIMIT) return serialized;
  const marker = "...[older tool results truncated]\n\n";
  return `${marker}${serialized.slice(-(AGENT_TOOL_RESULT_LIMIT - marker.length))}`;
}

function buildAutonomousTerminalFallback(
  results: AgentToolResult[],
  terminalOutcomeLabel: string,
  t: ReturnType<typeof useTranslation>["t"],
  goal: string,
) {
  const latestResults = results.slice(-5);
  const hasUnverifiedUiAction = latestResults.some((result) =>
    isAgentUiActionTool(result.tool) && !result.ok,
  );
  const completedFromEvidence =
    terminalOutcomeLabel === "Walkthrough outcome" &&
    hasDeterministicScoutCompletionEvidence({
      results,
      goal,
    });
  return [
    t(completedFromEvidence
      ? "agent.autonomousTerminalFallbackCompleted"
      : "agent.autonomousTerminalFallbackIntro", { count: results.length }),
    t("agent.autonomousTerminalFallbackEvidence"),
    ...(latestResults.length
      ? latestResults.map((result) => `- ${result.tool}: ${result.summary}`)
      : [`- ${t("agent.autonomousTerminalFallbackNoEvidence")}`]),
    t(completedFromEvidence
      ? "agent.autonomousTerminalFallbackVerified"
      : hasUnverifiedUiAction
      ? "agent.autonomousTerminalFallbackNoProgress"
      : "agent.autonomousTerminalFallbackGap"),
    `${terminalOutcomeLabel}: ${completedFromEvidence ? "COMPLETED" : "FAILED"}`,
  ].join("\n");
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
          // Codex/Claude may serialize the same request as name/arguments even
          // when the prompt asks for tool/args. Normalize both forms so a
          // valid operation is not silently treated as a terminal answer.
          const tool = typeof item.tool === "string"
            ? item.tool
            : typeof item.name === "string"
              ? item.name
              : "";
          if (!tool.trim()) return null;
          const rawArgs = item.args ?? item.arguments;
          const args = rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs)
            ? (rawArgs as Record<string, unknown>)
            : {};
          return {
            id: typeof item.id === "string" && item.id.trim() ? item.id.trim() : `tool-${index + 1}`,
            tool: tool.trim(),
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

function formatAgentStreamPreview(output: string, t: ReturnType<typeof useTranslation>["t"]) {
  const toolRequest = extractAgentToolRequest(output);
  if (toolRequest.calls.length) {
    return [toolRequest.message, t("agent.toolCallPending")].filter(Boolean).join("\n");
  }
  const toolCallMarker = output.search(/```(?:json)?[\s\S]*?"toolCalls"|"toolCalls"\s*:/i);
  if (toolCallMarker >= 0) {
    return [output.slice(0, toolCallMarker).trim(), t("agent.toolCallPreparing")].filter(Boolean).join("\n");
  }
  return output.trim();
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
    scribe?.goal ? `- ${t("agent.scribeGoalLabel")}: ${scribe.goal}` : undefined,
    scribe?.targetPackage ? `- ${t("agent.targetPackageLabel")}: ${scribe.targetPackage}` : undefined,
    scribe?.uiReferenceUrl ? `- ${t("agent.uiReferenceUrlLabel")}: ${scribe.uiReferenceUrl}` : undefined,
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

function latestFinalReportArtifact(session: EvidenceSession): EvidenceArtifact | null {
  for (let index = session.artifacts.length - 1; index >= 0; index -= 1) {
    const artifact = session.artifacts[index];
    if (artifact.type === "agent_note" && artifact.metadata?.finalReport === true && artifact.body) {
      return artifact;
    }
  }
  return null;
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

async function collectDefaultAgentContext(
  deviceSerial: string | null,
  targetPackage: string | null,
  t: ReturnType<typeof useTranslation>["t"],
  options: { scoutTask?: boolean } = {},
) {
  if (!deviceSerial) return [];
  const results: AgentToolResult[] = [];
  if (!options.scoutTask) {
    results.push(await collectDeviceSummaryContextResult(deviceSerial, t));
    results.push(await collectPerformanceContextResult("default-performance", "performance.current_context", deviceSerial, targetPackage, t));
  }
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
    const rawAgentSample = await invoke<PerformanceSample>("adb_agent_sample", {
      deviceSerial,
      targetPackage,
      intervalMs: 1000,
    });
    agentSample = performanceAgentContextSample(rawAgentSample);
  } catch (error) {
    errors.push(`agent sample: ${String(error)}`);
  }

  try {
    streamSnapshot = await invoke<PerformanceStreamSnapshot>("adb_performance_stream_snapshot", { deviceSerial });
    adbSample = streamSnapshot.active ? streamSnapshot.last_sample : null;
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

function scoutTaskRunStateColor(state: ScoutTaskRunState) {
  switch (state) {
    case "generating_report":
      return "blue";
    case "completed":
    case "running":
      return "green";
    case "blocked":
      return "orange";
    case "stopped":
      return "orange";
    case "failed":
      return "red";
    case "not_started":
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

function formatAgentMessageTimeLabel(
  message: AgentCopilotMessage,
  t: ReturnType<typeof useTranslation>["t"],
  locale?: string,
) {
  const time = formatEvidenceTime(message.createdAt, locale);
  if (message.thinking) {
    return t("agent.messageThinkingSince", { time });
  }
  if (message.role === "user") {
    return t("agent.messageSentAt", { time });
  }
  return t("agent.messageCompletedAt", { time });
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
  if (isProtectedScoutCommand(command)) return "high";
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

function isValidAndroidPackageName(value: string) {
  return /^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+$/.test(value);
}

function numberArg(value: unknown, fallback: number, min: number, max: number) {
  const numeric = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

function requiredIntegerArg(value: unknown, label: string) {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(numeric)) throw new Error(`Missing or invalid ${label}`);
  return numeric;
}

function isAgentUiActionTool(tool: string) {
  return tool === "ui.tap" || tool === "ui.swipe" || tool === "ui.press_back";
}

function isExternalReferenceTool(tool: string) {
  return tool === "reference.feishu.fetch"
    || tool === "reference.figma.mcp_status"
    || tool === "reference.figma.login";
}

function validateAgentUiAction(tool: string, args: Record<string, unknown>) {
  try {
    if (tool === "ui.tap") {
      if (!stringArg(args.target)) return "ui.tap requires a target label from the latest ui.inspect result.";
      if (args.x !== undefined && args.x !== null && String(args.x).trim() !== "") {
        requiredIntegerArg(args.x, "x");
      }
      if (args.y !== undefined && args.y !== null && String(args.y).trim() !== "") {
        requiredIntegerArg(args.y, "y");
      }
    }
    if (tool === "ui.swipe") {
      requiredIntegerArg(args.x1, "x1");
      requiredIntegerArg(args.y1, "y1");
      requiredIntegerArg(args.x2, "x2");
      requiredIntegerArg(args.y2, "y2");
      if (!stringArg(args.purpose)) return "ui.swipe requires a purpose.";
    }
    return "";
  } catch (error) {
    return String(error);
  }
}

function describeAgentUiAction(tool: string, args: Record<string, unknown>) {
  if (tool === "ui.tap") {
    const coordinates = args.x === undefined || args.y === undefined
      ? "latest target"
      : `${requiredIntegerArg(args.x, "x")},${requiredIntegerArg(args.y, "y")}`;
    return `UI tap ${coordinates} · ${stringArg(args.target)}`;
  }
  if (tool === "ui.swipe") {
    return `UI swipe ${requiredIntegerArg(args.x1, "x1")},${requiredIntegerArg(args.y1, "y1")} → ${requiredIntegerArg(args.x2, "x2")},${requiredIntegerArg(args.y2, "y2")} · ${stringArg(args.purpose)}`;
  }
  return "UI press Back";
}

function agentUiActionRisk(
  tool: string,
  args: Record<string, unknown>,
  snapshot: AgentUiSnapshot,
): AgentApprovalRequest["risk"] {
  if (tool === "ui.press_back") return "low";
  if (tool === "ui.swipe") return "medium";
  const target = resolveUiTapTarget(args, snapshot);
  return target && isProtectedScoutUiTarget(target.label)
    ? "high"
    : "medium";
}

function validateUiActionAgainstSnapshot(
  tool: string,
  args: Record<string, unknown>,
  snapshot: AgentUiSnapshot,
  allowSensitive: boolean,
) {
  if (tool !== "ui.tap") return args;
  const target = resolveUiTapTarget(args, snapshot);
  if (!target) {
    throw new Error("The target is not available in the latest UI snapshot. Inspect the current UI and retry with the latest target label.");
  }
  if (!allowSensitive && isProtectedScoutUiTarget(target.label)) {
    throw new Error("The requested UI target is sensitive and requires explicit approval.");
  }
  return {
    ...args,
    x: target.x,
    y: target.y,
    targetResolutionConfidence: target.confidence,
  };
}

function resolveUiTapTarget(args: Record<string, unknown>, snapshot: AgentUiSnapshot) {
  return resolveScoutUiTapTarget(snapshot, {
    x: numberArg(args.x, 0, 0, Math.max(0, snapshot.width - 1)),
    y: numberArg(args.y, 0, 0, Math.max(0, snapshot.height - 1)),
    target: stringArg(args.target),
  });
}

function didUiSnapshotChange(before: AgentUiSnapshot, after: AgentUiSnapshot) {
  const signature = (snapshot: AgentUiSnapshot) =>
    snapshot.nodes
      .map((node) => `${node.text}|${node.contentDesc}|${node.resourceId}|${node.bounds}|${node.clickable}|${node.enabled}`)
      .join("\n");
  return signature(before) !== signature(after);
}

function waitForUiSettle() {
  return new Promise<void>((resolve) => window.setTimeout(resolve, 350));
}

async function invokeAgentUiAction(tool: string, args: Record<string, unknown>, deviceSerial: string): Promise<AgentUiActionResult> {
  if (tool === "ui.tap") {
    return invoke<AgentUiActionResult>("adb_ui_tap", {
      deviceSerial,
      x: requiredIntegerArg(args.x, "x"),
      y: requiredIntegerArg(args.y, "y"),
    });
  }
  if (tool === "ui.swipe") {
    return invoke<AgentUiActionResult>("adb_ui_swipe", {
      deviceSerial,
      x1: requiredIntegerArg(args.x1, "x1"),
      y1: requiredIntegerArg(args.y1, "y1"),
      x2: requiredIntegerArg(args.x2, "x2"),
      y2: requiredIntegerArg(args.y2, "y2"),
      durationMs: numberArg(args.durationMs, 320, 80, 2_000),
    });
  }
  if (tool === "ui.press_back") {
    return invoke<AgentUiActionResult>("adb_ui_press_back", { deviceSerial });
  }
  throw new Error(`Unsupported UI action: ${tool}`);
}

const COMPACT_UI_NODE_LIMIT = 20;
const COMPACT_UI_TEXT_LIMIT = 96;

function compactUiText(value: string) {
  const normalized = value.trim();
  if (normalized.length <= COMPACT_UI_TEXT_LIMIT) return normalized;
  return `${normalized.slice(0, COMPACT_UI_TEXT_LIMIT - 1)}…`;
}

function compactUiNode(node: AgentUiNode) {
  return {
    ...(node.text.trim() ? { text: compactUiText(node.text) } : {}),
    ...(node.contentDesc.trim() ? { contentDesc: compactUiText(node.contentDesc) } : {}),
    ...(node.resourceId.trim() ? { resourceId: compactUiText(node.resourceId) } : {}),
    bounds: node.bounds,
    clickable: node.clickable,
    enabled: node.enabled,
  };
}

function compactUiSnapshot(snapshot: AgentUiSnapshot | null) {
  if (!snapshot) return null;
  const indexedNodes = snapshot.nodes.map((node, index) => ({ node, index }));
  const actionable = indexedNodes.filter(({ node }) =>
    node.enabled && (node.clickable || Boolean(node.text.trim()) || Boolean(node.contentDesc.trim())),
  );
  const labeledActionable = actionable.filter(({ node }) =>
    Boolean(node.text.trim()) || Boolean(node.contentDesc.trim()) || Boolean(node.resourceId.trim()),
  );
  const labeled = indexedNodes.filter(({ node }) =>
    Boolean(node.text.trim()) || Boolean(node.contentDesc.trim()),
  );
  const selected = [...labeledActionable, ...actionable, ...labeled]
    .filter(({ index }, position, all) => all.findIndex((candidate) => candidate.index === index) === position)
    .slice(0, COMPACT_UI_NODE_LIMIT);

  return {
    width: snapshot.width,
    height: snapshot.height,
    source: snapshot.source,
    fallbackAttempted: snapshot.fallbackAttempted ?? false,
    fallbackError: snapshot.fallbackError ?? null,
    nodeCount: snapshot.nodes.length,
    actionableNodeCount: actionable.length,
    nodesTruncated: selected.length < snapshot.nodes.length,
    nodes: selected.map(({ node }) => compactUiNode(node)),
  };
}

function suggestAutonomousFallbackToolCall(
  toolResults: AgentToolResult[],
  goal: string,
  excludedTargets: ReadonlySet<string> = new Set(),
): AgentToolCall | null {
  const latestSnapshot = [...toolResults]
    .reverse()
    .map((result) => {
      if (!result.ok || !result.data || typeof result.data !== "object") return null;
      const data = result.data as { nodes?: unknown[]; snapshot?: { nodes?: unknown[] } | null };
      return result.tool === "ui.inspect" ? data : data.snapshot;
    })
    .find((snapshot): snapshot is { nodes?: unknown[] } => Boolean(snapshot?.nodes?.length));
  if (!latestSnapshot?.nodes?.length) return null;

  const nodes = latestSnapshot.nodes.filter((node): node is AgentUiNode => {
    if (!node || typeof node !== "object") return false;
    const value = node as Partial<AgentUiNode>;
    const text = typeof value.text === "string" ? value.text.trim() : "";
    const contentDesc = typeof value.contentDesc === "string" ? value.contentDesc.trim() : "";
    const canResolveToAction = Boolean(value.clickable)
      || Boolean(contentDesc)
      || Boolean(text);
    return value.enabled !== false && typeof value.bounds === "string" && canResolveToAction;
  });
  const cleanNodeValue = (value: unknown) => typeof value === "string" ? value.trim() : "";
  const labelFor = (node: AgentUiNode) => [node.text, node.contentDesc, node.resourceId]
    .map(cleanNodeValue)
    .filter(Boolean)
    .join(" ");
  const protectedLabel = /delete|remove|uninstall|reset|purchase|payment|sign[ -]?out|logout|authorize|permission|重置|删除|卸载|购买|付款|退出登录|授权|权限/i;
  const safeOverlay = nodes.find((node) => {
    const label = labelFor(node);
    const target = [node.text, node.contentDesc, node.resourceId]
      .map(cleanNodeValue)
      .find(Boolean);
    if (!target) return false;
    return !excludedTargets.has(target)
      && /close|dismiss|got it|okay|\bok\b|continue|next|skip|cancel|返回|关闭|知道了|继续|下一步|跳过|取消/i.test(label)
      && !protectedLabel.test(label);
  });
  const goalTokens = goal
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
  const goalRequestsControl = /\b(selector|switch|toggle|select|setting|mode|view)\b/i.test(goal);
  const goalTarget = nodes
    .map((node) => {
      const visibleLabel = [node.text, node.contentDesc]
        .map(cleanNodeValue)
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      const visibleTokens = visibleLabel.split(/[^a-z0-9\u4e00-\u9fff]+/i).filter(Boolean);
      const resourceSuffix = cleanNodeValue(node.resourceId).split("/").pop()?.toLowerCase() ?? "";
      const resourceTokens = resourceSuffix.split(/[^a-z0-9\u4e00-\u9fff]+/i).filter(Boolean);
      const target = [node.text, node.contentDesc, node.resourceId]
        .map(cleanNodeValue)
        .find(Boolean);
      if (!target || excludedTargets.has(target) || protectedLabel.test(labelFor(node))) {
        return null;
      }
      const exactVisible = goalTokens.some((token) => visibleTokens.includes(token));
      const partialVisible = goalTokens.some((token) => visibleLabel.includes(token));
      const exactResource = goalTokens.some((token) => resourceTokens.includes(token));
      const partialResource = goalTokens.some((token) => resourceSuffix.includes(token));
      const controlLike = /(mode|view|selector|switch|toggle|tab|radio)/i.test(resourceSuffix);
      const directional = /(left|right|prev|next|arrow|back)/i.test(resourceSuffix);
      const controlSemanticScore = goalRequestsControl
        ? (controlLike ? 12 : 0) - (directional ? 8 : 0)
        : 0;
      const score = (exactVisible ? 8 : partialVisible ? 3 : 0)
        + (exactResource ? 8 : partialResource ? 3 : 0)
        + (node.clickable ? 2 : 0)
        + (cleanNodeValue(node.contentDesc) ? 1 : 0)
        + controlSemanticScore;
      return score > 0 ? { node, score } : null;
    })
    .filter((candidate): candidate is { node: AgentUiNode; score: number } => Boolean(candidate))
    .sort((left, right) => right.score - left.score)[0]?.node ?? null;
  const targetNode = safeOverlay ?? goalTarget;
  if (!targetNode) return null;
  const target = [targetNode.text, targetNode.contentDesc, targetNode.resourceId]
    .map(cleanNodeValue)
    .find(Boolean);
  if (!target) return null;
  return {
    id: `autonomous-fallback-${Date.now()}`,
    tool: "ui.tap",
    args: {
      target,
      reason: "Continue the walkthrough through a safe, reversible target after the Agent returned no tool request.",
    },
  };
}

function formatAppLaunchEvidence(app: LaunchableApp, output: string, snapshot: AgentUiSnapshot | null) {
  return [
    `Action: launch app`,
    `Package: ${app.package_name}`,
    `Component: ${app.component_name}`,
    `Output: ${output || "(none)"}`,
    `Visible UI nodes after launch: ${snapshot?.nodes.length ?? 0}`,
    snapshot?.nodes.length ? `UI: ${JSON.stringify(compactUiSnapshot(snapshot))}` : undefined,
  ]
    .filter(Boolean)
    .join("\n");
}

function formatUiActionEvidence(
  action: AgentUiActionResult,
  args: Record<string, unknown>,
  snapshot: AgentUiSnapshot | null,
  verified: boolean,
) {
  return [
    `Action: ${action.action}`,
    `Coordinates: ${JSON.stringify(args)}`,
    args.targetResolutionConfidence ? `Target resolution: ${args.targetResolutionConfidence}` : undefined,
    `Display: ${action.width}x${action.height}`,
    `Control channel: ${action.source}`,
    `Verification: ${verified ? "UI changed" : "no observable UI change"}`,
    `Visible UI nodes after action: ${snapshot?.nodes.length ?? 0}`,
    snapshot?.nodes.length ? `UI: ${JSON.stringify(compactUiSnapshot(snapshot))}` : undefined,
  ]
    .filter(Boolean)
    .join("\n");
}

function trimForPrompt(value: string, limit: number) {
  const trimmed = value.trim();
  if (trimmed.length <= limit) return trimmed;
  return `${trimmed.slice(0, limit)}\n...[truncated]`;
}

function trimAgentConversationPrompt(value: string, limit: number) {
  const trimmed = value.trim();
  if (trimmed.length <= limit) return trimmed;
  const marker = "\n...[middle context truncated; authoritative task context and current task message are preserved]...\n";
  const available = Math.max(limit - marker.length, 0);
  const headLength = Math.ceil(available * 0.56);
  const tailLength = available - headLength;
  return `${trimmed.slice(0, headLength)}${marker}${trimmed.slice(-tailLength)}`;
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
  let previewKind: AgentCopilotAttachment["previewKind"] | undefined;
  let previewDataUrl: string | undefined;
  const name = attachmentNameForFile(file);
  if (isTextLike(file) && file.size <= ATTACHMENT_TEXT_READ_LIMIT) {
    try {
      textPreview = (await file.text()).slice(0, ATTACHMENT_TEXT_LIMIT);
    } catch {
      textPreview = undefined;
    }
  } else if (isImageLikeFile(file, name) && file.size <= ATTACHMENT_IMAGE_PREVIEW_READ_LIMIT) {
    try {
      previewKind = "image";
      previewDataUrl = await fileToDataUrl(file);
    } catch {
      previewKind = undefined;
      previewDataUrl = undefined;
    }
  }
  return {
    id: `att-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name,
    mimeType: file.type,
    sizeBytes: file.size,
    textPreview,
    previewKind,
    previewDataUrl,
    createdAt: Date.now(),
  };
}

function attachmentFromFilePayload(payload: AgentAttachmentFilePayload): AgentCopilotAttachment {
  return {
    id: `att-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name: payload.name || "attachment",
    mimeType: payload.mimeType || "",
    sizeBytes: payload.sizeBytes || 0,
    textPreview: payload.textPreview ?? undefined,
    previewKind: payload.previewKind ?? undefined,
    previewDataUrl: payload.previewDataUrl ?? undefined,
    sourcePath: payload.sourcePath ?? undefined,
    createdAt: Date.now(),
  };
}

function attachmentNameForFile(file: File) {
  const trimmed = file.name.trim();
  if (trimmed) return trimmed;
  const extension = extensionForMimeType(file.type);
  return `clipboard-${new Date().toISOString().replace(/[:.]/g, "-")}.${extension}`;
}

function extensionForMimeType(mimeType: string) {
  switch (mimeType.toLowerCase()) {
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "image/bmp":
      return "bmp";
    case "text/plain":
      return "txt";
    default:
      return "file";
  }
}

function isTextLike(file: File) {
  return (
    file.type.startsWith("text/") ||
    /\.(txt|md|markdown|json|jsonl|log|csv|xml|yaml|yml|ini|properties)$/i.test(file.name)
  );
}

function isImageLikeFile(file: File, name = file.name) {
  return file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(name);
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("image preview read returned no data"));
      }
    };
    reader.onerror = () => reject(reader.error ?? new Error("image preview read failed"));
    reader.readAsDataURL(file);
  });
}

function filesFromClipboardData(clipboard: DataTransfer) {
  const files: File[] = [];
  const seen = new Set<string>();
  const pushFile = (file: File | null) => {
    if (!file) return;
    const signature = `${file.name}:${file.type}:${file.size}:${file.lastModified}`;
    if (seen.has(signature)) return;
    seen.add(signature);
    files.push(file);
  };

  Array.from(clipboard.files ?? []).forEach(pushFile);
  Array.from(clipboard.items ?? []).forEach((item) => {
    if (item.kind === "file") pushFile(item.getAsFile());
  });

  return files;
}

function clipboardPathCandidates(clipboard: DataTransfer) {
  const candidates: string[] = [];
  const pushLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    if (trimmed.startsWith("file://") || trimmed.startsWith("/") || /^[A-Za-z]:[\\/]/.test(trimmed)) {
      candidates.push(safeDecodeUri(trimmed));
    }
  };

  clipboard.getData("text/uri-list").split(/\r?\n/).forEach(pushLine);
  clipboard.getData("text/plain").split(/\r?\n/).forEach(pushLine);

  return Array.from(new Set(candidates));
}

function hasNativeFileClipboardSignal(clipboard: DataTransfer) {
  return Array.from(clipboard.types).some((type) =>
    ["Files", "public.file-url", "text/uri-list", "application/x-moz-file"].includes(type),
  );
}

function looksLikePastedFilename(value: string) {
  const trimmed = value.trim();
  return (
    Boolean(trimmed) &&
    !/[\n\r/\\]/.test(trimmed) &&
    /^[\w .()[\]@+-]+\.(png|jpe?g|webp|gif|bmp|svg|txt|md|markdown|json|jsonl|log|csv|xml|yaml|yml|ini|properties|pdf|zip|apk)$/i.test(
      trimmed,
    )
  );
}

function safeDecodeUri(value: string) {
  try {
    return decodeURI(value);
  } catch {
    return value;
  }
}

function insertTextIntoDraftAtSelection(
  text: string,
  selectionStart: number | null,
  selectionEnd: number | null,
  textarea: HTMLTextAreaElement,
  setDraftValue: (update: (current: string) => string) => void,
) {
  let cursorPosition = selectionStart ?? 0;
  setDraftValue((current) => {
    const start = Math.min(selectionStart ?? current.length, current.length);
    cursorPosition = start + text.length;
    return insertTextAtSelection(current, text, selectionStart, selectionEnd);
  });
  window.requestAnimationFrame(() => {
    textarea.focus();
    textarea.setSelectionRange(cursorPosition, cursorPosition);
  });
}

function insertTextAtSelection(current: string, text: string, selectionStart: number | null, selectionEnd: number | null) {
  const start = Math.min(selectionStart ?? current.length, current.length);
  const end = Math.min(selectionEnd ?? start, current.length);
  return `${current.slice(0, start)}${text}${current.slice(end)}`;
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
    }
  | {
      kind: "url";
      text: string;
    };

function messageDocumentParts(body: string): MessagePart[] {
  const pattern = /\b((?:docs|agent-android|graphify-out)\/[A-Za-z0-9_./-]+\.(?:md|markdown|txt|json|csv|log))\b|\b(https:\/\/[^\s<>()]+)/g;
  const parts: MessagePart[] = [];
  let lastIndex = 0;
  for (const match of body.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      parts.push({ kind: "text", text: body.slice(lastIndex, index) });
    }
    const text = match[1] || match[2];
    parts.push({ kind: match[1] ? "document" : "url", text });
    lastIndex = index + text.length;
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

async function openMessageUrl(url: string) {
  try {
    await invoke("open_external_url", { url });
  } catch {
    // The native command enforces the external URL allowlist.
  }
}

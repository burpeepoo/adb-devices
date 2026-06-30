import {
  ActionIcon,
  Badge,
  Button,
  Code,
  Divider,
  Group,
  Paper,
  Progress,
  ScrollArea,
  Select,
  Stack,
  Text,
  Textarea,
  Title,
  Tooltip,
} from "@mantine/core";
import {
  IconPaperclip,
  IconPlus,
  IconRobot,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { invoke } from "@tauri-apps/api/core";
import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { normalizeAgentCliSettings, resolveAgentCliProfile } from "../agentCliSettings";
import { findAndroidAgentSkill, recommendAndroidAgentSkill } from "../androidAgentSkills";
import type { DeviceTargetState } from "../deviceTarget";
import { getStore, saveStoreValue, STORE_KEYS } from "../storage";
import type {
  AgentCopilotAttachment,
  AgentCopilotMessage,
  AgentCopilotSession,
  AgentCliProfile,
  AndroidAgentSkill,
  AppSettings,
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

interface AgentProgressState {
  sessionId: string;
  label: string;
  completed: number;
  total: number;
}

interface EvidenceStepResult {
  id: string;
  title: string;
  why: string;
  ok: boolean;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

const SESSION_LIMIT = 250;
const OUTPUT_LIMIT = 3600;
const ATTACHMENT_LIMIT = 8;
const ATTACHMENT_TEXT_LIMIT = 2400;
const ATTACHMENT_TEXT_READ_LIMIT = 512 * 1024;
const SUGGESTED_PROMPT_LIMIT = 5;
const AGENT_CLI_EVIDENCE_LIMIT = 14000;
const AGENT_CLI_STEP_LIMIT = 3200;
const AGENT_ANALYSIS_OUTPUT_LIMIT = 6000;

export default function AgentCopilot({ deviceTarget, settings, onSettingsChange }: Props) {
  const { t, i18n } = useTranslation();
  const [sessions, setSessions] = useState<AgentCopilotSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<AgentCopilotAttachment[]>([]);
  const [running, setRunning] = useState(false);
  const [agentProgress, setAgentProgress] = useState<AgentProgressState | null>(null);
  const [suggestionSeed, setSuggestionSeed] = useState(() => newPromptSuggestionSeed());
  const sessionsRef = useRef<AgentCopilotSession[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? null;
  const deviceKey = deviceTarget.identity || deviceTarget.serial || null;
  const agentCli = normalizeAgentCliSettings(settings.agentCli);
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
  const activeSkill = activeSession ? findAndroidAgentSkill(activeSession.skillId) : recommendedSkill;
  const promptSuggestionPool = useMemo(
    () => normalizePromptSuggestions(t("agent.promptSuggestions", { returnObjects: true }) as unknown),
    [i18n.resolvedLanguage, t],
  );
  const visiblePromptSuggestions = useMemo(
    () => pickRandomPromptSuggestions(promptSuggestionPool, suggestionSeed, SUGGESTED_PROMPT_LIMIT),
    [promptSuggestionPool, suggestionSeed],
  );
  const activeAgentProgress = agentProgress?.sessionId === activeSessionId ? agentProgress : null;

  const refreshPromptSuggestions = useCallback(() => {
    setSuggestionSeed(newPromptSuggestionSeed());
  }, []);

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

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

  const commitSessions = useCallback(async (nextSessions: AgentCopilotSession[]) => {
    const bounded = nextSessions
      .slice()
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, SESSION_LIMIT);
    sessionsRef.current = bounded;
    setSessions(bounded);
    await saveStoreValue(STORE_KEYS.agentCopilotSessions, bounded).catch(() => undefined);
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
        title: title?.trim() || skillLabel(skill, t),
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
              skill: skillLabel(skill, t),
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

  const collectEvidence = useCallback(
    async (sessionId: string, skill: AndroidAgentSkill, prompt: string) => {
      if (running) return;
      const progressTotal = skill.steps.length + (cliConfigured ? 1 : 0);
      setRunning(true);
      setAgentProgress({
        sessionId,
        label: t("agent.progressPlanning"),
        completed: 0,
        total: progressTotal,
      });

      try {
        if (!deviceTarget.serial) {
          await appendMessage(sessionId, {
            id: `msg-${Date.now()}-assistant`,
            role: "assistant",
            body: t("agent.deviceRequired"),
            createdAt: Date.now(),
            skillId: skill.id,
          });
          return;
        }

        const stepResults: EvidenceStepResult[] = [];
        for (const [index, step] of skill.steps.entries()) {
          setAgentProgress({
            sessionId,
            label: t("agent.progressStep", {
              current: index + 1,
              total: skill.steps.length,
              title: step.title,
            }),
            completed: index,
            total: progressTotal,
          });
          const stepStarted = Date.now();
          try {
            const result = await invoke<WorkbenchCommandResult>("adb_workbench_execute", {
              command: step.command,
              deviceSerial: deviceTarget.serial,
              allowHighRisk: false,
            });
            const ok = (result.exit_code ?? 0) === 0 && !result.stderr.toLowerCase().includes("error:");
            stepResults.push({
              id: step.id,
              title: step.title,
              why: step.why,
              ok,
              command: result.command,
              stdout: result.stdout,
              stderr: result.stderr,
              exitCode: result.exit_code,
            });
            await appendMessage(sessionId, {
              id: `msg-${stepStarted}-command`,
              role: "command",
              body: formatCommandResult(step.title, step.why, result),
              createdAt: stepStarted,
              skillId: skill.id,
              command: result.command,
              ok,
            });
          } catch (error) {
            stepResults.push({
              id: step.id,
              title: step.title,
              why: step.why,
              ok: false,
              command: step.command,
              stdout: "",
              stderr: String(error),
              exitCode: null,
            });
            await appendMessage(sessionId, {
              id: `msg-${stepStarted}-command`,
              role: "command",
              body: `${step.title}\n${step.why}\n\n${String(error)}`,
              createdAt: stepStarted,
              skillId: skill.id,
              command: step.command,
              ok: false,
            });
          }
          setAgentProgress({
            sessionId,
            label: t("agent.progressStep", {
              current: index + 1,
              total: skill.steps.length,
              title: step.title,
            }),
            completed: index + 1,
            total: progressTotal,
          });
        }

        let finalMessage = buildEvidenceAnalysisMessage(skill, stepResults, t);
        if (cliConfigured) {
          setAgentProgress({
            sessionId,
            label: t("agent.progressAnalyzing", { cli: cliProfile.name }),
            completed: skill.steps.length,
            total: progressTotal,
          });
          finalMessage = await buildAgentCliFinalMessage(
            skill,
            prompt,
            stepResults,
            cliProfile,
            finalMessage,
            i18n.resolvedLanguage || i18n.language,
            t,
          );
          setAgentProgress({
            sessionId,
            label: t("agent.progressAnalyzing", { cli: cliProfile.name }),
            completed: progressTotal,
            total: progressTotal,
          });
        }

        await appendMessage(sessionId, {
          id: `msg-${Date.now()}-assistant`,
          role: "assistant",
          body: finalMessage,
          createdAt: Date.now(),
          skillId: skill.id,
        });
      } finally {
        setRunning(false);
        setAgentProgress(null);
      }
    },
    [appendMessage, cliConfigured, cliProfile, deviceTarget.serial, i18n.language, i18n.resolvedLanguage, running, t],
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
    await appendMessage(session.id, {
      id: `msg-${now + 1}-assistant`,
      role: "assistant",
      body: buildPlanMessage(skill, prompt, attachments, deviceTarget, cliProfile.name, cliConfigured, t),
      createdAt: now + 1,
      skillId: skill.id,
    });
    await collectEvidence(session.id, skill, prompt);
  }, [
    activeSession,
    appendMessage,
    cliConfigured,
    cliProfile.name,
    collectEvidence,
    createSession,
    deviceTarget,
    draft,
    pendingAttachments,
    running,
    t,
    updateSessionSkill,
  ]);

  const handlePrompt = useCallback(async () => {
    await submitPrompt();
  }, [submitPrompt]);

  const handleSuggestedPrompt = useCallback(
    async (prompt: string) => {
      setDraft(prompt);
      await submitPrompt(prompt);
    },
    [submitPrompt],
  );

  return (
    <div style={{ height: "100%", minHeight: 0, display: "grid", gridTemplateColumns: "280px minmax(0, 1fr)", gap: 16 }}>
      <Paper withBorder radius="md" p="sm" style={{ minHeight: 0, display: "flex", flexDirection: "column" }}>
        <Group justify="space-between" gap="xs" mb="sm" wrap="nowrap">
          <Group gap="xs" wrap="nowrap" style={{ minWidth: 0, flex: 1 }}>
            <IconRobot size={18} style={{ flex: "0 0 auto" }} />
            <Title order={4} style={{ minWidth: 0, lineHeight: 1.25 }}>
              {t("agent.title")}
            </Title>
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

        <Group className="agent-copilot-badge-row" gap={8} mb="sm" wrap="wrap">
          <Badge size="sm" color="violet" variant="light">
            {t("agent.lab")}
          </Badge>
          <Badge size="sm" color="blue" variant="light">
            {t("agent.autoSkill")}
          </Badge>
        </Group>

        <ScrollArea style={{ flex: 1 }}>
          <Stack gap={6}>
            {sessions.map((session) => (
              <div
                key={session.id}
                role="button"
                tabIndex={0}
                onClick={() => setActiveSessionId(session.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setActiveSessionId(session.id);
                  }
                }}
                style={{
                  border: "1px solid var(--mantine-color-gray-3)",
                  borderRadius: 8,
                  background: activeSessionId === session.id ? "var(--mantine-color-blue-0)" : "transparent",
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
                  {skillLabel(findAndroidAgentSkill(session.skillId), t)}
                </Text>
              </div>
            ))}
          </Stack>
        </ScrollArea>
      </Paper>

      <Paper withBorder radius="md" p="md" style={{ minHeight: 0, display: "flex", flexDirection: "column" }}>
        <Group justify="space-between" gap="sm" wrap="nowrap">
          <Stack gap={2} style={{ minWidth: 0 }}>
            <Group gap="xs" wrap="nowrap">
              <Title order={3}>{activeSession?.title || skillLabel(recommendedSkill, t)}</Title>
              {activeSkill.requiresAgentApk ? (
                <Badge color="blue" variant="light">
                  {t("agent.agentApk")}
                </Badge>
              ) : null}
              <Badge color="gray" variant="light">
                {skillLabel(activeSkill, t)}
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

        <Divider my="sm" />

        {activeAgentProgress ? (
          <Stack gap={4} mb="sm" aria-live="polite">
            <Group justify="space-between" gap="xs" wrap="nowrap">
              <Text size="xs" fw={700} c="blue">
                {activeAgentProgress.label}
              </Text>
              <Text size="xs" c="dimmed">
                {activeAgentProgress.completed} / {activeAgentProgress.total}
              </Text>
            </Group>
            <Progress
              value={progressPercent(activeAgentProgress)}
              size="sm"
              radius="xl"
              animated={activeAgentProgress.completed < activeAgentProgress.total}
              striped={activeAgentProgress.completed < activeAgentProgress.total}
            />
          </Stack>
        ) : null}

        <Group align="end" gap="sm" wrap="nowrap" mb="sm">
          <Select
            label={t("agent.deviceCliOverride")}
            value={deviceKey ? agentCli.perDeviceProfileIds[deviceKey] || "__global__" : "__global__"}
            onChange={updateCurrentDeviceProfile}
            data={[{ value: "__global__", label: t("agent.cliUseGlobal") }, ...profileOptions]}
            disabled={!deviceKey}
            style={{ flex: 1 }}
          />
          <Text size="xs" c="dimmed" style={{ flex: 1, paddingBottom: 8 }}>
            {t("agent.contextLine", {
              device: deviceTarget.label || t("agent.noDevice"),
              cli: cliConfigured ? cliProfile.name : t("agent.cliMissing"),
            })}
          </Text>
        </Group>

        <ScrollArea style={{ flex: 1 }}>
          <Stack gap="sm" pr="xs">
            {(activeSession?.messages ?? []).map((message) => (
              <MessageBubble key={message.id} message={message} />
            ))}
            {!activeSession ? (
              <Paper withBorder radius="md" p="md">
                <Text size="sm" fw={700}>{skillLabel(recommendedSkill, t)}</Text>
                <Text size="sm" c="dimmed">{skillSummary(recommendedSkill, t)}</Text>
              </Paper>
            ) : null}
          </Stack>
        </ScrollArea>

        <Stack gap="xs" mt="sm">
          {visiblePromptSuggestions.length ? (
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
          ) : null}
          {pendingAttachments.length ? (
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
          ) : null}
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
              style={{ flex: 1 }}
            />
            <Button onClick={() => void handlePrompt()} disabled={running || (!draft.trim() && pendingAttachments.length === 0)}>
              {t("agent.send")}
            </Button>
          </Group>
        </Stack>
      </Paper>
    </div>
  );
}

function MessageBubble({ message }: { message: AgentCopilotMessage }) {
  const { t } = useTranslation();
  const align = message.role === "user" ? "flex-end" : "flex-start";
  const color =
    message.role === "user"
      ? "var(--mantine-color-blue-0)"
      : message.role === "command"
        ? "var(--mantine-color-gray-0)"
        : "var(--mantine-color-white)";
  return (
    <Group justify={align}>
      <Paper
        withBorder
        radius="md"
        p="sm"
        style={{
          maxWidth: message.role === "command" ? "100%" : "78%",
          width: message.role === "command" ? "100%" : undefined,
          background: color,
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
        <MessageText body={message.body} />
        {message.attachments?.length ? (
          <Stack gap={4} mt="xs">
            {message.attachments.map((attachment) => (
              <Paper key={attachment.id} withBorder radius="sm" p={6} bg="gray.0">
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
              color: "var(--mantine-color-blue-6)",
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

function progressPercent(progress: AgentProgressState) {
  if (progress.total <= 0) return 8;
  return Math.max(8, Math.min(100, (progress.completed / progress.total) * 100));
}

function buildPlanMessage(
  skill: AndroidAgentSkill,
  prompt: string,
  attachments: AgentCopilotAttachment[],
  deviceTarget: DeviceTargetState,
  cliName: string,
  cliConfigured: boolean,
  t: ReturnType<typeof useTranslation>["t"],
) {
  const steps = skill.steps.map((step, index) => `${index + 1}. ${step.title} - ${step.why}`).join("\n");
  const attachmentSummary = attachments.length
    ? attachments.map((attachment) => `- ${attachment.name} (${formatBytes(attachment.sizeBytes)})`).join("\n")
    : t("agent.noAttachments");
  return t("agent.planMessage", {
    prompt,
    skill: skillLabel(skill, t),
    device: deviceTarget.label || t("agent.noDevice"),
    cli: cliConfigured ? cliName : t("agent.cliMissing"),
    attachments: attachmentSummary,
    steps,
  });
}

function buildEvidenceAnalysisMessage(
  skill: AndroidAgentSkill,
  stepResults: EvidenceStepResult[],
  t: ReturnType<typeof useTranslation>["t"],
) {
  if (!stepResults.length) {
    return [
      t("agent.analysisTitle"),
      "",
      t("agent.analysisConclusion"),
      `- ${t("agent.analysisNoEvidence")}`,
    ].join("\n");
  }
  if (skill.id === "device_report") {
    return buildDeviceReportAnalysis(stepResults, t);
  }
  return buildGenericEvidenceAnalysis(skill, stepResults, t);
}

function buildDeviceReportAnalysis(
  stepResults: EvidenceStepResult[],
  t: ReturnType<typeof useTranslation>["t"],
) {
  const identity = evidenceById(stepResults, "identity");
  const display = evidenceById(stepResults, "display");
  const resources = evidenceById(stepResults, "resources");
  const packages = evidenceById(stepResults, "packages");
  const serial = parseKeyValue(identity?.stdout, "serial");
  const model = parseKeyValue(identity?.stdout, "model");
  const android = parseKeyValue(identity?.stdout, "android");
  const sdk = parseKeyValue(identity?.stdout, "sdk");
  const fingerprint = parseKeyValue(identity?.stdout, "fingerprint");
  const size = firstMatch(display?.stdout, /(?:Physical|Override) size:\s*([^\n]+)/i);
  const density = firstMatch(display?.stdout, /(?:Physical|Override) density:\s*([^\n]+)/i);
  const displayState = firstMatch(display?.stdout, /\bstate(?:=|\s+)(ON|OFF|DOZE|UNKNOWN)\b/i);
  const storage = parseDataStorage(resources?.stdout);
  const memory = parseMemory(resources?.stdout);
  const battery = parseBattery(resources?.stdout);
  const packageInventory = parsePackageInventory(packages?.stdout, t);
  const conclusion = compactLines([
    model || android || sdk
      ? `- ${t("agent.analysisDeviceLine", {
          model: model || t("agent.analysisUnknown"),
          android: android || t("agent.analysisUnknown"),
          sdk: sdk || t("agent.analysisUnknown"),
        })}`
      : undefined,
    serial ? `- ${t("agent.analysisSerialLine", { serial })}` : undefined,
    size || density || displayState
      ? `- ${t("agent.analysisDisplayLine", {
          size: size || t("agent.analysisUnknown"),
          density: density || t("agent.analysisUnknown"),
          state: displayState || t("agent.analysisUnknown"),
        })}`
      : undefined,
    storage
      ? `- ${t("agent.analysisStorageLine", {
          used: storage.used,
          total: storage.total,
          available: storage.available,
          percent: storage.percent,
        })}`
      : undefined,
    memory
      ? `- ${t("agent.analysisMemoryLine", {
          available: memory.available,
          total: memory.total,
        })}`
      : undefined,
    battery
      ? `- ${t("agent.analysisBatteryLine", {
          level: battery.level,
          temperature: battery.temperature,
          status: battery.status || t("agent.analysisUnknown"),
        })}`
      : undefined,
    packageInventory ? `- ${packageInventory.summary}` : undefined,
  ]);
  const attention = buildDeviceReportAttention(storage, memory, battery, packageInventory, t);
  const evidence = compactLines([
    serial || model || android || sdk
      ? `- ${compactLines([
          serial ? `serial=${serial}` : undefined,
          model ? `model=${model}` : undefined,
          android ? `android=${android}` : undefined,
          sdk ? `sdk=${sdk}` : undefined,
        ]).join(", ")}`
      : undefined,
    fingerprint ? `- fingerprint=${fingerprint}` : undefined,
    storage?.raw ? `- ${storage.raw}` : undefined,
    memory?.raw ? `- ${memory.raw}` : undefined,
    packageInventory ? `- ${t("agent.analysisPackageEvidence", { count: packageInventory.count })}` : undefined,
    ...extractImportantEvidenceLines(stepResults, 5).map((line) => `- ${line}`),
  ]);
  const fallbackConclusion = `- ${t("agent.analysisNoStructuredData")}`;
  return [
    t("agent.analysisTitle"),
    "",
    t("agent.analysisConclusion"),
    ...(conclusion.length ? conclusion : [fallbackConclusion]),
    "",
    t("agent.analysisAttention"),
    ...(attention.length ? attention : [`- ${t("agent.analysisNoObviousRisk")}`]),
    "",
    t("agent.analysisKeyEvidence"),
    ...(evidence.length ? evidence : [`- ${t("agent.analysisNoEvidence")}`]),
  ].join("\n");
}

function buildGenericEvidenceAnalysis(
  skill: AndroidAgentSkill,
  stepResults: EvidenceStepResult[],
  t: ReturnType<typeof useTranslation>["t"],
) {
  const failed = stepResults.filter((result) => !result.ok);
  const importantLines = extractImportantEvidenceLines(stepResults, 12);
  const conclusion = compactLines([
    failed.length
      ? `- ${t("agent.analysisFailedSteps", {
          count: failed.length,
          titles: failed.map((result) => result.title).join(", "),
        })}`
      : undefined,
    importantLines.length
      ? `- ${t("agent.analysisFoundSignals", { count: importantLines.length })}`
      : `- ${t("agent.analysisNoObviousRisk")}`,
    `- ${t("agent.analysisSkillContext", { skill: skillLabel(skill, t) })}`,
  ]);
  return [
    t("agent.analysisTitle"),
    "",
    t("agent.analysisConclusion"),
    ...conclusion,
    "",
    t("agent.analysisKeyEvidence"),
    ...(importantLines.length ? importantLines.map((line) => `- ${line}`) : [`- ${t("agent.analysisNoEvidence")}`]),
    "",
    t("agent.analysisNextActions"),
    ...buildNextActions(failed, importantLines, t),
  ].join("\n");
}

async function buildAgentCliFinalMessage(
  skill: AndroidAgentSkill,
  userPrompt: string,
  stepResults: EvidenceStepResult[],
  cliProfile: AgentCliProfile,
  fallbackAnalysis: string,
  locale: string,
  t: ReturnType<typeof useTranslation>["t"],
) {
  try {
    const prompt = buildAgentCliAnalysisPrompt(skill, userPrompt, stepResults, fallbackAnalysis, locale);
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
    return `${fallbackAnalysis}\n\n${t("agent.analysisCliUnavailable", {
      cli: cliProfile.name,
      reason: truncateAgentAnalysis(reason),
    })}`;
  } catch (error) {
    return `${fallbackAnalysis}\n\n${t("agent.analysisCliUnavailable", {
      cli: cliProfile.name,
      reason: String(error),
    })}`;
  }
}

function buildAgentCliAnalysisPrompt(
  skill: AndroidAgentSkill,
  userPrompt: string,
  stepResults: EvidenceStepResult[],
  fallbackAnalysis: string,
  locale: string,
) {
  const responseLanguage = locale.toLowerCase().startsWith("zh") ? "Chinese" : "English";
  return [
    "You are Android Device Copilot's analysis agent.",
    `Respond in ${responseLanguage}.`,
    "Write the final message that should appear in the user conversation.",
    "Do not output a step-completion checklist, command-running narration, or template path.",
    "Ground every conclusion in the provided stdout/stderr evidence. If evidence is missing, say what is unknown.",
    "Prefer concise sections for conclusion, important evidence, risks, and next actions.",
    "",
    `User request: ${userPrompt}`,
    `Selected diagnostic skill: ${skill.title} (${skill.id})`,
    "",
    "Collected evidence:",
    serializeEvidenceForAgent(stepResults),
    "",
    "Built-in deterministic analysis for reference. Use it only as a sanity check, not as a substitute for reasoning:",
    fallbackAnalysis,
  ].join("\n");
}

function serializeEvidenceForAgent(stepResults: EvidenceStepResult[]) {
  const blocks = stepResults.map((result, index) =>
    [
      `## Evidence ${index + 1}: ${result.title}`,
      `Purpose: ${result.why}`,
      `Command: ${result.command}`,
      `Exit code: ${result.exitCode ?? "unknown"}`,
      `Status: ${result.ok ? "ok" : "needs review"}`,
      "stdout:",
      trimForPrompt(result.stdout, AGENT_CLI_STEP_LIMIT) || "(empty)",
      "stderr:",
      trimForPrompt(result.stderr, AGENT_CLI_STEP_LIMIT) || "(empty)",
    ].join("\n"),
  );
  return trimForPrompt(blocks.join("\n\n"), AGENT_CLI_EVIDENCE_LIMIT);
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

interface ParsedStorage {
  total: string;
  used: string;
  available: string;
  percent: string;
  percentValue: number | null;
  raw: string;
}

interface ParsedMemory {
  total: string;
  available: string;
  availableRatio: number | null;
  raw: string;
}

interface ParsedBattery {
  level: string;
  temperature: string;
  temperatureCelsius: number | null;
  status: string;
}

interface ParsedPackageInventory {
  count: number;
  present: string[];
  missing: string[];
  summary: string;
}

function evidenceById(stepResults: EvidenceStepResult[], id: string) {
  return stepResults.find((result) => result.id === id);
}

function parseKeyValue(text: string | undefined, key: string) {
  return firstMatch(text, new RegExp(`^${escapeRegExp(key)}=(.*)$`, "im"))?.trim();
}

function firstMatch(text: string | undefined, pattern: RegExp) {
  return text?.match(pattern)?.[1]?.trim();
}

function parseDataStorage(text: string | undefined): ParsedStorage | null {
  const line = textLines(text).find((item) => /\s\/data$/.test(item) || /\s\/data\s*$/.test(item));
  if (!line) return null;
  const parts = line.trim().split(/\s+/);
  if (parts.length < 6) return null;
  return {
    total: parts[1],
    used: parts[2],
    available: parts[3],
    percent: parts[4],
    percentValue: Number.parseInt(parts[4], 10),
    raw: shortenEvidenceLine(line),
  };
}

function parseMemory(text: string | undefined): ParsedMemory | null {
  const totalKb = numberMatch(text, /MemTotal:\s+(\d+)\s+kB/i);
  const availableKb = numberMatch(text, /MemAvailable:\s+(\d+)\s+kB/i);
  if (totalKb !== null && availableKb !== null) {
    return {
      total: formatMib(totalKb / 1024),
      available: formatMib(availableKb / 1024),
      availableRatio: availableKb / totalKb,
      raw: `MemAvailable=${formatMib(availableKb / 1024)} / MemTotal=${formatMib(totalKb / 1024)}`,
    };
  }
  const memLine = textLines(text).find((line) => /^Mem:\s+/i.test(line));
  if (!memLine) return null;
  const parts = memLine.trim().split(/\s+/);
  const total = Number.parseFloat(parts[1] || "");
  const available = Number.parseFloat(parts[6] || parts[3] || "");
  if (!Number.isFinite(total) || !Number.isFinite(available)) return null;
  return {
    total: formatMib(total),
    available: formatMib(available),
    availableRatio: total > 0 ? available / total : null,
    raw: shortenEvidenceLine(memLine),
  };
}

function parseBattery(text: string | undefined): ParsedBattery | null {
  const level = firstMatch(text, /^\s*level:\s*(\d+)/im);
  const temperatureRaw = numberMatch(text, /^\s*temperature:\s*(-?\d+)/im);
  const status = firstMatch(text, /^\s*status:\s*([^\n]+)/im);
  if (!level && temperatureRaw === null && !status) return null;
  const temperatureCelsius = temperatureRaw === null ? null : temperatureRaw / 10;
  return {
    level: level ? `${level}%` : "-",
    temperature: temperatureCelsius === null ? "-" : `${temperatureCelsius.toFixed(1)} C`,
    temperatureCelsius,
    status: status || "",
  };
}

function parsePackageInventory(
  text: string | undefined,
  t: ReturnType<typeof useTranslation>["t"],
): ParsedPackageInventory | null {
  const packageLines = textLines(text).filter((line) => /^package:/i.test(line));
  if (!packageLines.length) return null;
  const categories = [
    { label: "Cozyla", pattern: /cozyla|elclcd/i },
    { label: "Launcher", pattern: /launcher|quickstep/i },
    { label: "Calendar", pattern: /calendar/i },
    { label: "Google/GMS", pattern: /google|gms|gsf|vending|play/i },
  ];
  const present = categories
    .filter((category) => packageLines.some((line) => category.pattern.test(line)))
    .map((category) => category.label);
  const missing = categories
    .filter((category) => !packageLines.some((line) => category.pattern.test(line)))
    .map((category) => category.label);
  return {
    count: packageLines.length,
    present,
    missing,
    summary: t("agent.analysisPackageLine", {
      count: packageLines.length,
      present: present.join(", ") || t("agent.analysisNone"),
      missing: missing.join(", ") || t("agent.analysisNone"),
    }),
  };
}

function buildDeviceReportAttention(
  storage: ParsedStorage | null,
  memory: ParsedMemory | null,
  battery: ParsedBattery | null,
  packageInventory: ParsedPackageInventory | null,
  t: ReturnType<typeof useTranslation>["t"],
) {
  return compactLines([
    storage?.percentValue !== null && storage?.percentValue !== undefined && storage.percentValue >= 85
      ? `- ${t("agent.analysisStorageRisk", { percent: storage.percent })}`
      : undefined,
    memory?.availableRatio !== null && memory?.availableRatio !== undefined && memory.availableRatio < 0.15
      ? `- ${t("agent.analysisMemoryRisk", { available: memory.available, total: memory.total })}`
      : undefined,
    battery?.temperatureCelsius !== null &&
    battery?.temperatureCelsius !== undefined &&
    battery.temperatureCelsius >= 45
      ? `- ${t("agent.analysisBatteryRisk", { temperature: battery.temperature })}`
      : undefined,
    packageInventory?.missing.length
      ? `- ${t("agent.analysisPackageMissing", { missing: packageInventory.missing.join(", ") })}`
      : undefined,
  ]);
}

function extractImportantEvidenceLines(stepResults: EvidenceStepResult[], limit: number) {
  const pattern =
    /(fatal|exception|anr|crash|error|denied|not found|failed|timeout|low|thermal|mCurrentFocus|ResumedActivity|topResumedActivity|Display|SurfaceFlinger|Package|Sync|JobStatus|Wi-?Fi|Network|inet\b|Mem:|MemAvailable|\/data|level:|temperature:|package:)/i;
  const seen = new Set<string>();
  const important: string[] = [];
  for (const result of stepResults) {
    for (const line of textLines(`${result.stdout}\n${result.stderr}`)) {
      if (!pattern.test(line)) continue;
      const normalized = `${result.title}: ${shortenEvidenceLine(line)}`;
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      important.push(normalized);
      if (important.length >= limit) return important;
    }
  }
  return important;
}

function buildNextActions(
  failed: EvidenceStepResult[],
  importantLines: string[],
  t: ReturnType<typeof useTranslation>["t"],
) {
  if (failed.length) {
    return [
      `- ${t("agent.analysisRetryFailed", { titles: failed.map((result) => result.title).join(", ") })}`,
      `- ${t("agent.analysisOpenCommandEvidence")}`,
    ];
  }
  if (importantLines.length) {
    return [
      `- ${t("agent.analysisReviewSignals")}`,
      `- ${t("agent.analysisOpenCommandEvidence")}`,
    ];
  }
  return [`- ${t("agent.analysisCollectDeeperEvidence")}`];
}

function textLines(text: string | undefined) {
  return (text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function compactLines(items: Array<string | undefined | null | false>) {
  return items.filter((item): item is string => Boolean(item && item.trim()));
}

function numberMatch(text: string | undefined, pattern: RegExp) {
  const value = firstMatch(text, pattern);
  if (!value) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatMib(value: number) {
  if (value >= 1024) return `${(value / 1024).toFixed(1)} GB`;
  return `${Math.round(value)} MB`;
}

function shortenEvidenceLine(line: string) {
  const trimmed = line.replace(/\s+/g, " ").trim();
  return trimmed.length > 180 ? `${trimmed.slice(0, 180)}...` : trimmed;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatCommandResult(title: string, why: string, result: WorkbenchCommandResult) {
  const output = [
    title,
    why,
    "",
    `$ ${result.command}`,
    result.stdout.trim() ? result.stdout.trim() : "(no stdout)",
    result.stderr.trim() ? `stderr:\n${result.stderr.trim()}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return output.length > OUTPUT_LIMIT ? `${output.slice(0, OUTPUT_LIMIT)}\n...[truncated]` : output;
}

function skillLabel(skill: AndroidAgentSkill, t: ReturnType<typeof useTranslation>["t"]) {
  return t(`agent.skills.${skill.id}.title`, { defaultValue: skill.title });
}

function skillSummary(skill: AndroidAgentSkill, t: ReturnType<typeof useTranslation>["t"]) {
  return t(`agent.skills.${skill.id}.summary`, { defaultValue: skill.summary });
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

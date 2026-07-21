import { Autocomplete, Badge, Button, Divider, Group, Modal, Paper, PasswordInput, Progress, Select, Stack, Switch, Text, TextInput } from "@mantine/core";
import { IconFolder, IconRefresh } from "@tabler/icons-react";
import { type ClipboardEvent, type MouseEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { AppSettings, LanguagePreference, type AgentCliProfile } from "../types";
import type { AppUpdaterControls } from "../hooks/useAppUpdater";
import { isAutoUpdateCheckEnabled } from "../updaterPolicy";
import {
  CUSTOM_AGENT_CLI_PROFILE_ID,
  joinAgentCliArgs,
  normalizeAgentCliSettings,
  splitAgentCliArgs,
} from "../agentCliSettings";
import {
  isAgentApiProviderConfigured,
  normalizeAgentProviderSettings,
} from "../agentProviderSettings";
import { extractClipboardPaths, isLikelyLocalPath } from "../pathClipboard";
import {
  resolveActiveSettingsSection,
  SETTINGS_SECTION_IDS,
  type SettingsSectionId,
} from "../settingsNavigation";

interface Props {
  settings: AppSettings;
  updater: AppUpdaterControls;
  onSettingsChange: (settings: AppSettings) => void;
  onClose: () => void;
}

interface AgentRuntimeDiscoveryItem {
  kind: "codex_cli" | "claude_code";
  name: string;
  command: string;
  available: boolean;
  version?: string | null;
  configuredModel?: string | null;
  reasoningEffort?: string | null;
  modelOptions?: AgentRuntimeModelOption[];
  reasoningEffortOptions?: string[];
  configurationSource?: "user_config" | null;
}

interface AgentRuntimeModelOption {
  value: string;
  label: string;
  defaultReasoningEffort?: string | null;
  reasoningEfforts?: string[];
}

interface AgentRuntimeDiscoveryResult {
  runtimes: AgentRuntimeDiscoveryItem[];
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 MB";
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function Settings({
  settings,
  updater,
  onSettingsChange,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const [local, setLocal] = useState<AppSettings>(() => ({
    ...settings,
    agentCli: normalizeAgentCliSettings(settings.agentCli),
    agentProviders: normalizeAgentProviderSettings(settings.agentProviders),
  }));
  const [appVersion, setAppVersion] = useState("");
  const [runtimeDiscovery, setRuntimeDiscovery] = useState<AgentRuntimeDiscoveryResult | null>(null);
  const [runtimeDiscoveryLoading, setRuntimeDiscoveryLoading] = useState(false);
  const [activeSection, setActiveSection] = useState<SettingsSectionId>("settings-agent");
  const settingsContentRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setLocal({
      ...settings,
      agentCli: normalizeAgentCliSettings(settings.agentCli),
      agentProviders: normalizeAgentProviderSettings(settings.agentProviders),
    });
  }, [settings]);

  useEffect(() => {
    getVersion()
      .then(setAppVersion)
      .catch(() => {
        // Keep the build-time fallback if the desktop API is unavailable.
      });
  }, []);

  const refreshRuntimeDiscovery = async () => {
    setRuntimeDiscoveryLoading(true);
    try {
      setRuntimeDiscovery(await invoke<AgentRuntimeDiscoveryResult>("agent_runtime_discover"));
    } catch {
      setRuntimeDiscovery(null);
    } finally {
      setRuntimeDiscoveryLoading(false);
    }
  };

  useEffect(() => {
    void refreshRuntimeDiscovery();
  }, []);

  const syncActiveSection = useCallback(() => {
    const content = settingsContentRef.current;
    if (!content) return;

    const contentRect = content.getBoundingClientRect();
    const viewportTop = Math.max(contentRect.top, 0);
    const viewportBottom = Math.min(contentRect.bottom, window.innerHeight);
    const measurements = SETTINGS_SECTION_IDS.flatMap((id) => {
      const title = content.querySelector<HTMLElement>(
        "[data-settings-section-title=\"" + id + "\"]",
      );
      if (!title) return [];
      const titleRect = title.getBoundingClientRect();
      return [{ id, top: titleRect.top, bottom: titleRect.bottom }];
    });

    setActiveSection((current) =>
      resolveActiveSettingsSection(measurements, viewportTop, viewportBottom, current),
    );
  }, []);

  useEffect(() => {
    syncActiveSection();
    const handleScroll = () => {
      window.requestAnimationFrame(syncActiveSection);
    };
    window.addEventListener("scroll", handleScroll, true);
    document.addEventListener("scroll", handleScroll, true);

    const content = settingsContentRef.current;
    const titleObserver =
      content && "IntersectionObserver" in window
        ? new IntersectionObserver(
            (entries) => {
              const fullyVisibleIds = entries
                .filter((entry) => entry.isIntersecting && entry.intersectionRatio >= 1)
                .map((entry) => entry.target.getAttribute("data-settings-section-title"))
                .filter((id): id is SettingsSectionId =>
                  SETTINGS_SECTION_IDS.includes(id as SettingsSectionId),
                );
              const nextId = SETTINGS_SECTION_IDS.filter((id) => fullyVisibleIds.includes(id));
              const lastFullyVisibleId = nextId[nextId.length - 1];
              if (lastFullyVisibleId) {
                setActiveSection(lastFullyVisibleId);
              }
            },
            { root: content, threshold: 1 },
          )
        : null;

    content?.querySelectorAll<HTMLElement>("[data-settings-section-title]").forEach((title) => {
      titleObserver?.observe(title);
    });

    return () => {
      window.removeEventListener("scroll", handleScroll, true);
      document.removeEventListener("scroll", handleScroll, true);
      titleObserver?.disconnect();
    };
  }, [syncActiveSection]);

  useEffect(() => {
    const syncHashSection = () => {
      const sectionId = window.location.hash.replace(/^#/, "");
      if (SETTINGS_SECTION_IDS.includes(sectionId as SettingsSectionId)) {
        setActiveSection(sectionId as SettingsSectionId);
      }
    };

    syncHashSection();
    window.addEventListener("hashchange", syncHashSection);
    return () => window.removeEventListener("hashchange", syncHashSection);
  }, []);

  const handleSelectDir = async (type: "screenshotDir" | "recordingDir") => {
    try {
      const dir = await invoke<string | null>("select_directory");
      if (dir) {
        setLocal((current) => ({ ...current, [type]: dir }));
      }
    } catch {
      // Directory selection cancellation should keep current settings.
    }
  };

  const handleSave = () => {
    onSettingsChange({
      ...local,
      agentCli: normalizeAgentCliSettings(local.agentCli),
      agentProviders: normalizeAgentProviderSettings(local.agentProviders),
    });
    onClose();
  };

  const agentCli = normalizeAgentCliSettings(local.agentCli);
  const agentProviders = normalizeAgentProviderSettings(local.agentProviders);
  const profileOptions = agentCli.profiles.map((profile) => ({
    value: profile.id,
    label: profile.name,
  }));
  const activeCliProfile =
    agentCli.profiles.find((profile) => profile.id === agentCli.globalProfileId) ?? agentCli.profiles[0];
  const activeRuntimeKind =
    activeCliProfile?.id === "codex_cli" || activeCliProfile?.id === "claude_code"
      ? activeCliProfile.id
      : null;
  const activeRuntime = runtimeDiscovery?.runtimes.find((runtime) => runtime.kind === activeRuntimeKind);
  const modelOptions = activeRuntime?.modelOptions ?? [];
  const effectiveModel = activeCliProfile?.modelOverride?.trim() || activeRuntime?.configuredModel || "";
  const effectiveModelOption = modelOptions.find((option) => option.value === effectiveModel);
  const discoveredReasoningEffortOptions = effectiveModelOption?.reasoningEfforts?.length
    ? effectiveModelOption.reasoningEfforts
    : activeRuntime?.reasoningEffortOptions ?? [];
  const reasoningEffortOptions = Array.from(
    new Set([
      ...discoveredReasoningEffortOptions,
      ...(activeRuntime?.reasoningEffort ? [activeRuntime.reasoningEffort] : []),
      ...(activeCliProfile?.reasoningEffortOverride ? [activeCliProfile.reasoningEffortOverride] : []),
    ]),
  );
  const customProfile =
    agentCli.profiles.find((profile) => profile.id === CUSTOM_AGENT_CLI_PROFILE_ID) ?? agentCli.profiles[0];

  const updateAgentCli = (nextAgentCli: typeof agentCli) => {
    setLocal((current) => ({
      ...current,
      agentCli: normalizeAgentCliSettings(nextAgentCli),
    }));
  };

  const updateAgentProviders = (nextProviders: typeof agentProviders) => {
    setLocal((current) => ({
      ...current,
      agentProviders: normalizeAgentProviderSettings(nextProviders),
    }));
  };

  const updateApiProvider = (providerId: string, patch: Partial<(typeof agentProviders.apiProviders)[number]>) => {
    updateAgentProviders({
      ...agentProviders,
      apiProviders: agentProviders.apiProviders.map((provider) =>
        provider.id === providerId ? { ...provider, ...patch } : provider,
      ),
    });
  };

  const updateCustomProfile = (patch: Partial<typeof customProfile>) => {
    updateAgentCli({
      ...agentCli,
      profiles: agentCli.profiles.map((profile) =>
        profile.id === customProfile.id
          ? {
              ...profile,
              ...patch,
              builtIn: false,
            }
          : profile,
      ),
    });
  };

  const updateActiveCliProfile = (patch: Partial<AgentCliProfile>) => {
    if (!activeCliProfile) return;
    updateAgentCli({
      ...agentCli,
      profiles: agentCli.profiles.map((profile) =>
        profile.id === activeCliProfile.id ? { ...profile, ...patch } : profile,
      ),
    });
  };

  const updateActiveCliModel = (modelOverride: string) => {
    const selectedOption = modelOptions.find((option) => option.value === modelOverride.trim());
    const currentEffort = activeCliProfile?.reasoningEffortOverride || "";
    const supportedEfforts = selectedOption?.reasoningEfforts ?? [];
    updateActiveCliProfile({
      modelOverride,
      reasoningEffortOverride:
        currentEffort && supportedEfforts.length > 0 && !supportedEfforts.includes(currentEffort)
          ? ""
          : currentEffort,
    });
  };

  const handleSelectCustomCwd = async () => {
    try {
      const dir = await invoke<string | null>("select_directory");
      if (dir) {
        updateCustomProfile({ cwd: dir });
      }
    } catch {
      // Directory selection cancellation should keep current settings.
    }
  };

  const handleCustomCwdPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const text =
      event.clipboardData.getData("text/uri-list") ||
      event.clipboardData.getData("text/plain") ||
      event.clipboardData.getData("text");
    const path = extractClipboardPaths(text).find(isLikelyLocalPath);
    if (!path) return;
    event.preventDefault();
    updateCustomProfile({ cwd: path });
  };

  const isChecking = updater.status === "checking";
  const isDownloading = updater.status === "downloading";
  const progressValue = updater.progress.total
    ? Math.min(100, Math.round((updater.progress.downloaded / updater.progress.total) * 100))
    : 0;

  return (
    <Modal
      opened
      onClose={onClose}
      fullScreen
      padding={0}
      withCloseButton={false}
      styles={{
        content: { background: "var(--surface-page)" },
        body: { height: "100vh", padding: 0 },
      }}
    >
      <div
        className="settings-shell"
        onScrollCapture={syncActiveSection}
        style={{
          height: "100vh",
          minHeight: 0,
          display: "grid",
          gridTemplateColumns: "220px minmax(0, 1fr)",
          gap: 16,
          padding: 16,
          background: "var(--surface-page)",
          color: "var(--text-strong)",
        }}
      >
        <aside
          className="settings-rail"
          style={{
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            gap: 16,
            padding: 16,
            background: "var(--color-cloud)",
            color: "var(--text-strong)",
            border: "var(--border-hairline)",
            borderRadius: "var(--radius-xl)",
            boxShadow: "var(--shadow-tier-1)",
          }}
        >
          <Stack gap={2}>
            <Text size="xs" fw={500} c="dimmed">
              {t("app.title")}
            </Text>
            <Text size="xl" fw={800}>
              {t("settings.title")}
            </Text>
          </Stack>

          <Stack gap={6} className="settings-nav">
            <SettingsNavItem
              href="#settings-agent"
              label={t("settings.sectionAgent")}
              active={activeSection === "settings-agent"}
              onSelect={() => setActiveSection("settings-agent")}
            />
            <SettingsNavItem
              href="#settings-files"
              label={t("settings.sectionFiles")}
              active={activeSection === "settings-files"}
              onSelect={() => setActiveSection("settings-files")}
            />
            <SettingsNavItem
              href="#settings-updates"
              label={t("settings.sectionUpdates")}
              active={activeSection === "settings-updates"}
              onSelect={() => setActiveSection("settings-updates")}
            />
          </Stack>

          <div style={{ flex: 1 }} />
          {appVersion ? (
            <Text size="xs" c="dimmed">
              {t("settings.version", { version: appVersion })}
            </Text>
          ) : null}
        </aside>

        <main className="settings-workspace" style={{ minHeight: 0, minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>
          <Group
            justify="space-between"
            align="center"
            gap="md"
            wrap="wrap"
            style={{
              minHeight: 68,
              padding: "16px 24px",
              border: "var(--border-hairline)",
              borderRadius: "var(--radius-xl)",
              background: "var(--color-cloud)",
              boxShadow: "var(--shadow-tier-1)",
            }}
          >
            <Stack gap={2} style={{ minWidth: 0 }}>
              <Text size="lg" fw={800}>
                {t("settings.title")}
              </Text>
              <Text size="xs" c="dimmed" lineClamp={1}>
                {t("settings.pageDescription")}
              </Text>
            </Stack>
            <Group gap="xs" wrap="wrap" style={{ flex: "0 0 auto" }}>
              <Button variant="default" color="gray" onClick={onClose}>
                {t("settings.cancel")}
              </Button>
              <Button onClick={handleSave}>{t("settings.save")}</Button>
            </Group>
          </Group>

          <div
            ref={settingsContentRef}
            className="settings-content"
            onScroll={syncActiveSection}
            style={{ flex: 1, minHeight: 0, overflow: "auto" }}
          >
            <Stack gap="md" maw={1040}>
              <SettingsSection
                id="settings-agent"
                title={t("settings.agentProviderTitle")}
                description={t("settings.agentProviderDescription")}
                badge={t("settings.agentProviderStatus")}
              >
                <Stack gap="xs">
                  <Group justify="space-between" gap="sm" wrap="wrap">
                    <Text size="sm" fw={700}>
                      {t("settings.agentRuntimeDetected")}
                    </Text>
                    <Button
                      variant="default"
                      size="xs"
                      leftSection={<IconRefresh size={14} />}
                      loading={runtimeDiscoveryLoading}
                      onClick={() => void refreshRuntimeDiscovery()}
                    >
                      {t("settings.agentRuntimeRefresh")}
                    </Button>
                  </Group>
                  {runtimeDiscovery?.runtimes.map((runtime) => (
                    <Paper
                      key={runtime.kind}
                      withBorder
                      radius="md"
                      p="sm"
                      style={{ background: "var(--surface-sunken)" }}
                    >
                      <Group justify="space-between" gap="sm" wrap="wrap">
                        <Stack gap={2}>
                          <Text size="sm" fw={700}>
                            {runtime.name}
                          </Text>
                          {runtime.version ? (
                            <Text size="xs" c="dimmed">
                              {t("settings.agentRuntimeVersion", { version: runtime.version })}
                            </Text>
                          ) : null}
                          {runtime.configuredModel ? (
                            <Text size="xs" c="dimmed">
                              {t("settings.agentRuntimeConfiguredModel", { model: runtime.configuredModel })}
                            </Text>
                          ) : null}
                          {runtime.reasoningEffort ? (
                            <Text size="xs" c="dimmed">
                              {t("settings.agentRuntimeReasoning", { effort: runtime.reasoningEffort })}
                            </Text>
                          ) : null}
                          {runtime.configurationSource ? (
                            <Text size="xs" c="dimmed">
                              {t("settings.agentRuntimeSourceUserConfig")}
                            </Text>
                          ) : null}
                        </Stack>
                        <Badge color={runtime.available ? "green" : "gray"} variant="light">
                          {runtime.available ? t("settings.agentRuntimeAvailable") : t("settings.agentRuntimeUnavailable")}
                        </Badge>
                      </Group>
                    </Paper>
                  ))}
                </Stack>

                <Stack gap="sm">
                  <Text size="sm" fw={700}>
                    {t("settings.agentProviderApiTitle")}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {t("settings.agentProviderExperimentalHint")}
                  </Text>
                  {agentProviders.apiProviders.map((provider) => (
                    <div
                      key={provider.id}
                      className="settings-provider-row"
                      style={{
                        padding: 16,
                        borderRadius: "var(--radius-tile)",
                        border: "var(--border-hairline)",
                        background: "var(--surface-sunken)",
                      }}
                    >
                      <Stack gap="xs">
                        <Group justify="space-between" gap="sm" wrap="wrap">
                          <Group gap="xs">
                            <Text size="sm" fw={700}>
                              {provider.name}
                            </Text>
                            <Badge color={isAgentApiProviderConfigured(provider) ? "green" : "gray"} variant="light">
                              {isAgentApiProviderConfigured(provider)
                                ? t("settings.agentProviderConfigured")
                                : t("settings.agentProviderNotConfigured")}
                            </Badge>
                          </Group>
                          <Switch
                            label={t("settings.agentProviderEnabled")}
                            checked={provider.enabled}
                            onChange={(event) => updateApiProvider(provider.id, { enabled: event.currentTarget.checked })}
                          />
                        </Group>
                        <Group gap="xs" grow>
                          <TextInput
                            label={t("settings.agentProviderBaseUrl")}
                            value={provider.baseUrl}
                            onChange={(event) => updateApiProvider(provider.id, { baseUrl: event.currentTarget.value })}
                          />
                          <TextInput
                            label={t("settings.agentProviderModel")}
                            value={provider.model}
                            onChange={(event) => updateApiProvider(provider.id, { model: event.currentTarget.value })}
                          />
                        </Group>
                        <PasswordInput
                          label={t("settings.agentProviderApiKey")}
                          value={provider.apiKey}
                          onChange={(event) => updateApiProvider(provider.id, { apiKey: event.currentTarget.value })}
                          placeholder={t("settings.agentProviderApiKeyPlaceholder")}
                        />
                      </Stack>
                    </div>
                  ))}
                </Stack>

                <Divider />

                <Stack gap="xs">
                  <Text size="sm" fw={700}>
                    {t("settings.agentCliTitle")}
                  </Text>

                  <Select
                    label={t("settings.agentCliGlobalProfile")}
                    value={agentCli.globalProfileId}
                    onChange={(value) =>
                      updateAgentCli({
                        ...agentCli,
                        globalProfileId: value || "codex_cli",
                      })
                    }
                    data={profileOptions}
                  />
                  {activeRuntimeKind ? (
                    <>
                      <Text size="xs" c="dimmed">
                        {t("settings.agentRuntimeFollowCli")}
                      </Text>
                      <Autocomplete
                        label={t("settings.agentRuntimeModelOverride")}
                        placeholder={t("settings.agentRuntimeModelOverridePlaceholder")}
                        value={activeCliProfile.modelOverride || ""}
                        onChange={updateActiveCliModel}
                        data={modelOptions.map((option) => ({ value: option.value, label: option.label }))}
                        clearable
                        limit={20}
                      />
                      <Select
                        label={t("settings.agentRuntimeReasoningOverride")}
                        placeholder={t("settings.agentRuntimeReasoningOverridePlaceholder")}
                        value={activeCliProfile.reasoningEffortOverride || null}
                        onChange={(value) => updateActiveCliProfile({ reasoningEffortOverride: value || "" })}
                        data={reasoningEffortOptions}
                        clearable
                        searchable
                        disabled={reasoningEffortOptions.length === 0}
                      />
                    </>
                  ) : null}

                  <Group align="end" gap="xs" wrap="nowrap">
                    <TextInput
                      label={t("settings.agentCliCustomCommand")}
                      placeholder="codex"
                      value={customProfile.command}
                      onChange={(event) => updateCustomProfile({ command: event.currentTarget.value })}
                      style={{ flex: 1 }}
                    />
                    <TextInput
                      label={t("settings.agentCliCustomArgs")}
                      placeholder="--profile android"
                      value={joinAgentCliArgs(customProfile.args)}
                      onChange={(event) => updateCustomProfile({ args: splitAgentCliArgs(event.currentTarget.value) })}
                      style={{ flex: 1 }}
                    />
                  </Group>

                  <Group align="end" gap="xs" wrap="nowrap">
                    <TextInput
                      label={t("settings.agentCliCustomCwd")}
                      placeholder="/path/to/android-project"
                      value={customProfile.cwd || ""}
                      onPaste={handleCustomCwdPaste}
                      onChange={(event) => updateCustomProfile({ cwd: event.currentTarget.value })}
                      style={{ flex: 1 }}
                    />
                    <Button variant="light" leftSection={<IconFolder size={15} />} onClick={handleSelectCustomCwd}>
                      {t("settings.select")}
                    </Button>
                  </Group>
                </Stack>
              </SettingsSection>

              <SettingsSection
                id="settings-files"
                title={t("settings.sectionFiles")}
                description={t("settings.sectionFilesDescription")}
              >
                <Select
                  label={t("settings.language")}
                  value={local.languagePreference || "system"}
                  onChange={(value) =>
                    setLocal({
                      ...local,
                      languagePreference: (value || "system") as LanguagePreference,
                    })
                  }
                  data={[
                    { value: "system", label: t("settings.languageSystem") },
                    { value: "en-US", label: t("settings.languageEnglish") },
                    { value: "zh-CN", label: t("settings.languageChinese") },
                  ]}
                />

                <Group align="end" gap="xs" wrap="nowrap">
                  <TextInput label={t("settings.screenshotDir")} value={local.screenshotDir || t("settings.notSet")} readOnly style={{ flex: 1 }} />
                  <Button variant="light" leftSection={<IconFolder size={15} />} onClick={() => handleSelectDir("screenshotDir")}>
                    {t("settings.select")}
                  </Button>
                </Group>

                <Group align="end" gap="xs" wrap="nowrap">
                  <TextInput label={t("settings.recordingDir")} value={local.recordingDir || t("settings.notSet")} readOnly style={{ flex: 1 }} />
                  <Button variant="light" leftSection={<IconFolder size={15} />} onClick={() => handleSelectDir("recordingDir")}>
                    {t("settings.select")}
                  </Button>
                </Group>
              </SettingsSection>

              <SettingsSection
                id="settings-updates"
                title={t("updates.settingsTitle")}
                description={t("settings.sectionUpdatesDescription")}
              >
                <Group justify="space-between" align="center" gap="sm" wrap="nowrap">
                  <Switch
                    label={t("updates.autoCheck")}
                    checked={isAutoUpdateCheckEnabled(local.autoCheckUpdates)}
                    onChange={(event) =>
                      setLocal((current) => ({
                        ...current,
                        autoCheckUpdates: event.currentTarget.checked,
                      }))
                    }
                  />
                  <Button
                    variant="light"
                    size="xs"
                    leftSection={<IconRefresh size={15} />}
                    loading={isChecking}
                    disabled={isDownloading}
                    onClick={() => updater.checkForUpdate({ silent: false })}
                    style={{ flexShrink: 0, maxWidth: 132 }}
                    styles={{
                      label: {
                        lineHeight: 1.15,
                        textAlign: "center",
                        whiteSpace: "normal",
                      },
                    }}
                  >
                    {t("updates.check")}
                  </Button>
                </Group>

                {updater.status === "not-available" && (
                  <Text size="sm" c="dimmed">
                    {t("updates.noUpdate")}
                  </Text>
                )}

                {updater.status === "available" && updater.updateInfo && (
                  <Group justify="space-between" gap="sm">
                    <Text size="sm">
                      {t("updates.available", {
                        version: updater.updateInfo.version,
                      })}
                    </Text>
                    <Button size="xs" variant="subtle" onClick={updater.openPrompt}>
                      {t("updates.view")}
                    </Button>
                  </Group>
                )}

                {isDownloading && (
                  <Stack gap={6}>
                    <Progress value={progressValue} animated />
                    <Text size="xs" c="dimmed">
                      {updater.progress.total
                        ? t("updates.progressWithTotal", {
                            downloaded: formatBytes(updater.progress.downloaded),
                            total: formatBytes(updater.progress.total),
                          })
                        : t("updates.downloading")}
                    </Text>
                  </Stack>
                )}

                {updater.status === "ready" && (
                  <Text size="sm" c="dimmed">
                    {t("updates.relaunching")}
                  </Text>
                )}

                {updater.status === "error" && updater.error && (
                  <Text size="sm" c="red">
                    {t("updates.failed", { error: updater.error })}
                  </Text>
                )}
              </SettingsSection>
            </Stack>
          </div>
        </main>
      </div>
    </Modal>
  );
}

function SettingsNavItem({
  href,
  label,
  active = false,
  onSelect,
}: {
  href: string;
  label: string;
  active?: boolean;
  onSelect: () => void;
}) {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    onSelect();
    document.getElementById(href.slice(1))?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <a
      href={href}
      onClick={handleClick}
      aria-current={active ? "page" : undefined}
      style={{
        minHeight: 44,
        borderRadius: "var(--radius-pill)",
        display: "flex",
        alignItems: "center",
        padding: "0 16px",
        color: active ? "var(--color-white)" : "var(--text-muted)",
        background: active ? "var(--color-ink)" : "transparent",
        textDecoration: "none",
        fontSize: "var(--fs-body)",
        fontWeight: 500,
        border: active ? "1px solid var(--color-ink)" : "1px solid transparent",
      }}
    >
      {label}
    </a>
  );
}

function SettingsSection({
  id,
  title,
  description,
  badge,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  badge?: string;
  children: ReactNode;
}) {
  return (
    <Paper id={id} className="settings-section-card" withBorder p="xl">
      <Stack gap="md">
        <Group justify="space-between" gap="sm" wrap="wrap">
          <Stack gap={2} style={{ minWidth: 0 }}>
            <Text size="sm" fw={800} data-settings-section-title={id}>
              {title}
            </Text>
            {description ? (
              <Text size="xs" c="dimmed">
                {description}
              </Text>
            ) : null}
          </Stack>
          {badge ? (
            <Badge color="blue" variant="light">
              {badge}
            </Badge>
          ) : null}
        </Group>
        {children}
      </Stack>
    </Paper>
  );
}

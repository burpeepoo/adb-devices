import { Button, Divider, Group, Modal, Progress, Select, Stack, Switch, Text, TextInput } from "@mantine/core";
import { IconFolder, IconRefresh } from "@tabler/icons-react";
import { type ClipboardEvent, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { AppSettings, LanguagePreference } from "../types";
import type { AppUpdaterControls } from "../hooks/useAppUpdater";
import { isAutoUpdateCheckEnabled } from "../updaterPolicy";
import {
  CUSTOM_AGENT_CLI_PROFILE_ID,
  joinAgentCliArgs,
  normalizeAgentCliSettings,
  splitAgentCliArgs,
} from "../agentCliSettings";
import { extractClipboardPaths, isLikelyLocalPath } from "../pathClipboard";

interface Props {
  settings: AppSettings;
  updater: AppUpdaterControls;
  onSettingsChange: (settings: AppSettings) => void;
  onClose: () => void;
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
  }));
  const [appVersion, setAppVersion] = useState("");

  useEffect(() => {
    setLocal({
      ...settings,
      agentCli: normalizeAgentCliSettings(settings.agentCli),
    });
  }, [settings]);

  useEffect(() => {
    getVersion()
      .then(setAppVersion)
      .catch(() => {
        // Keep the build-time fallback if the desktop API is unavailable.
      });
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
    });
    onClose();
  };

  const agentCli = normalizeAgentCliSettings(local.agentCli);
  const profileOptions = agentCli.profiles.map((profile) => ({
    value: profile.id,
    label: profile.name,
  }));
  const customProfile =
    agentCli.profiles.find((profile) => profile.id === CUSTOM_AGENT_CLI_PROFILE_ID) ?? agentCli.profiles[0];

  const updateAgentCli = (nextAgentCli: typeof agentCli) => {
    setLocal((current) => ({
      ...current,
      agentCli: normalizeAgentCliSettings(nextAgentCli),
    }));
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
    <Modal opened onClose={onClose} title={t("settings.title")} centered size="lg">
      <Stack gap="md">
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

        <Divider />

        <Stack gap="xs">
          <Text size="sm" fw={600}>
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

        <Divider />

        <Stack gap="xs">
          <Group justify="space-between" align="center" gap="sm" wrap="nowrap">
            <Stack gap={2} style={{ minWidth: 0 }}>
              <Text size="sm" fw={600}>
                {t("updates.settingsTitle")}
              </Text>
            </Stack>
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
        </Stack>

        {appVersion && (
          <Text size="xs" c="dimmed" ta="center">
            {t("settings.version", { version: appVersion })}
          </Text>
        )}

        <Group justify="flex-end" mt="sm">
          <Button variant="subtle" color="gray" onClick={onClose}>
            {t("settings.cancel")}
          </Button>
          <Button onClick={handleSave}>{t("settings.save")}</Button>
        </Group>
      </Stack>
    </Modal>
  );
}

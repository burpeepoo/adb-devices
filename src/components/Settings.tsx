import { Button, Divider, Group, Modal, Progress, Select, Stack, Text, TextInput } from "@mantine/core";
import { IconFolder, IconRefresh } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { AppSettings, LanguagePreference } from "../types";
import type { AppUpdaterControls } from "../hooks/useAppUpdater";

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

export default function Settings({ settings, updater, onSettingsChange, onClose }: Props) {
  const { t } = useTranslation();
  const [local, setLocal] = useState(settings);
  const [appVersion, setAppVersion] = useState("");

  useEffect(() => {
    setLocal(settings);
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
    onSettingsChange(local);
    onClose();
  };

  const isChecking = updater.status === "checking";
  const isDownloading = updater.status === "downloading";
  const progressValue = updater.progress.total
    ? Math.min(100, Math.round((updater.progress.downloaded / updater.progress.total) * 100))
    : 0;

  return (
    <Modal opened onClose={onClose} title={t("settings.title")} centered size="md">
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
          <Group justify="space-between" align="flex-start" gap="sm" wrap="nowrap">
            <Stack gap={2} style={{ minWidth: 0 }}>
              <Text size="sm" fw={600}>
                {t("updates.settingsTitle")}
              </Text>
              <Text size="xs" c="dimmed">
                {t("updates.settingsDesc")}
              </Text>
            </Stack>
            <Button
              variant="light"
              leftSection={<IconRefresh size={15} />}
              loading={isChecking}
              disabled={isDownloading}
              onClick={() => updater.checkForUpdate({ silent: false })}
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

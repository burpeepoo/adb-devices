import { Button, Group, Modal, Progress, ScrollArea, Stack, Text } from "@mantine/core";
import { IconDownload, IconRocket } from "@tabler/icons-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { AppUpdaterControls } from "../hooks/useAppUpdater";
import { selectUpdateNoteBody } from "../updateNotes";

interface Props {
  updater: AppUpdaterControls;
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 MB";
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function AppUpdatePrompt({ updater }: Props) {
  const { t, i18n } = useTranslation();
  const progressValue = useMemo(() => {
    if (!updater.progress.total) return 0;
    return Math.min(100, Math.round((updater.progress.downloaded / updater.progress.total) * 100));
  }, [updater.progress.downloaded, updater.progress.total]);
  const updateNoteBody = useMemo(
    () => selectUpdateNoteBody(updater.updateInfo?.body, i18n.language),
    [i18n.language, updater.updateInfo?.body]
  );

  const isDownloading = updater.status === "downloading";
  const isReady = updater.status === "ready";

  return (
    <Modal
      opened={updater.promptOpen}
      onClose={updater.dismissPrompt}
      title={t("updates.title")}
      centered
      size="md"
      zIndex={1000}
      closeOnClickOutside={!isDownloading}
      closeOnEscape={!isDownloading}
      withCloseButton={!isDownloading}
    >
      <Stack gap="md">
        <Group gap="sm" align="flex-start" wrap="nowrap">
          <IconRocket size={22} color="var(--color-ink)" />
          <Stack gap={4} style={{ minWidth: 0 }}>
            <Text fw={600}>
              {t("updates.available", {
                version: updater.updateInfo?.version || "",
              })}
            </Text>
            <Text size="sm" c="dimmed">
              {t("updates.currentVersion", {
                version: updater.updateInfo?.currentVersion || "",
              })}
            </Text>
          </Stack>
        </Group>

        {updateNoteBody && (
          <Stack gap={6}>
            <Text size="sm" fw={600}>
              {t("updates.releaseNotes")}
            </Text>
            <ScrollArea.Autosize mah={180} type="auto">
              <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
                {updateNoteBody}
              </Text>
            </ScrollArea.Autosize>
          </Stack>
        )}

        {isDownloading && (
          <Stack gap={6}>
            <Progress value={progressValue} animated />
            <Group justify="space-between">
              <Text size="xs" c="dimmed">
                {t("updates.downloading")}
              </Text>
              <Text size="xs" c="dimmed">
                {updater.progress.total
                  ? t("updates.progressWithTotal", {
                      downloaded: formatBytes(updater.progress.downloaded),
                      total: formatBytes(updater.progress.total),
                    })
                  : formatBytes(updater.progress.downloaded)}
              </Text>
            </Group>
          </Stack>
        )}

        {isReady && (
          <Text size="sm" c="dimmed">
            {t("updates.relaunching")}
          </Text>
        )}

        {updater.error && (
          <Text size="sm" c="red">
            {t("updates.failed", { error: updater.error })}
          </Text>
        )}

        <Group justify="flex-end">
          <Button variant="subtle" color="gray" onClick={updater.dismissPrompt} disabled={isDownloading}>
            {t("updates.later")}
          </Button>
          <Button
            leftSection={<IconDownload size={15} />}
            onClick={updater.downloadAndInstall}
            loading={isDownloading}
            disabled={!updater.updateInfo || isReady}
          >
            {t("updates.downloadAndInstall")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

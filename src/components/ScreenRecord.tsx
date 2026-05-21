import { useState, useRef, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { formatDuration } from "../utils/format";
import { useTranslation } from "react-i18next";
import { Button, Group, Paper, Stack, Text, ThemeIcon } from "@mantine/core";
import { IconExternalLink, IconPlayerRecord, IconPlayerStop } from "@tabler/icons-react";
import PathSelector from "./common/PathSelector";
import ResultAlert from "./common/ResultAlert";

interface Props {
  deviceSerial: string | null;
  saveDir: string;
  shortcutResult?: {
    id: number;
    ok: boolean;
    msg: string;
    recording: boolean;
    path?: string | null;
  } | null;
  onSaveDirChange: (dir: string) => void;
  onRecordingStateChange: (recording: boolean) => void;
}

export default function ScreenRecord({ deviceSerial, saveDir, shortcutResult, onSaveDirChange, onRecordingStateChange }: Props) {
  const { t } = useTranslation();
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [stopping, setStopping] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [lastPath, setLastPath] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (recording) {
      timerRef.current = setInterval(() => {
        setElapsed((prev) => prev + 1);
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [recording]);

  const handleStart = useCallback(async () => {
    if (!deviceSerial) {
      setResult({ ok: false, msg: t('screenRecord.selectDevice') });
      return;
    }
    try {
      await invoke<string>("adb_start_recording", {
        deviceSerial: deviceSerial || null,
      });
      setRecording(true);
      onRecordingStateChange(true);
      setElapsed(0);
      setResult(null);
    } catch (e) {
      setResult({ ok: false, msg: String(e) });
    }
  }, [deviceSerial, onRecordingStateChange, t]);

  const handleStop = useCallback(async () => {
    if (!saveDir) {
      setResult({ ok: false, msg: t('screenRecord.noSaveDir') });
      return;
    }
    setStopping(true);
    try {
      const path = await invoke<string>("adb_stop_recording", {
        saveDir,
        deviceSerial: deviceSerial || null,
      });
      setLastPath(path);
      setResult({ ok: true, msg: t('screenRecord.saved', { path }) });
    } catch (e) {
      setResult({ ok: false, msg: String(e) });
    } finally {
      setRecording(false);
      onRecordingStateChange(false);
      setStopping(false);
    }
  }, [saveDir, deviceSerial, onRecordingStateChange, t]);

  useEffect(() => {
    if (!shortcutResult) {
      return;
    }

    setResult({ ok: shortcutResult.ok, msg: shortcutResult.msg });
    setRecording(shortcutResult.recording);
    onRecordingStateChange(shortcutResult.recording);
    if (shortcutResult.recording) {
      setElapsed(0);
      setLastPath(null);
    } else if (shortcutResult.path) {
      setLastPath(shortcutResult.path);
    }
  }, [onRecordingStateChange, shortcutResult]);

  const handleSelectSaveDir = useCallback(async () => {
    try {
      const dir = await invoke<string | null>("select_directory");
      if (dir) {
        onSaveDirChange(dir);
        setResult({ ok: true, msg: t('screenRecord.dirChanged', { dir }) });
      }
    } catch {
      setResult({ ok: false, msg: t('screenRecord.changeDirFailed') });
    }
  }, [onSaveDirChange, t]);

  // Warning at 2:45 (165 seconds)
  const showWarning = recording && elapsed >= 165;

  return (
    <Stack maw={680} gap="md">
      <Paper withBorder radius="md" p="md">
        <Stack gap="md">
          <Text fw={700}>{t("screenRecord.title")}</Text>

          <PathSelector
            label={t("screenRecord.saveDir")}
            value={saveDir}
            emptyLabel={t("screenRecord.notSet")}
            actionLabel={t("screenRecord.changeDir")}
            disabled={recording}
            onSelect={handleSelectSaveDir}
          />

          {recording && (
            <Stack align="center" gap={6}>
              <Group gap="sm" px="md" py="xs" style={{ borderRadius: "var(--mantine-radius-md)", background: "var(--mantine-color-red-0)" }}>
                <ThemeIcon color="red" radius="xl" size="sm">
                  <IconPlayerRecord size={12} fill="currentColor" />
                </ThemeIcon>
                <Text ff="monospace" fw={800} size="xl" c="red.8">
                  {formatDuration(elapsed)}
                </Text>
              </Group>
              {showWarning && (
                <Text size="sm" c="yellow.8">
                  {t("screenRecord.nearingLimit")}
                </Text>
              )}
            </Stack>
          )}

          {!recording ? (
            <Button color="red" leftSection={<IconPlayerRecord size={17} />} disabled={!deviceSerial} onClick={handleStart}>
              {t("screenRecord.startRecord")}
            </Button>
          ) : (
            <Button color="dark" leftSection={<IconPlayerStop size={17} />} loading={stopping} onClick={handleStop}>
              {t("screenRecord.stopRecord")}
            </Button>
          )}

          <Paper withBorder radius="md" p="sm" bg="red.0">
            <Text size="xs" fw={700} c="red.8">
              {t("screenRecord.shortcutTitle")}
            </Text>
            <Text size="xs" c="red.8" mt={4}>
              {t("screenRecord.shortcutHint")}
            </Text>
            <Group gap="xs" mt="xs">
              <Text size="xs" px={8} py={4} bg="white" style={{ borderRadius: "var(--mantine-radius-sm)" }}>
                {t("screenRecord.shortcutMac")}
              </Text>
              <Text size="xs" px={8} py={4} bg="white" style={{ borderRadius: "var(--mantine-radius-sm)" }}>
                {t("screenRecord.shortcutWindows")}
              </Text>
            </Group>
          </Paper>

          <ResultAlert result={result} />

          {lastPath && result?.ok && (
            <Button
              variant="subtle"
              size="xs"
              leftSection={<IconExternalLink size={14} />}
              onClick={async () => {
                try {
                  await invoke("reveal_path", { path: lastPath });
                } catch {
                  setResult({ ok: false, msg: t("screenRecord.openFolderFailed") });
                }
              }}
              style={{ alignSelf: "flex-start" }}
            >
              {t("screenRecord.showInFolder")}
            </Button>
          )}

          {!deviceSerial && !recording && <ResultAlert warning result={{ ok: true, msg: t("screenRecord.noDevice") }} />}
        </Stack>
      </Paper>

      <Paper withBorder radius="md" p="md" bg="gray.0">
        <Text size="sm" fw={600} c="dimmed" mb={4}>
          {t("screenRecord.notes")}
        </Text>
        <Stack gap={2}>
          <Text size="xs" c="dimmed">
            {t("screenRecord.note1")}
          </Text>
          <Text size="xs" c="dimmed">
            {t("screenRecord.note2")}
          </Text>
          <Text size="xs" c="dimmed">
            {t("screenRecord.note3")}
          </Text>
        </Stack>
      </Paper>
    </Stack>
  );
}

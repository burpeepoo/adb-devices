import { useState, useRef, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { formatDuration } from "../utils/format";
import { useTranslation } from "react-i18next";
import { Button, Group, Paper, Stack, Text, ThemeIcon } from "@mantine/core";
import { IconExternalLink, IconPlayerRecord, IconPlayerStop, IconVideo } from "@tabler/icons-react";
import PathSelector from "./common/PathSelector";
import ResultAlert from "./common/ResultAlert";
import SectionTitle from "./common/SectionTitle";
import DeviceTargetBanner from "./common/DeviceTargetBanner";
import { deviceTargetResultSuffix, type DeviceTargetState } from "../deviceTarget.ts";

interface Props {
  deviceTarget: DeviceTargetState;
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

export default function ScreenRecord({ deviceTarget, saveDir, shortcutResult, onSaveDirChange, onRecordingStateChange }: Props) {
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
    if (!deviceTarget.serial) {
      setResult({ ok: false, msg: t(`deviceTarget.${deviceTarget.blockReason === "selected-device-not-online" ? "selectedUnavailable" : "selectOnlineDevice"}`) });
      return;
    }
    try {
      await invoke<string>("adb_start_recording", {
        deviceSerial: deviceTarget.serial,
      });
      setRecording(true);
      onRecordingStateChange(true);
      setElapsed(0);
      setResult(null);
    } catch (e) {
      setResult({ ok: false, msg: String(e) });
    }
  }, [deviceTarget, onRecordingStateChange, t]);

  const handleStop = useCallback(async () => {
    if (!saveDir) {
      setResult({ ok: false, msg: t('screenRecord.noSaveDir') });
      return;
    }
    if (!deviceTarget.serial) {
      setResult({ ok: false, msg: t(`deviceTarget.${deviceTarget.blockReason === "selected-device-not-online" ? "selectedUnavailable" : "selectOnlineDevice"}`) });
      return;
    }
    setStopping(true);
    try {
      const path = await invoke<string>("adb_stop_recording", {
        saveDir,
        deviceSerial: deviceTarget.serial,
      });
      setLastPath(path);
      setResult({ ok: true, msg: `${t('screenRecord.saved', { path })} · ${deviceTargetResultSuffix(deviceTarget, t("deviceTarget.resultLabel"))}` });
    } catch (e) {
      setResult({ ok: false, msg: String(e) });
    } finally {
      setRecording(false);
      onRecordingStateChange(false);
      setStopping(false);
    }
  }, [saveDir, deviceTarget, onRecordingStateChange, t]);

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
          <SectionTitle icon={<IconVideo size={17} />} label={t("screenRecord.title")} />
          <DeviceTargetBanner target={deviceTarget} />

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
              <Group gap="sm" px="md" py="xs" style={{ borderRadius: "var(--radius-pill)", background: "var(--surface-sunken)", border: "var(--border-hairline)" }}>
                <ThemeIcon color="red" radius="xl" size="sm">
                  <IconPlayerRecord size={12} fill="currentColor" />
                </ThemeIcon>
                <Text ff="var(--font-sans)" fw={800} size="xl" style={{ color: "var(--color-citrus)" }}>
                  {formatDuration(elapsed)}
                </Text>
              </Group>
              {showWarning && (
                <Text size="sm" style={{ color: "var(--color-citrus)" }}>
                  {t("screenRecord.nearingLimit")}
                </Text>
              )}
            </Stack>
          )}

          {!recording ? (
            <Button color="red" leftSection={<IconPlayerRecord size={17} />} disabled={!deviceTarget.serial} onClick={handleStart}>
              {t("screenRecord.startRecord")}
            </Button>
          ) : (
            <Button color="dark" leftSection={<IconPlayerStop size={17} />} loading={stopping} onClick={handleStop}>
              {t("screenRecord.stopRecord")}
            </Button>
          )}

          <Paper withBorder radius="md" p="md" style={{ background: "var(--surface-sunken)" }}>
            <Text size="xs" fw={700}>
              {t("screenRecord.shortcutTitle")}
            </Text>
            <Text size="xs" c="dimmed" mt={4}>
              {t("screenRecord.shortcutHint")}
            </Text>
            <Group gap="xs" mt="xs">
              <Text size="xs" px={10} py={5} style={{ background: "var(--color-cloud)", border: "var(--border-hairline)", borderRadius: "var(--radius-pill)" }}>
                {t("screenRecord.shortcutMac")}
              </Text>
              <Text size="xs" px={10} py={5} style={{ background: "var(--color-cloud)", border: "var(--border-hairline)", borderRadius: "var(--radius-pill)" }}>
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

        </Stack>
      </Paper>

      <Paper withBorder radius="md" p="md" style={{ background: "var(--color-cloud)" }}>
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

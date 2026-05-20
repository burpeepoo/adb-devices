import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { Button, Group, Paper, Stack, Text } from "@mantine/core";
import { IconCamera, IconExternalLink, IconPhoto } from "@tabler/icons-react";
import PathSelector from "./common/PathSelector";
import ResultAlert from "./common/ResultAlert";

interface Props {
  deviceSerial: string | null;
  saveDir: string;
  shortcutResult?: {
    id: number;
    ok: boolean;
    msg: string;
    path?: string | null;
  } | null;
  onSaveDirChange: (dir: string) => void;
}

export default function Screenshot({ deviceSerial, saveDir, shortcutResult, onSaveDirChange }: Props) {
  const { t } = useTranslation();
  const [taking, setTaking] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [lastPath, setLastPath] = useState<string | null>(null);

  const handleScreenshot = useCallback(async (openPreview = false) => {
    if (!saveDir) {
      setResult({ ok: false, msg: t('screenshot.noSaveDir') });
      return;
    }
    if (taking) {
      return;
    }
    setTaking(true);
    setResult(null);
    try {
      const path = await invoke<string>("adb_screenshot", {
        saveDir,
        deviceSerial: deviceSerial || null,
      });
      setLastPath(path);
      if (openPreview) {
        try {
          await invoke("open_file", { path });
        } catch {
          // fallback: reveal in folder
        }
      }
      setResult({ ok: true, msg: t('screenshot.saved', { path }) });
    } catch (e) {
      setResult({ ok: false, msg: String(e) });
    } finally {
      setTaking(false);
    }
  }, [deviceSerial, saveDir, taking, t]);

  useEffect(() => {
    if (!shortcutResult) {
      return;
    }

    setResult({ ok: shortcutResult.ok, msg: shortcutResult.msg });
    if (shortcutResult.path) {
      setLastPath(shortcutResult.path);
    }
  }, [shortcutResult]);

  const handleSelectSaveDir = async () => {
    try {
      const dir = await invoke<string | null>("select_directory");
      if (dir) {
        onSaveDirChange(dir);
        setResult({ ok: true, msg: t('screenshot.dirChanged', { dir }) });
      }
    } catch {
      setResult({ ok: false, msg: t('screenshot.changeDirFailed') });
    }
  };

  const handleOpenFolder = async () => {
    if (lastPath) {
      try {
        await invoke("reveal_path", { path: lastPath });
      } catch {
        setResult({ ok: false, msg: t('screenshot.openFolderFailed') });
      }
    }
  };

  return (
    <Stack maw={680} gap="md">
      <Paper withBorder radius="md" p="md">
        <Stack gap="md">
          <Text fw={700}>{t("screenshot.title")}</Text>

          <PathSelector
            label={t("screenshot.saveDir")}
            value={saveDir}
            emptyLabel={t("screenshot.notSet")}
            actionLabel={t("screenshot.changeDir")}
            onSelect={handleSelectSaveDir}
          />

          <Group grow>
            <Button leftSection={<IconCamera size={17} />} loading={taking} onClick={() => handleScreenshot(false)}>
              {t("screenshot.take")}
            </Button>
            <Button variant="filled" color="dark" leftSection={<IconPhoto size={17} />} loading={taking} onClick={() => handleScreenshot(true)}>
              {t("screenshot.takeAndPreview")}
            </Button>
          </Group>

          <Paper withBorder radius="md" p="sm" bg="blue.0">
            <Text size="xs" fw={700} c="blue.8">
              {t("screenshot.shortcutTitle")}
            </Text>
            <Text size="xs" c="blue.8" mt={4}>
              {t("screenshot.shortcutHint")}
            </Text>
            <Group gap="xs" mt="xs">
              <Text size="xs" px={8} py={4} bg="white" style={{ borderRadius: "var(--mantine-radius-sm)" }}>
                {t("screenshot.shortcutMac")}
              </Text>
              <Text size="xs" px={8} py={4} bg="white" style={{ borderRadius: "var(--mantine-radius-sm)" }}>
                {t("screenshot.shortcutWindows")}
              </Text>
            </Group>
          </Paper>

          <ResultAlert result={result} />

          {lastPath && (
            <Button variant="subtle" size="xs" leftSection={<IconExternalLink size={14} />} onClick={handleOpenFolder} style={{ alignSelf: "flex-start" }}>
              {t("screenshot.showInFolder")}
            </Button>
          )}

          {!deviceSerial && <ResultAlert warning result={{ ok: true, msg: t("screenshot.noDevice") }} />}
        </Stack>
      </Paper>
    </Stack>
  );
}

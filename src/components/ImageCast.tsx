import { useCallback, useEffect, useState } from "react";
import type { SyntheticEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { useTranslation } from "react-i18next";
import { Badge, Box, Button, Group, Paper, Stack, Switch, Text, TextInput } from "@mantine/core";
import { IconFolder, IconPhotoUp, IconPlayerPlay, IconUpload } from "@tabler/icons-react";
import CommandOutput from "./common/CommandOutput";
import ResultAlert from "./common/ResultAlert";
import SectionTitle from "./common/SectionTitle";
import DeviceTargetBanner from "./common/DeviceTargetBanner";
import { deviceTargetResultSuffix, type DeviceTargetState } from "../deviceTarget.ts";

interface Props {
  deviceTarget: DeviceTargetState;
  active: boolean;
}

interface ImageCastResult {
  remote_path: string;
  mime_type: string;
  pushed: boolean;
  scanned: boolean;
  opened: boolean;
  message: string;
}

const DEFAULT_REMOTE_DIR = "/sdcard/Pictures/ADBManager";
const SUPPORTED_EXTENSIONS = ["png", "jpg", "jpeg", "webp"];

const fileName = (path: string) => path.split(/[\\/]/).pop() || path;

const imageExtension = (path: string) => {
  const match = path.match(/\.([^.\\/]+)$/);
  return match ? match[1].toLowerCase() : "";
};

const isSupportedImage = (path: string) => SUPPORTED_EXTENSIONS.includes(imageExtension(path));

export default function ImageCast({ deviceTarget, active }: Props) {
  const { t } = useTranslation();
  const [selectedPath, setSelectedPath] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null);
  const [remoteDir, setRemoteDir] = useState(DEFAULT_REMOTE_DIR);
  const [openAfterPush, setOpenAfterPush] = useState(true);
  const [scanMedia, setScanMedia] = useState(true);
  const [lastResult, setLastResult] = useState<ImageCastResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingAction, setLoadingAction] = useState<"push" | "pushOpen" | "openLast" | null>(null);
  const [dragging, setDragging] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const loadImagePath = useCallback(async (path: string) => {
    if (!isSupportedImage(path)) {
      setResult({ ok: false, msg: t("imageCast.unsupportedFile") });
      return;
    }

    setSelectedPath(path);
    setImageSize(null);
    setResult(null);
    try {
      const dataUrl = await invoke<string>("read_image_preview_data_url", { localPath: path });
      setPreviewUrl(dataUrl);
    } catch (e) {
      setPreviewUrl(null);
      setResult({ ok: false, msg: String(e) });
    }
  }, [t]);

  useEffect(() => {
    if (!active) {
      setDragging(false);
      return;
    }

    let unlisten: (() => void) | null = null;
    let disposed = false;

    getCurrentWebview()
      .onDragDropEvent((event) => {
        const payload = event.payload;
        if (payload.type === "enter" || payload.type === "over") {
          setDragging(true);
          return;
        }

        if (payload.type === "drop") {
          setDragging(false);
          const path = payload.paths.find(isSupportedImage);
          if (path) {
            void loadImagePath(path);
          } else {
            setResult({ ok: false, msg: t("imageCast.unsupportedFile") });
          }
          return;
        }

        setDragging(false);
      })
      .then((unsubscribe) => {
        if (disposed) {
          unsubscribe();
        } else {
          unlisten = unsubscribe;
        }
      })
      .catch(() => {
        // Browser-only dev sessions do not expose Tauri drag-drop events.
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [active, loadImagePath, t]);

  const handleSelectImage = async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: t("imageCast.imageFilter"), extensions: SUPPORTED_EXTENSIONS }],
      title: t("imageCast.selectImageTitle"),
    });
    if (typeof selected === "string") {
      await loadImagePath(selected);
    }
  };

  const handlePush = async (pushAndOpen: boolean) => {
    if (!selectedPath || loading) return;
    if (!deviceTarget.serial) {
      setResult({ ok: false, msg: t(`deviceTarget.${deviceTarget.blockReason === "selected-device-not-online" ? "selectedUnavailable" : "selectOnlineDevice"}`) });
      return;
    }

    setLoading(true);
    setLoadingAction(pushAndOpen ? "pushOpen" : "push");
    setResult(null);
    try {
      const response = await invoke<ImageCastResult>("adb_push_reference_image", {
        localPath: selectedPath,
        deviceSerial: deviceTarget.serial,
        remoteDir,
        openAfterPush: pushAndOpen,
        scanMedia,
      });
      setLastResult(response);
      setResult({
        ok: pushAndOpen ? response.opened : response.pushed,
        msg: `${response.message} · ${deviceTargetResultSuffix(deviceTarget, t("deviceTarget.resultLabel"))}`,
      });
    } catch (e) {
      setResult({ ok: false, msg: String(e) });
    } finally {
      setLoading(false);
      setLoadingAction(null);
    }
  };

  const handleOpenLast = async () => {
    if (!lastResult || loading) return;
    if (!deviceTarget.serial) {
      setResult({ ok: false, msg: t(`deviceTarget.${deviceTarget.blockReason === "selected-device-not-online" ? "selectedUnavailable" : "selectOnlineDevice"}`) });
      return;
    }

    setLoading(true);
    setLoadingAction("openLast");
    setResult(null);
    try {
      const response = await invoke<ImageCastResult>("adb_open_reference_image", {
        remotePath: lastResult.remote_path,
        mimeType: lastResult.mime_type,
        deviceSerial: deviceTarget.serial,
        scanMedia,
      });
      setLastResult({ ...lastResult, ...response });
      setResult({ ok: response.opened, msg: `${response.message} · ${deviceTargetResultSuffix(deviceTarget, t("deviceTarget.resultLabel"))}` });
    } catch (e) {
      setResult({ ok: false, msg: String(e) });
    } finally {
      setLoading(false);
      setLoadingAction(null);
    }
  };

  const handleImageLoad = (event: SyntheticEvent<HTMLImageElement>) => {
    const image = event.currentTarget;
    setImageSize({ width: image.naturalWidth, height: image.naturalHeight });
  };

  const selectedName = selectedPath ? fileName(selectedPath) : t("imageCast.noImage");
  const dimensions = imageSize ? `${imageSize.width} x ${imageSize.height}` : t("imageCast.dimensionsPending");

  return (
    <Stack maw={820} gap="md">
      <Paper withBorder radius="md" p="md">
        <Stack gap="md">
          <Group justify="space-between" align="start">
            <SectionTitle
              icon={<IconPhotoUp size={17} />}
              label={t("imageCast.title")}
              description={t("imageCast.description")}
            />
            <Badge variant="light" color={deviceTarget.serial ? "green" : "yellow"}>
              {deviceTarget.serial ? t("imageCast.deviceReady") : t("imageCast.noDeviceShort")}
            </Badge>
          </Group>
          <DeviceTargetBanner target={deviceTarget} />

          <Box
            p="md"
            style={{
              border: `1px dashed ${dragging ? "var(--color-signal)" : "var(--color-edge)"}`,
              borderRadius: "var(--radius-card)",
              background: dragging ? "var(--surface-sunken)" : "var(--color-cloud)",
            }}
          >
            <Group justify="space-between" gap="md" align="center">
              <Group gap="sm" style={{ minWidth: 0, flex: 1 }}>
                <Box
                  style={{
                    width: 42,
                    height: 42,
                    borderRadius: "var(--radius-pill)",
                    display: "grid",
                    placeItems: "center",
                    background: "var(--color-indigo)",
                    color: "var(--color-white)",
                    border: "1px solid var(--color-indigo)",
                    flex: "0 0 auto",
                  }}
                >
                  <IconPhotoUp size={22} />
                </Box>
                <div style={{ minWidth: 0 }}>
                  <Text fw={600} truncate>
                    {selectedName}
                  </Text>
                  <Text size="xs" c="dimmed" truncate>
                    {selectedPath || t("imageCast.dropHint")}
                  </Text>
                </div>
              </Group>
              <Button variant="light" leftSection={<IconFolder size={16} />} onClick={handleSelectImage}>
                {t("imageCast.selectImage")}
              </Button>
            </Group>
          </Box>

          {previewUrl && (
            <Group align="stretch" gap="md">
              <Box
                style={{
                  width: 260,
                  minHeight: 160,
                  borderRadius: "var(--radius-tile)",
                  border: "var(--border-hairline)",
                  overflow: "hidden",
                  background: "var(--surface-sunken)",
                  display: "grid",
                  placeItems: "center",
                  flex: "0 0 auto",
                }}
              >
                <img
                  alt={t("imageCast.previewAlt")}
                  src={previewUrl}
                  onLoad={handleImageLoad}
                  onError={() => setResult({ ok: false, msg: t("imageCast.previewFailed") })}
                  style={{
                    width: "100%",
                    height: "100%",
                    maxHeight: 220,
                    objectFit: "contain",
                    display: "block",
                  }}
                />
              </Box>
              <Stack gap="xs" style={{ flex: 1, minWidth: 260 }}>
                <TextInput label={t("imageCast.remoteDir")} value={remoteDir} onChange={(event) => setRemoteDir(event.currentTarget.value)} />
                <Group gap="xs">
                  <Badge variant="light">{dimensions}</Badge>
                  <Badge variant="light">{imageExtension(selectedPath).toUpperCase()}</Badge>
                </Group>
                <Switch
                  checked={openAfterPush}
                  onChange={(event) => setOpenAfterPush(event.currentTarget.checked)}
                  label={t("imageCast.openAfterPush")}
                />
                <Switch
                  checked={scanMedia}
                  onChange={(event) => setScanMedia(event.currentTarget.checked)}
                  label={t("imageCast.scanMedia")}
                />
              </Stack>
            </Group>
          )}

          <Group grow>
            <Button
              leftSection={<IconUpload size={17} />}
              variant="light"
              disabled={!selectedPath || loading || !deviceTarget.serial}
              loading={loadingAction === "push"}
              onClick={() => handlePush(false)}
            >
              {t("imageCast.pushOnly")}
            </Button>
            <Button
              leftSection={<IconPhotoUp size={17} />}
              disabled={!selectedPath || loading || !deviceTarget.serial}
              loading={loadingAction === "pushOpen"}
              onClick={() => handlePush(openAfterPush)}
            >
              {openAfterPush ? t("imageCast.pushAndOpen") : t("imageCast.push")}
            </Button>
          </Group>

          {lastResult && (
            <Button
              variant="subtle"
              size="xs"
              leftSection={<IconPlayerPlay size={14} />}
              onClick={handleOpenLast}
              disabled={loading || !deviceTarget.serial}
              loading={loadingAction === "openLast"}
              style={{ alignSelf: "flex-start" }}
            >
              {t("imageCast.openLast")}
            </Button>
          )}

          <ResultAlert result={result} />

          {lastResult && (
            <CommandOutput
              title={t("imageCast.lastRemoteImage")}
              action={
                <Group gap={4}>
                  {lastResult.scanned && <Badge size="xs">{t("imageCast.scanned")}</Badge>}
                  {lastResult.opened && <Badge size="xs" color="green">{t("imageCast.openedStatus")}</Badge>}
                  {!lastResult.opened && <Badge size="xs" color="gray">{t("imageCast.notOpenedStatus")}</Badge>}
                </Group>
              }
            >
              {`${lastResult.remote_path}\n${lastResult.mime_type}\n${lastResult.message}`}
            </CommandOutput>
          )}
        </Stack>
      </Paper>
    </Stack>
  );
}

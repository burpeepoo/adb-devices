import { Button, Group, Modal, Select, Stack, TextInput } from "@mantine/core";
import { IconFolder } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { AppSettings, LanguagePreference } from "../types";

interface Props {
  settings: AppSettings;
  onSettingsChange: (settings: AppSettings) => void;
  onClose: () => void;
}

export default function Settings({ settings, onSettingsChange, onClose }: Props) {
  const { t } = useTranslation();
  const [local, setLocal] = useState(settings);

  useEffect(() => {
    setLocal(settings);
  }, [settings]);

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

import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { invoke } from "@tauri-apps/api/core";
import zhCN from "./locales/zh-CN.json";
import enUS from "./locales/en-US.json";
import type { LanguagePreference } from "./types";

const SUPPORTED_LOCALES = ["zh-CN", "en-US"] as const;
type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export function mapLocale(detected: string): SupportedLocale {
  if (detected.toLowerCase().startsWith("zh")) return "zh-CN";
  return "en-US";
}

export function resolveLanguagePreference(preference: LanguagePreference = "system"): SupportedLocale {
  if (preference !== "system") return preference;
  return mapLocale(window.navigator.languages?.[0] || window.navigator.language || "en-US");
}

function syncBackendLocale(lng: string) {
  const backendLocale = lng === "zh-CN" ? "zh-CN" : "en";
  invoke("set_locale", { locale: backendLocale }).catch(() => {
    // Backend localization is best-effort; frontend copy still works.
  });
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      "zh-CN": { translation: zhCN },
      "en-US": { translation: enUS },
    },
    fallbackLng: "en-US",
    supportedLngs: SUPPORTED_LOCALES,
    interpolation: { escapeValue: false },
    detection: {
      order: ["navigator"],
      caches: [],
      convertDetectedLanguage: mapLocale,
    },
  });

document.documentElement.lang = i18n.language;
syncBackendLocale(i18n.language);

i18n.on("languageChanged", (lng) => {
  document.documentElement.lang = lng;
  syncBackendLocale(lng);
});

export async function applyLanguagePreference(preference: LanguagePreference = "system") {
  const nextLanguage = resolveLanguagePreference(preference);
  if (i18n.language === nextLanguage) {
    syncBackendLocale(nextLanguage);
    return;
  }
  await i18n.changeLanguage(nextLanguage);
}

export default i18n;

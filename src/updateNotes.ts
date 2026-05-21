type SupportedNoteLocale = "en-US" | "zh-CN";

const LOCALE_LABELS: Record<SupportedNoteLocale, string[]> = {
  "en-US": ["en-US", "en", "English"],
  "zh-CN": ["zh-CN", "zh", "中文", "Chinese"],
};

function resolveNoteLocale(language?: string): SupportedNoteLocale {
  return language?.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
}

function normalizeLabel(label: string): SupportedNoteLocale | null {
  const normalized = label.trim().toLowerCase();
  for (const [locale, labels] of Object.entries(LOCALE_LABELS) as Array<[SupportedNoteLocale, string[]]>) {
    if (labels.some((value) => value.toLowerCase() === normalized)) {
      return locale;
    }
  }
  return null;
}

function cleanNoteText(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^#+\s+/, "").replace(/^\s*[-*]\s+/, "").trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parseLocalizedNotes(body: string): Partial<Record<SupportedNoteLocale, string>> {
  const notes: Partial<Record<SupportedNoteLocale, string>> = {};
  let activeLocale: SupportedNoteLocale | null = null;

  for (const rawLine of body.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    const prefixMatch = /^([A-Za-z-]+|中文)\s*:\s*(.*)$/.exec(trimmed);
    const markdownMatch = /^##\s+(.+)$/.exec(trimmed);
    const locale = prefixMatch ? normalizeLabel(prefixMatch[1]) : markdownMatch ? normalizeLabel(markdownMatch[1]) : null;

    if (locale) {
      activeLocale = locale;
      if (!notes[activeLocale]) {
        notes[activeLocale] = "";
      }
      if (prefixMatch?.[2]) {
        notes[activeLocale] = `${notes[activeLocale] ? `${notes[activeLocale]}\n` : ""}${prefixMatch[2]}`;
      }
      continue;
    }

    if (activeLocale && trimmed) {
      notes[activeLocale] = `${notes[activeLocale] ? `${notes[activeLocale]}\n` : ""}${rawLine}`;
    }
  }

  return Object.fromEntries(
    Object.entries(notes).map(([locale, text]) => [locale, cleanNoteText(text ?? "")])
  ) as Partial<Record<SupportedNoteLocale, string>>;
}

export function selectUpdateNoteBody(body: string | undefined, language?: string): string {
  if (!body) return "";

  const locale = resolveNoteLocale(language);
  const notes = parseLocalizedNotes(body);
  return notes[locale] || notes["en-US"] || notes["zh-CN"] || cleanNoteText(body);
}

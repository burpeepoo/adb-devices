export function extractClipboardPaths(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean)
    .map((line) => {
      if (!line.startsWith("file://")) return line;
      try {
        return decodeURIComponent(new URL(line).pathname);
      } catch {
        return line;
      }
    });
}

export function isLikelyLocalPath(value: string): boolean {
  return (
    value.startsWith("/") ||
    value.startsWith("~/") ||
    /^[A-Za-z]:[\\/]/.test(value)
  );
}

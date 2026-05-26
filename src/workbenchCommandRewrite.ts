export type RewriteAdbShellBatchResult =
  | { ok: true; command: string; count: number }
  | { ok: false; reason: "empty" }
  | { ok: false; reason: "unsupported"; line: number; command: string };

export function rewriteAdbShellBatch(input: string): RewriteAdbShellBatchResult {
  const shellCommands: string[] = [];

  for (const [index, rawLine] of input.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const adbSubcommand = stripAdbInvocation(line);
    const shellCommand = stripShellPrefix(adbSubcommand);
    if (!shellCommand) {
      return {
        ok: false,
        reason: "unsupported",
        line: index + 1,
        command: line,
      };
    }

    shellCommands.push(shellCommand);
  }

  if (shellCommands.length === 0) {
    return { ok: false, reason: "empty" };
  }

  return {
    ok: true,
    command: `shell ${quoteArg(shellCommands.join("; "))}`,
    count: shellCommands.length,
  };
}

function stripAdbInvocation(line: string) {
  const withoutAdb = line.replace(/^adb(?:\s+-s\s+(?:'[^']*'|"[^"]*"|\S+))?\s+/, "");
  return withoutAdb.trim();
}

function stripShellPrefix(command: string) {
  const match = command.match(/^shell(?:\s+(.+))?$/);
  const shellCommand = match?.[1]?.trim() || "";
  return shellCommand || null;
}

function quoteArg(value: string) {
  if (/^[A-Za-z0-9._:/=-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}

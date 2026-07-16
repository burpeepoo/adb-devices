import type { AgentCliProfile, AgentCliSettings } from "./types";

export const BUILT_IN_AGENT_CLI_PROFILES: AgentCliProfile[] = [
  {
    id: "codex_cli",
    kind: "codex_cli",
    name: "Codex CLI",
    command: "codex",
    args: [],
    builtIn: true,
  },
  {
    id: "claude_code",
    kind: "claude_code",
    name: "Claude Code",
    command: "claude",
    args: [],
    builtIn: true,
  },
];

export const CUSTOM_AGENT_CLI_PROFILE_ID = "custom_cli";
export const DEFAULT_AUTONOMOUS_SCOUT_REASONING_EFFORT = "medium";

export function defaultAgentCliSettings(): AgentCliSettings {
  return {
    globalProfileId: "codex_cli",
    profiles: [
      ...BUILT_IN_AGENT_CLI_PROFILES,
      {
        id: CUSTOM_AGENT_CLI_PROFILE_ID,
        kind: "custom_cli",
        name: "Custom CLI",
        command: "",
        args: [],
        cwd: "",
        notes: "",
      },
    ],
    perDeviceProfileIds: {},
  };
}

export function normalizeAgentCliSettings(settings: AgentCliSettings | undefined): AgentCliSettings {
  const defaults = defaultAgentCliSettings();
  const incomingProfiles = settings?.profiles ?? [];
  const profiles = defaults.profiles.map((defaultProfile) => {
    const saved = incomingProfiles.find((profile) => profile.id === defaultProfile.id);
    return saved ? { ...defaultProfile, ...saved, builtIn: defaultProfile.builtIn } : defaultProfile;
  });
  for (const profile of incomingProfiles) {
    if (!profiles.some((item) => item.id === profile.id)) {
      profiles.push(profile);
    }
  }
  const profileIds = new Set(profiles.map((profile) => profile.id));
  const globalProfileId = profileIds.has(settings?.globalProfileId ?? "")
    ? settings!.globalProfileId
    : defaults.globalProfileId;

  return {
    globalProfileId,
    profiles,
    perDeviceProfileIds: cleanPerDeviceProfiles(settings?.perDeviceProfileIds ?? {}, profileIds),
  };
}

export function resolveAgentCliProfile(
  settings: AgentCliSettings | undefined,
  deviceKey: string | null,
): AgentCliProfile {
  const normalized = normalizeAgentCliSettings(settings);
  const profileId = deviceKey
    ? normalized.perDeviceProfileIds[deviceKey] || normalized.globalProfileId
    : normalized.globalProfileId;
  return (
    normalized.profiles.find((profile) => profile.id === profileId) ??
    normalized.profiles.find((profile) => profile.id === normalized.globalProfileId) ??
    normalized.profiles[0]
  );
}

/**
 * Autonomous Scout turns need a bounded default so a blank per-profile effort
 * does not inherit an unexpectedly deep local CLI setting. Explicit user
 * choices remain authoritative.
 */
export function resolveAutonomousScoutCliProfile(profile: AgentCliProfile): AgentCliProfile {
  if (profile.reasoningEffortOverride?.trim()) return profile;
  return {
    ...profile,
    reasoningEffortOverride: DEFAULT_AUTONOMOUS_SCOUT_REASONING_EFFORT,
  };
}

export function splitAgentCliArgs(value: string): string[] {
  return value
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function joinAgentCliArgs(args: string[] | undefined): string {
  return (args ?? []).join(" ");
}

function cleanPerDeviceProfiles(perDeviceProfileIds: Record<string, string>, profileIds: Set<string>) {
  return Object.fromEntries(
    Object.entries(perDeviceProfileIds).filter(([, profileId]) => profileIds.has(profileId)),
  );
}

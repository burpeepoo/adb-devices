export interface DeviceInfo {
  serial: string;
  device_sn: string;
  state: "device" | "offline" | "unauthorized" | "disconnected";
  model: string;
  product: string;
  connection_type: "usb" | "wireless" | "unknown";
}

export interface DeviceSummary {
  android_version: string;
  api_level: string;
  build_tags: string;
  verified_boot_state: string;
  vbmeta_device_state: string;
  bootloader_state: string;
  battery_level: string;
  battery_status: string;
  display_size: string;
  display_density: string;
  display_physical_size_mm: string;
  storage: string;
  foreground_app: string;
  security_patch: string;
  selinux: string;
  uptime: string;
  cpu_abi: string;
  build_fingerprint: string;
}

export interface DeviceHistoryItem extends DeviceInfo {
  lastSeen: number;
}

export interface MdnsDevice {
  service_name: string;
  service_type: string;
  ip: string;
  port: string;
  address: string;
  connectable: boolean;
}

export interface PackageInfo {
  name: string;
  version_name: string;
  version_code: string;
  device_serial: string;
  build_number: string;
}

export interface LaunchableApp {
  package_name: string;
  activity_name: string;
  component_name: string;
  label: string;
  icon_data_url: string | null;
}

export interface LaunchableAppAsset {
  package_name: string;
  activity_name: string;
  label: string | null;
  icon_data_url: string | null;
  cache_stale: boolean;
}

export interface ExportedApk {
  package_name: string;
  output_dir: string;
  files: string[];
}

export interface LogcatEntry {
  timestamp: string;
  level: string;
  pid: string;
  tag: string;
  message: string;
}

export interface PerformanceSample {
  timestamp_ms: number;
  device_serial: string;
  sample_source: PerformanceSampleSource;
  agent_status: PerformanceAgentStatus | null;
  target_package: string | null;
  foreground_package: string | null;
  foreground_activity: string | null;
  pid: number | null;
  process: PerformanceProcessSample;
  system: PerformanceSystemSample;
  battery: PerformanceBatterySample;
  thermal: PerformanceThermalSample;
  display: PerformanceDisplaySample;
  network: PerformanceNetworkSample;
  storage: PerformanceStorageSample;
  gpu: PerformanceGpuSample;
  frame_stats: PerformanceFrameStats | null;
  unavailable: string[];
}

export type PerformanceSampleSource = "adb" | "agent" | "merged";

export type PerformanceAgentStatus =
  | "missing"
  | "installing"
  | "starting"
  | "update_available"
  | "connected"
  | "permission_limited"
  | "failed";

export interface PerformanceAgentStatusResponse {
  device_serial: string;
  package_name: string;
  status: PerformanceAgentStatus;
  installed: boolean;
  apk_available: boolean;
  forwarded_port: number | null;
  version_name: string | null;
  bundled_version_name: string | null;
  protocol_version: number | null;
  update_available: boolean;
  started_at_ms: number | null;
  message: string | null;
}

export interface PerformanceStreamSnapshot {
  active: boolean;
  device_serial: string;
  target_package: string | null;
  follow_foreground: boolean;
  interval_ms: number;
  started_at_ms: number;
  last_sample: PerformanceSample | null;
  last_error: string | null;
}

export interface PerformanceProcessSample {
  package_name: string | null;
  pid: number | null;
  state: string | null;
  cpu_jiffies: number | null;
  rss_kb: number | null;
  pss_kb: number | null;
  thread_count: number | null;
  running: boolean;
}

export interface PerformanceSystemSample {
  cpu_total_jiffies: number | null;
  cpu_idle_jiffies: number | null;
  mem_total_kb: number | null;
  mem_available_kb: number | null;
  mem_used_kb: number | null;
  cpu_frequency: {
    average_current_khz: number | null;
    average_max_khz: number | null;
    online_cores: number;
  };
}

export interface PerformanceBatterySample {
  level_percent: number | null;
  status: string | null;
  temperature_c: number | null;
}

export interface PerformanceThermalSample {
  status: number | null;
  status_label: string | null;
  raw: string | null;
}

export interface PerformanceDisplaySample {
  size: string | null;
  density: string | null;
  refresh_rate_hz: number | null;
}

export interface PerformanceNetworkSample {
  rx_bytes: number | null;
  tx_bytes: number | null;
}

export interface PerformanceStorageSample {
  data_total_kb: number | null;
  data_used_kb: number | null;
  data_available_kb: number | null;
}

export interface PerformanceGpuSample {
  supported: boolean;
  busy_percent: number | null;
  busy_time: number | null;
  total_time: number | null;
  current_frequency_hz: number | null;
  max_frequency_hz: number | null;
  memory_total_bytes: number | null;
  process_memory_bytes: number | null;
  source: string | null;
  reason: string | null;
  raw: string | null;
}

export interface PerformanceFrameStats {
  supported: boolean;
  frame_count: number;
  fps: number | null;
  average_frame_ms: number | null;
  p50_frame_ms: number | null;
  p95_frame_ms: number | null;
  jank_count: number;
  jank_rate: number | null;
  reason: string | null;
}

export interface AppSettings {
  screenshotDir: string;
  recordingDir: string;
  recentApkDir: string;
  languagePreference?: LanguagePreference;
  autoCheckUpdates?: boolean;
  agentCli?: AgentCliSettings;
  agentProviders?: AgentProviderSettings;
}

export type LanguagePreference = "system" | "en-US" | "zh-CN";

export type AgentCliKind = "codex_cli" | "claude_code" | "custom_cli";

export interface AgentCliProfile {
  id: string;
  kind: AgentCliKind;
  name: string;
  command: string;
  args: string[];
  cwd?: string;
  notes?: string;
  builtIn?: boolean;
}

export interface AgentCliSettings {
  globalProfileId: string;
  profiles: AgentCliProfile[];
  perDeviceProfileIds: Record<string, string>;
}

export type AgentApiProviderKind = "openai_compatible" | "anthropic_api";

export interface AgentApiProviderConfig {
  id: string;
  kind: AgentApiProviderKind;
  name: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  enabled: boolean;
}

export interface AgentProviderSettings {
  defaultProviderId: string;
  apiProviders: AgentApiProviderConfig[];
}

export type AndroidAgentSkillId =
  | "device_report"
  | "performance_triage"
  | "black_screen_triage"
  | "calendar_sync_triage"
  | "install_failure_triage"
  | "wireless_adb_triage"
  | "input_touch_triage"
  | "package_state_triage"
  | "network_triage"
  | "logcat_crash_triage"
  | "storage_pressure_triage";

export interface AndroidAgentSkillStep {
  id: string;
  title: string;
  command: string;
  why: string;
}

export interface AndroidAgentSkill {
  id: AndroidAgentSkillId;
  title: string;
  summary: string;
  localPath: string;
  requiresAgentApk: boolean;
  triggerKeywords: string[];
  steps: AndroidAgentSkillStep[];
  acceptance: string[];
}

export interface AgentCopilotAttachment {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  textPreview?: string;
  createdAt: number;
}

export interface AgentCopilotMessage {
  id: string;
  role: "user" | "assistant" | "system" | "command";
  body: string;
  createdAt: number;
  skillId?: AndroidAgentSkillId;
  command?: string;
  ok?: boolean;
  thinking?: boolean;
  approval?: AgentApprovalRequest;
  attachments?: AgentCopilotAttachment[];
}

export interface AgentApprovalRequest {
  id: string;
  tool: string;
  command: string;
  risk: "low" | "medium" | "high";
  reason: string;
  status: "pending" | "running" | "approved" | "denied";
  evidenceKind?: EvidenceSessionKind;
}

export interface AgentCopilotSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  deviceKey: string | null;
  deviceSerial: string | null;
  skillId: AndroidAgentSkillId;
  cliProfileId: string;
  workingDirectory?: string | null;
  messages: AgentCopilotMessage[];
}

export type EvidenceSessionKind = "walkthrough" | "bug_repro";
export type EvidenceSessionStatus = "active" | "closed";
export type EvidenceArtifactType =
  | "screenshot"
  | "recording"
  | "logcat"
  | "note"
  | "issue"
  | "remote_audit"
  | "screen_state"
  | "agent_note";
export type EvidenceScribeIntensity = "quiet" | "key_moments" | "live";
export type ScoutTaskPermissionLevel = "read_only" | "semi_auto" | "auto_execute";

export interface EvidenceScribeState {
  enabled: boolean;
  intensity: EvidenceScribeIntensity;
  permissionLevel?: ScoutTaskPermissionLevel;
  goal: string;
  agentActive?: boolean;
  agentStartedAt?: number | null;
  agentStoppedAt?: number | null;
  lastReviewedArtifactId?: string | null;
  coverageSummary?: string;
  issuesSummary?: string;
  gapsSummary?: string;
  nextAction?: string;
}

export interface EvidenceArtifact {
  id: string;
  type: EvidenceArtifactType;
  title: string;
  createdAt: number;
  body?: string;
  path?: string;
  metadata?: Record<string, unknown>;
}

export interface EvidenceSession {
  id: string;
  kind: EvidenceSessionKind;
  status: EvidenceSessionStatus;
  title: string;
  createdAt: number;
  updatedAt: number;
  closedAt?: number;
  deviceKey: string | null;
  deviceSerial: string | null;
  workingDirectory?: string | null;
  capturePolicy: {
    screenshots: boolean;
    remoteAudit: boolean;
    logcatOnIssue: boolean;
  };
  scribe?: EvidenceScribeState;
  artifacts: EvidenceArtifact[];
}

export interface PairConnectSettings {
  pairIp: string;
  pairPort: string;
  connectIp: string;
  connectPort: string;
  recentConnects?: RecentConnectEndpoint[];
}

export interface RecentConnectEndpoint {
  ip: string;
  port: string;
  lastConnectedAt: number;
}

export type TabKey =
  | "pair"
  | "workbench"
  | "install"
  | "screenshot"
  | "record"
  | "mirror"
  | "remote"
  | "imageCast"
  | "clipboard"
  | "logcat"
  | "displayCalibration"
  | "agent"
  | "performance"
  | "packages";

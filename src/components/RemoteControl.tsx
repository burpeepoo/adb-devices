import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { Badge, Button, Code, CopyButton, Group, Paper, Stack, Text } from "@mantine/core";
import { IconCopy, IconPlayerPlay, IconPower, IconRefresh, IconRouter } from "@tabler/icons-react";
import ResultAlert from "./common/ResultAlert";
import SectionTitle from "./common/SectionTitle";
import { buildRemoteSafetySummary, type RemoteSafetySummary } from "../remoteSafety.ts";

type RemoteRole = "viewer" | "operator" | "admin";
type RemoteAddressKind = "tailscale" | "lan" | "localhost";

interface RemoteAuditEntry {
  ts_ms: number;
  session_id?: string;
  role?: string;
  action: string;
  serial: string;
  ok: boolean;
  message: string;
}

interface RemoteAddress {
  kind: RemoteAddressKind;
  label: string;
  host: string;
  url: string;
}

interface RemoteInviteLink {
  role: RemoteRole;
  url: string;
  qr_svg?: string | null;
  expires_at_ms: number;
  used: boolean;
}

interface RemoteSessionInfo {
  id: string;
  role: RemoteRole;
  client_name: string;
  connected_at_ms: number;
  last_seen_ms: number;
}

interface RemoteControlOwner {
  session_id: string | null;
  role: RemoteRole | null;
  acquired_at_ms: number | null;
}

interface RemoteStreamDefaults {
  fps: number;
  jpeg_quality: number;
  max_width: number;
}

interface RemoteTrustedDeviceInfo {
  id: string;
  role: RemoteRole;
  client_name: string;
  created_at_ms: number;
  expires_at_ms: number;
  last_seen_ms: number;
}

interface RemoteControlStatus {
  enabled: boolean;
  port: number | null;
  pin: string | null;
  pin_used: boolean;
  urls: string[];
  addresses?: RemoteAddress[];
  invite_links?: RemoteInviteLink[];
  sessions?: RemoteSessionInfo[];
  trusted_devices?: RemoteTrustedDeviceInfo[];
  control_owner?: RemoteControlOwner;
  stream_defaults?: RemoteStreamDefaults;
  qr_svg: string | null;
  started_at_ms: number | null;
  audit: RemoteAuditEntry[];
}

const roleColor: Record<RemoteRole, string> = {
  viewer: "gray",
  operator: "blue",
  admin: "red",
};

const addressColor: Record<RemoteAddressKind, string> = {
  tailscale: "green",
  lan: "blue",
  localhost: "gray",
};

export default function RemoteControl() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<RemoteControlStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const next = await invoke<RemoteControlStatus>("remote_control_status");
      setStatus(next);
    } catch (e) {
      setResult({ ok: false, msg: String(e) });
    }
  }, []);

  useEffect(() => {
    loadStatus();
    const timer = window.setInterval(loadStatus, 5000);
    return () => window.clearInterval(timer);
  }, [loadStatus]);

  const handleStart = async () => {
    if (loading) return;
    setLoading(true);
    setResult(null);
    try {
      const next = await invoke<RemoteControlStatus>("remote_control_start");
      setStatus(next);
      setResult({ ok: true, msg: t("remoteControl.started") });
    } catch (e) {
      setResult({ ok: false, msg: String(e) });
    } finally {
      setLoading(false);
    }
  };

  const handleStop = async () => {
    if (loading) return;
    setLoading(true);
    setResult(null);
    try {
      const next = await invoke<RemoteControlStatus>("remote_control_stop");
      setStatus(next);
      setResult({ ok: true, msg: t("remoteControl.stopped") });
    } catch (e) {
      setResult({ ok: false, msg: String(e) });
    } finally {
      setLoading(false);
    }
  };

  const handleRevokeTrustedDevice = async (id: string) => {
    setResult(null);
    try {
      const trustedDevices = await invoke<RemoteTrustedDeviceInfo[]>("remote_control_revoke_trusted_device", { id });
      setStatus((current) => (current ? { ...current, trusted_devices: trustedDevices } : current));
      setResult({ ok: true, msg: t("remoteControl.trustRevoked") });
    } catch (e) {
      setResult({ ok: false, msg: String(e) });
    }
  };

  const handleRevokeAllTrustedDevices = async () => {
    setResult(null);
    try {
      const trustedDevices = await invoke<RemoteTrustedDeviceInfo[]>("remote_control_revoke_all_trusted_devices");
      setStatus((current) => (current ? { ...current, trusted_devices: trustedDevices } : current));
      setResult({ ok: true, msg: t("remoteControl.trustRevoked") });
    } catch (e) {
      setResult({ ok: false, msg: String(e) });
    }
  };

  const recentAudit = useMemo(() => {
    return [...(status?.audit || [])].reverse().slice(0, 6);
  }, [status?.audit]);

  const addresses = useMemo(() => {
    if (status?.addresses?.length) return status.addresses;
    return (status?.urls || []).map((url) => ({
      kind: url.includes("127.0.0.1") || url.includes("localhost") ? "localhost" : "lan",
      label: url.includes("127.0.0.1") || url.includes("localhost") ? "Localhost" : "LAN",
      host: url,
      url,
    })) as RemoteAddress[];
  }, [status?.addresses, status?.urls]);

  const safetySummary = useMemo<RemoteSafetySummary | null>(() => {
    if (!status) return null;
    return buildRemoteSafetySummary({
      enabled: status.enabled,
      addresses,
      sessions: status.sessions || [],
      trusted_devices: status.trusted_devices || [],
      control_owner: status.control_owner || { session_id: null, role: null, acquired_at_ms: null },
      stream_defaults: status.stream_defaults || null,
    });
  }, [addresses, status]);

  const roleLabel = (role: RemoteRole) => t(`remoteControl.roles.${role}`);
  const roleDescription = (role: RemoteRole) => t(`remoteControl.roleDescriptions.${role}`);

  return (
    <Stack maw={760} gap="md">
      <Paper withBorder radius="md" p="md">
        <Stack gap="md">
          <Group justify="space-between" align="flex-start">
            <SectionTitle icon={<IconRouter size={17} />} label={t("remoteControl.title")} />
            <Badge color={status?.enabled ? "green" : "gray"} variant="light">
              {status?.enabled ? t("remoteControl.enabled") : t("remoteControl.disabled")}
            </Badge>
          </Group>

          <Text size="sm" c="dimmed">
            {t("remoteControl.description")}
          </Text>

          <Group>
            <Button leftSection={<IconPlayerPlay size={17} />} loading={loading} disabled={status?.enabled} onClick={handleStart}>
              {t("remoteControl.start")}
            </Button>
            <Button variant="light" color="red" leftSection={<IconPower size={17} />} loading={loading} disabled={!status?.enabled} onClick={handleStop}>
              {t("remoteControl.stopSession")}
            </Button>
            <Button variant="subtle" leftSection={<IconRefresh size={17} />} onClick={loadStatus}>
              {t("remoteControl.refresh")}
            </Button>
          </Group>
          {status?.enabled && (
            <Text size="xs" c="dimmed">
              {t("remoteControl.stopSessionDesc")}
            </Text>
          )}

          <ResultAlert result={result} />
          {safetySummary && <RemoteSafetySummaryPanel summary={safetySummary} />}

          {status?.enabled ? (
            <Stack gap="md">
              <Group align="flex-start" gap="lg">
                {status.qr_svg && (
                  <Paper withBorder radius="md" p="xs" bg="white">
                    <div aria-label={t("remoteControl.qrAlt")} dangerouslySetInnerHTML={{ __html: status.qr_svg }} />
                  </Paper>
                )}
                <Stack gap="xs" style={{ flex: 1 }}>
                  <Text size="xs" fw={700} c="dimmed">
                    {t("remoteControl.pin")}
                  </Text>
                  <Code fz={28} p="xs">
                    {status.pin}
                  </Code>
                  {status.pin_used && (
                    <Text size="xs" c="orange.7">
                      {t("remoteControl.pinUsed")}
                    </Text>
                  )}
                </Stack>
              </Group>

              <Stack gap="xs">
                <Text size="xs" fw={700} c="dimmed">
                  {t("remoteControl.addresses")}
                </Text>
                {addresses.map((address) => (
                  <Group key={`${address.kind}-${address.url}`} gap="xs" wrap="nowrap">
                    <Badge color={addressColor[address.kind]} variant="light" style={{ minWidth: 84 }}>
                      {address.label}
                    </Badge>
                    <Code style={{ flex: 1, overflowWrap: "anywhere" }}>{address.url}</Code>
                    <CopyButton value={address.url}>
                      {({ copied, copy }) => (
                        <Button size="xs" variant="light" leftSection={<IconCopy size={14} />} onClick={copy}>
                          {copied ? t("remoteControl.copied") : t("remoteControl.copy")}
                        </Button>
                      )}
                    </CopyButton>
                  </Group>
                ))}
              </Stack>

              {!!status.invite_links?.length && (
                <Stack gap="xs">
                  <Text size="xs" fw={700} c="dimmed">
                    {t("remoteControl.inviteLinks")}
                  </Text>
                  <Group align="stretch" grow>
                    {status.invite_links.map((link) => (
                      <Paper key={`${link.role}-${link.url}`} withBorder radius="md" p="sm" style={{ minWidth: 190 }}>
                        <Stack gap="xs">
                          <Group justify="space-between">
                            <Badge color={roleColor[link.role]} variant="light">
                              {roleLabel(link.role)}
                            </Badge>
                            {link.used && (
                              <Badge color="orange" variant="light">
                                {t("remoteControl.used")}
                              </Badge>
                            )}
                          </Group>
                          <Text size="xs" c="dimmed">
                            {roleDescription(link.role)}
                          </Text>
                          <Text size="xs" c="green.8">
                            {t("remoteControl.canDo", { value: t(`remoteControl.roleCapabilities.${link.role}.can`) })}
                          </Text>
                          <Text size="xs" c="red.7">
                            {t("remoteControl.cannotDo", { value: t(`remoteControl.roleCapabilities.${link.role}.cannot`) })}
                          </Text>
                          {link.qr_svg && (
                            <Paper withBorder radius="sm" p={4} bg="white" style={{ alignSelf: "center" }}>
                              <div aria-label={`${roleLabel(link.role)} ${t("remoteControl.qrAlt")}`} dangerouslySetInnerHTML={{ __html: link.qr_svg }} />
                            </Paper>
                          )}
                          <Code style={{ overflowWrap: "anywhere", opacity: link.used ? 0.55 : 1 }}>{link.url}</Code>
                          <CopyButton value={link.url}>
                            {({ copied, copy }) => (
                              <Button size="xs" variant="light" disabled={link.used} leftSection={<IconCopy size={14} />} onClick={copy}>
                                {copied ? t("remoteControl.copied") : t("remoteControl.copy")}
                              </Button>
                            )}
                          </CopyButton>
                          <Text size="xs" c="dimmed">
                            {t("remoteControl.expiresAt", { time: new Date(link.expires_at_ms).toLocaleTimeString() })}
                          </Text>
                        </Stack>
                      </Paper>
                    ))}
                  </Group>
                </Stack>
              )}

              <Stack gap="xs">
                <Group justify="space-between">
                  <Text size="xs" fw={700} c="dimmed">
                    {t("remoteControl.trustedDevices")}
                  </Text>
                  {!!status.trusted_devices?.length && (
                    <Button size="xs" color="red" variant="subtle" onClick={handleRevokeAllTrustedDevices}>
                      {t("remoteControl.revokeAllTrust")}
                    </Button>
                  )}
                </Group>
                {status.trusted_devices?.length ? (
                  status.trusted_devices.map((device) => (
                    <Group key={device.id} gap="xs" wrap="nowrap">
                      <Badge color={roleColor[device.role]} variant="light" style={{ minWidth: 84 }}>
                        {roleLabel(device.role)}
                      </Badge>
                      <Text size="xs" style={{ flex: 1, overflowWrap: "anywhere" }}>
                        {device.client_name} · {t("remoteControl.trustExpires", { time: new Date(device.expires_at_ms).toLocaleString() })}
                      </Text>
                      <Button size="xs" color="red" variant="light" onClick={() => handleRevokeTrustedDevice(device.id)}>
                        {t("remoteControl.revokeTrust")}
                      </Button>
                    </Group>
                  ))
                ) : (
                  <Text size="xs" c="dimmed">
                    {t("remoteControl.noTrustedDevices")}
                  </Text>
                )}
              </Stack>

              <Group align="stretch" grow>
                <Paper withBorder radius="md" p="sm">
                  <Text size="xs" fw={700} c="dimmed">
                    {t("remoteControl.sessions")}
                  </Text>
                  <Text size="xl" fw={700}>
                    {status.sessions?.length || 0}
                  </Text>
                </Paper>
                <Paper withBorder radius="md" p="sm">
                  <Text size="xs" fw={700} c="dimmed">
                    {t("remoteControl.controlOwner")}
                  </Text>
                  <Text size="sm" fw={700} style={{ overflowWrap: "anywhere" }}>
                    {safetySummary?.controlOwnerLabel || status.control_owner?.session_id || t("remoteControl.noControlOwner")}
                  </Text>
                </Paper>
                {status.stream_defaults && (
                  <Paper withBorder radius="md" p="sm">
                    <Text size="xs" fw={700} c="dimmed">
                      {t("remoteControl.stream")}
                    </Text>
                    <Text size="sm" fw={700}>
                      {status.stream_defaults.fps} fps · {status.stream_defaults.max_width}px
                    </Text>
                  </Paper>
                )}
              </Group>

              {!!status.sessions?.length && (
                <Stack gap="xs">
                  <Text size="xs" fw={700} c="dimmed">
                    {t("remoteControl.activeSessions")}
                  </Text>
                  {status.sessions.map((session) => (
                    <Group key={session.id} gap="xs" wrap="nowrap">
                      <Badge color={roleColor[session.role]} variant="light" style={{ minWidth: 84 }}>
                        {roleLabel(session.role)}
                      </Badge>
                      <Text size="xs" style={{ flex: 1, overflowWrap: "anywhere" }}>
                        {session.client_name} · {session.id}
                      </Text>
                    </Group>
                  ))}
                </Stack>
              )}
            </Stack>
          ) : (
            <ResultAlert warning result={{ ok: true, msg: t("remoteControl.disabledHint") }} />
          )}
        </Stack>
      </Paper>

      {recentAudit.length > 0 && (
        <Paper withBorder radius="md" p="md">
          <Stack gap="xs">
            <Text size="sm" fw={700}>
              {t("remoteControl.audit")}
            </Text>
            {recentAudit.map((entry) => (
              <Group key={`${entry.ts_ms}-${entry.action}-${entry.serial}`} justify="space-between" gap="xs">
                <Text size="xs" style={{ overflowWrap: "anywhere" }}>
                  {new Date(entry.ts_ms).toLocaleTimeString()} · {entry.role || "system"} · {entry.action} · {entry.serial}
                </Text>
                <Badge size="sm" color={entry.ok ? "green" : "red"} variant="light">
                  {entry.ok ? t("remoteControl.ok") : t("remoteControl.failed")}
                </Badge>
              </Group>
            ))}
          </Stack>
        </Paper>
      )}
    </Stack>
  );
}

function RemoteSafetySummaryPanel({ summary }: { summary: RemoteSafetySummary }) {
  const { t } = useTranslation();
  return (
    <Paper withBorder radius="md" p="sm" bg="gray.0">
      <Stack gap="xs">
        <Text size="xs" fw={700} c="dimmed">
          {t("remoteControl.safetySummary")}
        </Text>
        <Group align="stretch" grow>
          <SummaryMetric
            label={t("remoteControl.summary.service")}
            value={t(`remoteControl.summary.network.${summary.networkExposure}`)}
            color={summary.networkExposure === "off" ? "gray" : summary.networkExposure === "lan" ? "blue" : "green"}
          />
          <SummaryMetric
            label={t("remoteControl.summary.sessions")}
            value={t("remoteControl.summary.roleCounts", summary.roleCounts)}
            color="blue"
          />
          <SummaryMetric
            label={t("remoteControl.summary.control")}
            value={summary.controlOwnerLabel || t("remoteControl.noControlOwner")}
            color={summary.controlOwnerLabel ? "orange" : "gray"}
          />
        </Group>
        <Group align="stretch" grow>
          <SummaryMetric
            label={t("remoteControl.summary.trust")}
            value={t("remoteControl.summary.trustedDevices", {
              count: summary.trustedDeviceCount,
              expiring: summary.expiringTrustedDeviceCount,
            })}
            color={summary.expiringTrustedDeviceCount > 0 ? "yellow" : "gray"}
          />
          <SummaryMetric
            label={t("remoteControl.summary.stream")}
            value={summary.streamLabel || t("remoteControl.summary.streamOff")}
            color={summary.streamLabel ? "green" : "gray"}
          />
        </Group>
      </Stack>
    </Paper>
  );
}

function SummaryMetric({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <Paper withBorder radius="md" p="xs" bg="white">
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Badge color={color} variant="light" mt={5} style={{ maxWidth: "100%" }}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{value}</span>
      </Badge>
    </Paper>
  );
}

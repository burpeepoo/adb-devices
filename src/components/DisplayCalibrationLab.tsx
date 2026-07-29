import { useEffect, useMemo, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { IconColorSwatch } from "@tabler/icons-react";
import type { DeviceTargetState } from "../deviceTarget.ts";
import {
  applyDisplayCalibrationTarget,
  buildDisplayCalibrationExport,
  captureDisplayCalibrationSnapshot,
  diffDisplayCalibrationSnapshots,
  enableDisplayCalibrationRoot,
  openDisplayCalibrationTestPattern,
  readDisplayCalibrationTarget,
  type DisplayCalibrationApplyResult,
  type DisplayCalibrationCandidate,
  type DisplayCalibrationChangedValue,
  type DisplayCalibrationDiff,
  type DisplayCalibrationExportBundle,
  type DisplayCalibrationProfile,
  type DisplayCalibrationProfileParameter,
  type DisplayCalibrationSnapshot,
  type DisplayCalibrationTarget,
} from "../displayCalibration";
import {
  COLOR_TEMPERATURE_POINT_RANGE,
  COLOR_TEMPERATURE_POINT_CONTROL_ID,
  COLOR_TEMPERATURE_VALUE_CONTROL_ID,
  DISPLAY_CALIBRATION_CONTROLS,
  buildControlProfileParameter,
  clampColorTemperaturePointToNativeWheel,
  colorTemperatureNativeColorToCssColor,
  colorTemperaturePointToCssColor,
  colorTemperaturePointToNativeColor,
  controlValueFromCandidates,
  formatColorTemperaturePointForDisplay,
  formatColorTemperaturePoint,
  formatDisplayCalibrationTarget,
  parseColorTemperaturePoint,
  sameTarget,
  targetSignature,
  type DisplayCalibrationControlDefinition,
  updateColorTemperaturePointAxis,
} from "../displayCalibrationControls";
import { layoutDisplayCalibrationControlRows } from "../displayCalibrationControlBoard";
import DeviceTargetBanner from "./common/DeviceTargetBanner";
import SectionTitle from "./common/SectionTitle";
import "./DisplayCalibrationLab.css";

interface Props {
  deviceTarget: DeviceTargetState;
}

type BusyKey = "root" | "pattern" | "baseline" | "current" | "diff" | "apply" | "export" | "save";
type ControlStatus = { ok: boolean; msg: string };
type ControlBoardRow = {
  control: DisplayCalibrationControlDefinition;
  baselineValue: string | null;
  currentValue: string | null;
  draftValue: string;
  readbackValue: string | null;
  status: ControlStatus | null;
  busy: boolean;
  applying: boolean;
};
type SnapshotRefreshResult = {
  snapshot: DisplayCalibrationSnapshot | null;
  diff: DisplayCalibrationDiff | null;
  errorMessage: string | null;
};

const SHOW_CAPTURE_METRICS = false;
const SHOW_ADVANCED_PARAMETER_SECTIONS = false;

export default function DisplayCalibrationLab({ deviceTarget }: Props) {
  const { t } = useTranslation();
  const [baseline, setBaseline] = useState<DisplayCalibrationSnapshot | null>(null);
  const [current, setCurrent] = useState<DisplayCalibrationSnapshot | null>(null);
  const [diff, setDiff] = useState<DisplayCalibrationDiff | null>(null);
  const [selectedCandidateId, setSelectedCandidateId] = useState("");
  const [valueInput, setValueInput] = useState("");
  const [writeConfirmed, setWriteConfirmed] = useState(false);
  const [applyResult, setApplyResult] = useState<DisplayCalibrationApplyResult | null>(null);
  const [controlDrafts, setControlDrafts] = useState<Record<string, string>>({});
  const [controlBaselineValues, setControlBaselineValues] = useState<Record<string, string | null>>({});
  const [controlCurrentValues, setControlCurrentValues] = useState<Record<string, string | null>>({});
  const [controlReadbacks, setControlReadbacks] = useState<Record<string, string | null>>({});
  const [controlStatuses, setControlStatuses] = useState<Record<string, ControlStatus>>({});
  const [controlCurrentRefreshedAt, setControlCurrentRefreshedAt] = useState<string | null>(null);
  const [activeControlId, setActiveControlId] = useState<string | null>(null);
  const [liveApply, setLiveApply] = useState(false);
  const [exportBundle, setExportBundle] = useState<DisplayCalibrationExportBundle | null>(null);
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [busy, setBusy] = useState<BusyKey | null>(null);

  const candidates = useMemo(() => {
    const source = current?.candidates ?? baseline?.candidates ?? [];
    return [...source]
      .sort((left, right) => {
        if (left.writable !== right.writable) return left.writable ? -1 : 1;
        if (left.confidence !== right.confidence) return right.confidence - left.confidence;
        return left.label.localeCompare(right.label);
      })
      .slice(0, 160);
  }, [baseline, current]);

  const selectedCandidate = useMemo(
    () => candidates.find((candidate) => candidate.id === selectedCandidateId) ?? null,
    [candidates, selectedCandidateId],
  );

  const changedValues = diff?.changed ?? [];
  const controlRows = useMemo(
    () =>
      DISPLAY_CALIBRATION_CONTROLS.map((control) => {
        const sourceCandidates = current?.candidates ?? baseline?.candidates ?? [];
        const currentValue =
          controlCurrentValues[control.id] ?? controlValueFromCandidates(control, sourceCandidates);
        const baselineValue =
          controlBaselineValues[control.id] ?? controlValueFromCandidates(control, baseline?.candidates ?? []);
        const draftValue = controlDrafts[control.id] ?? currentValue ?? control.defaultValue;
        return {
          control,
          baselineValue,
          currentValue,
          draftValue,
          readbackValue: controlReadbacks[control.id] ?? null,
          status: controlStatuses[control.id] ?? null,
          busy: activeControlId === control.id,
          applying: activeControlId === control.id && busy === "apply",
        };
      }),
    [activeControlId, baseline, controlBaselineValues, controlCurrentValues, controlDrafts, controlReadbacks, controlStatuses, current],
  );
  const advancedProfileParameters = useMemo(
    () => (SHOW_ADVANCED_PARAMETER_SECTIONS ? buildProfileParameters(diff, selectedCandidate, valueInput, applyResult) : []),
    [applyResult, diff, selectedCandidate, valueInput],
  );
  const exportableCount = useMemo(
    () => controlRows.length + advancedProfileParameters.length,
    [advancedProfileParameters.length, controlRows.length],
  );

  useEffect(() => {
    if (selectedCandidateId && candidates.some((candidate) => candidate.id === selectedCandidateId)) {
      return;
    }
    const nextCandidate = candidates[0];
    setSelectedCandidateId(nextCandidate?.id ?? "");
    setValueInput(nextCandidate?.value ?? "");
  }, [candidates, selectedCandidateId]);

  useEffect(() => {
    const sourceCandidates = current?.candidates ?? baseline?.candidates ?? [];
    if (!sourceCandidates.length) return;
    setControlDrafts((previous) => {
      let changed = false;
      const next = { ...previous };
      for (const control of DISPLAY_CALIBRATION_CONTROLS) {
        const value = controlValueFromCandidates(control, sourceCandidates);
        if (value !== null && previous[control.id] !== value) {
          next[control.id] = value;
          changed = true;
        }
      }
      return changed ? next : previous;
    });
  }, [baseline, current]);

  const requireDeviceSerial = () => {
    if (deviceTarget.serial) return deviceTarget.serial;
    setStatus({ ok: false, msg: deviceBlockMessage(t, deviceTarget) });
    return null;
  };

  const refreshFixedControls = async (serial: string, mode: "baseline" | "current") => {
    const nextValues: Record<string, string | null> = {};
    const nextStatuses: Record<string, ControlStatus> = {};
    let successCount = 0;
    let failedCount = 0;
    let firmwareDeniedMessage: string | null = null;

    for (const control of DISPLAY_CALIBRATION_CONTROLS) {
      if (firmwareDeniedMessage && control.requiresHelper) {
        nextValues[control.id] = null;
        nextStatuses[control.id] = { ok: false, msg: firmwareDeniedMessage };
        failedCount += 1;
        continue;
      }

      setActiveControlId(control.id);
      setControlStatuses((previous) => ({
        ...previous,
        [control.id]: { ok: true, msg: t("displayCalibration.controlReading") },
      }));

      try {
        const result = await readDisplayCalibrationTarget(serial, control.target);
        const readbackValue = normalizeReadbackValue(result.readbackValue);
        if (result.success && readbackValue !== null) {
          nextValues[control.id] = readbackValue;
          nextStatuses[control.id] = {
            ok: true,
            msg: t("displayCalibration.controlReadDone", { value: readbackValue }),
          };
          successCount += 1;
        } else {
          const message = controlFailureMessage(result.stderr || result.stdout, t);
          nextValues[control.id] = null;
          nextStatuses[control.id] = { ok: false, msg: message };
          failedCount += 1;
          if (control.requiresHelper && isFirmwareDeniedMessage(message)) {
            firmwareDeniedMessage = message;
          }
        }
      } catch (error) {
        const message = controlFailureMessage(String(error), t);
        nextValues[control.id] = null;
        nextStatuses[control.id] = { ok: false, msg: message };
        failedCount += 1;
        if (control.requiresHelper && isFirmwareDeniedMessage(message)) {
          firmwareDeniedMessage = message;
        }
      }
    }

    setActiveControlId(null);
    if (mode === "baseline") {
      setControlBaselineValues((previous) => ({ ...previous, ...nextValues }));
    } else {
      setControlCurrentValues((previous) => ({ ...previous, ...nextValues }));
      setControlCurrentRefreshedAt(new Date().toISOString());
    }
    setControlStatuses((previous) => ({ ...previous, ...nextStatuses }));
    setControlDrafts((previous) => {
      let changed = false;
      const next = { ...previous };
      for (const control of DISPLAY_CALIBRATION_CONTROLS) {
        const value = nextValues[control.id];
        if (value !== null && value !== undefined && next[control.id] !== value) {
          next[control.id] = value;
          changed = true;
        }
      }
      return changed ? next : previous;
    });

    return { successCount, failedCount };
  };

  const captureAdvancedBaselineSnapshot = async (serial: string) => {
    try {
      const snapshot = await captureDisplayCalibrationSnapshot(serial);
      setBaseline(snapshot);
      return { snapshot, diff: null, errorMessage: null } satisfies SnapshotRefreshResult;
    } catch (error) {
      setBaseline(null);
      return {
        snapshot: null,
        diff: null,
        errorMessage: controlFailureMessage(String(error), t),
      } satisfies SnapshotRefreshResult;
    }
  };

  const refreshAdvancedCurrentSnapshot = async (serial: string) => {
    try {
      const snapshot = await captureDisplayCalibrationSnapshot(serial);
      let nextDiff: DisplayCalibrationDiff | null = null;
      if (baseline) {
        nextDiff = await diffDisplayCalibrationSnapshots(baseline, snapshot);
      }
      setCurrent(snapshot);
      setDiff(nextDiff);
      return { snapshot, diff: nextDiff, errorMessage: null } satisfies SnapshotRefreshResult;
    } catch (error) {
      setCurrent(null);
      setDiff(null);
      return {
        snapshot: null,
        diff: null,
        errorMessage: controlFailureMessage(String(error), t),
      } satisfies SnapshotRefreshResult;
    }
  };

  const handleOpenPattern = async () => {
    const serial = requireDeviceSerial();
    if (!serial || busy) return;
    setBusy("pattern");
    setStatus(null);
    try {
      const result = await openDisplayCalibrationTestPattern(serial);
      setStatus({ ok: result.opened, msg: result.message });
    } catch (error) {
      setStatus({ ok: false, msg: String(error) });
    } finally {
      setBusy(null);
    }
  };

  const handleEnableRoot = async () => {
    const serial = requireDeviceSerial();
    if (!serial || busy) return;
    if (!window.confirm(t("displayCalibration.confirmRoot"))) return;
    setBusy("root");
    setStatus(null);
    try {
      const result = await enableDisplayCalibrationRoot(serial);
      setStatus({
        ok: result.success,
        msg: result.success ? t("displayCalibration.rootEnabled", { message: result.message }) : result.message,
      });
    } catch (error) {
      setStatus({ ok: false, msg: controlFailureMessage(String(error), t) });
    } finally {
      setBusy(null);
    }
  };

  const handleCaptureBaseline = async () => {
    const serial = requireDeviceSerial();
    if (!serial || busy) return;
    setBusy("baseline");
    setStatus(null);
    try {
      const fixedControls = await refreshFixedControls(serial, "baseline");
      const snapshotResult = await captureAdvancedBaselineSnapshot(serial);
      setDiff(null);
      setExportBundle(null);
      const message = snapshotResult.snapshot
        ? `${t("displayCalibration.baselineCaptured", { count: snapshotResult.snapshot.candidates.length })} ${t(
            "displayCalibration.controlsRefreshSummary",
            { success: fixedControls.successCount, failed: fixedControls.failedCount },
          )}`
        : `${t("displayCalibration.baselineRecorded")} ${t("displayCalibration.controlsRefreshSummary", {
            success: fixedControls.successCount,
            failed: fixedControls.failedCount,
          })} ${t("displayCalibration.advancedSnapshotFailed", {
            error: snapshotResult.errorMessage ?? t("displayCalibration.controlFailed"),
          })}`;
      setStatus({
        ok: fixedControls.successCount > 0 || Boolean(snapshotResult.snapshot),
        msg: message,
      });
    } catch (error) {
      setStatus({ ok: false, msg: controlFailureMessage(String(error), t) });
    } finally {
      setBusy(null);
    }
  };

  const handleCaptureCurrent = async () => {
    const serial = requireDeviceSerial();
    if (!serial || busy) return;
    setBusy("current");
    setStatus(null);
    try {
      const fixedControls = await refreshFixedControls(serial, "current");
      setExportBundle(null);
      setStatus({
        ok: fixedControls.successCount > 0,
        msg: `${t("displayCalibration.currentRefreshed")} ${t("displayCalibration.controlsRefreshSummary", {
          success: fixedControls.successCount,
          failed: fixedControls.failedCount,
        })}`,
      });
    } catch (error) {
      setStatus({ ok: false, msg: controlFailureMessage(String(error), t) });
    } finally {
      setBusy(null);
    }
  };

  const handleDiff = async () => {
    const serial = requireDeviceSerial();
    if (!serial || !baseline || busy) return;
    setBusy("diff");
    setStatus(null);
    try {
      const snapshotResult = await refreshAdvancedCurrentSnapshot(serial);
      if (!snapshotResult.snapshot || !snapshotResult.diff) {
        setStatus({
          ok: false,
          msg: t("displayCalibration.advancedSnapshotFailed", {
            error: snapshotResult.errorMessage ?? t("displayCalibration.controlFailed"),
          }),
        });
        return;
      }
      setStatus({
        ok: true,
        msg: `${t("displayCalibration.currentCapturedWithDiff", {
          count: snapshotResult.snapshot.candidates.length,
          changed: snapshotResult.diff.changed.length,
        })} ${t("displayCalibration.diffReady", { changed: snapshotResult.diff.changed.length })}`,
      });
    } catch (error) {
      setStatus({ ok: false, msg: String(error) });
    } finally {
      setBusy(null);
    }
  };

  const handleSelectCandidate = (candidate: DisplayCalibrationCandidate | DisplayCalibrationChangedValue) => {
    setSelectedCandidateId(candidate.id);
    setValueInput("afterValue" in candidate ? candidate.afterValue : candidate.value);
    setApplyResult(null);
    setWriteConfirmed(false);
  };

  const handleApply = async () => {
    const serial = requireDeviceSerial();
    if (!serial || !selectedCandidate?.target || busy) return;
    setBusy("apply");
    setStatus(null);
    try {
      const result = await applyDisplayCalibrationTarget(
        serial,
        selectedCandidate.target,
        valueInput.trim(),
        writeConfirmed,
      );
      setApplyResult(result);
      setExportBundle(null);
      setStatus({
        ok: result.success,
        msg: result.success
          ? t("displayCalibration.applyDone", { readback: result.readbackValue ?? valueInput.trim() })
          : controlFailureMessage(result.stderr || result.stdout || t("displayCalibration.applyFailed"), t),
      });
    } catch (error) {
      setStatus({ ok: false, msg: controlFailureMessage(String(error), t) });
    } finally {
      setBusy(null);
    }
  };

  const handleApplyControl = async (control: DisplayCalibrationControlDefinition, value: string) => {
    const serial = requireDeviceSerial();
    if (!serial || busy) return;
    setBusy("apply");
    setActiveControlId(control.id);
    setStatus(null);
    setControlStatuses((previous) => ({
      ...previous,
      [control.id]: { ok: true, msg: t("displayCalibration.controlApplying") },
    }));
    try {
      const result = await applyDisplayCalibrationTarget(serial, control.target, value.trim(), true);
      const readbackValue = normalizeReadbackValue(result.readbackValue);
      setApplyResult(result);
      setControlReadbacks((previous) => ({
        ...previous,
        [control.id]: readbackValue,
      }));
      if (result.success && readbackValue !== null) {
        setControlCurrentValues((previous) => ({
          ...previous,
          [control.id]: readbackValue,
        }));
      }
      const linkedColorTemperatureValue =
        control.id === COLOR_TEMPERATURE_POINT_CONTROL_ID
          ? colorTemperaturePointToNativeColor(readbackValue ?? value.trim())
          : null;
      if (result.success && linkedColorTemperatureValue !== null) {
        const colorValue = String(linkedColorTemperatureValue);
        setControlDrafts((previous) => ({
          ...previous,
          [COLOR_TEMPERATURE_VALUE_CONTROL_ID]: colorValue,
        }));
        setControlCurrentValues((previous) => ({
          ...previous,
          [COLOR_TEMPERATURE_VALUE_CONTROL_ID]: colorValue,
        }));
        setControlReadbacks((previous) => ({
          ...previous,
          [COLOR_TEMPERATURE_VALUE_CONTROL_ID]: colorValue,
        }));
      }
      const successMessage =
        result.success && readbackValue !== null
          ? t("displayCalibration.applyDone", { readback: readbackValue })
          : control.requiresRoot
            ? t("displayCalibration.propertyUnset")
            : t("displayCalibration.applyDone", { readback: value.trim() });
      setExportBundle(null);
      setStatus({
        ok: result.success && (!control.requiresRoot || readbackValue !== null),
        msg: result.success
          ? successMessage
          : controlFailureMessage(result.stderr || result.stdout || t("displayCalibration.applyFailed"), t),
      });
      setControlStatuses((previous) => ({
        ...previous,
        [control.id]: {
          ok: result.success && (!control.requiresRoot || readbackValue !== null),
          msg: result.success
            ? successMessage
            : controlFailureMessage(result.stderr || result.stdout || t("displayCalibration.applyFailed"), t),
        },
        ...(result.success && linkedColorTemperatureValue !== null
          ? {
              [COLOR_TEMPERATURE_VALUE_CONTROL_ID]: {
                ok: true,
                msg: t("displayCalibration.applyDone", { readback: String(linkedColorTemperatureValue) }),
              },
            }
          : {}),
      }));
      if (!result.success || (control.requiresRoot && readbackValue === null)) return;
    } catch (error) {
      const message = controlFailureMessage(String(error), t);
      setStatus({ ok: false, msg: message });
      setControlStatuses((previous) => ({
        ...previous,
        [control.id]: { ok: false, msg: message },
      }));
    } finally {
      setActiveControlId(null);
      setBusy(null);
    }
  };

  const handleControlDraftChange = (control: DisplayCalibrationControlDefinition, value: string, shouldApply = false) => {
    setControlDrafts((previous) => ({ ...previous, [control.id]: value }));
    setExportBundle(null);
    if (shouldApply && liveApply) {
      void handleApplyControl(control, value);
    }
  };

  const handleBuildExport = async () => {
    const serial = requireDeviceSerial();
    if (!serial || busy) return;
    const parameters = [
      ...controlRows.map((row) =>
        buildControlProfileParameter(row.control, row.baselineValue, row.draftValue, applyResult),
      ),
      ...advancedProfileParameters,
    ];
    if (!parameters.length) {
      setStatus({ ok: false, msg: t("displayCalibration.noExportableParameters") });
      return;
    }
    setBusy("export");
    setStatus(null);
    try {
      const profile: DisplayCalibrationProfile = {
        profileName: t("displayCalibration.profileName", { device: deviceTarget.label || serial }),
        createdAt: new Date().toISOString(),
        device: {
          adbSerial: serial,
          deviceSn: deviceTarget.device?.device_sn || null,
          model: deviceTarget.model || null,
          buildFingerprint: null,
          firmwareVersion: null,
        },
        parameters,
        notes: t("displayCalibration.exportNotes"),
      };
      const bundle = await buildDisplayCalibrationExport(profile);
      setExportBundle(bundle);
      setStatus({ ok: true, msg: t("displayCalibration.exportReady", { count: parameters.length }) });
    } catch (error) {
      setStatus({ ok: false, msg: String(error) });
    } finally {
      setBusy(null);
    }
  };

  const handleSaveExport = async (format: "markdown" | "json") => {
    if (!exportBundle || busy) return;
    setBusy("save");
    setStatus(null);
    try {
      const content = format === "markdown" ? exportBundle.markdown : exportBundle.json;
      const savedPath = await invoke<string | null>("export_text_file", {
        defaultName: `display-calibration-${Date.now()}.${format === "markdown" ? "md" : "json"}`,
        content,
      });
      if (savedPath) {
        setStatus({ ok: true, msg: t("displayCalibration.exportSaved", { path: savedPath }) });
      }
    } catch (error) {
      setStatus({ ok: false, msg: String(error) });
    } finally {
      setBusy(null);
    }
  };

  const canApply = Boolean(selectedCandidate?.target && valueInput.trim() && writeConfirmed && deviceTarget.serial);

  return (
    <div className="display-calibration-page">
      <section className="display-calibration-panel">
        <div className="display-calibration-header">
          <SectionTitle
            icon={<IconColorSwatch size={17} />}
            label={t("displayCalibration.title")}
            description={t("displayCalibration.description")}
          />
          <div className="display-calibration-actions">
            <button className="display-calibration-action" onClick={handleEnableRoot} disabled={Boolean(busy) || !deviceTarget.serial}>
              {busy === "root" ? t("displayCalibration.enablingRoot") : t("displayCalibration.enableRoot")}
            </button>
            <button className="display-calibration-action" onClick={handleOpenPattern} disabled={Boolean(busy) || !deviceTarget.serial}>
              {busy === "pattern" ? t("displayCalibration.openingPattern") : t("displayCalibration.openPattern")}
            </button>
            <button className="display-calibration-action" onClick={handleCaptureBaseline} disabled={Boolean(busy) || !deviceTarget.serial}>
              {busy === "baseline" ? t("displayCalibration.capturing") : t("displayCalibration.captureBaseline")}
            </button>
            <button className="display-calibration-action is-primary" onClick={handleCaptureCurrent} disabled={Boolean(busy) || !deviceTarget.serial}>
              {busy === "current" ? t("displayCalibration.capturing") : t("displayCalibration.captureCurrent")}
            </button>
            <button className="display-calibration-action" onClick={handleBuildExport} disabled={Boolean(busy) || !exportableCount || !deviceTarget.serial}>
              {busy === "export" ? t("displayCalibration.exporting") : t("displayCalibration.buildExport")}
            </button>
          </div>
        </div>

        <DeviceTargetBanner target={deviceTarget} className="display-calibration-target" />

        {status ? (
          <div className={`display-calibration-status ${status.ok ? "is-ok" : "is-error"}`}>
            {status.msg}
          </div>
        ) : null}

        {SHOW_CAPTURE_METRICS ? (
          <div className="display-calibration-summary">
            <Metric label={t("displayCalibration.baseline")} value={formatCapturedAt(baseline?.capturedAt)} />
            <Metric
              label={t("displayCalibration.current")}
              value={formatCapturedAt(controlCurrentRefreshedAt ?? current?.capturedAt)}
            />
            <Metric label={t("displayCalibration.controlCount")} value={String(controlRows.length)} />
            <Metric label={t("displayCalibration.changed")} value={String(changedValues.length)} />
          </div>
        ) : null}

        <section className="display-calibration-section">
          <div className="display-calibration-section__header">
            <h3>{t("displayCalibration.deviceControls")}</h3>
            <label className="display-calibration-live">
              <input
                type="checkbox"
                checked={liveApply}
                onChange={(event) => setLiveApply(event.target.checked)}
              />
              <span>{t("displayCalibration.liveApply")}</span>
            </label>
          </div>
          <ControlBoard
            rows={controlRows}
            busy={Boolean(busy)}
            onDraftChange={handleControlDraftChange}
            onApply={handleApplyControl}
            t={t}
          />
        </section>

        {SHOW_ADVANCED_PARAMETER_SECTIONS ? (
          <>
            <div className="display-calibration-layout">
              <section className="display-calibration-section">
                <div className="display-calibration-section__header">
                  <h3>{t("displayCalibration.advancedCandidates")}</h3>
                  <span>{t("displayCalibration.exportable", { count: candidates.filter((item) => item.target).length })}</span>
                </div>
                <CandidateTable
                  candidates={candidates}
                  selectedId={selectedCandidateId}
                  onSelect={handleSelectCandidate}
                  t={t}
                />
              </section>

              <section className="display-calibration-section">
                <div className="display-calibration-section__header">
                  <h3>{t("displayCalibration.selectedParameter")}</h3>
                  <span>{selectedCandidate?.writable ? t("displayCalibration.writable") : t("displayCalibration.readonly")}</span>
                </div>
                {selectedCandidate ? (
                  <div className="display-calibration-editor">
                    <ReadonlyField label={t("displayCalibration.target")} value={formatTarget(selectedCandidate.target)} />
                    <ReadonlyField label={t("displayCalibration.source")} value={selectedCandidate.source} />
                    <ReadonlyField label={t("displayCalibration.currentValue")} value={selectedCandidate.value} />
                    <label className="display-calibration-field">
                      <span className="display-calibration-field__label">{t("displayCalibration.desiredValue")}</span>
                      <input
                        className="display-calibration-input"
                        value={valueInput}
                        onChange={(event) => setValueInput(event.target.value)}
                        disabled={!selectedCandidate.target}
                      />
                    </label>
                    <label className="display-calibration-check">
                      <input
                        type="checkbox"
                        checked={writeConfirmed}
                        onChange={(event) => setWriteConfirmed(event.target.checked)}
                        disabled={!selectedCandidate.target}
                      />
                      <span>{t("displayCalibration.confirmWrite")}</span>
                    </label>
                    <button className="display-calibration-action is-primary" onClick={handleApply} disabled={!canApply || Boolean(busy)}>
                      {busy === "apply" ? t("displayCalibration.applying") : t("displayCalibration.apply")}
                    </button>
                    {applyResult ? (
                      <div className="display-calibration-result">
                        <ReadonlyField label={t("displayCalibration.readback")} value={applyResult.readbackValue ?? "-"} />
                        <ReadonlyField label={t("displayCalibration.command")} value={applyResult.command} />
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="display-calibration-empty">{t("displayCalibration.noCandidates")}</div>
                )}
              </section>
            </div>

            <section className="display-calibration-section">
              <div className="display-calibration-section__header">
                <h3>{t("displayCalibration.changedParameters")}</h3>
                <div className="display-calibration-inline-actions">
                  <span>{t("displayCalibration.changedCount", { count: changedValues.length })}</span>
                  <button className="display-calibration-select" onClick={handleDiff} disabled={Boolean(busy) || !baseline || !deviceTarget.serial}>
                    {busy === "diff" ? t("displayCalibration.comparing") : t("displayCalibration.compare")}
                  </button>
                </div>
              </div>
              <ChangedTable changes={changedValues} selectedId={selectedCandidateId} onSelect={handleSelectCandidate} t={t} />
            </section>
          </>
        ) : null}

        {exportBundle ? (
          <section className="display-calibration-section">
            <div className="display-calibration-section__header">
              <h3>{t("displayCalibration.exportBundle")}</h3>
              <div className="display-calibration-inline-actions">
                <button className="display-calibration-action" onClick={() => handleSaveExport("markdown")} disabled={Boolean(busy)}>
                  {t("displayCalibration.saveMarkdown")}
                </button>
                <button className="display-calibration-action" onClick={() => handleSaveExport("json")} disabled={Boolean(busy)}>
                  {t("displayCalibration.saveJson")}
                </button>
              </div>
            </div>
            <div className="display-calibration-export-grid">
              <textarea className="display-calibration-export" readOnly value={exportBundle.markdown} />
              <textarea className="display-calibration-export" readOnly value={exportBundle.json} />
            </div>
          </section>
        ) : null}

      </section>
    </div>
  );
}

function CandidateTable({
  candidates,
  selectedId,
  onSelect,
  t,
}: {
  candidates: DisplayCalibrationCandidate[];
  selectedId: string;
  onSelect: (candidate: DisplayCalibrationCandidate) => void;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  if (!candidates.length) {
    return <div className="display-calibration-empty">{t("displayCalibration.noCandidates")}</div>;
  }

  return (
    <div className="display-calibration-table">
      <div className="display-calibration-row is-head">
        <span>{t("displayCalibration.name")}</span>
        <span>{t("displayCalibration.value")}</span>
        <span>{t("displayCalibration.target")}</span>
        <span>{t("displayCalibration.confidence")}</span>
        <span>{t("displayCalibration.action")}</span>
      </div>
      {candidates.map((candidate) => (
        <div
          key={candidate.id}
          className="display-calibration-row"
          data-selected={candidate.id === selectedId ? "true" : "false"}
        >
          <span title={candidate.line}>{candidate.label}</span>
          <span title={candidate.value}>{candidate.value || "-"}</span>
          <span title={formatDisplayCalibrationTarget(candidate.target)}>{formatDisplayCalibrationTarget(candidate.target)}</span>
          <span>{Math.round(candidate.confidence * 100)}%</span>
          <button type="button" onClick={() => onSelect(candidate)} className="display-calibration-select">
            {candidate.id === selectedId ? t("displayCalibration.selected") : t("displayCalibration.select")}
          </button>
        </div>
      ))}
    </div>
  );
}

function ChangedTable({
  changes,
  selectedId,
  onSelect,
  t,
}: {
  changes: DisplayCalibrationChangedValue[];
  selectedId: string;
  onSelect: (candidate: DisplayCalibrationChangedValue) => void;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  if (!changes.length) {
    return <div className="display-calibration-empty">{t("displayCalibration.noChanges")}</div>;
  }

  return (
    <div className="display-calibration-table">
      <div className="display-calibration-row is-head is-change">
        <span>{t("displayCalibration.name")}</span>
        <span>{t("displayCalibration.before")}</span>
        <span>{t("displayCalibration.after")}</span>
        <span>{t("displayCalibration.target")}</span>
        <span>{t("displayCalibration.action")}</span>
      </div>
      {changes.map((change) => (
        <div
          key={change.id}
          className="display-calibration-row is-change"
          data-selected={change.id === selectedId ? "true" : "false"}
        >
          <span title={change.source}>{change.label}</span>
          <span title={change.beforeValue}>{change.beforeValue || "-"}</span>
          <span title={change.afterValue}>{change.afterValue || "-"}</span>
          <span title={formatDisplayCalibrationTarget(change.target)}>{formatDisplayCalibrationTarget(change.target)}</span>
          <button
            type="button"
            onClick={() => onSelect(change)}
            className="display-calibration-select"
            disabled={!change.target}
          >
            {change.id === selectedId ? t("displayCalibration.selected") : t("displayCalibration.select")}
          </button>
        </div>
      ))}
    </div>
  );
}

function ControlBoard({
  rows,
  busy,
  onDraftChange,
  onApply,
  t,
}: {
  rows: ControlBoardRow[];
  busy: boolean;
  onDraftChange: (control: DisplayCalibrationControlDefinition, value: string, shouldApply?: boolean) => void;
  onApply: (control: DisplayCalibrationControlDefinition, value: string) => void;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  const colorPointRow = rows.find((row) => row.control.id === COLOR_TEMPERATURE_POINT_CONTROL_ID) ?? null;
  const pairedPointValues = {
    current: colorPointRow?.currentValue ?? null,
    desired: colorPointRow?.draftValue ?? null,
    readback: colorPointRow?.readbackValue ?? null,
  };
  const layoutSlots = layoutDisplayCalibrationControlRows(rows);

  return (
    <div className="display-calibration-control-board">
      {layoutSlots.map(({ row, variant }) => (
        <ControlCard
          key={`${row.control.id}:${variant}`}
          row={row}
          pairedPointValues={pairedPointValues}
          busy={busy}
          colorPoint={variant === "colorPoint"}
          readOnly={variant === "readOnly"}
          onDraftChange={onDraftChange}
          onApply={onApply}
          t={t}
        />
      ))}
    </div>
  );
}

function ControlCard({
  row,
  pairedPointValues,
  busy,
  colorPoint = false,
  readOnly = false,
  onDraftChange,
  onApply,
  t,
}: {
  row: ControlBoardRow;
  pairedPointValues: {
    current: string | null;
    desired: string | null;
    readback: string | null;
  };
  busy: boolean;
  colorPoint?: boolean;
  readOnly?: boolean;
  onDraftChange: (control: DisplayCalibrationControlDefinition, value: string, shouldApply?: boolean) => void;
  onApply: (control: DisplayCalibrationControlDefinition, value: string) => void;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  const currentDisplay = formatControlChipValue(row.control, row.currentValue, pairedPointValues.current, t);
  const desiredDisplay = formatControlChipValue(row.control, row.draftValue, pairedPointValues.desired, t);
  const readbackDisplay = formatControlChipValue(row.control, row.readbackValue, pairedPointValues.readback, t);
  const titleKey = colorPoint
    ? "displayCalibration.controls.colorTemperaturePointCombined"
    : row.control.labelKey;

  return (
    <div className={`display-calibration-control${colorPoint ? " is-color-point" : ""}`}>
      <div className="display-calibration-control__main">
        <div className="display-calibration-control__title">
          <strong>{t(titleKey)}</strong>
        </div>
        <code title={formatDisplayCalibrationTarget(row.control.target)}>{row.control.parameterName}</code>
      </div>
      <div className="display-calibration-control__values">
        <ReadonlyChip label={t("displayCalibration.currentValue")} {...currentDisplay} />
        <ReadonlyChip label={t("displayCalibration.desiredValue")} {...desiredDisplay} />
        <ReadonlyChip label={t("displayCalibration.readback")} {...readbackDisplay} />
      </div>
      {!readOnly ? (
        <div className="display-calibration-control__input">
          {colorPoint ? (
            <CombinedColorPointInput
              value={row.draftValue}
              disabled={busy}
              onChange={(value, shouldApply) => onDraftChange(row.control, value, shouldApply)}
              t={t}
            />
          ) : (
            <ControlInput
              control={row.control}
              value={row.draftValue}
              disabled={busy}
              onChange={(value, shouldApply) => onDraftChange(row.control, value, shouldApply)}
            />
          )}
          <button
            className="display-calibration-action is-primary"
            aria-label={`${t(titleKey)} · ${t("displayCalibration.apply")}`}
            onClick={() => onApply(row.control, row.draftValue)}
            disabled={busy || !row.draftValue.trim()}
            type="button"
          >
            {row.applying ? t("displayCalibration.applying") : t("displayCalibration.apply")}
          </button>
        </div>
      ) : null}
      {row.status ? (
        <div className={`display-calibration-control__status ${row.status.ok ? "is-ok" : "is-error"}`}>
          {row.status.msg}
        </div>
      ) : null}
    </div>
  );
}

function formatControlChipValue(
  control: DisplayCalibrationControlDefinition,
  rawValue: string | null,
  pairedPointValue: string | null,
  t: ReturnType<typeof useTranslation>["t"],
) {
  const value = rawValue?.trim() ?? "";
  if (!value) return { value: "-" };

  if (control.id === COLOR_TEMPERATURE_POINT_CONTROL_ID) {
    const displayValue = formatColorTemperaturePointForDisplay(value);
    const firmwareRawValue = colorTemperaturePointToNativeColor(value);
    return {
      value: displayValue ?? value,
      detail:
        firmwareRawValue === null
          ? null
          : `${t("displayCalibration.firmwareRawValue")}: ${firmwareRawValue}`,
    };
  }

  if (control.id === COLOR_TEMPERATURE_VALUE_CONTROL_ID) {
    const hexValue = colorTemperatureNativeColorToCssColor(value);
    const pointValue = formatColorTemperaturePointOnly(pairedPointValue);
    return {
      value: hexValue ? [hexValue, pointValue].filter(Boolean).join(" · ") : value,
      detail: hexValue ? `${t("displayCalibration.firmwareRawValue")}: ${value}` : null,
    };
  }

  return { value };
}

function formatColorTemperaturePointOnly(value: string | null) {
  if (!value) return null;
  const point = parseColorTemperaturePoint(value);
  if (!point) return null;
  return formatColorTemperaturePoint(point.x, point.y);
}

function CombinedColorPointInput({
  value,
  disabled,
  onChange,
  t,
}: {
  value: string;
  disabled: boolean;
  onChange: (value: string, shouldApply?: boolean) => void;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  return (
    <div className="display-calibration-color-point-editor">
      <ColorPointPicker
        value={value}
        disabled={disabled}
        onChange={onChange}
        wheelOnly
      />
      <PreciseColorPointInput
        value={value}
        disabled={disabled}
        onChange={onChange}
        t={t}
      />
    </div>
  );
}

function PreciseColorPointInput({
  value,
  disabled,
  onChange,
  t,
}: {
  value: string;
  disabled: boolean;
  onChange: (value: string, shouldApply?: boolean) => void;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  const point = parseColorTemperaturePoint(value) ?? {
    x: COLOR_TEMPERATURE_POINT_RANGE / 2,
    y: COLOR_TEMPERATURE_POINT_RANGE / 2,
  };
  const [editingAxis, setEditingAxis] = useState<"x" | "y" | null>(null);
  const [axisDrafts, setAxisDrafts] = useState({
    x: point.x.toFixed(2),
    y: point.y.toFixed(2),
  });

  useEffect(() => {
    const nextPoint = parseColorTemperaturePoint(value) ?? {
      x: COLOR_TEMPERATURE_POINT_RANGE / 2,
      y: COLOR_TEMPERATURE_POINT_RANGE / 2,
    };
    setAxisDrafts((previous) => ({
      x: editingAxis === "x" ? previous.x : nextPoint.x.toFixed(2),
      y: editingAxis === "y" ? previous.y : nextPoint.y.toFixed(2),
    }));
  }, [editingAxis, value]);

  const normalizedPointValue = formatColorTemperaturePoint(point.x, point.y);

  const updateAxis = (axis: "x" | "y", nextValue: string) => {
    setAxisDrafts((previous) => ({ ...previous, [axis]: nextValue }));
    if (nextValue.trim() === "" || !Number.isFinite(Number(nextValue))) return;
    const nextPoint = updateColorTemperaturePointAxis(
      normalizedPointValue,
      axis,
      Number(nextValue),
    );
    if (nextPoint) onChange(nextPoint);
  };

  const finishEditingAxis = (axis: "x" | "y", draftValue: string) => {
    const nextValue = draftValue.trim();
    const nextPoint =
      nextValue !== "" && Number.isFinite(Number(nextValue))
        ? updateColorTemperaturePointAxis(normalizedPointValue, axis, Number(nextValue))
        : null;
    if (nextPoint) {
      const parsedNextPoint = parseColorTemperaturePoint(nextPoint);
      if (parsedNextPoint) {
        setAxisDrafts({
          x: parsedNextPoint.x.toFixed(2),
          y: parsedNextPoint.y.toFixed(2),
        });
      }
      onChange(nextPoint, true);
    } else {
      setAxisDrafts({
        x: point.x.toFixed(2),
        y: point.y.toFixed(2),
      });
    }
    setEditingAxis(null);
  };

  return (
    <div className="display-calibration-precise-point">
      {(["x", "y"] as const).map((axis) => (
        <label key={axis} className="display-calibration-precise-point__field">
          <span>{axis.toUpperCase()}</span>
          <input
            className="display-calibration-input"
            type="number"
            inputMode="decimal"
            min={0}
            max={COLOR_TEMPERATURE_POINT_RANGE}
            step={0.1}
            value={axisDrafts[axis]}
            disabled={disabled}
            aria-label={t(`displayCalibration.preciseCoordinate${axis.toUpperCase()}`)}
            onFocus={() => setEditingAxis(axis)}
            onChange={(event) => updateAxis(axis, event.target.value)}
            onBlur={(event) => finishEditingAxis(axis, event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
          />
        </label>
      ))}
    </div>
  );
}

function ControlInput({
  control,
  value,
  disabled,
  onChange,
}: {
  control: DisplayCalibrationControlDefinition;
  value: string;
  disabled: boolean;
  onChange: (value: string, shouldApply?: boolean) => void;
}) {
  if (control.kind === "toggle") {
    const checked = value === "1" || value === "true";
    return (
      <label className="display-calibration-switch">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked ? "1" : "0", true)}
        />
        <span>{checked ? "ON" : "OFF"}</span>
      </label>
    );
  }

  if (control.kind === "slider") {
    const numericValue = Number(value);
    const safeValue = Number.isFinite(numericValue) ? numericValue : Number(control.defaultValue);
    return (
      <div className="display-calibration-slider">
        <input
          type="range"
          min={control.min}
          max={control.max}
          step={control.step ?? 1}
          value={safeValue}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          onPointerUp={(event) => onChange((event.target as HTMLInputElement).value, true)}
        />
        <input
          className="display-calibration-input"
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          onBlur={(event) => onChange(event.target.value, true)}
        />
      </div>
    );
  }

  if (control.kind === "point") {
    return <ColorPointPicker value={value} disabled={disabled} onChange={onChange} />;
  }

  return (
    <input
      className="display-calibration-input"
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      onBlur={(event) => onChange(event.target.value, true)}
    />
  );
}

function ColorPointPicker({
  value,
  disabled,
  onChange,
  wheelOnly = false,
}: {
  value: string;
  disabled: boolean;
  onChange: (value: string, shouldApply?: boolean) => void;
  wheelOnly?: boolean;
}) {
  const point = parseColorTemperaturePoint(value) ?? {
    x: COLOR_TEMPERATURE_POINT_RANGE / 2,
    y: COLOR_TEMPERATURE_POINT_RANGE / 2,
  };
  const left = `${(point.x / COLOR_TEMPERATURE_POINT_RANGE) * 100}%`;
  const top = `${(point.y / COLOR_TEMPERATURE_POINT_RANGE) * 100}%`;
  const swatchColor = colorTemperaturePointToCssColor(value);
  const displayValue = formatColorTemperaturePointForDisplay(value) ?? value;

  const updateFromPointer = (event: PointerEvent<HTMLButtonElement>, shouldApply = false) => {
    if (disabled) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / bounds.width) * COLOR_TEMPERATURE_POINT_RANGE;
    const y = ((event.clientY - bounds.top) / bounds.height) * COLOR_TEMPERATURE_POINT_RANGE;
    const clamped = clampColorTemperaturePointToNativeWheel(x, y);
    onChange(formatColorTemperaturePoint(clamped.x, clamped.y), shouldApply);
  };

  const updateFromKeyboard = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    const step = event.shiftKey ? 10 : 2;
    let nextX = point.x;
    let nextY = point.y;
    if (event.key === "ArrowLeft") nextX -= step;
    else if (event.key === "ArrowRight") nextX += step;
    else if (event.key === "ArrowUp") nextY -= step;
    else if (event.key === "ArrowDown") nextY += step;
    else return;
    event.preventDefault();
    const clamped = clampColorTemperaturePointToNativeWheel(nextX, nextY);
    onChange(formatColorTemperaturePoint(clamped.x, clamped.y), true);
  };

  return (
    <div className={`display-calibration-point-picker${wheelOnly ? " is-wheel-only" : ""}`}>
      <button
        className="display-calibration-color-wheel"
        type="button"
        disabled={disabled}
        aria-label="Color wheel"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          updateFromPointer(event);
        }}
        onPointerMove={(event) => {
          if (event.buttons === 1) updateFromPointer(event);
        }}
        onPointerUp={(event) => updateFromPointer(event, true)}
        onKeyDown={updateFromKeyboard}
      >
        <span
          className="display-calibration-color-wheel__handle"
          style={{ left, top, backgroundColor: swatchColor }}
        />
      </button>
      {wheelOnly ? null : (
        <input
          className="display-calibration-input"
          value={displayValue}
          title={displayValue}
          readOnly
          disabled={disabled}
        />
      )}
    </div>
  );
}

function ReadonlyChip({ label, value, detail }: { label: string; value: string; detail?: string | null }) {
  const title = detail ? `${value}\n${detail}` : value;
  return (
    <div className="display-calibration-chip">
      <span>{label}</span>
      <strong title={title}>{value}</strong>
      {detail ? <small title={detail}>{detail}</small> : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="display-calibration-metric">
      <span>{label}</span>
      <strong title={value}>{value}</strong>
    </div>
  );
}

function ReadonlyField({ label, value }: { label: string; value: string }) {
  return (
    <label className="display-calibration-field">
      <span className="display-calibration-field__label">{label}</span>
      <input className="display-calibration-input" value={value} readOnly />
    </label>
  );
}

function buildProfileParameters(
  diff: DisplayCalibrationDiff | null,
  selectedCandidate: DisplayCalibrationCandidate | null,
  valueInput: string,
  applyResult: DisplayCalibrationApplyResult | null,
): DisplayCalibrationProfileParameter[] {
  const parameters = new Map<string, DisplayCalibrationProfileParameter>();

  for (const change of diff?.changed ?? []) {
    if (!change.target) continue;
    parameters.set(targetSignature(change.target), {
      name: change.label,
      target: change.target,
      baselineValue: change.beforeValue,
      desiredValue: change.afterValue,
      readbackValue: change.afterValue,
      visibleEffectConfirmed: false,
      requiresPhysicalValidation: true,
      notes: change.source,
    });
  }

  if (selectedCandidate?.target) {
    const desiredValue = valueInput.trim() || selectedCandidate.value;
    parameters.set(targetSignature(selectedCandidate.target), {
      name: selectedCandidate.label,
      target: selectedCandidate.target,
      baselineValue: selectedCandidate.value,
      desiredValue,
      readbackValue:
        applyResult && sameTarget(applyResult.target, selectedCandidate.target)
          ? applyResult.readbackValue
          : null,
      visibleEffectConfirmed: false,
      requiresPhysicalValidation: true,
      notes: selectedCandidate.reason,
    });
  }

  return [...parameters.values()];
}

function formatTarget(target: DisplayCalibrationTarget | null) {
  return formatDisplayCalibrationTarget(target);
}

function formatCapturedAt(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function deviceBlockMessage(t: ReturnType<typeof useTranslation>["t"], target: DeviceTargetState) {
  return target.blockReason === "selected-device-not-online"
    ? t("deviceTarget.selectedUnavailable", { count: target.onlineDeviceCount })
    : t("deviceTarget.selectOnlineDevice", { count: target.onlineDeviceCount });
}

function controlFailureMessage(rawMessage: string, t: ReturnType<typeof useTranslation>["t"]) {
  const message = rawMessage.trim().replace(/^Error:\s*/, "");
  if (!message) return t("displayCalibration.controlFailed");
  if (/setting .*empty or not set|setting .*not set/i.test(message)) {
    return t("displayCalibration.settingUnset");
  }
  if (/property .*empty or not set|property .*not set/i.test(message)) {
    return t("displayCalibration.propertyUnset");
  }
  if (isFirmwareDeniedMessage(message)) {
    return t("displayCalibration.firmwareDenied");
  }
  return message;
}

function isFirmwareDeniedMessage(message: string) {
  return /DeadObjectException|Operation not permitted|avc:\s*denied|hal_awdisplayoutput|display HAL/i.test(message);
}

function normalizeReadbackValue(value: string | null | undefined) {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === "null") return null;
  return trimmed;
}

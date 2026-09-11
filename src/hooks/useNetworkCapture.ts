import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  HttpLogParser,
  type NetworkCaptureInfo,
  type NetworkLogLine,
  type NetworkParserSnapshot,
} from "../networkInspector.ts";

interface CaptureSnapshot {
  session_id: string;
  lines: NetworkLogLine[];
  status: "running" | "stopped" | "error" | "app_restarted";
  dropped_lines: number;
  error_code: string | null;
}

const emptySnapshot = (): NetworkParserSnapshot => ({ requests: [], droppedRequests: 0, ignoredLines: 0 });
const knownErrors = new Set([
  "APP_NOT_RUNNING", "INVALID_PACKAGE", "DEVICE_REQUIRED", "CAPTURE_ALREADY_RUNNING",
  "CAPTURE_NOT_FOUND", "APP_RESTARTED", "DEVICE_UNAVAILABLE", "CAPTURE_START_FAILED",
  "CAPTURE_READ_FAILED", "CAPTURE_STOP_FAILED", "PROCESS_LOOKUP_FAILED", "LOGCAT_FAILED",
  "INVALID_DEVICE", "APP_PROCESS_AMBIGUOUS", "ADB_UNAVAILABLE", "CAPTURE_EXITED", "CAPTURE_STATE_ERROR",
  "APP_PROCESS_INVALID", "APP_PROCESS_UNVERIFIED", "CAPTURE_WORKER_FAILED", "CAPTURE_CANCELLED",
]);

function errorCode(error: unknown, fallback: string): string {
  const code = String(error).match(/\b[A-Z][A-Z_]{3,}\b/g)?.find((item) => knownErrors.has(item));
  return code ?? fallback;
}

/** Owns one capture; stale starts and late drains cannot enter a new device session. */
export function useNetworkCapture(selectedSerial: string | null, onlineSerial: string | null) {
  const [capture, setCapture] = useState<NetworkCaptureInfo | null>(null);
  const [snapshot, setSnapshot] = useState<NetworkParserSnapshot>(emptySnapshot);
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState<string | null>(null);
  const [droppedLines, setDroppedLines] = useState(0);
  const mounted = useRef(true);
  const generation = useRef(0);
  const session = useRef<string | null>(null);
  const parser = useRef<HttpLogParser | null>(null);
  const polling = useRef<Promise<void> | null>(null);
  const operation = useRef<Promise<void> | null>(null);
  const teardown = useRef<Promise<unknown>>(Promise.resolve());
  const collecting = useRef(false);
  const operating = useRef(false);
  const lostLines = useRef(0);

  const applySnapshot = useCallback((next: CaptureSnapshot) => {
    if (!mounted.current || session.current !== next.session_id || !parser.current) return;
    if (next.dropped_lines > lostLines.current) {
      parser.current.finish("log_lines_dropped");
      collecting.current = false;
      setRunning(false);
      setStatus("error");
      setError("CAPTURE_DATA_LOSS");
      setDroppedLines(next.dropped_lines);
      setSnapshot(parser.current.snapshot());
      lostLines.current = next.dropped_lines;
      teardown.current = invoke("adb_network_capture_stop", { sessionId: next.session_id }).catch(() => undefined);
      return;
    }
    lostLines.current = next.dropped_lines;
    parser.current.ingest(next.lines);
    if (next.status !== "running") {
      parser.current.finish(next.error_code ?? next.status);
      collecting.current = false;
      setRunning(false);
    }
    setSnapshot(parser.current.snapshot());
    setDroppedLines(next.dropped_lines);
    setStatus(next.status === "running" && !collecting.current ? "stopping" : next.status);
    setError(next.error_code);
  }, []);

  const poll = useCallback(() => {
    const id = session.current;
    if (!collecting.current || !id || polling.current) return;
    const request = (async () => {
      try {
        applySnapshot(await invoke<CaptureSnapshot>("adb_network_capture_snapshot", { sessionId: id }));
      } catch (cause) {
        if (session.current !== id || !mounted.current) return;
        collecting.current = false;
        setRunning(false);
        setStatus("error");
        setError(errorCode(cause, "CAPTURE_READ_FAILED"));
        parser.current?.finish("capture_read_failed");
        if (parser.current) setSnapshot(parser.current.snapshot());
        teardown.current = invoke("adb_network_capture_stop", { sessionId: id }).catch(() => undefined);
      }
    })();
    polling.current = request;
    void request.finally(() => { if (polling.current === request) polling.current = null; });
  }, [applySnapshot]);

  useEffect(() => {
    mounted.current = true;
    generation.current += 1;
    operating.current = false;
    setRunning(false);
    setBusy(false);
    if (session.current) setStatus("stopping");
    return () => {
      mounted.current = false;
      generation.current += 1;
      collecting.current = false;
      const id = session.current;
      const pending = polling.current;
      const pendingOperation = operation.current;
      teardown.current = teardown.current.then(async () => {
        // A stale start must finish creating and stopping its collector before
        // the next target is allowed to start a new one.
        await pendingOperation;
        await pending;
        if (!id) return;
        try {
          const final = await invoke<CaptureSnapshot>("adb_network_capture_stop", { sessionId: id });
          applySnapshot(final);
          if (session.current === id) session.current = null;
        } catch (cause) {
          if (!mounted.current || session.current !== id) return;
          parser.current?.finish("capture_stop_failed");
          if (parser.current) setSnapshot(parser.current.snapshot());
          setStatus("error");
          setError(errorCode(cause, "CAPTURE_STOP_FAILED"));
        }
      });
    };
  }, [selectedSerial, applySnapshot]);

  useEffect(() => {
    if (!running) return;
    poll();
    const timer = window.setInterval(poll, 250);
    return () => window.clearInterval(timer);
  }, [running, poll]);

  const start = useCallback((packageName: string) => {
    if (operating.current || collecting.current || !onlineSerial || onlineSerial !== selectedSerial || !packageName) return Promise.resolve();
    operating.current = true;
    setBusy(true);
    setError(null);
    const epoch = ++generation.current;
    const request = (async () => {
      try {
        await teardown.current;
        if (!mounted.current || generation.current !== epoch) return;
        if (session.current) {
          await polling.current;
          await invoke("adb_network_capture_stop", { sessionId: session.current });
          session.current = null;
        }
        if (!mounted.current || generation.current !== epoch) return;
        const info = await invoke<NetworkCaptureInfo>("adb_network_capture_start", { deviceSerial: onlineSerial, packageName });
        if (!mounted.current || generation.current !== epoch) {
          await invoke("adb_network_capture_stop", { sessionId: info.session_id }).catch(() => undefined);
          return;
        }
        session.current = info.session_id;
        parser.current = new HttpLogParser(info.session_id);
        lostLines.current = 0;
        collecting.current = true;
        setCapture(info);
        setSnapshot(emptySnapshot());
        setDroppedLines(0);
        setStatus("running");
        setRunning(true);
      } catch (cause) {
        if (mounted.current && generation.current === epoch) {
          setError(errorCode(cause, "CAPTURE_START_FAILED"));
          if (!parser.current) setStatus("error");
        }
      } finally {
        if (mounted.current && generation.current === epoch) {
          operating.current = false;
          setBusy(false);
        }
      }
    })();
    operation.current = request;
    void request.finally(() => { if (operation.current === request) operation.current = null; });
    return request;
  }, [selectedSerial, onlineSerial]);

  const stop = useCallback(() => {
    const id = session.current;
    if (!id || operating.current) return Promise.resolve();
    const epoch = generation.current;
    operating.current = true;
    collecting.current = false;
    setBusy(true);
    setRunning(false);
    const request = (async () => {
      try {
        // A drain already in flight must be applied before requesting the final drain.
        await polling.current;
        const final = await invoke<CaptureSnapshot>("adb_network_capture_stop", { sessionId: id });
        applySnapshot(final);
        if (session.current === id) session.current = null;
      } catch (cause) {
        if (session.current === id && mounted.current) {
          parser.current?.finish("capture_stop_failed");
          if (parser.current) setSnapshot(parser.current.snapshot());
          setStatus("error");
          setError(errorCode(cause, "CAPTURE_STOP_FAILED"));
        }
      } finally {
        if (mounted.current && generation.current === epoch) {
          operating.current = false;
          setBusy(false);
        }
      }
    })();
    operation.current = request;
    void request.finally(() => { if (operation.current === request) operation.current = null; });
    return request;
  }, [applySnapshot]);

  return { capture, snapshot, running, busy, status, error, droppedLines, start, stop };
}

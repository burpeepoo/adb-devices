use std::collections::VecDeque;
use std::io::{self, Read};
use std::path::Path;
use std::process::{Child, ExitStatus, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, State};

use crate::{adb, operation_log, process};

const MAX_QUEUED_LINES: usize = 4_096;
const MAX_QUEUED_BYTES: usize = 4 * 1_024 * 1_024;
const MAX_RAW_LINE_BYTES: usize = 32 * 1_024;
const MAX_CONTROL_OUTPUT_BYTES: usize = 4 * 1_024;
const CONTROL_TIMEOUT: Duration = Duration::from_secs(2);
const PROCESS_CHECK_INTERVAL: Duration = Duration::from_secs(1);
const WORKER_POLL_INTERVAL: Duration = Duration::from_millis(50);
const HTTP_LOG_TAGS: [&str; 2] = ["OkHttp", "okhttp.OkHttpClient"];

static NEXT_SESSION_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct NetworkCaptureMetadata {
    pub session_id: String,
    pub device_serial: String,
    pub package_name: String,
    pub pid: String,
    pub started_at_ms: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct NetworkCaptureLine {
    pub timestamp: String,
    pub pid: String,
    pub tid: String,
    pub message: String,
}

#[derive(Debug, Copy, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum NetworkCaptureStatus {
    Running,
    Stopped,
    Error,
    AppRestarted,
}

#[derive(Debug, Clone, Serialize)]
pub struct NetworkCaptureSnapshot {
    pub session_id: String,
    pub lines: Vec<NetworkCaptureLine>,
    pub status: NetworkCaptureStatus,
    pub dropped_lines: u64,
    pub error_code: Option<String>,
}

struct CaptureBuffer {
    lines: VecDeque<NetworkCaptureLine>,
    bytes: usize,
    max_lines: usize,
    max_bytes: usize,
    status: NetworkCaptureStatus,
    dropped_lines: u64,
    error_code: Option<String>,
}

impl CaptureBuffer {
    fn new(max_lines: usize, max_bytes: usize) -> Self {
        Self {
            lines: VecDeque::new(),
            bytes: 0,
            max_lines,
            max_bytes,
            status: NetworkCaptureStatus::Running,
            dropped_lines: 0,
            error_code: None,
        }
    }

    fn record_loss(&mut self) {
        self.dropped_lines = self.dropped_lines.saturating_add(1);
    }

    fn push(&mut self, line: NetworkCaptureLine) {
        let size = line_size(&line);
        if size > self.max_bytes || self.max_lines == 0 {
            self.record_loss();
            return;
        }
        while self.lines.len() >= self.max_lines || self.bytes + size > self.max_bytes {
            if let Some(removed) = self.lines.pop_front() {
                self.bytes -= line_size(&removed);
                self.record_loss();
            } else {
                break;
            }
        }
        self.bytes += size;
        self.lines.push_back(line);
    }

    fn drain(&mut self, session_id: &str) -> NetworkCaptureSnapshot {
        self.bytes = 0;
        NetworkCaptureSnapshot {
            session_id: session_id.to_string(),
            lines: self.lines.drain(..).collect(),
            status: self.status,
            dropped_lines: self.dropped_lines,
            error_code: self.error_code.clone(),
        }
    }

    fn finish(&mut self, status: NetworkCaptureStatus, error_code: Option<&str>) {
        self.status = status;
        self.error_code = error_code.map(ToString::to_string);
    }
}

fn line_size(line: &NetworkCaptureLine) -> usize {
    line.timestamp.len() + line.pid.len() + line.tid.len() + line.message.len()
}

fn lock_buffer(buffer: &Mutex<CaptureBuffer>) -> MutexGuard<'_, CaptureBuffer> {
    buffer
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

struct CaptureSession {
    metadata: NetworkCaptureMetadata,
    buffer: Arc<Mutex<CaptureBuffer>>,
    cancellation: Arc<AtomicBool>,
    terminal_logged: AtomicBool,
    worker: Option<JoinHandle<()>>,
}

impl CaptureSession {
    fn stop(&mut self) {
        self.cancellation.store(true, Ordering::Release);
        if let Some(worker) = self.worker.take() {
            worker.thread().unpark();
            if worker.join().is_err() {
                lock_buffer(&self.buffer)
                    .finish(NetworkCaptureStatus::Error, Some("CAPTURE_WORKER_FAILED"));
            }
        }
    }

    fn snapshot(&self) -> NetworkCaptureSnapshot {
        lock_buffer(&self.buffer).drain(&self.metadata.session_id)
    }
}

impl Drop for CaptureSession {
    fn drop(&mut self) {
        self.stop();
    }
}

/// This state deliberately does not share the ordinary Logcat page's child.
#[derive(Default)]
pub struct NetworkCaptureState {
    current: Mutex<Option<CaptureSession>>,
}

impl NetworkCaptureState {
    fn start_with(
        &self,
        create_session: impl FnOnce() -> Result<CaptureSession, String>,
    ) -> Result<NetworkCaptureMetadata, String> {
        // Keep ownership locked through creation: concurrent starts cannot both
        // spawn, and a stale stop can never target a replacement session.
        let mut current = self.current.lock().map_err(|_| "CAPTURE_STATE_ERROR")?;
        if current.as_ref().is_some_and(|session| {
            lock_buffer(&session.buffer).status == NetworkCaptureStatus::Running
        }) {
            return Err("CAPTURE_ALREADY_RUNNING".to_string());
        }
        drop(current.take());
        let session = create_session()?;
        let metadata = session.metadata.clone();
        *current = Some(session);
        Ok(metadata)
    }

    #[cfg(test)]
    fn snapshot(&self, session_id: &str) -> Result<NetworkCaptureSnapshot, String> {
        let current = self.current.lock().map_err(|_| "CAPTURE_STATE_ERROR")?;
        let session = current
            .as_ref()
            .filter(|session| session.metadata.session_id == session_id)
            .ok_or("CAPTURE_NOT_FOUND")?;
        Ok(session.snapshot())
    }

    fn snapshot_with_operation_log(
        &self,
        app: &AppHandle,
        session_id: &str,
    ) -> Result<NetworkCaptureSnapshot, String> {
        let current = self.current.lock().map_err(|_| "CAPTURE_STATE_ERROR")?;
        let session = current
            .as_ref()
            .filter(|session| session.metadata.session_id == session_id)
            .ok_or("CAPTURE_NOT_FOUND")?;
        let snapshot = session.snapshot();
        if snapshot.status != NetworkCaptureStatus::Running
            && !session.terminal_logged.swap(true, Ordering::AcqRel)
        {
            let status = match snapshot.status {
                NetworkCaptureStatus::Stopped => "info",
                NetworkCaptureStatus::Error | NetworkCaptureStatus::AppRestarted => "failed",
                NetworkCaptureStatus::Running => "info",
            };
            let detail = format!(
                "capture session ended with status {:?}, error {:?}, retained {} lines, dropped {}",
                snapshot.status,
                snapshot.error_code,
                snapshot.lines.len(),
                snapshot.dropped_lines
            );
            operation_log::record_event(
                app,
                "adb_network_capture_terminal",
                Some(&session.metadata.device_serial),
                &format!(
                    "network capture {} ({})",
                    session.metadata.package_name, session.metadata.session_id
                ),
                status,
                Duration::from_millis(
                    capture_now_ms().saturating_sub(session.metadata.started_at_ms),
                ),
                &detail,
            );
        }
        Ok(snapshot)
    }

    fn stop(&self, session_id: &str) -> Result<NetworkCaptureSnapshot, String> {
        let mut current = self.current.lock().map_err(|_| "CAPTURE_STATE_ERROR")?;
        let session = current
            .as_mut()
            .filter(|session| session.metadata.session_id == session_id)
            .ok_or("CAPTURE_NOT_FOUND")?;
        session.stop();
        Ok(session.snapshot())
    }

    pub fn shutdown(&self) {
        let mut current = self
            .current
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        drop(current.take());
    }
}

impl Drop for NetworkCaptureState {
    fn drop(&mut self) {
        let current = self
            .current
            .get_mut()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        drop(current.take());
    }
}

#[tauri::command(async)]
pub fn adb_network_capture_start(
    app: AppHandle,
    state: State<'_, NetworkCaptureState>,
    device_serial: String,
    package_name: String,
) -> Result<NetworkCaptureMetadata, String> {
    let started = Instant::now();
    if let Err(error) = validate_target(&device_serial, &package_name) {
        let message = error.to_string();
        operation_log::record_event(
            &app,
            "adb_network_capture_start",
            Some(&device_serial),
            "start network capture",
            "failed",
            started.elapsed(),
            &message,
        );
        return Err(message);
    }
    let device_serial_for_capture = device_serial.clone();
    let package_name_for_capture = package_name.clone();
    let result = state.start_with(|| {
        let adb_path = adb::get_adb_path(&app).map_err(|_| "ADB_UNAVAILABLE")?;
        let cancellation = Arc::new(AtomicBool::new(false));
        let pid = probe_main_pid(
            &adb_path,
            &device_serial_for_capture,
            &package_name_for_capture,
            &cancellation,
        )?;
        verify_main_process(
            &adb_path,
            &device_serial_for_capture,
            &package_name_for_capture,
            &pid,
            &cancellation,
        )?;

        let mut command = process::hidden_command(&adb_path);
        adb::prepare_adb_command(&mut command);
        command
            .args(["-s", &device_serial, "shell"])
            .arg(logcat_shell_command(&pid))
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let child = command.spawn().map_err(|_| "CAPTURE_START_FAILED")?;
        let started_at_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
            .min(u64::MAX as u128) as u64;
        let metadata = NetworkCaptureMetadata {
            session_id: format!(
                "network-{started_at_ms}-{}",
                NEXT_SESSION_ID.fetch_add(1, Ordering::Relaxed)
            ),
            device_serial: device_serial_for_capture.clone(),
            package_name: package_name_for_capture.clone(),
            pid,
            started_at_ms,
        };
        spawn_session(metadata, child, cancellation, move |cancellation| {
            probe_main_pid(
                &adb_path,
                &device_serial_for_capture,
                &package_name_for_capture,
                cancellation,
            )
        })
    });
    let detail = match &result {
        Ok(metadata) => format!(
            "capture started for {} (pid {}, session {})",
            metadata.package_name, metadata.pid, metadata.session_id
        ),
        Err(error) => format!("capture start failed: {error}"),
    };
    operation_log::record_event(
        &app,
        "adb_network_capture_start",
        Some(&device_serial),
        &format!("adb -s {device_serial} shell logcat (network capture)"),
        if result.is_ok() { "success" } else { "failed" },
        started.elapsed(),
        &detail,
    );
    result
}

#[tauri::command(async)]
pub fn adb_network_capture_snapshot(
    app: AppHandle,
    state: State<'_, NetworkCaptureState>,
    session_id: String,
) -> Result<NetworkCaptureSnapshot, String> {
    state.snapshot_with_operation_log(&app, &session_id)
}

#[tauri::command(async)]
pub fn adb_network_capture_stop(
    app: AppHandle,
    state: State<'_, NetworkCaptureState>,
    session_id: String,
) -> Result<NetworkCaptureSnapshot, String> {
    let started = Instant::now();
    let result = state.stop(&session_id);
    let (status, detail) = match &result {
        Ok(snapshot) => {
            let status = match snapshot.status {
                NetworkCaptureStatus::Stopped => "success",
                NetworkCaptureStatus::Running => "info",
                NetworkCaptureStatus::Error | NetworkCaptureStatus::AppRestarted => "failed",
            };
            let detail = format!(
                "capture stopped with {} lines (status {:?}, error {:?})",
                snapshot.lines.len(),
                snapshot.status,
                snapshot.error_code
            );
            (status, detail)
        }
        Err(error) => ("failed", error.to_string()),
    };
    operation_log::record_event(
        &app,
        "adb_network_capture_stop",
        None,
        "stop network capture",
        status,
        started.elapsed(),
        &detail,
    );
    result
}

fn validate_target(device_serial: &str, package_name: &str) -> Result<(), &'static str> {
    if device_serial.trim().is_empty() {
        return Err("DEVICE_REQUIRED");
    }
    if device_serial.len() > 512
        || device_serial
            .chars()
            .any(|character| character.is_whitespace() || character.is_control())
    {
        return Err("INVALID_DEVICE");
    }
    if package_name.is_empty()
        || package_name.len() > 255
        || !package_name.split('.').all(|part| {
            let mut characters = part.bytes();
            characters
                .next()
                .is_some_and(|character| character.is_ascii_alphabetic() || character == b'_')
                && characters
                    .all(|character| character.is_ascii_alphanumeric() || character == b'_')
        })
    {
        return Err("INVALID_PACKAGE");
    }
    Ok(())
}

fn capture_now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u64::MAX as u128) as u64
}

fn logcat_shell_command(pid: &str) -> String {
    // ADB concatenates shell arguments remotely. Quoting the filters prevents
    // the device shell from expanding '*:S'; PID is validated decimal input.
    let filters = HTTP_LOG_TAGS.map(|tag| format!("'{tag}:V'")).join(" ");
    format!("logcat -b main -v threadtime --pid={pid} -T 1 {filters} '*:S'")
}

fn parse_pid_output(output: &[u8]) -> Result<String, String> {
    let output = std::str::from_utf8(output).map_err(|_| "APP_PROCESS_INVALID")?;
    let pids = output.split_whitespace().collect::<Vec<_>>();
    if pids.is_empty() {
        return Err("APP_NOT_RUNNING".to_string());
    }
    if pids.len() != 1 {
        return Err("APP_PROCESS_AMBIGUOUS".to_string());
    }
    if !is_process_id(pids[0]) {
        return Err("APP_PROCESS_INVALID".to_string());
    }
    Ok(pids[0].to_string())
}

fn probe_main_pid(
    adb_path: &Path,
    serial: &str,
    package_name: &str,
    cancellation: &AtomicBool,
) -> Result<String, String> {
    let output = run_control_command(
        adb_path,
        serial,
        &["shell", "pidof", package_name],
        cancellation,
    )?;
    if !output.status.success() && !output.stderr.is_empty() {
        return Err("DEVICE_UNAVAILABLE".to_string());
    }
    parse_pid_output(&output.stdout)
}

fn verify_main_process(
    adb_path: &Path,
    serial: &str,
    package_name: &str,
    pid: &str,
    cancellation: &AtomicBool,
) -> Result<(), String> {
    let cmdline_path = format!("/proc/{pid}/cmdline");
    let output = run_control_command(
        adb_path,
        serial,
        &["shell", "cat", &cmdline_path],
        cancellation,
    )?;
    if !output.status.success() {
        return Err("APP_PROCESS_UNVERIFIED".to_string());
    }
    let process_name = output.stdout.split(|byte| *byte == 0).next().unwrap_or(&[]);
    if process_name != package_name.as_bytes() {
        return Err("APP_PROCESS_UNVERIFIED".to_string());
    }
    Ok(())
}

struct ControlOutput {
    status: ExitStatus,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
}

/// Own each child until it is reaped, including thread-spawn/error/panic paths.
struct OwnedChild(Option<Child>);

impl OwnedChild {
    fn finish(&mut self) {
        if let Some(mut child) = self.0.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

impl Drop for OwnedChild {
    fn drop(&mut self) {
        self.finish();
    }
}

fn read_bounded_output(mut input: impl Read) -> io::Result<(Vec<u8>, bool)> {
    let mut output = Vec::new();
    let mut chunk = [0_u8; 1_024];
    let mut overflowed = false;
    loop {
        match input.read(&mut chunk) {
            Ok(0) => return Ok((output, overflowed)),
            Ok(count) => {
                let retained = count.min(MAX_CONTROL_OUTPUT_BYTES - output.len());
                output.extend_from_slice(&chunk[..retained]);
                overflowed |= retained != count;
            }
            Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
            Err(error) => return Err(error),
        }
    }
}

fn run_control_command(
    adb_path: &Path,
    serial: &str,
    args: &[&str],
    cancellation: &AtomicBool,
) -> Result<ControlOutput, String> {
    let mut command = process::hidden_command(adb_path);
    adb::prepare_adb_command(&mut command);
    command
        .args(["-s", serial])
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = OwnedChild(Some(command.spawn().map_err(|_| "DEVICE_UNAVAILABLE")?));
    let stdout = child.0.as_mut().unwrap().stdout.take().unwrap();
    let stderr = child.0.as_mut().unwrap().stderr.take().unwrap();
    let stdout_reader = thread::Builder::new()
        .name("network-control-out".to_string())
        .spawn(move || read_bounded_output(stdout))
        .map_err(|_| "CAPTURE_START_FAILED")?;
    let stderr_reader = match thread::Builder::new()
        .name("network-control-err".to_string())
        .spawn(move || read_bounded_output(stderr))
    {
        Ok(reader) => reader,
        Err(_) => {
            child.finish();
            let _ = stdout_reader.join();
            return Err("CAPTURE_START_FAILED".to_string());
        }
    };
    let started = Instant::now();
    let result = loop {
        if cancellation.load(Ordering::Acquire) {
            break Err("CAPTURE_CANCELLED");
        }
        match child.0.as_mut().unwrap().try_wait() {
            Ok(Some(status)) => break Ok(status),
            Ok(None) => {}
            Err(_) => break Err("DEVICE_UNAVAILABLE"),
        }
        if started.elapsed() >= CONTROL_TIMEOUT {
            break Err("DEVICE_UNAVAILABLE");
        }
        thread::park_timeout(WORKER_POLL_INTERVAL);
    };
    child.finish();
    // Always drain and join both pipes, even for cancellation or timeout.
    let stdout = stdout_reader.join();
    let stderr = stderr_reader.join();
    let status = result?;
    let (stdout, stdout_overflowed) = stdout
        .map_err(|_| "APP_PROCESS_INVALID")?
        .map_err(|_| "DEVICE_UNAVAILABLE")?;
    let (stderr, stderr_overflowed) = stderr
        .map_err(|_| "APP_PROCESS_INVALID")?
        .map_err(|_| "DEVICE_UNAVAILABLE")?;
    if stdout_overflowed || stderr_overflowed {
        return Err("APP_PROCESS_INVALID".to_string());
    }
    Ok(ControlOutput {
        status,
        stdout,
        stderr,
    })
}

struct CaptureProcess {
    child: OwnedChild,
    stdout_reader: Option<JoinHandle<io::Result<()>>>,
    stderr_reader: Option<JoinHandle<io::Result<()>>>,
}

impl CaptureProcess {
    fn new(child: Child, buffer: Arc<Mutex<CaptureBuffer>>, pid: String) -> Result<Self, String> {
        let mut process = Self {
            child: OwnedChild(Some(child)),
            stdout_reader: None,
            stderr_reader: None,
        };
        let stdout = process
            .child
            .0
            .as_mut()
            .unwrap()
            .stdout
            .take()
            .ok_or("CAPTURE_START_FAILED")?;
        let stderr = process
            .child
            .0
            .as_mut()
            .unwrap()
            .stderr
            .take()
            .ok_or("CAPTURE_START_FAILED")?;
        process.stdout_reader = Some(
            thread::Builder::new()
                .name("network-logcat-out".to_string())
                .spawn(move || read_capture_lines(stdout, &buffer, &pid))
                .map_err(|_| "CAPTURE_START_FAILED")?,
        );
        process.stderr_reader = Some(
            thread::Builder::new()
                .name("network-logcat-err".to_string())
                .spawn(move || {
                    // Never include captured content or device stderr in app
                    // diagnostics. Still drain it to prevent a blocked child.
                    io::copy(&mut { stderr }, &mut io::sink()).map(|_| ())
                })
                .map_err(|_| "CAPTURE_START_FAILED")?,
        );
        Ok(process)
    }

    fn finish(&mut self) -> bool {
        self.child.finish();
        let stdout_ok = self
            .stdout_reader
            .take()
            .is_none_or(|reader| matches!(reader.join(), Ok(Ok(()))));
        let stderr_ok = self
            .stderr_reader
            .take()
            .is_none_or(|reader| matches!(reader.join(), Ok(Ok(()))));
        stdout_ok && stderr_ok
    }
}

impl Drop for CaptureProcess {
    fn drop(&mut self) {
        self.finish();
    }
}

fn spawn_session(
    metadata: NetworkCaptureMetadata,
    child: Child,
    cancellation: Arc<AtomicBool>,
    probe: impl Fn(&AtomicBool) -> Result<String, String> + Send + 'static,
) -> Result<CaptureSession, String> {
    let buffer = Arc::new(Mutex::new(CaptureBuffer::new(
        MAX_QUEUED_LINES,
        MAX_QUEUED_BYTES,
    )));
    let process = CaptureProcess::new(child, Arc::clone(&buffer), metadata.pid.clone())?;
    let worker_buffer = Arc::clone(&buffer);
    let worker_cancellation = Arc::clone(&cancellation);
    let pid = metadata.pid.clone();
    let worker = thread::Builder::new()
        .name("network-capture".to_string())
        .spawn(move || {
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                supervise_capture(process, &worker_buffer, &worker_cancellation, &pid, probe);
            }));
            if result.is_err() {
                lock_buffer(&worker_buffer)
                    .finish(NetworkCaptureStatus::Error, Some("CAPTURE_WORKER_FAILED"));
            }
        })
        .map_err(|_| "CAPTURE_START_FAILED")?;
    Ok(CaptureSession {
        metadata,
        buffer,
        cancellation,
        terminal_logged: AtomicBool::new(false),
        worker: Some(worker),
    })
}

fn supervise_capture(
    mut process: CaptureProcess,
    buffer: &Mutex<CaptureBuffer>,
    cancellation: &AtomicBool,
    expected_pid: &str,
    probe: impl Fn(&AtomicBool) -> Result<String, String>,
) {
    let mut next_process_check = Instant::now() + PROCESS_CHECK_INTERVAL;
    let (mut status, mut error_code) = loop {
        if cancellation.load(Ordering::Acquire) {
            break (NetworkCaptureStatus::Stopped, None);
        }
        match process.child.0.as_mut().unwrap().try_wait() {
            Ok(Some(_)) => break (NetworkCaptureStatus::Error, Some("CAPTURE_EXITED")),
            Err(_) => break (NetworkCaptureStatus::Error, Some("CAPTURE_READ_FAILED")),
            Ok(None) => {}
        }
        if process
            .stdout_reader
            .as_ref()
            .is_some_and(JoinHandle::is_finished)
        {
            break (NetworkCaptureStatus::Error, Some("CAPTURE_EXITED"));
        }
        if Instant::now() >= next_process_check {
            match probe(cancellation) {
                Ok(pid) if pid == expected_pid => {}
                Ok(_) => break (NetworkCaptureStatus::AppRestarted, Some("APP_RESTARTED")),
                Err(code) if code == "APP_NOT_RUNNING" => {
                    break (NetworkCaptureStatus::AppRestarted, Some("APP_RESTARTED"));
                }
                Err(code) if code == "CAPTURE_CANCELLED" => {
                    break (NetworkCaptureStatus::Stopped, None);
                }
                Err(_) => break (NetworkCaptureStatus::Error, Some("DEVICE_UNAVAILABLE")),
            }
            next_process_check = Instant::now() + PROCESS_CHECK_INTERVAL;
        }
        thread::park_timeout(WORKER_POLL_INTERVAL);
    };
    let readers_ok = process.finish();
    if !readers_ok && status == NetworkCaptureStatus::Error {
        status = NetworkCaptureStatus::Error;
        error_code = Some("CAPTURE_READ_FAILED");
    }
    // Publish a terminal state only after both readers have finished, so a
    // terminal snapshot and stop both include the complete final drain.
    lock_buffer(buffer).finish(status, error_code);
}

fn read_capture_lines(
    mut input: impl Read,
    buffer: &Mutex<CaptureBuffer>,
    expected_pid: &str,
) -> io::Result<()> {
    let mut framer = LineFramer::new(MAX_RAW_LINE_BYTES);
    let mut chunk = [0_u8; 8 * 1_024];
    loop {
        match input.read(&mut chunk) {
            Ok(0) => {
                framer.finish(buffer, expected_pid);
                return Ok(());
            }
            Ok(count) => framer.push(&chunk[..count], buffer, expected_pid),
            Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
            Err(error) => return Err(error),
        }
    }
}

struct LineFramer {
    bytes: Vec<u8>,
    max_bytes: usize,
    discarding: bool,
}

impl LineFramer {
    fn new(max_bytes: usize) -> Self {
        Self {
            bytes: Vec::new(),
            max_bytes,
            discarding: false,
        }
    }

    fn push(&mut self, chunk: &[u8], buffer: &Mutex<CaptureBuffer>, expected_pid: &str) {
        for &byte in chunk {
            if byte == b'\n' {
                self.finish(buffer, expected_pid);
            } else if !self.discarding {
                if self.bytes.len() >= self.max_bytes {
                    self.bytes.clear();
                    self.discarding = true;
                } else {
                    self.bytes.push(byte);
                }
            }
        }
    }

    fn finish(&mut self, buffer: &Mutex<CaptureBuffer>, expected_pid: &str) {
        let mut buffer = lock_buffer(buffer);
        if self.discarding {
            buffer.record_loss();
        } else if !self.bytes.is_empty() {
            let line = String::from_utf8_lossy(&self.bytes);
            if matches!(line, std::borrow::Cow::Owned(_)) {
                // Keep reading after malformed bytes and make the corruption
                // visible to the parser/export through the cumulative loss count.
                buffer.record_loss();
            }
            if let Some(line) = parse_network_line(line.trim_end_matches('\r'), expected_pid) {
                buffer.push(line);
            }
        }
        self.bytes.clear();
        self.discarding = false;
    }
}

fn next_field<'a>(line: &mut &'a str) -> Option<&'a str> {
    *line = line.trim_start_matches(char::is_whitespace);
    let boundary = line.find(char::is_whitespace).unwrap_or(line.len());
    if boundary == 0 {
        return None;
    }
    let (field, rest) = line.split_at(boundary);
    *line = rest;
    Some(field)
}

fn is_process_id(value: &str) -> bool {
    !value.is_empty()
        && value.bytes().all(|byte| byte.is_ascii_digit())
        && value.parse::<u32>().is_ok_and(|id| id > 0)
}

fn parse_network_line(line: &str, expected_pid: &str) -> Option<NetworkCaptureLine> {
    let mut remainder = line;
    let date = next_field(&mut remainder)?;
    let time = next_field(&mut remainder)?;
    let pid = next_field(&mut remainder)?;
    let tid = next_field(&mut remainder)?;
    let level = next_field(&mut remainder)?;
    if pid != expected_pid
        || !is_process_id(pid)
        || !is_process_id(tid)
        || !matches!(level, "V" | "D" | "I" | "W" | "E" | "F" | "A")
        || !valid_timestamp(date, time)
    {
        return None;
    }
    let (tag, message) = remainder.trim_start().split_once(':')?;
    if !HTTP_LOG_TAGS.contains(&tag.trim()) {
        return None;
    }
    Some(NetworkCaptureLine {
        timestamp: format!("{date} {time}"),
        pid: pid.to_string(),
        tid: tid.to_string(),
        // Remove only logcat's delimiter space, not the body's indentation or
        // trailing whitespace. split_whitespace would corrupt JSON/text bodies.
        message: message.strip_prefix(' ').unwrap_or(message).to_string(),
    })
}

fn valid_timestamp(date: &str, time: &str) -> bool {
    let Some((month, day)) = date.split_once('-') else {
        return false;
    };
    let Some((clock, fraction)) = time.split_once('.') else {
        return false;
    };
    let parts = clock.split(':').collect::<Vec<_>>();
    let number_in = |value: &str, min: u32, max: u32| {
        value.len() == 2
            && value.bytes().all(|byte| byte.is_ascii_digit())
            && value
                .parse::<u32>()
                .is_ok_and(|number| (min..=max).contains(&number))
    };
    number_in(month, 1, 12)
        && number_in(day, 1, 31)
        && parts.len() == 3
        && number_in(parts[0], 0, 23)
        && number_in(parts[1], 0, 59)
        && number_in(parts[2], 0, 60)
        && (1..=9).contains(&fraction.len())
        && fraction.bytes().all(|byte| byte.is_ascii_digit())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(message: &str) -> NetworkCaptureLine {
        NetworkCaptureLine {
            timestamp: "09-11 12:34:56.123".to_string(),
            pid: "100".to_string(),
            tid: "101".to_string(),
            message: message.to_string(),
        }
    }

    #[test]
    fn validates_explicit_target_and_rejects_remote_shell_input() {
        assert!(validate_target("192.0.2.10:5555", "com.example.calendar").is_ok());
        assert!(validate_target("device-1._adb-tls-connect._tcp", "android").is_ok());
        assert_eq!(validate_target(" ", "com.example"), Err("DEVICE_REQUIRED"));
        assert_eq!(
            validate_target("device\nother", "com.example"),
            Err("INVALID_DEVICE")
        );
        for package in [
            "",
            ".example",
            "com..example",
            "com.example;id",
            "com.a:worker",
            "com.1a",
        ] {
            assert_eq!(validate_target("device", package), Err("INVALID_PACKAGE"));
        }
    }

    #[test]
    fn refuses_absent_ambiguous_or_invalid_main_pids() {
        assert_eq!(parse_pid_output(b" 14895\r\n").unwrap(), "14895");
        assert_eq!(parse_pid_output(b"").unwrap_err(), "APP_NOT_RUNNING");
        assert_eq!(
            parse_pid_output(b"100 101").unwrap_err(),
            "APP_PROCESS_AMBIGUOUS"
        );
        for invalid in ["0", "-12", "12;id", "4294967296"] {
            assert_eq!(
                parse_pid_output(invalid.as_bytes()).unwrap_err(),
                "APP_PROCESS_INVALID"
            );
        }
    }

    #[test]
    fn shell_filters_capture_both_exact_logger_tags_only_for_the_main_pid() {
        assert_eq!(
            logcat_shell_command("100"),
            "logcat -b main -v threadtime --pid=100 -T 1 'OkHttp:V' 'okhttp.OkHttpClient:V' '*:S'"
        );
    }

    #[test]
    fn parses_exact_pid_tag_and_tid_without_altering_message_whitespace() {
        let raw = "09-11 12:34:56.123   100   101 D OkHttp  :   {\"value\": \"a  b\"}  ";
        assert_eq!(
            parse_network_line(raw, "100"),
            Some(line("  {\"value\": \"a  b\"}  "))
        );
        assert!(parse_network_line(raw, "10").is_none());
        assert!(parse_network_line(&raw.replace("OkHttp", "OkHttpOther"), "100").is_none());
        assert!(parse_network_line("--------- beginning of main", "100").is_none());
        assert!(parse_network_line(&raw.replace("12:34:56", "32:34:56"), "100").is_none());
        assert_eq!(
            parse_network_line("09-11 12:34:56.123 100 101 D OkHttp  : ", "100")
                .unwrap()
                .message,
            ""
        );
    }

    #[test]
    fn raw_stream_preserves_both_logger_tags_and_thread_bodies_only_for_the_target_pid() {
        let raw = concat!(
            "09-11 12:34:56.123 100 101 D OkHttp: --> POST https://example.test/first\n",
            "09-11 12:34:56.123 100 102 D okhttp.OkHttpClient: --> GET https://example.test/second\n",
            "09-11 12:34:56.123 100 101 D OkHttp: Content-Type: application/json\n",
            "09-11 12:34:56.123 100 101 D OkHttp: \n",
            "09-11 12:34:56.123 100 101 D OkHttp:   {\"request\":\"first\"}  \n",
            "09-11 12:34:56.123 100 102 D okhttp.OkHttpClient: --> END GET\n",
            "09-11 12:34:56.123 100 101 D OkHttp: --> END POST (23-byte body)\n",
            "09-11 12:34:56.123 100 102 D okhttp.OkHttpClient: <-- 200 https://example.test/second (10ms)\n",
            "09-11 12:34:56.123 100 101 D OkHttp: <-- 200 https://example.test/first (20ms)\n",
            "09-11 12:34:56.123 100 102 D okhttp.OkHttpClient: Content-Type: application/json\n",
            "09-11 12:34:56.123 100 101 D OkHttp: Content-Type: application/json\n",
            "09-11 12:34:56.123 100 102 D okhttp.OkHttpClient: \n",
            "09-11 12:34:56.123 100 102 D okhttp.OkHttpClient:   {\"response\":\"第二\"}  \n",
            "09-11 12:34:56.123 100 101 D OkHttp: \n",
            "09-11 12:34:56.123 100 101 D OkHttp: {\"response\":\"first\"}\n",
            "09-11 12:34:56.123 100 102 D okhttp.OkHttpClient: <-- END HTTP (10ms, 25-byte body)\n",
            "09-11 12:34:56.123 100 101 D OkHttp: <-- END HTTP (20ms, 20-byte body)\n",
            "09-11 12:34:56.123 999 102 D okhttp.OkHttpClient: wrong-pid\n",
            "09-11 12:34:56.123 100 102 D okhttp.OkHttpClientExtra: near-tag\n",
            "09-11 12:34:56.123 100 101 D OkHttpOther: near-tag\n",
            "09-11 12:34:56.123 100 102 D okhttp.okhttpclient: wrong-case\n",
            "09-11 12:34:56.123 100 102 D Otherokhttp.OkHttpClient: prefixed-tag\n",
        );
        let expected = [
            ("101", "--> POST https://example.test/first"),
            ("102", "--> GET https://example.test/second"),
            ("101", "Content-Type: application/json"),
            ("101", ""),
            ("101", "  {\"request\":\"first\"}  "),
            ("102", "--> END GET"),
            ("101", "--> END POST (23-byte body)"),
            ("102", "<-- 200 https://example.test/second (10ms)"),
            ("101", "<-- 200 https://example.test/first (20ms)"),
            ("102", "Content-Type: application/json"),
            ("101", "Content-Type: application/json"),
            ("102", ""),
            ("102", "  {\"response\":\"第二\"}  "),
            ("101", ""),
            ("101", "{\"response\":\"first\"}"),
            ("102", "<-- END HTTP (10ms, 25-byte body)"),
            ("101", "<-- END HTTP (20ms, 20-byte body)"),
        ]
        .into_iter()
        .map(|(tid, message)| NetworkCaptureLine {
            tid: tid.to_string(),
            ..line(message)
        })
        .collect::<Vec<_>>();
        let buffer = Mutex::new(CaptureBuffer::new(100, 16_384));
        read_capture_lines(raw.as_bytes(), &buffer, "100").unwrap();
        let snapshot = lock_buffer(&buffer).drain("both-loggers");
        assert_eq!(snapshot.lines, expected);
        assert_eq!(snapshot.dropped_lines, 0);
    }

    #[test]
    fn queue_enforces_line_and_byte_bounds_and_preserves_loss_after_drain() {
        let mut buffer = CaptureBuffer::new(2, 1_024);
        buffer.push(line("first"));
        buffer.push(line("second"));
        buffer.push(line("third"));
        let snapshot = buffer.drain("session");
        assert_eq!(snapshot.lines, vec![line("second"), line("third")]);
        assert_eq!(snapshot.dropped_lines, 1);
        assert_eq!(buffer.bytes, 0);
        assert_eq!(buffer.drain("session").dropped_lines, 1);

        let max_bytes = line_size(&line("a")) + 1;
        let mut buffer = CaptureBuffer::new(100, max_bytes);
        buffer.push(line("a"));
        buffer.push(line("b"));
        buffer.push(line(&"x".repeat(max_bytes + 1)));
        assert_eq!(buffer.lines.len(), 1);
        assert!(buffer.bytes <= max_bytes);
        assert_eq!(buffer.dropped_lines, 2);
    }

    #[test]
    fn oversized_and_invalid_utf8_lines_do_not_end_following_capture() {
        let buffer = Mutex::new(CaptureBuffer::new(10, 4_096));
        let mut framer = LineFramer::new(100);
        framer.push(&[b'x'; 101], &buffer, "100");
        assert!(framer.bytes.len() <= 100);
        framer.push(
            b"\n09-11 12:34:56.123 100 101 D OkHttp: bad\xffbyte\n",
            &buffer,
            "100",
        );
        framer.push(b"09-11 12:34:56.123 100 101 D OkHttp: next", &buffer, "100");
        framer.finish(&buffer, "100");
        let snapshot = lock_buffer(&buffer).drain("session");
        assert_eq!(snapshot.dropped_lines, 2);
        assert_eq!(snapshot.lines.len(), 2);
        assert_eq!(snapshot.lines[0].message, "bad\u{fffd}byte");
        assert_eq!(snapshot.lines[1].message, "next");
    }

    #[test]
    fn reader_preserves_multibyte_text_split_across_chunks_and_final_line() {
        let buffer = Mutex::new(CaptureBuffer::new(10, 4_096));
        let mut framer = LineFramer::new(100);
        let raw = "09-11 12:34:56.123 100 101 D OkHttp: 中文\n";
        for byte in raw.as_bytes() {
            framer.push(&[*byte], &buffer, "100");
        }
        framer.finish(&buffer, "100");
        let snapshot = lock_buffer(&buffer).drain("session");
        assert_eq!(snapshot.dropped_lines, 0);
        assert_eq!(snapshot.lines, vec![line("中文")]);
    }

    #[test]
    fn control_output_is_bounded_but_drains_all_input() {
        let input = vec![b'x'; MAX_CONTROL_OUTPUT_BYTES * 3];
        let (output, overflowed) = read_bounded_output(input.as_slice()).unwrap();
        assert_eq!(output.len(), MAX_CONTROL_OUTPUT_BYTES);
        assert!(overflowed);
    }

    #[cfg(unix)]
    fn test_session(
        id: &str,
        probe: impl Fn(&AtomicBool) -> Result<String, String> + Send + 'static,
    ) -> CaptureSession {
        let mut command = process::hidden_command("/bin/sh");
        command
            .args([
                "-c",
                "printf '09-11 12:34:56.123 100 101 D OkHttp: captured\\n'; exec sleep 30",
            ])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let child = command.spawn().unwrap();
        spawn_session(
            NetworkCaptureMetadata {
                session_id: id.to_string(),
                device_serial: "test-device".to_string(),
                package_name: "com.example.calendar".to_string(),
                pid: "100".to_string(),
                started_at_ms: 1,
            },
            child,
            Arc::new(AtomicBool::new(false)),
            probe,
        )
        .unwrap()
    }

    #[cfg(unix)]
    fn wait_for_line(session: &CaptureSession) {
        let deadline = Instant::now() + Duration::from_secs(2);
        while lock_buffer(&session.buffer).lines.is_empty() {
            assert!(
                Instant::now() < deadline,
                "test child did not produce its line"
            );
            thread::sleep(Duration::from_millis(10));
        }
    }

    #[cfg(unix)]
    #[test]
    fn stop_drains_final_lines_releases_worker_and_is_idempotent() {
        let mut session = test_session("first", |_| Ok("100".to_string()));
        wait_for_line(&session);
        session.stop();
        assert!(session.worker.is_none());
        let snapshot = session.snapshot();
        assert_eq!(snapshot.status, NetworkCaptureStatus::Stopped);
        assert_eq!(snapshot.lines, vec![line("captured")]);
        session.stop();
        assert!(session.snapshot().lines.is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn stale_stop_cannot_kill_or_drain_a_new_session() {
        let state = NetworkCaptureState::default();
        state
            .start_with(|| Ok(test_session("first", |_| Ok("100".to_string()))))
            .unwrap();
        assert_eq!(
            state
                .start_with(|| panic!("must not create a concurrent child"))
                .unwrap_err(),
            "CAPTURE_ALREADY_RUNNING"
        );
        state.stop("first").unwrap();
        state
            .start_with(|| Ok(test_session("second", |_| Ok("100".to_string()))))
            .unwrap();
        assert_eq!(state.stop("first").unwrap_err(), "CAPTURE_NOT_FOUND");
        assert_eq!(state.snapshot("first").unwrap_err(), "CAPTURE_NOT_FOUND");
        assert_eq!(
            state.snapshot("second").unwrap().status,
            NetworkCaptureStatus::Running
        );
        state.shutdown();
        assert_eq!(state.snapshot("second").unwrap_err(), "CAPTURE_NOT_FOUND");
    }

    #[cfg(unix)]
    #[test]
    fn pid_change_ends_capture_without_waiting_for_a_ui_poll() {
        let mut session = test_session("restart", |_| Ok("200".to_string()));
        let deadline = Instant::now() + Duration::from_secs(3);
        while lock_buffer(&session.buffer).status == NetworkCaptureStatus::Running {
            assert!(
                Instant::now() < deadline,
                "capture did not detect the changed PID"
            );
            thread::sleep(Duration::from_millis(20));
        }
        session.stop();
        let snapshot = session.snapshot();
        assert_eq!(snapshot.status, NetworkCaptureStatus::AppRestarted);
        assert_eq!(snapshot.error_code.as_deref(), Some("APP_RESTARTED"));
        assert_eq!(snapshot.lines, vec![line("captured")]);
    }

    #[cfg(unix)]
    #[test]
    fn dropping_state_cancels_and_joins_the_active_capture() {
        let state = NetworkCaptureState::default();
        let session = test_session("drop", |_| Ok("100".to_string()));
        wait_for_line(&session);
        let buffer = Arc::clone(&session.buffer);
        state.start_with(|| Ok(session)).unwrap();
        drop(state);
        assert_eq!(lock_buffer(&buffer).status, NetworkCaptureStatus::Stopped);
        assert_eq!(Arc::strong_count(&buffer), 1);
    }

    #[cfg(unix)]
    #[test]
    fn unexpected_child_exit_is_explicit_and_keeps_its_final_output() {
        let mut command = process::hidden_command("/bin/sh");
        command
            .args([
                "-c",
                "printf '09-11 12:34:56.123 100 101 D OkHttp: last\\n'; exit 1",
            ])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let mut session = spawn_session(
            NetworkCaptureMetadata {
                session_id: "exit".to_string(),
                device_serial: "test-device".to_string(),
                package_name: "com.example.calendar".to_string(),
                pid: "100".to_string(),
                started_at_ms: 1,
            },
            command.spawn().unwrap(),
            Arc::new(AtomicBool::new(false)),
            |_| Ok("100".to_string()),
        )
        .unwrap();
        let deadline = Instant::now() + Duration::from_secs(2);
        while lock_buffer(&session.buffer).status == NetworkCaptureStatus::Running {
            assert!(
                Instant::now() < deadline,
                "capture did not detect child exit"
            );
            thread::sleep(Duration::from_millis(10));
        }
        session.stop();
        let snapshot = session.snapshot();
        assert_eq!(snapshot.status, NetworkCaptureStatus::Error);
        assert_eq!(snapshot.error_code.as_deref(), Some("CAPTURE_EXITED"));
        assert_eq!(snapshot.lines, vec![line("last")]);
    }
}

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::process::Child;
use std::sync::{atomic::AtomicBool, Arc, Mutex};
use std::thread::JoinHandle;
use tokio::runtime::Runtime;
use webrtc::peer_connection::RTCPeerConnection;

#[derive(Default)]
pub struct RecordingState {
    pub process: Option<std::process::Child>,
    pub device: Option<String>,
    pub remote_path: Option<String>,
}

pub struct AppState {
    pub adb_server_operation: Mutex<()>,
    pub remote_control_operation: Mutex<()>,
    pub remote_screenshot_in_flight: Mutex<HashSet<String>>,
    pub remote_frame_cache: Mutex<HashMap<String, RemoteFrameCache>>,
    pub remote_control: Mutex<RemoteControlRuntime>,
    pub remote_audit_log: Mutex<Vec<RemoteAuditEntry>>,
    pub remote_video_stream: Mutex<Option<RemoteVideoStreamState>>,
    pub remote_webrtc_stream: Mutex<Option<RemoteWebRtcStreamState>>,
    pub recording: Mutex<RecordingState>,
    pub logcat_process: Mutex<Option<std::process::Child>>,
    pub logcat_device: Mutex<Option<String>>,
    pub scrcpy_process: Mutex<Option<std::process::Child>>,
    pub scrcpy_device: Mutex<Option<String>>,
    pub scrcpy_installing: Mutex<bool>,
    pub installing: Mutex<bool>,
    pub device_sn_cache: Mutex<HashMap<String, String>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            adb_server_operation: Mutex::new(()),
            remote_control_operation: Mutex::new(()),
            remote_screenshot_in_flight: Mutex::new(HashSet::new()),
            remote_frame_cache: Mutex::new(HashMap::new()),
            remote_control: Mutex::new(RemoteControlRuntime::default()),
            remote_audit_log: Mutex::new(Vec::new()),
            remote_video_stream: Mutex::new(None),
            remote_webrtc_stream: Mutex::new(None),
            recording: Mutex::new(RecordingState::default()),
            logcat_process: Mutex::new(None),
            logcat_device: Mutex::new(None),
            scrcpy_process: Mutex::new(None),
            scrcpy_device: Mutex::new(None),
            scrcpy_installing: Mutex::new(false),
            installing: Mutex::new(false),
            device_sn_cache: Mutex::new(HashMap::new()),
        }
    }
}

pub struct RemoteVideoStreamState {
    pub serial: String,
    pub dir: PathBuf,
    pub playlist_path: PathBuf,
    pub started_at_ms: u64,
    pub adb_child: Child,
    pub ffmpeg_child: Child,
}

pub struct RemoteWebRtcStreamState {
    pub id: String,
    pub serial: String,
    pub session_id: String,
    pub started_at_ms: u64,
    pub rtp_port: u16,
    pub connection_state: Arc<Mutex<String>>,
    pub last_error: Arc<Mutex<Option<String>>>,
    pub stop_flag: Arc<AtomicBool>,
    pub runtime: Runtime,
    pub peer: Arc<RTCPeerConnection>,
    pub adb_child: Child,
    pub ffmpeg_child: Child,
    pub rtp_thread: Option<JoinHandle<()>>,
}

#[derive(Default)]
pub struct RemoteControlRuntime {
    pub port: Option<u16>,
    pub started_at_ms: Option<u64>,
    pub session: Option<RemoteAuthSession>,
    pub invites: HashMap<String, RemoteInvite>,
    pub sessions: HashMap<String, RemoteSessionInfo>,
    pub control_owner: RemoteControlOwner,
    pub stop_flag: Option<Arc<AtomicBool>>,
    pub handle: Option<JoinHandle<()>>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum RemoteRole {
    Viewer,
    Operator,
    Admin,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RemoteAction {
    View,
    Input,
    Clipboard,
    Template,
    InstallApk,
    Admin,
}

impl RemoteRole {
    pub fn allows(self, action: RemoteAction) -> bool {
        match self {
            Self::Viewer => matches!(action, RemoteAction::View),
            Self::Operator => matches!(
                action,
                RemoteAction::View
                    | RemoteAction::Input
                    | RemoteAction::Clipboard
                    | RemoteAction::Template
            ),
            Self::Admin => true,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Viewer => "viewer",
            Self::Operator => "operator",
            Self::Admin => "admin",
        }
    }
}

impl std::fmt::Display for RemoteRole {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

#[derive(Debug, Serialize, Clone)]
pub struct RemoteInvite {
    pub token: String,
    pub role: RemoteRole,
    pub created_at_ms: u64,
    pub expires_at_ms: u64,
    pub used: bool,
}

impl RemoteInvite {
    pub fn new(token: String, role: RemoteRole, created_at_ms: u64, expires_at_ms: u64) -> Self {
        Self {
            token,
            role,
            created_at_ms,
            expires_at_ms,
            used: false,
        }
    }

    #[cfg(test)]
    pub fn claim(&mut self, client_name: String, now_ms: u64) -> Option<RemoteSessionInfo> {
        self.claim_with_session_token(client_name, now_ms, format!("session-{}", self.token))
    }

    pub fn claim_with_session_token(
        &mut self,
        client_name: String,
        now_ms: u64,
        session_token: String,
    ) -> Option<RemoteSessionInfo> {
        if self.used || now_ms > self.expires_at_ms {
            return None;
        }

        self.used = true;
        Some(RemoteSessionInfo {
            id: format!("{}-{}", self.role, now_ms),
            token: session_token,
            role: self.role,
            client_name,
            connected_at_ms: now_ms,
            last_seen_ms: now_ms,
        })
    }
}

#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
pub struct RemoteSessionInfo {
    pub id: String,
    pub token: String,
    pub role: RemoteRole,
    pub client_name: String,
    pub connected_at_ms: u64,
    pub last_seen_ms: u64,
}

impl RemoteSessionInfo {
    #[cfg(test)]
    pub fn new(id: String, role: RemoteRole, now_ms: u64) -> Self {
        Self {
            token: id.clone(),
            id,
            role,
            client_name: "remote".to_string(),
            connected_at_ms: now_ms,
            last_seen_ms: now_ms,
        }
    }
}

#[derive(Debug, Serialize, Clone, Default, PartialEq, Eq)]
pub struct RemoteControlOwner {
    pub session_id: Option<String>,
    pub role: Option<RemoteRole>,
    pub acquired_at_ms: Option<u64>,
}

impl RemoteControlOwner {
    pub fn acquire(
        &mut self,
        session: &RemoteSessionInfo,
        force: bool,
        now_ms: u64,
    ) -> Result<(), String> {
        if !session.role.allows(RemoteAction::Input) {
            return Err("Viewer cannot acquire control".to_string());
        }
        if self.session_id.as_deref() == Some(session.id.as_str()) {
            self.acquired_at_ms = Some(now_ms);
            return Ok(());
        }
        if self.session_id.is_some() && !(force && session.role == RemoteRole::Admin) {
            return Err("Another operator already has control".to_string());
        }

        self.session_id = Some(session.id.clone());
        self.role = Some(session.role);
        self.acquired_at_ms = Some(now_ms);
        Ok(())
    }

    pub fn release(&mut self, session_id: &str) -> bool {
        if self.session_id.as_deref() != Some(session_id) {
            return false;
        }

        self.session_id = None;
        self.role = None;
        self.acquired_at_ms = None;
        true
    }

    pub fn is_owner(&self, session_id: &str) -> bool {
        self.session_id.as_deref() == Some(session_id)
    }
}

#[derive(Debug, Clone)]
pub struct RemoteFrameCache {
    pub jpeg: Vec<u8>,
    pub captured_at_ms: u64,
}

#[derive(Clone, Debug)]
pub struct RemoteAuthSession {
    pin: String,
    token: String,
    pin_used: bool,
}

impl RemoteAuthSession {
    pub fn new(pin: String, token: String) -> Self {
        Self {
            pin,
            token,
            pin_used: false,
        }
    }

    pub fn pin(&self) -> &str {
        &self.pin
    }

    pub fn pin_used(&self) -> bool {
        self.pin_used
    }

    pub fn exchange_pin(&mut self, candidate: &str) -> Option<String> {
        if self.pin_used || candidate.trim() != self.pin {
            return None;
        }

        self.pin_used = true;
        Some(self.token.clone())
    }

    pub fn matches_token(&self, candidate: &str) -> bool {
        !candidate.trim().is_empty() && candidate.trim() == self.token
    }
}

#[derive(Debug, Serialize, Clone)]
pub struct RemoteAuditEntry {
    pub ts_ms: u64,
    pub session_id: String,
    pub role: String,
    pub action: String,
    pub serial: String,
    pub ok: bool,
    pub message: String,
}

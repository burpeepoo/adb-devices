use crate::adb::{self, AdbError};
use crate::commands::device;
use crate::state::{
    AppState, RemoteAuditEntry, RemoteFrameCache, RemoteVideoStreamState, RemoteWebRtcStreamState,
};
pub use crate::state::{
    RemoteAction, RemoteAuthSession, RemoteControlOwner, RemoteInvite, RemoteRole,
    RemoteSessionInfo,
};
use image::codecs::jpeg::JpegEncoder;
use qrcode::{render::svg, QrCode};
use rand::{distributions::Alphanumeric, Rng};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::{BufRead, BufReader, Read, Write},
    net::{TcpListener, TcpStream, UdpSocket},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager, State};
use tokio::runtime::Builder as TokioRuntimeBuilder;
use webrtc::{
    api::{
        interceptor_registry::register_default_interceptors,
        media_engine::{MediaEngine, MIME_TYPE_H264},
        APIBuilder,
    },
    interceptor::registry::Registry,
    peer_connection::{
        configuration::RTCConfiguration, peer_connection_state::RTCPeerConnectionState,
        sdp::session_description::RTCSessionDescription, RTCPeerConnection,
    },
    rtp_transceiver::rtp_codec::RTCRtpCodecCapability,
    track::track_local::{
        track_local_static_rtp::TrackLocalStaticRTP, TrackLocal, TrackLocalWriter,
    },
    util::marshal::Unmarshal,
};

const MAX_AUDIT_ENTRIES: usize = 100;
const REMOTE_ENTRY_PATH: &str = "/remote";
const INVITE_TTL_MS: u64 = 10 * 60 * 1000;
const SESSION_TTL_MS: u64 = 12 * 60 * 60 * 1000;
const TRUSTED_DEVICE_TTL_MS: u64 = 7 * 24 * 60 * 60 * 1000;
const TRUST_STORE_FILE: &str = "remote-trusted-devices.json";
const TRUST_STORE_VERSION: u32 = 1;
const STREAM_BOUNDARY: &str = "adb-manager-frame";
const MJPEG_CONTENT_TYPE: &str = "multipart/x-mixed-replace; boundary=adb-manager-frame";
const STREAM_FPS: u64 = 5;
const STREAM_JPEG_QUALITY: u8 = 70;
const STREAM_MAX_WIDTH: u32 = 960;
const STREAM_FRAME_CACHE_MS: u64 = 180;
const REMOTE_SCREENSHOT_TIMEOUT_SECS: u64 = 20;
const REMOTE_HLS_START_TIMEOUT_SECS: u64 = 12;
const REMOTE_HLS_SEGMENT_SECONDS: u64 = 1;
const REMOTE_HLS_LIST_SIZE: u64 = 4;
const WEBRTC_RTP_PACKET_BYTES: usize = 2048;
const WEBRTC_SCREENRECORD_SECONDS: &str = "180";
const WEBRTC_BIT_RATE: &str = "4000000";
const WEBRTC_PAYLOAD_TYPE: &str = "102";
const WEBRTC_SSRC: &str = "2222222";
const MAX_REMOTE_APK_BYTES: usize = 300 * 1024 * 1024;

#[derive(Debug, Serialize, Clone)]
pub struct RemoteControlStatus {
    pub enabled: bool,
    pub port: Option<u16>,
    pub pin: Option<String>,
    pub pin_used: bool,
    pub urls: Vec<String>,
    pub addresses: Vec<RemoteAddress>,
    pub invite_links: Vec<RemoteInviteLink>,
    pub sessions: Vec<RemoteSessionInfo>,
    pub trusted_devices: Vec<RemoteTrustedDeviceInfo>,
    pub control_owner: RemoteControlOwner,
    pub stream_defaults: RemoteStreamDefaults,
    pub qr_svg: Option<String>,
    pub started_at_ms: Option<u64>,
    pub audit: Vec<RemoteAuditEntry>,
}

#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
pub struct RemoteAddress {
    pub kind: RemoteAddressKind,
    pub label: String,
    pub host: String,
    pub url: String,
}

#[derive(Debug, Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RemoteAddressKind {
    Tailscale,
    Lan,
    Localhost,
}

#[derive(Debug, Serialize, Clone)]
pub struct RemoteInviteLink {
    pub role: RemoteRole,
    pub url: String,
    pub qr_svg: Option<String>,
    pub expires_at_ms: u64,
    pub used: bool,
}

#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
pub struct RemoteTrustedDeviceInfo {
    pub id: String,
    pub role: RemoteRole,
    pub client_name: String,
    pub created_at_ms: u64,
    pub expires_at_ms: u64,
    pub last_seen_ms: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
struct StoredRemoteTrustedDevice {
    id: String,
    token_hash: String,
    role: RemoteRole,
    client_name: String,
    created_at_ms: u64,
    expires_at_ms: u64,
    last_seen_ms: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
struct RemoteTrustStore {
    version: u32,
    last_port: Option<u16>,
    devices: Vec<StoredRemoteTrustedDevice>,
}

impl Default for RemoteTrustStore {
    fn default() -> Self {
        Self {
            version: TRUST_STORE_VERSION,
            last_port: None,
            devices: Vec::new(),
        }
    }
}

#[derive(Debug, Serialize, Clone)]
pub struct RemoteStreamDefaults {
    pub fps: u64,
    pub jpeg_quality: u8,
    pub max_width: u32,
}

#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
pub struct RemoteDevice {
    pub serial: String,
    pub state: String,
    pub model: String,
    pub product: String,
    pub connection_type: String,
}

#[derive(Debug, Deserialize)]
struct AuthRequest {
    pin: String,
}

#[derive(Debug, Deserialize)]
struct InviteClaimRequest {
    invite: String,
    client_name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TrustRegisterRequest {
    client_name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TrustClaimRequest {
    trusted_token: String,
    client_name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TrustRevokeRequest {
    id: String,
}

#[derive(Debug, Deserialize)]
struct SessionRequest {
    session_id: String,
}

#[derive(Debug, Deserialize)]
struct ControlRequest {
    force: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct DeviceRequest {
    serial: String,
}

#[derive(Debug, Deserialize)]
struct RemoteVideoStreamRequest {
    serial: String,
}

#[derive(Debug, Deserialize)]
struct RemoteWebRtcOfferRequest {
    serial: String,
    offer_sdp: String,
}

#[derive(Debug, Deserialize)]
struct TapRequest {
    serial: String,
    x: i32,
    y: i32,
}

#[derive(Debug, Deserialize)]
struct SwipeRequest {
    serial: String,
    x1: i32,
    y1: i32,
    x2: i32,
    y2: i32,
    duration_ms: Option<i32>,
}

#[derive(Debug, Deserialize)]
struct TextRequest {
    serial: String,
    text: String,
}

#[derive(Debug, Deserialize)]
struct ClipboardRequest {
    serial: String,
    text: String,
}

#[derive(Debug, Deserialize)]
struct KeyRequest {
    serial: String,
    key: String,
}

#[derive(Debug, Deserialize)]
struct TemplateRunRequest {
    serial: String,
    template_id: String,
}

#[derive(Debug, Serialize, Clone)]
struct RemoteCommandTemplate {
    id: &'static str,
    label: &'static str,
    args: Vec<&'static str>,
}

#[derive(Debug, Serialize, Clone)]
struct RemoteVideoStreamInfo {
    serial: String,
    mode: &'static str,
    playlist_url: String,
    started_at_ms: u64,
}

#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
struct RemoteWebRtcStreamInfo {
    id: String,
    serial: String,
    mode: &'static str,
    codec: &'static str,
    source: &'static str,
    rtp_port: u16,
    started_at_ms: u64,
}

#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
struct RemoteWebRtcStatusInfo {
    active: bool,
    id: Option<String>,
    serial: Option<String>,
    session_id: Option<String>,
    state: String,
    started_at_ms: Option<u64>,
    last_error: Option<String>,
}

impl RemoteWebRtcStatusInfo {
    fn inactive() -> Self {
        Self {
            active: false,
            id: None,
            serial: None,
            session_id: None,
            state: "inactive".to_string(),
            started_at_ms: None,
            last_error: None,
        }
    }

    fn active(
        serial: String,
        session_id: String,
        state: String,
        started_at_ms: u64,
        last_error: Option<String>,
    ) -> Self {
        Self {
            active: true,
            id: None,
            serial: Some(serial),
            session_id: Some(session_id),
            state,
            started_at_ms: Some(started_at_ms),
            last_error,
        }
    }
}

struct HttpRequest {
    method: String,
    path: String,
    query: HashMap<String, String>,
    headers: HashMap<String, String>,
    body: Vec<u8>,
    body_too_large: bool,
}

struct HttpResponse {
    status: u16,
    reason: &'static str,
    content_type: &'static str,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
}

struct RemoteScreenshotLease<'a> {
    in_flight: &'a Mutex<HashSet<String>>,
    serial: String,
}

impl<'a> RemoteScreenshotLease<'a> {
    fn try_acquire(in_flight: &'a Mutex<HashSet<String>>, serial: &str) -> Result<Self, String> {
        let mut active = in_flight
            .lock()
            .map_err(|_| "Screenshot state is unavailable".to_string())?;
        if active.contains(serial) {
            return Err("Screenshot already refreshing".to_string());
        }

        active.insert(serial.to_string());
        Ok(Self {
            in_flight,
            serial: serial.to_string(),
        })
    }
}

impl Drop for RemoteScreenshotLease<'_> {
    fn drop(&mut self) {
        if let Ok(mut active) = self.in_flight.lock() {
            active.remove(&self.serial);
        }
    }
}

#[tauri::command(async)]
pub fn remote_control_status(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<RemoteControlStatus, AdbError> {
    remote_status(&app, &state)
}

#[tauri::command(async)]
pub fn remote_control_start(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<RemoteControlStatus, AdbError> {
    let mut runtime = state
        .remote_control
        .lock()
        .map_err(|_| remote_state_error())?;
    if runtime.port.is_some() {
        return remote_status_from_state(&app, &state, &mut runtime);
    }

    cleanup_remote_trust_store(&app).map_err(remote_command_error)?;
    let listener = bind_remote_listener(&app).map_err(AdbError::Io)?;
    let port = listener.local_addr().map_err(AdbError::Io)?.port();
    let stop_flag = Arc::new(AtomicBool::new(false));
    let thread_flag = Arc::clone(&stop_flag);
    let thread_app = app.clone();
    let handle = thread::spawn(move || run_remote_server(thread_app, listener, thread_flag));

    runtime.port = Some(port);
    runtime.started_at_ms = Some(now_ms());
    runtime.session = Some(RemoteAuthSession::new(generate_pin(), generate_token()));
    runtime.invites.clear();
    ensure_role_invites(&mut runtime, now_ms());
    runtime.sessions.clear();
    runtime.control_owner = RemoteControlOwner::default();
    runtime.stop_flag = Some(stop_flag);
    runtime.handle = Some(handle);

    remote_status_from_state(&app, &state, &mut runtime)
}

#[tauri::command(async)]
pub fn remote_control_stop(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<RemoteControlStatus, AdbError> {
    let (port, stop_flag, handle) = {
        let mut runtime = state
            .remote_control
            .lock()
            .map_err(|_| remote_state_error())?;
        (
            runtime.port.take(),
            runtime.stop_flag.take(),
            runtime.handle.take(),
        )
    };

    if let Some(flag) = stop_flag {
        flag.store(true, Ordering::SeqCst);
    }

    if let Some(port) = port {
        let _ = TcpStream::connect(("127.0.0.1", port));
    }

    if let Some(handle) = handle {
        let _ = handle.join();
    }

    {
        let mut runtime = state
            .remote_control
            .lock()
            .map_err(|_| remote_state_error())?;
        runtime.started_at_ms = None;
        runtime.session = None;
        runtime.invites.clear();
        runtime.sessions.clear();
        runtime.control_owner = RemoteControlOwner::default();
    }
    if let Ok(mut audit) = state.remote_audit_log.lock() {
        audit.clear();
    }
    if let Ok(mut cache) = state.remote_frame_cache.lock() {
        cache.clear();
    }
    if let Ok(mut video_stream) = state.remote_video_stream.lock() {
        stop_remote_video_stream_locked(&mut video_stream);
    }
    if let Ok(mut webrtc_stream) = state.remote_webrtc_stream.lock() {
        stop_remote_webrtc_stream_locked(&mut webrtc_stream);
    }

    remote_status(&app, &state)
}

#[tauri::command(async)]
pub fn remote_control_trusted_devices(
    app: AppHandle,
) -> Result<Vec<RemoteTrustedDeviceInfo>, String> {
    remote_trusted_devices(&app)
}

#[tauri::command(async)]
pub fn remote_control_revoke_trusted_device(
    app: AppHandle,
    id: String,
) -> Result<Vec<RemoteTrustedDeviceInfo>, String> {
    revoke_trusted_device(&app, &id)
}

#[tauri::command(async)]
pub fn remote_control_revoke_all_trusted_devices(
    app: AppHandle,
) -> Result<Vec<RemoteTrustedDeviceInfo>, String> {
    revoke_all_trusted_devices(&app)
}

fn run_remote_server(app: AppHandle, listener: TcpListener, stop_flag: Arc<AtomicBool>) {
    let _ = listener.set_nonblocking(true);
    while !stop_flag.load(Ordering::SeqCst) {
        match listener.accept() {
            Ok((stream, _)) => {
                let request_app = app.clone();
                thread::spawn(move || handle_connection(request_app, stream));
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(50));
            }
            Err(_) => break,
        }
    }
}

fn handle_connection(app: AppHandle, mut stream: TcpStream) {
    let response = match read_http_request(&stream) {
        Ok(request) if request.method == "GET" && request.path == "/remote/api/stream.mjpeg" => {
            return handle_mjpeg_stream(&app, &request, &mut stream);
        }
        Ok(request) => route_request(&app, request),
        Err(message) if is_ignorable_http_read_error(&message) => return,
        Err(message) => json_response(400, json!({ "ok": false, "error": message })),
    };
    let _ = write_http_response(&mut stream, response);
}

fn handle_mjpeg_stream(app: &AppHandle, request: &HttpRequest, stream: &mut TcpStream) {
    let session = match authorize_remote_request(app, request) {
        Ok(session) => session,
        Err(response) => {
            let _ = write_http_response(stream, response);
            return;
        }
    };
    if !session.role.allows(RemoteAction::View) {
        let _ = write_http_response(
            stream,
            json_response(403, json!({ "ok": false, "error": "Permission denied" })),
        );
        return;
    }

    let Some(serial) = request.query.get("serial").map(|value| value.trim()) else {
        let _ = write_http_response(
            stream,
            json_response(400, json!({ "ok": false, "error": "Missing serial" })),
        );
        return;
    };
    if let Err(error) = validate_serial(serial) {
        let _ = write_http_response(
            stream,
            json_response(400, json!({ "ok": false, "error": error })),
        );
        return;
    }

    let _ = stream.set_write_timeout(Some(Duration::from_secs(10)));
    if write!(
        stream,
        "HTTP/1.1 200 OK\r\nContent-Type: {MJPEG_CONTENT_TYPE}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n"
    )
    .is_err()
    {
        return;
    }

    let first_frame = match get_or_capture_jpeg_frame(app, serial) {
        Ok(frame) => frame,
        Err(error) => {
            record_remote_audit(app, Some(&session), "stream.open", serial, false, &error);
            return;
        }
    };

    record_remote_audit(
        app,
        Some(&session),
        "stream.open",
        serial,
        true,
        "MJPEG stream opened",
    );
    if write_mjpeg_frame(stream, &first_frame).is_err() {
        return;
    }

    let frame_interval = Duration::from_millis((1000 / STREAM_FPS.max(1)).max(1));
    loop {
        thread::sleep(frame_interval);
        match get_or_capture_jpeg_frame(app, serial) {
            Ok(frame) => {
                if write_mjpeg_frame(stream, &frame).is_err() {
                    break;
                }
            }
            Err(_) => break,
        }
    }
}

fn route_request(app: &AppHandle, request: HttpRequest) -> HttpResponse {
    if request.method == "GET"
        && request
            .path
            .starts_with("/remote/api/video-stream/segment/")
    {
        return with_session(app, &request, RemoteAction::View, |_| {
            handle_video_stream_segment(app, &request)
        });
    }

    match (request.method.as_str(), request.path.as_str()) {
        ("GET", "/") | ("GET", "/remote") | ("GET", "/remote/") | ("GET", "/remote/index.html") => {
            html_response(remote_app_html())
        }
        ("GET", "/remote/manifest.webmanifest") => json_response(
            200,
            json!({
                "name": "ADB Manager Remote Control",
                "short_name": "ADB Remote",
                "start_url": "/remote",
                "scope": "/remote",
                "display": "standalone",
                "background_color": "#f7f8fb",
                "theme_color": "#1c7ed6"
            }),
        ),
        ("GET", "/remote/sw.js") => js_response(remote_service_worker_js()),
        ("POST", "/remote/api/auth") => handle_auth(app, &request),
        ("POST", "/remote/api/invite/claim") => handle_invite_claim(app, &request),
        ("POST", "/remote/api/trust/claim") => handle_trust_claim(app, &request),
        ("POST", "/remote/api/trust/register") => {
            with_session(app, &request, RemoteAction::View, |session| {
                handle_trust_register(app, &request, session)
            })
        }
        ("GET", "/remote/api/trust/devices") => {
            with_session(app, &request, RemoteAction::Admin, |_| {
                handle_trust_devices(app)
            })
        }
        ("POST", "/remote/api/trust/revoke") => {
            with_session(app, &request, RemoteAction::Admin, |_| {
                handle_trust_revoke(app, &request)
            })
        }
        ("POST", "/remote/api/trust/revoke-all") => {
            with_session(app, &request, RemoteAction::Admin, |_| {
                handle_trust_revoke_all(app)
            })
        }
        ("GET", "/remote/api/status") => with_session(app, &request, RemoteAction::View, |_| {
            handle_http_status(app)
        }),
        ("GET", "/remote/api/devices") => {
            with_session(app, &request, RemoteAction::View, |_| handle_devices(app))
        }
        ("POST", "/remote/api/screenshot") => {
            with_session(app, &request, RemoteAction::View, |_| {
                handle_screenshot(app, &request)
            })
        }
        ("POST", "/remote/api/video-stream/start") => {
            with_session(app, &request, RemoteAction::View, |session| {
                handle_video_stream_start(app, &request, session)
            })
        }
        ("POST", "/remote/api/webrtc/offer") => {
            with_session(app, &request, RemoteAction::View, |session| {
                handle_webrtc_offer(app, &request, session)
            })
        }
        ("POST", "/remote/api/webrtc/stop") => {
            with_session(app, &request, RemoteAction::View, |session| {
                handle_webrtc_stop(app, session)
            })
        }
        ("GET", "/remote/api/webrtc/status") => {
            with_session(app, &request, RemoteAction::View, |_| {
                handle_webrtc_status(app)
            })
        }
        ("POST", "/remote/api/video-stream/stop") => {
            with_session(app, &request, RemoteAction::View, |session| {
                handle_video_stream_stop(app, session)
            })
        }
        ("GET", "/remote/api/video-stream/status") => {
            with_session(app, &request, RemoteAction::View, |_| {
                handle_video_stream_status(app)
            })
        }
        ("GET", "/remote/api/video-stream/playlist.m3u8") => {
            with_session(app, &request, RemoteAction::View, |_| {
                handle_video_stream_playlist(app, &request)
            })
        }
        ("POST", "/remote/api/tap") => {
            with_control_session(app, &request, |session| handle_tap(app, &request, session))
        }
        ("POST", "/remote/api/swipe") => with_control_session(app, &request, |session| {
            handle_swipe(app, &request, session)
        }),
        ("POST", "/remote/api/text") => {
            with_control_session(app, &request, |session| handle_text(app, &request, session))
        }
        ("POST", "/remote/api/clipboard") => {
            with_session(app, &request, RemoteAction::Clipboard, |session| {
                handle_clipboard(app, &request, session)
            })
        }
        ("POST", "/remote/api/key") => {
            with_control_session(app, &request, |session| handle_key(app, &request, session))
        }
        ("GET", "/remote/api/audit") => {
            with_session(app, &request, RemoteAction::View, |_| handle_audit(app))
        }
        ("GET", "/remote/api/sessions") => {
            with_session(app, &request, RemoteAction::Admin, |_| handle_sessions(app))
        }
        ("POST", "/remote/api/sessions/kick") => {
            with_session(app, &request, RemoteAction::Admin, |session| {
                handle_session_kick(app, &request, session)
            })
        }
        ("POST", "/remote/api/control/acquire") => {
            with_session(app, &request, RemoteAction::Input, |session| {
                handle_control_acquire(app, &request, session)
            })
        }
        ("POST", "/remote/api/control/release") => {
            with_session(app, &request, RemoteAction::Input, |session| {
                handle_control_release(app, session)
            })
        }
        ("POST", "/remote/api/apk/install") => {
            with_session(app, &request, RemoteAction::InstallApk, |session| {
                handle_apk_install(app, &request, session)
            })
        }
        ("POST", "/remote/api/admin/reconnect") => {
            with_session(app, &request, RemoteAction::Admin, |session| {
                handle_admin_reconnect(app, &request, session)
            })
        }
        ("POST", "/remote/api/admin/repair-pairing") => {
            with_session(app, &request, RemoteAction::Admin, |session| {
                handle_admin_repair_pairing(app, session)
            })
        }
        ("GET", "/remote/api/templates") => {
            with_session(app, &request, RemoteAction::Template, |_| {
                handle_templates()
            })
        }
        ("POST", "/remote/api/templates/run") => {
            with_session(app, &request, RemoteAction::Template, |session| {
                handle_template_run(app, &request, session)
            })
        }
        _ => json_response(404, json!({ "ok": false, "error": "Not found" })),
    }
}

fn handle_auth(app: &AppHandle, request: &HttpRequest) -> HttpResponse {
    let Ok(body) = serde_json::from_slice::<AuthRequest>(&request.body) else {
        return json_response(400, json!({ "ok": false, "error": "Invalid PIN request" }));
    };

    let state = app.state::<AppState>();
    let token = {
        let mut runtime = match state.remote_control.lock() {
            Ok(runtime) => runtime,
            Err(_) => {
                return json_response(
                    500,
                    json!({ "ok": false, "error": "Remote control state unavailable" }),
                )
            }
        };
        runtime
            .session
            .as_mut()
            .and_then(|session| session.exchange_pin(&body.pin))
    };

    match token {
        Some(token) => json_response(
            200,
            json!({ "ok": true, "token": token, "role": RemoteRole::Admin }),
        ),
        None => json_response(
            401,
            json!({ "ok": false, "error": "PIN is invalid or expired" }),
        ),
    }
}

fn handle_invite_claim(app: &AppHandle, request: &HttpRequest) -> HttpResponse {
    let Ok(body) = serde_json::from_slice::<InviteClaimRequest>(&request.body) else {
        return json_response(
            400,
            json!({ "ok": false, "error": "Invalid invite request" }),
        );
    };

    let now = now_ms();
    let state = app.state::<AppState>();
    let session = {
        let mut runtime = match state.remote_control.lock() {
            Ok(runtime) => runtime,
            Err(_) => {
                return json_response(
                    500,
                    json!({ "ok": false, "error": "Remote control state unavailable" }),
                )
            }
        };
        let Some(invite) = runtime.invites.get_mut(body.invite.trim()) else {
            return json_response(401, json!({ "ok": false, "error": "Invite is invalid" }));
        };
        let Some(session) = invite.claim_with_session_token(
            body.client_name
                .unwrap_or_else(|| "Remote browser".to_string()),
            now,
            generate_token(),
        ) else {
            return json_response(
                401,
                json!({ "ok": false, "error": "Invite is expired or used" }),
            );
        };
        runtime
            .sessions
            .insert(session.token.clone(), session.clone());
        ensure_role_invites(&mut runtime, now);
        session
    };

    record_remote_audit(
        app,
        Some(&session),
        "invite.claim",
        "",
        true,
        &format!("{} joined", session.client_name),
    );

    json_response(
        200,
        json!({ "ok": true, "session": session, "token": session.token }),
    )
}

fn handle_trust_claim(app: &AppHandle, request: &HttpRequest) -> HttpResponse {
    let Ok(body) = serde_json::from_slice::<TrustClaimRequest>(&request.body) else {
        return json_response(
            400,
            json!({ "ok": false, "error": "Invalid trust claim request" }),
        );
    };

    let now = now_ms();
    let session = match claim_trusted_device(
        app,
        &body.trusted_token,
        body.client_name.unwrap_or_else(remote_client_name),
        now,
        generate_token(),
    ) {
        Ok(session) => session,
        Err(error) => return json_response(401, json!({ "ok": false, "error": error })),
    };

    let state = app.state::<AppState>();
    {
        let Ok(mut runtime) = state.remote_control.lock() else {
            return json_response(
                500,
                json!({ "ok": false, "error": "Remote control state unavailable" }),
            );
        };
        runtime
            .sessions
            .insert(session.token.clone(), session.clone());
    }

    record_remote_audit(
        app,
        Some(&session),
        "trust.claim",
        "",
        true,
        &format!("{} joined with trusted device", session.client_name),
    );

    json_response(
        200,
        json!({ "ok": true, "session": session, "token": session.token }),
    )
}

fn handle_trust_register(
    app: &AppHandle,
    request: &HttpRequest,
    session: &RemoteSessionInfo,
) -> HttpResponse {
    let body = serde_json::from_slice::<TrustRegisterRequest>(&request.body)
        .unwrap_or(TrustRegisterRequest { client_name: None });
    match register_trusted_device(
        app,
        session.role,
        body.client_name
            .unwrap_or_else(|| session.client_name.clone()),
        now_ms(),
        generate_token(),
    ) {
        Ok((token, device)) => {
            record_remote_audit(app, Some(session), "trust.register", "", true, &device.id);
            json_response(
                200,
                json!({ "ok": true, "trusted_token": token, "trusted_device": device }),
            )
        }
        Err(error) => {
            record_remote_audit(app, Some(session), "trust.register", "", false, &error);
            json_response(500, json!({ "ok": false, "error": error }))
        }
    }
}

fn handle_trust_devices(app: &AppHandle) -> HttpResponse {
    match remote_trusted_devices(app) {
        Ok(devices) => json_response(200, json!({ "ok": true, "devices": devices })),
        Err(error) => json_response(500, json!({ "ok": false, "error": error })),
    }
}

fn handle_trust_revoke(app: &AppHandle, request: &HttpRequest) -> HttpResponse {
    let Ok(body) = serde_json::from_slice::<TrustRevokeRequest>(&request.body) else {
        return json_response(
            400,
            json!({ "ok": false, "error": "Invalid trust revoke request" }),
        );
    };
    match revoke_trusted_device(app, &body.id) {
        Ok(devices) => json_response(200, json!({ "ok": true, "devices": devices })),
        Err(error) => json_response(500, json!({ "ok": false, "error": error })),
    }
}

fn handle_trust_revoke_all(app: &AppHandle) -> HttpResponse {
    match revoke_all_trusted_devices(app) {
        Ok(devices) => json_response(200, json!({ "ok": true, "devices": devices })),
        Err(error) => json_response(500, json!({ "ok": false, "error": error })),
    }
}

fn handle_http_status(app: &AppHandle) -> HttpResponse {
    let state = app.state::<AppState>();
    match remote_status(app, &state) {
        Ok(status) => json_response(200, json!({ "ok": true, "status": status })),
        Err(error) => json_response(500, json!({ "ok": false, "error": error.to_string() })),
    }
}

fn handle_devices(app: &AppHandle) -> HttpResponse {
    match list_remote_devices(app) {
        Ok(devices) => json_response(200, json!({ "ok": true, "devices": devices })),
        Err(error) => json_response(500, json!({ "ok": false, "error": error })),
    }
}

fn handle_screenshot(app: &AppHandle, request: &HttpRequest) -> HttpResponse {
    let Ok(body) = serde_json::from_slice::<DeviceRequest>(&request.body) else {
        return json_response(
            400,
            json!({ "ok": false, "error": "Invalid screenshot request" }),
        );
    };

    match capture_remote_screenshot(app, &body.serial) {
        Ok(bytes) => binary_response(200, "image/png", bytes),
        Err(error) if error == "Screenshot already refreshing" => {
            json_response(429, json!({ "ok": false, "error": error }))
        }
        Err(error) => json_response(500, json!({ "ok": false, "error": error })),
    }
}

fn handle_video_stream_start(
    app: &AppHandle,
    request: &HttpRequest,
    session: &RemoteSessionInfo,
) -> HttpResponse {
    let Ok(body) = serde_json::from_slice::<RemoteVideoStreamRequest>(&request.body) else {
        return json_response(
            400,
            json!({ "ok": false, "error": "Invalid video stream request" }),
        );
    };

    match start_remote_video_stream(app, &body.serial) {
        Ok(info) => {
            record_remote_audit(
                app,
                Some(session),
                "video_stream.start",
                &body.serial,
                true,
                "Experimental HLS stream started",
            );
            json_response(200, json!({ "ok": true, "stream": info }))
        }
        Err(error) => {
            record_remote_audit(
                app,
                Some(session),
                "video_stream.start",
                &body.serial,
                false,
                &error,
            );
            json_response(500, json!({ "ok": false, "error": error }))
        }
    }
}

fn handle_webrtc_offer(
    app: &AppHandle,
    request: &HttpRequest,
    session: &RemoteSessionInfo,
) -> HttpResponse {
    let Ok(body) = serde_json::from_slice::<RemoteWebRtcOfferRequest>(&request.body) else {
        return json_response(
            400,
            json!({ "ok": false, "error": "Invalid WebRTC offer request" }),
        );
    };

    match start_remote_webrtc_stream(app, &body.serial, &body.offer_sdp, session) {
        Ok((answer_sdp, stream)) => {
            record_remote_audit(
                app,
                Some(session),
                "webrtc.start",
                &body.serial,
                true,
                "WebRTC video stream started",
            );
            json_response(
                200,
                json!({ "ok": true, "answer_sdp": answer_sdp, "stream": stream }),
            )
        }
        Err(error) if error.starts_with("WebRTC stream already active") => {
            record_remote_audit(
                app,
                Some(session),
                "webrtc.start",
                &body.serial,
                false,
                &error,
            );
            json_response(409, json!({ "ok": false, "error": error }))
        }
        Err(error) => {
            record_remote_audit(
                app,
                Some(session),
                "webrtc.start",
                &body.serial,
                false,
                &error,
            );
            json_response(500, json!({ "ok": false, "error": error }))
        }
    }
}

fn handle_webrtc_stop(app: &AppHandle, session: &RemoteSessionInfo) -> HttpResponse {
    let state = app.state::<AppState>();
    let stopped = state
        .remote_webrtc_stream
        .lock()
        .map(|mut stream| stop_remote_webrtc_stream_locked(&mut stream).is_some())
        .unwrap_or(false);
    record_remote_audit(
        app,
        Some(session),
        "webrtc.stop",
        "",
        true,
        if stopped { "stopped" } else { "not running" },
    );
    json_response(200, json!({ "ok": true, "stopped": stopped }))
}

fn handle_webrtc_status(app: &AppHandle) -> HttpResponse {
    let state = app.state::<AppState>();
    let Ok(mut slot) = state.remote_webrtc_stream.lock() else {
        return json_response(
            500,
            json!({ "ok": false, "error": "WebRTC stream state unavailable" }),
        );
    };
    let status = if let Some(stream) = slot.as_mut() {
        let status = remote_webrtc_status_info(stream);
        if remote_webrtc_stream_alive(stream) {
            status
        } else {
            stop_remote_webrtc_stream_locked(&mut slot);
            status
        }
    } else {
        RemoteWebRtcStatusInfo::inactive()
    };
    json_response(200, json!({ "ok": true, "status": status }))
}

fn handle_video_stream_stop(app: &AppHandle, session: &RemoteSessionInfo) -> HttpResponse {
    let state = app.state::<AppState>();
    let stopped = state
        .remote_video_stream
        .lock()
        .map(|mut stream| stop_remote_video_stream_locked(&mut stream).is_some())
        .unwrap_or(false);
    record_remote_audit(
        app,
        Some(session),
        "video_stream.stop",
        "",
        true,
        if stopped { "stopped" } else { "not running" },
    );
    json_response(200, json!({ "ok": true, "stopped": stopped }))
}

fn handle_video_stream_status(app: &AppHandle) -> HttpResponse {
    let state = app.state::<AppState>();
    let Ok(mut slot) = state.remote_video_stream.lock() else {
        return json_response(
            500,
            json!({ "ok": false, "error": "Video stream state unavailable" }),
        );
    };
    let stream = if let Some(stream) = slot.as_mut() {
        if remote_video_stream_alive(stream) {
            Some(remote_video_stream_info(stream))
        } else {
            stop_remote_video_stream_locked(&mut slot);
            None
        }
    } else {
        None
    };
    json_response(200, json!({ "ok": true, "stream": stream }))
}

fn handle_video_stream_playlist(app: &AppHandle, request: &HttpRequest) -> HttpResponse {
    let token = request_token(request).unwrap_or_default();
    let state = app.state::<AppState>();
    let Ok(mut slot) = state.remote_video_stream.lock() else {
        return json_response(
            500,
            json!({ "ok": false, "error": "Video stream state unavailable" }),
        );
    };
    let Some(stream) = slot.as_mut() else {
        return json_response(
            404,
            json!({ "ok": false, "error": "Video stream is not running" }),
        );
    };
    if !remote_video_stream_alive(stream) {
        stop_remote_video_stream_locked(&mut slot);
        return json_response(
            404,
            json!({ "ok": false, "error": "Video stream has stopped" }),
        );
    }
    let Ok(playlist) = fs::read_to_string(&stream.playlist_path) else {
        return json_response(
            503,
            json!({ "ok": false, "error": "Video stream is warming up" }),
        );
    };
    let rewritten = rewrite_hls_playlist(&playlist, token);
    binary_response(200, "application/vnd.apple.mpegurl", rewritten.into_bytes())
}

fn handle_video_stream_segment(app: &AppHandle, request: &HttpRequest) -> HttpResponse {
    let segment = request
        .path
        .trim_start_matches("/remote/api/video-stream/segment/");
    if !is_safe_hls_media_name(segment) {
        return json_response(400, json!({ "ok": false, "error": "Invalid segment" }));
    }

    let state = app.state::<AppState>();
    let Ok(mut slot) = state.remote_video_stream.lock() else {
        return json_response(
            500,
            json!({ "ok": false, "error": "Video stream state unavailable" }),
        );
    };
    let Some(stream) = slot.as_mut() else {
        return json_response(
            404,
            json!({ "ok": false, "error": "Video stream is not running" }),
        );
    };
    if !remote_video_stream_alive(stream) {
        stop_remote_video_stream_locked(&mut slot);
        return json_response(
            404,
            json!({ "ok": false, "error": "Video stream has stopped" }),
        );
    }

    let path = stream.dir.join(segment);
    match fs::read(path) {
        Ok(bytes) => binary_response(200, hls_media_content_type(segment), bytes),
        Err(_) => json_response(404, json!({ "ok": false, "error": "Segment not found" })),
    }
}

fn get_or_capture_jpeg_frame(app: &AppHandle, serial: &str) -> Result<Vec<u8>, String> {
    validate_serial(serial)?;
    let state = app.state::<AppState>();
    let now = now_ms();
    if let Ok(cache) = state.remote_frame_cache.lock() {
        if let Some(frame) = cache.get(serial) {
            if now.saturating_sub(frame.captured_at_ms) <= STREAM_FRAME_CACHE_MS {
                return Ok(frame.jpeg.clone());
            }
        }
    }

    match capture_remote_screenshot(app, serial) {
        Ok(png) => {
            let jpeg = png_to_jpeg_frame(&png)?;
            if let Ok(mut cache) = state.remote_frame_cache.lock() {
                cache.insert(
                    serial.to_string(),
                    RemoteFrameCache {
                        jpeg: jpeg.clone(),
                        captured_at_ms: now_ms(),
                    },
                );
            }
            Ok(jpeg)
        }
        Err(error) if error == "Screenshot already refreshing" => state
            .remote_frame_cache
            .lock()
            .ok()
            .and_then(|cache| cache.get(serial).cloned())
            .map(|frame| frame.jpeg)
            .ok_or(error),
        Err(error) => Err(error),
    }
}

fn png_to_jpeg_frame(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let image = image::load_from_memory(bytes).map_err(|error| error.to_string())?;
    let image = if image.width() > STREAM_MAX_WIDTH {
        let resized_height = ((image.height() as u64 * STREAM_MAX_WIDTH as u64)
            / image.width().max(1) as u64)
            .max(1) as u32;
        image.resize_exact(
            STREAM_MAX_WIDTH,
            resized_height,
            image::imageops::FilterType::Triangle,
        )
    } else {
        image
    };

    let rgb = image.to_rgb8();
    let mut output = Vec::new();
    JpegEncoder::new_with_quality(&mut output, STREAM_JPEG_QUALITY)
        .encode(
            &rgb,
            rgb.width(),
            rgb.height(),
            image::ColorType::Rgb8.into(),
        )
        .map_err(|error| error.to_string())?;
    Ok(output)
}

type WebRtcPeerBundle = (
    String,
    tokio::runtime::Runtime,
    Arc<RTCPeerConnection>,
    Arc<TrackLocalStaticRTP>,
    Arc<Mutex<String>>,
    Arc<Mutex<Option<String>>>,
);

fn start_remote_webrtc_stream(
    app: &AppHandle,
    serial: &str,
    offer_sdp: &str,
    session: &RemoteSessionInfo,
) -> Result<(String, RemoteWebRtcStreamInfo), String> {
    validate_serial(serial)?;
    let state = app.state::<AppState>();
    let mut slot = state
        .remote_webrtc_stream
        .lock()
        .map_err(|_| "WebRTC stream state unavailable".to_string())?;

    if let Some(stream) = slot.as_mut() {
        if remote_webrtc_stream_alive(stream) {
            return Err(webrtc_occupied_error(&stream.session_id));
        }
        stop_remote_webrtc_stream_locked(&mut slot);
    }

    if let Ok(mut hls_slot) = state.remote_video_stream.lock() {
        stop_remote_video_stream_locked(&mut hls_slot);
    }

    let ffmpeg_path = which::which("ffmpeg")
        .map_err(|_| "WebRTC stream requires ffmpeg on this computer".to_string())?;
    let adb_path = adb::get_adb_path(app).map_err(|error| error.to_string())?;
    let (rtp_socket, rtp_port) = bind_webrtc_rtp_socket()?;
    let (answer_sdp, runtime, peer, track, connection_state, last_error) =
        create_webrtc_peer(offer_sdp)?;

    let mut adb_command = Command::new(adb_path);
    adb_command
        .args([
            "-s",
            serial,
            "exec-out",
            "screenrecord",
            "--output-format=h264",
            "--bit-rate",
            WEBRTC_BIT_RATE,
            "--time-limit",
            WEBRTC_SCREENRECORD_SECONDS,
            "-",
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    apply_hidden_process_flags(&mut adb_command);

    let mut adb_child = adb_command.spawn().map_err(|error| {
        let _ = runtime.block_on(peer.close());
        error.to_string()
    })?;
    let Some(adb_stdout) = adb_child.stdout.take() else {
        let _ = adb_child.kill();
        let _ = adb_child.wait();
        let _ = runtime.block_on(peer.close());
        return Err("Unable to capture screenrecord output".to_string());
    };

    let rtp_url = format!("rtp://127.0.0.1:{rtp_port}?pkt_size=1200");
    let mut ffmpeg_command = Command::new(ffmpeg_path);
    ffmpeg_command
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-fflags",
            "+genpts",
            "-flags",
            "low_delay",
            "-f",
            "h264",
            "-i",
            "pipe:0",
            "-an",
            "-c:v",
            "copy",
            "-payload_type",
            WEBRTC_PAYLOAD_TYPE,
            "-ssrc",
            WEBRTC_SSRC,
            "-f",
            "rtp",
            &rtp_url,
        ])
        .stdin(Stdio::from(adb_stdout))
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    apply_hidden_process_flags(&mut ffmpeg_command);

    let ffmpeg_child = match ffmpeg_command.spawn() {
        Ok(child) => child,
        Err(error) => {
            let _ = adb_child.kill();
            let _ = adb_child.wait();
            let _ = runtime.block_on(peer.close());
            return Err(error.to_string());
        }
    };

    let stop_flag = Arc::new(AtomicBool::new(false));
    let rtp_thread = spawn_webrtc_rtp_forwarder(
        rtp_socket,
        runtime.handle().clone(),
        Arc::clone(&track),
        Arc::clone(&stop_flag),
        Arc::clone(&last_error),
    );
    let started_at_ms = now_ms();
    let id = format!("webrtc-{started_at_ms}");
    *slot = Some(RemoteWebRtcStreamState {
        id: id.clone(),
        serial: serial.to_string(),
        session_id: session.id.clone(),
        started_at_ms,
        rtp_port,
        connection_state,
        last_error,
        stop_flag,
        runtime,
        peer,
        adb_child,
        ffmpeg_child,
        rtp_thread: Some(rtp_thread),
    });

    let stream = slot
        .as_ref()
        .ok_or_else(|| "WebRTC stream stopped before it became ready".to_string())?;
    Ok((answer_sdp, remote_webrtc_stream_info(stream)))
}

fn create_webrtc_peer(offer_sdp: &str) -> Result<WebRtcPeerBundle, String> {
    let runtime = TokioRuntimeBuilder::new_multi_thread()
        .worker_threads(2)
        .thread_name("adb-remote-webrtc")
        .enable_all()
        .build()
        .map_err(|error| error.to_string())?;
    let connection_state = Arc::new(Mutex::new("connecting".to_string()));
    let last_error = Arc::new(Mutex::new(None));

    let peer_result = runtime.block_on(async {
        let mut media_engine = MediaEngine::default();
        media_engine.register_default_codecs()?;
        let registry = register_default_interceptors(Registry::new(), &mut media_engine)?;
        let api = APIBuilder::new()
            .with_media_engine(media_engine)
            .with_interceptor_registry(registry)
            .build();
        let peer = Arc::new(api.new_peer_connection(RTCConfiguration::default()).await?);
        let track = Arc::new(TrackLocalStaticRTP::new(
            RTCRtpCodecCapability {
                mime_type: MIME_TYPE_H264.to_string(),
                clock_rate: 90_000,
                channels: 0,
                sdp_fmtp_line:
                    "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f"
                        .to_string(),
                rtcp_feedback: vec![],
            },
            "adb-remote-video".to_string(),
            "adb-remote".to_string(),
        ));
        let rtp_sender = peer
            .add_track(Arc::clone(&track) as Arc<dyn TrackLocal + Send + Sync>)
            .await?;

        let rtcp_reader = Arc::clone(&rtp_sender);
        tokio::spawn(async move {
            let mut buffer = vec![0_u8; 1500];
            while rtcp_reader.read(&mut buffer).await.is_ok() {}
        });

        let state_for_callback = Arc::clone(&connection_state);
        let error_for_callback = Arc::clone(&last_error);
        peer.on_peer_connection_state_change(Box::new(move |state: RTCPeerConnectionState| {
            let state_for_callback = Arc::clone(&state_for_callback);
            let error_for_callback = Arc::clone(&error_for_callback);
            Box::pin(async move {
                if let Ok(mut guard) = state_for_callback.lock() {
                    *guard = state.to_string();
                }
                if matches!(
                    state,
                    RTCPeerConnectionState::Failed | RTCPeerConnectionState::Closed
                ) {
                    if let Ok(mut guard) = error_for_callback.lock() {
                        *guard = Some(format!("WebRTC connection {state}"));
                    }
                }
            })
        }));

        let offer = RTCSessionDescription::offer(offer_sdp.to_string())?;
        peer.set_remote_description(offer).await?;
        let answer = peer.create_answer(None).await?;
        let mut gather_complete = peer.gathering_complete_promise().await;
        peer.set_local_description(answer).await?;
        let _ = gather_complete.recv().await;
        let local_description = peer
            .local_description()
            .await
            .ok_or_else(|| webrtc::Error::ErrPeerConnRemoteDescriptionWithoutMidValue)?;
        Ok::<_, webrtc::Error>((local_description.sdp, peer, track))
    });

    match peer_result {
        Ok((answer_sdp, peer, track)) => Ok((
            answer_sdp,
            runtime,
            peer,
            track,
            connection_state,
            last_error,
        )),
        Err(error) => Err(error.to_string()),
    }
}

fn bind_webrtc_rtp_socket() -> Result<(UdpSocket, u16), String> {
    let socket = UdpSocket::bind("127.0.0.1:0").map_err(|error| error.to_string())?;
    socket
        .set_read_timeout(Some(Duration::from_millis(500)))
        .map_err(|error| error.to_string())?;
    let port = socket
        .local_addr()
        .map_err(|error| error.to_string())?
        .port();
    Ok((socket, port))
}

fn spawn_webrtc_rtp_forwarder(
    socket: UdpSocket,
    runtime: tokio::runtime::Handle,
    track: Arc<TrackLocalStaticRTP>,
    stop_flag: Arc<AtomicBool>,
    last_error: Arc<Mutex<Option<String>>>,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        let mut buffer = vec![0_u8; WEBRTC_RTP_PACKET_BYTES];
        while !stop_flag.load(Ordering::SeqCst) {
            match socket.recv(&mut buffer) {
                Ok(size) => {
                    let mut raw = &buffer[..size];
                    match webrtc::rtp::packet::Packet::unmarshal(&mut raw) {
                        Ok(packet) => {
                            if let Err(error) = runtime.block_on(track.write_rtp(&packet)) {
                                if let Ok(mut guard) = last_error.lock() {
                                    *guard = Some(format!("WebRTC RTP write failed: {error}"));
                                }
                                break;
                            }
                        }
                        Err(error) => {
                            if let Ok(mut guard) = last_error.lock() {
                                *guard = Some(format!("Invalid RTP packet: {error}"));
                            }
                        }
                    }
                }
                Err(error)
                    if matches!(
                        error.kind(),
                        std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                    ) =>
                {
                    continue;
                }
                Err(error) => {
                    if let Ok(mut guard) = last_error.lock() {
                        *guard = Some(format!("RTP socket failed: {error}"));
                    }
                    break;
                }
            }
        }
    })
}

fn remote_webrtc_stream_alive(stream: &mut RemoteWebRtcStreamState) -> bool {
    let adb_alive = stream
        .adb_child
        .try_wait()
        .map(|status| status.is_none())
        .unwrap_or(false);
    let ffmpeg_alive = stream
        .ffmpeg_child
        .try_wait()
        .map(|status| status.is_none())
        .unwrap_or(false);
    if !adb_alive || !ffmpeg_alive {
        if let Ok(mut guard) = stream.last_error.lock() {
            if guard.is_none() {
                *guard = Some("ADB screenrecord or ffmpeg exited".to_string());
            }
        }
    }

    let connection_state = stream
        .connection_state
        .lock()
        .map(|state| state.clone())
        .unwrap_or_else(|_| "unknown".to_string());
    adb_alive && ffmpeg_alive && !matches!(connection_state.as_str(), "failed" | "closed")
}

fn remote_webrtc_stream_info(stream: &RemoteWebRtcStreamState) -> RemoteWebRtcStreamInfo {
    RemoteWebRtcStreamInfo {
        id: stream.id.clone(),
        serial: stream.serial.clone(),
        mode: "webrtc",
        codec: "h264",
        source: "adb-screenrecord-ffmpeg-rtp",
        rtp_port: stream.rtp_port,
        started_at_ms: stream.started_at_ms,
    }
}

fn remote_webrtc_status_info(stream: &RemoteWebRtcStreamState) -> RemoteWebRtcStatusInfo {
    let mut status = RemoteWebRtcStatusInfo::active(
        stream.serial.clone(),
        stream.session_id.clone(),
        stream
            .connection_state
            .lock()
            .map(|state| state.clone())
            .unwrap_or_else(|_| "unknown".to_string()),
        stream.started_at_ms,
        stream
            .last_error
            .lock()
            .ok()
            .and_then(|error| error.clone()),
    );
    status.id = Some(stream.id.clone());
    status
}

fn stop_remote_webrtc_stream_locked(
    slot: &mut Option<RemoteWebRtcStreamState>,
) -> Option<RemoteWebRtcStatusInfo> {
    let mut stream = slot.take()?;
    let status = remote_webrtc_status_info(&stream);
    stream.stop_flag.store(true, Ordering::SeqCst);
    let _ = stream.ffmpeg_child.kill();
    let _ = stream.adb_child.kill();
    let _ = stream.ffmpeg_child.wait();
    let _ = stream.adb_child.wait();
    let _ = stream.runtime.block_on(stream.peer.close());
    if let Some(handle) = stream.rtp_thread.take() {
        let _ = handle.join();
    }
    Some(status)
}

fn webrtc_occupied_error(session_id: &str) -> String {
    format!("WebRTC stream already active for session {session_id}")
}

fn start_remote_video_stream(
    app: &AppHandle,
    serial: &str,
) -> Result<RemoteVideoStreamInfo, String> {
    validate_serial(serial)?;
    let state = app.state::<AppState>();
    let mut slot = state
        .remote_video_stream
        .lock()
        .map_err(|_| "Video stream state unavailable".to_string())?;

    if let Some(stream) = slot.as_mut() {
        if stream.serial == serial && remote_video_stream_alive(stream) {
            if wait_for_hls_playlist(&stream.playlist_path, Duration::from_millis(250)) {
                return Ok(remote_video_stream_info(stream));
            }
        }
    }

    stop_remote_video_stream_locked(&mut slot);

    let ffmpeg_path = which::which("ffmpeg")
        .map_err(|_| "Experimental video stream requires ffmpeg on this computer".to_string())?;
    let adb_path = adb::get_adb_path(app).map_err(|error| error.to_string())?;
    let dir = remote_hls_dir(app, serial)?;
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|error| error.to_string())?;
    }
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;

    let mut adb_command = Command::new(adb_path);
    adb_command
        .args([
            "-s",
            serial,
            "exec-out",
            "screenrecord",
            "--output-format=h264",
            "--bit-rate",
            "4000000",
            "--time-limit",
            "180",
            "-",
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    apply_hidden_process_flags(&mut adb_command);

    let mut adb_child = adb_command.spawn().map_err(|error| error.to_string())?;
    let Some(adb_stdout) = adb_child.stdout.take() else {
        let _ = adb_child.kill();
        let _ = adb_child.wait();
        return Err("Unable to capture screenrecord output".to_string());
    };

    let playlist_path = dir.join("playlist.m3u8");
    let segment_pattern = dir.join("segment_%05d.m4s");
    let hls_time = REMOTE_HLS_SEGMENT_SECONDS.to_string();
    let hls_list_size = REMOTE_HLS_LIST_SIZE.to_string();
    let segment_pattern_arg = segment_pattern.to_string_lossy().to_string();
    let playlist_path_arg = playlist_path.to_string_lossy().to_string();
    let mut ffmpeg_command = Command::new(ffmpeg_path);
    ffmpeg_command
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-fflags",
            "+genpts",
            "-flags",
            "low_delay",
            "-f",
            "h264",
            "-i",
            "pipe:0",
            "-an",
            "-c:v",
            "copy",
            "-f",
            "hls",
            "-hls_time",
            &hls_time,
            "-hls_list_size",
            &hls_list_size,
            "-hls_flags",
            "delete_segments+append_list+omit_endlist",
            "-hls_segment_type",
            "fmp4",
            "-hls_fmp4_init_filename",
            "init.mp4",
            "-hls_segment_filename",
            &segment_pattern_arg,
            &playlist_path_arg,
        ])
        .stdin(Stdio::from(adb_stdout))
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    apply_hidden_process_flags(&mut ffmpeg_command);

    let ffmpeg_child = match ffmpeg_command.spawn() {
        Ok(child) => child,
        Err(error) => {
            let _ = adb_child.kill();
            let _ = adb_child.wait();
            return Err(error.to_string());
        }
    };

    let started_at_ms = now_ms();
    *slot = Some(RemoteVideoStreamState {
        serial: serial.to_string(),
        dir,
        playlist_path: playlist_path.clone(),
        started_at_ms,
        adb_child,
        ffmpeg_child,
    });

    if !wait_for_hls_playlist(
        &playlist_path,
        Duration::from_secs(REMOTE_HLS_START_TIMEOUT_SECS),
    ) {
        stop_remote_video_stream_locked(&mut slot);
        return Err(
            "Video stream did not produce a playlist. The device may not support screenrecord streaming."
                .to_string(),
        );
    }

    let stream = slot
        .as_ref()
        .ok_or_else(|| "Video stream stopped before it became ready".to_string())?;
    Ok(remote_video_stream_info(stream))
}

fn remote_video_stream_alive(stream: &mut RemoteVideoStreamState) -> bool {
    let adb_alive = stream
        .adb_child
        .try_wait()
        .map(|status| status.is_none())
        .unwrap_or(false);
    let ffmpeg_alive = stream
        .ffmpeg_child
        .try_wait()
        .map(|status| status.is_none())
        .unwrap_or(false);
    adb_alive && ffmpeg_alive
}

fn remote_video_stream_info(stream: &RemoteVideoStreamState) -> RemoteVideoStreamInfo {
    RemoteVideoStreamInfo {
        serial: stream.serial.clone(),
        mode: "hls",
        playlist_url: "/remote/api/video-stream/playlist.m3u8".to_string(),
        started_at_ms: stream.started_at_ms,
    }
}

fn stop_remote_video_stream_locked(
    slot: &mut Option<RemoteVideoStreamState>,
) -> Option<RemoteVideoStreamInfo> {
    let mut stream = slot.take()?;
    let info = remote_video_stream_info(&stream);
    let _ = stream.ffmpeg_child.kill();
    let _ = stream.adb_child.kill();
    let _ = stream.ffmpeg_child.wait();
    let _ = stream.adb_child.wait();
    let _ = fs::remove_dir_all(&stream.dir);
    Some(info)
}

fn wait_for_hls_playlist(path: &Path, timeout: Duration) -> bool {
    let started = SystemTime::now();
    loop {
        if path.exists()
            && fs::read_to_string(path)
                .map(|content| content.lines().any(is_safe_hls_media_name))
                .unwrap_or(false)
        {
            return true;
        }
        if started
            .elapsed()
            .map(|elapsed| elapsed >= timeout)
            .unwrap_or(true)
        {
            return false;
        }
        thread::sleep(Duration::from_millis(150));
    }
}

fn remote_hls_dir(app: &AppHandle, serial: &str) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_cache_dir()
        .map_err(|error| error.to_string())?
        .join("remote-hls");
    Ok(base.join(format!("{}-{}", sanitize_path_component(serial), now_ms())))
}

fn sanitize_path_component(value: &str) -> String {
    let sanitized = value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' || ch == '.' {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>();
    if sanitized.is_empty() {
        "device".to_string()
    } else {
        sanitized
    }
}

fn rewrite_hls_playlist(playlist: &str, token: &str) -> String {
    playlist
        .lines()
        .map(|line| {
            if let Some(clamped) = clamp_hls_target_duration(line) {
                return clamped;
            }
            if let Some(uri) = hls_map_uri(line) {
                if is_safe_hls_media_name(uri) {
                    return line.replace(
                        &format!("URI=\"{uri}\""),
                        &format!("URI=\"/remote/api/video-stream/segment/{uri}?token={token}\""),
                    );
                }
            }
            if is_safe_hls_media_name(line) {
                format!("/remote/api/video-stream/segment/{line}?token={token}")
            } else {
                line.to_string()
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn clamp_hls_target_duration(line: &str) -> Option<String> {
    let duration = line.strip_prefix("#EXT-X-TARGETDURATION:")?;
    let duration = duration.trim().parse::<u64>().ok()?;
    (duration == 0).then(|| "#EXT-X-TARGETDURATION:1".to_string())
}

fn hls_map_uri(line: &str) -> Option<&str> {
    let marker = "URI=\"";
    let start = line.find(marker)? + marker.len();
    let rest = &line[start..];
    let end = rest.find('"')?;
    Some(&rest[..end])
}

fn is_safe_hls_media_name(name: &str) -> bool {
    let valid_chars = name
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' || ch == '.');
    valid_chars
        && (name == "init.mp4"
            || (name.starts_with("segment_") && (name.ends_with(".m4s") || name.ends_with(".ts"))))
}

fn hls_media_content_type(name: &str) -> &'static str {
    if name.ends_with(".ts") {
        "video/mp2t"
    } else {
        "video/mp4"
    }
}

fn apply_hidden_process_flags(_command: &mut Command) {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        _command.creation_flags(0x08000000);
    }
}

fn write_mjpeg_frame(stream: &mut TcpStream, frame: &[u8]) -> std::io::Result<()> {
    write!(
        stream,
        "--{STREAM_BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: {}\r\n\r\n",
        frame.len()
    )?;
    stream.write_all(frame)?;
    write!(stream, "\r\n")?;
    stream.flush()
}

fn handle_tap(app: &AppHandle, request: &HttpRequest, session: &RemoteSessionInfo) -> HttpResponse {
    let Ok(body) = serde_json::from_slice::<TapRequest>(&request.body) else {
        return json_response(400, json!({ "ok": false, "error": "Invalid tap request" }));
    };

    let result = run_remote_tap(app, &body.serial, body.x, body.y);
    action_response(app, Some(session), "tap", &body.serial, result)
}

fn handle_swipe(
    app: &AppHandle,
    request: &HttpRequest,
    session: &RemoteSessionInfo,
) -> HttpResponse {
    let Ok(body) = serde_json::from_slice::<SwipeRequest>(&request.body) else {
        return json_response(
            400,
            json!({ "ok": false, "error": "Invalid swipe request" }),
        );
    };

    let duration_ms = body.duration_ms.unwrap_or(300);
    let result = run_remote_swipe(
        app,
        &body.serial,
        body.x1,
        body.y1,
        body.x2,
        body.y2,
        duration_ms,
    );
    action_response(app, Some(session), "swipe", &body.serial, result)
}

fn handle_text(
    app: &AppHandle,
    request: &HttpRequest,
    session: &RemoteSessionInfo,
) -> HttpResponse {
    let Ok(body) = serde_json::from_slice::<TextRequest>(&request.body) else {
        return json_response(400, json!({ "ok": false, "error": "Invalid text request" }));
    };

    let result = run_remote_text(app, &body.serial, &body.text);
    action_response(app, Some(session), "text", &body.serial, result)
}

fn handle_clipboard(
    app: &AppHandle,
    request: &HttpRequest,
    session: &RemoteSessionInfo,
) -> HttpResponse {
    let Ok(body) = serde_json::from_slice::<ClipboardRequest>(&request.body) else {
        return json_response(
            400,
            json!({ "ok": false, "error": "Invalid clipboard request" }),
        );
    };

    let result = run_remote_clipboard(app, &body.serial, &body.text);
    action_response(app, Some(session), "clipboard", &body.serial, result)
}

fn handle_key(app: &AppHandle, request: &HttpRequest, session: &RemoteSessionInfo) -> HttpResponse {
    let Ok(body) = serde_json::from_slice::<KeyRequest>(&request.body) else {
        return json_response(400, json!({ "ok": false, "error": "Invalid key request" }));
    };

    let result = run_remote_key(app, &body.serial, &body.key);
    action_response(
        app,
        Some(session),
        &format!("key:{}", body.key),
        &body.serial,
        result,
    )
}

fn handle_audit(app: &AppHandle) -> HttpResponse {
    let state = app.state::<AppState>();
    let audit = state
        .remote_audit_log
        .lock()
        .map(|entries| entries.clone())
        .unwrap_or_default();
    json_response(200, json!({ "ok": true, "audit": audit }))
}

fn handle_sessions(app: &AppHandle) -> HttpResponse {
    let state = app.state::<AppState>();
    let Ok(runtime) = state.remote_control.lock() else {
        return json_response(
            500,
            json!({ "ok": false, "error": "Remote control state unavailable" }),
        );
    };
    let sessions = runtime.sessions.values().cloned().collect::<Vec<_>>();
    json_response(
        200,
        json!({ "ok": true, "sessions": sessions, "control_owner": runtime.control_owner }),
    )
}

fn handle_session_kick(
    app: &AppHandle,
    request: &HttpRequest,
    session: &RemoteSessionInfo,
) -> HttpResponse {
    let Ok(body) = serde_json::from_slice::<SessionRequest>(&request.body) else {
        return json_response(
            400,
            json!({ "ok": false, "error": "Invalid session request" }),
        );
    };
    let state = app.state::<AppState>();
    let removed = {
        let Ok(mut runtime) = state.remote_control.lock() else {
            return json_response(
                500,
                json!({ "ok": false, "error": "Remote control state unavailable" }),
            );
        };
        let token = runtime
            .sessions
            .iter()
            .find(|(_, session)| session.id == body.session_id)
            .map(|(token, _)| token.clone());
        let removed = token
            .as_ref()
            .and_then(|token| runtime.sessions.remove(token))
            .is_some();
        if removed {
            runtime.control_owner.release(&body.session_id);
        }
        removed
    };
    record_remote_audit(
        app,
        Some(session),
        "sessions.kick",
        "",
        removed,
        &body.session_id,
    );
    json_response(200, json!({ "ok": true, "removed": removed }))
}

fn handle_control_acquire(
    app: &AppHandle,
    request: &HttpRequest,
    session: &RemoteSessionInfo,
) -> HttpResponse {
    let body = serde_json::from_slice::<ControlRequest>(&request.body)
        .unwrap_or(ControlRequest { force: Some(false) });
    let state = app.state::<AppState>();
    let Ok(mut runtime) = state.remote_control.lock() else {
        return json_response(
            500,
            json!({ "ok": false, "error": "Remote control state unavailable" }),
        );
    };
    match runtime
        .control_owner
        .acquire(session, body.force.unwrap_or(false), now_ms())
    {
        Ok(()) => {
            let owner = runtime.control_owner.clone();
            drop(runtime);
            record_remote_audit(app, Some(session), "control.acquire", "", true, "");
            json_response(200, json!({ "ok": true, "control_owner": owner }))
        }
        Err(error) => {
            drop(runtime);
            record_remote_audit(app, Some(session), "control.acquire", "", false, &error);
            json_response(409, json!({ "ok": false, "error": error }))
        }
    }
}

fn handle_control_release(app: &AppHandle, session: &RemoteSessionInfo) -> HttpResponse {
    let state = app.state::<AppState>();
    let Ok(mut runtime) = state.remote_control.lock() else {
        return json_response(
            500,
            json!({ "ok": false, "error": "Remote control state unavailable" }),
        );
    };
    let released = runtime.control_owner.release(&session.id);
    drop(runtime);
    record_remote_audit(app, Some(session), "control.release", "", released, "");
    json_response(200, json!({ "ok": true, "released": released }))
}

fn handle_apk_install(
    app: &AppHandle,
    request: &HttpRequest,
    session: &RemoteSessionInfo,
) -> HttpResponse {
    let Some(serial) = request.query.get("serial").map(|value| value.trim()) else {
        return json_response(400, json!({ "ok": false, "error": "Missing serial" }));
    };
    if request.body_too_large {
        return json_response(
            413,
            json!({ "ok": false, "error": "APK upload is too large" }),
        );
    }
    if request.body.is_empty() || request.body.len() > MAX_REMOTE_APK_BYTES {
        return json_response(
            400,
            json!({ "ok": false, "error": "APK upload is empty or too large" }),
        );
    }
    if let Err(error) = validate_serial(serial) {
        return json_response(400, json!({ "ok": false, "error": error }));
    }

    let path = remote_upload_path(request.query.get("name").map(String::as_str));
    if let Err(error) = std::fs::write(&path, &request.body) {
        return json_response(500, json!({ "ok": false, "error": error.to_string() }));
    }
    let path_string = path.to_string_lossy().to_string();
    let result = adb::run_adb_with_timeout(
        app,
        &["install", "-r", &path_string],
        Some(serial),
        Duration::from_secs(120),
    )
    .map_err(|error| error.to_string())
    .and_then(|output| {
        adb::ensure_success(&output, "Install remote APK").map_err(|error| error.to_string())?;
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    });
    let _ = std::fs::remove_file(path);

    action_response(app, Some(session), "apk.install", serial, result)
}

fn handle_admin_reconnect(
    app: &AppHandle,
    request: &HttpRequest,
    session: &RemoteSessionInfo,
) -> HttpResponse {
    let Ok(body) = serde_json::from_slice::<DeviceRequest>(&request.body) else {
        return json_response(
            400,
            json!({ "ok": false, "error": "Invalid reconnect request" }),
        );
    };
    let result = remote_reconnect_device(app, &body.serial);
    action_response(app, Some(session), "admin.reconnect", &body.serial, result)
}

fn handle_admin_repair_pairing(app: &AppHandle, session: &RemoteSessionInfo) -> HttpResponse {
    let state = app.state::<AppState>();
    let result =
        device::repair_wireless_pairing_for_remote(app, &state).map_err(|error| error.to_string());
    action_response(app, Some(session), "admin.repair_pairing", "", result)
}

fn handle_templates() -> HttpResponse {
    json_response(
        200,
        json!({ "ok": true, "templates": remote_command_templates() }),
    )
}

fn handle_template_run(
    app: &AppHandle,
    request: &HttpRequest,
    session: &RemoteSessionInfo,
) -> HttpResponse {
    let Ok(body) = serde_json::from_slice::<TemplateRunRequest>(&request.body) else {
        return json_response(
            400,
            json!({ "ok": false, "error": "Invalid template request" }),
        );
    };
    let Some(template) = remote_command_templates()
        .into_iter()
        .find(|template| template.id == body.template_id)
    else {
        return json_response(404, json!({ "ok": false, "error": "Template not found" }));
    };
    let result = run_remote_input(app, &body.serial, &template.args);
    action_response(
        app,
        Some(session),
        &format!("template:{}", template.id),
        &body.serial,
        result,
    )
}

fn remote_upload_path(name: Option<&str>) -> PathBuf {
    let raw_name = name.unwrap_or("remote.apk");
    let mut safe_name = raw_name
        .chars()
        .filter(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | '_')
        })
        .collect::<String>();
    if safe_name.is_empty() || !safe_name.ends_with(".apk") {
        safe_name = "remote.apk".to_string();
    }
    std::env::temp_dir().join(format!("adb-manager-{}-{safe_name}", now_ms()))
}

fn remote_reconnect_device(app: &AppHandle, serial: &str) -> Result<String, String> {
    validate_serial(serial)?;
    let state = app.state::<AppState>();
    let _guard = state
        .adb_server_operation
        .lock()
        .map_err(|_| "ADB server operation is unavailable".to_string())?;

    let output = if serial.contains(':') {
        let _ =
            adb::run_adb_with_timeout(app, &["disconnect", serial], None, Duration::from_secs(5));
        adb::run_adb_with_timeout(app, &["connect", serial], None, Duration::from_secs(15))
    } else {
        adb::run_adb_with_timeout(
            app,
            &["reconnect", "device"],
            Some(serial),
            Duration::from_secs(15),
        )
    }
    .map_err(|error| error.to_string())?;

    adb::ensure_success(&output, "Reconnect remote device").map_err(|error| error.to_string())?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if stdout.is_empty() {
        Ok("Reconnect requested".to_string())
    } else {
        Ok(stdout)
    }
}

fn remote_command_templates() -> Vec<RemoteCommandTemplate> {
    vec![
        RemoteCommandTemplate {
            id: "wake",
            label: "Wake screen",
            args: vec!["shell", "input", "keyevent", "KEYCODE_WAKEUP"],
        },
        RemoteCommandTemplate {
            id: "sleep",
            label: "Sleep screen",
            args: vec!["shell", "input", "keyevent", "KEYCODE_SLEEP"],
        },
        RemoteCommandTemplate {
            id: "display_size",
            label: "Display size",
            args: vec!["shell", "wm", "size"],
        },
        RemoteCommandTemplate {
            id: "display_density",
            label: "Display density",
            args: vec!["shell", "wm", "density"],
        },
        RemoteCommandTemplate {
            id: "battery",
            label: "Battery status",
            args: vec!["shell", "dumpsys", "battery"],
        },
        RemoteCommandTemplate {
            id: "foreground_window",
            label: "Foreground window",
            args: vec![
                "shell",
                "dumpsys window | grep -E 'mCurrentFocus|mFocusedApp' | head -n 3",
            ],
        },
    ]
}

fn with_session<F>(
    app: &AppHandle,
    request: &HttpRequest,
    action: RemoteAction,
    handler: F,
) -> HttpResponse
where
    F: FnOnce(&RemoteSessionInfo) -> HttpResponse,
{
    let session = match authorize_remote_request(app, request) {
        Ok(session) => session,
        Err(response) => return response,
    };
    if !session.role.allows(action) {
        return json_response(403, json!({ "ok": false, "error": "Permission denied" }));
    }

    handler(&session)
}

fn with_control_session<F>(app: &AppHandle, request: &HttpRequest, handler: F) -> HttpResponse
where
    F: FnOnce(&RemoteSessionInfo) -> HttpResponse,
{
    let session = match authorize_remote_request(app, request) {
        Ok(session) => session,
        Err(response) => return response,
    };
    if !session.role.allows(RemoteAction::Input) {
        return json_response(403, json!({ "ok": false, "error": "Permission denied" }));
    }
    if let Err(error) = ensure_control_owner(app, &session) {
        return json_response(409, json!({ "ok": false, "error": error }));
    }

    handler(&session)
}

fn authorize_remote_request(
    app: &AppHandle,
    request: &HttpRequest,
) -> Result<RemoteSessionInfo, HttpResponse> {
    let Some(token) = request_token(request) else {
        return Err(json_response(
            401,
            json!({ "ok": false, "error": "Remote session is not authorized" }),
        ));
    };
    let state = app.state::<AppState>();
    let mut runtime = state.remote_control.lock().map_err(|_| {
        json_response(
            500,
            json!({ "ok": false, "error": "Remote control state unavailable" }),
        )
    })?;

    let now = now_ms();
    if let Some(session) = runtime.sessions.get_mut(token) {
        if now.saturating_sub(session.connected_at_ms) > SESSION_TTL_MS {
            let session_id = session.id.clone();
            runtime.sessions.remove(token);
            runtime.control_owner.release(&session_id);
            return Err(json_response(
                401,
                json!({ "ok": false, "error": "Remote session is expired" }),
            ));
        }
        session.last_seen_ms = now;
        return Ok(session.clone());
    }

    if runtime
        .session
        .as_ref()
        .map(|session| session.matches_token(token))
        .unwrap_or(false)
    {
        return Ok(RemoteSessionInfo {
            id: "legacy-admin".to_string(),
            token: token.to_string(),
            role: RemoteRole::Admin,
            client_name: "PIN session".to_string(),
            connected_at_ms: runtime.started_at_ms.unwrap_or_else(now_ms),
            last_seen_ms: now,
        });
    }

    Err(json_response(
        401,
        json!({ "ok": false, "error": "Remote session is not authorized" }),
    ))
}

fn request_token(request: &HttpRequest) -> Option<&str> {
    if let Some(header) = request.headers.get("authorization") {
        if let Some(token) = header.strip_prefix("Bearer ") {
            return Some(token.trim());
        }
    }
    request.query.get("token").map(|token| token.trim())
}

fn ensure_control_owner(app: &AppHandle, session: &RemoteSessionInfo) -> Result<(), String> {
    let state = app.state::<AppState>();
    let runtime = state
        .remote_control
        .lock()
        .map_err(|_| "Remote control state unavailable".to_string())?;
    if runtime.control_owner.is_owner(&session.id) {
        return Ok(());
    }
    Err("Acquire control before sending input".to_string())
}

fn list_remote_devices(app: &AppHandle) -> Result<Vec<RemoteDevice>, String> {
    let output = adb::run_adb_with_timeout(app, &["devices", "-l"], None, Duration::from_secs(8))
        .map_err(|error| error.to_string())?;
    adb::ensure_success(&output, "List remote devices").map_err(|error| error.to_string())?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(parse_remote_devices_output(&stdout))
}

fn capture_remote_screenshot(app: &AppHandle, serial: &str) -> Result<Vec<u8>, String> {
    validate_serial(serial)?;
    let state = app.state::<AppState>();
    let _lease = RemoteScreenshotLease::try_acquire(&state.remote_screenshot_in_flight, serial)?;
    let output = adb::run_adb_with_timeout(
        app,
        &["exec-out", "screencap", "-p"],
        Some(serial),
        Duration::from_secs(REMOTE_SCREENSHOT_TIMEOUT_SECS),
    )
    .map_err(|error| error.to_string())?;
    adb::ensure_success(&output, "Capture remote screenshot").map_err(|error| error.to_string())?;
    Ok(output.stdout)
}

fn run_remote_tap(app: &AppHandle, serial: &str, x: i32, y: i32) -> Result<String, String> {
    validate_serial(serial)?;
    let x = coordinate_arg(x, "x")?;
    let y = coordinate_arg(y, "y")?;
    run_remote_input(app, serial, &["shell", "input", "tap", &x, &y])
}

fn run_remote_swipe(
    app: &AppHandle,
    serial: &str,
    x1: i32,
    y1: i32,
    x2: i32,
    y2: i32,
    duration_ms: i32,
) -> Result<String, String> {
    validate_serial(serial)?;
    let x1 = coordinate_arg(x1, "x1")?;
    let y1 = coordinate_arg(y1, "y1")?;
    let x2 = coordinate_arg(x2, "x2")?;
    let y2 = coordinate_arg(y2, "y2")?;
    if !(0..=5000).contains(&duration_ms) {
        return Err("Swipe duration must be between 0 and 5000 ms".to_string());
    }
    let duration = duration_ms.to_string();
    run_remote_input(
        app,
        serial,
        &["shell", "input", "swipe", &x1, &y1, &x2, &y2, &duration],
    )
}

fn run_remote_text(app: &AppHandle, serial: &str, text: &str) -> Result<String, String> {
    validate_serial(serial)?;
    if text.chars().count() > 500 {
        return Err("Text is too long for remote input".to_string());
    }
    let escaped = escape_remote_input_text(text);
    run_remote_input(app, serial, &["shell", "input", "text", &escaped])
}

fn run_remote_clipboard(app: &AppHandle, serial: &str, text: &str) -> Result<String, String> {
    validate_serial(serial)?;
    if text.chars().count() > 2_000 {
        return Err("Clipboard text is too long".to_string());
    }
    run_remote_input(app, serial, &["shell", "cmd", "clipboard", "set", text])
}

fn run_remote_key(app: &AppHandle, serial: &str, key: &str) -> Result<String, String> {
    validate_serial(serial)?;
    let keyevent = remote_keyevent(key).ok_or_else(|| "Key is not allowed".to_string())?;
    run_remote_input(app, serial, &["shell", "input", "keyevent", keyevent])
}

fn run_remote_input(app: &AppHandle, serial: &str, args: &[&str]) -> Result<String, String> {
    validate_serial(serial)?;
    let state = app.state::<AppState>();
    let _guard = state
        .remote_control_operation
        .lock()
        .map_err(|_| "Remote action queue is unavailable".to_string())?;
    let output = adb::run_adb_with_timeout(app, args, Some(serial), Duration::from_secs(8))
        .map_err(|error| error.to_string())?;
    adb::ensure_success(&output, "Run remote action").map_err(|error| error.to_string())?;
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn action_response(
    app: &AppHandle,
    session: Option<&RemoteSessionInfo>,
    action: &str,
    serial: &str,
    result: Result<String, String>,
) -> HttpResponse {
    match result {
        Ok(message) => {
            record_remote_audit(app, session, action, serial, true, &message);
            json_response(200, json!({ "ok": true, "message": message }))
        }
        Err(error) => {
            record_remote_audit(app, session, action, serial, false, &error);
            json_response(500, json!({ "ok": false, "error": error }))
        }
    }
}

fn record_remote_audit(
    app: &AppHandle,
    session: Option<&RemoteSessionInfo>,
    action: &str,
    serial: &str,
    ok: bool,
    message: &str,
) {
    let state = app.state::<AppState>();
    let Ok(mut audit) = state.remote_audit_log.lock() else {
        return;
    };
    audit.push(RemoteAuditEntry {
        ts_ms: now_ms(),
        session_id: session.map(|item| item.id.clone()).unwrap_or_default(),
        role: session
            .map(|item| item.role.to_string())
            .unwrap_or_else(|| "system".to_string()),
        action: action.to_string(),
        serial: serial.to_string(),
        ok,
        message: message.chars().take(240).collect(),
    });
    if audit.len() > MAX_AUDIT_ENTRIES {
        let remove_count = audit.len() - MAX_AUDIT_ENTRIES;
        audit.drain(0..remove_count);
    }
}

fn remote_status(
    app: &AppHandle,
    state: &State<'_, AppState>,
) -> Result<RemoteControlStatus, AdbError> {
    let mut runtime = state
        .remote_control
        .lock()
        .map_err(|_| remote_state_error())?;
    remote_status_from_state(app, state, &mut runtime)
}

fn remote_status_from_state(
    app: &AppHandle,
    state: &State<'_, AppState>,
    runtime: &mut crate::state::RemoteControlRuntime,
) -> Result<RemoteControlStatus, AdbError> {
    ensure_role_invites(runtime, now_ms());
    let enabled = runtime.port.is_some();
    let addresses = runtime
        .port
        .map(remote_control_addresses)
        .unwrap_or_else(Vec::new);
    let urls = addresses
        .iter()
        .map(|address| address.url.clone())
        .collect::<Vec<_>>();
    let invite_links = runtime
        .port
        .map(|port| remote_invite_links(&addresses, &runtime.invites, port))
        .unwrap_or_default();
    let qr_svg = urls.first().and_then(|url| qr_svg_for_url(url));
    let (pin, pin_used) = runtime
        .session
        .as_ref()
        .map(|session| (Some(session.pin().to_string()), session.pin_used()))
        .unwrap_or((None, false));
    let audit = state
        .remote_audit_log
        .lock()
        .map(|entries| entries.clone())
        .unwrap_or_default();
    let trusted_devices = remote_trusted_devices(app).unwrap_or_default();

    Ok(RemoteControlStatus {
        enabled,
        port: runtime.port,
        pin,
        pin_used,
        urls,
        addresses,
        invite_links,
        sessions: runtime.sessions.values().cloned().collect(),
        trusted_devices,
        control_owner: runtime.control_owner.clone(),
        stream_defaults: RemoteStreamDefaults {
            fps: STREAM_FPS,
            jpeg_quality: STREAM_JPEG_QUALITY,
            max_width: STREAM_MAX_WIDTH,
        },
        qr_svg,
        started_at_ms: runtime.started_at_ms,
        audit,
    })
}

fn bind_remote_listener(app: &AppHandle) -> std::io::Result<TcpListener> {
    let preferred_port = load_remote_trust_store(app)
        .ok()
        .and_then(|store| store.last_port);
    let listener = bind_remote_listener_with_preferred(preferred_port)?;
    let port = listener.local_addr()?.port();
    if let Ok(mut store) = load_remote_trust_store(app) {
        store.last_port = Some(port);
        let _ = save_remote_trust_store(app, &store);
    }
    Ok(listener)
}

fn bind_remote_listener_with_preferred(
    preferred_port: Option<u16>,
) -> std::io::Result<TcpListener> {
    if let Some(port) = preferred_port.filter(|port| *port > 0) {
        if let Ok(listener) = TcpListener::bind(("0.0.0.0", port)) {
            return Ok(listener);
        }
    }
    TcpListener::bind(("0.0.0.0", 0))
}

fn remote_command_error(message: String) -> AdbError {
    AdbError::CommandFailed(message)
}

fn trusted_store_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir.join(TRUST_STORE_FILE))
}

fn load_remote_trust_store(app: &AppHandle) -> Result<RemoteTrustStore, String> {
    let path = trusted_store_path(app)?;
    load_remote_trust_store_from_path(&path)
}

fn load_remote_trust_store_from_path(path: &Path) -> Result<RemoteTrustStore, String> {
    if !path.exists() {
        return Ok(RemoteTrustStore::default());
    }
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    let mut store = serde_json::from_slice::<RemoteTrustStore>(&bytes).unwrap_or_default();
    store.version = TRUST_STORE_VERSION;
    Ok(store)
}

fn save_remote_trust_store(app: &AppHandle, store: &RemoteTrustStore) -> Result<(), String> {
    let path = trusted_store_path(app)?;
    save_remote_trust_store_to_path(&path, store)
}

fn save_remote_trust_store_to_path(path: &Path, store: &RemoteTrustStore) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let bytes = serde_json::to_vec_pretty(store).map_err(|error| error.to_string())?;
    fs::write(path, bytes).map_err(|error| error.to_string())
}

fn cleanup_remote_trust_store(app: &AppHandle) -> Result<(), String> {
    let mut store = load_remote_trust_store(app)?;
    if cleanup_trusted_devices(&mut store, now_ms()) {
        save_remote_trust_store(app, &store)?;
    }
    Ok(())
}

fn remote_trusted_devices(app: &AppHandle) -> Result<Vec<RemoteTrustedDeviceInfo>, String> {
    let mut store = load_remote_trust_store(app)?;
    let changed = cleanup_trusted_devices(&mut store, now_ms());
    if changed {
        save_remote_trust_store(app, &store)?;
    }
    Ok(trusted_device_infos(&store))
}

fn register_trusted_device(
    app: &AppHandle,
    role: RemoteRole,
    client_name: String,
    now_ms: u64,
    trusted_token: String,
) -> Result<(String, RemoteTrustedDeviceInfo), String> {
    let mut store = load_remote_trust_store(app)?;
    cleanup_trusted_devices(&mut store, now_ms);
    let device =
        register_trusted_device_in_store(&mut store, role, client_name, &trusted_token, now_ms);
    save_remote_trust_store(app, &store)?;
    Ok((trusted_token, device))
}

fn claim_trusted_device(
    app: &AppHandle,
    trusted_token: &str,
    client_name: String,
    now_ms: u64,
    session_token: String,
) -> Result<RemoteSessionInfo, String> {
    let mut store = load_remote_trust_store(app)?;
    let result = claim_trusted_device_in_store(
        &mut store,
        trusted_token,
        client_name,
        now_ms,
        session_token,
    );
    save_remote_trust_store(app, &store)?;
    result
}

fn revoke_trusted_device(
    app: &AppHandle,
    trusted_device_id: &str,
) -> Result<Vec<RemoteTrustedDeviceInfo>, String> {
    let mut store = load_remote_trust_store(app)?;
    store
        .devices
        .retain(|device| device.id != trusted_device_id);
    save_remote_trust_store(app, &store)?;
    Ok(trusted_device_infos(&store))
}

fn revoke_all_trusted_devices(app: &AppHandle) -> Result<Vec<RemoteTrustedDeviceInfo>, String> {
    let mut store = load_remote_trust_store(app)?;
    store.devices.clear();
    save_remote_trust_store(app, &store)?;
    Ok(Vec::new())
}

fn register_trusted_device_in_store(
    store: &mut RemoteTrustStore,
    role: RemoteRole,
    client_name: String,
    trusted_token: &str,
    now_ms: u64,
) -> RemoteTrustedDeviceInfo {
    let token_hash = hash_trusted_token(trusted_token);
    let device = StoredRemoteTrustedDevice {
        id: format!("trusted-{}-{}-{}", role, now_ms, &token_hash[..8]),
        token_hash,
        role,
        client_name: sanitize_client_name(&client_name),
        created_at_ms: now_ms,
        expires_at_ms: now_ms + TRUSTED_DEVICE_TTL_MS,
        last_seen_ms: now_ms,
    };
    let info = trusted_device_info(&device);
    store.devices.push(device);
    info
}

fn claim_trusted_device_in_store(
    store: &mut RemoteTrustStore,
    trusted_token: &str,
    client_name: String,
    now_ms: u64,
    session_token: String,
) -> Result<RemoteSessionInfo, String> {
    cleanup_trusted_devices(store, now_ms);
    let token_hash = hash_trusted_token(trusted_token);
    let Some(device) = store
        .devices
        .iter_mut()
        .find(|device| device.token_hash == token_hash)
    else {
        return Err("Trusted device is invalid or expired".to_string());
    };

    device.last_seen_ms = now_ms;
    if !client_name.trim().is_empty() {
        device.client_name = sanitize_client_name(&client_name);
    }

    Ok(remote_session_for_role(
        device.role,
        device.client_name.clone(),
        session_token,
        now_ms,
    ))
}

fn cleanup_trusted_devices(store: &mut RemoteTrustStore, now_ms: u64) -> bool {
    let before = store.devices.len();
    store
        .devices
        .retain(|device| now_ms <= device.expires_at_ms);
    before != store.devices.len()
}

fn trusted_device_infos(store: &RemoteTrustStore) -> Vec<RemoteTrustedDeviceInfo> {
    store.devices.iter().map(trusted_device_info).collect()
}

fn trusted_device_info(device: &StoredRemoteTrustedDevice) -> RemoteTrustedDeviceInfo {
    RemoteTrustedDeviceInfo {
        id: device.id.clone(),
        role: device.role,
        client_name: device.client_name.clone(),
        created_at_ms: device.created_at_ms,
        expires_at_ms: device.expires_at_ms,
        last_seen_ms: device.last_seen_ms,
    }
}

fn sanitize_client_name(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return remote_client_name();
    }
    trimmed.chars().take(80).collect()
}

fn remote_client_name() -> String {
    "Remote browser".to_string()
}

fn hash_trusted_token(token: &str) -> String {
    let digest = Sha256::digest(token.trim().as_bytes());
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn remote_session_for_role(
    role: RemoteRole,
    client_name: String,
    session_token: String,
    now_ms: u64,
) -> RemoteSessionInfo {
    let suffix = session_token.chars().take(8).collect::<String>();
    RemoteSessionInfo {
        id: format!("{}-{}-{}", role, now_ms, suffix),
        token: session_token,
        role,
        client_name: sanitize_client_name(&client_name),
        connected_at_ms: now_ms,
        last_seen_ms: now_ms,
    }
}

fn remote_state_error() -> AdbError {
    AdbError::CommandFailed("Remote control state is unavailable".to_string())
}

fn read_http_request(stream: &TcpStream) -> Result<HttpRequest, String> {
    stream
        .set_nonblocking(false)
        .map_err(|error| error.to_string())?;
    let _ = stream.set_read_timeout(Some(Duration::from_secs(10)));
    let mut reader = BufReader::new(stream.try_clone().map_err(|error| error.to_string())?);
    let mut request_line = String::new();
    match reader.read_line(&mut request_line) {
        Ok(0) => return Err("Empty HTTP request".to_string()),
        Ok(_) => {}
        Err(error)
            if matches!(
                error.kind(),
                std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
            ) =>
        {
            return Err("Temporary HTTP read unavailable".to_string());
        }
        Err(error) => return Err(error.to_string()),
    }
    let parts = request_line.split_whitespace().collect::<Vec<_>>();
    if parts.len() < 2 {
        return Err("Invalid HTTP request".to_string());
    }
    let target = parts[1];
    let (path, query) = parse_request_target(target);

    let mut headers = HashMap::new();
    let mut content_length = 0usize;
    let mut body_too_large = false;
    loop {
        let mut line = String::new();
        reader
            .read_line(&mut line)
            .map_err(|error| error.to_string())?;
        let trimmed = line.trim_end_matches(['\r', '\n']);
        if trimmed.is_empty() {
            break;
        }
        if let Some((key, value)) = trimmed.split_once(':') {
            let key = key.trim().to_ascii_lowercase();
            let value = value.trim().to_string();
            if key == "content-length" {
                let max_body = if path == "/remote/api/apk/install" {
                    MAX_REMOTE_APK_BYTES
                } else {
                    2 * 1024 * 1024
                };
                let requested_length = value.parse::<usize>().unwrap_or(0);
                body_too_large = requested_length > max_body;
                content_length = requested_length.min(max_body);
            }
            headers.insert(key, value);
        }
    }

    let mut body = vec![0u8; content_length];
    if content_length > 0 {
        reader
            .read_exact(&mut body)
            .map_err(|error| error.to_string())?;
    }

    Ok(HttpRequest {
        method: parts[0].to_string(),
        path,
        query,
        headers,
        body,
        body_too_large,
    })
}

fn is_ignorable_http_read_error(message: &str) -> bool {
    message == "Empty HTTP request"
        || message == "Temporary HTTP read unavailable"
        || message.contains("Resource temporarily unavailable")
        || message.contains("operation would block")
        || message.contains("timed out")
}

fn parse_request_target(target: &str) -> (String, HashMap<String, String>) {
    let (path, query_string) = target.split_once('?').unwrap_or((target, ""));
    let mut query = HashMap::new();
    for item in query_string.split('&').filter(|item| !item.is_empty()) {
        let (key, value) = item.split_once('=').unwrap_or((item, ""));
        query.insert(percent_decode(key), percent_decode(value));
    }
    (path.to_string(), query)
}

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut output = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let Ok(hex) = std::str::from_utf8(&bytes[index + 1..index + 3]) {
                if let Ok(decoded) = u8::from_str_radix(hex, 16) {
                    output.push(decoded);
                    index += 3;
                    continue;
                }
            }
        }
        output.push(if bytes[index] == b'+' {
            b' '
        } else {
            bytes[index]
        });
        index += 1;
    }
    String::from_utf8_lossy(&output).to_string()
}

fn write_http_response(stream: &mut TcpStream, response: HttpResponse) -> std::io::Result<()> {
    write!(
        stream,
        "HTTP/1.1 {} {}\r\nContent-Type: {}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\n",
        response.status,
        response.reason,
        response.content_type,
        response.body.len()
    )?;
    for (key, value) in response.headers {
        write!(stream, "{key}: {value}\r\n")?;
    }
    write!(stream, "Connection: close\r\n\r\n")?;
    stream.write_all(&response.body)?;
    stream.flush()
}

fn json_response(status: u16, value: serde_json::Value) -> HttpResponse {
    let reason = status_reason(status);
    HttpResponse {
        status,
        reason,
        content_type: "application/json; charset=utf-8",
        headers: Vec::new(),
        body: serde_json::to_vec(&value).unwrap_or_else(|_| b"{\"ok\":false}".to_vec()),
    }
}

fn html_response(body: &'static str) -> HttpResponse {
    HttpResponse {
        status: 200,
        reason: "OK",
        content_type: "text/html; charset=utf-8",
        headers: vec![(
            "Content-Disposition".to_string(),
            "inline; filename=\"remote.html\"".to_string(),
        )],
        body: body.as_bytes().to_vec(),
    }
}

fn js_response(body: &'static str) -> HttpResponse {
    HttpResponse {
        status: 200,
        reason: "OK",
        content_type: "application/javascript; charset=utf-8",
        headers: Vec::new(),
        body: body.as_bytes().to_vec(),
    }
}

fn binary_response(status: u16, content_type: &'static str, body: Vec<u8>) -> HttpResponse {
    HttpResponse {
        status,
        reason: status_reason(status),
        content_type,
        headers: Vec::new(),
        body,
    }
}

#[cfg(test)]
fn mjpeg_stream_response() -> HttpResponse {
    HttpResponse {
        status: 200,
        reason: "OK",
        content_type: MJPEG_CONTENT_TYPE,
        headers: Vec::new(),
        body: Vec::new(),
    }
}

fn status_reason(status: u16) -> &'static str {
    match status {
        200 => "OK",
        302 => "Found",
        400 => "Bad Request",
        401 => "Unauthorized",
        413 => "Payload Too Large",
        403 => "Forbidden",
        404 => "Not Found",
        409 => "Conflict",
        429 => "Too Many Requests",
        500 => "Internal Server Error",
        503 => "Service Unavailable",
        _ => "OK",
    }
}

fn generate_pin() -> String {
    let mut rng = rand::thread_rng();
    format!("{:06}", rng.gen_range(0..=999_999))
}

fn generate_token() -> String {
    rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(48)
        .map(char::from)
        .collect()
}

fn ensure_role_invites(runtime: &mut crate::state::RemoteControlRuntime, now_ms: u64) {
    runtime
        .invites
        .retain(|_, invite| !invite.used && now_ms <= invite.expires_at_ms);

    for role in [RemoteRole::Viewer, RemoteRole::Operator, RemoteRole::Admin] {
        if runtime.invites.values().any(|invite| invite.role == role) {
            continue;
        }
        let token = generate_token();
        runtime.invites.insert(
            token.clone(),
            RemoteInvite::new(token, role, now_ms, now_ms + INVITE_TTL_MS),
        );
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
fn build_remote_control_urls(mut addresses: Vec<String>, port: u16) -> Vec<String> {
    if addresses.is_empty() {
        addresses.push("127.0.0.1".to_string());
    } else if !addresses.iter().any(|address| address == "127.0.0.1") {
        addresses.push("127.0.0.1".to_string());
    }
    addresses
        .into_iter()
        .map(|address| format!("http://{address}:{port}{REMOTE_ENTRY_PATH}"))
        .collect()
}

fn remote_control_addresses(port: u16) -> Vec<RemoteAddress> {
    let mut addresses = local_ipv4_addresses();
    addresses.extend(tailscale_ipv4_addresses());
    addresses.push("127.0.0.1".to_string());
    build_remote_addresses(addresses, tailscale_magic_dns_name(), port)
}

fn build_remote_addresses(
    addresses: Vec<String>,
    magic_dns: Option<String>,
    port: u16,
) -> Vec<RemoteAddress> {
    let mut seen = HashSet::new();
    let mut entries = Vec::new();
    for address in addresses {
        if !seen.insert(address.clone()) {
            continue;
        }
        let kind = if is_tailscale_ipv4(&address) {
            RemoteAddressKind::Tailscale
        } else if address == "127.0.0.1" || address == "localhost" {
            RemoteAddressKind::Localhost
        } else {
            RemoteAddressKind::Lan
        };
        entries.push(remote_address(kind, &address, port));
    }
    if let Some(name) = magic_dns.filter(|name| !name.trim().is_empty()) {
        if seen.insert(name.clone()) {
            entries.push(remote_address(RemoteAddressKind::Tailscale, &name, port));
        }
    }
    entries.sort_by_key(|entry| match entry.kind {
        RemoteAddressKind::Tailscale => 0,
        RemoteAddressKind::Lan => 1,
        RemoteAddressKind::Localhost => 2,
    });
    entries
}

fn remote_address(kind: RemoteAddressKind, host: &str, port: u16) -> RemoteAddress {
    let label = match kind {
        RemoteAddressKind::Tailscale => "Tailscale",
        RemoteAddressKind::Lan => "LAN",
        RemoteAddressKind::Localhost => "Localhost",
    };
    RemoteAddress {
        kind,
        label: label.to_string(),
        host: host.to_string(),
        url: format!("http://{host}:{port}{REMOTE_ENTRY_PATH}"),
    }
}

fn remote_invite_links(
    addresses: &[RemoteAddress],
    invites: &HashMap<String, RemoteInvite>,
    port: u16,
) -> Vec<RemoteInviteLink> {
    let base_url = addresses
        .first()
        .map(|address| address.url.clone())
        .unwrap_or_else(|| format!("http://127.0.0.1:{port}{REMOTE_ENTRY_PATH}"));
    let mut links = invites
        .values()
        .map(|invite| RemoteInviteLink {
            role: invite.role,
            url: format!("{}?invite={}", base_url, invite.token),
            qr_svg: qr_svg_for_url(&format!("{}?invite={}", base_url, invite.token)),
            expires_at_ms: invite.expires_at_ms,
            used: invite.used,
        })
        .collect::<Vec<_>>();
    links.sort_by_key(|link| match link.role {
        RemoteRole::Viewer => 0,
        RemoteRole::Operator => 1,
        RemoteRole::Admin => 2,
    });
    links
}

fn is_tailscale_ipv4(value: &str) -> bool {
    let parts = value
        .split('.')
        .filter_map(|part| part.parse::<u8>().ok())
        .collect::<Vec<_>>();
    parts.len() == 4 && parts[0] == 100 && (64..=127).contains(&parts[1])
}

fn tailscale_ipv4_addresses() -> Vec<String> {
    let Ok(output) = Command::new("tailscale").args(["ip", "-4"]).output() else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .filter(|line| is_tailscale_ipv4(line))
        .map(ToOwned::to_owned)
        .collect()
}

fn tailscale_magic_dns_name() -> Option<String> {
    let output = Command::new("tailscale")
        .args(["status", "--json"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let value = serde_json::from_slice::<serde_json::Value>(&output.stdout).ok()?;
    value
        .pointer("/Self/DNSName")
        .and_then(|item| item.as_str())
        .map(|name| name.trim_end_matches('.').to_string())
        .filter(|name| !name.is_empty())
}

fn qr_svg_for_url(url: &str) -> Option<String> {
    let code = QrCode::new(url.as_bytes()).ok()?;
    Some(
        code.render::<svg::Color>()
            .min_dimensions(192, 192)
            .dark_color(svg::Color("#111827"))
            .light_color(svg::Color("#ffffff"))
            .build(),
    )
}

fn local_ipv4_addresses() -> Vec<String> {
    let output = if cfg!(target_os = "windows") {
        Command::new("ipconfig").output()
    } else {
        Command::new("ifconfig").output()
    };

    let Ok(output) = output else {
        return Vec::new();
    };

    let stdout = String::from_utf8_lossy(&output.stdout);
    parse_local_ipv4_addresses(&stdout)
}

fn parse_local_ipv4_addresses(stdout: &str) -> Vec<String> {
    let mut addresses = Vec::new();

    for line in stdout.lines() {
        let line = line.trim();
        let candidate = if let Some(rest) = line.strip_prefix("inet ") {
            rest.split_whitespace().next()
        } else if line.contains("IPv4") {
            line.rsplit_once(':').map(|(_, value)| value.trim())
        } else {
            None
        };

        let Some(candidate) = candidate else {
            continue;
        };
        let candidate = candidate.trim_start_matches("addr:");
        if is_private_ipv4(candidate) && !addresses.iter().any(|item| item == candidate) {
            addresses.push(candidate.to_string());
        }
    }

    addresses
}

fn is_private_ipv4(value: &str) -> bool {
    let parts = value
        .split('.')
        .filter_map(|part| part.parse::<u8>().ok())
        .collect::<Vec<_>>();
    if parts.len() != 4 {
        return false;
    }
    parts[0] == 10
        || (parts[0] == 172 && (16..=31).contains(&parts[1]))
        || (parts[0] == 192 && parts[1] == 168)
}

fn parse_remote_devices_output(stdout: &str) -> Vec<RemoteDevice> {
    let mut devices = Vec::new();

    for line in stdout.lines().skip(1) {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let parts = line.splitn(2, char::is_whitespace).collect::<Vec<_>>();
        if parts.len() < 2 {
            continue;
        }
        let serial = parts[0].to_string();
        let rest = parts[1].trim();
        let state = rest
            .split_whitespace()
            .next()
            .unwrap_or("unknown")
            .to_string();

        let mut model = String::new();
        let mut product = String::new();
        for part in rest.split_whitespace() {
            if let Some(value) = part.strip_prefix("model:") {
                model = value.to_string();
            } else if let Some(value) = part.strip_prefix("product:") {
                product = value.to_string();
            }
        }

        devices.push(RemoteDevice {
            connection_type: infer_connection_type(&serial),
            serial,
            state,
            model,
            product,
        });
    }

    devices
}

fn infer_connection_type(serial: &str) -> String {
    if serial.contains(':') || serial.starts_with("adb-") || serial.contains("_adb-tls-") {
        "wireless".to_string()
    } else {
        "usb".to_string()
    }
}

fn validate_serial(serial: &str) -> Result<(), String> {
    if serial.trim().is_empty() {
        return Err("Select a device first".to_string());
    }
    if serial.len() > 256 {
        return Err("Device serial is too long".to_string());
    }
    Ok(())
}

fn coordinate_arg(value: i32, name: &str) -> Result<String, String> {
    if !(0..=20_000).contains(&value) {
        return Err(format!("{name} must be between 0 and 20000"));
    }
    Ok(value.to_string())
}

fn remote_keyevent(key: &str) -> Option<&'static str> {
    match key {
        "back" => Some("KEYCODE_BACK"),
        "home" => Some("KEYCODE_HOME"),
        "recents" => Some("KEYCODE_APP_SWITCH"),
        "power" => Some("KEYCODE_POWER"),
        "volume_up" => Some("KEYCODE_VOLUME_UP"),
        "volume_down" => Some("KEYCODE_VOLUME_DOWN"),
        _ => None,
    }
}

fn escape_remote_input_text(text: &str) -> String {
    text.chars()
        .map(|character| match character {
            ' ' => "%s".to_string(),
            '&' | '|' | '<' | '>' | ';' | '(' | ')' | '$' | '`' | '\\' | '"' | '\'' => {
                format!("\\{character}")
            }
            _ => character.to_string(),
        })
        .collect::<Vec<_>>()
        .join("")
}

fn remote_app_html() -> &'static str {
    r##"<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#1c7ed6">
  <link rel="manifest" href="/remote/manifest.webmanifest">
  <title>ADB Remote</title>
  <style>
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f7f8fb; color: #111827; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; background: #f7f8fb; }
    button, input, select, textarea { font: inherit; }
    .app { width: min(1240px, 100%); margin: 0 auto; padding: 16px; }
    .top { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 0 16px; }
    h1 { margin: 0; font-size: 22px; line-height: 1.2; letter-spacing: 0; }
    .status { font-size: 13px; color: #4b5563; }
    .panel { background: #fff; border: 1px solid #dfe3ea; border-radius: 8px; padding: 14px; box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04); }
    .grid { display: grid; grid-template-columns: minmax(250px, 360px) 1fr; gap: 14px; align-items: start; }
    .stack { display: grid; gap: 10px; }
    .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    input, select, textarea { width: 100%; min-height: 40px; border: 1px solid #cbd5e1; border-radius: 7px; padding: 8px 10px; background: #fff; color: #111827; }
    textarea { min-height: 72px; resize: vertical; }
    button { min-height: 40px; border: 1px solid #cbd5e1; border-radius: 7px; padding: 8px 12px; background: #fff; color: #111827; cursor: pointer; }
    button.primary { border-color: #1c7ed6; background: #1c7ed6; color: #fff; font-weight: 700; }
    button.danger { border-color: #dc2626; background: #dc2626; color: #fff; font-weight: 700; }
    button:disabled { opacity: .55; cursor: not-allowed; }
    .toolbar button { flex: 1 1 92px; }
    .viewer { display: grid; gap: 10px; }
    .screenWrap { position: relative; min-height: 280px; display: flex; align-items: center; justify-content: center; background: #111827; border-radius: 8px; overflow: hidden; border: 1px solid #111827; }
    #screen, #videoStream { max-width: 100%; max-height: 72vh; width: auto; height: auto; display: block; touch-action: manipulation; cursor: crosshair; }
    .cursor { position: absolute; width: 20px; height: 20px; border: 2px solid #38bdf8; border-radius: 999px; box-shadow: 0 0 0 2px rgba(17, 24, 39, .7), 0 0 14px rgba(56, 189, 248, .9); transform: translate(-50%, -50%); pointer-events: none; }
    .cursor::before, .cursor::after { content: ""; position: absolute; background: #38bdf8; left: 50%; top: 50%; transform: translate(-50%, -50%); }
    .cursor::before { width: 30px; height: 2px; }
    .cursor::after { width: 2px; height: 30px; }
    .touchpad { height: 132px; border: 1px solid #cbd5e1; border-radius: 8px; background: linear-gradient(135deg, #f8fafc, #eef2f7); display: grid; place-items: center; touch-action: none; user-select: none; color: #64748b; font-weight: 700; }
    .touchpad.active { border-color: #1c7ed6; box-shadow: inset 0 0 0 1px #1c7ed6; color: #1c7ed6; }
    .empty { color: #9ca3af; padding: 40px 20px; text-align: center; }
    .msg { min-height: 20px; color: #374151; font-size: 13px; }
    .bad { color: #b91c1c; }
    .ok { color: #047857; }
    .small { color: #6b7280; font-size: 12px; }
    .badge { display: inline-flex; align-items: center; min-height: 24px; border-radius: 999px; padding: 2px 9px; font-size: 12px; font-weight: 700; background: #eef2ff; color: #3730a3; }
    .badge.viewer { background: #f3f4f6; color: #374151; }
    .badge.operator { background: #dbeafe; color: #1d4ed8; }
    .badge.admin { background: #fee2e2; color: #b91c1c; }
    .divider { height: 1px; background: #e5e7eb; margin: 2px 0; }
    .sessionItem { display: grid; grid-template-columns: auto 1fr auto; gap: 8px; align-items: center; font-size: 12px; padding: 6px 0; border-bottom: 1px solid #eef2f7; }
    .sessionItem:last-child { border-bottom: 0; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace; overflow-wrap: anywhere; }
    .hide { display: none !important; }
    @media (max-width: 820px) {
      .app { padding: 12px; }
      .grid { grid-template-columns: 1fr; }
      h1 { font-size: 20px; }
      .toolbar button { flex-basis: 30%; }
      .screenWrap { min-height: 220px; }
    }
  </style>
</head>
<body>
  <main class="app">
    <div class="top">
      <div>
        <h1>ADB Remote</h1>
        <div class="status" id="sessionState">Remote session locked</div>
      </div>
      <div class="row">
        <span id="roleBadge" class="badge viewer hide">viewer</span>
        <span id="controlBadge" class="badge hide">view only</span>
        <button id="logoutBtn" class="hide">Lock</button>
      </div>
    </div>

    <section id="authPanel" class="panel stack">
      <div class="small" id="inviteHint">Scan a role QR from ADB Manager, or use the fallback admin PIN.</div>
      <input id="pinInput" inputmode="numeric" autocomplete="one-time-code" placeholder="PIN">
      <label class="row small"><input id="trustDeviceToggle" type="checkbox" checked style="width: auto; min-height: auto;"> trust this device for 7 days</label>
      <button id="authBtn" class="primary">Connect</button>
      <button id="clearTrustBtn" class="hide">Forget trusted device on this browser</button>
      <div id="authMsg" class="msg"></div>
    </section>

    <section id="remotePanel" class="grid hide">
      <aside class="panel stack">
        <select id="deviceSelect"></select>
        <div class="row">
          <button id="refreshDevicesBtn">Devices</button>
          <button id="refreshShotBtn" class="primary">Screenshot</button>
        </div>
        <div class="row">
          <button id="streamBtn">Start stream</button>
          <button id="downloadShotBtn">Download</button>
        </div>
        <div class="row">
          <button id="acquireBtn" class="primary" data-requires-input>Acquire</button>
          <button id="releaseBtn" data-requires-input>Release</button>
        </div>
        <label class="row small"><input id="liveToggle" type="checkbox" style="width: auto; min-height: auto;"> live snapshot</label>
        <select id="liveIntervalSelect" aria-label="Live snapshot speed">
          <option value="2000">Stable - 2s</option>
          <option value="1200" selected>Normal - 1.2s</option>
          <option value="750">Fast - 0.75s</option>
        </select>
        <label class="row small"><input id="refreshAfterActionToggle" type="checkbox" style="width: auto; min-height: auto;"> refresh after action</label>
        <div class="row toolbar">
          <button data-key="back" data-requires-control>Back</button>
          <button data-key="home" data-requires-control>Home</button>
          <button data-key="recents" data-requires-control>Recent</button>
          <button data-key="power" data-requires-control>Power</button>
          <button data-key="volume_down" data-requires-control>Vol-</button>
          <button data-key="volume_up" data-requires-control>Vol+</button>
        </div>
        <textarea id="textInput" placeholder="Text"></textarea>
        <div class="row">
          <button id="sendTextBtn" data-requires-control>Input</button>
          <button id="sendClipboardBtn" data-requires-input>Clipboard</button>
        </div>
        <div class="row toolbar">
          <button data-swipe="up" data-requires-control>Swipe up</button>
          <button data-swipe="down" data-requires-control>Swipe down</button>
          <button data-swipe="left" data-requires-control>Swipe left</button>
          <button data-swipe="right" data-requires-control>Swipe right</button>
        </div>
        <div class="divider"></div>
        <select id="templateSelect"></select>
        <button id="runTemplateBtn" data-requires-input>Run template</button>
        <div id="adminPanel" class="stack hide">
          <div class="divider"></div>
          <input id="apkInput" type="file" accept=".apk,application/vnd.android.package-archive">
          <button id="installApkBtn" class="primary">Install APK</button>
          <div class="row">
            <button id="reconnectBtn">Reconnect</button>
            <button id="repairPairingBtn" class="danger">Repair pairing</button>
          </div>
          <button id="refreshSessionsBtn">Sessions</button>
          <div id="sessionsList" class="small"></div>
        </div>
        <div id="message" class="msg"></div>
      </aside>

      <section class="viewer">
        <div class="screenWrap">
          <div id="emptyScreen" class="empty">Choose a device and refresh screenshot</div>
          <img id="screen" class="hide" alt="Android device screenshot">
          <video id="videoStream" class="hide" playsinline muted controls></video>
          <div id="cursor" class="cursor hide"></div>
        </div>
        <div class="small" id="viewerHint">Viewer mode</div>
        <div class="panel stack">
          <div class="row">
            <button id="mouseModeBtn" data-requires-input>Mouse mode</button>
            <button id="mouseClickBtn" class="primary" data-requires-control>Click</button>
            <button id="mouseCenterBtn">Center</button>
          </div>
          <select id="mouseSpeedSelect" aria-label="Mouse speed">
            <option value="0.7">Slow mouse</option>
            <option value="1.2" selected>Normal mouse</option>
            <option value="2">Fast mouse</option>
          </select>
          <div id="touchpad" class="touchpad">Move pointer</div>
        </div>
      </section>
    </section>
  </main>
  <script>
    const els = {
      authPanel: document.getElementById('authPanel'),
      remotePanel: document.getElementById('remotePanel'),
      pinInput: document.getElementById('pinInput'),
      trustDeviceToggle: document.getElementById('trustDeviceToggle'),
      authBtn: document.getElementById('authBtn'),
      clearTrustBtn: document.getElementById('clearTrustBtn'),
      authMsg: document.getElementById('authMsg'),
      deviceSelect: document.getElementById('deviceSelect'),
      refreshDevicesBtn: document.getElementById('refreshDevicesBtn'),
      refreshShotBtn: document.getElementById('refreshShotBtn'),
      streamBtn: document.getElementById('streamBtn'),
      downloadShotBtn: document.getElementById('downloadShotBtn'),
      acquireBtn: document.getElementById('acquireBtn'),
      releaseBtn: document.getElementById('releaseBtn'),
      liveToggle: document.getElementById('liveToggle'),
      liveIntervalSelect: document.getElementById('liveIntervalSelect'),
      refreshAfterActionToggle: document.getElementById('refreshAfterActionToggle'),
      textInput: document.getElementById('textInput'),
      sendTextBtn: document.getElementById('sendTextBtn'),
      sendClipboardBtn: document.getElementById('sendClipboardBtn'),
      templateSelect: document.getElementById('templateSelect'),
      runTemplateBtn: document.getElementById('runTemplateBtn'),
      adminPanel: document.getElementById('adminPanel'),
      apkInput: document.getElementById('apkInput'),
      installApkBtn: document.getElementById('installApkBtn'),
      reconnectBtn: document.getElementById('reconnectBtn'),
      repairPairingBtn: document.getElementById('repairPairingBtn'),
      refreshSessionsBtn: document.getElementById('refreshSessionsBtn'),
      sessionsList: document.getElementById('sessionsList'),
      message: document.getElementById('message'),
      sessionState: document.getElementById('sessionState'),
      roleBadge: document.getElementById('roleBadge'),
      controlBadge: document.getElementById('controlBadge'),
      inviteHint: document.getElementById('inviteHint'),
      viewerHint: document.getElementById('viewerHint'),
      logoutBtn: document.getElementById('logoutBtn'),
      screen: document.getElementById('screen'),
      videoStream: document.getElementById('videoStream'),
      emptyScreen: document.getElementById('emptyScreen'),
      cursor: document.getElementById('cursor'),
      mouseModeBtn: document.getElementById('mouseModeBtn'),
      mouseClickBtn: document.getElementById('mouseClickBtn'),
      mouseCenterBtn: document.getElementById('mouseCenterBtn'),
      mouseSpeedSelect: document.getElementById('mouseSpeedSelect'),
      touchpad: document.getElementById('touchpad')
    };
    const TRUST_TOKEN_KEY = 'adbRemoteTrustToken';
    const TRUST_DEVICE_KEY = 'adbRemoteTrustDevice';
    const DEFAULT_AUTH_HINT = 'Scan a role QR from ADB Manager, or use the fallback admin PIN.';
    function readJson(key) {
      try {
        return JSON.parse(localStorage.getItem(key) || 'null');
      } catch (_) {
        localStorage.removeItem(key);
        return null;
      }
    }
    let token = localStorage.getItem('adbRemoteToken') || '';
    let session = readJson('adbRemoteSession');
    let role = localStorage.getItem('adbRemoteRole') || (session && session.role) || '';
    let trustToken = localStorage.getItem(TRUST_TOKEN_KEY) || '';
    let trustedDevice = readJson(TRUST_DEVICE_KEY);
    let controlOwner = null;
    let liveTimer = 0;
    let shotInFlight = false;
    let streaming = false;
    let streamMode = '';
    let webRtcPeer = null;
    let suppressWebRtcFallback = false;
    let lastScreenshotUrl = '';
    let lastHlsDiagnostics = '';
    let mouseMode = localStorage.getItem('adbRemoteMouseMode') === 'true';
    let mousePoint = { x: 540, y: 960 };
    let padPointer = null;

    function setMessage(text, ok = true) {
      els.message.textContent = text || '';
      els.message.className = 'msg ' + (ok ? 'ok' : 'bad');
    }
    function setAuthMessage(text, ok = true) {
      els.authMsg.textContent = text || '';
      els.authMsg.className = 'msg ' + (ok ? 'ok' : 'bad');
    }
    function roleAllowsInput() {
      return role === 'operator' || role === 'admin';
    }
    function isAdmin() {
      return role === 'admin';
    }
    function hasControl() {
      return !!controlOwner && !!session && controlOwner.session_id === session.id;
    }
    function clientName() {
      return navigator.userAgentData?.platform || navigator.platform || navigator.userAgent || 'Remote browser';
    }
    function setSession(data) {
      session = data.session || data;
      token = data.token || session.token;
      role = session.role || data.role || role || 'viewer';
      localStorage.setItem('adbRemoteToken', token);
      localStorage.setItem('adbRemoteRole', role);
      localStorage.setItem('adbRemoteSession', JSON.stringify(session));
      updateCapabilityUI();
    }
    function clearSessionStorage() {
      token = '';
      session = null;
      role = '';
      controlOwner = null;
      localStorage.removeItem('adbRemoteToken');
      localStorage.removeItem('adbRemoteSession');
      localStorage.removeItem('adbRemoteRole');
    }
    function setTrustedDevice(data) {
      trustToken = data.trusted_token || trustToken;
      trustedDevice = data.trusted_device || trustedDevice;
      if (trustToken) localStorage.setItem(TRUST_TOKEN_KEY, trustToken);
      if (trustedDevice) localStorage.setItem(TRUST_DEVICE_KEY, JSON.stringify(trustedDevice));
      updateTrustUI();
    }
    function clearTrustToken() {
      trustToken = '';
      trustedDevice = null;
      localStorage.removeItem(TRUST_TOKEN_KEY);
      localStorage.removeItem(TRUST_DEVICE_KEY);
      updateTrustUI();
    }
    function updateTrustUI() {
      els.clearTrustBtn.classList.toggle('hide', !trustToken);
      if (!session && trustToken && trustedDevice) {
        els.inviteHint.textContent = `Trusted as ${trustedDevice.role}. Open /remote to auto reconnect, or scan another role QR.`;
      } else if (!session) {
        els.inviteHint.textContent = DEFAULT_AUTH_HINT;
      }
    }
    function showRemote() {
      els.authPanel.classList.add('hide');
      els.remotePanel.classList.remove('hide');
      els.logoutBtn.classList.remove('hide');
      els.roleBadge.classList.remove('hide', 'viewer', 'operator', 'admin');
      els.roleBadge.classList.add(role || 'viewer');
      els.roleBadge.textContent = role || 'viewer';
      els.sessionState.textContent = session ? `${session.client_name || 'Remote'} · ${session.id || ''}` : 'Remote session active';
      updateCapabilityUI();
    }
    function showAuth() {
      els.remotePanel.classList.add('hide');
      els.authPanel.classList.remove('hide');
      els.logoutBtn.classList.add('hide');
      els.roleBadge.classList.add('hide');
      els.controlBadge.classList.add('hide');
      els.sessionState.textContent = 'Remote session locked';
      stopLive();
      stopStream();
      updateTrustUI();
    }
    function updateCapabilityUI() {
      const canInput = roleAllowsInput();
      const canControl = canInput && hasControl();
      const admin = isAdmin();
      document.querySelectorAll('[data-requires-input]').forEach((item) => item.disabled = !canInput);
      document.querySelectorAll('[data-requires-control]').forEach((item) => item.disabled = !canControl);
      els.adminPanel.classList.toggle('hide', !admin);
      els.acquireBtn.disabled = !canInput || canControl;
      els.releaseBtn.disabled = !canControl;
      els.controlBadge.classList.toggle('hide', !canInput);
      els.controlBadge.textContent = canControl ? 'control' : 'watching';
      els.mouseModeBtn.textContent = mouseMode ? 'Mouse on' : 'Mouse mode';
      els.touchpad.classList.toggle('active', mouseMode && canControl);
      els.cursor.classList.toggle('hide', !mouseMode || activeMediaElement().classList.contains('hide'));
      els.viewerHint.textContent = mouseMode ? 'Mouse mode: move the pointer, then click' : (canControl ? 'Control mode' : 'View mode');
      updateCursor();
    }
    async function api(path, options = {}) {
      const headers = Object.assign({}, options.headers || {});
      if (token) headers.Authorization = 'Bearer ' + token;
      if (options.body && !(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';
      const res = await fetch(path, Object.assign({}, options, { headers }));
      if (res.headers.get('content-type')?.includes('application/json')) {
        const data = await res.json();
        if (!res.ok || data.ok === false) throw new Error(data.error || 'Request failed');
        return data;
      }
      if (!res.ok) throw new Error('Request failed');
      return res;
    }
    async function claimInvite(invite) {
      try {
        setAuthMessage('Claiming invite...');
        const data = await api('/remote/api/invite/claim', {
          method: 'POST',
          body: JSON.stringify({ invite, client_name: clientName() })
        });
        window.history.replaceState({}, document.title, '/remote');
        await completeLogin(data, 'invite');
      } catch (error) {
        setAuthMessage(error.message, false);
      }
    }
    async function claimTrust() {
      if (!trustToken) return false;
      try {
        setAuthMessage('Reconnecting trusted device...');
        const data = await api('/remote/api/trust/claim', {
          method: 'POST',
          body: JSON.stringify({ trusted_token: trustToken, client_name: clientName() })
        });
        await completeLogin(data, 'trust');
        return true;
      } catch (error) {
        clearTrustToken();
        clearSessionStorage();
        setAuthMessage('Trusted device expired or was revoked. Scan a role QR or use the fallback PIN.', false);
        return false;
      }
    }
    async function registerTrustIfRequested(source) {
      if (source === 'trust' || !els.trustDeviceToggle.checked) return '';
      const data = await api('/remote/api/trust/register', {
        method: 'POST',
        body: JSON.stringify({ client_name: clientName() })
      });
      setTrustedDevice(data);
      return data.trusted_device ? `Trusted this device as ${data.trusted_device.role} for 7 days` : 'Trusted this device for 7 days';
    }
    async function completeLogin(data, source) {
      setSession(data);
      let trustNotice = '';
      try {
        trustNotice = await registerTrustIfRequested(source);
      } catch (error) {
        trustNotice = `Connected, but trust was not saved: ${error.message}`;
      }
      setAuthMessage('');
      showRemote();
      await afterLogin();
      if (trustNotice) setMessage(trustNotice, !trustNotice.includes('not saved'));
    }
    async function auth() {
      try {
        const data = await api('/remote/api/auth', { method: 'POST', body: JSON.stringify({ pin: els.pinInput.value.trim() }) });
        await completeLogin({
          token: data.token,
          session: {
            id: 'legacy-admin',
            token: data.token,
            role: data.role || 'admin',
            client_name: 'PIN session',
            connected_at_ms: Date.now(),
            last_seen_ms: Date.now()
          }
        }, 'pin');
      } catch (error) {
        setAuthMessage(error.message, false);
      }
    }
    async function afterLogin() {
      const tasks = [refreshStatus(), loadDevices()];
      if (roleAllowsInput()) tasks.push(loadTemplates());
      await Promise.allSettled(tasks);
      if (isAdmin()) await refreshSessions();
    }
    async function refreshStatus() {
      try {
        const data = await api('/remote/api/status');
        controlOwner = data.status.control_owner || null;
        updateCapabilityUI();
      } catch (error) {
        setMessage(error.message, false);
        if (String(error.message).includes('authorized') || String(error.message).includes('expired')) lock();
      }
    }
    async function loadDevices() {
      try {
        const data = await api('/remote/api/devices');
        els.deviceSelect.innerHTML = '';
        data.devices.forEach((device) => {
          const opt = document.createElement('option');
          opt.value = device.serial;
          opt.textContent = `${device.model || device.serial} - ${device.state} - ${device.connection_type}`;
          els.deviceSelect.appendChild(opt);
        });
        setMessage(data.devices.length ? `${data.devices.length} device(s)` : 'No ADB devices', data.devices.length > 0);
      } catch (error) {
        setMessage(error.message, false);
        if (String(error.message).includes('authorized')) lock();
      }
    }
    async function loadTemplates() {
      try {
        const data = await api('/remote/api/templates');
        els.templateSelect.innerHTML = '';
        data.templates.forEach((template) => {
          const opt = document.createElement('option');
          opt.value = template.id;
          opt.textContent = template.label;
          els.templateSelect.appendChild(opt);
        });
      } catch (error) {
        setMessage(error.message, false);
      }
    }
    function selectedSerial() {
      return els.deviceSelect.value;
    }
    function ensureSerial() {
      const serial = selectedSerial();
      if (!serial) {
        setMessage('Select a device first', false);
        return '';
      }
      return serial;
    }
    async function screenshot(options = {}) {
      stopStream();
      const serial = selectedSerial();
      const silent = options.silent === true;
      if (!serial) { if (!silent) setMessage('Select a device first', false); return; }
      if (shotInFlight) { if (!silent) setMessage('Screenshot already refreshing'); return; }
      shotInFlight = true;
      try {
        const blob = await fetchScreenshotBlob(serial);
        showScreenshotBlob(blob);
        if (!silent) setMessage('Screenshot refreshed');
      } catch (error) {
        if (!silent) setMessage(error.message, false);
      } finally {
        shotInFlight = false;
      }
    }
    async function fetchScreenshotBlob(serial) {
      const res = await api('/remote/api/screenshot', { method: 'POST', body: JSON.stringify({ serial }) });
      return res.blob();
    }
    function showScreenshotBlob(blob) {
      const old = els.screen.src;
      hideVideoStreamElement();
      lastScreenshotUrl = URL.createObjectURL(blob);
      els.screen.src = lastScreenshotUrl;
      els.screen.classList.remove('hide');
      els.emptyScreen.classList.add('hide');
      if (old.startsWith('blob:')) URL.revokeObjectURL(old);
      ensureMousePoint();
      updateCursor();
    }
    function withToken(path) {
      const separator = path.includes('?') ? '&' : '?';
      return `${path}${separator}token=${encodeURIComponent(token)}&_=${Date.now()}`;
    }
    async function fetchTextForDiagnostics(url) {
      const res = await fetch(url, { cache: 'no-store' });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 160)}`);
      return text;
    }
    function hlsMediaUrls(playlist) {
      const lines = playlist.split(/\r?\n/);
      const mapLine = lines.find((line) => line.startsWith('#EXT-X-MAP:'));
      const mapMatch = mapLine && mapLine.match(/URI="([^"]+)"/);
      return {
        init: mapMatch ? mapMatch[1] : '',
        segment: lines.find((line) => line && !line.startsWith('#')) || ''
      };
    }
    async function probeHlsAsset(url, label) {
      if (!url) return `${label} none`;
      const assetUrl = url.startsWith('http') ? url : new URL(url, window.location.href).toString();
      const res = await fetch(`${assetUrl}${assetUrl.includes('?') ? '&' : '?'}probe=${Date.now()}`, {
        cache: 'no-store',
        headers: { Range: 'bytes=0-0' }
      });
      if (!res.ok) throw new Error(`${label} HTTP ${res.status}`);
      return `${label} HTTP ${res.status}`;
    }
    async function verifyHlsPlaylist(playlistUrl) {
      const playlist = await fetchTextForDiagnostics(playlistUrl);
      const media = hlsMediaUrls(playlist);
      if (!media.segment) throw new Error('HLS playlist has no media segment yet');
      const checks = [];
      if (media.init) checks.push(await probeHlsAsset(media.init, 'init'));
      checks.push(await probeHlsAsset(media.segment, 'segment'));
      lastHlsDiagnostics = `playlist ok, ${checks.join(', ')}`;
      return playlist;
    }
    function mjpegStreamUrl(serial) {
      return `/remote/api/stream.mjpeg?serial=${encodeURIComponent(serial)}&token=${encodeURIComponent(token)}&_=${Date.now()}`;
    }
    function startMjpegStream(serial, reason) {
      const old = els.screen.src;
      if (old.startsWith('blob:')) URL.revokeObjectURL(old);
      lastScreenshotUrl = '';
      hideVideoStreamElement();
      streamMode = 'mjpeg';
      streaming = true;
      els.streamBtn.textContent = 'Stop stream';
      els.screen.src = mjpegStreamUrl(serial);
      els.screen.classList.remove('hide');
      els.emptyScreen.classList.add('hide');
      setMessage(reason ? `${reason}. Falling back to MJPEG stream...` : 'Starting MJPEG stream...');
    }
    async function waitForIceGathering(peer) {
      if (peer.iceGatheringState === 'complete') return;
      await new Promise((resolve) => {
        const timeout = window.setTimeout(resolve, 2500);
        peer.addEventListener('icegatheringstatechange', () => {
          if (peer.iceGatheringState === 'complete') {
            window.clearTimeout(timeout);
            resolve();
          }
        });
      });
    }
    async function refreshWebRtcStatus() {
      try {
        await api('/remote/api/webrtc/status');
      } catch (_) {}
    }
    function closeWebRtcPeer(suppressFallback = false) {
      if (suppressFallback) suppressWebRtcFallback = true;
      if (!webRtcPeer) return;
      try { webRtcPeer.close(); } catch (_) {}
      webRtcPeer = null;
    }
    async function startWebRtcStream(serial) {
      if (!window.RTCPeerConnection) throw new Error('WebRTC is not available in this browser');
      closeWebRtcPeer(true);
      suppressWebRtcFallback = false;
      const peer = new RTCPeerConnection({ iceServers: [] });
      webRtcPeer = peer;
      streamMode = 'webrtc';
      peer.addTransceiver('video', { direction: 'recvonly' });
      peer.addEventListener('track', (event) => {
        const stream = event.streams && event.streams[0] ? event.streams[0] : new MediaStream([event.track]);
        els.videoStream.srcObject = stream;
        els.videoStream.classList.remove('hide');
        els.screen.classList.add('hide');
        els.emptyScreen.classList.add('hide');
        streaming = true;
        els.streamBtn.textContent = 'Stop stream';
      });
      peer.addEventListener('connectionstatechange', () => {
        if (!streaming || streamMode !== 'webrtc') return;
        if (peer.connectionState === 'connected') {
          setMessage('WebRTC active');
        }
        if (['failed', 'disconnected', 'closed'].includes(peer.connectionState)) {
          if (suppressWebRtcFallback) return;
          api('/remote/api/webrtc/stop', { method: 'POST', body: JSON.stringify({}) }).catch(() => {});
          closeWebRtcPeer(true);
          const fallbackSerial = selectedSerial();
          if (fallbackSerial) startMjpegStream(fallbackSerial, `WebRTC stream unavailable: ${peer.connectionState}`);
        }
      });
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      await waitForIceGathering(peer);
      const data = await api('/remote/api/webrtc/offer', {
        method: 'POST',
        body: JSON.stringify({ serial, offer_sdp: peer.localDescription.sdp })
      });
      await peer.setRemoteDescription({ type: 'answer', sdp: data.answer_sdp });
      els.videoStream.classList.remove('hide');
      els.videoStream.load();
      streaming = true;
      els.streamBtn.textContent = 'Connecting...';
      els.emptyScreen.classList.add('hide');
      await refreshWebRtcStatus();
      try {
        await els.videoStream.play();
      } catch (_) {
        setMessage('WebRTC stream ready. Tap play if the browser blocks autoplay.');
      }
    }
    async function startStream() {
      const serial = ensureSerial();
      if (!serial) return;
      els.streamBtn.disabled = true;
      setMessage('Starting WebRTC stream...');
      stopLive();
      try {
        await startWebRtcStream(serial);
      } catch (error) {
        closeWebRtcPeer(true);
        api('/remote/api/webrtc/stop', { method: 'POST', body: JSON.stringify({}) }).catch(() => {});
        startMjpegStream(serial, `WebRTC stream unavailable: ${error.message}`);
      } finally {
        els.streamBtn.disabled = false;
      }
    }
    async function startLegacyHlsStream() {
      const serial = ensureSerial();
      if (!serial) return;
      els.streamBtn.disabled = true;
      setMessage('Starting experimental HLS stream...');
      stopLive();
      try {
        lastHlsDiagnostics = '';
        streamMode = 'hls';
        const old = els.screen.src;
        if (old.startsWith('blob:')) URL.revokeObjectURL(old);
        lastScreenshotUrl = '';
        const data = await api('/remote/api/video-stream/start', { method: 'POST', body: JSON.stringify({ serial }) });
        els.screen.classList.add('hide');
        const playlistUrl = withToken(data.stream.playlist_url);
        const playlist = await verifyHlsPlaylist(playlistUrl);
        const segmentCount = playlist.split(/\r?\n/).filter((line) => line && !line.startsWith('#')).length;
        setMessage(`HLS playlist ready (${segmentCount} segment${segmentCount === 1 ? '' : 's'})`);
        els.videoStream.src = playlistUrl;
        els.videoStream.classList.remove('hide');
        els.videoStream.load();
        streaming = true;
        els.streamBtn.textContent = 'Connecting...';
        els.emptyScreen.classList.add('hide');
        try {
          await els.videoStream.play();
        } catch (_) {
          setMessage('Stream is ready. Tap play if the browser blocks autoplay.');
        }
      } catch (error) {
        streamMode = '';
        hideVideoStreamElement();
        api('/remote/api/video-stream/stop', { method: 'POST', body: JSON.stringify({}) }).catch(() => {});
        startMjpegStream(serial, `HLS stream unavailable: ${error.message}`);
      } finally {
        els.streamBtn.disabled = false;
      }
    }
    async function stopStream() {
      if (!streaming) return;
      streaming = false;
      streamMode = '';
      els.streamBtn.textContent = 'Start stream';
      els.screen.removeAttribute('src');
      closeWebRtcPeer(true);
      hideVideoStreamElement();
      api('/remote/api/webrtc/stop', { method: 'POST', body: JSON.stringify({}) }).catch(() => {});
      api('/remote/api/video-stream/stop', { method: 'POST', body: JSON.stringify({}) }).catch(() => {});
      setMessage('Stream stopped');
    }
    function hideVideoStreamElement() {
      els.videoStream.pause();
      els.videoStream.srcObject = null;
      els.videoStream.removeAttribute('src');
      els.videoStream.load();
      els.videoStream.classList.add('hide');
    }
    async function downloadScreenshot() {
      const serial = ensureSerial();
      if (!serial) return;
      try {
        const res = await api('/remote/api/screenshot', { method: 'POST', body: JSON.stringify({ serial }) });
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${serial.replace(/[^a-zA-Z0-9_.-]/g, '_')}-${Date.now()}.png`;
        link.click();
        URL.revokeObjectURL(url);
        setMessage('Screenshot downloaded');
      } catch (error) {
        setMessage(error.message, false);
      }
    }
    async function postAction(path, body) {
      try {
        await api(path, { method: 'POST', body: JSON.stringify(body) });
        setMessage('Action sent');
        if (els.refreshAfterActionToggle.checked) setTimeout(() => screenshot({ silent: true }), 650);
      } catch (error) {
        setMessage(error.message, false);
      }
    }
    async function acquireControl() {
      try {
        const data = await api('/remote/api/control/acquire', { method: 'POST', body: JSON.stringify({ force: isAdmin() }) });
        controlOwner = data.control_owner;
        updateCapabilityUI();
        setMessage('Control acquired');
      } catch (error) {
        setMessage(error.message, false);
      }
    }
    async function releaseControl() {
      try {
        const data = await api('/remote/api/control/release', { method: 'POST', body: JSON.stringify({}) });
        if (data.released) controlOwner = null;
        updateCapabilityUI();
        setMessage('Control released');
      } catch (error) {
        setMessage(error.message, false);
      }
    }
    async function runTemplate() {
      const serial = ensureSerial();
      if (!serial) return;
      const template_id = els.templateSelect.value;
      try {
        const data = await api('/remote/api/templates/run', { method: 'POST', body: JSON.stringify({ serial, template_id }) });
        setMessage(data.message || 'Template completed');
      } catch (error) {
        setMessage(error.message, false);
      }
    }
    async function installApk() {
      const serial = ensureSerial();
      const file = els.apkInput.files && els.apkInput.files[0];
      if (!serial || !file) { setMessage('Select an APK first', false); return; }
      try {
        const res = await fetch(`/remote/api/apk/install?serial=${encodeURIComponent(serial)}&name=${encodeURIComponent(file.name)}`, {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + token },
          body: file
        });
        const data = await res.json();
        if (!res.ok || data.ok === false) throw new Error(data.error || 'Install failed');
        setMessage(data.message || 'APK installed');
      } catch (error) {
        setMessage(error.message, false);
      }
    }
    async function refreshSessions() {
      if (!isAdmin()) return;
      try {
        const data = await api('/remote/api/sessions');
        controlOwner = data.control_owner || controlOwner;
        renderSessions(data.sessions || []);
        updateCapabilityUI();
      } catch (error) {
        setMessage(error.message, false);
      }
    }
    function renderSessions(sessions) {
      els.sessionsList.innerHTML = '';
      if (!sessions.length) {
        els.sessionsList.textContent = 'No active sessions';
        return;
      }
      sessions.forEach((item) => {
        const row = document.createElement('div');
        row.className = 'sessionItem';
        row.innerHTML = `<span class="badge ${item.role}">${item.role}</span><span class="mono">${item.client_name}<br>${item.id}</span>`;
        const button = document.createElement('button');
        button.textContent = 'Kick';
        button.disabled = session && item.id === session.id;
        button.addEventListener('click', () => kickSession(item.id));
        row.appendChild(button);
        els.sessionsList.appendChild(row);
      });
    }
    async function kickSession(session_id) {
      try {
        await api('/remote/api/sessions/kick', { method: 'POST', body: JSON.stringify({ session_id }) });
        setMessage('Session kicked');
        await refreshSessions();
      } catch (error) {
        setMessage(error.message, false);
      }
    }
    function activeMediaElement() {
      return els.videoStream.classList.contains('hide') ? els.screen : els.videoStream;
    }
    function mediaIntrinsicSize(element) {
      return {
        width: element.videoWidth || element.naturalWidth || 1080,
        height: element.videoHeight || element.naturalHeight || 1920
      };
    }
    function screenPoint(event) {
      const element = event.currentTarget === els.videoStream ? els.videoStream : activeMediaElement();
      const rect = element.getBoundingClientRect();
      const size = mediaIntrinsicSize(element);
      const x = Math.round((event.clientX - rect.left) * (size.width / rect.width));
      const y = Math.round((event.clientY - rect.top) * (size.height / rect.height));
      return { x, y };
    }
    function imageSize() {
      return mediaIntrinsicSize(activeMediaElement());
    }
    function ensureMousePoint() {
      const size = imageSize();
      if (!mousePoint || mousePoint.x <= 0 || mousePoint.y <= 0) {
        mousePoint = { x: Math.round(size.width / 2), y: Math.round(size.height / 2) };
      }
      mousePoint.x = Math.max(0, Math.min(size.width, mousePoint.x));
      mousePoint.y = Math.max(0, Math.min(size.height, mousePoint.y));
    }
    function updateCursor() {
      const element = activeMediaElement();
      if (!mouseMode || element.classList.contains('hide')) {
        els.cursor.classList.add('hide');
        return;
      }
      ensureMousePoint();
      const imageRect = element.getBoundingClientRect();
      const wrapRect = element.parentElement.getBoundingClientRect();
      const size = imageSize();
      const left = imageRect.left - wrapRect.left + (mousePoint.x / size.width) * imageRect.width;
      const top = imageRect.top - wrapRect.top + (mousePoint.y / size.height) * imageRect.height;
      els.cursor.style.left = `${left}px`;
      els.cursor.style.top = `${top}px`;
      els.cursor.classList.remove('hide');
    }
    function setMousePoint(point) {
      mousePoint = { x: point.x, y: point.y };
      ensureMousePoint();
      updateCursor();
    }
    function centerMouse() {
      const size = imageSize();
      setMousePoint({ x: Math.round(size.width / 2), y: Math.round(size.height / 2) });
      setMessage('Pointer centered');
    }
    function toggleMouseMode() {
      mouseMode = !mouseMode;
      localStorage.setItem('adbRemoteMouseMode', String(mouseMode));
      if (mouseMode) ensureMousePoint();
      updateCapabilityUI();
    }
    function moveMouseByPad(dx, dy) {
      if (!mouseMode || !hasControl()) return;
      const imageRect = activeMediaElement().getBoundingClientRect();
      const size = imageSize();
      const speed = Number(els.mouseSpeedSelect.value) || 1.2;
      const xScale = size.width / Math.max(1, imageRect.width || size.width);
      const yScale = size.height / Math.max(1, imageRect.height || size.height);
      setMousePoint({
        x: mousePoint.x + dx * xScale * speed,
        y: mousePoint.y + dy * yScale * speed
      });
    }
    function mouseClick() {
      if (!hasControl()) { setMessage('Acquire control before sending input', false); return; }
      const serial = ensureSerial();
      if (!serial) return;
      ensureMousePoint();
      postAction('/remote/api/tap', {
        serial,
        x: Math.round(mousePoint.x),
        y: Math.round(mousePoint.y)
      });
    }
    function swipePayload(direction) {
      const size = imageSize();
      const w = size.width;
      const h = size.height;
      const cx = Math.round(w / 2);
      const cy = Math.round(h / 2);
      const dx = Math.round(w * 0.28);
      const dy = Math.round(h * 0.28);
      const base = { serial: selectedSerial(), duration_ms: 320 };
      if (direction === 'up') return Object.assign(base, { x1: cx, y1: cy + dy, x2: cx, y2: cy - dy });
      if (direction === 'down') return Object.assign(base, { x1: cx, y1: cy - dy, x2: cx, y2: cy + dy });
      if (direction === 'left') return Object.assign(base, { x1: cx + dx, y1: cy, x2: cx - dx, y2: cy });
      return Object.assign(base, { x1: cx - dx, y1: cy, x2: cx + dx, y2: cy });
    }
    function liveIntervalMs() {
      const value = Number(els.liveIntervalSelect.value);
      return Number.isFinite(value) && value >= 500 ? value : 1200;
    }
    function startLive() {
      stopLive();
      screenshot({ silent: true });
      liveTimer = window.setInterval(() => screenshot({ silent: true }), liveIntervalMs());
    }
    function stopLive() {
      if (liveTimer) window.clearInterval(liveTimer);
      liveTimer = 0;
    }
    function lock() {
      clearSessionStorage();
      showAuth();
    }

    els.authBtn.addEventListener('click', auth);
    els.pinInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') auth(); });
    els.logoutBtn.addEventListener('click', lock);
    els.clearTrustBtn.addEventListener('click', () => {
      clearTrustToken();
      clearSessionStorage();
      showAuth();
      setAuthMessage('Trusted device forgotten on this browser.');
    });
    els.refreshDevicesBtn.addEventListener('click', loadDevices);
    els.refreshShotBtn.addEventListener('click', screenshot);
    els.streamBtn.addEventListener('click', () => streaming ? stopStream() : startStream());
    els.downloadShotBtn.addEventListener('click', downloadScreenshot);
    els.acquireBtn.addEventListener('click', acquireControl);
    els.releaseBtn.addEventListener('click', releaseControl);
    els.mouseModeBtn.addEventListener('click', toggleMouseMode);
    els.mouseClickBtn.addEventListener('click', mouseClick);
    els.mouseCenterBtn.addEventListener('click', centerMouse);
    els.screen.addEventListener('load', () => {
      updateCursor();
      if (streaming) {
        els.streamBtn.textContent = 'Stop stream';
        setMessage(streamMode === 'mjpeg' ? 'MJPEG stream active' : 'Stream active');
      }
    });
    els.screen.addEventListener('error', () => {
      if (!streaming) return;
      streaming = false;
      streamMode = '';
      els.streamBtn.textContent = 'Start stream';
      els.liveToggle.checked = true;
      startLive();
      setMessage('MJPEG stream failed. Falling back to live snapshot.', false);
    });
    els.videoStream.addEventListener('canplay', () => {
      updateCursor();
      if (streaming) {
        els.streamBtn.textContent = 'Stop stream';
        setMessage(streamMode === 'webrtc' ? 'WebRTC active' : 'HLS stream active');
      }
    });
    els.videoStream.addEventListener('error', () => {
      if (!streaming || streamMode !== 'hls') return;
      api('/remote/api/video-stream/stop', { method: 'POST', body: JSON.stringify({}) }).catch(() => {});
      const error = els.videoStream.error;
      const detail = [
        `code ${error && error.code ? error.code : 'unknown'}`,
        `ready ${els.videoStream.readyState}`,
        `network ${els.videoStream.networkState}`,
        lastHlsDiagnostics
      ].filter(Boolean).join(' · ');
      const serial = selectedSerial();
      if (serial) {
        startMjpegStream(serial, `HLS stream failed: ${detail}`);
      } else {
        streaming = false;
        streamMode = '';
        els.streamBtn.textContent = 'Start stream';
        setMessage(`HLS stream failed: ${detail}`, false);
      }
    });
    window.addEventListener('resize', updateCursor);
    els.liveToggle.addEventListener('change', () => els.liveToggle.checked ? startLive() : stopLive());
    els.liveIntervalSelect.addEventListener('change', () => { if (els.liveToggle.checked) startLive(); });
    els.sendTextBtn.addEventListener('click', () => postAction('/remote/api/text', { serial: selectedSerial(), text: els.textInput.value }));
    els.sendClipboardBtn.addEventListener('click', () => postAction('/remote/api/clipboard', { serial: selectedSerial(), text: els.textInput.value }));
    els.runTemplateBtn.addEventListener('click', runTemplate);
    els.installApkBtn.addEventListener('click', installApk);
    els.reconnectBtn.addEventListener('click', () => {
      const serial = ensureSerial();
      if (serial) postAction('/remote/api/admin/reconnect', { serial });
    });
    els.repairPairingBtn.addEventListener('click', () => postAction('/remote/api/admin/repair-pairing', {}));
    els.refreshSessionsBtn.addEventListener('click', refreshSessions);
    function handleMediaTap(event) {
      if (!hasControl()) { setMessage('Acquire control before sending input', false); return; }
      if (mouseMode) {
        setMousePoint(screenPoint(event));
        setMessage('Pointer moved');
        return;
      }
      const point = screenPoint(event);
      postAction('/remote/api/tap', Object.assign({ serial: selectedSerial() }, point));
    }
    els.screen.addEventListener('click', handleMediaTap);
    els.videoStream.addEventListener('click', handleMediaTap);
    els.touchpad.addEventListener('pointerdown', (event) => {
      if (!mouseMode) { setMessage('Turn on Mouse mode first', false); return; }
      if (!hasControl()) { setMessage('Acquire control before using mouse', false); return; }
      padPointer = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
      els.touchpad.setPointerCapture(event.pointerId);
      els.touchpad.classList.add('active');
    });
    els.touchpad.addEventListener('pointermove', (event) => {
      if (!padPointer || padPointer.id !== event.pointerId) return;
      const dx = event.clientX - padPointer.x;
      const dy = event.clientY - padPointer.y;
      if (Math.abs(dx) + Math.abs(dy) > 1) {
        padPointer.moved = true;
        moveMouseByPad(dx, dy);
      }
      padPointer.x = event.clientX;
      padPointer.y = event.clientY;
    });
    els.touchpad.addEventListener('pointerup', (event) => {
      if (!padPointer || padPointer.id !== event.pointerId) return;
      const shouldClick = !padPointer.moved;
      padPointer = null;
      els.touchpad.classList.toggle('active', mouseMode && hasControl());
      if (shouldClick) mouseClick();
    });
    els.touchpad.addEventListener('pointercancel', () => {
      padPointer = null;
      els.touchpad.classList.toggle('active', mouseMode && hasControl());
    });
    document.querySelectorAll('[data-key]').forEach((button) => {
      button.addEventListener('click', () => postAction('/remote/api/key', { serial: selectedSerial(), key: button.dataset.key }));
    });
    document.querySelectorAll('[data-swipe]').forEach((button) => {
      button.addEventListener('click', () => postAction('/remote/api/swipe', swipePayload(button.dataset.swipe)));
    });

    const invite = new URLSearchParams(window.location.search).get('invite');
    updateTrustUI();
    if (invite) {
      els.inviteHint.textContent = 'Joining remote session...';
      claimInvite(invite);
    } else if (trustToken) {
      claimTrust().then((ok) => {
        if (!ok && token) {
          showAuth();
        }
      });
    } else if (token && session) {
      showRemote();
      afterLogin();
    }
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/remote/sw.js').catch(() => {});
    }
  </script>
</body>
</html>"##
}

fn remote_service_worker_js() -> &'static str {
    r#"self.addEventListener('install', event => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {});"#
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{collections::HashSet, sync::Mutex};

    #[test]
    fn remote_key_whitelist_rejects_unsupported_keys() {
        assert_eq!(remote_keyevent("back"), Some("KEYCODE_BACK"));
        assert_eq!(remote_keyevent("home"), Some("KEYCODE_HOME"));
        assert_eq!(remote_keyevent("recents"), Some("KEYCODE_APP_SWITCH"));
        assert_eq!(remote_keyevent("volume_up"), Some("KEYCODE_VOLUME_UP"));
        assert_eq!(remote_keyevent("volume_down"), Some("KEYCODE_VOLUME_DOWN"));
        assert_eq!(remote_keyevent("power"), Some("KEYCODE_POWER"));
        assert_eq!(remote_keyevent("reboot"), None);
        assert_eq!(remote_keyevent("shell"), None);
    }

    #[test]
    fn remote_text_input_escapes_shell_sensitive_characters() {
        assert_eq!(
            escape_remote_input_text("Hello world & QA"),
            "Hello%sworld%s\\&%sQA"
        );
        assert_eq!(escape_remote_input_text("a'b\"c"), "a\\'b\\\"c");
    }

    #[test]
    fn remote_session_accepts_pin_once_and_requires_token() {
        let mut session = RemoteAuthSession::new("123456".to_string(), "token-a".to_string());

        assert_eq!(session.exchange_pin("000000"), None);
        assert_eq!(session.exchange_pin("123456"), Some("token-a".to_string()));
        assert_eq!(session.exchange_pin("123456"), None);
        assert!(session.matches_token("token-a"));
        assert!(!session.matches_token("token-b"));
    }

    #[test]
    fn remote_urls_prefer_lan_address_before_localhost() {
        assert_eq!(
            build_remote_control_urls(vec!["192.168.110.8".to_string()], 3210),
            vec![
                "http://192.168.110.8:3210/remote".to_string(),
                "http://127.0.0.1:3210/remote".to_string()
            ]
        );
        assert_eq!(
            build_remote_control_urls(Vec::new(), 3210),
            vec!["http://127.0.0.1:3210/remote".to_string()]
        );
    }

    #[test]
    fn tailscale_addresses_are_detected_and_prioritized() {
        let addresses = build_remote_addresses(
            vec![
                "127.0.0.1".to_string(),
                "192.168.110.8".to_string(),
                "100.114.61.12".to_string(),
            ],
            Some("kais-mac-mini.tail254df0.ts.net".to_string()),
            3210,
        );

        assert_eq!(addresses[0].kind, RemoteAddressKind::Tailscale);
        assert_eq!(addresses[0].host, "100.114.61.12");
        assert_eq!(addresses[1].kind, RemoteAddressKind::Tailscale);
        assert_eq!(addresses[1].host, "kais-mac-mini.tail254df0.ts.net");
        assert_eq!(addresses[2].kind, RemoteAddressKind::Lan);
        assert_eq!(addresses[3].kind, RemoteAddressKind::Localhost);
    }

    #[test]
    fn invite_links_are_single_use_and_expire() {
        let mut invite =
            RemoteInvite::new("invite-1".to_string(), RemoteRole::Operator, 1_000, 2_000);

        let session = invite.claim("phone".to_string(), 1_500).unwrap();

        assert_eq!(session.role, RemoteRole::Operator);
        assert!(invite.claim("second".to_string(), 1_600).is_none());

        let mut expired =
            RemoteInvite::new("invite-2".to_string(), RemoteRole::Viewer, 1_000, 2_000);
        assert!(expired.claim("late".to_string(), 3_100).is_none());
    }

    #[test]
    fn role_invites_replenish_and_links_include_qr() {
        let mut runtime = crate::state::RemoteControlRuntime::default();
        ensure_role_invites(&mut runtime, 1_000);

        assert_eq!(runtime.invites.len(), 3);
        let mut links = remote_invite_links(
            &[remote_address(
                RemoteAddressKind::Tailscale,
                "100.114.61.12",
                3210,
            )],
            &runtime.invites,
            3210,
        );
        assert_eq!(
            links.iter().map(|link| link.role).collect::<Vec<_>>(),
            vec![RemoteRole::Viewer, RemoteRole::Operator, RemoteRole::Admin]
        );
        assert!(links.iter().all(|link| link.qr_svg.is_some()));

        let operator_token = runtime
            .invites
            .iter()
            .find(|(_, invite)| invite.role == RemoteRole::Operator)
            .map(|(token, _)| token.clone())
            .unwrap();
        runtime.invites.get_mut(&operator_token).unwrap().used = true;
        ensure_role_invites(&mut runtime, 1_100);
        links = remote_invite_links(&[], &runtime.invites, 3210);
        assert_eq!(links.len(), 3);
        assert!(links.iter().any(|link| link.role == RemoteRole::Operator));
        assert!(!runtime.invites.contains_key(&operator_token));
    }

    #[test]
    fn trusted_token_is_hashed_and_claims_role_session() {
        let mut store = RemoteTrustStore::default();
        let info = register_trusted_device_in_store(
            &mut store,
            RemoteRole::Operator,
            "phone".to_string(),
            "raw-secret",
            1_000,
        );

        assert_eq!(info.role, RemoteRole::Operator);
        assert_eq!(store.devices.len(), 1);
        assert_ne!(store.devices[0].token_hash, "raw-secret");
        assert_eq!(
            store.devices[0].token_hash,
            hash_trusted_token("raw-secret")
        );
        let serialized = serde_json::to_string(&store).unwrap();
        assert!(serialized.contains("token_hash"));
        assert!(!serialized.contains("raw-secret"));

        let session = claim_trusted_device_in_store(
            &mut store,
            "raw-secret",
            "phone renamed".to_string(),
            1_500,
            "session-token".to_string(),
        )
        .unwrap();

        assert_eq!(session.role, RemoteRole::Operator);
        assert_eq!(session.client_name, "phone renamed");
        assert_eq!(store.devices[0].last_seen_ms, 1_500);
        assert!(claim_trusted_device_in_store(
            &mut store,
            "wrong-secret",
            "phone".to_string(),
            1_600,
            "session-token-2".to_string(),
        )
        .is_err());
    }

    #[test]
    fn trusted_devices_expire_and_can_be_revoked_in_store() {
        let mut store = RemoteTrustStore::default();
        register_trusted_device_in_store(
            &mut store,
            RemoteRole::Viewer,
            "expired".to_string(),
            "expired-token",
            1_000,
        );
        register_trusted_device_in_store(
            &mut store,
            RemoteRole::Admin,
            "active".to_string(),
            "active-token",
            1_000 + TRUSTED_DEVICE_TTL_MS,
        );

        assert!(cleanup_trusted_devices(
            &mut store,
            1_000 + TRUSTED_DEVICE_TTL_MS + 1
        ));
        assert_eq!(store.devices.len(), 1);
        assert_eq!(store.devices[0].role, RemoteRole::Admin);

        let id = store.devices[0].id.clone();
        store.devices.retain(|device| device.id != id);
        assert!(claim_trusted_device_in_store(
            &mut store,
            "active-token",
            "active".to_string(),
            1_000 + TRUSTED_DEVICE_TTL_MS + 2,
            "session-token".to_string(),
        )
        .is_err());
    }

    #[test]
    fn preferred_remote_port_is_reused_or_falls_back() {
        let preferred = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let preferred_port = preferred.local_addr().unwrap().port();
        drop(preferred);

        let listener = bind_remote_listener_with_preferred(Some(preferred_port)).unwrap();
        assert_eq!(listener.local_addr().unwrap().port(), preferred_port);
        drop(listener);

        let occupied = TcpListener::bind(("0.0.0.0", 0)).unwrap();
        let occupied_port = occupied.local_addr().unwrap().port();
        let fallback = bind_remote_listener_with_preferred(Some(occupied_port)).unwrap();
        assert_ne!(fallback.local_addr().unwrap().port(), occupied_port);
    }

    #[test]
    fn role_permissions_match_v2_policy() {
        assert!(RemoteRole::Viewer.allows(RemoteAction::View));
        assert!(!RemoteRole::Viewer.allows(RemoteAction::Input));
        assert!(RemoteRole::Operator.allows(RemoteAction::Input));
        assert!(!RemoteRole::Operator.allows(RemoteAction::Admin));
        assert!(RemoteRole::Admin.allows(RemoteAction::Admin));
        assert!(RemoteRole::Admin.allows(RemoteAction::InstallApk));
    }

    #[test]
    fn control_owner_allows_one_operator_and_admin_takeover() {
        let mut owner = RemoteControlOwner::default();
        let viewer = RemoteSessionInfo::new("viewer".to_string(), RemoteRole::Viewer, 1_000);
        let operator = RemoteSessionInfo::new("operator".to_string(), RemoteRole::Operator, 1_000);
        let second = RemoteSessionInfo::new("second".to_string(), RemoteRole::Operator, 1_000);
        let admin = RemoteSessionInfo::new("admin".to_string(), RemoteRole::Admin, 1_000);

        assert!(owner.acquire(&viewer, false, 1_100).is_err());
        assert!(owner.acquire(&operator, false, 1_100).is_ok());
        assert!(owner.acquire(&second, false, 1_200).is_err());
        assert!(owner.acquire(&admin, true, 1_300).is_ok());
        assert_eq!(owner.session_id.as_deref(), Some("admin"));
    }

    #[test]
    fn mjpeg_stream_response_has_multipart_content_type() {
        let response = mjpeg_stream_response();

        assert_eq!(response.status, 200);
        assert!(response
            .content_type
            .starts_with("multipart/x-mixed-replace; boundary="));
    }

    #[test]
    fn screenshot_gate_rejects_duplicate_until_previous_capture_finishes() {
        let in_flight = Mutex::new(HashSet::new());
        let first = RemoteScreenshotLease::try_acquire(&in_flight, "R5CT1234ABC").unwrap();

        assert!(RemoteScreenshotLease::try_acquire(&in_flight, "R5CT1234ABC").is_err());
        assert!(RemoteScreenshotLease::try_acquire(&in_flight, "192.168.110.34:42029").is_ok());

        drop(first);

        assert!(RemoteScreenshotLease::try_acquire(&in_flight, "R5CT1234ABC").is_ok());
    }

    #[test]
    fn hls_playlist_rewrite_keeps_segments_token_scoped() {
        let playlist = "\
#EXTM3U
#EXT-X-MAP:URI=\"init.mp4\"
#EXT-X-TARGETDURATION:0
#EXTINF:1.0,
segment_00001.m4s
#EXTINF:1.0,
segment_00002.ts
../secret.ts
";
        let rewritten = rewrite_hls_playlist(playlist, "session-token");

        assert!(rewritten
            .contains("URI=\"/remote/api/video-stream/segment/init.mp4?token=session-token\""));
        assert!(rewritten.contains("#EXT-X-TARGETDURATION:1"));
        assert!(rewritten
            .contains("/remote/api/video-stream/segment/segment_00001.m4s?token=session-token"));
        assert!(rewritten
            .contains("/remote/api/video-stream/segment/segment_00002.ts?token=session-token"));
        assert!(rewritten.contains("../secret.ts"));
        assert!(is_safe_hls_media_name("init.mp4"));
        assert!(is_safe_hls_media_name("segment_00001.m4s"));
        assert!(is_safe_hls_media_name("segment_00002.ts"));
        assert!(!is_safe_hls_media_name("../segment_00001.m4s"));
        assert!(!is_safe_hls_media_name("secret.ts"));
    }

    #[test]
    fn remote_pwa_exposes_snapshot_tuning_controls() {
        let html = remote_app_html();

        assert!(html.contains("id=\"liveIntervalSelect\""));
        assert!(html.contains("id=\"refreshAfterActionToggle\""));
        assert!(html.contains("shotInFlight"));
        assert!(html.contains("id=\"touchpad\""));
        assert!(html.contains("id=\"mouseClickBtn\""));
        assert!(html.contains("HLS stream failed"));
        assert!(html.contains("Starting experimental HLS stream"));
        assert!(html.contains("lastHlsDiagnostics"));
        assert!(html.contains("HLS playlist ready"));
        assert!(html.contains("mjpegStreamUrl"));
        assert!(html.contains("Falling back to MJPEG stream"));
        assert!(html.contains("Falling back to live snapshot"));
        assert!(html.contains("id=\"videoStream\""));
        assert!(html.contains("/remote/api/video-stream/start"));
        assert!(html.contains("/remote/api/stream.mjpeg"));
        assert!(!html.contains("Checking stream"));
        assert!(html.contains("id=\"trustDeviceToggle\""));
        assert!(html.contains("adbRemoteTrustToken"));
        assert!(html.contains("/remote/api/trust/claim"));
        assert!(html.contains("/remote/api/trust/register"));
    }

    #[test]
    fn remote_pwa_defaults_to_webrtc_stream_with_fallbacks() {
        let html = remote_app_html();

        assert!(html.contains("RTCPeerConnection"));
        assert!(html.contains("startWebRtcStream"));
        assert!(html.contains("/remote/api/webrtc/offer"));
        assert!(html.contains("/remote/api/webrtc/stop"));
        assert!(html.contains("/remote/api/webrtc/status"));
        assert!(html.contains("WebRTC active"));
        assert!(html.contains("WebRTC stream unavailable"));
        assert!(html.contains("Falling back to MJPEG stream"));
        assert!(html.contains("Falling back to live snapshot"));
    }

    #[test]
    fn webrtc_status_info_covers_inactive_active_failed_and_occupied() {
        let inactive = RemoteWebRtcStatusInfo::inactive();
        assert!(!inactive.active);
        assert_eq!(inactive.state, "inactive");

        let active = RemoteWebRtcStatusInfo::active(
            "R5CT1234ABC".to_string(),
            "session-1".to_string(),
            "connecting".to_string(),
            1_000,
            None,
        );
        assert!(active.active);
        assert_eq!(active.serial.as_deref(), Some("R5CT1234ABC"));
        assert_eq!(active.session_id.as_deref(), Some("session-1"));
        assert_eq!(active.state, "connecting");

        let failed = RemoteWebRtcStatusInfo::active(
            "R5CT1234ABC".to_string(),
            "session-1".to_string(),
            "failed".to_string(),
            1_000,
            Some("ffmpeg exited".to_string()),
        );
        assert_eq!(failed.last_error.as_deref(), Some("ffmpeg exited"));
        assert!(webrtc_occupied_error("session-1").contains("already active"));
    }

    #[test]
    fn parses_remote_devices_output() {
        let stdout = "\
List of devices attached
R5CT1234ABC device product:p1 model:Large_Display transport_id:1
192.168.110.34:42029 offline product:p2 model:Panel transport_id:2
adb-XYZ._adb-tls-connect._tcp. device product:p3 model:Wireless transport_id:3
";

        let devices = parse_remote_devices_output(stdout);

        assert_eq!(devices.len(), 3);
        assert_eq!(devices[0].serial, "R5CT1234ABC");
        assert_eq!(devices[0].connection_type, "usb");
        assert_eq!(devices[1].state, "offline");
        assert_eq!(devices[1].connection_type, "wireless");
        assert_eq!(devices[2].model, "Wireless");
        assert_eq!(devices[2].connection_type, "wireless");
    }
}

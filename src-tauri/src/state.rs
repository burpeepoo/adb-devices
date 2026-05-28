use std::collections::HashMap;
use std::sync::Mutex;

#[derive(Default)]
pub struct RecordingState {
    pub process: Option<std::process::Child>,
    pub device: Option<String>,
    pub remote_path: Option<String>,
}

pub struct AppState {
    pub adb_server_operation: Mutex<()>,
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

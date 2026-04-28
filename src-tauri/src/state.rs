use std::collections::HashMap;
use std::sync::Mutex;

pub struct AppState {
    pub recording_process: Mutex<Option<std::process::Child>>,
    pub recording_device: Mutex<Option<String>>,
    pub recording_remote_path: Mutex<Option<String>>,
    pub logcat_process: Mutex<Option<std::process::Child>>,
    pub logcat_device: Mutex<Option<String>>,
    pub installing: Mutex<bool>,
    pub device_sn_cache: Mutex<HashMap<String, String>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            recording_process: Mutex::new(None),
            recording_device: Mutex::new(None),
            recording_remote_path: Mutex::new(None),
            logcat_process: Mutex::new(None),
            logcat_device: Mutex::new(None),
            installing: Mutex::new(false),
            device_sn_cache: Mutex::new(HashMap::new()),
        }
    }
}

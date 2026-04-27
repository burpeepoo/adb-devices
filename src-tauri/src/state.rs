use std::sync::Mutex;

pub struct AppState {
    pub recording_process: Mutex<Option<std::process::Child>>,
    pub recording_device: Mutex<Option<String>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            recording_process: Mutex::new(None),
            recording_device: Mutex::new(None),
        }
    }
}

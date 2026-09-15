use crate::operation_log::{self, OperationLogSnapshot};
use tauri::AppHandle;

#[tauri::command(async)]
pub fn get_operation_logs(app: AppHandle, limit: Option<usize>) -> OperationLogSnapshot {
    operation_log::snapshot(&app, limit)
}

#[tauri::command(async)]
pub fn clear_operation_logs(app: AppHandle) -> Result<(), String> {
    operation_log::clear(&app)
}

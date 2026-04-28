use tauri::AppHandle;

use crate::adb::{self, AdbError};

#[tauri::command(async)]
pub fn adb_input_text(
    app: AppHandle,
    text: String,
    device_serial: Option<String>,
) -> Result<String, AdbError> {
    let trimmed = text.trim_end_matches(['\r', '\n']);
    if trimmed.is_empty() {
        return Err(AdbError::CommandFailed("请输入要粘贴的文本".to_string()));
    }
    if trimmed.chars().count() > 2000 {
        return Err(AdbError::CommandFailed("文本长度不能超过 2000".to_string()));
    }

    let escaped = escape_adb_input_text(trimmed);
    let output = adb::run_adb(
        &app,
        &["shell", "input", "text", &escaped],
        device_serial.as_deref(),
    )?;
    adb::ensure_success(&output, "粘贴文本失败")?;
    Ok("已发送到设备当前输入框".to_string())
}

fn escape_adb_input_text(text: &str) -> String {
    let mut escaped = String::new();
    for ch in text.chars() {
        match ch {
            ' ' | '\n' | '\r' | '\t' => escaped.push_str("%s"),
            '\\' | '\'' | '"' | '`' | '$' | '&' | '|' | ';' | '<' | '>' | '(' | ')' | '[' | ']'
            | '{' | '}' | '*' | '?' | '!' | '#' | '~' => {
                escaped.push('\\');
                escaped.push(ch);
            }
            _ => escaped.push(ch),
        }
    }
    escaped
}

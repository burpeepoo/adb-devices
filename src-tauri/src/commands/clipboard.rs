use rust_i18n::t;
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
        return Err(AdbError::CommandFailed(t!("clipboard.empty").into_owned()));
    }
    if trimmed.chars().count() > 2000 {
        return Err(AdbError::CommandFailed(
            t!("clipboard.too_long").into_owned(),
        ));
    }

    let escaped = escape_adb_input_text(trimmed);
    let output = adb::run_adb(
        &app,
        &["shell", "input", "text", &escaped],
        device_serial.as_deref(),
    )?;
    adb::ensure_success(&output, &t!("clipboard.paste_failed"))?;
    Ok(t!("clipboard.pasted").to_string())
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

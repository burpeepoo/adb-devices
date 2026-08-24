use std::io::Read;
use std::process::{Command, Output, Stdio};
use std::time::{Duration, Instant};

use crate::adb::AdbError;
use crate::process;

const CLIPBOARD_HELPER_TIMEOUT: Duration = Duration::from_secs(4);

#[cfg(target_os = "macos")]
pub(crate) fn read_clipboard_file_paths() -> Result<Vec<String>, AdbError> {
    let script = r#"
use framework "AppKit"
use framework "Foundation"
use scripting additions

set outputPaths to current application's NSMutableArray's array()
set pasteboard to current application's NSPasteboard's generalPasteboard()
set fileURLs to pasteboard's readObjectsForClasses:{current application's NSURL} options:(missing value)
repeat with fileURL in fileURLs
  try
    if (fileURL's isFileURL()) as boolean then
      outputPaths's addObject:(fileURL's |path|())
    end if
  end try
end repeat
set jsonData to current application's NSJSONSerialization's dataWithJSONObject:outputPaths options:0 |error|:(missing value)
set jsonText to current application's NSString's alloc()'s initWithData:jsonData encoding:(current application's NSUTF8StringEncoding)
return jsonText as text
"#;

    let mut command = process::hidden_command("/usr/bin/osascript");
    command.arg("-e").arg(script);
    let output = run_clipboard_helper(&mut command, "macOS file clipboard")?;
    parse_clipboard_path_json(&output.stdout)
}

#[cfg(target_os = "windows")]
pub(crate) fn read_clipboard_file_paths() -> Result<Vec<String>, AdbError> {
    let script = r#"
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
try {
  $paths = @([System.Windows.Forms.Clipboard]::GetFileDropList() | ForEach-Object { [string]$_ })
  ConvertTo-Json -InputObject $paths -Compress
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
"#;
    let mut command = process::hidden_command("powershell");
    command.args(["-NoProfile", "-NonInteractive", "-STA", "-Command", script]);
    let output = run_clipboard_helper(&mut command, "Windows file clipboard")?;
    parse_clipboard_path_json(&output.stdout)
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub(crate) fn read_clipboard_file_paths() -> Result<Vec<String>, AdbError> {
    Ok(Vec::new())
}

#[cfg(target_os = "macos")]
pub(crate) fn read_clipboard_text_paths() -> Result<Vec<String>, AdbError> {
    let mut command = process::hidden_command("pbpaste");
    let output = run_clipboard_helper(&mut command, "macOS text clipboard")?;
    Ok(String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(ToOwned::to_owned)
        .collect())
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn read_clipboard_text_paths() -> Result<Vec<String>, AdbError> {
    Ok(Vec::new())
}

/// Normalize a path that came from textual clipboard content.
///
/// Native file clipboard APIs already return filesystem paths, so callers must
/// keep those strings exact. In particular, a real filename containing `%20`
/// is not a percent-encoded space. Only `file://` text is URI-decoded.
pub(crate) fn normalize_clipboard_text_path(path: &str) -> String {
    let trimmed = path.trim().trim_matches(['"', '\'']);
    match trimmed.strip_prefix("file://") {
        Some(file_path) => percent_decode(file_path),
        None => trimmed.to_string(),
    }
}

/// Accept a path passed explicitly by the frontend. Native filesystem paths
/// stay exact, while the legacy `file://` text form remains supported.
pub(crate) fn normalize_explicit_path_input(path: &str) -> String {
    let trimmed = path.trim().trim_matches(['"', '\'']);
    if trimmed.starts_with("file://") {
        normalize_clipboard_text_path(path)
    } else {
        path.to_string()
    }
}

fn run_clipboard_helper(command: &mut Command, context: &str) -> Result<Output, AdbError> {
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command.spawn().map_err(|error| {
        AdbError::CommandFailed(format!("Failed to start {context} helper: {error}"))
    })?;
    let mut stdout = child.stdout.take().ok_or_else(|| {
        AdbError::CommandFailed(format!("Failed to capture {context} helper stdout"))
    })?;
    let mut stderr = child.stderr.take().ok_or_else(|| {
        AdbError::CommandFailed(format!("Failed to capture {context} helper stderr"))
    })?;
    let stdout_reader = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        stdout.read_to_end(&mut bytes).map(|_| bytes)
    });
    let stderr_reader = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        stderr.read_to_end(&mut bytes).map(|_| bytes)
    });
    let started = Instant::now();

    let status = loop {
        if let Some(status) = child.try_wait()? {
            break status;
        }
        if started.elapsed() >= CLIPBOARD_HELPER_TIMEOUT {
            let _ = child.kill();
            let _ = child.wait();
            let _ = stdout_reader.join();
            let _ = stderr_reader.join();
            return Err(AdbError::CommandTimedOut(format!(
                "{context} helper exceeded {} seconds",
                CLIPBOARD_HELPER_TIMEOUT.as_secs()
            )));
        }
        std::thread::sleep(Duration::from_millis(25));
    };

    let stdout = join_clipboard_reader(stdout_reader, context, "stdout")?;
    let stderr = join_clipboard_reader(stderr_reader, context, "stderr")?;
    let output = Output {
        status,
        stdout,
        stderr,
    };
    if output.status.success() {
        Ok(output)
    } else {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(AdbError::CommandFailed(if detail.is_empty() {
            format!("{context} helper failed")
        } else {
            format!("{context} helper failed: {detail}")
        }))
    }
}

fn join_clipboard_reader(
    reader: std::thread::JoinHandle<std::io::Result<Vec<u8>>>,
    context: &str,
    stream: &str,
) -> Result<Vec<u8>, AdbError> {
    reader
        .join()
        .map_err(|_| {
            AdbError::CommandFailed(format!("Failed to collect {context} helper {stream}"))
        })?
        .map_err(AdbError::Io)
}

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut output = Vec::with_capacity(bytes.len());
    let mut index = 0;

    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            let high = bytes[index + 1];
            let low = bytes[index + 2];
            if let (Some(high), Some(low)) = (hex_value(high), hex_value(low)) {
                output.push((high << 4) | low);
                index += 3;
                continue;
            }
        }

        output.push(bytes[index]);
        index += 1;
    }

    String::from_utf8_lossy(&output).to_string()
}

fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

fn parse_clipboard_path_json(bytes: &[u8]) -> Result<Vec<String>, AdbError> {
    serde_json::from_slice::<Vec<String>>(bytes).map_err(|error| {
        AdbError::CommandFailed(format!(
            "Clipboard helper returned invalid path data: {error}"
        ))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_text_paths_without_corrupting_literal_percent_sequences() {
        assert_eq!(
            normalize_clipboard_text_path("\"file:///Users/test/My%20App/app.apk\""),
            "/Users/test/My App/app.apk"
        );
        assert_eq!(
            normalize_clipboard_text_path("'/Users/test/app.apk'"),
            "/Users/test/app.apk"
        );
        assert_eq!(
            normalize_clipboard_text_path("/Users/test/literal%20name.apk"),
            "/Users/test/literal%20name.apk"
        );
    }

    #[test]
    fn explicit_inputs_decode_only_file_uris_and_preserve_real_paths_exactly() {
        assert_eq!(
            normalize_explicit_path_input("file:///Users/test/My%20App/app.apk"),
            "/Users/test/My App/app.apk"
        );
        assert_eq!(
            normalize_explicit_path_input("/Users/test/literal%20name.apk "),
            "/Users/test/literal%20name.apk "
        );
    }

    #[test]
    fn parses_windows_clipboard_paths_without_splitting_spaces_or_unicode() {
        assert_eq!(
            parse_clipboard_path_json(r#"["C:\\Users\\Kai\\My File.txt","D:\\相册"]"#.as_bytes())
                .unwrap(),
            vec!["C:\\Users\\Kai\\My File.txt", "D:\\相册"]
        );
        assert!(parse_clipboard_path_json(b"not-json").is_err());
    }

    #[test]
    fn parses_native_clipboard_paths_without_splitting_newlines() {
        assert_eq!(
            parse_clipboard_path_json("[\"/Users/Kai/line\\nname.txt\"]".as_bytes()).unwrap(),
            vec!["/Users/Kai/line\nname.txt"]
        );
    }
}

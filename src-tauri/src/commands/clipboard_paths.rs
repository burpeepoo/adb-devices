use crate::process;

#[cfg(target_os = "macos")]
pub(crate) fn read_clipboard_file_paths() -> Vec<String> {
    let script = r#"
use framework "AppKit"
use framework "Foundation"
use scripting additions

set output to ""
set pasteboard to current application's NSPasteboard's generalPasteboard()
set fileURLs to pasteboard's readObjectsForClasses:{current application's NSURL} options:(missing value)
repeat with fileURL in fileURLs
  try
    if (fileURL's isFileURL()) as boolean then
      set output to output & ((fileURL's |path|()) as text) & linefeed
    end if
  end try
end repeat
return output
"#;

    let output = process::hidden_command("/usr/bin/osascript")
        .arg("-e")
        .arg(script)
        .output();

    match output {
        Ok(output) if output.status.success() => String::from_utf8_lossy(&output.stdout)
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .map(ToOwned::to_owned)
            .collect(),
        _ => Vec::new(),
    }
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn read_clipboard_file_paths() -> Vec<String> {
    Vec::new()
}

#[cfg(target_os = "macos")]
pub(crate) fn read_clipboard_text_paths() -> Vec<String> {
    let output = process::hidden_command("pbpaste").output();
    match output {
        Ok(output) if output.status.success() => String::from_utf8_lossy(&output.stdout)
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .map(ToOwned::to_owned)
            .collect(),
        _ => Vec::new(),
    }
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn read_clipboard_text_paths() -> Vec<String> {
    Vec::new()
}

pub(crate) fn normalize_clipboard_path(path: &str) -> String {
    let trimmed = path.trim().trim_matches(['"', '\'']);
    let file_path = trimmed.strip_prefix("file://").unwrap_or(trimmed);
    percent_decode(file_path)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_quoted_file_uri_clipboard_paths() {
        assert_eq!(
            normalize_clipboard_path("\"file:///Users/test/My%20App/app.apk\""),
            "/Users/test/My App/app.apk"
        );
        assert_eq!(
            normalize_clipboard_path("'/Users/test/app.apk'"),
            "/Users/test/app.apk"
        );
    }
}

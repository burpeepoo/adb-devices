use std::io::Read;
use std::sync::Mutex;
use tauri::{AppHandle, State};

use crate::adb::{self, AdbError};
use crate::state::AppState;

struct InstallGuard<'a>(&'a Mutex<bool>);

impl Drop for InstallGuard<'_> {
    fn drop(&mut self) {
        if let Ok(mut installing) = self.0.lock() {
            *installing = false;
        }
    }
}

fn acquire_install_lock(lock: &Mutex<bool>) -> Result<InstallGuard<'_>, AdbError> {
    let mut installing = lock
        .lock()
        .map_err(|_| AdbError::CommandFailed("安装状态异常，请重启应用后重试".to_string()))?;
    if *installing {
        return Err(AdbError::CommandFailed(
            "正在安装中，请等待当前安装完成".to_string(),
        ));
    }
    *installing = true;
    drop(installing);
    Ok(InstallGuard(lock))
}

#[tauri::command(async)]
pub fn adb_install(
    app: AppHandle,
    state: State<'_, AppState>,
    apk_path: String,
    force: bool,
    pkg_name: Option<String>,
    device_serial: Option<String>,
) -> Result<String, AdbError> {
    let _guard = acquire_install_lock(&state.installing)?;
    let serial = device_serial.as_deref();

    if force {
        let package_to_uninstall = match pkg_name.as_deref().filter(|pkg| !pkg.trim().is_empty()) {
            Some(pkg) => Some(pkg.to_string()),
            None => extract_apk_package_name(&apk_path).ok(),
        };

        if let Some(pkg) = &package_to_uninstall {
            let uninstall_output = adb::run_adb(&app, &["uninstall", pkg], serial)?;
            let uninstall_stdout = String::from_utf8_lossy(&uninstall_output.stdout);
            if !uninstall_stdout.contains("Success") && !uninstall_stdout.contains("成功") {
                // Uninstall may fail if package not installed, continue anyway
            }
        }
    }

    let mut args = vec!["install"];
    if !force {
        args.push("-r"); // replace existing
    }
    args.push(&apk_path);

    let output = adb::run_adb(&app, &args, serial)?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    if stdout.contains("Success") {
        Ok("安装成功".to_string())
    } else if stdout.contains("INSTALL_FAILED_ALREADY_EXISTS") {
        Err(AdbError::CommandFailed(
            "安装失败: 应用已存在，请勾选强制安装".to_string(),
        ))
    } else {
        let msg = if stdout.trim().is_empty() {
            stderr.trim().to_string()
        } else {
            stdout.trim().to_string()
        };
        Err(AdbError::CommandFailed(format!("安装失败: {}", msg)))
    }
}

#[tauri::command(async)]
pub fn parse_apk_package(apk_path: String) -> Result<String, AdbError> {
    extract_apk_package_name(&apk_path)
}

fn extract_apk_package_name(apk_path: &str) -> Result<String, AdbError> {
    let file = std::fs::File::open(apk_path)?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|e| AdbError::CommandFailed(format!("读取 APK 失败: {}", e)))?;
    let mut manifest = archive
        .by_name("AndroidManifest.xml")
        .map_err(|e| AdbError::CommandFailed(format!("读取 AndroidManifest.xml 失败: {}", e)))?;
    let mut data = Vec::new();
    manifest.read_to_end(&mut data)?;
    parse_binary_manifest_package(&data)
        .ok_or_else(|| AdbError::CommandFailed("无法从 APK 中识别包名".to_string()))
}

fn parse_binary_manifest_package(data: &[u8]) -> Option<String> {
    let mut strings = Vec::new();
    let mut offset = 8usize;

    while offset + 8 <= data.len() {
        let chunk_type = read_u16(data, offset)?;
        let header_size = read_u16(data, offset + 2)? as usize;
        let chunk_size = read_u32(data, offset + 4)? as usize;
        if chunk_size == 0 || offset + chunk_size > data.len() {
            break;
        }

        if chunk_type == 0x0001 {
            strings = parse_string_pool(data, offset)?;
        } else if chunk_type == 0x0102 {
            if let Some(package_name) = parse_start_element_package(data, offset, &strings) {
                return Some(package_name);
            }
        }

        offset += chunk_size.max(header_size);
    }

    None
}

fn parse_start_element_package(data: &[u8], offset: usize, strings: &[String]) -> Option<String> {
    let name_idx = read_u32(data, offset + 20)? as usize;
    if strings.get(name_idx)? != "manifest" {
        return None;
    }

    let attr_start = read_u16(data, offset + 24)? as usize;
    let attr_size = read_u16(data, offset + 26)? as usize;
    let attr_count = read_u16(data, offset + 28)? as usize;
    let attrs_offset = offset + attr_start;

    for index in 0..attr_count {
        let attr_offset = attrs_offset + index * attr_size;
        if attr_offset + 20 > data.len() {
            continue;
        }

        let attr_name_idx = read_u32(data, attr_offset + 4)? as usize;
        if strings.get(attr_name_idx)? != "package" {
            continue;
        }

        let raw_value_idx = read_u32(data, attr_offset + 8)?;
        if raw_value_idx != u32::MAX {
            return strings.get(raw_value_idx as usize).cloned();
        }

        let data_idx = read_u32(data, attr_offset + 16)? as usize;
        return strings.get(data_idx).cloned();
    }

    None
}

fn parse_string_pool(data: &[u8], offset: usize) -> Option<Vec<String>> {
    let header_size = read_u16(data, offset + 2)? as usize;
    let string_count = read_u32(data, offset + 8)? as usize;
    let flags = read_u32(data, offset + 16)?;
    let strings_start = read_u32(data, offset + 20)? as usize;
    let is_utf8 = flags & 0x0000_0100 != 0;
    let offsets_start = offset + header_size;
    let strings_base = offset + strings_start;

    let mut strings = Vec::with_capacity(string_count);
    for index in 0..string_count {
        let string_offset = read_u32(data, offsets_start + index * 4)? as usize;
        let absolute = strings_base + string_offset;
        let value = if is_utf8 {
            read_utf8_string(data, absolute)?
        } else {
            read_utf16_string(data, absolute)?
        };
        strings.push(value);
    }

    Some(strings)
}

fn read_utf8_string(data: &[u8], offset: usize) -> Option<String> {
    let (_, after_utf16_len) = read_length8(data, offset)?;
    let (byte_len, string_offset) = read_length8(data, after_utf16_len)?;
    let end = string_offset + byte_len;
    if end > data.len() {
        return None;
    }
    String::from_utf8(data[string_offset..end].to_vec()).ok()
}

fn read_utf16_string(data: &[u8], offset: usize) -> Option<String> {
    let (char_len, string_offset) = read_length16(data, offset)?;
    let byte_len = char_len * 2;
    if string_offset + byte_len > data.len() {
        return None;
    }
    let chars = data[string_offset..string_offset + byte_len]
        .chunks_exact(2)
        .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
        .collect::<Vec<_>>();
    String::from_utf16(&chars).ok()
}

fn read_length8(data: &[u8], offset: usize) -> Option<(usize, usize)> {
    let first = *data.get(offset)? as usize;
    if first & 0x80 == 0 {
        Some((first, offset + 1))
    } else {
        let second = *data.get(offset + 1)? as usize;
        Some((((first & 0x7f) << 8) | second, offset + 2))
    }
}

fn read_length16(data: &[u8], offset: usize) -> Option<(usize, usize)> {
    let first = read_u16(data, offset)? as usize;
    if first & 0x8000 == 0 {
        Some((first, offset + 2))
    } else {
        let second = read_u16(data, offset + 2)? as usize;
        Some((((first & 0x7fff) << 16) | second, offset + 4))
    }
}

fn read_u16(data: &[u8], offset: usize) -> Option<u16> {
    let bytes = data.get(offset..offset + 2)?;
    Some(u16::from_le_bytes([bytes[0], bytes[1]]))
}

fn read_u32(data: &[u8], offset: usize) -> Option<u32> {
    let bytes = data.get(offset..offset + 4)?;
    Some(u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
}

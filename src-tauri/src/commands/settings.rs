use rust_i18n::t;
use std::io::Write;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager};

use crate::adb::{self, AdbError};

#[tauri::command]
pub async fn select_directory(app: AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let dir = app
        .dialog()
        .file()
        .set_title(t!("settings.select_dir").to_string())
        .blocking_pick_folder();
    Ok(dir.map(|p| p.to_string()))
}

#[tauri::command(async)]
pub fn get_default_save_dir(app: AppHandle) -> Result<String, AdbError> {
    let pictures = app
        .path()
        .picture_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let adb_manager_dir = pictures.join("ADB_Manager");
    std::fs::create_dir_all(&adb_manager_dir)?;
    Ok(adb_manager_dir.to_string_lossy().to_string())
}

#[tauri::command(async)]
pub fn check_adb_available(app: AppHandle) -> Result<bool, AdbError> {
    Ok(adb::check_adb_available(&app))
}

#[tauri::command]
pub async fn install_adb(app: AppHandle) -> Result<String, AdbError> {
    emit_install_progress(&app, &t!("settings.preparing_install"));

    #[cfg(target_os = "macos")]
    {
        let home = std::env::var("HOME")
            .map_err(|_| AdbError::CommandFailed(t!("settings.home_not_found").into_owned()))?;
        let sdk_dir = PathBuf::from(&home)
            .join("Library")
            .join("Android")
            .join("sdk");
        let platform_tools_dir = sdk_dir.join("platform-tools");

        std::fs::create_dir_all(&sdk_dir)?;

        let url = "https://dl.google.com/android/repository/platform-tools-latest-darwin.zip";
        let zip_path = sdk_dir.join("platform-tools.zip");

        download_with_progress(&app, url, &zip_path).await?;
        emit_install_progress(&app, &t!("settings.extract_start"));

        let file = std::fs::File::open(&zip_path)?;
        let mut archive = zip::ZipArchive::new(file).map_err(|e| {
            AdbError::CommandFailed(t!("settings.extract_failed", "message" => e).into_owned())
        })?;

        if platform_tools_dir.exists() {
            let _ = std::fs::remove_dir_all(&platform_tools_dir);
        }

        archive.extract(&sdk_dir).map_err(|e| {
            AdbError::CommandFailed(t!("settings.extract_failed", "message" => e).into_owned())
        })?;
        emit_install_progress(&app, &t!("settings.extract_done"));

        let adb_binary = platform_tools_dir.join("adb");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = std::fs::metadata(&adb_binary)?.permissions();
            perms.set_mode(0o755);
            std::fs::set_permissions(&adb_binary, perms)?;
        }

        let _ = std::fs::remove_file(&zip_path);

        if adb_binary.exists() {
            emit_install_progress(&app, &t!("settings.install_success"));
            Ok(t!("settings.install_success").to_string())
        } else {
            Err(AdbError::CommandFailed(
                t!("settings.adb_not_found").into_owned(),
            ))
        }
    }

    #[cfg(target_os = "windows")]
    {
        let local_app_data = std::env::var("LOCALAPPDATA")
            .or_else(|_| {
                std::env::var("USERPROFILE").map(|home| format!("{}\\AppData\\Local", home))
            })
            .map_err(|_| {
                AdbError::CommandFailed(t!("settings.local_app_dir_not_found").into_owned())
            })?;
        let sdk_dir = PathBuf::from(local_app_data).join("Android").join("sdk");
        let platform_tools_dir = sdk_dir.join("platform-tools");

        std::fs::create_dir_all(&sdk_dir)?;

        let url = "https://dl.google.com/android/repository/platform-tools-latest-windows.zip";
        let zip_path = sdk_dir.join("platform-tools.zip");

        download_with_progress(&app, url, &zip_path).await?;
        emit_install_progress(&app, &t!("settings.extract_start"));

        let file = std::fs::File::open(&zip_path)?;
        let mut archive = zip::ZipArchive::new(file).map_err(|e| {
            AdbError::CommandFailed(t!("settings.extract_failed", "message" => e).into_owned())
        })?;

        if platform_tools_dir.exists() {
            let _ = std::fs::remove_dir_all(&platform_tools_dir);
        }

        archive.extract(&sdk_dir).map_err(|e| {
            AdbError::CommandFailed(t!("settings.extract_failed", "message" => e).into_owned())
        })?;
        emit_install_progress(&app, &t!("settings.extract_done_win"));

        let _ = std::fs::remove_file(&zip_path);

        let adb_binary = platform_tools_dir.join("adb.exe");
        if adb_binary.exists() {
            emit_install_progress(&app, &t!("settings.install_success"));
            Ok(t!("settings.install_success").to_string())
        } else {
            Err(AdbError::CommandFailed(
                t!("settings.adb_exe_not_found").into_owned(),
            ))
        }
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        Err(AdbError::CommandFailed(
            t!("settings.unsupported_os").into_owned(),
        ))
    }
}

async fn download_with_progress(
    app: &AppHandle,
    url: &str,
    zip_path: &PathBuf,
) -> Result<(), AdbError> {
    emit_install_progress(app, &t!("settings.connecting_server"));
    let client = reqwest::Client::new();
    let mut response = client.get(url).send().await.map_err(|e| {
        AdbError::CommandFailed(t!("settings.download_failed", "message" => e).into_owned())
    })?;
    let total = response.content_length().unwrap_or(0);
    let mut downloaded = 0u64;
    let mut last_percent = 0u64;
    let mut file = std::fs::File::create(zip_path)?;

    while let Some(chunk) = response.chunk().await.map_err(|e| {
        AdbError::CommandFailed(t!("settings.download_failed", "message" => e).into_owned())
    })? {
        file.write_all(&chunk)?;
        downloaded += chunk.len() as u64;
        if total > 0 {
            let percent = downloaded.saturating_mul(100) / total;
            if percent >= last_percent + 5 || percent == 100 {
                last_percent = percent;
                emit_install_progress(app, &t!("settings.downloading_percent", percent = percent));
            }
        } else {
            emit_install_progress(
                app,
                &t!("settings.downloading_size", "size" => downloaded / 1024),
            );
        }
    }

    file.flush()?;
    Ok(())
}

fn emit_install_progress(app: &AppHandle, message: &str) {
    let _ = app.emit("adb-install-progress", message.to_string());
}

#[tauri::command(async)]
pub fn reveal_path(path: String) -> Result<(), AdbError> {
    let input_path = PathBuf::from(&path);
    let folder = if input_path.is_dir() {
        input_path.clone()
    } else {
        input_path
            .parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| PathBuf::from("."))
    };

    #[cfg(target_os = "macos")]
    let mut command = {
        let mut cmd = std::process::Command::new("open");
        if input_path.is_file() {
            cmd.arg("-R").arg(&input_path);
        } else {
            cmd.arg(&folder);
        }
        cmd
    };

    #[cfg(target_os = "windows")]
    let mut command = {
        let mut cmd = std::process::Command::new("explorer");
        if input_path.is_file() {
            cmd.arg(format!("/select,{}", input_path.to_string_lossy()));
        } else {
            cmd.arg(&folder);
        }
        cmd
    };

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let mut command = {
        let mut cmd = std::process::Command::new("xdg-open");
        cmd.arg(&folder);
        cmd
    };

    let output = command.output()?;
    adb::ensure_success(&output, &t!("settings.open_folder_failed"))
}

#[tauri::command(async)]
pub fn open_file(path: String) -> Result<(), AdbError> {
    let file_path = PathBuf::from(&path);
    if !file_path.exists() {
        return Err(AdbError::CommandFailed(
            t!("settings.file_not_found", "path" => path).into_owned(),
        ));
    }

    #[cfg(target_os = "macos")]
    let mut command = {
        let mut cmd = std::process::Command::new("open");
        cmd.arg(&file_path);
        cmd
    };

    #[cfg(target_os = "windows")]
    let mut command = {
        let mut cmd = std::process::Command::new("cmd");
        cmd.args(["/c", "start", "", &file_path.to_string_lossy()]);
        cmd
    };

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let mut command = {
        let mut cmd = std::process::Command::new("xdg-open");
        cmd.arg(&file_path);
        cmd
    };

    let output = command.output()?;
    adb::ensure_success(&output, &t!("settings.open_file_failed"))
}

#[tauri::command(async)]
pub fn open_external_url(url: String) -> Result<(), AdbError> {
    let allowed = ["https://brew.sh/", "https://github.com/Genymobile/scrcpy"];
    if !allowed.contains(&url.as_str()) {
        return Err(AdbError::CommandFailed(
            t!("settings.url_not_allowed").into_owned(),
        ));
    }

    #[cfg(target_os = "macos")]
    let mut command = {
        let mut cmd = std::process::Command::new("open");
        cmd.arg(&url);
        cmd
    };

    #[cfg(target_os = "windows")]
    let mut command = {
        let mut cmd = std::process::Command::new("rundll32");
        cmd.arg("url.dll,FileProtocolHandler").arg(&url);
        cmd
    };

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let mut command = {
        let mut cmd = std::process::Command::new("xdg-open");
        cmd.arg(&url);
        cmd
    };

    let output = command.output()?;
    adb::ensure_success(&output, &t!("settings.open_url_failed"))
}

#[tauri::command(async)]
pub fn set_locale(locale: String) -> Result<(), String> {
    rust_i18n::set_locale(&locale);
    Ok(())
}

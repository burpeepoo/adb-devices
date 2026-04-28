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
        .set_title("选择保存目录")
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
    emit_install_progress(&app, "准备安装 Android Platform Tools");

    #[cfg(target_os = "macos")]
    {
        let home = std::env::var("HOME")
            .map_err(|_| AdbError::CommandFailed("无法获取HOME目录".to_string()))?;
        let sdk_dir = PathBuf::from(&home)
            .join("Library")
            .join("Android")
            .join("sdk");
        let platform_tools_dir = sdk_dir.join("platform-tools");

        std::fs::create_dir_all(&sdk_dir)?;

        let url = "https://dl.google.com/android/repository/platform-tools-latest-darwin.zip";
        let zip_path = sdk_dir.join("platform-tools.zip");

        download_with_progress(&app, url, &zip_path).await?;
        emit_install_progress(&app, "下载完成，正在解压");

        let file = std::fs::File::open(&zip_path)?;
        let mut archive = zip::ZipArchive::new(file)
            .map_err(|e| AdbError::CommandFailed(format!("解压失败: {}", e)))?;

        if platform_tools_dir.exists() {
            let _ = std::fs::remove_dir_all(&platform_tools_dir);
        }

        archive
            .extract(&sdk_dir)
            .map_err(|e| AdbError::CommandFailed(format!("解压失败: {}", e)))?;
        emit_install_progress(&app, "解压完成，正在设置执行权限");

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
            emit_install_progress(&app, "ADB 安装成功");
            Ok("ADB 安装成功！".to_string())
        } else {
            Err(AdbError::CommandFailed("安装后未找到 adb".to_string()))
        }
    }

    #[cfg(target_os = "windows")]
    {
        let local_app_data = std::env::var("LOCALAPPDATA")
            .or_else(|_| {
                std::env::var("USERPROFILE").map(|home| format!("{}\\AppData\\Local", home))
            })
            .map_err(|_| AdbError::CommandFailed("无法获取用户本地应用目录".to_string()))?;
        let sdk_dir = PathBuf::from(local_app_data).join("Android").join("sdk");
        let platform_tools_dir = sdk_dir.join("platform-tools");

        std::fs::create_dir_all(&sdk_dir)?;

        let url = "https://dl.google.com/android/repository/platform-tools-latest-windows.zip";
        let zip_path = sdk_dir.join("platform-tools.zip");

        download_with_progress(&app, url, &zip_path).await?;
        emit_install_progress(&app, "下载完成，正在解压");

        let file = std::fs::File::open(&zip_path)?;
        let mut archive = zip::ZipArchive::new(file)
            .map_err(|e| AdbError::CommandFailed(format!("解压失败: {}", e)))?;

        if platform_tools_dir.exists() {
            let _ = std::fs::remove_dir_all(&platform_tools_dir);
        }

        archive
            .extract(&sdk_dir)
            .map_err(|e| AdbError::CommandFailed(format!("解压失败: {}", e)))?;
        emit_install_progress(&app, "解压完成，正在检查 adb.exe");

        let _ = std::fs::remove_file(&zip_path);

        let adb_binary = platform_tools_dir.join("adb.exe");
        if adb_binary.exists() {
            emit_install_progress(&app, "ADB 安装成功");
            Ok("ADB 安装成功！".to_string())
        } else {
            Err(AdbError::CommandFailed("安装后未找到 adb.exe".to_string()))
        }
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        Err(AdbError::CommandFailed("不支持的操作系统".to_string()))
    }
}

async fn download_with_progress(
    app: &AppHandle,
    url: &str,
    zip_path: &PathBuf,
) -> Result<(), AdbError> {
    emit_install_progress(app, "正在连接下载服务器");
    let client = reqwest::Client::new();
    let mut response = client
        .get(url)
        .send()
        .await
        .map_err(|e| AdbError::CommandFailed(format!("下载失败: {}", e)))?;
    let total = response.content_length().unwrap_or(0);
    let mut downloaded = 0u64;
    let mut last_percent = 0u64;
    let mut file = std::fs::File::create(zip_path)?;

    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| AdbError::CommandFailed(format!("下载失败: {}", e)))?
    {
        file.write_all(&chunk)?;
        downloaded += chunk.len() as u64;
        if total > 0 {
            let percent = downloaded.saturating_mul(100) / total;
            if percent >= last_percent + 5 || percent == 100 {
                last_percent = percent;
                emit_install_progress(
                    app,
                    &format!("正在下载 Android Platform Tools... {}%", percent),
                );
            }
        } else {
            emit_install_progress(
                app,
                &format!(
                    "正在下载 Android Platform Tools... {} KB",
                    downloaded / 1024
                ),
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
    adb::ensure_success(&output, "打开文件夹失败")
}

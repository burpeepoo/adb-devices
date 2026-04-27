use std::path::PathBuf;
use tauri::{AppHandle, Manager};

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

#[tauri::command]
pub fn get_default_save_dir(app: AppHandle) -> Result<String, AdbError> {
    let pictures = app
        .path()
        .picture_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let adb_manager_dir = pictures.join("ADB_Manager");
    std::fs::create_dir_all(&adb_manager_dir)?;
    Ok(adb_manager_dir.to_string_lossy().to_string())
}

#[tauri::command]
pub fn check_adb_available(app: AppHandle) -> Result<bool, AdbError> {
    Ok(adb::check_adb_available(&app))
}

#[tauri::command]
pub async fn install_adb() -> Result<String, AdbError> {
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

        let client = reqwest::Client::new();
        let response = client.get(url).send().await.map_err(|e| {
            AdbError::CommandFailed(format!("下载失败: {}", e))
        })?;
        let bytes = response.bytes().await.map_err(|e| {
            AdbError::CommandFailed(format!("下载失败: {}", e))
        })?;
        std::fs::write(&zip_path, &bytes)?;

        let file = std::fs::File::open(&zip_path)?;
        let mut archive = zip::ZipArchive::new(file)
            .map_err(|e| AdbError::CommandFailed(format!("解压失败: {}", e)))?;

        if platform_tools_dir.exists() {
            let _ = std::fs::remove_dir_all(&platform_tools_dir);
        }

        archive.extract(&sdk_dir)
            .map_err(|e| AdbError::CommandFailed(format!("解压失败: {}", e)))?;

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
            Ok("ADB 安装成功！".to_string())
        } else {
            Err(AdbError::CommandFailed("安装后未找到 adb".to_string()))
        }
    }

    #[cfg(target_os = "windows")]
    {
        let local_app_data = std::env::var("LOCALAPPDATA")
            .or_else(|_| std::env::var("USERPROFILE").map(|home| format!("{}\\AppData\\Local", home)))
            .map_err(|_| AdbError::CommandFailed("无法获取用户本地应用目录".to_string()))?;
        let sdk_dir = PathBuf::from(local_app_data).join("Android").join("sdk");
        let platform_tools_dir = sdk_dir.join("platform-tools");

        std::fs::create_dir_all(&sdk_dir)?;

        let url = "https://dl.google.com/android/repository/platform-tools-latest-windows.zip";
        let zip_path = sdk_dir.join("platform-tools.zip");

        let client = reqwest::Client::new();
        let response = client.get(url).send().await.map_err(|e| {
            AdbError::CommandFailed(format!("下载失败: {}", e))
        })?;
        let bytes = response.bytes().await.map_err(|e| {
            AdbError::CommandFailed(format!("下载失败: {}", e))
        })?;
        std::fs::write(&zip_path, &bytes)?;

        let file = std::fs::File::open(&zip_path)?;
        let mut archive = zip::ZipArchive::new(file)
            .map_err(|e| AdbError::CommandFailed(format!("解压失败: {}", e)))?;

        if platform_tools_dir.exists() {
            let _ = std::fs::remove_dir_all(&platform_tools_dir);
        }

        archive.extract(&sdk_dir)
            .map_err(|e| AdbError::CommandFailed(format!("解压失败: {}", e)))?;

        let _ = std::fs::remove_file(&zip_path);

        let adb_binary = platform_tools_dir.join("adb.exe");
        if adb_binary.exists() {
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

#[tauri::command]
pub fn reveal_path(path: String) -> Result<(), AdbError> {
    let input_path = PathBuf::from(&path);
    let folder = if input_path.is_dir() {
        input_path
    } else {
        input_path
            .parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| PathBuf::from("."))
    };

    #[cfg(target_os = "macos")]
    let mut command = {
        let mut cmd = std::process::Command::new("open");
        cmd.arg(&folder);
        cmd
    };

    #[cfg(target_os = "windows")]
    let mut command = {
        let mut cmd = std::process::Command::new("explorer");
        cmd.arg(&folder);
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

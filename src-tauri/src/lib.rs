mod adb;
mod commands;
mod state;

use state::AppState;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::device::adb_devices,
            commands::device::adb_pair,
            commands::device::adb_connect,
            commands::device::adb_disconnect,
            commands::install::adb_install,
            commands::screenshot::adb_screenshot,
            commands::record::adb_start_recording,
            commands::record::adb_stop_recording,
            commands::package::adb_list_packages,
            commands::package::adb_package_info,
            commands::settings::select_directory,
            commands::settings::get_default_save_dir,
            commands::settings::check_adb_available,
            commands::settings::install_adb,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

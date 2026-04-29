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
            commands::device::adb_mdns_discover,
            commands::device::adb_auto_connect,
            commands::device::adb_mdns_auto_connect,
            commands::device::adb_pair,
            commands::device::adb_connect,
            commands::device::adb_disconnect,
            commands::install::adb_install,
            commands::install::parse_apk_package,
            commands::clipboard::adb_input_text,
            commands::logcat::adb_read_logcat,
            commands::logcat::adb_start_logcat,
            commands::logcat::adb_stop_logcat,
            commands::logcat::export_text_file,
            commands::screenshot::adb_screenshot,
            commands::record::adb_start_recording,
            commands::record::adb_stop_recording,
            commands::mirror::check_scrcpy_available,
            commands::mirror::get_screen_mirror_state,
            commands::mirror::install_scrcpy,
            commands::mirror::send_navigation_key,
            commands::mirror::start_screen_mirror,
            commands::mirror::stop_screen_mirror,
            commands::package::adb_list_packages,
            commands::package::adb_package_info,
            commands::package::adb_list_package_details,
            commands::settings::select_directory,
            commands::settings::get_default_save_dir,
            commands::settings::check_adb_available,
            commands::settings::install_adb,
            commands::settings::reveal_path,
            commands::settings::open_external_url,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

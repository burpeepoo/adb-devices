mod adb;
mod commands;
mod state;

use state::AppState;
use tauri::Emitter;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

rust_i18n::i18n!("locales", fallback = "en");

const GLOBAL_SCREENSHOT_SHORTCUT_EVENT: &str = "global-screenshot-shortcut";

fn screenshot_shortcut() -> Shortcut {
    Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::Digit0)
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            let shortcut = screenshot_shortcut();
            if let Err(error) =
                app.global_shortcut()
                    .on_shortcut(shortcut, |app, _shortcut, event| {
                        if event.state == ShortcutState::Pressed {
                            let _ = app.emit(GLOBAL_SCREENSHOT_SHORTCUT_EVENT, ());
                        }
                    })
            {
                eprintln!("failed to register global screenshot shortcut: {error}");
            }
            Ok(())
        })
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::device::adb_devices,
            commands::device::adb_restart_server,
            commands::device::get_local_ipv4_addresses,
            commands::device::adb_mdns_discover,
            commands::device::adb_auto_connect,
            commands::device::adb_mdns_auto_connect,
            commands::device::adb_pair,
            commands::device::adb_connect,
            commands::device::adb_disconnect,
            commands::install::adb_install,
            commands::install::parse_apk_package,
            commands::install::read_clipboard_apk_paths,
            commands::install::resolve_apk_paths,
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
            commands::package::adb_export_package_apk,
            commands::settings::select_directory,
            commands::settings::get_default_save_dir,
            commands::settings::check_adb_available,
            commands::settings::install_adb,
            commands::settings::reveal_path,
            commands::settings::open_file,
            commands::settings::open_external_url,
            commands::settings::set_locale,
            commands::workbench::adb_workbench_execute,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

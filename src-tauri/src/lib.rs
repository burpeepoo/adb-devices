mod adb;
mod commands;
mod process;
mod state;

use state::AppState;
use tauri::Emitter;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

rust_i18n::i18n!("locales", fallback = "en");

const GLOBAL_SCREENSHOT_SHORTCUT_EVENT: &str = "global-screenshot-shortcut";
const GLOBAL_RECORD_SHORTCUT_EVENT: &str = "global-record-shortcut";

fn screenshot_shortcut() -> Shortcut {
    Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::Digit0)
}

fn record_shortcut() -> Shortcut {
    Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::Minus)
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
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

            let shortcut = record_shortcut();
            if let Err(error) =
                app.global_shortcut()
                    .on_shortcut(shortcut, |app, _shortcut, event| {
                        if event.state == ShortcutState::Pressed {
                            let _ = app.emit(GLOBAL_RECORD_SHORTCUT_EVENT, ());
                        }
                    })
            {
                eprintln!("failed to register global recording shortcut: {error}");
            }
            Ok(())
        })
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::device::adb_devices,
            commands::device::adb_device_summary,
            commands::device::adb_get_authorization_timeout_disabled,
            commands::device::adb_set_authorization_timeout_disabled,
            commands::device::adb_restart_server,
            commands::device::adb_restart_server_preserving_pairing,
            commands::device::adb_repair_wireless_pairing,
            commands::device::adb_reset_host_identity,
            commands::device::get_local_ipv4_addresses,
            commands::device::tcp_probe_endpoint,
            commands::device::adb_mdns_discover,
            commands::device::adb_auto_connect,
            commands::device::adb_mdns_auto_connect,
            commands::device::adb_pair,
            commands::device::adb_restart_and_retry_pair,
            commands::device::adb_connect,
            commands::device::adb_reconnect_endpoint,
            commands::device::adb_disconnect,
            commands::display_calibration::adb_display_calibration_snapshot,
            commands::display_calibration::adb_display_calibration_diff,
            commands::display_calibration::adb_display_calibration_read_target,
            commands::display_calibration::adb_display_calibration_apply,
            commands::display_calibration::adb_display_calibration_build_export,
            commands::display_calibration::adb_display_calibration_enable_root,
            commands::display_calibration::adb_display_calibration_open_test_pattern,
            commands::install::adb_install,
            commands::install::parse_apk_package,
            commands::install::read_clipboard_apk_paths,
            commands::install::resolve_apk_paths,
            commands::agent::adb_agent_status,
            commands::agent::adb_agent_install,
            commands::agent::adb_agent_start,
            commands::agent::adb_agent_connect,
            commands::agent::adb_agent_stop,
            commands::agent::adb_agent_sample,
            commands::agent_attachment::read_agent_attachment_files,
            commands::agent_attachment::read_clipboard_agent_attachment_files,
            commands::agent_attachment::read_clipboard_local_paths,
            commands::agent_cli::agent_cli_analyze,
            commands::agent_cli::agent_cli_probe,
            commands::agent_cli::agent_runtime_discover,
            commands::agent_reference::agent_fetch_feishu_reference,
            commands::agent_reference::agent_get_figma_mcp_status,
            commands::agent_reference::agent_start_figma_mcp_login,
            commands::ui_automation::adb_ui_snapshot,
            commands::ui_automation::adb_ui_tap,
            commands::ui_automation::adb_ui_swipe,
            commands::ui_automation::adb_ui_press_back,
            commands::evidence::export_evidence_package,
            commands::file_manager::adb_file_capabilities,
            commands::file_manager::adb_file_cancel_transfer,
            commands::file_manager::adb_file_list,
            commands::file_manager::adb_file_pull,
            commands::file_manager::adb_file_push,
            commands::image_cast::read_image_preview_data_url,
            commands::image_cast::adb_open_reference_image,
            commands::image_cast::adb_push_reference_image,
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
            commands::mirror::adb_launch_app,
            commands::mirror::adb_load_launchable_app_icon,
            commands::mirror::adb_list_launchable_apps,
            commands::mirror::send_navigation_key,
            commands::mirror::start_screen_mirror,
            commands::mirror::stop_screen_mirror,
            commands::remote::remote_control_status,
            commands::remote::remote_control_start,
            commands::remote::remote_control_stop,
            commands::remote::remote_control_trusted_devices,
            commands::remote::remote_control_revoke_trusted_device,
            commands::remote::remote_control_revoke_all_trusted_devices,
            commands::package::adb_list_packages,
            commands::package::adb_package_info,
            commands::package::adb_list_package_details,
            commands::package::adb_export_package_apk,
            commands::package::adb_detect_package_log_paths,
            commands::package::adb_pull_package_logs,
            commands::performance::adb_performance_sample,
            commands::performance::adb_performance_stream_snapshot,
            commands::performance::adb_performance_stream_start,
            commands::performance::adb_performance_stream_stop,
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

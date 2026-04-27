#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    adb_manager_lib::run()
}

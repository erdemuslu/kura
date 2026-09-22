// Masaüstü giriş noktası. Tüm mantık lib.rs içindedir.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    local_media_hub_lib::run()
}

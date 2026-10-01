// Masaüstü giriş noktası. Tüm mantık lib.rs içindedir.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    kura_lib::run()
}

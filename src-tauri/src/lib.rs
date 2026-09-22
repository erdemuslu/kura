//! Local Media Hub — Tauri v2 çekirdeği.
//!
//! Tauri IPC komutları (masaüstü penceresi) ve arka planda çalışan Axum
//! sunucusu (ağ girişi) aynı ortak servis katmanını paylaşır:
//! `db` (SQLite), `scanner` (dizin tarama), `runner` (harici oynatıcı).

mod db;
mod runner;
mod scanner;
mod server;

use std::path::PathBuf;
use tauri::Manager;

pub const SERVER_PORT: u16 = 8080;

/// IPC komutları ile Axum handler'larının paylaştığı durum.
/// Kısa ömürlü SQLite bağlantıları açıldığından yalnızca DB yolunu taşır.
pub struct AppState {
    pub db_path: PathBuf,
}

#[derive(serde::Serialize)]
pub struct RemoteInfo {
    pub auth_enabled: bool,
    pub token: String,
    pub port: u16,
    pub local_ip: Option<String>,
}

/// Medyayı harici oynatıcıda başlatır (masaüstü IPC yolu).
/// Yalnızca indekste kayıtlı dosyalar başlatılabilir.
#[tauri::command]
async fn open_media(
    file_path: String,
    target_app: String,
    state: tauri::State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let db_path = state.db_path.clone();
    tokio::task::spawn_blocking(move || -> Result<(), String> {
        let conn = db::open(&db_path)?;
        if !db::path_exists(&conn, &file_path)? {
            return Err("Dosya indekste bulunamadı. Önce dizini tarayın.".into());
        }
        runner::execute_player(&file_path, &target_app)
    })
    .await
    .map_err(|e| e.to_string())??;

    Ok(serde_json::json!({ "success": true, "message": "Medya başlatıldı" }))
}

/// Kütüphane sorgusu: tür filtresi + arama + sayfalama (masaüstü IPC yolu).
#[tauri::command]
async fn query_library(
    media_type: Option<String>,
    query: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<db::MediaItem>, String> {
    let db_path = state.db_path.clone();
    tokio::task::spawn_blocking(move || {
        let conn = db::open(&db_path)?;
        db::query_library(
            &conn,
            media_type.as_deref(),
            query.as_deref(),
            limit.unwrap_or(500).clamp(1, 5000),
            offset.unwrap_or(0).max(0),
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Dizini tarayıp SQLite'a indeksler (masaüstü IPC yolu).
#[tauri::command]
async fn scan_directory(
    path: String,
    disk_label: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<scanner::ScanSummary, String> {
    let db_path = state.db_path.clone();
    tokio::task::spawn_blocking(move || {
        let conn = db::open(&db_path)?;
        scanner::scan_directory(&conn, std::path::Path::new(&path), disk_label.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Bağlı diskleri listeler.
#[tauri::command]
fn list_disks() -> Vec<scanner::DiskInfo> {
    scanner::list_disks()
}

/// Uzaktan kumanda bilgisi — yalnızca masaüstü IPC'sinden erişilir,
/// REST üzerinden yayınlanmaz.
#[tauri::command]
async fn get_remote_info(
    state: tauri::State<'_, AppState>,
) -> Result<RemoteInfo, String> {
    let db_path = state.db_path.clone();
    let (auth_enabled, token) = tokio::task::spawn_blocking(move || {
        let conn = db::open(&db_path)?;
        Ok::<(bool, String), String>((
            db::get_setting(&conn, "remote_auth_enabled")? == "true",
            db::get_setting(&conn, "remote_token")?,
        ))
    })
    .await
    .map_err(|e| e.to_string())??;

    Ok(RemoteInfo {
        auth_enabled,
        token,
        port: SERVER_PORT,
        local_ip: scanner::local_ip(),
    })
}

/// `dist/` klasörünü Axum'a statik servis için çözer.
/// Öncelik sırası: MEDIA_HUB_DIST ortam değişkeni, sonra CWD'ye göre
/// geliştirme/üretim adayları (tauri dev CWD'si src-tauri'dir).
fn resolve_dist_path() -> PathBuf {
    if let Ok(p) = std::env::var("MEDIA_HUB_DIST") {
        return PathBuf::from(p);
    }
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    [
        cwd.join("../dist"), // tauri dev (CWD = src-tauri)
        cwd.join("dist"),    // CWD = proje kökü
        cwd.join("../../dist"),
    ]
    .into_iter()
    .find(|p| p.is_dir())
    .unwrap_or_else(|| cwd.join("../dist"))
}

pub fn run() {
    tauri::Builder::default()
        // Native klasör seçme diyaloğu (ScanPanel "Gözat…" butonu)
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // DB, kalıcı olması için uygulama veri dizininde tutulur
            // (CWD değil — harici disk çıkarılsa bile indeks korunur).
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let db_path = data_dir.join("media-hub.db");

            // İlk açılışta şemayı oluştur + varsayılan ayarları üret.
            let conn = db::init(&db_path)?;
            conn.close()
                .map_err(|e| e.1.to_string())?;

            app.manage(AppState { db_path });

            // Axum sunucusunu arka planda başlat.
            // Not: `app` (`&mut tauri::App`) Send değildir; async bloğa
            // taşınmadan önce gereken değerler burada kopyalanır.
            let server_db_path = app.state::<AppState>().db_path.clone();
            let dist = resolve_dist_path();
            tauri::async_runtime::spawn(async move {
                server::run_server(server_db_path, dist, SERVER_PORT).await;
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_media,
            query_library,
            scan_directory,
            list_disks,
            get_remote_info
        ])
        .run(tauri::generate_context!())
        .expect("Tauri uygulaması çalıştırılamadı");
}

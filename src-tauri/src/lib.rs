//! Kura — Tauri v2 çekirdeği.
//!
//! Tauri IPC komutları (masaüstü penceresi) ve arka planda çalışan Axum
//! sunucusu (ağ girişi) aynı ortak servis katmanını paylaşır:
//! `db` (SQLite), `scanner` (dizin tarama), `runner` (harici oynatıcı).

mod cover;
mod db;
mod ffmpeg;
mod meta;
mod runner;
mod scanner;
mod server;
mod tmdb;

use std::path::PathBuf;
use tauri::{Emitter, Manager};

pub const SERVER_PORT: u16 = 8080;

/// Tarama ilerleme event yükü (`scan-progress`).
#[derive(serde::Serialize, Clone)]
pub struct ScanProgress {
    pub scanned_files: u64,
    pub indexed: u64,
}

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
/// Yalnızca indekste kayıtlı dosyalar başlatılabilir; videolarda kayıtlı
/// altyazı VLC/IINA'ya açıkça geçirilir.
#[tauri::command]
async fn open_media(
    file_path: String,
    target_app: String,
    state: tauri::State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let db_path = state.db_path.clone();
    let fp = file_path.clone();
    let subtitle = tokio::task::spawn_blocking(move || -> Result<Option<String>, String> {
        let conn = db::open(&db_path)?;
        if !db::path_exists(&conn, &fp)? {
            return Err("Dosya indekste bulunamadı. Önce dizini tarayın.".into());
        }
        db::subtitle_for_path(&conn, &fp)
    })
    .await
    .map_err(|e| e.to_string())??;

    runner::execute_player_with_subtitle(&file_path, &target_app, subtitle.as_deref())?;

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
/// İlerleme `scan-progress` event'i ile her 25 dosyada bir bildirilir.
#[tauri::command]
async fn scan_directory(
    app: tauri::AppHandle,
    path: String,
    disk_label: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<scanner::ScanSummary, String> {
    let db_path = state.db_path.clone();
    tokio::task::spawn_blocking(move || {
        let conn = db::open(&db_path)?;
        let covers = crate::cover::covers_dir(&db_path);
        let emit_progress = {
            let app = app.clone();
            move |scanned: u64, indexed: u64| {
                let _ = app.emit(
                    "scan-progress",
                    ScanProgress {
                        scanned_files: scanned,
                        indexed,
                    },
                );
            }
        };
        scanner::scan_directory_with_progress(
            &conn,
            std::path::Path::new(&path),
            disk_label.as_deref(),
            &covers,
            &emit_progress,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Müzik tarayıcı: sanatçı listesi (albüm/şarkı sayılarıyla).
#[tauri::command]
async fn list_artists(
    query: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<db::ArtistSummary>, String> {
    let db_path = state.db_path.clone();
    tokio::task::spawn_blocking(move || {
        let conn = db::open(&db_path)?;
        db::list_artists(&conn, query.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Müzik tarayıcı: albüm listesi (sanatçıya göre filtrelenebilir).
#[tauri::command]
async fn list_albums(
    artist: Option<String>,
    query: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<db::AlbumSummary>, String> {
    let db_path = state.db_path.clone();
    tokio::task::spawn_blocking(move || {
        let conn = db::open(&db_path)?;
        db::list_albums(&conn, artist.as_deref(), query.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Müzik tarayıcı: bir albümün şarkıları (disk + track sırasına göre).
#[tauri::command]
async fn album_tracks(
    album: String,
    artist: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<db::MediaItem>, String> {
    let db_path = state.db_path.clone();
    tokio::task::spawn_blocking(move || {
        let conn = db::open(&db_path)?;
        db::album_tracks(&conn, &album, &artist)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Müzik tarayıcı: bir sanatçının tüm şarkıları ("Tümünü Çal" için).
#[tauri::command]
async fn artist_tracks(
    artist: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<db::MediaItem>, String> {
    let db_path = state.db_path.clone();
    tokio::task::spawn_blocking(move || {
        let conn = db::open(&db_path)?;
        db::artist_tracks(&conn, &artist)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Film tarayıcı: klasör bazında gruplanmış filmler.
#[tauri::command]
async fn list_movies(
    query: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<db::MovieGroup>, String> {
    let db_path = state.db_path.clone();
    tokio::task::spawn_blocking(move || {
        let conn = db::open(&db_path)?;
        db::list_movies(&conn, query.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Film tarayıcı: bir film grubunun dosyaları (oynatma için).
#[tauri::command]
async fn movie_files(
    group_key: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<db::MediaItem>, String> {
    let db_path = state.db_path.clone();
    tokio::task::spawn_blocking(move || {
        let conn = db::open(&db_path)?;
        db::movie_files(&conn, &group_key)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Dizi tarayıcı: diziler (sezon/bölüm sayılarıyla).
#[tauri::command]
async fn list_shows(
    query: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<db::ShowSummary>, String> {
    let db_path = state.db_path.clone();
    tokio::task::spawn_blocking(move || {
        let conn = db::open(&db_path)?;
        db::list_shows(&conn, query.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Dizi tarayıcı: bir dizinin sezonları.
#[tauri::command]
async fn list_seasons(
    show: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<db::SeasonSummary>, String> {
    let db_path = state.db_path.clone();
    tokio::task::spawn_blocking(move || {
        let conn = db::open(&db_path)?;
        db::list_seasons(&conn, &show)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Dizi tarayıcı: bölümler. `season` yoksa tüm sezonlar ("Tümünü Çal" için).
#[tauri::command]
async fn list_episodes(
    show: String,
    season: Option<i64>,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<db::MediaItem>, String> {
    let db_path = state.db_path.clone();
    tokio::task::spawn_blocking(move || {
        let conn = db::open(&db_path)?;
        db::list_episodes(&conn, &show, season)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Birden çok dosyayı .m3u8 playlist olarak oynatıcıya ekler ("Tümünü Çal").
/// Yalnızca indekste kayıtlı dosyalar playlist'e alınır (güvenlik).
#[tauri::command]
async fn open_media_batch(
    file_paths: Vec<String>,
    target_app: String,
    playlist_title: String,
    state: tauri::State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let db_path = state.db_path.clone();
    let added = tokio::task::spawn_blocking(move || -> Result<usize, String> {
        let conn = db::open(&db_path)?;
        let mut valid: Vec<String> = Vec::new();
        for p in &file_paths {
            if db::path_exists(&conn, p)? {
                valid.push(p.clone());
            }
        }
        if valid.is_empty() {
            return Err("Çalınacak kayıtlı dosya bulunamadı (disk çevrimdışı olabilir)".into());
        }
        let refs: Vec<&str> = valid.iter().map(|s| s.as_str()).collect();
        runner::execute_playlist(&refs, &target_app, &playlist_title)?;
        Ok(valid.len())
    })
    .await
    .map_err(|e| e.to_string())??;

    Ok(serde_json::json!({
        "success": true,
        "message": format!("{added} şarkı oynatıcıya eklendi")
    }))
}

/// Bir kaynak dizini altındaki tüm medyaları indeksten siler.
#[tauri::command]
async fn remove_source_path(
    path: String,
    state: tauri::State<'_, AppState>,
) -> Result<usize, String> {
    let db_path = state.db_path.clone();
    tokio::task::spawn_blocking(move || {
        let conn = db::open(&db_path)?;
        db::remove_source_path(&conn, &path)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Şarkı sözlerini (sidecar .lrc veya gömülü etiket) okur.
#[tauri::command]
async fn get_lyrics(file_path: String) -> Result<Option<scanner::LyricsResult>, String> {
    tokio::task::spawn_blocking(move || {
        Ok(scanner::read_lyrics(std::path::Path::new(&file_path)))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Dosyayı macOS Finder'da vurgulayarak gösterir.
#[tauri::command]
async fn reveal_in_finder(file_path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(&file_path)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = file_path;
        Ok(())
    }
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

/// Ayarlar: uzaktan erişim token doğrulamasını açar/kapar.
/// Yalnızca masaüstü IPC'sinden değiştirilebilir (ağ üzerinden değil).
#[tauri::command]
async fn set_remote_auth_enabled(
    enabled: bool,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let db_path = state.db_path.clone();
    tokio::task::spawn_blocking(move || {
        let conn = db::open(&db_path)?;
        db::set_setting(
            &conn,
            "remote_auth_enabled",
            if enabled { "true" } else { "false" },
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Ayarlar: uzaktan erişim token'ını yeniden üretir ve döndürür.
#[tauri::command]
async fn regenerate_remote_token(
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let db_path = state.db_path.clone();
    tokio::task::spawn_blocking(move || {
        let conn = db::open(&db_path)?;
        let token = uuid::Uuid::new_v4().to_string();
        db::set_setting(&conn, "remote_token", &token)?;
        Ok(token)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Ayarlar: TMDB API key'i okur (film/dizi posterleri). Boş/ayarlanmamış → None.
#[tauri::command]
async fn get_tmdb_api_key(
    state: tauri::State<'_, AppState>,
) -> Result<Option<String>, String> {
    let db_path = state.db_path.clone();
    tokio::task::spawn_blocking(move || {
        let conn = db::open(&db_path)?;
        Ok::<_, String>(match db::get_setting_opt(&conn, "tmdb_api_key")? {
            Some(k) if !k.is_empty() => Some(k),
            _ => None,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Ayarlar: TMDB API key'i kaydeder (boş bırakılırsa özelliği kapatır).
#[tauri::command]
async fn set_tmdb_api_key(
    key: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let db_path = state.db_path.clone();
    tokio::task::spawn_blocking(move || {
        let conn = db::open(&db_path)?;
        db::set_setting(&conn, "tmdb_api_key", key.trim())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Oynatıcı ataması: tipe ("video" | "audio") göre kalıcı player.
#[tauri::command]
async fn get_player_setting(
    kind: String,
    state: tauri::State<'_, AppState>,
) -> Result<Option<String>, String> {
    let db_path = state.db_path.clone();
    tokio::task::spawn_blocking(move || {
        let conn = db::open(&db_path)?;
        db::get_setting_opt(&conn, &format!("player_{kind}"))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Oynatıcı atamasını kaydeder.
#[tauri::command]
async fn set_player_setting(
    kind: String,
    id: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let db_path = state.db_path.clone();
    tokio::task::spawn_blocking(move || {
        let conn = db::open(&db_path)?;
        db::set_setting(&conn, &format!("player_{kind}"), &id)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Gömülü veya sistem FFmpeg varlığını kontrol eder.
#[tauri::command]
fn is_ffmpeg_available() -> bool {
    ffmpeg::is_available()
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
            get_remote_info,
            list_artists,
            list_albums,
            album_tracks,
            artist_tracks,
            open_media_batch,
            set_remote_auth_enabled,
            regenerate_remote_token,
            get_tmdb_api_key,
            set_tmdb_api_key,
            get_player_setting,
            set_player_setting,
            list_movies,
            movie_files,
            list_shows,
            list_seasons,
            list_episodes,
            is_ffmpeg_available,
            remove_source_path,
            get_lyrics,
            reveal_in_finder
        ])
        .run(tauri::generate_context!())
        .expect("Tauri uygulaması çalıştırılamadı");
}

//! Arka planda çalışan Axum HTTP sunucusu (0.0.0.0:8080 — ağ girişi).
//! Masaüstü penceresi ile aynı ortak servis katmanını (db / runner / scanner)
//! kullanır. REST, aynı React `dist` klasörünü de ağ tarayıcılarına sunar.

use crate::{db, runner, scanner};
use axum::{
    extract::{Query, State},
    http::{HeaderMap, StatusCode},
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::{net::SocketAddr, path::{Path, PathBuf}};
use tower_http::cors::CorsLayer;
use tower_http::services::ServeDir;
use axum::http::header;
use axum::response::{IntoResponse, Response};

#[derive(Clone)]
pub struct ServerState {
    pub db_path: PathBuf,
    pub dist: PathBuf,
}

#[derive(Deserialize)]
pub struct OpenMediaPayload {
    pub file_path: String,
    pub target_app: String,
}

#[derive(Deserialize)]
pub struct OpenBatchPayload {
    pub file_paths: Vec<String>,
    pub target_app: String,
    pub playlist_title: String,
}

#[derive(Deserialize)]
pub struct ScanPayload {
    pub path: String,
    pub disk_label: Option<String>,
}

#[derive(Deserialize)]
pub struct LibraryQuery {
    #[serde(rename = "type")]
    pub media_type: Option<String>,
    pub q: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

/// Müzik tarayıcı uçları için ortak query parametreleri.
#[derive(Deserialize)]
pub struct MusicQuery {
    pub q: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
}

/// `/api/cover` — albüm kapağı sorgu parametreleri.
#[derive(Deserialize)]
pub struct CoverQuery {
    pub album: String,
    pub artist: String,
}

#[derive(Serialize)]
pub struct ApiResponse {
    pub success: bool,
    pub message: String,
}

#[derive(Serialize)]
pub struct StatusResponse {
    pub status: String,
    pub version: String,
    pub auth_required: bool,
}

#[derive(Serialize)]
pub struct LibraryResponse {
    pub items: Vec<db::MediaItem>,
}

fn internal_error(e: String) -> (StatusCode, Json<ApiResponse>) {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(ApiResponse {
            success: false,
            message: e,
        }),
    )
}

/// Token doğrulaması açıksa değiştirici uçları X-Auth-Token ile kontrol eder.
/// `remote_auth_enabled` ayarı "false" olduğundan istekler serbest geçer.
async fn check_auth(
    st: &ServerState,
    headers: &HeaderMap,
) -> Result<(), (StatusCode, Json<ApiResponse>)> {
    let db_path = st.db_path.clone();
    let (enabled, expected) = tokio::task::spawn_blocking(move || {
        let conn = db::open(&db_path)?;
        Ok::<(bool, String), String>((
            db::get_setting(&conn, "remote_auth_enabled")? == "true",
            db::get_setting(&conn, "remote_token")?,
        ))
    })
    .await
    .map_err(|e| internal_error(e.to_string()))?
    .map_err(internal_error)?;

    if !enabled {
        return Ok(());
    }
    let provided = headers
        .get("x-auth-token")
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);
    if provided.as_deref() == Some(expected.as_str()) {
        Ok(())
    } else {
        Err((
            StatusCode::UNAUTHORIZED,
            Json(ApiResponse {
                success: false,
                message: "Geçersiz veya eksik erişim token’ı".into(),
            }),
        ))
    }
}

pub async fn run_server(db_path: PathBuf, dist: PathBuf, port: u16) {
    let state = ServerState { db_path, dist };
    let static_root = state.dist.clone();

    let app = Router::new()
        .route("/api/status", get(status))
        .route("/api/library", get(library))
        .route("/api/disks", get(disks))
        .route("/api/scan", post(scan))
        .route("/api/open", post(open_media_route))
        .route("/api/music/artists", get(music_artists))
        .route("/api/music/albums", get(music_albums))
        .route("/api/music/tracks", get(music_tracks))
        .route("/api/music/artist-tracks", get(music_artist_tracks))
        .route("/api/cover", get(cover))
        .route("/api/open-batch", post(open_batch))
        .fallback_service(ServeDir::new(static_root).append_index_html_on_directories(true))
        .layer(CorsLayer::permissive())
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    println!("Web remote şu adreste aktif: http://{addr}");

    match tokio::net::TcpListener::bind(addr).await {
        Ok(listener) => {
            if let Err(e) = axum::serve(listener, app).await {
                eprintln!("Axum sunucu hatası: {e}");
            }
        }
        Err(e) => eprintln!("Port {port} bağlanamadı (uygulama zaten açık?): {e}"),
    }
}

async fn status(State(st): State<ServerState>) -> Json<StatusResponse> {
    let auth_required = tokio::task::spawn_blocking({
        let db_path = st.db_path.clone();
        move || {
            let conn = db::open(&db_path)?;
            Ok::<bool, String>(db::get_setting(&conn, "remote_auth_enabled")? == "true")
        }
    })
    .await
    .ok()
    .and_then(|r| r.ok())
    .unwrap_or(false);

    Json(StatusResponse {
        status: "Online".into(),
        version: env!("CARGO_PKG_VERSION").into(),
        auth_required,
    })
}

async fn library(
    Query(q): Query<LibraryQuery>,
    State(st): State<ServerState>,
) -> Result<Json<LibraryResponse>, (StatusCode, Json<ApiResponse>)> {
    let db_path = st.db_path.clone();
    let items = tokio::task::spawn_blocking(move || {
        let conn = db::open(&db_path)?;
        db::query_library(
            &conn,
            q.media_type.as_deref(),
            q.q.as_deref(),
            q.limit.unwrap_or(500).clamp(1, 5000),
            q.offset.unwrap_or(0).max(0),
        )
    })
    .await
    .map_err(|e| internal_error(e.to_string()))?
    .map_err(internal_error)?;

    Ok(Json(LibraryResponse { items }))
}

async fn disks() -> Json<Vec<scanner::DiskInfo>> {
    Json(scanner::list_disks())
}

async fn scan(
    State(st): State<ServerState>,
    headers: HeaderMap,
    Json(payload): Json<ScanPayload>,
) -> Result<Json<scanner::ScanSummary>, (StatusCode, Json<ApiResponse>)> {
    check_auth(&st, &headers).await?;

    let db_path = st.db_path.clone();
    let path = payload.path.clone();
    let disk_label = payload.disk_label.clone();
    let summary = tokio::task::spawn_blocking(move || {
        let conn = db::open(&db_path)?;
        let covers = crate::cover::covers_dir(&db_path);
        scanner::scan_directory(&conn, std::path::Path::new(&path), disk_label.as_deref(), &covers)
    })
    .await
    .map_err(|e| internal_error(e.to_string()))?
    .map_err(internal_error)?;

    Ok(Json(summary))
}

async fn open_media_route(
    State(st): State<ServerState>,
    headers: HeaderMap,
    Json(payload): Json<OpenMediaPayload>,
) -> Result<Json<ApiResponse>, (StatusCode, Json<ApiResponse>)> {
    check_auth(&st, &headers).await?;

    // Güvenlik: yalnızca indekste kayıtlı dosyalar başlatılabilir.
    let db_path = st.db_path.clone();
    let known = tokio::task::spawn_blocking({
        let file_path = payload.file_path.clone();
        move || {
            let conn = db::open(&db_path)?;
            db::path_exists(&conn, &file_path)
        }
    })
    .await
    .map_err(|e| internal_error(e.to_string()))?
    .map_err(internal_error)?;

    if !known {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ApiResponse {
                success: false,
                message: "Dosya indekste bulunamadı. Önce dizini tarayın.".into(),
            }),
        ));
    }

    let file_path = payload.file_path.clone();
    let target_app = payload.target_app.clone();
    let result = tokio::task::spawn_blocking(move || runner::execute_player(&file_path, &target_app))
        .await
        .map_err(|e| internal_error(e.to_string()))?;

    match result {
        Ok(()) => Ok(Json(ApiResponse {
            success: true,
            message: "Medya başlatıldı".into(),
        })),
        Err(err) => Err((
            StatusCode::BAD_REQUEST,
            Json(ApiResponse {
                success: false,
                message: err,
            }),
        )),
    }
}

async fn music_artists(
    Query(q): Query<MusicQuery>,
    State(st): State<ServerState>,
) -> Result<Json<Vec<db::ArtistSummary>>, (StatusCode, Json<ApiResponse>)> {
    let db_path = st.db_path.clone();
    let artists = tokio::task::spawn_blocking(move || {
        let conn = db::open(&db_path)?;
        db::list_artists(&conn, q.q.as_deref())
    })
    .await
    .map_err(|e| internal_error(e.to_string()))?
    .map_err(internal_error)?;
    Ok(Json(artists))
}

async fn music_albums(
    Query(q): Query<MusicQuery>,
    State(st): State<ServerState>,
) -> Result<Json<Vec<db::AlbumSummary>>, (StatusCode, Json<ApiResponse>)> {
    let db_path = st.db_path.clone();
    let albums = tokio::task::spawn_blocking(move || {
        let conn = db::open(&db_path)?;
        db::list_albums(&conn, q.artist.as_deref(), q.q.as_deref())
    })
    .await
    .map_err(|e| internal_error(e.to_string()))?
    .map_err(internal_error)?;
    Ok(Json(albums))
}

async fn music_tracks(
    Query(q): Query<MusicQuery>,
    State(st): State<ServerState>,
) -> Result<Json<Vec<db::MediaItem>>, (StatusCode, Json<ApiResponse>)> {
    let (Some(album), Some(artist)) = (q.album.clone(), q.artist.clone()) else {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ApiResponse {
                success: false,
                message: "album ve artist parametreleri zorunlu".into(),
            }),
        ));
    };
    let db_path = st.db_path.clone();
    let tracks = tokio::task::spawn_blocking(move || {
        let conn = db::open(&db_path)?;
        db::album_tracks(&conn, &album, &artist)
    })
    .await
    .map_err(|e| internal_error(e.to_string()))?
    .map_err(internal_error)?;
    Ok(Json(tracks))
}

/// Albüm kapağı çözümleme zinciri:
///   1) DB'de kayıtlı kapak yolu (taramada gömülü/klasör kapağı yazılır)
///   2) iTunes Search API (key'siz) — bulunursa diske önbelleklenir ve
///      DB'ye işlenir; sonraki istekler doğrudan DB'den gelir.
fn read_image(path: &Path) -> Option<(&'static str, Vec<u8>)> {
    let bytes = std::fs::read(path).ok()?;
    let mime = match path.extension().and_then(|e| e.to_str()) {
        Some("png") => "image/png",
        Some("gif") => "image/gif",
        Some("bmp") => "image/bmp",
        _ => "image/jpeg",
    };
    Some((mime, bytes))
}

fn image_response(mime: &'static str, bytes: Vec<u8>) -> Response {
    (
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, mime),
            (header::CACHE_CONTROL, "public, max-age=86400"),
        ],
        bytes,
    )
        .into_response()
}

async fn cover(
    Query(q): Query<CoverQuery>,
    State(st): State<ServerState>,
) -> Response {
    // 1) DB'de kayıtlı kapak yolu
    let db_path = st.db_path.clone();
    let (album, artist) = (q.album.clone(), q.artist.clone());
    let known: Option<String> = tokio::task::spawn_blocking(move || {
        let conn = db::open(&db_path)?;
        db::cover_path_for_album(&conn, &album, &artist)
    })
    .await
    .ok()
    .and_then(|r| r.ok())
    .flatten();

    if let Some(path) = known {
        if let Some((mime, bytes)) = read_image(Path::new(&path)) {
            return image_response(mime, bytes);
        }
    }

    // 2) iTunes fallback — "Bilinmeyen Albüm" için anlamsız, atla.
    if q.album == db::UNKNOWN_ALBUM {
        return (StatusCode::NOT_FOUND, "").into_response();
    }

    let covers = crate::cover::covers_dir(&st.db_path);
    if let Some(cover_path) = crate::cover::fetch_itunes_cover(&covers, &q.artist, &q.album).await
    {
        // Önbelleğe alındı → DB'ye de işle (sonraki istekler DB'den döner)
        let db_path = st.db_path.clone();
        let (album, artist, path_str) = (
            q.album.clone(),
            q.artist.clone(),
            cover_path.to_string_lossy().to_string(),
        );
        let _ = tokio::task::spawn_blocking(move || {
            let conn = db::open(&db_path)?;
            db::set_album_cover(&conn, &album, &artist, &path_str)
        })
        .await;

        if let Some((mime, bytes)) = read_image(&cover_path) {
            return image_response(mime, bytes);
        }
    }

    (StatusCode::NOT_FOUND, "").into_response()
}

/// Bir sanatçının tüm şarkıları ("Tümünü Çal" için; album+artist'ten bağımsız).
async fn music_artist_tracks(
    Query(q): Query<MusicQuery>,
    State(st): State<ServerState>,
) -> Result<Json<Vec<db::MediaItem>>, (StatusCode, Json<ApiResponse>)> {
    let Some(artist) = q.artist.clone() else {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ApiResponse {
                success: false,
                message: "artist parametresi zorunlu".into(),
            }),
        ));
    };
    let db_path = st.db_path.clone();
    let tracks = tokio::task::spawn_blocking(move || {
        let conn = db::open(&db_path)?;
        db::artist_tracks(&conn, &artist)
    })
    .await
    .map_err(|e| internal_error(e.to_string()))?
    .map_err(internal_error)?;
    Ok(Json(tracks))
}

/// "Tümünü Çal": birden çok dosyayı playlist olarak oynatıcıya ekler.
async fn open_batch(
    State(st): State<ServerState>,
    headers: HeaderMap,
    Json(payload): Json<OpenBatchPayload>,
) -> Result<Json<ApiResponse>, (StatusCode, Json<ApiResponse>)> {
    check_auth(&st, &headers).await?;

    let db_path = st.db_path.clone();
    let target_app = payload.target_app.clone();
    let playlist_title = payload.playlist_title.clone();
    let result =
        tokio::task::spawn_blocking(move || -> Result<usize, String> {
            let conn = db::open(&db_path)?;
            let mut valid: Vec<String> = Vec::new();
            for p in &payload.file_paths {
                if db::path_exists(&conn, p)? {
                    valid.push(p.clone());
                }
            }
            if valid.is_empty() {
                return Err(
                    "Çalınacak kayıtlı dosya bulunamadı (disk çevrimdışı olabilir)".into(),
                );
            }
            let refs: Vec<&str> = valid.iter().map(|s| s.as_str()).collect();
            runner::execute_playlist(&refs, &target_app, &playlist_title)?;
            Ok(valid.len())
        })
        .await
        .map_err(|e| internal_error(e.to_string()))?;

    match result {
        Ok(added) => Ok(Json(ApiResponse {
            success: true,
            message: format!("{added} şarkı oynatıcıya eklendi"),
        })),
        Err(err) => Err((
            StatusCode::BAD_REQUEST,
            Json(ApiResponse {
                success: false,
                message: err,
            }),
        )),
    }
}

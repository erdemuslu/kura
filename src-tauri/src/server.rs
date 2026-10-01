//! Arka planda çalışan Axum HTTP sunucusu (0.0.0.0:8080 — ağ girişi).
//! Masaüstü penceresi ile aynı ortak servis katmanını (db / runner / scanner)
//! kullanır. REST, aynı React `dist` klasörünü de ağ tarayıcılarına sunar.

use crate::{db, ffmpeg, lastfm, runner, scanner};
use axum::{
    extract::{Query, State},
    http::{HeaderMap, StatusCode},
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::{net::SocketAddr, path::{Path, PathBuf}};
use tower_http::cors::CorsLayer;
use axum::http::header;
use axum::response::{IntoResponse, Response};
use tokio::fs::File;
use tokio::io::{AsyncReadExt, AsyncSeekExt, SeekFrom};
use tokio_util::io::ReaderStream;

#[allow(dead_code)]
pub struct HlsSessionEntry {
    pub child: Option<tokio::process::Child>,
    pub dir: PathBuf,
    pub file_path: String,
    pub start_seconds: Option<f64>,
    pub created_at: std::time::Instant,
}

#[derive(Default)]
pub struct HlsManager {
    pub sessions: tokio::sync::Mutex<std::collections::HashMap<String, HlsSessionEntry>>,
}

#[derive(Clone)]
pub struct ServerState {
    pub db_path: PathBuf,
    pub dist: PathBuf,
    pub hls: std::sync::Arc<HlsManager>,
}

/// `/api/stream` — medya dosyası HTTP Range akışı sorgu parametreleri.
#[derive(Deserialize)]
pub struct StreamQuery {
    pub path: Option<String>,
    pub id: Option<String>,
}

/// `/api/settings/player` sorgu parametreleri.
#[derive(Deserialize)]
pub struct PlayerSettingQuery {
    pub kind: String,
}

#[derive(Deserialize)]
pub struct SetPlayerSettingPayload {
    pub kind: String,
    pub id: String,
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
pub struct RemoveSourcePayload {
    pub path: String,
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

/// `/api/cover` — kapak/poster sorgu parametreleri.
/// `kind`: "movie" | "series" (yoksa müzik: album+artist zorunlu).
#[derive(Deserialize)]
pub struct CoverQuery {
    pub kind: Option<String>,
    pub album: Option<String>,
    pub artist: Option<String>,
    pub title: Option<String>,
    /// Film için: lokal poster araması yapılacak klasör
    pub folder: Option<String>,
}

/// `/api/meta` — detay metadata sorgu parametreleri.
#[derive(Deserialize)]
pub struct MetaQuery {
    pub kind: Option<String>,
    pub title: Option<String>,
}

/// Film/dizi tarayıcı uçları için ortak query parametreleri.
#[derive(Deserialize)]
pub struct VideoQuery {
    pub q: Option<String>,
    pub show: Option<String>,
    pub season: Option<i64>,
    pub group: Option<String>,
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

#[derive(rust_embed::RustEmbed)]
#[folder = "../dist"]
struct WebAssets;

async fn static_handler(uri: axum::http::Uri) -> Response {
    let mut path = uri.path().trim_start_matches('/').to_string();
    if path.is_empty() {
        path = "index.html".to_string();
    }

    match WebAssets::get(&path) {
        Some(content) => {
            let mime = mime_guess::from_path(&path).first_or_octet_stream();
            (
                [(header::CONTENT_TYPE, mime.as_ref())],
                content.data,
            )
                .into_response()
        }
        None => {
            // SPA fallback: alt sayfalarda veya bilinmeyen dosyalarda index.html döndür
            if let Some(index) = WebAssets::get("index.html") {
                (
                    [(header::CONTENT_TYPE, "text/html; charset=utf-8")],
                    index.data,
                )
                    .into_response()
            } else {
                (StatusCode::NOT_FOUND, "404 Not Found").into_response()
            }
        }
    }
}

pub async fn run_server(db_path: PathBuf, dist: PathBuf, port: u16) {
    let state = ServerState {
        db_path,
        dist,
        hls: std::sync::Arc::new(HlsManager::default()),
    };

    let app = Router::new()
        .route("/api/status", get(status))
        .route("/api/library", get(library))
        .route("/api/library/remove-source", post(remove_source_route))
        .route("/api/disks", get(disks))
        .route("/api/scan", post(scan))
        .route("/api/open", post(open_media_route))
        .route("/api/music/artists", get(music_artists))
        .route("/api/music/albums", get(music_albums))
        .route("/api/music/tracks", get(music_tracks))
        .route("/api/music/artist-tracks", get(music_artist_tracks))
        .route("/api/music/lyrics", get(lyrics_route))
        .route("/api/open-folder", post(open_folder_route))
        .route("/api/cover", get(cover))
        .route("/api/meta", get(media_meta))
        .route("/api/movies", get(movies_route))
        .route("/api/movies/files", get(movie_files_route))
        .route("/api/series/shows", get(series_shows))
        .route("/api/series/seasons", get(series_seasons))
        .route("/api/series/episodes", get(series_episodes))
        .route("/api/open-batch", post(open_batch))
        .route("/api/stream", get(stream_media))
        .route("/api/stream/video", get(stream_video_route))
        .route("/api/hls/:session/master.m3u8", get(hls_master_route))
        .route("/api/hls/:session/stop", post(hls_stop_route))
        .route("/api/hls/:session/:file", get(hls_file_route))
        .route("/api/subtitle", get(subtitle_route))
        .route("/api/media/probe", get(media_probe_route))
        .route("/api/media/keyframe", get(media_keyframe_route))
        .route("/api/ffmpeg/status", get(ffmpeg_status_route))
        .route(
            "/api/settings/player",
            get(get_player_setting_route).post(set_player_setting_route),
        )
        .route("/api/lastfm/status", get(lastfm_status_route))
        .route("/api/lastfm/auth-url", post(lastfm_auth_url_route))
        .route("/api/lastfm/complete-auth", post(lastfm_complete_auth_route))
        .route("/api/lastfm/disconnect", post(lastfm_disconnect_route))
        .route("/api/lastfm/settings", post(lastfm_settings_route))
        .route("/api/lastfm/now-playing", post(lastfm_now_playing_route))
        .route("/api/lastfm/scrobble", post(lastfm_scrobble_route))
        .fallback(static_handler)
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

async fn remove_source_route(
    State(st): State<ServerState>,
    headers: HeaderMap,
    Json(payload): Json<RemoveSourcePayload>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ApiResponse>)> {
    check_auth(&st, &headers).await?;
    let db_path = st.db_path.clone();
    let deleted = tokio::task::spawn_blocking(move || {
        let conn = db::open(&db_path)?;
        db::remove_source_path(&conn, &payload.path)
    })
    .await
    .map_err(|e| internal_error(e.to_string()))?
    .map_err(internal_error)?;

    Ok(Json(serde_json::json!({
        "success": true,
        "deleted": deleted
    })))
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

#[derive(Deserialize)]
pub struct LyricsQuery {
    pub path: String,
}

async fn lyrics_route(
    Query(q): Query<LyricsQuery>,
) -> impl IntoResponse {
    let lyrics = scanner::read_lyrics(Path::new(&q.path));
    Json(lyrics)
}

#[derive(Deserialize)]
pub struct OpenFolderPayload {
    pub path: String,
}

async fn open_folder_route(
    Json(p): Json<OpenFolderPayload>,
) -> impl IntoResponse {
    #[cfg(target_os = "macos")]
    let _ = std::process::Command::new("open")
        .arg("-R")
        .arg(&p.path)
        .spawn();
    Json(ApiResponse {
        success: true,
        message: "Klasör açıldı".into(),
    })
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
    match q.kind.as_deref() {
        Some("movie") => cover_movie(&q, &st).await,
        Some("series") => cover_series(&q, &st).await,
        _ => cover_music(&q, &st).await,
    }
}

fn not_found_response() -> Response {
    (StatusCode::NOT_FOUND, "").into_response()
}

/// Müzik kapağı: DB (taramada gömülü/klasör) → iTunes fallback.
async fn cover_music(q: &CoverQuery, st: &ServerState) -> Response {
    let (Some(album), Some(artist)) = (q.album.clone(), q.artist.clone()) else {
        return not_found_response();
    };

    // 1) DB'de kayıtlı kapak yolu
    let db_path = st.db_path.clone();
    let (album_c, artist_c) = (album.clone(), artist.clone());
    let known: Option<String> = tokio::task::spawn_blocking(move || {
        let conn = db::open(&db_path)?;
        db::cover_path_for_album(&conn, &album_c, &artist_c)
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
    if album == db::UNKNOWN_ALBUM {
        return not_found_response();
    }

    let covers = crate::cover::covers_dir(&st.db_path);
    if let Some(cover_path) = crate::cover::fetch_itunes_cover(&covers, &artist, &album).await
    {
        // Önbelleğe alındı → DB'ye de işle (sonraki istekler DB'den döner)
        let db_path = st.db_path.clone();
        let (album, artist, path_str) = (
            album.clone(),
            artist.clone(),
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

    not_found_response()
}

/// Film posteri: klasör posteri (Plex tarzı) → TMDB.
async fn cover_movie(q: &CoverQuery, st: &ServerState) -> Response {
    let Some(title) = q.title.clone() else {
        return not_found_response();
    };

    // 1) Lokal klasör posteri
    if let Some(folder) = q.folder.as_deref() {
        if let Some(p) = crate::cover::movie_folder_poster(Path::new(folder)) {
            if let Some((mime, bytes)) = read_image(&p) {
                return image_response(mime, bytes);
            }
        }
    }

    // 2) TMDB (key varsa — en kaliteli kaynak)
    if let Some(key) = tmdb_key(st).await {
        let covers = crate::cover::covers_dir(&st.db_path);
        if let Some(p) = crate::tmdb::fetch_movie_poster(&covers, &key, &title).await {
            if let Some((mime, bytes)) = read_image(&p) {
                return image_response(mime, bytes);
            }
        }
    }

    // 3) Key'siz fallback: iTunes (entity=movie)
    let covers = crate::cover::covers_dir(&st.db_path);
    if let Some(p) = crate::cover::fetch_itunes(
        &covers,
        "movie",
        &title,
        &format!("itunes-movie\u{1f}{title}"),
    )
    .await
    {
        if let Some((mime, bytes)) = read_image(&p) {
            return image_response(mime, bytes);
        }
    }
    not_found_response()
}

/// Dizi posteri: TMDB (key varsa) → TVmaze → iTunes tvSeason (key'siz).
async fn cover_series(q: &CoverQuery, st: &ServerState) -> Response {
    let Some(title) = q.title.clone() else {
        return not_found_response();
    };
    if let Some(key) = tmdb_key(st).await {
        let covers = crate::cover::covers_dir(&st.db_path);
        if let Some(p) = crate::tmdb::fetch_series_poster(&covers, &key, &title).await {
            if let Some((mime, bytes)) = read_image(&p) {
                return image_response(mime, bytes);
            }
        }
    }

    // Key'siz zincir: TVmaze (yüksek çözünürlük) → iTunes tvSeason
    let covers = crate::cover::covers_dir(&st.db_path);
    if let Some(p) = crate::cover::fetch_tvmaze_poster(&covers, &title).await {
        if let Some((mime, bytes)) = read_image(&p) {
            return image_response(mime, bytes);
        }
    }
    if let Some(p) = crate::cover::fetch_itunes(
        &covers,
        "tvSeason",
        &title,
        &format!("itunes-series\u{1f}{title}"),
    )
    .await
    {
        if let Some((mime, bytes)) = read_image(&p) {
            return image_response(mime, bytes);
        }
    }
    not_found_response()
}

/// `/api/meta` — film/dizi detay metadata (özet, yıl, puan, türler, süre, durum).
/// Zincir: önbellek → TMDB (key varsa) → key'siz fallback (film: iTunes,
/// dizi: TVmaze). Kaynak bulunamazsa tüm alanları boş bir meta döner.
async fn media_meta(
    Query(q): Query<MetaQuery>,
    State(st): State<ServerState>,
) -> Result<Json<crate::meta::Meta>, (StatusCode, Json<ApiResponse>)> {
    let (Some(kind), Some(title)) = (q.kind.clone(), q.title.clone()) else {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ApiResponse {
                success: false,
                message: "kind ve title parametreleri zorunlu".into(),
            }),
        ));
    };
    if kind != "movie" && kind != "series" {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ApiResponse {
                success: false,
                message: "kind yalnızca 'movie' veya 'series' olabilir".into(),
            }),
        ));
    }

    let tmdb = tmdb_key(&st).await;
    let covers = crate::cover::covers_dir(&st.db_path);
    let meta = if kind == "movie" {
        crate::meta::fetch_movie_meta(&covers, tmdb.as_deref(), &title).await
    } else {
        crate::meta::fetch_series_meta(&covers, tmdb.as_deref(), &title).await
    };
    Ok(Json(meta))
}

/// TMDB API key'i ayarlardan okur (boş/ayarlanmamış → None).
async fn tmdb_key(st: &ServerState) -> Option<String> {
    let db_path = st.db_path.clone();
    tokio::task::spawn_blocking(move || {
        let conn = db::open(&db_path)?;
        db::get_setting_opt(&conn, "tmdb_api_key")
    })
    .await
    .ok()?
    .ok()?
    .filter(|k| !k.is_empty())
}

async fn movies_route(
    Query(q): Query<VideoQuery>,
    State(st): State<ServerState>,
) -> Result<Json<Vec<db::MovieGroup>>, (StatusCode, Json<ApiResponse>)> {
    let db_path = st.db_path.clone();
    let groups = tokio::task::spawn_blocking(move || {
        let conn = db::open(&db_path)?;
        db::list_movies(&conn, q.q.as_deref())
    })
    .await
    .map_err(|e| internal_error(e.to_string()))?
    .map_err(internal_error)?;
    Ok(Json(groups))
}

async fn movie_files_route(
    Query(q): Query<VideoQuery>,
    State(st): State<ServerState>,
) -> Result<Json<Vec<db::MediaItem>>, (StatusCode, Json<ApiResponse>)> {
    let Some(group) = q.group.clone() else {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ApiResponse {
                success: false,
                message: "group parametresi zorunlu".into(),
            }),
        ));
    };
    let db_path = st.db_path.clone();
    let files = tokio::task::spawn_blocking(move || {
        let conn = db::open(&db_path)?;
        db::movie_files(&conn, &group)
    })
    .await
    .map_err(|e| internal_error(e.to_string()))?
    .map_err(internal_error)?;
    Ok(Json(files))
}

async fn series_shows(
    Query(q): Query<VideoQuery>,
    State(st): State<ServerState>,
) -> Result<Json<Vec<db::ShowSummary>>, (StatusCode, Json<ApiResponse>)> {
    let db_path = st.db_path.clone();
    let shows = tokio::task::spawn_blocking(move || {
        let conn = db::open(&db_path)?;
        db::list_shows(&conn, q.q.as_deref())
    })
    .await
    .map_err(|e| internal_error(e.to_string()))?
    .map_err(internal_error)?;
    Ok(Json(shows))
}

async fn series_seasons(
    Query(q): Query<VideoQuery>,
    State(st): State<ServerState>,
) -> Result<Json<Vec<db::SeasonSummary>>, (StatusCode, Json<ApiResponse>)> {
    let Some(show) = q.show.clone() else {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ApiResponse {
                success: false,
                message: "show parametresi zorunlu".into(),
            }),
        ));
    };
    let db_path = st.db_path.clone();
    let seasons = tokio::task::spawn_blocking(move || {
        let conn = db::open(&db_path)?;
        db::list_seasons(&conn, &show)
    })
    .await
    .map_err(|e| internal_error(e.to_string()))?
    .map_err(internal_error)?;
    Ok(Json(seasons))
}

async fn series_episodes(
    Query(q): Query<VideoQuery>,
    State(st): State<ServerState>,
) -> Result<Json<Vec<db::MediaItem>>, (StatusCode, Json<ApiResponse>)> {
    let Some(show) = q.show.clone() else {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ApiResponse {
                success: false,
                message: "show parametresi zorunlu".into(),
            }),
        ));
    };
    let db_path = st.db_path.clone();
    let season = q.season;
    let episodes = tokio::task::spawn_blocking(move || {
        let conn = db::open(&db_path)?;
        db::list_episodes(&conn, &show, season)
    })
    .await
    .map_err(|e| internal_error(e.to_string()))?
    .map_err(internal_error)?;
    Ok(Json(episodes))
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

#[derive(Serialize)]
pub struct PlayerSettingResponse {
    pub kind: String,
    pub player: Option<String>,
}

async fn get_player_setting_route(
    Query(q): Query<PlayerSettingQuery>,
    State(st): State<ServerState>,
) -> Result<Json<PlayerSettingResponse>, (StatusCode, Json<ApiResponse>)> {
    let db_path = st.db_path.clone();
    let kind = q.kind.clone();
    let val = tokio::task::spawn_blocking(move || {
        let conn = db::open(&db_path)?;
        db::get_setting_opt(&conn, &format!("player_{kind}"))
    })
    .await
    .map_err(|e| internal_error(e.to_string()))?
    .map_err(internal_error)?;

    Ok(Json(PlayerSettingResponse {
        kind: q.kind,
        player: val,
    }))
}

async fn set_player_setting_route(
    State(st): State<ServerState>,
    headers: HeaderMap,
    Json(payload): Json<SetPlayerSettingPayload>,
) -> Result<Json<ApiResponse>, (StatusCode, Json<ApiResponse>)> {
    check_auth(&st, &headers).await?;
    let db_path = st.db_path.clone();
    let kind = payload.kind.clone();
    let id = payload.id.clone();
    tokio::task::spawn_blocking(move || {
        let conn = db::open(&db_path)?;
        db::set_setting(&conn, &format!("player_{kind}"), &id)
    })
    .await
    .map_err(|e| internal_error(e.to_string()))?
    .map_err(internal_error)?;

    Ok(Json(ApiResponse {
        success: true,
        message: "Oynatıcı ayarı kaydedildi".into(),
    }))
}

#[derive(Debug, PartialEq, Eq)]
enum ByteRange {
    FromTo(u64, u64),
    From(u64),
    Suffix(u64),
}

fn parse_range_header(header: &str) -> Option<ByteRange> {
    let header = header.trim();
    if !header.starts_with("bytes=") {
        return None;
    }
    let spec = &header["bytes=".len()..].trim();
    let spec = spec.split(',').next()?.trim();
    if let Some(suffix) = spec.strip_prefix('-') {
        let n: u64 = suffix.parse().ok()?;
        Some(ByteRange::Suffix(n))
    } else {
        let mut parts = spec.splitn(2, '-');
        let start_str = parts.next()?.trim();
        let end_str = parts.next()?.trim();
        let start: u64 = start_str.parse().ok()?;
        if end_str.is_empty() {
            Some(ByteRange::From(start))
        } else {
            let end: u64 = end_str.parse().ok()?;
            Some(ByteRange::FromTo(start, end))
        }
    }
}

fn mime_for_path(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .as_deref()
    {
        Some("mp3") => "audio/mpeg",
        Some("flac") => "audio/flac",
        Some("m4a") => "audio/mp4",
        Some("aac") => "audio/aac",
        Some("wav") => "audio/wav",
        Some("ogg") => "audio/ogg",
        Some("opus") => "audio/opus",
        Some("aiff") | Some("aif") => "audio/aiff",
        Some("wma") => "audio/x-ms-wma",
        Some("mp4") => "video/mp4",
        Some("mkv") => "video/x-matroska",
        Some("webm") => "video/webm",
        Some("mov") => "video/quicktime",
        _ => "application/octet-stream",
    }
}

/// `/api/stream` — medya dosyası HTTP Range akışı (RFC 7233).
/// Gömülü ses oynatıcı için ses dosyalarını kesintisiz ve sarılabilir (seekable)
/// olarak parça parça (206 Partial Content) akıtır.
async fn stream_media(
    Query(q): Query<StreamQuery>,
    headers: HeaderMap,
    State(st): State<ServerState>,
) -> Response {
    let db_path = st.db_path.clone();
    let q_path = q.path.clone();
    let q_id = q.id.clone();

    // 1) Dosya yolunu belirle ve veritabanı indeksinde var olduğunu doğrula
    let resolved_path = tokio::task::spawn_blocking(move || -> Result<Option<String>, String> {
        let conn = db::open(&db_path)?;
        if let Some(ref p) = q_path {
            if db::path_exists(&conn, p)? {
                return Ok(Some(p.clone()));
            }
        }
        if let Some(ref id) = q_id {
            let found = conn
                .query_row(
                    "SELECT file_path FROM media_items WHERE id = ?1",
                    rusqlite::params![id],
                    |row| row.get::<_, String>(0),
                )
                .ok();
            if let Some(ref p) = found {
                if db::path_exists(&conn, p)? {
                    return Ok(Some(p.clone()));
                }
            }
        }
        Ok(None)
    })
    .await
    .ok()
    .and_then(|r| r.ok())
    .flatten();

    let Some(file_path) = resolved_path else {
        return (
            StatusCode::NOT_FOUND,
            "Medya dosyası bulunamadı veya indekste kayıtlı değil",
        )
            .into_response();
    };

    let path = PathBuf::from(&file_path);
    if !path.exists() {
        return (
            StatusCode::NOT_FOUND,
            "Dosya diskte bulunamadı. Disk çevrimdışı olabilir.",
        )
            .into_response();
    }

    let Ok(metadata) = tokio::fs::metadata(&path).await else {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Dosya metadata okunamadı",
        )
            .into_response();
    };

    let file_size = metadata.len();
    let mime_type = mime_for_path(&path);

    if file_size == 0 {
        return (
            StatusCode::OK,
            [
                (header::CONTENT_TYPE, mime_type.to_string()),
                (header::CONTENT_LENGTH, "0".to_string()),
                (header::ACCEPT_RANGES, "bytes".to_string()),
            ],
            axum::body::Body::empty(),
        )
            .into_response();
    }

    // Range başlığı varsa kısmi içerik (206 Partial Content) sun
    if let Some(range_header) = headers.get(header::RANGE).and_then(|v| v.to_str().ok()) {
        if let Some(range) = parse_range_header(range_header) {
            let (start, end) = match range {
                ByteRange::FromTo(s, e) => {
                    if s > e || s >= file_size {
                        return (
                            StatusCode::RANGE_NOT_SATISFIABLE,
                            [
                                (header::CONTENT_RANGE, format!("bytes */{file_size}")),
                                (header::ACCEPT_RANGES, "bytes".to_string()),
                            ],
                            axum::body::Body::empty(),
                        )
                            .into_response();
                    }
                    (s, e.min(file_size - 1))
                }
                ByteRange::From(s) => {
                    if s >= file_size {
                        return (
                            StatusCode::RANGE_NOT_SATISFIABLE,
                            [
                                (header::CONTENT_RANGE, format!("bytes */{file_size}")),
                                (header::ACCEPT_RANGES, "bytes".to_string()),
                            ],
                            axum::body::Body::empty(),
                        )
                            .into_response();
                    }
                    (s, file_size - 1)
                }
                ByteRange::Suffix(n) => {
                    if n == 0 {
                        return (
                            StatusCode::RANGE_NOT_SATISFIABLE,
                            [
                                (header::CONTENT_RANGE, format!("bytes */{file_size}")),
                                (header::ACCEPT_RANGES, "bytes".to_string()),
                            ],
                            axum::body::Body::empty(),
                        )
                            .into_response();
                    }
                    if n >= file_size {
                        (0, file_size - 1)
                    } else {
                        (file_size - n, file_size - 1)
                    }
                }
            };

            let mut file = match File::open(&path).await {
                Ok(f) => f,
                Err(e) => {
                    return (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("Dosya açılamadı: {e}"),
                    )
                        .into_response()
                }
            };

            if let Err(e) = file.seek(SeekFrom::Start(start)).await {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Arama hatası: {e}"),
                )
                    .into_response();
            }

            let content_length = end - start + 1;
            let take_reader = file.take(content_length);
            let stream = ReaderStream::new(take_reader);
            let body = axum::body::Body::from_stream(stream);

            return (
                StatusCode::PARTIAL_CONTENT,
                [
                    (header::CONTENT_TYPE, mime_type.to_string()),
                    (header::ACCEPT_RANGES, "bytes".to_string()),
                    (header::CONTENT_LENGTH, content_length.to_string()),
                    (
                        header::CONTENT_RANGE,
                        format!("bytes {start}-{end}/{file_size}"),
                    ),
                ],
                body,
            )
                .into_response();
        }
    }

    // Range başlığı yoksa tüm dosyayı akıt
    let file = match File::open(&path).await {
        Ok(f) => f,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Dosya açılamadı: {e}"),
            )
                .into_response()
        }
    };
    let stream = ReaderStream::new(file);
    let body = axum::body::Body::from_stream(stream);

    (
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, mime_type.to_string()),
            (header::ACCEPT_RANGES, "bytes".to_string()),
            (header::CONTENT_LENGTH, file_size.to_string()),
        ],
        body,
    )
        .into_response()
}

#[derive(Deserialize)]
pub struct VideoStreamQuery {
    pub path: Option<String>,
    pub id: Option<String>,
    pub start: Option<f64>,
}

#[derive(Deserialize)]
pub struct SubtitleQuery {
    pub path: Option<String>,
    pub video_path: Option<String>,
    pub track: Option<usize>,
}

/// `/api/ffmpeg/status` — Gömülü veya sistem FFmpeg durumu
async fn ffmpeg_status_route() -> Json<serde_json::Value> {
    let available = ffmpeg::is_available();
    let path = ffmpeg::find_ffmpeg().map(|p| p.to_string_lossy().to_string());
    Json(serde_json::json!({
        "available": available,
        "path": path,
    }))
}

fn path_session_id(p: &str, start: Option<f64>) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    p.hash(&mut hasher);
    let start_sec = start.map(|s| s as u64).unwrap_or(0);
    format!("vid_{:016x}_{}", hasher.finish(), start_sec)
}

fn url_encode(input: &str) -> String {
    let mut encoded = String::new();
    for byte in input.bytes() {
        match byte {
            b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                encoded.push(byte as char);
            }
            _ => {
                encoded.push_str(&format!("%{:02X}", byte));
            }
        }
    }
    encoded
}

/// `/api/stream/video` — Gömülü video oynatıcı akışı.
/// Native formatlar (mp4/webm/mov) doğrudan HTTP Range ile sunulur.
/// MKV/AVI gibi formatlar Safari / WebKit uyumlu HLS (.m3u8) akışına yönlendirilir.
async fn stream_video_route(
    Query(q): Query<VideoStreamQuery>,
    headers: HeaderMap,
    State(st): State<ServerState>,
) -> Response {
    let db_path = st.db_path.clone();
    let q_path = q.path.clone();
    let q_id = q.id.clone();

    // 1) Dosya yolunu belirle ve veritabanı indeksinde var olduğunu doğrula
    let resolved_path = tokio::task::spawn_blocking(move || -> Result<Option<String>, String> {
        let conn = db::open(&db_path)?;
        if let Some(ref p) = q_path {
            if db::path_exists(&conn, p)? {
                return Ok(Some(p.clone()));
            }
        }
        if let Some(ref id) = q_id {
            let found = conn
                .query_row(
                    "SELECT file_path FROM media_items WHERE id = ?1",
                    rusqlite::params![id],
                    |row| row.get::<_, String>(0),
                )
                .ok();
            if let Some(ref p) = found {
                if db::path_exists(&conn, p)? {
                    return Ok(Some(p.clone()));
                }
            }
        }
        Ok(None)
    })
    .await
    .ok()
    .and_then(|r| r.ok())
    .flatten();

    let Some(file_path) = resolved_path else {
        return (
            StatusCode::NOT_FOUND,
            "Video dosyası bulunamadı veya indekste kayıtlı değil",
        )
            .into_response();
    };

    let path = PathBuf::from(&file_path);
    if !path.exists() {
        return (
            StatusCode::NOT_FOUND,
            "Dosya diskte bulunamadı. Disk çevrimdışı olabilir.",
        )
            .into_response();
    }

    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    let is_native = matches!(ext.as_str(), "mp4" | "m4v" | "mov" | "webm");

    // Native format (mp4 vb.) ve başlangıç noktası istenmemişse doğrudan HTTP Range akışı kullan
    if is_native && q.start.is_none() {
        return stream_media(
            Query(StreamQuery {
                path: Some(file_path),
                id: None,
            }),
            headers,
            State(st),
        )
        .await;
    }

    // MKV veya FFmpeg gereken formatlar: HLS master playlist'e yönlendir (307 Temporary Redirect)
    let session = path_session_id(&file_path, q.start);
    let mut hls_target = format!("/api/hls/{session}/master.m3u8?path={}", url_encode(&file_path));
    if let Some(ss) = q.start {
        if ss > 0.05 {
            hls_target.push_str(&format!("&start={:.3}", ss));
        }
    }

    (
        StatusCode::TEMPORARY_REDIRECT,
        [(header::LOCATION, hls_target)],
    )
        .into_response()
}

/// `/api/hls/:session/master.m3u8` — HLS oynatma listesi
async fn hls_master_route(
    axum::extract::Path(session): axum::extract::Path<String>,
    Query(q): Query<VideoStreamQuery>,
    State(st): State<ServerState>,
) -> Response {
    let db_path = st.db_path.clone();
    let q_path = q.path.clone();
    let q_id = q.id.clone();

    // 1) Dosya yolunu belirle
    let resolved_path = tokio::task::spawn_blocking(move || -> Result<Option<String>, String> {
        let conn = db::open(&db_path)?;
        if let Some(ref p) = q_path {
            if db::path_exists(&conn, p)? {
                return Ok(Some(p.clone()));
            }
        }
        if let Some(ref id) = q_id {
            let found = conn
                .query_row(
                    "SELECT file_path FROM media_items WHERE id = ?1",
                    rusqlite::params![id],
                    |row| row.get::<_, String>(0),
                )
                .ok();
            if let Some(ref p) = found {
                if db::path_exists(&conn, p)? {
                    return Ok(Some(p.clone()));
                }
            }
        }
        Ok(None)
    })
    .await
    .ok()
    .and_then(|r| r.ok())
    .flatten();

    let Some(file_path) = resolved_path else {
        return (
            StatusCode::NOT_FOUND,
            "Video dosyası bulunamadı veya indekste kayıtlı değil",
        )
            .into_response();
    };

    let Some(ffmpeg_bin) = ffmpeg::find_ffmpeg() else {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            "FFmpeg ikili dosyası bulunamadı",
        )
            .into_response();
    };

    let session_dir = std::env::temp_dir().join("kura-hls").join(&session);
    let master_file = session_dir.join("master.m3u8");

    // Session kontrolü ve FFmpeg başlatma
    {
        let mut map = st.hls.sessions.lock().await;

        let needs_start = match map.get_mut(&session) {
            Some(existing) => {
                if existing.file_path != file_path || existing.start_seconds != q.start || !master_file.exists() {
                    if let Some(mut old_child) = existing.child.take() {
                        let _ = old_child.kill().await;
                    }
                    let _ = tokio::fs::remove_dir_all(&session_dir).await;
                    true
                } else {
                    false
                }
            }
            None => true,
        };

        if needs_start {
            // Aynı dosyaya ait önceki oturumları durdur ve geçici klasörlerini temizle
            let mut to_cleanup = Vec::new();
            for (s_id, entry) in map.iter_mut() {
                if entry.file_path == file_path && s_id != &session {
                    if let Some(mut old_child) = entry.child.take() {
                        let _ = old_child.kill().await;
                    }
                    to_cleanup.push(entry.dir.clone());
                }
            }
            for old_dir in to_cleanup {
                tokio::spawn(async move {
                    let _ = tokio::fs::remove_dir_all(&old_dir).await;
                });
            }

            let _ = tokio::fs::create_dir_all(&session_dir).await;
            let mut cmd = ffmpeg::create_hls_cmd(&ffmpeg_bin, &file_path, &session_dir, q.start);
            match cmd.spawn() {
                Ok(child) => {
                    map.insert(
                        session.clone(),
                        HlsSessionEntry {
                            child: Some(child),
                            dir: session_dir.clone(),
                            file_path: file_path.clone(),
                            start_seconds: q.start,
                            created_at: std::time::Instant::now(),
                        },
                    );
                }
                Err(e) => {
                    return (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("FFmpeg başlatılamadı: {e}"),
                    )
                        .into_response();
                }
            }
        }
    }

    // master.m3u8 dosyasının oluşmasını bekle (azami 3 saniye, her 50ms)
    for _ in 0..60 {
        if master_file.exists() {
            if let Ok(meta) = tokio::fs::metadata(&master_file).await {
                if meta.len() > 10 {
                    break;
                }
            }
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }

    if !master_file.exists() {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            "HLS playlist üretilemedi (zaman aşımı)",
        )
            .into_response();
    }

    match tokio::fs::read(&master_file).await {
        Ok(bytes) => (
            StatusCode::OK,
            [
                (header::CONTENT_TYPE, "application/vnd.apple.mpegurl".to_string()),
                (header::ACCESS_CONTROL_ALLOW_ORIGIN, "*".to_string()),
                (header::CACHE_CONTROL, "no-cache, no-store, must-revalidate".to_string()),
            ],
            bytes,
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Playlist okunamadı: {e}"),
        )
            .into_response(),
    }
}

/// `/api/hls/:session/stop` — HLS oturumunu ve FFmpeg child sürecini sonlandırır.
async fn hls_stop_route(
    axum::extract::Path(session): axum::extract::Path<String>,
    State(st): State<ServerState>,
) -> Response {
    if session.contains("..") || session.contains('/') || session.contains('\\') {
        return (StatusCode::BAD_REQUEST, "Geçersiz oturum").into_response();
    }

    let mut map = st.hls.sessions.lock().await;
    if let Some(mut entry) = map.remove(&session) {
        if let Some(mut child) = entry.child.take() {
            let _ = child.kill().await;
        }
        let dir = entry.dir;
        drop(map);
        tokio::spawn(async move {
            let _ = tokio::fs::remove_dir_all(&dir).await;
        });
        return (StatusCode::OK, Json(serde_json::json!({ "success": true, "stopped": true }))).into_response();
    }

    // Bellekte yoksa bile temp klasörünü temizle
    let session_dir = std::env::temp_dir().join("kura-hls").join(&session);
    drop(map);
    if session_dir.exists() {
        let _ = tokio::fs::remove_dir_all(&session_dir).await;
    }

    (StatusCode::OK, Json(serde_json::json!({ "success": true, "stopped": false }))).into_response()
}

/// `/api/hls/:session/:file` — HLS parçacıklarını (.ts, .m3u8) sunar
async fn hls_file_route(
    axum::extract::Path((session, file)): axum::extract::Path<(String, String)>,
    State(_st): State<ServerState>,
) -> Response {
    if file.contains("..") || file.contains('/') || file.contains('\\') {
        return (StatusCode::BAD_REQUEST, "Geçersiz dosya adı").into_response();
    }

    let session_dir = std::env::temp_dir().join("kura-hls").join(&session);
    let target = session_dir.join(&file);

    // .ts dosyaları için dosyanın diske yazılmasını bekle (azami 4 saniye)
    for _ in 0..40 {
        if target.exists() {
            if let Ok(meta) = tokio::fs::metadata(&target).await {
                if meta.len() > 0 {
                    break;
                }
            }
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }

    if !target.exists() {
        return (StatusCode::NOT_FOUND, "Segment bulunamadı").into_response();
    }

    let is_ts = file.ends_with(".ts");
    let content_type = if is_ts {
        "video/MP2T"
    } else if file.ends_with(".m3u8") {
        "application/vnd.apple.mpegurl"
    } else {
        "application/octet-stream"
    };

    let cache_control = if is_ts {
        "public, max-age=3600"
    } else {
        "no-cache, no-store, must-revalidate"
    };

    match tokio::fs::read(&target).await {
        Ok(bytes) => (
            StatusCode::OK,
            [
                (header::CONTENT_TYPE, content_type.to_string()),
                (header::ACCESS_CONTROL_ALLOW_ORIGIN, "*".to_string()),
                (header::CACHE_CONTROL, cache_control.to_string()),
            ],
            bytes,
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Segment okunamadı: {e}"),
        )
            .into_response(),
    }
}

/// Altyazı dosyasını okuyup UTF-8 veya Windows-1254 (CP1254) olarak çözümleyip WebVTT'ye dönüştürür.
async fn read_sub_to_vtt(p: &Path) -> Option<String> {
    let bytes = tokio::fs::read(p).await.ok()?;
    let text = match String::from_utf8(bytes.clone()) {
        Ok(s) => s,
        Err(_) => ffmpeg::decode_windows1254(&bytes),
    };
    let is_vtt = p
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .as_deref()
        == Some("vtt");
    if is_vtt {
        Some(text)
    } else {
        Some(ffmpeg::srt_to_vtt(&text))
    }
}

/// `/api/subtitle` — SRT altyazılarını anında WebVTT'ye çevirir veya MKV dahili altyazısını çıkarır.
async fn subtitle_route(
    Query(q): Query<SubtitleQuery>,
    State(st): State<ServerState>,
) -> Response {
    let sub_headers = [
        (header::CONTENT_TYPE, "text/vtt; charset=utf-8".to_string()),
        (header::ACCESS_CONTROL_ALLOW_ORIGIN, "*".to_string()),
        (header::CACHE_CONTROL, "public, max-age=3600".to_string()),
    ];

    // 1. Doğrudan altyazı dosyası yolu verilmişse
    if let Some(ref sub_path) = q.path {
        let p = Path::new(sub_path);
        if p.exists() {
            if let Some(vtt) = read_sub_to_vtt(p).await {
                return (StatusCode::OK, sub_headers, vtt).into_response();
            }
        }
    }

    // 2. Video yolu verilmişse DB'den eşleşen altyazıyı kontrol et
    if let Some(ref vp) = q.video_path {
        let db_path = st.db_path.clone();
        let video_p = vp.clone();
        let found_sub = tokio::task::spawn_blocking(move || {
            let conn = db::open(&db_path).ok()?;
            db::subtitle_for_path(&conn, &video_p).ok().flatten()
        })
        .await
        .ok()
        .flatten();

        if let Some(sub_file) = found_sub {
            let p = Path::new(&sub_file);
            if p.exists() {
                if let Some(vtt) = read_sub_to_vtt(p).await {
                    return (StatusCode::OK, sub_headers, vtt).into_response();
                }
            }
        }

        // 3. DB'de altyazı yoksa bile video dosyasının hemen yanındaki .srt / .vtt dosyalarını ara
        let video_path_obj = Path::new(vp);
        let srt_candidate = video_path_obj.with_extension("srt");
        if srt_candidate.exists() {
            if let Some(vtt) = read_sub_to_vtt(&srt_candidate).await {
                return (StatusCode::OK, sub_headers, vtt).into_response();
            }
        }
        let vtt_candidate = video_path_obj.with_extension("vtt");
        if vtt_candidate.exists() {
            if let Some(vtt) = read_sub_to_vtt(&vtt_candidate).await {
                return (StatusCode::OK, sub_headers, vtt).into_response();
            }
        }
        // Klasördeki diğer olası altyazı dosyaları (.tr.srt, Turkish.srt vb.)
        if let Some(parent) = video_path_obj.parent() {
            if let Ok(mut entries) = tokio::fs::read_dir(parent).await {
                while let Ok(Some(entry)) = entries.next_entry().await {
                    let ep = entry.path();
                    let name = ep.file_name().and_then(|n| n.to_str()).unwrap_or("").to_lowercase();
                    if name.ends_with(".srt") || name.ends_with(".vtt") {
                        if let Some(vtt) = read_sub_to_vtt(&ep).await {
                            return (StatusCode::OK, sub_headers, vtt).into_response();
                        }
                    }
                }
            }
        }

        // 4. Harici altyazı yoksa dahili altyazı parçasını (track) FFmpeg ile çıkar
        if let Some(ffmpeg_bin) = ffmpeg::find_ffmpeg() {
            let track_idx = q.track.unwrap_or(0);
            let mut cmd = ffmpeg::create_subtitle_cmd(&ffmpeg_bin, vp, track_idx);
            if let Ok(output) = cmd.output().await {
                if output.status.success() {
                    let vtt = String::from_utf8_lossy(&output.stdout).to_string();
                    if !vtt.trim().is_empty() {
                        return (StatusCode::OK, sub_headers, vtt).into_response();
                    }
                }
            }
        }
    }

    (StatusCode::NOT_FOUND, "Altyazı bulunamadı").into_response()
}

#[derive(Deserialize)]
pub struct MediaProbeQuery {
    pub path: Option<String>,
}

#[derive(Serialize)]
pub struct MediaProbeResponse {
    pub success: bool,
    pub duration: Option<f64>,
}

#[derive(Deserialize)]
pub struct MediaKeyframeQuery {
    pub path: Option<String>,
    pub start: Option<f64>,
}

#[derive(Serialize)]
pub struct MediaKeyframeResponse {
    pub success: bool,
    /// İstenen zamandan önceki (veya eşit) gerçek keyframe zamanı (saniye).
    pub keyframe: Option<f64>,
    /// İstemcinin istediği hedef zaman.
    pub requested: Option<f64>,
}

/// `/api/media/probe` — Video/medya dosyasının süresini hızlıca tespit eder (<50ms).
/// Önce veritabanında arar, yoksa FFmpeg ile header'dan süreyi okuyup DB'ye yazar.
async fn media_probe_route(
    Query(q): Query<MediaProbeQuery>,
    State(st): State<ServerState>,
) -> Json<MediaProbeResponse> {
    let Some(file_path) = q.path else {
        return Json(MediaProbeResponse {
            success: false,
            duration: None,
        });
    };

    let db_path = st.db_path.clone();
    let fp_check = file_path.clone();

    // 1. Önce DB'de kayıtlı süresi var mı kontrol et
    let cached_dur = tokio::task::spawn_blocking(move || {
        let conn = db::open(&db_path).ok()?;
        conn.query_row(
            "SELECT duration FROM media_items WHERE file_path = ?1 AND duration IS NOT NULL AND duration > 0",
            rusqlite::params![fp_check],
            |row| row.get::<_, f64>(0),
        )
        .ok()
    })
    .await
    .ok()
    .flatten();

    if let Some(dur) = cached_dur {
        return Json(MediaProbeResponse {
            success: true,
            duration: Some(dur),
        });
    }

    // 2. FFmpeg ile anında tespit et (<50ms)
    if let Some(ffmpeg_bin) = ffmpeg::find_ffmpeg() {
        if let Some(dur) = ffmpeg::probe_duration(&ffmpeg_bin, &file_path).await {
            let db_path2 = st.db_path.clone();
            let fp2 = file_path.clone();
            let _ = tokio::task::spawn_blocking(move || {
                if let Ok(conn) = db::open(&db_path2) {
                    let dur_int = dur.round() as i64;
                    let _ = conn.execute(
                        "UPDATE media_items SET duration = ?1 WHERE file_path = ?2",
                        rusqlite::params![dur_int, fp2],
                    );
                }
            })
            .await;

            return Json(MediaProbeResponse {
                success: true,
                duration: Some(dur),
            });
        }
    }

    Json(MediaProbeResponse {
        success: false,
        duration: None,
    })
}

/// `/api/media/keyframe` — Verilen zamandan önceki en yakın video keyframe zamanını döner.
/// HLS `-ss` + copy seek sonrası altyazı senkronu için frontend `hlsOffset` olarak kullanır.
async fn media_keyframe_route(
    Query(q): Query<MediaKeyframeQuery>,
    State(st): State<ServerState>,
) -> Json<MediaKeyframeResponse> {
    let Some(file_path) = q.path else {
        return Json(MediaKeyframeResponse {
            success: false,
            keyframe: None,
            requested: None,
        });
    };
    let requested = q.start.unwrap_or(0.0).max(0.0);

    if requested <= 0.05 {
        return Json(MediaKeyframeResponse {
            success: true,
            keyframe: Some(0.0),
            requested: Some(requested),
        });
    }

    // Dosyanın indekste olduğunu doğrula (opsiyonel güvenlik)
    let db_path = st.db_path.clone();
    let fp_check = file_path.clone();
    let indexed = tokio::task::spawn_blocking(move || {
        let conn = db::open(&db_path).ok()?;
        db::path_exists(&conn, &fp_check).ok()
    })
    .await
    .ok()
    .flatten()
    .unwrap_or(false);

    if !indexed && !PathBuf::from(&file_path).exists() {
        return Json(MediaKeyframeResponse {
            success: false,
            keyframe: None,
            requested: Some(requested),
        });
    }

    if let Some(ffprobe) = ffmpeg::find_ffprobe() {
        if let Some(kf) = ffmpeg::probe_keyframe_before(&ffprobe, &file_path, requested).await {
            return Json(MediaKeyframeResponse {
                success: true,
                keyframe: Some(kf),
                requested: Some(requested),
            });
        }
    }

    // ffprobe yoksa veya başarısızsa istenen zamanı döndür (eski davranışa düş)
    Json(MediaKeyframeResponse {
        success: true,
        keyframe: Some(requested),
        requested: Some(requested),
    })
}

#[derive(Deserialize)]
pub struct LastfmCompletePayload {
    pub token: String,
}

#[derive(Deserialize)]
pub struct LastfmSettingsPayload {
    pub enabled: bool,
}

#[derive(Deserialize)]
pub struct LastfmNowPlayingPayload {
    pub artist: String,
    pub track: String,
    pub album: Option<String>,
    pub duration: Option<u64>,
}

#[derive(Deserialize)]
pub struct LastfmScrobblePayload {
    pub artist: String,
    pub track: String,
    pub timestamp: u64,
    pub album: Option<String>,
    pub duration: Option<u64>,
}

async fn lastfm_status_route(
    State(st): State<ServerState>,
) -> Result<Json<lastfm::LastFmStatus>, (StatusCode, Json<ApiResponse>)> {
    let db_path = st.db_path.clone();
    let status = tokio::task::spawn_blocking(move || {
        let conn = db::open(&db_path)?;
        Ok::<_, String>(lastfm::get_status(&conn))
    })
    .await
    .map_err(|e| internal_error(e.to_string()))?
    .map_err(internal_error)?;

    Ok(Json(status))
}

async fn lastfm_auth_url_route(
    State(st): State<ServerState>,
) -> Result<Json<lastfm::AuthUrlResponse>, (StatusCode, Json<ApiResponse>)> {
    let db_path = st.db_path.clone();
    let keys = tokio::task::spawn_blocking(move || {
        let conn = db::open(&db_path)?;
        Ok::<_, String>(lastfm::resolve_api_keys(Some(&conn)))
    })
    .await
    .map_err(|e| internal_error(e.to_string()))?
    .map_err(internal_error)?;

    let (api_key, _) = keys.ok_or_else(|| {
        internal_error("Last.fm API Key bulunamadı (.env dosyasını kontrol edin)".to_string())
    })?;

    let res = lastfm::start_auth(&api_key)
        .await
        .map_err(internal_error)?;
    Ok(Json(res))
}

async fn lastfm_complete_auth_route(
    State(st): State<ServerState>,
    Json(payload): Json<LastfmCompletePayload>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ApiResponse>)> {
    let db_path = st.db_path.clone();
    let keys = tokio::task::spawn_blocking({
        let db_path = db_path.clone();
        move || {
            let conn = db::open(&db_path)?;
            Ok::<_, String>(lastfm::resolve_api_keys(Some(&conn)))
        }
    })
    .await
    .map_err(|e| internal_error(e.to_string()))?
    .map_err(internal_error)?;

    let (api_key, secret) = keys.ok_or_else(|| internal_error("Last.fm API Key bulunamadı".to_string()))?;
    let (username, session_key) = lastfm::create_session(&api_key, &secret, &payload.token)
        .await
        .map_err(internal_error)?;

    let user_clone = username.clone();
    tokio::task::spawn_blocking(move || {
        let conn = db::open(&db_path)?;
        db::set_setting(&conn, "lastfm_username", &user_clone)?;
        db::set_setting(&conn, "lastfm_session_key", &session_key)?;
        db::set_setting(&conn, "lastfm_scrobble_enabled", "true")?;
        Ok::<_, String>(())
    })
    .await
    .map_err(|e| internal_error(e.to_string()))?
    .map_err(internal_error)?;

    Ok(Json(serde_json::json!({
        "success": true,
        "username": username
    })))
}

async fn lastfm_disconnect_route(
    State(st): State<ServerState>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ApiResponse>)> {
    let db_path = st.db_path.clone();
    tokio::task::spawn_blocking(move || {
        let conn = db::open(&db_path)?;
        lastfm::disconnect(&conn)
    })
    .await
    .map_err(|e| internal_error(e.to_string()))?
    .map_err(internal_error)?;

    Ok(Json(serde_json::json!({ "success": true })))
}

async fn lastfm_settings_route(
    State(st): State<ServerState>,
    Json(payload): Json<LastfmSettingsPayload>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ApiResponse>)> {
    let db_path = st.db_path.clone();
    tokio::task::spawn_blocking(move || {
        let conn = db::open(&db_path)?;
        lastfm::set_scrobble_enabled(&conn, payload.enabled)
    })
    .await
    .map_err(|e| internal_error(e.to_string()))?
    .map_err(internal_error)?;

    Ok(Json(serde_json::json!({ "success": true })))
}

async fn lastfm_now_playing_route(
    State(st): State<ServerState>,
    Json(p): Json<LastfmNowPlayingPayload>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ApiResponse>)> {
    let db_path = st.db_path.clone();
    let creds = tokio::task::spawn_blocking(move || {
        let conn = db::open(&db_path)?;
        let status = lastfm::get_status(&conn);
        if !status.connected || !status.scrobble_enabled {
            return Ok::<_, String>(None);
        }
        let keys = lastfm::resolve_api_keys(Some(&conn));
        let sk = db::get_setting_opt(&conn, "lastfm_session_key")?;
        Ok(keys.zip(sk))
    })
    .await
    .map_err(|e| internal_error(e.to_string()))?
    .map_err(internal_error)?;

    if let Some(((api_key, secret), sk)) = creds {
        if let Err(e) = lastfm::update_now_playing(
            &api_key,
            &secret,
            &sk,
            &p.artist,
            &p.track,
            p.album.as_deref(),
            p.duration,
        )
        .await
        {
            eprintln!("Last.fm now playing hatası: {e}");
        }
    }

    Ok(Json(serde_json::json!({ "success": true })))
}

async fn lastfm_scrobble_route(
    State(st): State<ServerState>,
    Json(p): Json<LastfmScrobblePayload>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ApiResponse>)> {
    let db_path = st.db_path.clone();
    let creds = tokio::task::spawn_blocking(move || {
        let conn = db::open(&db_path)?;
        let status = lastfm::get_status(&conn);
        if !status.connected || !status.scrobble_enabled {
            return Ok::<_, String>(None);
        }
        let keys = lastfm::resolve_api_keys(Some(&conn));
        let sk = db::get_setting_opt(&conn, "lastfm_session_key")?;
        Ok(keys.zip(sk))
    })
    .await
    .map_err(|e| internal_error(e.to_string()))?
    .map_err(internal_error)?;

    if let Some(((api_key, secret), sk)) = creds {
        lastfm::scrobble(
            &api_key,
            &secret,
            &sk,
            &p.artist,
            &p.track,
            p.timestamp,
            p.album.as_deref(),
            p.duration,
        )
        .await
        .map_err(internal_error)?;
    }

    Ok(Json(serde_json::json!({ "success": true })))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn test_parse_range_header() {
        assert_eq!(
            parse_range_header("bytes=0-499"),
            Some(ByteRange::FromTo(0, 499))
        );
        assert_eq!(
            parse_range_header("bytes=500-"),
            Some(ByteRange::From(500))
        );
        assert_eq!(
            parse_range_header("bytes=-500"),
            Some(ByteRange::Suffix(500))
        );
        assert_eq!(
            parse_range_header("bytes=100-200, 300-400"),
            Some(ByteRange::FromTo(100, 200))
        );
        assert_eq!(parse_range_header("invalid"), None);
        assert_eq!(parse_range_header("bytes="), None);
        assert_eq!(parse_range_header("bytes=abc-"), None);
    }

    #[test]
    fn test_mime_for_path() {
        assert_eq!(mime_for_path(Path::new("song.mp3")), "audio/mpeg");
        assert_eq!(mime_for_path(Path::new("track.flac")), "audio/flac");
        assert_eq!(mime_for_path(Path::new("audio.m4a")), "audio/mp4");
        assert_eq!(mime_for_path(Path::new("sound.wav")), "audio/wav");
        assert_eq!(mime_for_path(Path::new("music.ogg")), "audio/ogg");
        assert_eq!(mime_for_path(Path::new("stream.opus")), "audio/opus");
        assert_eq!(mime_for_path(Path::new("movie.mkv")), "video/x-matroska");
        assert_eq!(mime_for_path(Path::new("clip.mp4")), "video/mp4");
        assert_eq!(mime_for_path(Path::new("unknown.xyz")), "application/octet-stream");
    }
}


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
use tokio::fs::File;
use tokio::io::{AsyncReadExt, AsyncSeekExt, SeekFrom};
use tokio_util::io::ReaderStream;

#[derive(Clone)]
pub struct ServerState {
    pub db_path: PathBuf,
    pub dist: PathBuf,
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
        .route("/api/meta", get(media_meta))
        .route("/api/movies", get(movies_route))
        .route("/api/movies/files", get(movie_files_route))
        .route("/api/series/shows", get(series_shows))
        .route("/api/series/seasons", get(series_seasons))
        .route("/api/series/episodes", get(series_episodes))
        .route("/api/open-batch", post(open_batch))
        .route("/api/stream", get(stream_media))
        .route(
            "/api/settings/player",
            get(get_player_setting_route).post(set_player_setting_route),
        )
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


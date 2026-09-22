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
use std::{net::SocketAddr, path::PathBuf};
use tower_http::cors::CorsLayer;
use tower_http::services::ServeDir;

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
        scanner::scan_directory(&conn, std::path::Path::new(&path), disk_label.as_deref())
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

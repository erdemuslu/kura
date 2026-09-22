//! SQLite veri havuzu: bağlantı, migration'lar ve sorgular.
//! Her işlem kısa ömürlü bir `Connection` açar (spawn_blocking ile çağrılır),
//! böylece IPC komutları ve Axum handler'ları kilitsiz/çatışmasız çalışır.

use rusqlite::{named_params, params, Connection};
use serde::Serialize;
use std::path::Path;
use uuid::Uuid;

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS media_items (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    artist TEXT,
    album TEXT,
    media_type TEXT NOT NULL,          -- 'movie', 'series', 'music'
    file_path TEXT UNIQUE NOT NULL,
    file_size INTEGER NOT NULL,
    disk_label TEXT NOT NULL,
    format TEXT NOT NULL,
    duration INTEGER,                 -- saniye
    cover_image_path TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_media_items_type ON media_items(media_type);
CREATE INDEX IF NOT EXISTS idx_media_items_title ON media_items(title);
CREATE INDEX IF NOT EXISTS idx_media_items_disk ON media_items(disk_label);
CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"#;

#[derive(Debug, Serialize)]
pub struct MediaItem {
    pub id: String,
    pub title: String,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub media_type: String,
    pub file_path: String,
    pub file_size: i64,
    pub disk_label: String,
    pub format: String,
    pub duration: Option<i64>,
    pub cover_image_path: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

/// Tarama sırasında doldurulan, `media_items` tablosuna upsert edilen kayıt.
pub struct NewMediaItem {
    pub title: String,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub media_type: &'static str,
    pub file_path: String,
    pub file_size: i64,
    pub disk_label: String,
    pub format: String,
    pub duration: Option<i64>,
}

pub fn open(db_path: &Path) -> Result<Connection, String> {
    Connection::open(db_path).map_err(|e| format!("Veritabanı açılamadı: {e}"))
}

/// Şemayı oluşturur ve varsayılan ayarları (token vb.) ilk kullanımda üretir.
pub fn init(db_path: &Path) -> Result<Connection, String> {
    let conn = open(db_path)?;
    conn.execute_batch(SCHEMA)
        .map_err(|e| format!("Migration hatası: {e}"))?;
    ensure_default_setting(&conn, "remote_auth_enabled", "false")?;
    // Uzaktan erişim token'ı ilk açılışta bir kez üretilir ve saklanır.
    ensure_default_setting(&conn, "remote_token", &Uuid::new_v4().to_string())?;
    Ok(conn)
}

fn ensure_default_setting(conn: &Connection, key: &str, default_value: &str) -> Result<(), String> {
    conn.execute(
        "INSERT OR IGNORE INTO app_settings (key, value) VALUES (?1, ?2)",
        params![key, default_value],
    )
    .map(|_| ())
    .map_err(|e| e.to_string())
}

pub fn get_setting(conn: &Connection, key: &str) -> Result<String, String> {
    conn.query_row(
        "SELECT value FROM app_settings WHERE key = ?1",
        params![key],
        |row| row.get(0),
    )
    .map_err(|e| e.to_string())
}

#[allow(dead_code)]
pub fn set_setting(conn: &Connection, key: &str, value: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO app_settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )
    .map(|_| ())
    .map_err(|e| e.to_string())
}

/// Dosya yoluna göre upsert; disk yeniden tarandığında kayıt güncellenir.
pub fn upsert_media(conn: &Connection, item: &NewMediaItem) -> Result<(), String> {
    conn.execute(
        "INSERT INTO media_items
             (id, title, artist, album, media_type, file_path, file_size, disk_label, format, duration)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
         ON CONFLICT(file_path) DO UPDATE SET
             title = excluded.title,
             artist = excluded.artist,
             album = excluded.album,
             media_type = excluded.media_type,
             file_size = excluded.file_size,
             disk_label = excluded.disk_label,
             format = excluded.format,
             duration = excluded.duration,
             updated_at = CURRENT_TIMESTAMP",
        params![
            Uuid::new_v4().to_string(),
            item.title,
            item.artist,
            item.album,
            item.media_type,
            item.file_path,
            item.file_size,
            item.disk_label,
            item.format,
            item.duration,
        ],
    )
    .map(|_| ())
    .map_err(|e| e.to_string())
}

/// Belirtilen dosya yolu indekste kayıtlı mı? (open_media için güvenlik kontrolü)
pub fn path_exists(conn: &Connection, file_path: &str) -> Result<bool, String> {
    conn.query_row(
        "SELECT COUNT(*) FROM media_items WHERE file_path = ?1",
        params![file_path],
        |row| row.get::<_, i64>(0),
    )
    .map(|c| c > 0)
    .map_err(|e| e.to_string())
}

/// Kütüphane sorgusu: tür filtresi (opsiyonel) + başlıkta arama + sayfalama.
pub fn query_library(
    conn: &Connection,
    media_type: Option<&str>,
    query: Option<&str>,
    limit: i64,
    offset: i64,
) -> Result<Vec<MediaItem>, String> {
    let sql = "SELECT id, title, artist, album, media_type, file_path, file_size,
                      disk_label, format, duration, cover_image_path, created_at, updated_at
               FROM media_items
               WHERE (:media_type IS NULL OR media_type = :media_type)
                 AND (:q IS NULL OR title LIKE :q)
               ORDER BY title COLLATE NOCASE
               LIMIT :limit OFFSET :offset";

    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let items = stmt
        .query_map(
            named_params! {
                ":media_type": media_type,
                ":q": query.map(|q| format!("%{q}%")),
                ":limit": limit,
                ":offset": offset,
            },
            map_media_item,
        )
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(items)
}

fn map_media_item(row: &rusqlite::Row) -> rusqlite::Result<MediaItem> {
    Ok(MediaItem {
        id: row.get(0)?,
        title: row.get(1)?,
        artist: row.get(2)?,
        album: row.get(3)?,
        media_type: row.get(4)?,
        file_path: row.get(5)?,
        file_size: row.get(6)?,
        disk_label: row.get(7)?,
        format: row.get(8)?,
        duration: row.get(9)?,
        cover_image_path: row.get(10)?,
        created_at: row.get(11)?,
        updated_at: row.get(12)?,
    })
}

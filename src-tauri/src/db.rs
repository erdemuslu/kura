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
    track_number INTEGER,
    disc_number INTEGER,
    year INTEGER,
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
    pub track_number: Option<i64>,
    pub disc_number: Option<i64>,
    pub year: Option<i64>,
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
    pub track_number: Option<i64>,
    pub disc_number: Option<i64>,
    pub year: Option<i64>,
}

/// Müzik tarayıcı: etiketi olmayan dosyalar için gösterilen adlar.
pub const UNKNOWN_ARTIST: &str = "Bilinmeyen Sanatçı";
pub const UNKNOWN_ALBUM: &str = "Bilinmeyen Albüm";

#[derive(Debug, Serialize)]
pub struct ArtistSummary {
    pub artist: String,
    pub album_count: i64,
    pub track_count: i64,
}

#[derive(Debug, Serialize)]
pub struct AlbumSummary {
    pub album: String,
    pub artist: String,
    pub track_count: i64,
    pub total_duration: Option<i64>,
}

pub fn open(db_path: &Path) -> Result<Connection, String> {
    Connection::open(db_path).map_err(|e| format!("Veritabanı açılamadı: {e}"))
}

/// Şemayı oluşturur ve varsayılan ayarları (token vb.) ilk kullanımda üretir.
pub fn init(db_path: &Path) -> Result<Connection, String> {
    let conn = open(db_path)?;
    conn.execute_batch(SCHEMA)
        .map_err(|e| format!("Migration hatası: {e}"))?;
    ensure_columns(&conn)?;
    ensure_default_setting(&conn, "remote_auth_enabled", "false")?;
    // Uzaktan erişim token'ı ilk açılışta bir kez üretilir ve saklanır.
    ensure_default_setting(&conn, "remote_token", &Uuid::new_v4().to_string())?;
    Ok(conn)
}

/// Mevcut DB'lerde (v0.1'de oluşturulan) yeni kolonları idempotent ekler:
/// PRAGMA table_info ile kontrol edilir, eksikse ALTER TABLE çalışır.
fn ensure_columns(conn: &Connection) -> Result<(), String> {
    let mut stmt = conn
        .prepare("PRAGMA table_info(media_items)")
        .map_err(|e| e.to_string())?;
    let existing: Vec<String> = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    drop(stmt);

    for (col, decl) in [
        ("track_number", "INTEGER"),
        ("disc_number", "INTEGER"),
        ("year", "INTEGER"),
    ] {
        if !existing.iter().any(|c| c == col) {
            conn.execute(
                &format!("ALTER TABLE media_items ADD COLUMN {col} {decl}"),
                [],
            )
            .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
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
             (id, title, artist, album, media_type, file_path, file_size, disk_label, format,
              duration, track_number, disc_number, year)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
         ON CONFLICT(file_path) DO UPDATE SET
             title = excluded.title,
             artist = excluded.artist,
             album = excluded.album,
             media_type = excluded.media_type,
             file_size = excluded.file_size,
             disk_label = excluded.disk_label,
             format = excluded.format,
             duration = excluded.duration,
             track_number = excluded.track_number,
             disc_number = excluded.disc_number,
             year = excluded.year,
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
            item.track_number,
            item.disc_number,
            item.year,
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
    let sql = &format!(
        "SELECT {MEDIA_COLS}
               FROM media_items
               WHERE (:media_type IS NULL OR media_type = :media_type)
                 AND (:q IS NULL OR title LIKE :q)
               ORDER BY title COLLATE NOCASE
               LIMIT :limit OFFSET :offset"
    );

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

/// Ortak kolon listesi — SELECT ve satır eşlemesinde aynı sırada kullanılır.
const MEDIA_COLS: &str = "id, title, artist, album, media_type, file_path, file_size,
                          disk_label, format, duration, track_number, disc_number, year,
                          cover_image_path, created_at, updated_at";

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
        track_number: row.get(10)?,
        disc_number: row.get(11)?,
        year: row.get(12)?,
        cover_image_path: row.get(13)?,
        created_at: row.get(14)?,
        updated_at: row.get(15)?,
    })
}

/// Sanatçıları albüm/şarkı sayılarıyla listeler (müzik tarayıcı üst seviye).
/// `q` varsa sanatçı/albüm/başlık alanlarında arar.
pub fn list_artists(
    conn: &Connection,
    query: Option<&str>,
) -> Result<Vec<ArtistSummary>, String> {
    let sql = "SELECT eff_artist, COUNT(DISTINCT eff_album), COUNT(*)
               FROM (
                   SELECT COALESCE(NULLIF(artist, ''), :unknown_artist) AS eff_artist,
                          COALESCE(NULLIF(album, ''), :unknown_album) AS eff_album
                   FROM media_items
                   WHERE media_type = 'music'
                     AND (:q IS NULL OR artist LIKE :q OR album LIKE :q OR title LIKE :q)
               )
               GROUP BY eff_artist
               ORDER BY eff_artist COLLATE NOCASE";

    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let artists = stmt
        .query_map(
            named_params! {
                ":unknown_artist": UNKNOWN_ARTIST,
                ":unknown_album": UNKNOWN_ALBUM,
                ":q": query.map(|q| format!("%{q}%")),
            },
            |row| {
                Ok(ArtistSummary {
                    artist: row.get(0)?,
                    album_count: row.get(1)?,
                    track_count: row.get(2)?,
                })
            },
        )
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(artists)
}

/// Albümleri (albüm, sanatçı, şarkı sayısı, toplam süre) listeler.
/// `artist` verilirse yalnız o sanatçının albümleri döner.
pub fn list_albums(
    conn: &Connection,
    artist: Option<&str>,
    query: Option<&str>,
) -> Result<Vec<AlbumSummary>, String> {
    let sql = "SELECT eff_album, eff_artist, COUNT(*), SUM(duration)
               FROM (
                   SELECT COALESCE(NULLIF(album, ''), :unknown_album) AS eff_album,
                          COALESCE(NULLIF(artist, ''), :unknown_artist) AS eff_artist,
                          duration
                   FROM media_items
                   WHERE media_type = 'music'
                     AND (:artist IS NULL
                          OR COALESCE(NULLIF(artist, ''), :unknown_artist) = :artist)
                     AND (:q IS NULL OR album LIKE :q OR artist LIKE :q OR title LIKE :q)
               )
               GROUP BY eff_album, eff_artist
               ORDER BY eff_album COLLATE NOCASE";

    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let albums = stmt
        .query_map(
            named_params! {
                ":unknown_artist": UNKNOWN_ARTIST,
                ":unknown_album": UNKNOWN_ALBUM,
                ":artist": artist,
                ":q": query.map(|q| format!("%{q}%")),
            },
            |row| {
                Ok(AlbumSummary {
                    album: row.get(0)?,
                    artist: row.get(1)?,
                    track_count: row.get(2)?,
                    total_duration: row.get(3)?,
                })
            },
        )
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(albums)
}

/// Bir albümün şarkılarını disk + track numarasına göre sıralı döndürür.
pub fn album_tracks(
    conn: &Connection,
    album: &str,
    artist: &str,
) -> Result<Vec<MediaItem>, String> {
    let sql = &format!(
        "SELECT {MEDIA_COLS}
         FROM media_items
         WHERE media_type = 'music'
           AND COALESCE(NULLIF(album, ''), :unknown_album) = :album
           AND COALESCE(NULLIF(artist, ''), :unknown_artist) = :artist
         ORDER BY COALESCE(disc_number, 1), COALESCE(track_number, 999999),
                  title COLLATE NOCASE"
    );

    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let tracks = stmt
        .query_map(
            named_params! {
                ":unknown_album": UNKNOWN_ALBUM,
                ":unknown_artist": UNKNOWN_ARTIST,
                ":album": album,
                ":artist": artist,
            },
            map_media_item,
        )
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(tracks)
}

/// Bir sanatçının tüm şarkılarını (albüm + sıra numarasına göre) döndürür.
/// "Tümünü Çal" menüsü için kullanılır.
pub fn artist_tracks(conn: &Connection, artist: &str) -> Result<Vec<MediaItem>, String> {
    let sql = &format!(
        "SELECT {MEDIA_COLS}
         FROM media_items
         WHERE media_type = 'music'
           AND COALESCE(NULLIF(artist, ''), :unknown_artist) = :artist
         ORDER BY COALESCE(NULLIF(album, ''), :unknown_album) COLLATE NOCASE,
                  COALESCE(disc_number, 1), COALESCE(track_number, 999999),
                  title COLLATE NOCASE"
    );

    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let tracks = stmt
        .query_map(
            named_params! {
                ":unknown_artist": UNKNOWN_ARTIST,
                ":artist": artist,
            },
            map_media_item,
        )
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(tracks)
}


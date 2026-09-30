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
    show_title TEXT,                   -- dizi adı (hiyerarşi kökü)
    season INTEGER,
    episode INTEGER,
    folder_path TEXT,                  -- film/dizi dosyasının üst klasörü
    subtitle_count INTEGER NOT NULL DEFAULT 0,
    subtitle_path TEXT,               -- en iyi eşleşen altyazının tam yolu
    genre TEXT,
    sample_rate INTEGER,                -- Hz (44100, 48000, …)
    bit_depth INTEGER,                 -- 16, 24, …
    channels INTEGER,                  -- 1 = mono, 2 = stereo
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
    pub show_title: Option<String>,
    pub season: Option<i64>,
    pub episode: Option<i64>,
    pub folder_path: Option<String>,
    pub subtitle_count: i64,
    pub subtitle_path: Option<String>,
    pub genre: Option<String>,
    pub sample_rate: Option<i64>,
    pub bit_depth: Option<i64>,
    pub channels: Option<i64>,
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
    pub show_title: Option<String>,
    pub season: Option<i64>,
    pub episode: Option<i64>,
    pub folder_path: Option<String>,
    pub subtitle_count: i64,
    pub subtitle_path: Option<String>,
    pub genre: Option<String>,
    pub sample_rate: Option<i64>,
    pub bit_depth: Option<i64>,
    pub channels: Option<i64>,
    pub cover_image_path: Option<String>,
}

/// Müzik tarayıcı: etiketi olmayan dosyalar için gösterilen adlar.
pub const UNKNOWN_ARTIST: &str = "Bilinmeyen Sanatçı";
pub const UNKNOWN_ALBUM: &str = "Bilinmeyen Albüm";
/// Dizi tarayıcı: desen bulunamayan bölümler için.
pub const UNKNOWN_SHOW: &str = "Bilinmeyen Dizi";

#[derive(Debug, Serialize)]
pub struct ArtistSummary {
    pub artist: String,
    pub album_count: i64,
    pub track_count: i64,
    pub folder_path: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct AlbumSummary {
    pub album: String,
    pub artist: String,
    pub track_count: i64,
    pub total_duration: Option<i64>,
    pub has_cover: bool,
    pub folder_path: Option<String>,
}

/// Film tarayıcı: bir klasördeki tüm video dosyalarını temsil eden grup kartı.
#[derive(Debug, Serialize)]
pub struct MovieGroup {
    pub title: String,
    /// Grup anahtarı: klasör yolu (eski kayıtlarda "file:<dosya yolu>").
    pub folder_path: String,
    pub file_count: i64,
    pub total_size: i64,
    pub has_subtitles: bool,
    pub disk_label: Option<String>,
}

/// Dizi tarayıcı: dizi özeti.
#[derive(Debug, Serialize)]
pub struct ShowSummary {
    pub show_title: String,
    pub season_count: i64,
    pub episode_count: i64,
    pub folder_path: Option<String>,
}

/// Dizi tarayıcı: sezon özeti.
#[derive(Debug, Serialize)]
pub struct SeasonSummary {
    pub season: i64,
    pub episode_count: i64,
}

/// Albüm adındaki [Disc 1], (Disc 2), CD 1 vb. ekleri temizler ve disk numarasını çıkarır.
pub fn clean_album_and_disc(album: &str, current_disc: Option<i64>) -> (String, Option<i64>) {
    let trimmed = album.trim();
    let lower = trimmed.to_lowercase();
    let markers = ["[disc ", "(disc ", "[cd ", "(cd ", " disc ", " cd "];
    for marker in markers {
        if let Some(idx) = lower.rfind(marker) {
            let rest = &trimmed[idx + marker.len()..];
            let num_str: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
            if !num_str.is_empty() {
                if let Ok(d) = num_str.parse::<i64>() {
                    let clean = trimmed[..idx].trim().trim_end_matches(['-', '_', ':']).trim();
                    if !clean.is_empty() {
                        return (clean.to_string(), current_disc.or(Some(d)));
                    }
                }
            }
        }
    }
    (trimmed.to_string(), current_disc)
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
    backfill_and_normalize_music(&conn)?;
    Ok(conn)
}

fn backfill_and_normalize_music(conn: &Connection) -> Result<(), String> {
    // 1. folder_path NULL olan müzik ve video kayıtlarına parent path backfill et
    let mut stmt = conn
        .prepare("SELECT id, file_path FROM media_items WHERE folder_path IS NULL")
        .map_err(|e| e.to_string())?;
    let rows: Vec<(String, String)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    drop(stmt);

    if !rows.is_empty() {
        let mut update_stmt = conn
            .prepare("UPDATE media_items SET folder_path = ?1 WHERE id = ?2")
            .map_err(|e| e.to_string())?;
        for (id, file_path) in rows {
            if let Some(parent) = Path::new(&file_path).parent() {
                let _ = update_stmt.execute(params![parent.to_string_lossy().to_string(), id]);
            }
        }
    }

    // 2. Müzik albüm adlarında [Disc 1], [Disc 2], [CD 1] gibi ekleri normalize et
    let mut stmt2 = conn
        .prepare("SELECT id, album, disc_number FROM media_items WHERE media_type = 'music' AND album IS NOT NULL")
        .map_err(|e| e.to_string())?;
    let music_rows: Vec<(String, String, Option<i64>)> = stmt2
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    drop(stmt2);

    let mut update_album_stmt = conn
        .prepare("UPDATE media_items SET album = ?1, disc_number = ?2 WHERE id = ?3")
        .map_err(|e| e.to_string())?;
    for (id, album, disc_num) in music_rows {
        let (clean_album, extracted_disc) = clean_album_and_disc(&album, disc_num);
        if clean_album != album || extracted_disc != disc_num {
            let _ = update_album_stmt.execute(params![clean_album, extracted_disc, id]);
        }
    }

    Ok(())
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
        ("show_title", "TEXT"),
        ("season", "INTEGER"),
        ("episode", "INTEGER"),
        ("folder_path", "TEXT"),
        ("subtitle_count", "INTEGER NOT NULL DEFAULT 0"),
        ("subtitle_path", "TEXT"),
        ("genre", "TEXT"),
        ("sample_rate", "INTEGER"),
        ("bit_depth", "INTEGER"),
        ("channels", "INTEGER"),
        ("album_artist", "TEXT"),
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

/// Ayarı okur; kayıt yoksa None döner (get_setting'in Option varyantı).
pub fn get_setting_opt(conn: &Connection, key: &str) -> Result<Option<String>, String> {
    conn.query_row(
        "SELECT value FROM app_settings WHERE key = ?1",
        params![key],
        |row| row.get(0),
    )
    .map(Some)
    .or_else(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => Ok(None),
        e => Err(e.to_string()),
    })
}

pub fn set_setting(conn: &Connection, key: &str, value: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO app_settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )
    .map(|_| ())
    .map_err(|e| e.to_string())
}

pub fn delete_setting(conn: &Connection, key: &str) -> Result<(), String> {
    conn.execute("DELETE FROM app_settings WHERE key = ?1", params![key])
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// İndekste kalmış gizli dosya kayıtlarını siler (basename '.' ile başlayanlar:
/// macOS `._*` AppleDouble çöpleri, `.DS_Store` vb.). Silinen kayıt sayısını döner.
///
/// Tarayıcı artık gizli dosyaları indekslemediğinden, bu fonksiyon yalnızca
/// geçmiş taramalardan kalan kayıtları temizler; her taramanın başında çağrılır.
pub fn cleanup_hidden_entries(conn: &Connection) -> Result<u64, String> {
    let mut stmt = conn
        .prepare("SELECT id, file_path FROM media_items")
        .map_err(|e| e.to_string())?;
    let rows: Vec<(String, String)> = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    drop(stmt);

    let mut deleted: u64 = 0;
    for (id, file_path) in rows {
        let is_hidden = Path::new(&file_path)
            .file_name()
            .map(|n| n.to_string_lossy().starts_with('.'))
            .unwrap_or(true);
        if is_hidden {
            conn.execute("DELETE FROM media_items WHERE id = ?1", params![id])
                .map_err(|e| e.to_string())?;
            deleted += 1;
        }
    }
    Ok(deleted)
}

/// Dosya yoluna göre upsert; disk yeniden tarandığında kayıt güncellenir.
pub fn upsert_media(conn: &Connection, item: &NewMediaItem) -> Result<(), String> {
    conn.execute(
        "INSERT INTO media_items
             (id, title, artist, album, media_type, file_path, file_size, disk_label,
              format, duration, track_number, disc_number, year, show_title, season,
              episode, folder_path, subtitle_count, subtitle_path, genre, sample_rate,
              bit_depth, channels, cover_image_path)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15,
                 ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24)
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
             show_title = excluded.show_title,
             season = excluded.season,
             episode = excluded.episode,
             folder_path = excluded.folder_path,
             subtitle_count = excluded.subtitle_count,
             subtitle_path = excluded.subtitle_path,
             genre = excluded.genre,
             sample_rate = excluded.sample_rate,
             bit_depth = excluded.bit_depth,
             channels = excluded.channels,
             cover_image_path = excluded.cover_image_path,
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
            item.show_title,
            item.season,
            item.episode,
            item.folder_path,
            item.subtitle_count,
            item.subtitle_path,
            item.genre,
            item.sample_rate,
            item.bit_depth,
            item.channels,
            item.cover_image_path,
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

/// Bir video dosyasının kayıtlı en iyi altyazı yolu (harici player'a geçirilir).
pub fn subtitle_for_path(conn: &Connection, file_path: &str) -> Result<Option<String>, String> {
    conn.query_row(
        "SELECT subtitle_path FROM media_items WHERE file_path = ?1",
        params![file_path],
        |row| row.get(0),
    )
    .map(Some)
    .or_else(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => Ok(None),
        e => Err(e.to_string()),
    })
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
                          show_title, season, episode, folder_path, subtitle_count,
                          subtitle_path, genre, sample_rate, bit_depth, channels,
                          cover_image_path, created_at, updated_at";

fn map_media_item(row: &rusqlite::Row) -> rusqlite::Result<MediaItem> {
    let duration: Option<i64> = match row.get_ref(9)? {
        rusqlite::types::ValueRef::Null => None,
        rusqlite::types::ValueRef::Integer(i) => Some(i),
        rusqlite::types::ValueRef::Real(r) => Some(r.round() as i64),
        _ => None,
    };

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
        duration,
        track_number: row.get(10)?,
        disc_number: row.get(11)?,
        year: row.get(12)?,
        show_title: row.get(13)?,
        season: row.get(14)?,
        episode: row.get(15)?,
        folder_path: row.get(16)?,
        subtitle_count: row.get(17)?,
        subtitle_path: row.get(18)?,
        genre: row.get(19)?,
        sample_rate: row.get(20)?,
        bit_depth: row.get(21)?,
        channels: row.get(22)?,
        cover_image_path: row.get(23)?,
        created_at: row.get(24)?,
        updated_at: row.get(25)?,
    })
}

/// Sanatçıları albüm/şarkı sayılarıyla listeler (müzik tarayıcı üst seviye).
/// `q` varsa sanatçı/albüm/başlık alanlarında arar.
pub fn list_artists(
    conn: &Connection,
    query: Option<&str>,
) -> Result<Vec<ArtistSummary>, String> {
    let sql = "SELECT eff_artist, COUNT(DISTINCT eff_album), COUNT(*), MIN(folder_path)
               FROM (
                   SELECT COALESCE(NULLIF(artist, ''), :unknown_artist) AS eff_artist,
                          COALESCE(NULLIF(album, ''), :unknown_album) AS eff_album,
                          folder_path
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
                    folder_path: row.get(3)?,
                })
            },
        )
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(artists)
}

/// Albümleri (albüm, sanatçı, şarkı sayısı, toplam süre) listeler.
/// Albümler tekil albüm adına göre gruplanır; çok sanatçılı albümlerde (compilation / düetler vb.)
/// parçalanma önlenerek en çok parçası olan baskın sanatçı veya 'Various Artists' seçilir.
/// `artist` verilirse o sanatçının parçası olan albümler döner.
pub fn list_albums(
    conn: &Connection,
    artist: Option<&str>,
    query: Option<&str>,
) -> Result<Vec<AlbumSummary>, String> {
    let sql = "SELECT m.eff_album,
                      COALESCE(
                          CASE WHEN COUNT(DISTINCT m.eff_artist) = 1 THEN MIN(m.eff_artist) ELSE NULL END,
                          (
                              SELECT a.artist 
                              FROM media_items a 
                              WHERE a.media_type = 'music' 
                                AND COALESCE(NULLIF(a.album, ''), :unknown_album) = m.eff_album
                              GROUP BY a.artist 
                              ORDER BY count(*) DESC 
                              LIMIT 1
                          ),
                          'Various Artists'
                      ) AS eff_artist,
                      COUNT(*) AS track_count,
                      SUM(m.duration) AS total_duration,
                      MAX(CASE WHEN m.cover_image_path IS NOT NULL THEN 1 ELSE 0 END) AS has_cover,
                      MIN(m.folder_path) AS folder_path
               FROM (
                   SELECT COALESCE(NULLIF(album, ''), :unknown_album) AS eff_album,
                          COALESCE(NULLIF(artist, ''), :unknown_artist) AS eff_artist,
                          duration,
                          cover_image_path,
                          folder_path
                   FROM media_items
                   WHERE media_type = 'music'
                     AND (:artist IS NULL
                          OR COALESCE(NULLIF(artist, ''), :unknown_artist) = :artist
                          OR album IN (SELECT album FROM media_items WHERE media_type = 'music' AND artist = :artist))
                     AND (:q IS NULL OR album LIKE :q OR artist LIKE :q OR title LIKE :q)
               ) m
               GROUP BY m.eff_album
               ORDER BY m.eff_album COLLATE NOCASE";

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
                    has_cover: row.get::<_, i64>(4)? != 0,
                    folder_path: row.get(5)?,
                })
            },
        )
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(albums)
}

/// Bir albümün şarkılarını disk + track numarasına göre sıralı döndürür.
/// Albümdeki tüm parçalar (derleme/düet dahil) eksiksiz gelir.
pub fn album_tracks(
    conn: &Connection,
    album: &str,
    _artist: &str,
) -> Result<Vec<MediaItem>, String> {
    let sql = &format!(
        "SELECT {MEDIA_COLS}
         FROM media_items
         WHERE media_type = 'music'
           AND COALESCE(NULLIF(album, ''), :unknown_album) = :album
         ORDER BY COALESCE(disc_number, 1), COALESCE(track_number, 999999),
                  title COLLATE NOCASE"
    );

    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let tracks = stmt
        .query_map(
            named_params! {
                ":unknown_album": UNKNOWN_ALBUM,
                ":album": album,
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

/// Bir albümün kayıtlı kapak yolunu döndürür (yoksa None).
/// `/api/cover` ucu buradan başlar.
pub fn cover_path_for_album(
    conn: &Connection,
    album: &str,
    artist: &str,
) -> Result<Option<String>, String> {
    conn.query_row(
        "SELECT cover_image_path FROM media_items
         WHERE media_type = 'music' AND cover_image_path IS NOT NULL
           AND COALESCE(NULLIF(album, ''), :unknown_album) = :album
         ORDER BY CASE WHEN artist = :artist THEN 0 ELSE 1 END
         LIMIT 1",
        named_params! {
            ":unknown_album": UNKNOWN_ALBUM,
            ":album": album,
            ":artist": artist,
        },
        |row| row.get(0),
    )
    .map(Some)
    .or_else(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => Ok(None),
        e => Err(e.to_string()),
    })
}

/// Albümün tüm parçalarına kapak yolunu yazar (iTunes fallback sonrası).
pub fn set_album_cover(
    conn: &Connection,
    album: &str,
    _artist: &str,
    cover_path: &str,
) -> Result<u64, String> {
    conn.execute(
        "UPDATE media_items
         SET cover_image_path = :path, updated_at = CURRENT_TIMESTAMP
         WHERE media_type = 'music'
           AND COALESCE(NULLIF(album, ''), :unknown_album) = :album",
        named_params! {
            ":unknown_album": UNKNOWN_ALBUM,
            ":album": album,
            ":path": cover_path,
        },
    )
    .map(|n| n as u64)
    .map_err(|e| e.to_string())
}

/// Filmleri klasör bazında gruplar (aynı klasördeki CD1/CD2 vb. tek kart olur).
/// Eski kayıtlarda folder_path NULL'dur; bunlar dosya başına ayrı grup olur
/// ("file:<yol>" sentetik anahtarıyla) — yeniden taramayla düzelir.
pub fn list_movies(conn: &Connection, query: Option<&str>) -> Result<Vec<MovieGroup>, String> {
    let sql = "SELECT COALESCE(NULLIF(folder_path, ''), 'file:' || file_path) AS gkey,
                      MAX(title), COUNT(*), SUM(file_size),
                      MAX(CASE WHEN subtitle_count > 0 THEN 1 ELSE 0 END),
                      MIN(disk_label)
               FROM media_items
               WHERE media_type = 'movie'
                 AND (:q IS NULL OR title LIKE :q)
               GROUP BY gkey
               ORDER BY 2 COLLATE NOCASE";

    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let groups = stmt
        .query_map(
            named_params! {
                ":q": query.map(|q| format!("%{q}%")),
            },
            |row| {
                Ok(MovieGroup {
                    folder_path: row.get(0)?,
                    title: row.get(1)?,
                    file_count: row.get(2)?,
                    total_size: row.get(3)?,
                    has_subtitles: row.get::<_, i64>(4)? != 0,
                    disk_label: row.get(5)?,
                })
            },
        )
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(groups)
}

/// Bir film grubunun dosyalarını (oynatma sırasına göre) döndürür.
pub fn movie_files(conn: &Connection, group_key: &str) -> Result<Vec<MediaItem>, String> {
    if let Some(fp) = group_key.strip_prefix("file:") {
        // Eski kayıt: grup anahtarı = dosya yolunun kendisi
        let sql = &format!(
            "SELECT {MEDIA_COLS} FROM media_items WHERE file_path = :fp LIMIT 1"
        );
        let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
        let files = stmt
            .query_map(named_params! { ":fp": fp }, map_media_item)
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        return Ok(files);
    }

    let sql = &format!(
        "SELECT {MEDIA_COLS} FROM media_items
         WHERE media_type = 'movie' AND folder_path = :key
         ORDER BY file_path COLLATE NOCASE"
    );
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let files = stmt
        .query_map(named_params! { ":key": group_key }, map_media_item)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(files)
}

/// Dizileri sezon/bölüm sayılarıyla listeler (dizi tarayıcı üst seviye).
pub fn list_shows(conn: &Connection, query: Option<&str>) -> Result<Vec<ShowSummary>, String> {
    let sql = "SELECT eff_show, COUNT(DISTINCT COALESCE(season, 1)), COUNT(*), MIN(folder_path)
               FROM (
                   SELECT COALESCE(NULLIF(show_title, ''), :unknown_show) AS eff_show,
                          season,
                          folder_path
                   FROM media_items
                   WHERE media_type = 'series'
                     AND (:q IS NULL OR show_title LIKE :q OR title LIKE :q)
               )
               GROUP BY eff_show
               ORDER BY eff_show COLLATE NOCASE";

    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let shows = stmt
        .query_map(
            named_params! {
                ":unknown_show": UNKNOWN_SHOW,
                ":q": query.map(|q| format!("%{q}%")),
            },
            |row| {
                Ok(ShowSummary {
                    show_title: row.get(0)?,
                    season_count: row.get(1)?,
                    episode_count: row.get(2)?,
                    folder_path: row.get(3)?,
                })
            },
        )
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(shows)
}

/// Belirtilen dizin veya yol öneki altındaki tüm medya kayıtlarını siler.
pub fn remove_source_path(conn: &Connection, path_prefix: &str) -> Result<usize, String> {
    let normalized = path_prefix.trim_end_matches(['/', '\\']);
    let pattern1 = format!("{normalized}%");
    let pattern2 = format!("{normalized}/%");
    let count = conn
        .execute(
            "DELETE FROM media_items WHERE file_path LIKE ?1 OR file_path LIKE ?2 OR folder_path LIKE ?1 OR folder_path LIKE ?2",
            params![pattern1, pattern2],
        )
        .map_err(|e| e.to_string())?;
    Ok(count)
}

/// Bir dizinin sezonlarını bölüm sayılarıyla listeler.
pub fn list_seasons(conn: &Connection, show: &str) -> Result<Vec<SeasonSummary>, String> {
    let sql = "SELECT COALESCE(season, 1), COUNT(*)
               FROM media_items
               WHERE media_type = 'series'
                 AND COALESCE(NULLIF(show_title, ''), :unknown_show) = :show
               GROUP BY 1
               ORDER BY 1";

    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let seasons = stmt
        .query_map(
            named_params! {
                ":unknown_show": UNKNOWN_SHOW,
                ":show": show,
            },
            |row| {
                Ok(SeasonSummary {
                    season: row.get(0)?,
                    episode_count: row.get(1)?,
                })
            },
        )
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(seasons)
}

/// Bir dizinin (tüm sezonların) bölümlerini sıralı döndürür.
/// `season` verilirse yalnız o sezon, yoksa tümü ("Tümünü Çal" için).
pub fn list_episodes(
    conn: &Connection,
    show: &str,
    season: Option<i64>,
) -> Result<Vec<MediaItem>, String> {
    let sql = &format!(
        "SELECT {MEDIA_COLS} FROM media_items
         WHERE media_type = 'series'
           AND COALESCE(NULLIF(show_title, ''), :unknown_show) = :show
           AND (:season IS NULL OR COALESCE(season, 1) = :season)
         ORDER BY COALESCE(season, 1), COALESCE(episode, 999999), title COLLATE NOCASE"
    );

    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let episodes = stmt
        .query_map(
            named_params! {
                ":unknown_show": UNKNOWN_SHOW,
                ":show": show,
                ":season": season,
            },
            map_media_item,
        )
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(episodes)
}

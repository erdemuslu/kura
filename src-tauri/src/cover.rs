//! Albüm kapağı çözümleme katmanı.
//!
//! Öncelik zinciri:
//!   1) Gömülü kapak (ID3 APIC / FLAC PICTURE / MP4 covr) → önbelleğe yazılır
//!   2) Albüm klasöründeki kapak dosyası (cover.jpg, folder.jpg, …)
//!   3) iTunes Search API (key'siz) — yalnızca REST `/api/cover` talebi üzerine
//!
//! Kapaklar `<app-data>/covers/` altında kalıcı önbelleklenir; harici disk
//! çıkarılsa da görüntülenebilir.

use std::path::{Path, PathBuf};
use std::time::Duration;

/// Albüm klasöründe aranan kapak dosya adları (sıra = öncelik).
const FOLDER_COVER_FILES: &[&str] = &[
    "cover.jpg",
    "cover.jpeg",
    "cover.png",
    "folder.jpg",
    "folder.png",
    "front.jpg",
    "front.png",
    "albumart.jpg",
    "albumart.png",
    "album.jpg",
];

const ITUNES_TIMEOUT: Duration = Duration::from_secs(5);

/// DB yolundan kapak önbellek dizinini türetir
/// (DB app-data dizininde tutulur; kapaklar yanındaki `covers/` altındadır).
pub fn covers_dir(db_path: &Path) -> PathBuf {
    db_path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join("covers")
}

/// FNV-1a hash — önbellek dosya adı için deterministik, yeni bağımlılık gerektirmez.
fn fnv1a(s: &str) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for b in s.as_bytes() {
        hash ^= *b as u64;
        hash = hash.wrapping_mul(0x100_0000_01b3);
    }
    hash
}

fn cache_file(covers_dir: &Path, artist: &str, album: &str, ext: &str) -> PathBuf {
    cache_file_for_key(
        covers_dir,
        &format!("{artist}\u{1f}{album}"),
        ext,
    )
}

/// Genel anahtara göre önbellek dosyası.
/// Müzik: "artist␟album", film: "movie␟başlık", dizi: "series␟başlık".
pub fn cache_file_for_key(covers_dir: &Path, key: &str, ext: &str) -> PathBuf {
    covers_dir.join(format!("{:016x}.{ext}", fnv1a(key)))
}

/// Gömülü kapağı önbelleğe yazar; dosya zaten varsa dokunmaz.
pub fn save_embedded(
    covers_dir: &Path,
    artist: &str,
    album: &str,
    mime: &str,
    data: &[u8],
) -> Result<PathBuf, String> {
    let ext = match mime {
        "image/png" => "png",
        "image/gif" => "gif",
        "image/bmp" => "bmp",
        _ => "jpg",
    };
    let path = cache_file(covers_dir, artist, album, ext);
    if path.exists() {
        return Ok(path);
    }
    std::fs::create_dir_all(covers_dir)
        .map_err(|e| format!("Kapak dizini oluşturulamadı: {e}"))?;
    std::fs::write(&path, data).map_err(|e| format!("Kapak yazılamadı: {e}"))?;
    Ok(path)
}

/// Albüm klasöründeki kapak dosyasını arar (gömülü kapak yoksa).
pub fn folder_cover(track_path: &Path) -> Option<PathBuf> {
    let dir = track_path.parent()?;
    for name in FOLDER_COVER_FILES {
        let p = dir.join(name);
        if p.is_file() {
            return Some(p);
        }
    }
    None
}

/// Film klasöründeki poster dosyasını arar (Plex/Jellyfin tarzı adlandırma):
/// poster.jpg, folder.jpg, cover.jpg veya "<klasör-adı>-poster.jpg".
/// TMDB'ye gitmeden önce ilk lokal kaynak.
pub fn movie_folder_poster(folder: &Path) -> Option<PathBuf> {
    const MOVIE_POSTER_FILES: &[&str] = &[
        "poster.jpg",
        "poster.jpeg",
        "poster.png",
        "folder.jpg",
        "folder.png",
        "cover.jpg",
        "cover.png",
    ];
    for name in MOVIE_POSTER_FILES {
        let p = folder.join(name);
        if p.is_file() {
            return Some(p);
        }
    }
    // "<klasör-adı>-poster.jpg" kuralı
    if let Some(name) = folder.file_name() {
        let p = folder.join(format!("{}-poster.jpg", name.to_string_lossy()));
        if p.is_file() {
            return Some(p);
        }
    }
    None
}

/// iTunes Search API fallback (API key gerektirmez): `artist album` arar,
/// 600x600 kapağı indirip önbelleğe yazar. Ağ hatası/sonuç yoksa sessizce
/// None döner — arayüzü asla bloklamaz.
pub async fn fetch_itunes_cover(
    covers_dir: &Path,
    artist: &str,
    album: &str,
) -> Option<PathBuf> {
    fetch_itunes(
        covers_dir,
        "album",
        &format!("{artist} {album}"),
        &format!("{artist}\u{1f}{album}"),
    )
    .await
}

/// iTunes Search API genel arama (key'siz). `entity`: album | movie | tvSeason.
/// `cache_key` önbellek dosya adını belirler — türler arasında çakışmayı önler.
pub async fn fetch_itunes(
    covers_dir: &Path,
    entity: &str,
    term: &str,
    cache_key: &str,
) -> Option<PathBuf> {
    let client = reqwest::Client::builder()
        .timeout(ITUNES_TIMEOUT)
        .build()
        .ok()?;

    let resp = client
        .get("https://itunes.apple.com/search")
        .query(&[
            ("term", term),
            ("entity", entity),
            ("limit", "1"),
        ])
        .send()
        .await
        .ok()?;
    let body: serde_json::Value = resp.json().await.ok()?;
    let art = body
        .get("results")?
        .get(0)?
        .get("artworkUrl100")?
        .as_str()?
        .to_string();
    // Apple URL şablonu: 100x100bb → 600x600bb ile yüksek çözünürlük
    let art600 = art.replace("100x100bb", "600x600bb");

    let bytes = client.get(&art600).send().await.ok()?.bytes().await.ok()?;
    let ext = if art600.contains(".png") { "png" } else { "jpg" };
    let path = cache_file_for_key(covers_dir, cache_key, ext);
    std::fs::create_dir_all(covers_dir).ok()?;
    std::fs::write(&path, &bytes).ok()?;
    Some(path)
}

/// TVmaze API (key'siz, yüksek çözünürlük) — dizi posteri.
/// `singlesearch/shows?q=` → `image.original`. Ağ hatasında sessizce None.
pub async fn fetch_tvmaze_poster(covers_dir: &Path, show: &str) -> Option<PathBuf> {
    let client = reqwest::Client::builder()
        .timeout(ITUNES_TIMEOUT)
        .build()
        .ok()?;

    let resp = client
        .get("https://api.tvmaze.com/singlesearch/shows")
        .query(&[("q", show)])
        .send()
        .await
        .ok()?;
    let body: serde_json::Value = resp.json().await.ok()?;
    let img = body
        .get("image")?
        .get("original")?
        .as_str()?
        .to_string();
    if img.is_empty() {
        return None;
    }

    let bytes = client.get(&img).send().await.ok()?.bytes().await.ok()?;
    let ext = if img.contains(".png") { "png" } else { "jpg" };
    let path = cache_file_for_key(covers_dir, &format!("tvmaze\u{1f}{show}"), ext);
    std::fs::create_dir_all(covers_dir).ok()?;
    std::fs::write(&path, &bytes).ok()?;
    Some(path)
}

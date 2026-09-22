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
    covers_dir.join(format!(
        "{:016x}.{ext}",
        fnv1a(&format!("{artist}\u{1f}{album}"))
    ))
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

/// iTunes Search API fallback (API key gerektirmez): `artist album` arar,
/// 600x600 kapağı indirip önbelleğe yazar. Ağ hatası/sonuç yoksa sessizce
/// None döner — arayüzü asla bloklamaz.
pub async fn fetch_itunes_cover(
    covers_dir: &Path,
    artist: &str,
    album: &str,
) -> Option<PathBuf> {
    let client = reqwest::Client::builder()
        .timeout(ITUNES_TIMEOUT)
        .build()
        .ok()?;

    let term = format!("{artist} {album}");
    let resp = client
        .get("https://itunes.apple.com/search")
        .query(&[
            ("term", term.as_str()),
            ("entity", "album"),
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
    let path = cache_file(covers_dir, artist, album, ext);
    std::fs::create_dir_all(covers_dir).ok()?;
    std::fs::write(&path, &bytes).ok()?;
    Some(path)
}

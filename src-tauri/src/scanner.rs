//! Dizin tarayıcı & metadata çıkarıcı.
//! WalkDir ile recursive tarama yapar; uzantıdan tür çıkarımı yapar
//! (dosya adında SxxExx deseni varsa "series"), müzik için lofty ile
//! ID3/FLAC metadata okur ve sonuçları SQLite'a upsert eder.

use crate::db::{self, NewMediaItem};
use rusqlite::Connection;
use serde::Serialize;
use std::path::Path;
use walkdir::WalkDir;

const VIDEO_EXTS: &[&str] = &[
    "mkv", "mp4", "avi", "mov", "m4v", "webm", "mpg", "mpeg", "ts", "wmv",
];
const AUDIO_EXTS: &[&str] = &[
    "mp3", "flac", "m4a", "wav", "aac", "ogg", "opus", "aiff", "wma",
];

#[derive(Serialize)]
pub struct ScanSummary {
    pub scanned_files: u64,
    pub indexed: u64,
    pub errors: u64,
    /// Bu taramanın başında indeksten silinen gizli/çöp kayıt sayısı.
    pub cleaned: u64,
    pub disk_label: String,
}

#[derive(Serialize)]
pub struct DiskInfo {
    pub label: String,
    pub path: String,
    pub online: bool,
}

#[derive(Clone, Copy, PartialEq)]
enum MediaKind {
    Video,
    Audio,
}

fn classify(ext: &str) -> Option<MediaKind> {
    let ext = ext.to_ascii_lowercase();
    if VIDEO_EXTS.contains(&ext.as_str()) {
        Some(MediaKind::Video)
    } else if AUDIO_EXTS.contains(&ext.as_str()) {
        Some(MediaKind::Audio)
    } else {
        None
    }
}

/// Dosya adında "SxxExx" (S01E01) deseni arar — dizi tespiti.
fn looks_like_episode(file_name: &str) -> bool {
    let b = file_name.to_ascii_uppercase().into_bytes();
    if b.len() < 6 {
        return false;
    }
    for i in 0..=(b.len() - 6) {
        if b[i] == b'S'
            && b[i + 1].is_ascii_digit()
            && b[i + 2].is_ascii_digit()
            && b[i + 3] == b'E'
            && b[i + 4].is_ascii_digit()
            && b[i + 5].is_ascii_digit()
        {
            return true;
        }
    }
    false
}

/// Yoldan disk etiketi çıkarır: /Volumes/<label>/..., D:\..., aksi halde "local".
pub fn detect_disk_label(path: &Path) -> String {
    let s = path.to_string_lossy();
    if let Some(rest) = s.strip_prefix("/Volumes/") {
        let label = rest.split('/').next().unwrap_or("");
        if !label.is_empty() {
            return label.to_string();
        }
    }
    #[cfg(target_os = "windows")]
    {
        if s.len() >= 2 && s.as_bytes()[1] == b':' {
            return s[..1].to_uppercase();
        }
    }
    "local".to_string()
}

/// Dosya gizli mi? (platforma özgü tespit)
/// - macOS/Linux: isim '.' ile başlar (POSIX gizli kuralı — `._*` AppleDouble,
///   `.DS_Store` vb. tek kuralda yakalanır)
/// - Windows: gizlilik isimle değil dosya attribute'u ile belirlenir
///   (FILE_ATTRIBUTE_HIDDEN biti); ayrıca cross-platform araçların ürettiği
///   '.' ile başlayan isimler için isim kontrolü de yapılır.
fn is_hidden_file(path: &Path) -> bool {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy())
        .unwrap_or_default();
    // POSIX gizli kuralı: '.' ile başlayan isimler
    if name.starts_with('.') {
        return true;
    }

    #[cfg(target_os = "windows")]
    {
        const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;
        if let Ok(meta) = std::fs::metadata(path) {
            use std::os::windows::fs::MetadataExt;
            return meta.file_attributes() & FILE_ATTRIBUTE_HIDDEN != 0;
        }
    }

    false
}

/// Bir dizini recursive tarar, medya dosyalarını SQLite'a indeksler.
pub fn scan_directory(
    conn: &Connection,
    root: &Path,
    disk_label: Option<&str>,
    covers_dir: &Path,
) -> Result<ScanSummary, String> {
    // İlerleme bildirimi olmadan (REST tarayıcı kullanımı)
    scan_directory_with_progress(conn, root, disk_label, covers_dir, &|_, _| {})
}

/// `scan_directory`'in ilerleme bildirimli varyantı:
/// `progress(scanned, indexed)` her 25 medya dosyasında bir çağrılır
/// (Tauri event'i olarak frontend'e yayınlanır).
pub fn scan_directory_with_progress(
    conn: &Connection,
    root: &Path,
    disk_label: Option<&str>,
    covers_dir: &Path,
    progress: &dyn Fn(u64, u64),
) -> Result<ScanSummary, String> {
    if !root.is_dir() {
        return Err(format!("Dizin bulunamadı: {}", root.display()));
    }
    let label = disk_label
        .map(str::to_string)
        .unwrap_or_else(|| detect_disk_label(root));
    // Bu taramadan önce indekste kalmış gizli dosya kayıtlarını temizle
    // (geçmiş taramalardan kalan `._*` çöpleri vb.).
    let cleaned = db::cleanup_hidden_entries(conn)?;
    let mut summary = ScanSummary {
        scanned_files: 0,
        indexed: 0,
        errors: 0,
        cleaned,
        disk_label: label,
    };
    // Albüm bazında çözülen kapak yolu — aynı albümün tüm parçaları paylaşır
    let mut album_covers: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();

    for entry in WalkDir::new(root)
        .min_depth(1)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path();
        // Gizli dosyaları atla (macOS `._*` AppleDouble, `.DS_Store`,
        // Windows gizli attribute'u vb.) — hiç indekslenmez, tarama
        // sayacına bile girmez.
        if is_hidden_file(path) {
            continue;
        }
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        let Some(kind) = classify(&ext) else { continue };
        summary.scanned_files += 1;

        let Ok(meta) = std::fs::metadata(path) else {
            summary.errors += 1;
            continue;
        };
        let file_path = path.to_string_lossy().to_string();
        let stem = path
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| file_path.clone());

        let item = match kind {
            MediaKind::Audio => {
                let mut m = read_audio_metadata(path, &stem);
                // Tag yoksa klasör yapısından çıkarım:
                // .../<sanatçı>/<albüm>/<dosya> → album ve artist fallback'i
                let (album_fb, artist_fb) = folder_fallbacks(path, root);
                if m.album.is_none() {
                    m.album = album_fb;
                }
                if m.artist.is_none() {
                    m.artist = artist_fb;
                }
                // Tag yoksa dosya adı başındaki sayı ("01 -", "12.", "7_")
                if m.track_number.is_none() {
                    m.track_number = track_from_stem(&stem);
                }
                // Kapak: gömülü (önbelleğe yazılır) → klasör kapağı → boş.
                // (iTunes fallback REST `/api/cover` talebiyle çalışır.)
                let cover_key = format!(
                    "{}\u{1f}{}",
                    m.artist.as_deref().unwrap_or(""),
                    m.album.as_deref().unwrap_or("")
                );
                let cover_path = match album_covers.get(&cover_key) {
                    Some(p) => Some(p.clone()),
                    None => {
                        let resolved = m
                            .cover
                            .as_ref()
                            .and_then(|(mime, data)| {
                                crate::cover::save_embedded(
                                    covers_dir,
                                    m.artist.as_deref().unwrap_or(""),
                                    m.album.as_deref().unwrap_or(""),
                                    mime,
                                    data,
                                )
                                .ok()
                            })
                            .or_else(|| crate::cover::folder_cover(path))
                            .map(|p| p.to_string_lossy().to_string());
                        if let Some(ref p) = resolved {
                            album_covers.insert(cover_key, p.clone());
                        }
                        resolved
                    }
                };
                NewMediaItem {
                    title: m.title,
                    artist: m.artist,
                    album: m.album,
                    media_type: "music",
                    file_path,
                    file_size: meta.len() as i64,
                    disk_label: summary.disk_label.clone(),
                    format: ext,
                    duration: m.duration,
                    track_number: m.track_number,
                    disc_number: m.disc_number,
                    year: m.year,
                    genre: m.genre,
                    sample_rate: m.sample_rate,
                    bit_depth: m.bit_depth,
                    channels: m.channels,
                    cover_image_path: cover_path,
                }
            }
            MediaKind::Video => NewMediaItem {
                title: stem,
                artist: None,
                album: None,
                media_type: if looks_like_episode(&file_path) {
                    "series"
                } else {
                    "movie"
                },
                file_path,
                file_size: meta.len() as i64,
                disk_label: summary.disk_label.clone(),
                format: ext,
                duration: None,
                track_number: None,
                disc_number: None,
                year: None,
                genre: None,
                sample_rate: None,
                bit_depth: None,
                channels: None,
                cover_image_path: None,
            },
        };

        match db::upsert_media(conn, &item) {
            Ok(()) => summary.indexed += 1,
            Err(_) => summary.errors += 1,
        }

        // İlerlemeyi periyodik bildir (her tarama adımında event taşmasın)
        if summary.scanned_files.is_multiple_of(25) {
            progress(summary.scanned_files, summary.indexed);
        }
    }
    Ok(summary)
}

/// lofty'den okunan + fallback'lerle tamamlanan müzik metadata'sı.
struct AudioMeta {
    title: String,
    artist: Option<String>,
    album: Option<String>,
    duration: Option<i64>,
    track_number: Option<i64>,
    disc_number: Option<i64>,
    year: Option<i64>,
    genre: Option<String>,
    sample_rate: Option<i64>,
    bit_depth: Option<i64>,
    channels: Option<i64>,
    /// Gömülü kapak: (mime, imaj byte'ları)
    cover: Option<(String, Vec<u8>)>,
}

/// lofty ile ID3/FLAC metadata okur; hata olursa dosya adına geri düşer.
/// Artist/album/track fallback'leri `scan_directory` içinde uygulanır.
fn read_audio_metadata(path: &Path, fallback_title: &str) -> AudioMeta {
    // AudioFile (properties), TaggedFileExt (primary_tag), Accessor (title/artist/album/...)
    use lofty::prelude::*;
    use lofty::picture::PictureType;

    match lofty::read_from_path(path) {
        Ok(tagged_file) => {
            let props = tagged_file.properties();
            let duration_secs = props.duration().as_secs();
            let tag = tagged_file.primary_tag();
            // Kapak: öncelik ön kapak (CoverFront), yoksa ilk gömülü resim
            let cover = tag.and_then(|t| {
                t.pictures()
                    .iter()
                    .find(|p| p.pic_type() == PictureType::CoverFront)
                    .or_else(|| t.pictures().first())
                    .map(|p| {
                        (
                            p.mime_type()
                                .map(|m| m.as_str().to_string())
                                .unwrap_or_else(|| "image/jpeg".into()),
                            p.data().to_vec(),
                        )
                    })
            });
            AudioMeta {
                title: tag
                    .and_then(|t| t.title().map(|s| s.to_string()))
                    .unwrap_or_else(|| fallback_title.to_string()),
                artist: tag.and_then(|t| t.artist().map(|s| s.to_string())),
                album: tag.and_then(|t| t.album().map(|s| s.to_string())),
                duration: if duration_secs > 0 {
                    Some(duration_secs as i64)
                } else {
                    None
                },
                track_number: tag.and_then(|t| t.track()).map(|n| n as i64),
                disc_number: tag.and_then(|t| t.disk()).map(|n| n as i64),
                year: tag.and_then(|t| t.year()).map(|n| n as i64),
                genre: tag.and_then(|t| t.genre().map(|s| s.to_string())),
                sample_rate: props.sample_rate().map(|v| v as i64),
                bit_depth: props.bit_depth().map(|v| v as i64),
                channels: props.channels().map(|v| v as i64),
                cover,
            }
        }
        Err(_) => AudioMeta {
            title: fallback_title.to_string(),
            artist: None,
            album: None,
            duration: None,
            track_number: None,
            disc_number: None,
            year: None,
            genre: None,
            sample_rate: None,
            bit_depth: None,
            channels: None,
            cover: None,
        },
    }
}

/// Klasör yapısından (sanatçı, albüm) çıkarımı:
/// `<root>/Sanatçı/Albüm/01 - Sarkı.mp3` → (Some("Albüm"), Some("Sanatçı")).
/// Dönüş sırası: (album_fallback, artist_fallback).
fn folder_fallbacks(path: &Path, root: &Path) -> (Option<String>, Option<String>) {
    let Ok(rel) = path.strip_prefix(root) else {
        return (None, None);
    };
    let comps: Vec<String> = rel
        .components()
        .filter_map(|c| match c {
            std::path::Component::Normal(name) => Some(name.to_string_lossy().to_string()),
            _ => None,
        })
        .collect();
    // comps son elemanı dosya; -2 = albüm klasörü, -3 = sanatçı klasörü
    let album = comps.len().checked_sub(2).and_then(|i| comps.get(i)).cloned();
    let artist = comps.len().checked_sub(3).and_then(|i| comps.get(i)).cloned();
    (album, artist)
}

/// Dosya adı başındaki track numarasını çıkarır: "01 - x", "12. y", "7_z" → 1, 12, 7.
fn track_from_stem(stem: &str) -> Option<i64> {
    let trimmed = stem.trim_start_matches([' ', '-', '_', '.']);
    let digits: String = trimmed
        .chars()
        .take_while(|c| c.is_ascii_digit())
        .collect();
    if digits.is_empty() || digits.len() > 3 {
        return None;
    }
    digits.parse().ok()
}

/// Bağlı (mount edilmiş) diskleri listeler.
pub fn list_disks() -> Vec<DiskInfo> {
    let mut disks = Vec::new();

    #[cfg(target_os = "macos")]
    {
        if let Ok(entries) = std::fs::read_dir("/Volumes") {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    disks.push(DiskInfo {
                        label: entry.file_name().to_string_lossy().to_string(),
                        path: path.to_string_lossy().to_string(),
                        online: true,
                    });
                }
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        for letter in b'A'..=b'Z' {
            let path = format!("{}:\\", letter as char);
            if Path::new(&path).is_dir() {
                disks.push(DiskInfo {
                    label: (letter as char).to_string(),
                    path: path.clone(),
                    online: true,
                });
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        // /media/<user>/<volume> ve /media/<volume> düzenleri
        if let Ok(entries) = std::fs::read_dir("/media") {
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_dir() {
                    continue;
                }
                let label = entry.file_name().to_string_lossy().to_string();
                let is_user_dir = path
                    .read_dir()
                    .map(|mut rd| rd.next().is_some())
                    .unwrap_or(false)
                    && std::fs::read_dir(&path)
                        .map(|mut rd| {
                            rd.flatten()
                                .any(|e| e.path().to_string_lossy().contains(&format!("/{}", &label)))
                        })
                        .unwrap_or(false);
                if is_user_dir {
                    if let Ok(volumes) = std::fs::read_dir(&path) {
                        for vol in volumes.flatten() {
                            let vol_path = vol.path();
                            if vol_path.is_dir() {
                                disks.push(DiskInfo {
                                    label: vol.file_name().to_string_lossy().to_string(),
                                    path: vol_path.to_string_lossy().to_string(),
                                    online: true,
                                });
                            }
                        }
                    }
                } else {
                    disks.push(DiskInfo {
                        label,
                        path: path.to_string_lossy().to_string(),
                        online: true,
                    });
                }
            }
        }
    }

    disks
}

/// LAN IP'sini döndürür (uzaktan kumanda URL'si için).
pub fn local_ip() -> Option<String> {
    #[cfg(target_os = "macos")]
    {
        let out = std::process::Command::new("ipconfig")
            .args(["getifaddr", "en0"])
            .output()
            .ok()?;
        if !out.status.success() {
            return None;
        }
        let ip = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if ip.is_empty() {
            None
        } else {
            Some(ip)
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        None
    }
}

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
/// Altyazı uzantıları — indekslenmez ama video dosyasına eşleşme sayılır.
const SUBTITLE_EXTS: &[&str] = &["srt", "sub", "ass", "ssa", "vtt"];
/// Bu anahtar kelimeleri içeren video dosyaları indekslenmez
/// (sample/trailer/teaser — kütüphane kartlarında istenmeyen girdiler).
const JUNK_STEM_MARKERS: &[&str] = &["sample", "trailer", "teaser"];

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

/// "sample", "trailer", "teaser" içeren video adları indekslenmez.
fn is_junk_stem(stem: &str) -> bool {
    let lower = stem.to_ascii_lowercase();
    JUNK_STEM_MARKERS.iter().any(|m| lower.contains(m))
}

/// Başlık temizleme: nokta/alt çizgi → boşluk, çoklu boşluklar tekilleştirilir.
/// "Film.Adi.2020.1080p" → "Film Adi 2020 1080p"
fn clean_title(s: &str) -> String {
    s.replace(['.', '_'], " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Dosya adından "S01E02" / "2x05" desenini çıkarır.
/// Döndürür: (sezon, bölüm, desen öncesindeki dizi adı öneki).
fn parse_episode_pattern(stem: &str) -> Option<(i64, i64, String)> {
    let chars: Vec<char> = stem.chars().collect();

    // S<sezon>E<bölüm> — 1-2 hane (S01E02, S1E1)
    let mut i = 0;
    while i + 2 < chars.len() {
        if chars[i] == 'S' || chars[i] == 's' {
            let mut j = i + 1;
            let mut season = String::new();
            while j < chars.len() && chars[j].is_ascii_digit() && season.len() < 2 {
                season.push(chars[j]);
                j += 1;
            }
            let has_e = j < chars.len() && (chars[j] == 'E' || chars[j] == 'e');
            if !season.is_empty() && has_e && j + 1 < chars.len() && chars[j + 1].is_ascii_digit()
            {
                let mut k = j + 1;
                let mut episode = String::new();
                while k < chars.len() && chars[k].is_ascii_digit() && episode.len() < 2 {
                    episode.push(chars[k]);
                    k += 1;
                }
                let prefix: String = stem.chars().take(i).collect();
                let prefix = prefix.trim_end_matches(['.', '-', '_', ' ', ')']).to_string();
                return Some((
                    season.parse().ok()?,
                    episode.parse().ok()?,
                    prefix,
                ));
            }
        }
        i += 1;
    }

    // <sezon>x<bölüm> — 1-2 hane ("2x05"). Önceki karakterin sayı OLMAMASI
    // zorunludur: "1920x1080" gibi çözünürlükler için false-positive koruması.
    let mut i = 0;
    while i + 2 < chars.len() {
        if chars[i].is_ascii_digit() {
            let mut j = i;
            let mut season = String::new();
            while j < chars.len() && chars[j].is_ascii_digit() && season.len() < 2 {
                season.push(chars[j]);
                j += 1;
            }
            let has_x = j < chars.len() && (chars[j] == 'x' || chars[j] == 'X');
            let prev_is_digit = i > 0 && chars[i - 1].is_ascii_digit();
            if !season.is_empty() && !prev_is_digit && has_x
                && j + 1 < chars.len() && chars[j + 1].is_ascii_digit()
            {
                let mut k = j + 1;
                let mut episode = String::new();
                while k < chars.len() && chars[k].is_ascii_digit() && episode.len() < 2 {
                    episode.push(chars[k]);
                    k += 1;
                }
                if !episode.is_empty() {
                    let prefix: String = stem.chars().take(i).collect();
                    let prefix =
                        prefix.trim_end_matches(['.', '-', '_', ' ', ')']).to_string();
                    return Some((season.parse().ok()?, episode.parse().ok()?, prefix));
                }
            }
        }
        i += 1;
    }
    None
}

/// Tarama kökü altındaki ilk klasör adını döndürür
/// ("Dizi Adı/Sezon 1/bölüm.mkv" → "Dizi Adı").
fn first_folder_under(path: &Path, root: &Path) -> Option<String> {
    let rel = path.strip_prefix(root).ok()?;
    rel.components().find_map(|c| match c {
        std::path::Component::Normal(name) => Some(name.to_string_lossy().to_string()),
        _ => None,
    })
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

    // 1. geçiş: dosyaları topla. (Bir video, altyazısından önce de
    // karşılaşabileceğimiz için altyazı haritası tüm dosyaları gerektirir.)
    let mut files: Vec<std::path::PathBuf> = Vec::new();
    for entry in WalkDir::new(root)
        .min_depth(1)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        if !entry.file_type().is_file() {
            continue;
        }
        // Gizli dosyaları atla (macOS `._*` AppleDouble, `.DS_Store`,
        // Windows gizli attribute'u vb.) — hiç indekslenmez, tarama
        // sayacına bile girmez.
        if is_hidden_file(entry.path()) {
            continue;
        }
        files.push(entry.into_path());
    }

    // Altyazı haritası: klasör → { dosya adı (stem) → altyazı yolları }
    let mut subs: std::collections::HashMap<
        String,
        std::collections::HashMap<String, Vec<std::path::PathBuf>>,
    > = std::collections::HashMap::new();
    for path in &files {
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if SUBTITLE_EXTS.contains(&ext.as_str()) {
            if let (Some(dir), Some(stem)) = (path.parent(), path.file_stem()) {
                subs.entry(dir.to_string_lossy().to_string())
                    .or_default()
                    .entry(stem.to_string_lossy().to_string())
                    .or_default()
                    .push(path.clone());
            }
        }
    }

    // 2. geçiş: medya dosyalarını indeksle
    for path in &files {
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        let Some(kind) = classify(&ext) else { continue };
        let file_path = path.to_string_lossy().to_string();
        let stem = path
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| file_path.clone());
        // Junk/fragman videoları (sample, trailer, teaser) indekslenmez
        if kind == MediaKind::Video && is_junk_stem(&stem) {
            continue;
        }
        summary.scanned_files += 1;

        let Ok(meta) = std::fs::metadata(path) else {
            summary.errors += 1;
            continue;
        };

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
                    show_title: None,
                    season: None,
                    episode: None,
                    folder_path: None,
                    subtitle_count: 0,
                    subtitle_path: None,
                    genre: m.genre,
                    sample_rate: m.sample_rate,
                    bit_depth: m.bit_depth,
                    channels: m.channels,
                    cover_image_path: cover_path,
                }
            }
            MediaKind::Video => {
                let folder_path = path
                    .parent()
                    .map(|p| p.to_string_lossy().to_string());
                // Aynı adlı altyazılar: sayı + en iyi eşleşme (".tr." öncelikli)
                let (subtitle_count, subtitle_path) = path
                    .parent()
                    .and_then(|d| subs.get(&d.to_string_lossy().to_string()))
                    .and_then(|m| m.get(&stem))
                    .map(|paths| {
                        let picked = paths
                            .iter()
                            .find(|p| {
                                p.file_name()
                                    .map(|n| n.to_string_lossy().to_ascii_lowercase().contains(".tr."))
                                    .unwrap_or(false)
                            })
                            .or_else(|| paths.first());
                        (
                            paths.len() as i64,
                            picked.map(|p| p.to_string_lossy().to_string()),
                        )
                    })
                    .unwrap_or((0, None));

                if let Some((season, episode, show_prefix)) = parse_episode_pattern(&stem) {
                    // Dizi: dosya adında SxxExx / xExx deseni bulundu
                    let show_title = if !show_prefix.is_empty() {
                        clean_title(&show_prefix)
                    } else {
                        // Desen öncesi metin yoksa: tarama kökü altındaki
                        // ilk klasör (örn. "Dizi Adı/Sezon 1/bölüm.mkv")
                        first_folder_under(path, root)
                            .map(|n| clean_title(&n))
                            .unwrap_or_else(|| db::UNKNOWN_SHOW.to_string())
                    };
                    NewMediaItem {
                        title: clean_title(&stem),
                        artist: None,
                        album: None,
                        media_type: "series",
                        show_title: Some(show_title),
                        season: Some(season),
                        episode: Some(episode),
                        folder_path,
                        subtitle_count,
                        subtitle_path,
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
                    }
                } else {
                    // Film: doğrudan tarama kökündeyse dosya adı,
                    // değilse klasör adı başlıktır (Plex/Jellyfin tarzı).
                    let at_root = path.parent() == Some(root);
                    let title = if at_root {
                        clean_title(&stem)
                    } else {
                        path.parent()
                            .and_then(|p| p.file_name())
                            .map(|n| clean_title(&n.to_string_lossy()))
                            .unwrap_or_else(|| clean_title(&stem))
                    };
                    NewMediaItem {
                        title,
                        artist: None,
                        album: None,
                        media_type: "movie",
                        show_title: None,
                        season: None,
                        episode: None,
                        folder_path,
                        subtitle_count,
                        subtitle_path,
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
                    }
                }
            }
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

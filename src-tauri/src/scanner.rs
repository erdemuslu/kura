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

/// Bir dizini recursive tarar, medya dosyalarını SQLite'a indeksler.
pub fn scan_directory(
    conn: &Connection,
    root: &Path,
    disk_label: Option<&str>,
) -> Result<ScanSummary, String> {
    if !root.is_dir() {
        return Err(format!("Dizin bulunamadı: {}", root.display()));
    }
    let label = disk_label
        .map(str::to_string)
        .unwrap_or_else(|| detect_disk_label(root));
    let mut summary = ScanSummary {
        scanned_files: 0,
        indexed: 0,
        errors: 0,
        disk_label: label,
    };

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
                let (title, artist, album, duration) = read_audio_metadata(path, &stem);
                NewMediaItem {
                    title,
                    artist,
                    album,
                    media_type: "music",
                    file_path,
                    file_size: meta.len() as i64,
                    disk_label: summary.disk_label.clone(),
                    format: ext,
                    duration,
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
            },
        };

        match db::upsert_media(conn, &item) {
            Ok(()) => summary.indexed += 1,
            Err(_) => summary.errors += 1,
        }
    }
    Ok(summary)
}

/// lofty ile ID3/FLAC metadata okur; hata olursa dosya adına geri düşer.
fn read_audio_metadata(
    path: &Path,
    fallback_title: &str,
) -> (String, Option<String>, Option<String>, Option<i64>) {
    // AudioFile (properties), TaggedFileExt (primary_tag), Accessor (title/artist/album)
    use lofty::prelude::*;

    match lofty::read_from_path(path) {
        Ok(tagged_file) => {
            let duration_secs = tagged_file.properties().duration().as_secs();
            let tag = tagged_file.primary_tag();
            let title = tag
                .and_then(|t| t.title().map(|s| s.to_string()))
                .unwrap_or_else(|| fallback_title.to_string());
            let artist = tag.and_then(|t| t.artist().map(|s| s.to_string()));
            let album = tag.and_then(|t| t.album().map(|s| s.to_string()));
            let duration = if duration_secs > 0 {
                Some(duration_secs as i64)
            } else {
                None
            };
            (title, artist, album, duration)
        }
        Err(_) => (fallback_title.to_string(), None, None, None),
    }
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

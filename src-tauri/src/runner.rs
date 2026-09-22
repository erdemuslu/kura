//! OS seviyesinde harici oynatıcı tetikleyici.
//! `target_app` beyaz liste ile sınırlıdır; LAN üzerinden keyfi komut
//! çalıştırılamaz. `system` = işletim sisteminin varsayılan uygulaması.

use std::path::Path;
use std::process::Command;

/// (id, görünen ad) — frontend'deki PLAYERS listesiyle eşleşir.
pub const PLAYERS: &[(&str, &str)] = &[
    ("system", "Sistem Varsayılanı"),
    ("VLC", "VLC"),
    ("IINA", "IINA"),
    ("Audirvana", "Audirvana"),
    ("foobar2000", "foobar2000"),
    ("QuickTime Player", "QuickTime Player"),
];

pub fn is_valid_player(target_app: &str) -> bool {
    PLAYERS.iter().any(|(id, _)| *id == target_app)
}

pub fn execute_player(file_path: &str, target_app: &str) -> Result<(), String> {
    if !is_valid_player(target_app) {
        return Err(format!("Desteklenmeyen oynatıcı: {target_app}"));
    }
    if !Path::new(file_path).exists() {
        return Err("Dosya bulunamadı. Disk çevrimdışı olabilir.".into());
    }
    launch(file_path, target_app)
}

/// Birden çok dosyayı tek bir .m3u8 playlist dosyasına yazıp oynatıcıya
/// açtırır ("Tümünü Çal" — şarkılar oynatıcının çalma listesine eklenir).
/// Çağıran taraf dosyaların indekste kayıtlı olduğunu doğrulamalıdır.
pub fn execute_playlist(
    file_paths: &[&str],
    target_app: &str,
    _playlist_title: &str,
) -> Result<(), String> {
    if !is_valid_player(target_app) {
        return Err(format!("Desteklenmeyen oynatıcı: {target_app}"));
    }
    if file_paths.is_empty() {
        return Err("Playlist boş — çalınacak şarkı yok".into());
    }

    let dir = std::env::temp_dir().join("local-media-hub-playlists");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Playlist dizini oluşturulamadı: {e}"))?;
    // Önceki oturumlardan kalan geçici playlistleri temizle.
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let _ = std::fs::remove_file(entry.path());
        }
    }

    let playlist_path = dir.join(format!("{}.m3u8", uuid::Uuid::new_v4()));
    let mut content = String::from("#EXTM3U\n");
    for p in file_paths {
        // Başlık EXTINF satırları eklemiyoruz: oynatıcılar gömülü
        // tag'lerden başlıkları kendileri okur.
        content.push_str(p);
        content.push('\n');
    }
    std::fs::write(&playlist_path, content)
        .map_err(|e| format!("Playlist yazılamadı: {e}"))?;

    launch(&playlist_path.to_string_lossy(), target_app)
}

/// OS'a özgü başlatma mantığı (beyaz liste kontrolü yapılmış kabul eder).
fn launch(file_path: &str, target_app: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let mut cmd = Command::new("open");
        if target_app != "system" {
            cmd.arg("-a").arg(target_app);
        }
        let status = cmd
            .arg(file_path)
            .status()
            .map_err(|e| format!("Komut çalıştırılamadı: {e}"))?;
        if status.success() {
            Ok(())
        } else {
            Err("Uygulama açılamadı".into())
        }
    }

    #[cfg(target_os = "windows")]
    {
        let status = if target_app == "system" {
            Command::new("cmd")
                .args(["/C", "start", "", file_path])
                .status()
                .map_err(|e| format!("Komut çalıştırılamadı: {e}"))?
        } else {
            Command::new(target_app)
                .arg(file_path)
                .status()
                .map_err(|e| format!("Komut çalıştırılamadı: {e}"))?
        };
        if status.success() {
            Ok(())
        } else {
            Err("Uygulama açılamadı".into())
        }
    }

    #[cfg(target_os = "linux")]
    {
        let status = if target_app == "system" {
            Command::new("xdg-open")
                .arg(file_path)
                .status()
                .map_err(|e| format!("Komut çalıştırılamadı: {e}"))?
        } else {
            Command::new(target_app)
                .arg(file_path)
                .status()
                .map_err(|e| format!("Komut çalıştırılamadı: {e}"))?
        };
        if status.success() {
            Ok(())
        } else {
            Err("Uygulama açılamadı".into())
        }
    }
}

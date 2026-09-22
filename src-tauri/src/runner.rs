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

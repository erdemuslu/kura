//! Gömülü ve sistem FFmpeg binary tespiti, transmux, HLS ve altyazı motoru.

use std::path::{Path, PathBuf};

/// Mevcut sistemde veya paket içinde FFmpeg ikili dosyasını arar.
pub fn find_ffmpeg() -> Option<PathBuf> {
    // 1. Packaged macOS .app bundle içinde (Contents/MacOS/ffmpeg)
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            let candidate = parent.join("ffmpeg");
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }

    // 2. Geliştirme modu adayları (proje dizini / binaries)
    let dev_candidates = [
        "src-tauri/binaries/ffmpeg-aarch64-apple-darwin",
        "binaries/ffmpeg-aarch64-apple-darwin",
        "../src-tauri/binaries/ffmpeg-aarch64-apple-darwin",
        "node_modules/ffmpeg-static/ffmpeg",
        "../node_modules/ffmpeg-static/ffmpeg",
    ];
    for c in dev_candidates {
        let p = PathBuf::from(c);
        if p.is_file() {
            if let Ok(canon) = p.canonicalize() {
                return Some(canon);
            }
            return Some(p);
        }
    }

    // 3. Sistem PATH (örn. /opt/homebrew/bin/ffmpeg veya /usr/local/bin/ffmpeg)
    if let Ok(output) = std::process::Command::new("which").arg("ffmpeg").output() {
        if output.status.success() {
            let path_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path_str.is_empty() {
                let p = PathBuf::from(path_str);
                if p.is_file() {
                    return Some(p);
                }
            }
        }
    }

    None
}

/// FFmpeg kullanılabilir durumda mı?
pub fn is_available() -> bool {
    find_ffmpeg().is_some()
}

/// SRT formatındaki metni standart WebVTT formatına dönüştürür.
pub fn srt_to_vtt(srt: &str) -> String {
    let mut vtt = String::with_capacity(srt.len() + 64);
    vtt.push_str("WEBVTT\n\n");
    for line in srt.lines() {
        let trimmed = line.trim();
        if trimmed.contains("-->") {
            vtt.push_str(&trimmed.replace(',', "."));
        } else {
            vtt.push_str(line);
        }
        vtt.push('\n');
    }
    vtt
}

/// Windows-1254 (Türkçe CP1254 / ISO-8859-9) bayt dizisini UTF-8 String'e dönüştürür.
pub fn decode_windows1254(bytes: &[u8]) -> String {
    bytes
        .iter()
        .map(|&b| match b {
            0x00..=0x7F => b as char,
            // Türkçe karakterler (Windows-1254 / ISO-8859-9)
            0xDE => 'Ş',
            0xFE => 'ş',
            0xDD => 'İ',
            0xFD => 'ı',
            0xD0 => 'Ğ',
            0xF0 => 'ğ',
            0xC7 => 'Ç',
            0xE7 => 'ç',
            0xD6 => 'Ö',
            0xF6 => 'ö',
            0xDC => 'Ü',
            0xFC => 'ü',
            // Tipografik işaretler (Windows-125x)
            0x80 => '€',
            0x82 => '‚',
            0x84 => '„',
            0x85 => '…',
            0x91 => '‘',
            0x92 => '’',
            0x93 => '“',
            0x94 => '”',
            0x95 => '•',
            0x96 => '–',
            0x97 => '—',
            0x99 => '™',
            0xAB => '«',
            0xBB => '»',
            other => other as char,
        })
        .collect()
}

/// HLS (.m3u8) paketleyici komutunu hazırlar.
/// - Video: Yeniden kodlama olmadan doğrudan kopyalanır (`-c:v copy`), CPU yükü sıfıra yakındır.
/// - Ses: Safari / WebKit ve tüm tarayıcıların kayıpsız çalabilmesi için standart stereo AAC 256k'ya transcode edilir.
pub fn create_hls_cmd(
    ffmpeg_path: &Path,
    file_path: &str,
    output_dir: &Path,
    start_seconds: Option<f64>,
) -> tokio::process::Command {
    let mut cmd = tokio::process::Command::new(ffmpeg_path);
    cmd.kill_on_drop(true);
    cmd.stdin(std::process::Stdio::null());
    cmd.stdout(std::process::Stdio::null());
    cmd.stderr(std::process::Stdio::null());
    cmd.arg("-nostdin");
    cmd.arg("-y");

    if let Some(ss) = start_seconds {
        if ss > 0.05 {
            cmd.arg("-ss").arg(format!("{:.3}", ss));
        }
    }

    cmd.arg("-i").arg(file_path);
    cmd.arg("-map").arg("0:v:0");
    cmd.arg("-map").arg("0:a:0?");
    cmd.arg("-c:v").arg("copy");
    cmd.arg("-c:a").arg("aac").arg("-ac").arg("2").arg("-b:a").arg("256k");
    cmd.arg("-af").arg("aresample=async=1000:first_pts=0");
    cmd.arg("-sn");
    cmd.arg("-avoid_negative_ts").arg("make_zero");
    cmd.arg("-f").arg("hls");
    cmd.arg("-hls_time").arg("3");
    cmd.arg("-hls_list_size").arg("0");
    cmd.arg("-hls_flags").arg("independent_segments");
    cmd.arg("-hls_segment_filename").arg(output_dir.join("seg_%04d.ts"));
    cmd.arg(output_dir.join("master.m3u8"));

    cmd
}

/// MKV/AVI gibi dosyaları doğrudan HTTP piped MP4 akışına çevirir (fallback amaçlı).
#[allow(dead_code)]
pub fn create_transmux_cmd(
    ffmpeg_path: &Path,
    file_path: &str,
    start_seconds: Option<f64>,
) -> tokio::process::Command {
    let mut cmd = tokio::process::Command::new(ffmpeg_path);
    cmd.kill_on_drop(true);
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::null());

    if let Some(ss) = start_seconds {
        if ss > 0.05 {
            cmd.arg("-ss").arg(format!("{:.3}", ss));
        }
    }

    cmd.arg("-i").arg(file_path);
    cmd.arg("-c:v").arg("copy");
    cmd.arg("-c:a").arg("aac").arg("-b:a").arg("256k");
    cmd.arg("-sn");
    cmd.arg("-movflags").arg("frag_keyframe+empty_moov+default_base_moof");
    cmd.arg("-f").arg("mp4");
    cmd.arg("pipe:1");

    cmd
}

/// Dahili altyazı parçasını WebVTT olarak stdout'a döker.
pub fn create_subtitle_cmd(
    ffmpeg_path: &Path,
    file_path: &str,
    track_index: usize,
) -> tokio::process::Command {
    let mut cmd = tokio::process::Command::new(ffmpeg_path);
    cmd.kill_on_drop(true);
    cmd.stdin(std::process::Stdio::null());
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::null());
    cmd.arg("-nostdin");

    cmd.arg("-i").arg(file_path);
    cmd.arg("-map").arg(format!("0:s:{}", track_index));
    cmd.arg("-f").arg("webvtt");
    cmd.arg("pipe:1");

    cmd
}

/// FFmpeg stderr çıktısından medya süresini (saniye cinsinden) ayıklar.
pub fn parse_duration_from_stderr(stderr: &str) -> Option<f64> {
    for line in stderr.lines() {
        if let Some(pos) = line.find("Duration:") {
            let rest = &line[pos + "Duration:".len()..];
            let time_str = rest.split(',').next()?.trim();
            // time_str örn: "01:43:34.84"
            let parts: Vec<&str> = time_str.split(':').collect();
            if parts.len() == 3 {
                let hours: f64 = parts[0].trim().parse().ok()?;
                let mins: f64 = parts[1].trim().parse().ok()?;
                let secs: f64 = parts[2].trim().parse().ok()?;
                return Some(hours * 3600.0 + mins * 60.0 + secs);
            }
        }
    }
    None
}

/// Medya dosyasının süresini FFmpeg ile anında (<50ms) tespit eder.
pub async fn probe_duration(ffmpeg_path: &Path, file_path: &str) -> Option<f64> {
    let mut cmd = tokio::process::Command::new(ffmpeg_path);
    cmd.kill_on_drop(true);
    cmd.stdin(std::process::Stdio::null());
    cmd.stdout(std::process::Stdio::null());
    cmd.stderr(std::process::Stdio::piped());
    cmd.arg("-nostdin");
    cmd.arg("-i").arg(file_path);
    cmd.arg("-t").arg("0");

    let output = cmd.output().await.ok()?;
    let stderr = String::from_utf8_lossy(&output.stderr);
    parse_duration_from_stderr(&stderr)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_duration() {
        let sample = "  Duration: 01:43:34.84, start: 0.000000, bitrate: 2819 kb/s";
        let dur = parse_duration_from_stderr(sample).unwrap();
        assert!((dur - 6214.84).abs() < 0.01);

        let sample2 = "Duration: 00:05:12.50, bitrate: 320 kb/s";
        let dur2 = parse_duration_from_stderr(sample2).unwrap();
        assert!((dur2 - 312.50).abs() < 0.01);

        assert_eq!(parse_duration_from_stderr("no duration here"), None);
    }
}


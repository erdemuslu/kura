//! Last.fm Scrobbler ve Now Playing entegrasyonu (Audioscrobbler 2.0 API).

use md5::{Digest, Md5};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::time::Duration;

const LASTFM_API_BASE: &str = "https://ws.audioscrobbler.com/2.0/";
const HTTP_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LastFmStatus {
    pub connected: bool,
    pub username: Option<String>,
    pub scrobble_enabled: bool,
    pub has_api_keys: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthUrlResponse {
    pub token: String,
    pub url: String,
}

/// .env dosyasından LASTFM_API_KEY ve LASTFM_SHARED_SECRET değerlerini okur.
pub fn load_env_keys() -> (Option<String>, Option<String>) {
    // 1. Ortam değişkenleri
    let env_key = std::env::var("LASTFM_API_KEY").ok().filter(|s| !s.is_empty());
    let env_secret = std::env::var("LASTFM_SHARED_SECRET").ok().filter(|s| !s.is_empty());
    if env_key.is_some() && env_secret.is_some() {
        return (env_key, env_secret);
    }

    // 2. Proje dizinleri (.env, ../.env, vs.)
    let candidates = [
        PathBuf::from(".env"),
        PathBuf::from("../.env"),
        PathBuf::from("../../.env"),
    ];

    for path in &candidates {
        if let Ok(content) = std::fs::read_to_string(path) {
            let mut key = None;
            let mut secret = None;
            for line in content.lines() {
                let trimmed = line.trim();
                if trimmed.starts_with('#') || trimmed.is_empty() {
                    continue;
                }
                if let Some((k, v)) = trimmed.split_once('=') {
                    let k = k.trim();
                    let v = v.trim().trim_matches('"').trim_matches('\'').to_string();
                    if k == "LASTFM_API_KEY" && !v.is_empty() {
                        key = Some(v);
                    } else if k == "LASTFM_SHARED_SECRET" && !v.is_empty() {
                        secret = Some(v);
                    }
                }
            }
            if key.is_some() && secret.is_some() {
                return (key, secret);
            }
        }
    }

    (env_key, env_secret)
}

/// Aktif Last.fm API anahtarlarını (key, secret) çözer:
/// 1. Veritabanındaki kullanıcı ayarları (varsa override)
/// 2. .env veya sistem ortam değişkenleri
/// 3. Derleme zamanı option_env!
pub fn resolve_api_keys(conn: Option<&Connection>) -> Option<(String, String)> {
    if let Some(conn) = conn {
        if let (Ok(Some(k)), Ok(Some(s))) = (
            crate::db::get_setting_opt(conn, "lastfm_api_key"),
            crate::db::get_setting_opt(conn, "lastfm_shared_secret"),
        ) {
            if !k.trim().is_empty() && !s.trim().is_empty() {
                return Some((k.trim().to_string(), s.trim().to_string()));
            }
        }
    }

    let (env_k, env_s) = load_env_keys();
    if let (Some(k), Some(s)) = (env_k, env_s) {
        return Some((k, s));
    }

    if let (Some(k), Some(s)) = (
        option_env!("LASTFM_API_KEY"),
        option_env!("LASTFM_SHARED_SECRET"),
    ) {
        if !k.is_empty() && !s.is_empty() {
            return Some((k.to_string(), s.to_string()));
        }
    }

    None
}

/// Last.fm API 2.0 MD5 imzasını (api_sig) üretir.
/// Kural:
/// 1. format ve callback parametreleri filtrelenir.
/// 2. Kalan parametreler anahtar adına göre alfabetik (ASCII) sıralanır.
/// 3. "anahtar1değer1anahtar2değer2...secret" birleştirilir.
/// 4. UTF-8 baytlarının küçük harfli MD5 özeti üretilir.
pub fn generate_signature(params: &[(String, String)], secret: &str) -> String {
    let mut filtered: Vec<(&str, &str)> = params
        .iter()
        .filter(|(k, _)| k != "format" && k != "callback")
        .map(|(k, v)| (k.as_str(), v.as_str()))
        .collect();
    filtered.sort_by(|a, b| a.0.cmp(b.0));

    let mut s = String::new();
    for (k, v) in filtered {
        s.push_str(k);
        s.push_str(v);
    }
    s.push_str(secret);

    let mut hasher = Md5::new();
    hasher.update(s.as_bytes());
    format!("{:x}", hasher.finalize())
}

/// Last.fm'den geçici bir yetkilendirme token'ı alır.
pub async fn get_auth_token(api_key: &str) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(HTTP_TIMEOUT)
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .get(LASTFM_API_BASE)
        .query(&[
            ("method", "auth.getToken"),
            ("api_key", api_key),
            ("format", "json"),
        ])
        .send()
        .await
        .map_err(|e| format!("Last.fm sunucusuna bağlanılamadı: {e}"))?;

    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Last.fm yanıtı okunamadı: {e}"))?;

    if let Some(err_msg) = json.get("message").and_then(|m| m.as_str()) {
        return Err(format!("Last.fm hatası: {err_msg}"));
    }

    json.get("token")
        .and_then(|t| t.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "Geçerli bir yetkilendirme token'ı alınamadı".to_string())
}

/// Token ile web yetkilendirme URL'sini hazırlar ve döner.
pub async fn start_auth(api_key: &str) -> Result<AuthUrlResponse, String> {
    let token = get_auth_token(api_key).await?;
    let url = format!(
        "https://www.last.fm/api/auth/?api_key={}&token={}",
        api_key, token
    );
    // macOS / masaüstü tarayıcıda otomatik açmayı dene
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open").arg(&url).spawn();
    }
    Ok(AuthUrlResponse { token, url })
}

/// Kullanıcı tarayıcıda onayladıktan sonra token'ı kalıcı session key ile takas eder.
pub async fn create_session(
    api_key: &str,
    secret: &str,
    token: &str,
) -> Result<(String, String), String> {
    let client = reqwest::Client::builder()
        .timeout(HTTP_TIMEOUT)
        .build()
        .map_err(|e| e.to_string())?;

    let mut params = vec![
        ("api_key".to_string(), api_key.to_string()),
        ("method".to_string(), "auth.getSession".to_string()),
        ("token".to_string(), token.to_string()),
    ];
    let sig = generate_signature(&params, secret);
    params.push(("api_sig".to_string(), sig));
    params.push(("format".to_string(), "json".to_string()));

    let resp = client
        .post(LASTFM_API_BASE)
        .form(&params)
        .send()
        .await
        .map_err(|e| format!("Last.fm oturum isteği başarısız: {e}"))?;

    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Oturum yanıtı ayrıştırılamadı: {e}"))?;

    if let Some(err_msg) = json.get("message").and_then(|m| m.as_str()) {
        return Err(err_msg.to_string());
    }

    let session = json
        .get("session")
        .ok_or_else(|| "Oturum bilgisi alınamadı".to_string())?;
    let username = session
        .get("name")
        .and_then(|s| s.as_str())
        .unwrap_or("")
        .to_string();
    let session_key = session
        .get("key")
        .and_then(|s| s.as_str())
        .unwrap_or("")
        .to_string();

    if username.is_empty() || session_key.is_empty() {
        return Err("Geçersiz oturum bilgisi döndü".to_string());
    }

    Ok((username, session_key))
}

/// Last.fm profiline "Şu an çalıyor" (Now Playing) bilgisini gönderir.
pub async fn update_now_playing(
    api_key: &str,
    secret: &str,
    session_key: &str,
    artist: &str,
    track: &str,
    album: Option<&str>,
    duration: Option<u64>,
) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .timeout(HTTP_TIMEOUT)
        .build()
        .map_err(|e| e.to_string())?;

    let mut params = vec![
        ("api_key".to_string(), api_key.to_string()),
        ("artist".to_string(), artist.to_string()),
        ("method".to_string(), "track.updateNowPlaying".to_string()),
        ("sk".to_string(), session_key.to_string()),
        ("track".to_string(), track.to_string()),
    ];

    if let Some(alb) = album {
        if !alb.trim().is_empty() && alb != crate::db::UNKNOWN_ALBUM {
            params.push(("album".to_string(), alb.trim().to_string()));
        }
    }
    if let Some(dur) = duration {
        if dur > 0 {
            params.push(("duration".to_string(), dur.to_string()));
        }
    }

    let sig = generate_signature(&params, secret);
    params.push(("api_sig".to_string(), sig));
    params.push(("format".to_string(), "json".to_string()));

    let resp = client
        .post(LASTFM_API_BASE)
        .form(&params)
        .send()
        .await
        .map_err(|e| format!("Now Playing isteği başarısız: {e}"))?;

    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    if let Some(err) = json.get("error") {
        let msg = json.get("message").and_then(|m| m.as_str()).unwrap_or("Hata");
        return Err(format!("Last.fm hatası ({err}): {msg}"));
    }

    Ok(())
}

/// Last.fm profiline dinleme geçmişi (scrobble) kaydeder.
pub async fn scrobble(
    api_key: &str,
    secret: &str,
    session_key: &str,
    artist: &str,
    track: &str,
    timestamp: u64,
    album: Option<&str>,
    duration: Option<u64>,
) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .timeout(HTTP_TIMEOUT)
        .build()
        .map_err(|e| e.to_string())?;

    // track.scrobble indexed params gerektirir: artist[0], track[0], timestamp[0], …
    let mut params = vec![
        ("api_key".to_string(), api_key.to_string()),
        ("artist[0]".to_string(), artist.to_string()),
        ("method".to_string(), "track.scrobble".to_string()),
        ("sk".to_string(), session_key.to_string()),
        ("timestamp[0]".to_string(), timestamp.to_string()),
        ("track[0]".to_string(), track.to_string()),
    ];

    if let Some(alb) = album {
        if !alb.trim().is_empty() && alb != crate::db::UNKNOWN_ALBUM {
            params.push(("album[0]".to_string(), alb.trim().to_string()));
        }
    }
    if let Some(dur) = duration {
        if dur > 0 {
            params.push(("duration[0]".to_string(), dur.to_string()));
        }
    }

    let sig = generate_signature(&params, secret);
    params.push(("api_sig".to_string(), sig));
    params.push(("format".to_string(), "json".to_string()));

    let resp = client
        .post(LASTFM_API_BASE)
        .form(&params)
        .send()
        .await
        .map_err(|e| format!("Scrobble isteği başarısız: {e}"))?;

    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    if let Some(err) = json.get("error") {
        let msg = json.get("message").and_then(|m| m.as_str()).unwrap_or("Hata");
        return Err(format!("Last.fm scrobble hatası ({err}): {msg}"));
    }

    // accepted=0 / ignored>0 durumunu logla (timestamp too old/new vb.)
    if let Some(attr) = json
        .pointer("/scrobbles/@attr")
        .or_else(|| json.pointer("/scrobbles/attr"))
    {
        let ignored = attr
            .get("ignored")
            .and_then(|v| v.as_u64().or_else(|| v.as_str().and_then(|s| s.parse().ok())))
            .unwrap_or(0);
        if ignored > 0 {
            let code = json
                .pointer("/scrobbles/scrobble/ignoredMessage/@code")
                .or_else(|| json.pointer("/scrobbles/scrobble/ignoredMessage/code"))
                .map(|v| v.to_string())
                .unwrap_or_else(|| "?".to_string());
            eprintln!(
                "Last.fm scrobble yok sayıldı (ignored={ignored}, code={code}): {artist} – {track}"
            );
        }
    }

    Ok(())
}

/// Veritabanındaki Last.fm bağlantı durumunu sorgular.
pub fn get_status(conn: &Connection) -> LastFmStatus {
    let username = crate::db::get_setting_opt(conn, "lastfm_username")
        .ok()
        .flatten()
        .filter(|s| !s.trim().is_empty());
    let session_key = crate::db::get_setting_opt(conn, "lastfm_session_key")
        .ok()
        .flatten()
        .filter(|s| !s.trim().is_empty());

    let scrobble_enabled = crate::db::get_setting_opt(conn, "lastfm_scrobble_enabled")
        .ok()
        .flatten()
        .map(|v| v == "true" || v == "1")
        .unwrap_or(true); // Bağlıysa varsayılan true

    let has_api_keys = resolve_api_keys(Some(conn)).is_some();

    LastFmStatus {
        connected: username.is_some() && session_key.is_some(),
        username,
        scrobble_enabled,
        has_api_keys,
    }
}

/// Last.fm oturumunu sonlandırır ve kayıtlı session anahtarlarını siler.
pub fn disconnect(conn: &Connection) -> Result<(), String> {
    crate::db::delete_setting(conn, "lastfm_username")?;
    crate::db::delete_setting(conn, "lastfm_session_key")?;
    Ok(())
}

/// Scrobble özelliğini açar veya kapatır.
pub fn set_scrobble_enabled(conn: &Connection, enabled: bool) -> Result<(), String> {
    crate::db::set_setting(
        conn,
        "lastfm_scrobble_enabled",
        if enabled { "true" } else { "false" },
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_signature_generation() {
        // Last.fm dokümantasyonundaki MD5 imzalama kural testi
        let params = vec![
            ("method".to_string(), "auth.getSession".to_string()),
            ("api_key".to_string(), "my_api_key".to_string()),
            ("token".to_string(), "my_token".to_string()),
            ("format".to_string(), "json".to_string()),
        ];
        let secret = "my_secret";
        // Sıralama: api_key + my_api_key + method + auth.getSession + token + my_token + my_secret
        let sig = generate_signature(&params, secret);
        assert_eq!(sig.len(), 32);

        // Beklenen string kontrolü
        let expected_raw = "api_keymy_api_keymethodauth.getSessiontokenmy_tokenmy_secret";
        let mut hasher = Md5::new();
        hasher.update(expected_raw.as_bytes());
        let expected_sig = format!("{:x}", hasher.finalize());
        assert_eq!(sig, expected_sig);
    }

    #[test]
    fn test_scrobble_indexed_signature_order() {
        // track.scrobble imzasında artist[0]/track[0]/timestamp[0] alfabetik sırada yer alır
        let params = vec![
            ("api_key".to_string(), "k".to_string()),
            ("artist[0]".to_string(), "Artist".to_string()),
            ("method".to_string(), "track.scrobble".to_string()),
            ("sk".to_string(), "session".to_string()),
            ("timestamp[0]".to_string(), "123".to_string()),
            ("track[0]".to_string(), "Song".to_string()),
        ];
        let secret = "secret";
        let sig = generate_signature(&params, secret);

        let expected_raw =
            "api_keykartist[0]Artistmethodtrack.scrobblesksessiontimestamp[0]123track[0]Songsecret";
        let mut hasher = Md5::new();
        hasher.update(expected_raw.as_bytes());
        let expected_sig = format!("{:x}", hasher.finalize());
        assert_eq!(sig, expected_sig);
    }
}

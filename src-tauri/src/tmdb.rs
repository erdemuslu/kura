//! TMDB (The Movie Database) poster entegrasyonu — film ve diziler için.
//!
//! API key `app_settings` tablosundaki `tmdb_api_key` değerinden okunur
//! (⚙ Ayarlar panelinden girilir; ücretsiz kayıt: themoviedb.org).
//! Key yalnızca backend'de kullanılır, REST yanıtlarında asla ifşa edilmez.

use std::path::{Path, PathBuf};
use std::time::Duration;

const TMDB_TIMEOUT: Duration = Duration::from_secs(5);
const IMAGE_BASE: &str = "https://image.tmdb.org/t/p/w500";

/// Başlıktaki "(2020)" parantezinden yıl çıkarır (arama isabetini artırır).
pub(crate) fn extract_year(title: &str) -> Option<String> {
    let chars: Vec<char> = title.chars().collect();
    if chars.len() < 6 {
        return None;
    }
    for i in 0..=(chars.len() - 6) {
        if chars[i] == '('
            && chars[i + 1].is_ascii_digit()
            && chars[i + 2].is_ascii_digit()
            && chars[i + 3].is_ascii_digit()
            && chars[i + 4].is_ascii_digit()
            && chars[i + 5] == ')'
        {
            return Some(chars[i + 1..i + 5].iter().collect());
        }
    }
    None
}

/// Arama başlığı: yalnız "(yyyy)" kalıpları soyulur
/// ("Blade Runner 2049" gibi çifte anlamlı yıllar korunur).
pub(crate) fn search_title(title: &str) -> String {
    let chars: Vec<char> = title.chars().collect();
    let mut out = String::new();
    let mut i = 0;
    while i < chars.len() {
        // "(dddd)" kalıbını atla
        if chars[i] == '('
            && i + 5 < chars.len()
            && chars[i + 1..i + 5].iter().all(|c| c.is_ascii_digit())
            && chars[i + 5] == ')'
        {
            i += 6;
            continue;
        }
        out.push(chars[i]);
        i += 1;
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Ortak TMDB arama + poster indirme + önbelleğe yazma.
/// `search_path`: "movie" | "tv". Başarısız/ağ hatası → sessizce None.
async fn fetch_poster(
    covers_dir: &Path,
    api_key: &str,
    search_path: &str,
    query_title: &str,
    year: Option<String>,
    cache_prefix: &str,
) -> Option<PathBuf> {
    let client = reqwest::Client::builder()
        .timeout(TMDB_TIMEOUT)
        .build()
        .ok()?;
    let url = format!("https://api.themoviedb.org/3/search/{search_path}");
    let mut req = client.get(&url).query(&[
        ("api_key", api_key),
        ("query", query_title),
        ("language", "tr-TR"),
    ]);
    // Yıl yalnız film aramasında anlamlı
    if let (Some(y), "movie") = (year.as_deref(), search_path) {
        req = req.query(&[("year", y)]);
    }
    let body: serde_json::Value = req.send().await.ok()?.json().await.ok()?;
    let poster_path = body
        .get("results")?
        .get(0)?
        .get("poster_path")?
        .as_str()?
        .to_string();
    if poster_path.is_empty() {
        return None;
    }

    let img_url = format!("{IMAGE_BASE}{poster_path}");
    let bytes = client.get(&img_url).send().await.ok()?.bytes().await.ok()?;
    let ext = if poster_path.contains(".png") { "png" } else { "jpg" };
    let path = crate::cover::cache_file_for_key(
        covers_dir,
        &format!("{cache_prefix}\u{1f}{query_title}"),
        ext,
    );
    std::fs::create_dir_all(covers_dir).ok()?;
    std::fs::write(&path, &bytes).ok()?;
    Some(path)
}

/// Film posteri: TMDB arama → indirme → önbellek.
pub async fn fetch_movie_poster(covers_dir: &Path, api_key: &str, title: &str) -> Option<PathBuf> {
    let year = extract_year(title);
    let query = search_title(title);
    if query.is_empty() {
        return None;
    }
    fetch_poster(covers_dir, api_key, "movie", &query, year, "movie").await
}

/// Dizi posteri: TMDB arama → indirme → önbellek.
pub async fn fetch_series_poster(covers_dir: &Path, api_key: &str, show: &str) -> Option<PathBuf> {
    if show.is_empty() {
        return None;
    }
    fetch_poster(covers_dir, api_key, "tv", show, None, "series").await
}

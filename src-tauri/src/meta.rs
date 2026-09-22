//! Film/dizi detay metadata katmanı: özet, yıl, puan, türler, süre, durum.
//!
//! Kaynak zinciri (poster zinciriyle aynı felsefe):
//!   Film:  TMDB detay (key varsa, tr-TR) → iTunes movie (key'siz)
//!   Dizi:  TMDB detay (key varsa)        → TVmaze (key'siz)
//! Sonuçlar `covers/` önbelleğinde JSON olarak kalıcı saklanır;
//! başarısız aramalar önbelleklenmez (sonraki açılışta tekrar denenir).

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::Duration;

const META_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug, Serialize, Deserialize, Default, Clone)]
pub struct Meta {
    pub overview: Option<String>,
    /// "2020" gibi kısa yıl
    pub year: Option<String>,
    pub rating: Option<f64>,
    pub genres: Vec<String>,
    /// dakika cinsinden (film: toplam, dizi: bölüm süresi)
    pub runtime: Option<i64>,
    /// Dizi durumu: "Ended", "Running" vb.
    pub status: Option<String>,
}

fn cache_file(covers_dir: &Path, kind: &str, title: &str) -> PathBuf {
    crate::cover::cache_file_for_key(
        covers_dir,
        &format!("meta\u{1f}{kind}\u{1f}{title}"),
        "json",
    )
}

fn read_cache(covers_dir: &Path, kind: &str, title: &str) -> Option<Meta> {
    let bytes = std::fs::read(cache_file(covers_dir, kind, title)).ok()?;
    serde_json::from_slice(&bytes).ok()
}

fn write_cache(covers_dir: &Path, kind: &str, title: &str, meta: &Meta) {
    if let Ok(json) = serde_json::to_vec(meta) {
        if std::fs::create_dir_all(covers_dir).is_ok() {
            let _ = std::fs::write(cache_file(covers_dir, kind, title), json);
        }
    }
}

/// Basit HTML tag temizleme (TVmaze özeti HTML olarak gelir).
fn strip_html(html: &str) -> String {
    let mut out = String::new();
    let mut inside = false;
    for c in html.chars() {
        match c {
            '<' => inside = true,
            '>' => inside = false,
            _ if !inside => out.push(c),
            _ => {}
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// TMDB: önce arama (id), sonra detay (`/movie/{id}` veya `/tv/{id}`) —
/// tür adları, özet ve süre ancak detay çağrısında gelir.
async fn tmdb_detail_meta(
    client: &reqwest::Client,
    api_key: &str,
    search_path: &str, // "movie" | "tv"
    query: &str,
    year: Option<&str>,
) -> Option<Meta> {
    let mut req = client
        .get(format!("https://api.themoviedb.org/3/search/{search_path}"))
        .query(&[
            ("api_key", api_key),
            ("query", query),
            ("language", "tr-TR"),
        ]);
    // Yıl yalnız film aramasında anlamlı
    if let (Some(y), "movie") = (year, search_path) {
        req = req.query(&[("year", y)]);
    }
    let search: serde_json::Value = req.send().await.ok()?.json().await.ok()?;
    let id = search.get("results")?.get(0)?.get("id")?.as_i64()?;

    let detail: serde_json::Value = client
        .get(format!("https://api.themoviedb.org/3/{search_path}/{id}"))
        .query(&[("api_key", api_key), ("language", "tr-TR")])
        .send()
        .await
        .ok()?
        .json()
        .await
        .ok()?;

    let date_key = if search_path == "movie" {
        "release_date"
    } else {
        "first_air_date"
    };
    Some(Meta {
        overview: detail
            .get("overview")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        year: detail
            .get(date_key)
            .and_then(|v| v.as_str())
            .and_then(|s| s.split('-').next())
            .map(|s| s.to_string()),
        rating: detail.get("vote_average").and_then(|v| v.as_f64()),
        genres: detail
            .get("genres")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|g| g.get("name").and_then(|n| n.as_str()))
                    .map(|s| s.to_string())
                    .collect()
            })
            .unwrap_or_default(),
        runtime: detail
            .get("runtime")
            .and_then(|v| v.as_i64())
            .or_else(|| {
                // Dizilerde süre bir dizidir: episode_run_time[0]
                detail
                    .get("episode_run_time")
                    .and_then(|v| v.as_array())
                    .and_then(|a| a.first())
                    .and_then(|v| v.as_i64())
            }),
        status: detail
            .get("status")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
    })
}

/// Key'siz film metadata: iTunes movie (longDescription, süre, tür).
async fn itunes_movie_meta(client: &reqwest::Client, title: &str) -> Option<Meta> {
    let resp = client
        .get("https://itunes.apple.com/search")
        .query(&[("term", title), ("entity", "movie"), ("limit", "1")])
        .send()
        .await
        .ok()?;
    let body: serde_json::Value = resp.json().await.ok()?;
    let r = body.get("results")?.get(0)?;
    Some(Meta {
        overview: r
            .get("longDescription")
            .or_else(|| r.get("shortDescription"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        year: r
            .get("releaseDate")
            .and_then(|v| v.as_str())
            .and_then(|s| s.get(0..4))
            .map(|s| s.to_string()),
        rating: None,
        genres: r
            .get("primaryGenreName")
            .and_then(|v| v.as_str())
            .map(|s| vec![s.to_string()])
            .unwrap_or_default(),
        runtime: r
            .get("trackTimeMillis")
            .and_then(|v| v.as_i64())
            .map(|ms| ms / 60_000),
        status: None,
    })
}

/// Key'siz dizi metadata: TVmaze (summary, puan, türler, durum, süre).
async fn tvmaze_meta(client: &reqwest::Client, show: &str) -> Option<Meta> {
    let resp = client
        .get("https://api.tvmaze.com/singlesearch/shows")
        .query(&[("q", show)])
        .send()
        .await
        .ok()?;
    let body: serde_json::Value = resp.json().await.ok()?;
    Some(Meta {
        overview: body
            .get("summary")
            .and_then(|v| v.as_str())
            .map(strip_html),
        year: body
            .get("premiered")
            .and_then(|v| v.as_str())
            .and_then(|s| s.get(0..4))
            .map(|s| s.to_string()),
        rating: body
            .get("rating")
            .and_then(|r| r.get("average"))
            .and_then(|v| v.as_f64()),
        genres: body
            .get("genres")
            .and_then(|v| v.as_array())
            .map(|a| {
                a.iter()
                    .filter_map(|g| g.as_str())
                    .map(|s| s.to_string())
                    .collect()
            })
            .unwrap_or_default(),
        runtime: body.get("runtime").and_then(|v| v.as_i64()),
        status: body
            .get("status")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
    })
}

/// Film metadata: önbellek → TMDB (key varsa) → iTunes (key'siz).
pub async fn fetch_movie_meta(
    covers_dir: &Path,
    tmdb_key: Option<&str>,
    title: &str,
) -> Meta {
    if let Some(m) = read_cache(covers_dir, "movie", title) {
        return m;
    }
    let client = match reqwest::Client::builder().timeout(META_TIMEOUT).build() {
        Ok(c) => c,
        Err(_) => return Meta::default(),
    };
    let year = crate::tmdb::extract_year(title);
    let query = crate::tmdb::search_title(title);

    let mut meta: Option<Meta> = None;
    if let (Some(key), false) = (tmdb_key, query.is_empty()) {
        meta = tmdb_detail_meta(&client, key, "movie", &query, year.as_deref()).await;
    }
    if meta.is_none() {
        meta = itunes_movie_meta(&client, title).await;
    }
    match meta {
        Some(m) => {
            write_cache(covers_dir, "movie", title, &m);
            m
        }
        None => Meta::default(),
    }
}

/// Dizi metadata: önbellek → TMDB (key varsa) → TVmaze (key'siz).
pub async fn fetch_series_meta(
    covers_dir: &Path,
    tmdb_key: Option<&str>,
    show: &str,
) -> Meta {
    if let Some(m) = read_cache(covers_dir, "series", show) {
        return m;
    }
    let client = match reqwest::Client::builder().timeout(META_TIMEOUT).build() {
        Ok(c) => c,
        Err(_) => return Meta::default(),
    };

    let mut meta: Option<Meta> = None;
    if let Some(key) = tmdb_key {
        meta = tmdb_detail_meta(&client, key, "tv", show, None).await;
    }
    if meta.is_none() {
        meta = tvmaze_meta(&client, show).await;
    }
    match meta {
        Some(m) => {
            write_cache(covers_dir, "series", show, &m);
            m
        }
        None => Meta::default(),
    }
}

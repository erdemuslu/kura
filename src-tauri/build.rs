fn main() {
    // .env dosyasından LASTFM_API_KEY ve LASTFM_SHARED_SECRET değerlerini derleme anında ikiliye aktar
    let env_candidates = [
        std::path::PathBuf::from("../.env"),
        std::path::PathBuf::from(".env"),
    ];
    for p in &env_candidates {
        if let Ok(content) = std::fs::read_to_string(p) {
            println!("cargo:rerun-if-changed={}", p.display());
            for line in content.lines() {
                let trimmed = line.trim();
                if trimmed.starts_with('#') || trimmed.is_empty() {
                    continue;
                }
                if let Some((k, v)) = trimmed.split_once('=') {
                    let k = k.trim();
                    let v = v.trim().trim_matches('"').trim_matches('\'');
                    if k == "LASTFM_API_KEY" || k == "LASTFM_SHARED_SECRET" {
                        println!("cargo:rustc-env={k}={v}");
                    }
                }
            }
            break;
        }
    }
    tauri_build::build();
}

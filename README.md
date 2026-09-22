# Local Media Hub

Yerel disklerdeki ve harici sürücülerdeki medya (film, dizi, müzik) dosyalarını
indeksleyen, bunları varsayılan harici masaüstü oynatıcılarla (VLC, IINA,
Audirvana, foobar2000 vb.) çalıştıran ve ev ağındaki mobil/TV cihazlardan
uzaktan kumanda edilebilen bir masaüstü uygulaması.

## Mimari

- **Backend:** Tauri v2 (Rust)
- **Gömülü sunucu:** Axum HTTP sunucusu (`0.0.0.0:8080`) — arka plan thread'i
- **Veritabanı:** Gömülü SQLite (app-data dizininde, kalıcı indeks)
- **Frontend:** React + TypeScript + Vite + Tailwind CSS v4
- Tek `dist` derlemesi hem Tauri penceresi hem de ağ tarayıcılarına sunulur

```
+------------------------------------------------------------------+
|                          RUST ÇEKİRDEĞİ                          |
|  +------------------------+    +------------------------------+ |
|  |     Tauri IPC Core     |    |     Axum HTTP Sunucusu       | |
|  |  (Masaüstü Penceresi)  |    |  (0.0.0.0:8080 - Ağ Girişi)  | |
|  +-----------+------------+    +---------------+--------------+ |
|              +---------------------+--------------------------+  |
|                                    v                             |
|  +-----------------------------------------------------------+  |
|  |                 Ortak Servis Katmanı                        |  |
|  |  runner.rs  - Harici oynatıcı tetikleyici (beyaz liste)    |  |
|  |  scanner.rs - Dizin tarama + lofty ile müzik metadata      |  |
|  |  db.rs      - SQLite bağlantı, migration, sorgular          |  |
|  +-----------------------------------------------------------+  |
+------------------------------------------------------------------+
```

## Geliştirme

```bash
npm install                 # frontend bağımlılıkları
npm run tauri dev           # masaüstü uygulaması (Vite + Rust hot-reload)
```

Sunucu, uygulama açıldığında otomatik `0.0.0.0:8080` üzerinde başlar ve
`dist/` klasörünü ağ tarayıcılarına sunar. İlk çalıştırmada `npm run build`
üretmeden ağ adresi yalnızca API sunar; tam UI için:

```bash
npm run build               # dist/ üretir (REST tarafı da bu klasörü sunar)
npm run tauri build         # release paketi
```

### Yararlı komutlar

| Komut | Açıklama |
|---|---|
| `npm run icon` | `app-icon.png` kaynak ikonu yeniden üretir |
| `npx tauri icon app-icon.png` | Tauri ikon setini (`src-tauri/icons/`) üretir |
| `cargo check` (src-tauri) | Rust tip/hata kontrolü |
| `cargo clippy` (src-tauri) | Rust lints |

## REST API (LAN)

| Uç | Açıklama |
|---|---|
| `GET /api/status` | Sunucu durumu, sürüm, doğrulama gereksinimi |
| `GET /api/library?type=movie&q=...` | Kütüphane sorgusu (tür + arama + sayfalama) |
| `GET /api/disks` | Bağlı diskler |
| `POST /api/scan` `{ path, disk_label? }` | Dizini tarayıp indeksler |
| `POST /api/open` `{ file_path, target_app }` | Medyayı harici oynatıcıda başlatır |
| `GET /api/music/artists?q=` | Sanatçılar (albüm/şarkı sayılarıyla) |
| `GET /api/music/albums?artist=&q=` | Albümler (sanatçıya göre filtrelenebilir) |
| `GET /api/music/tracks?album=&artist=` | Bir albümün şarkıları (disk + track sırasına göre) |
| `GET /api/music/artist-tracks?artist=` | Bir sanatçının tüm şarkıları |
| `GET /api/cover?album=&artist=` | Albüm kapağı (gömülü/klasör → iTunes fallback) |
| `GET /api/movies?q=` | Filmler (klasör bazında gruplu: CD1/CD2 tek kart) |
| `GET /api/movies/files?group=` | Bir film grubunun dosyaları |
| `GET /api/series/shows?q=` | Diziler (sezon/bölüm sayılarıyla) |
| `GET /api/series/seasons?show=` | Bir dizinin sezonları |
| `GET /api/series/episodes?show=&season=` | Bölümler (season opsiyonel) |
| `POST /api/open-batch` `{ file_paths, target_app, playlist_title }` | "Tümünü Çal" — .m3u8 playlist olarak oynatıcıya ekler |

### Güvenlik notları

- `/api/open` yalnızca **indekste kayıtlı** dosyaları başlatabilir.
- `target_app` beyaz liste ile sınırlıdır (`system`, `VLC`, `IINA`,
  `Audirvana`, `foobar2000`, `QuickTime Player`).
- Token doğrulaması varsayılan olarak **kapalıdır**. Masaüstü uygulamasındaki ⚙
  Ayarlar panelinden açıp/kapatabilir, token'ı görüntüleyip kopyalayabilir ve
  yeniden üretebilirsiniz. Açıkken tarayıcıdan ilk girişte token sorulur
  (`X-Auth-Token` başlığı ile gönderilir).

## Kullanım

1. Uygulamayı başlatın.
2. "Dizin yolu" alanına bir medya klasörü girin (örn. `/Volumes/DiskAdi/Filmler`)
   veya "Gözat…" ile seçin — dosyalar türlerine göre Film/Dizi/Müzik sekmelerine düşer.
   **Filmler klasör bazında gruplanır:** aynı klasördeki tüm videolar (CD1/CD2
   gibi) tek kart olur; başlık doğrudan kökteyse dosya adı, değilse klasör
   adıdır. Aynı adlı altyazılar (`.srt` vb.) kartta "CC" rozeti olarak görünür
   ve oynatıcı tarafından otomatik yüklenir. `sample`/`trailer`/`teaser`
   adlı videolar indekslenmez.
   **Diziler hiyerarşiktir:** dosya adındaki `S01E01` / `2x05` deseninden
   dizi/sezon/bölüm çıkarılır; Dizi → Sezon → Bölüm şeklinde gezilir, dizi
   veya sezon "⋯" menüsünden playlist olarak oynatılabilir. Gizli dosyalar
   (macOS `._*` AppleDouble çöpleri, `.DS_Store`, Windows gizli
   attribute'luları) indekslenmez; her tarama öncesi indeksten de temizlenir.
3. Kartlara tıklayarak seçili oynatıcıda başlatın.
4. Müzik sekmesi hiyerarşiktir: Albümler/Sanatçılar → sanatçı → albüm → şarkı
   listesi. Her kartın "⋯" menüsündeki **Tümünü Çal**, kartın tüm şarkılarını
   .m3u8 playlist olarak seçili oynatıcıya ekler. Tag'i olmayan dosyalarda
   sanatçı/albüm bilgisi klasör yapısından (`Sanatçı/Albüm/01 - Sarkı.mp3`)
   çıkarılır.
   Albüm kapakları: gömülü kapak (ID3/FLAC) → klasördeki `cover.jpg` →
   iTunes Search API (key'siz) zinciriyle çözülür; `<app-data>/covers/`
   altında önbelleklenir. Albüm detayında yıl, tür ve ses kalitesi
   (örn. "44.1 kHz • 16 bit") gösterilir.
5. Telefonunuzdan `http://<bilgisayar-ip>:8080` adresini açın — aynı arayüz
   uzaktan kumanda olarak çalışır.

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

### Güvenlik notları

- `/api/open` yalnızca **indekste kayıtlı** dosyaları başlatabilir.
- `target_app` beyaz liste ile sınırlıdır (`system`, `VLC`, `IINA`,
  `Audirvana`, `foobar2000`, `QuickTime Player`).
- Token doğrulaması varsayılan olarak **kapalıdır**. Açmak için
  `app_settings` tablosunda `remote_auth_enabled` = `true` yapın; masaüstü
  arayüzündeki "Uzaktan kumanda" bölümünde gösterilen token'ı mobil cihazda
  bir kez girmeniz yeterlidir (`X-Auth-Token` başlığı ile gönderilir).

## Kullanım

1. Uygulamayı başlatın.
2. "Dizin yolu" alanına bir medya klasörü girin (örn. `/Volumes/DiskAdi/Filmler`)
   ve **Tara**'ya basın — dosyalar türlerine göre Film/Dizi/Müzik sekmelerine düşer.
   Dizi tespiti dosya adındaki `SxxExx` desenine göredir.
3. Kartlara tıklayarak seçili oynatıcıda başlatın.
4. Telefonunuzdan `http://<bilgisayar-ip>:8080` adresini açın — aynı arayüz
   uzaktan kumanda olarak çalışır.

[English](README.md) | [Türkçe](README.tr.md)

<p align="center">
  <img src="public/brand/kura-logo-dark.svg" alt="Kura" width="280" />
</p>

# Kura (蔵)

**Personal Media Archive** — index local disks, play with your favorite apps or the built-in player, and control everything from your phone on the same network.

Built with **Tauri v2**, **Rust**, and **React**.

## Features

- **Local-first library** — scan folders on internal or external drives; movies, series, and music land in dedicated views
- **External + in-app playback** — launch VLC, IINA, Audirvana, foobar2000, and more, or use the built-in music/video players
- **LAN remote** — the same UI is served on `http://<your-ip>:8080` for phones and tablets
- **Music hierarchy** — artists → albums → tracks, with “Play all” playlists
- **Posters & metadata** — folder art, TMDB (optional key), iTunes, and TVmaze fallbacks
- **Last.fm scrobbling** — mirror what you play in Kura to your Last.fm profile

## Screenshots

_Screenshots coming soon. For now, run the app locally to explore the UI._

## Requirements

- [Node.js](https://nodejs.org/) 18+
- [Rust](https://www.rust-lang.org/tools/install) (stable) + Tauri prerequisites for your OS
- macOS (primary target today; Apple Silicon ffmpeg sidecar is bundled under `src-tauri/binaries/`)

## Development

```bash
npm install                 # frontend dependencies
npm run tauri dev           # desktop app (Vite + Rust hot-reload)
```

When the app starts, an Axum server binds to `0.0.0.0:8080` and serves the `dist/` folder to LAN browsers. For a full remote UI on first run:

```bash
npm run build               # produce dist/ (also used by the LAN server)
npm run tauri build         # release package
```

### Useful commands

| Command | Description |
|---|---|
| `npm run icon` | Generate the Tauri icon set from `app-icon.png` |
| `cargo check` (in `src-tauri`) | Rust type/error check |
| `cargo clippy` (in `src-tauri`) | Rust lints |

Optional env vars (see [`.env.example`](.env.example)):

- `LASTFM_API_KEY` / `LASTFM_SHARED_SECRET` — Last.fm integration
- `KURA_DIST` — override the path to the static `dist/` folder served by Axum

TMDB keys are entered in the in-app Settings panel (stored in app data, not required in `.env`).

## Usage

1. Launch Kura.
2. Add a media folder (path field or **Browse…**). Files are classified into Movies / Series / Music.
   - **Movies** group by folder (e.g. CD1/CD2 → one card); matching subtitles show a CC badge.
   - **Series** parse `S01E01` / `2x05`-style names into Show → Season → Episode.
   - Hidden junk (`._*`, `.DS_Store`, etc.) is ignored and cleaned from the index.
3. Open a card for details (poster, overview, ratings) and play individually or as a playlist.
4. Music: Albums / Artists → drill down → **Play all** builds an `.m3u8` for the selected player.
5. On your phone, open `http://<computer-ip>:8080` for the remote UI.

## Architecture

```
+------------------------------------------------------------------+
|                         RUST CORE                                |
|  +------------------------+    +------------------------------+ |
|  |     Tauri IPC Core     |    |     Axum HTTP Server         | |
|  |  (Desktop Window)      |    |  (0.0.0.0:8080 - LAN)        | |
|  +-----------+------------+    +---------------+--------------+ |
|              +---------------------+--------------------------+  |
|                                    v                             |
|  Shared services: runner · scanner · db (SQLite) · covers/meta  |
+------------------------------------------------------------------+
```

- **Backend:** Tauri v2 (Rust)
- **Embedded server:** Axum on `0.0.0.0:8080`
- **Database:** SQLite in the app-data directory
- **Frontend:** React + TypeScript + Vite + Tailwind CSS v4  
  One `dist` build serves both the Tauri window and LAN browsers.

### API reference (LAN)

| Endpoint | Description |
|---|---|
| `GET /api/status` | Server status, version, auth requirement |
| `GET /api/library?type=&q=` | Library query |
| `GET /api/disks` | Mounted disks |
| `POST /api/scan` | Index a directory |
| `POST /api/open` | Open a file in an external player |
| `POST /api/open-batch` | “Play all” via `.m3u8` playlist |
| `GET /api/music/*` | Artists, albums, tracks |
| `GET /api/movies/*` · `/api/series/*` | Movie groups & series hierarchy |
| `GET /api/cover` · `/api/meta` | Artwork and metadata |

## Security

- `/api/open` can only launch **indexed** files.
- `target_app` is whitelist-limited (`system`, `VLC`, `IINA`, `Audirvana`, `foobar2000`, `QuickTime Player`, …).
- Token auth is **off by default**. Enable it in Settings (⚙); browsers then send `X-Auth-Token` on first visit.
- Bind is LAN-facing (`0.0.0.0`). Prefer token auth on untrusted networks.

## License

[MIT](LICENSE) © Erdem Uslu

---

[Türkçe README](README.tr.md)

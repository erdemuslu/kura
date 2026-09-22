/**
 * Birleşik istemci adaptörü:
 * - Masaüstünde (Tauri penceresi)  -> Tauri IPC (`invoke`)
 * - Tarayıcıda (mobil/TV remote)   -> Axum REST API (`fetch`)
 */

export type MediaType = 'movie' | 'series' | 'music';

export interface MediaItem {
  id: string;
  title: string;
  artist: string | null;
  album: string | null;
  media_type: MediaType;
  file_path: string;
  file_size: number;
  disk_label: string;
  format: string;
  duration: number | null;
  track_number: number | null;
  disc_number: number | null;
  year: number | null;
  show_title: string | null;
  season: number | null;
  episode: number | null;
  folder_path: string | null;
  subtitle_count: number;
  genre: string | null;
  sample_rate: number | null;
  bit_depth: number | null;
  channels: number | null;
  cover_image_path: string | null;
  created_at: string | null;
  updated_at: string | null;
}

/** Müzik tarayıcı: sanatçı özeti (gruplama sorgusundan döner). */
export interface ArtistSummary {
  artist: string;
  album_count: number;
  track_count: number;
}

/** Film tarayıcı: bir klasördeki tüm video dosyalarını temsil eden grup kartı. */
export interface MovieGroup {
  title: string;
  folder_path: string;
  file_count: number;
  total_size: number;
  has_subtitles: boolean;
  disk_label: string | null;
}

/** Dizi tarayıcı: dizi özeti. */
export interface ShowSummary {
  show_title: string;
  season_count: number;
  episode_count: number;
}

/** Dizi tarayıcı: sezon özeti. */
export interface SeasonSummary {
  season: number;
  episode_count: number;
}

/** Film/dizi detay metadata'sı (özet, yıl, puan, türler, süre, durum). */
export interface MetaInfo {
  overview: string | null;
  year: string | null;
  rating: number | null;
  genres: string[];
  runtime: number | null;
  status: string | null;
}

/** Müzik tarayıcı: albüm özeti (gruplama sorgusundan döner). */
export interface AlbumSummary {
  album: string;
  artist: string;
  track_count: number;
  total_duration: number | null;
  has_cover: boolean;
}

export interface DiskInfo {
  label: string;
  path: string;
  online: boolean;
}

export interface ScanSummary {
  scanned_files: number;
  indexed: number;
  errors: number;
  /** Taramanın başında indeksten silinen gizli/çöp kayıt sayısı. */
  cleaned: number;
  disk_label: string;
}

export interface PlayRequest {
  filePath: string;
  targetApp: string;
}

export interface LaunchResult {
  success: boolean;
  message: string;
}

export interface RemoteInfo {
  auth_enabled: boolean;
  token: string;
  port: number;
  local_ip: string | null;
}

/** Sunucu token doğrulaması açıkken REST isteği 401 döndürürse fırlatılır. */
export class ApiAuthError extends Error {
  constructor(message = 'Uzaktan erişim token’ı gerekli') {
    super(message);
    this.name = 'ApiAuthError';
  }
}

/** Masaüstünde hangi oynatıcıların seçilebildiği (Rust tarafındaki beyaz liste ile eşleşir). */
export const PLAYERS: { id: string; label: string; audio?: boolean }[] = [
  { id: 'system', label: 'Sistem Varsayılanı' },
  { id: 'VLC', label: 'VLC' },
  { id: 'IINA', label: 'IINA' },
  { id: 'Audirvana', label: 'Audirvana' },
  { id: 'foobar2000', label: 'foobar2000 (ses)', audio: true },
  { id: 'QuickTime Player', label: 'QuickTime Player' },
];

export function isRunningInTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

const TOKEN_KEY = 'lmh-remote-token';

export function getRemoteToken(): string {
  return localStorage.getItem(TOKEN_KEY) ?? '';
}

export function setRemoteToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

/** REST istekleri için ortak fetch sarmalayıcı (token başlığı + hata normalizasyonu). */
async function restFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  const token = getRemoteToken();
  if (token) headers.set('X-Auth-Token', token);
  const res = await fetch(path, { ...init, headers });
  if (res.status === 401) throw new ApiAuthError();
  if (!res.ok) throw new Error(`Sunucu hatası: ${res.status}`);
  return res;
}

/** Medyayı seçilen harici uygulamada başlatır. */
export async function launchPlayer(req: PlayRequest): Promise<LaunchResult> {
  if (isRunningInTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    try {
      await invoke('open_media', {
        filePath: req.filePath,
        targetApp: req.targetApp,
      });
      return { success: true, message: 'Başlatıldı' };
    } catch (error) {
      return { success: false, message: String(error) };
    }
  }
  // Tarayıcı (telefon / tablet / TV remote)
  const res = await restFetch('/api/open', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      file_path: req.filePath,
      target_app: req.targetApp,
    }),
  });
  return res.json();
}

/** Kütüphaneyi tür ve arama sorgusuna göre çeker. */
export async function getLibrary(
  type: MediaType | null,
  query: string,
  limit = 500,
  offset = 0,
): Promise<MediaItem[]> {
  if (isRunningInTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<MediaItem[]>('query_library', {
      mediaType: type,
      query: query || null,
      limit,
      offset,
    });
  }
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });
  if (type) params.set('type', type);
  if (query) params.set('q', query);
  const res = await restFetch(`/api/library?${params}`);
  const data = (await res.json()) as { items: MediaItem[] };
  return data.items;
}

/** Bağlı / mount edilmiş diskleri listeler. */
export async function getDisks(): Promise<DiskInfo[]> {
  if (isRunningInTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<DiskInfo[]>('list_disks');
  }
  const res = await restFetch('/api/disks');
  return res.json();
}

/** Bir dizini tarayıp SQLite'a indeksler. */
export async function startScan(
  path: string,
  diskLabel?: string,
): Promise<ScanSummary> {
  if (isRunningInTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<ScanSummary>('scan_directory', {
      path,
      diskLabel: diskLabel || null,
    });
  }
  const res = await restFetch('/api/scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, disk_label: diskLabel ?? null }),
  });
  return res.json();
}

/**
 * Uzaktan kumanda bilgisi (sadece masaüstünde; IPC üzerinden).
 * Tarayıcıdan REST ile erişilemez — token asla ağ üzerinden yayınlanmaz.
 */
export async function getRemoteInfo(): Promise<RemoteInfo | null> {
  if (!isRunningInTauri()) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<RemoteInfo>('get_remote_info');
}

/** Müzik tarayıcı: sanatçıları listeler. */
export async function getArtists(query: string): Promise<ArtistSummary[]> {
  if (isRunningInTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<ArtistSummary[]>('list_artists', { query: query || null });
  }
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  const res = await restFetch(`/api/music/artists?${params}`);
  return res.json();
}

/** Müzik tarayıcı: albümleri listeler (sanatçıya göre filtrelenebilir). */
export async function getAlbums(
  query: string,
  artist?: string,
): Promise<AlbumSummary[]> {
  if (isRunningInTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<AlbumSummary[]>('list_albums', {
      artist: artist || null,
      query: query || null,
    });
  }
  const params = new URLSearchParams();
  if (artist) params.set('artist', artist);
  if (query) params.set('q', query);
  const res = await restFetch(`/api/music/albums?${params}`);
  return res.json();
}

/** Müzik tarayıcı: bir albümün şarkılarını (disk + track sırasına göre). */
export async function getAlbumTracks(
  album: string,
  artist: string,
): Promise<MediaItem[]> {
  if (isRunningInTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<MediaItem[]>('album_tracks', { album, artist });
  }
  const params = new URLSearchParams({ album, artist });
  const res = await restFetch(`/api/music/tracks?${params}`);
  return res.json();
}

/** Müzik tarayıcı: bir sanatçının tüm şarkıları ("Tümünü Çal" için). */
export async function getArtistTracks(artist: string): Promise<MediaItem[]> {
  if (isRunningInTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<MediaItem[]>('artist_tracks', { artist });
  }
  const params = new URLSearchParams({ artist });
  const res = await restFetch(`/api/music/artist-tracks?${params}`);
  return res.json();
}

/** "Tümünü Çal": birden çok dosyayı playlist olarak oynatıcıya ekler. */
export async function launchPlayerBatch(
  filePaths: string[],
  targetApp: string,
  playlistTitle: string,
): Promise<LaunchResult> {
  if (isRunningInTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    try {
      const result = await invoke<{ success: boolean; message: string }>(
        'open_media_batch',
        { filePaths, targetApp, playlistTitle },
      );
      return result;
    } catch (error) {
      return { success: false, message: String(error) };
    }
  }
  const res = await restFetch('/api/open-batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      file_paths: filePaths,
      target_app: targetApp,
      playlist_title: playlistTitle,
    }),
  });
  return res.json();
}

/**
 * Albüm kapağı URL'si — masaüstünde de uzaktan da aynı Axum sunucusu
 * üzerinden servis edilir (tek kod yolu; asset-protocol gerekmez).
 * Yükleme hatasında (404) çağıran taraf placeholder'a düşer.
 */
export function coverUrl(album: string, artist: string): string {
  const base = isRunningInTauri() ? 'http://localhost:8080' : '';
  return `${base}/api/cover?${new URLSearchParams({ album, artist }).toString()}`;
}

/** Film posteri URL'si: klasör posteri → TMDB zinciri. */
export function posterUrlMovie(title: string, folderPath: string | null): string {
  const base = isRunningInTauri() ? 'http://localhost:8080' : '';
  const params = new URLSearchParams({ kind: 'movie', title });
  // "file:<yol>" sentetik anahtarları (eski kayıtlar) lokal arama için geçersiz
  if (folderPath && !folderPath.startsWith('file:')) {
    params.set('folder', folderPath);
  }
  return `${base}/api/cover?${params}`;
}

/** Dizi posteri URL'si: TMDB. */
export function posterUrlSeries(showTitle: string): string {
  const base = isRunningInTauri() ? 'http://localhost:8080' : '';
  return `${base}/api/cover?${new URLSearchParams({ kind: 'series', title: showTitle })}`;
}

/** Detay metadata: özet/yıl/puan/türler/süre/durum (poster zinciriyle aynı kaynaklar). */
async function getMeta(kind: 'movie' | 'series', title: string): Promise<MetaInfo> {
  const base = isRunningInTauri() ? 'http://localhost:8080' : '';
  const res = await restFetch(
    `${base}/api/meta?${new URLSearchParams({ kind, title })}`,
  );
  return res.json();
}

export async function getMovieMeta(title: string): Promise<MetaInfo> {
  return getMeta('movie', title);
}

export async function getSeriesMeta(showTitle: string): Promise<MetaInfo> {
  return getMeta('series', showTitle);
}

/** Film tarayıcı: klasör bazında gruplanmış filmler. */
export async function getMovies(query: string): Promise<MovieGroup[]> {
  if (isRunningInTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<MovieGroup[]>('list_movies', { query: query || null });
  }
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  const res = await restFetch(`/api/movies?${params}`);
  return res.json();
}

/** Film tarayıcı: bir film grubunun dosyaları (oynatma için). */
export async function getMovieFiles(groupKey: string): Promise<MediaItem[]> {
  if (isRunningInTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<MediaItem[]>('movie_files', { groupKey });
  }
  const params = new URLSearchParams({ group: groupKey });
  const res = await restFetch(`/api/movies/files?${params}`);
  return res.json();
}

/** Dizi tarayıcı: diziler (sezon/bölüm sayılarıyla). */
export async function getShows(query: string): Promise<ShowSummary[]> {
  if (isRunningInTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<ShowSummary[]>('list_shows', { query: query || null });
  }
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  const res = await restFetch(`/api/series/shows?${params}`);
  return res.json();
}

/** Dizi tarayıcı: bir dizinin sezonları. */
export async function getSeasons(show: string): Promise<SeasonSummary[]> {
  if (isRunningInTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<SeasonSummary[]>('list_seasons', { show });
  }
  const params = new URLSearchParams({ show });
  const res = await restFetch(`/api/series/seasons?${params}`);
  return res.json();
}

/** Dizi tarayıcı: bölümler. `season` yoksa tüm sezonlar ("Tümünü Çal" için). */
export async function getEpisodes(
  show: string,
  season?: number,
): Promise<MediaItem[]> {
  if (isRunningInTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<MediaItem[]>('list_episodes', {
      show,
      season: season ?? null,
    });
  }
  const params = new URLSearchParams({ show });
  if (season !== undefined) params.set('season', String(season));
  const res = await restFetch(`/api/series/episodes?${params}`);
  return res.json();
}

/* Ayarlar — yalnızca masaüstü IPC (ayarlar ağ üzerinden değiştirilemez). */

/** Uzaktan erişim token doğrulamasını açar/kapar. */
export async function setRemoteAuthEnabled(enabled: boolean): Promise<void> {
  if (!isRunningInTauri()) {
    throw new Error('Ayarlar yalnızca masaüstü uygulamasından değiştirilebilir');
  }
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('set_remote_auth_enabled', { enabled });
}

/** Uzaktan erişim token'ını yeniden üretir ve döndürür. */
export async function regenerateRemoteToken(): Promise<string> {
  if (!isRunningInTauri()) {
    throw new Error('Ayarlar yalnızca masaüstü uygulamasından değiştirilebilir');
  }
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<string>('regenerate_remote_token');
}

/** TMDB API key (film/dizi posterleri). Ayarlanmamışsa null. */
export async function getTmdbApiKey(): Promise<string | null> {
  if (!isRunningInTauri()) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<string | null>('get_tmdb_api_key');
}

/** TMDB API key'i kaydeder (boş bırakılırsa özellik kapanır). */
export async function setTmdbApiKey(key: string): Promise<void> {
  if (!isRunningInTauri()) {
    throw new Error('Ayarlar yalnızca masaüstü uygulamasından değiştirilebilir');
  }
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('set_tmdb_api_key', { key });
}

/**
 * Native klasör seçme diyaloğunu açar (yalnızca masaüstünde).
 * Tarayıcı/remote modunda null döner — orada manuel yol girişi kullanılır.
 */
export async function browseDirectory(): Promise<string | null> {
  if (!isRunningInTauri()) return null;
  const { open } = await import('@tauri-apps/plugin-dialog');
  const selected = await open({
    directory: true,
    multiple: false,
    title: 'Medya dizini seç',
  });
  return typeof selected === 'string' ? selected : null;
}

/**
 * Yoldan disk etiketi çıkarır (/Volumes/<label>/..., D:\...),
 * çıkarılamıyorsa boş string döner (Rust tarafındaki detect_disk_label ile uyumlu).
 */
export function diskLabelFromPath(path: string): string {
  const volumesMatch = path.match(/^\/Volumes\/([^/]+)/);
  if (volumesMatch) return volumesMatch[1]!;
  const windowsMatch = path.match(/^([A-Za-z]):[\\/]/);
  if (windowsMatch) return windowsMatch[1]!.toUpperCase();
  return '';
}

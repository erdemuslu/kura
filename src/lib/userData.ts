import type { FavoriteItem } from '../context/FavoritesContext';
import type { Playlist } from '../context/PlaylistContext';
import type { StatsData } from '../context/StatsContext';

export interface KuraUserDataExport {
  version: 1;
  appName: 'Kura';
  exportedAt: string;
  data: {
    favorites: FavoriteItem[];
    playlists: Playlist[];
    stats?: StatsData;
    categories?: unknown;
  };
}

export function exportUserData(payload: {
  favorites: FavoriteItem[];
  playlists: Playlist[];
  stats?: StatsData;
}): void {
  let categories: unknown = undefined;
  try {
    const raw = localStorage.getItem('kura-categories');
    if (raw) categories = JSON.parse(raw);
  } catch {}

  const exportObj: KuraUserDataExport = {
    version: 1,
    appName: 'Kura',
    exportedAt: new Date().toISOString(),
    data: {
      favorites: payload.favorites,
      playlists: payload.playlists,
      stats: payload.stats,
      categories,
    },
  };

  const json = JSON.stringify(exportObj, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const dateStr = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `kura-backup-${dateStr}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export interface ParseResult {
  success: boolean;
  error?: string;
  data?: KuraUserDataExport['data'];
  summary?: {
    favoritesCount: number;
    playlistsCount: number;
    hasStats: boolean;
    hasCategories: boolean;
  };
}

export function parseUserDataFile(fileContent: string): ParseResult {
  try {
    const parsed = JSON.parse(fileContent);
    if (!parsed || typeof parsed !== 'object') {
      return { success: false, error: 'Invalid JSON format' };
    }
    const data = parsed.data || parsed;
    const favorites = Array.isArray(data.favorites) ? data.favorites : [];
    const playlists = Array.isArray(data.playlists) ? data.playlists : [];
    const stats = data.stats && typeof data.stats === 'object' ? data.stats : undefined;
    const categories = Array.isArray(data.categories) ? data.categories : undefined;

    return {
      success: true,
      data: {
        favorites,
        playlists,
        stats,
        categories,
      },
      summary: {
        favoritesCount: favorites.length,
        playlistsCount: playlists.length,
        hasStats: Boolean(stats),
        hasCategories: Boolean(categories),
      },
    };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

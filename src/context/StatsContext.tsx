import React, { createContext, useContext, useState, useCallback } from 'react';
import type { MediaItem } from '../api/client';

export interface TrackStat {
  id: string;
  title: string;
  artist: string | null;
  album: string | null;
  playCount: number;
  totalSeconds: number;
  lastPlayedAt: number;
}

export interface ArtistStat {
  artist: string;
  playCount: number;
  totalSeconds: number;
}

export interface RecentPlay {
  id: string;
  title: string;
  artist: string | null;
  album: string | null;
  playedAt: number;
  duration: number;
}

export interface StatsData {
  totalPlayCount: number;
  totalListenSeconds: number;
  tracks: Record<string, TrackStat>;
  artists: Record<string, ArtistStat>;
  recentPlays: RecentPlay[];
}

export const DEFAULT_STATS: StatsData = {
  totalPlayCount: 0,
  totalListenSeconds: 0,
  tracks: {},
  artists: {},
  recentPlays: [],
};

export const STATS_ENABLED_KEY = 'kura-stats-enabled';
export const STATS_DATA_KEY = 'kura-stats-data';

interface StatsContextType {
  isEnabled: boolean;
  setIsEnabled: (enabled: boolean) => void;
  stats: StatsData;
  recordPlay: (track: MediaItem, listenedSeconds: number) => void;
  clearStats: () => void;
  importStats: (data: StatsData, mode?: 'merge' | 'replace') => void;
}

const StatsContext = createContext<StatsContextType | null>(null);

export function StatsProvider({ children }: { children: React.ReactNode }) {
  const [isEnabled, setIsEnabledState] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STATS_ENABLED_KEY) === 'true';
    } catch {
      return false;
    }
  });

  const [stats, setStats] = useState<StatsData>(() => {
    try {
      const stored = localStorage.getItem(STATS_DATA_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed && typeof parsed.totalPlayCount === 'number') {
          return {
            totalPlayCount: parsed.totalPlayCount || 0,
            totalListenSeconds: parsed.totalListenSeconds || 0,
            tracks: parsed.tracks || {},
            artists: parsed.artists || {},
            recentPlays: Array.isArray(parsed.recentPlays) ? parsed.recentPlays : [],
          };
        }
      }
    } catch {}
    return DEFAULT_STATS;
  });

  const setIsEnabled = useCallback((enabled: boolean) => {
    setIsEnabledState(enabled);
    try {
      localStorage.setItem(STATS_ENABLED_KEY, enabled ? 'true' : 'false');
    } catch (e) {
      console.error('Failed to save stats enabled status', e);
    }
  }, []);

  const saveStats = useCallback((newStats: StatsData) => {
    setStats(newStats);
    try {
      localStorage.setItem(STATS_DATA_KEY, JSON.stringify(newStats));
    } catch (e) {
      console.error('Failed to save stats to localStorage', e);
    }
  }, []);

  const recordPlay = useCallback(
    (track: MediaItem, listenedSeconds: number) => {
      // Respect privacy: no tracking when disabled
      if (!isEnabled || !track || !track.file_path) return;

      setStats((prev) => {
        const validSeconds = Math.max(0, Math.round(listenedSeconds));
        const trackKey = track.file_path;
        const artistName = track.artist?.trim() || 'Unknown Artist';

        const existingTrack = prev.tracks[trackKey] || {
          id: trackKey,
          title: track.title,
          artist: track.artist || null,
          album: track.album || null,
          playCount: 0,
          totalSeconds: 0,
          lastPlayedAt: 0,
        };

        const updatedTrack: TrackStat = {
          ...existingTrack,
          title: track.title,
          artist: track.artist || null,
          album: track.album || null,
          playCount: existingTrack.playCount + 1,
          totalSeconds: existingTrack.totalSeconds + validSeconds,
          lastPlayedAt: Date.now(),
        };

        const existingArtist = prev.artists[artistName] || {
          artist: artistName,
          playCount: 0,
          totalSeconds: 0,
        };

        const updatedArtist: ArtistStat = {
          ...existingArtist,
          playCount: existingArtist.playCount + 1,
          totalSeconds: existingArtist.totalSeconds + validSeconds,
        };

        const newRecentPlay: RecentPlay = {
          id: trackKey,
          title: track.title,
          artist: track.artist || null,
          album: track.album || null,
          playedAt: Date.now(),
          duration: validSeconds,
        };

        const newRecentPlays = [newRecentPlay, ...prev.recentPlays].slice(0, 50);

        const newStats: StatsData = {
          totalPlayCount: prev.totalPlayCount + 1,
          totalListenSeconds: prev.totalListenSeconds + validSeconds,
          tracks: {
            ...prev.tracks,
            [trackKey]: updatedTrack,
          },
          artists: {
            ...prev.artists,
            [artistName]: updatedArtist,
          },
          recentPlays: newRecentPlays,
        };

        try {
          localStorage.setItem(STATS_DATA_KEY, JSON.stringify(newStats));
        } catch {}

        return newStats;
      });
    },
    [isEnabled],
  );

  const clearStats = useCallback(() => {
    saveStats(DEFAULT_STATS);
  }, [saveStats]);

  const importStats = useCallback(
    (data: StatsData, mode: 'merge' | 'replace' = 'merge') => {
      if (mode === 'replace') {
        saveStats(data);
        return;
      }
      setStats((prev) => {
        const mergedTracks = { ...prev.tracks };
        for (const [k, trk] of Object.entries(data.tracks || {})) {
          if (mergedTracks[k]) {
            mergedTracks[k] = {
              ...mergedTracks[k]!,
              playCount: mergedTracks[k]!.playCount + trk.playCount,
              totalSeconds: mergedTracks[k]!.totalSeconds + trk.totalSeconds,
              lastPlayedAt: Math.max(mergedTracks[k]!.lastPlayedAt, trk.lastPlayedAt),
            };
          } else {
            mergedTracks[k] = trk;
          }
        }
        const mergedArtists = { ...prev.artists };
        for (const [k, art] of Object.entries(data.artists || {})) {
          if (mergedArtists[k]) {
            mergedArtists[k] = {
              ...mergedArtists[k]!,
              playCount: mergedArtists[k]!.playCount + art.playCount,
              totalSeconds: mergedArtists[k]!.totalSeconds + art.totalSeconds,
            };
          } else {
            mergedArtists[k] = art;
          }
        }
        const newStats: StatsData = {
          totalPlayCount: prev.totalPlayCount + (data.totalPlayCount || 0),
          totalListenSeconds: prev.totalListenSeconds + (data.totalListenSeconds || 0),
          tracks: mergedTracks,
          artists: mergedArtists,
          recentPlays: [...(data.recentPlays || []), ...prev.recentPlays].slice(0, 50),
        };
        try {
          localStorage.setItem(STATS_DATA_KEY, JSON.stringify(newStats));
        } catch {}
        return newStats;
      });
    },
    [saveStats],
  );

  return (
    <StatsContext.Provider
      value={{
        isEnabled,
        setIsEnabled,
        stats,
        recordPlay,
        clearStats,
        importStats,
      }}
    >
      {children}
    </StatsContext.Provider>
  );
}

export function useStats() {
  const context = useContext(StatsContext);
  if (!context) {
    throw new Error('useStats must be used within a StatsProvider');
  }
  return context;
}

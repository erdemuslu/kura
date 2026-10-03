import React, { createContext, useContext, useState, useCallback } from 'react';
import type { MediaItem } from '../api/client';

export interface PlaylistTrack {
  id: string;
  filePath: string;
  title: string;
  artist: string | null;
  album: string | null;
  duration: number | null;
  coverUrl?: string | null;
  addedAt: number;
}

export interface Playlist {
  id: string;
  name: string;
  description?: string;
  createdAt: number;
  updatedAt: number;
  tracks: PlaylistTrack[];
}

export interface PlaylistContextType {
  playlists: Playlist[];
  createPlaylist: (name: string, description?: string) => Playlist;
  renamePlaylist: (id: string, newName: string) => void;
  deletePlaylist: (id: string) => void;
  addTrackToPlaylist: (playlistId: string, track: MediaItem) => boolean;
  removeTrackFromPlaylist: (playlistId: string, trackFilePath: string) => void;
  isTrackInPlaylist: (playlistId: string, trackFilePath: string) => boolean;
  getPlaylist: (id: string) => Playlist | undefined;
  setPlaylists: (playlists: Playlist[]) => void;
}

export const PLAYLISTS_STORAGE_KEY = 'kura-playlists';

const PlaylistContext = createContext<PlaylistContextType | null>(null);

export function PlaylistProvider({ children }: { children: React.ReactNode }) {
  const [playlists, setPlaylistsState] = useState<Playlist[]>(() => {
    try {
      const stored = localStorage.getItem(PLAYLISTS_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {}
    return [];
  });

  const savePlaylists = useCallback((items: Playlist[]) => {
    setPlaylistsState(items);
    try {
      localStorage.setItem(PLAYLISTS_STORAGE_KEY, JSON.stringify(items));
    } catch (e) {
      console.error('Failed to save playlists to localStorage', e);
    }
  }, []);

  const createPlaylist = useCallback(
    (name: string, description?: string): Playlist => {
      const trimmedName = name.trim() || 'Untitled Playlist';
      const newPlaylist: Playlist = {
        id: `pl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        name: trimmedName,
        description: description?.trim() || undefined,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        tracks: [],
      };
      savePlaylists([newPlaylist, ...playlists]);
      return newPlaylist;
    },
    [playlists, savePlaylists],
  );

  const renamePlaylist = useCallback(
    (id: string, newName: string) => {
      const trimmed = newName.trim();
      if (!trimmed) return;
      savePlaylists(
        playlists.map((pl) =>
          pl.id === id ? { ...pl, name: trimmed, updatedAt: Date.now() } : pl,
        ),
      );
    },
    [playlists, savePlaylists],
  );

  const deletePlaylist = useCallback(
    (id: string) => {
      savePlaylists(playlists.filter((pl) => pl.id !== id));
    },
    [playlists, savePlaylists],
  );

  const isTrackInPlaylist = useCallback(
    (playlistId: string, trackFilePath: string): boolean => {
      const pl = playlists.find((p) => p.id === playlistId);
      if (!pl) return false;
      return pl.tracks.some((t) => t.filePath === trackFilePath);
    },
    [playlists],
  );

  const addTrackToPlaylist = useCallback(
    (playlistId: string, track: MediaItem): boolean => {
      let added = false;
      savePlaylists(
        playlists.map((pl) => {
          if (pl.id !== playlistId) return pl;
          if (pl.tracks.some((t) => t.filePath === track.file_path)) return pl;
          added = true;
          const newTrack: PlaylistTrack = {
            id: track.file_path,
            filePath: track.file_path,
            title: track.title,
            artist: track.artist || null,
            album: track.album || null,
            duration: track.duration ?? null,
            coverUrl: track.cover_image_path || null,
            addedAt: Date.now(),
          };
          return {
            ...pl,
            updatedAt: Date.now(),
            tracks: [...pl.tracks, newTrack],
          };
        }),
      );
      return added;
    },
    [playlists, savePlaylists],
  );

  const removeTrackFromPlaylist = useCallback(
    (playlistId: string, trackFilePath: string) => {
      savePlaylists(
        playlists.map((pl) => {
          if (pl.id !== playlistId) return pl;
          return {
            ...pl,
            updatedAt: Date.now(),
            tracks: pl.tracks.filter((t) => t.filePath !== trackFilePath),
          };
        }),
      );
    },
    [playlists, savePlaylists],
  );

  const getPlaylist = useCallback(
    (id: string) => {
      return playlists.find((pl) => pl.id === id);
    },
    [playlists],
  );

  const setPlaylists = useCallback(
    (newPlaylists: Playlist[]) => {
      savePlaylists(newPlaylists);
    },
    [savePlaylists],
  );

  return (
    <PlaylistContext.Provider
      value={{
        playlists,
        createPlaylist,
        renamePlaylist,
        deletePlaylist,
        addTrackToPlaylist,
        removeTrackFromPlaylist,
        isTrackInPlaylist,
        getPlaylist,
        setPlaylists,
      }}
    >
      {children}
    </PlaylistContext.Provider>
  );
}

export function usePlaylists() {
  const context = useContext(PlaylistContext);
  if (!context) {
    throw new Error('usePlaylists must be used within a PlaylistProvider');
  }
  return context;
}

import React, { useState } from 'react';
import { Check, ListMusic, Plus, X } from 'lucide-react';
import type { MediaItem } from '../api/client';
import { useLocale } from '../context/LocaleContext';
import { usePlaylists } from '../context/PlaylistContext';

interface AddToPlaylistModalProps {
  isOpen: boolean;
  onClose: () => void;
  track: MediaItem | null;
}

export default function AddToPlaylistModal({
  isOpen,
  onClose,
  track,
}: AddToPlaylistModalProps) {
  const { t } = useLocale();
  const { playlists, createPlaylist, addTrackToPlaylist, removeTrackFromPlaylist, isTrackInPlaylist } =
    usePlaylists();
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  if (!isOpen || !track) return null;

  const handleCreateAndAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPlaylistName.trim()) return;
    const pl = createPlaylist(newPlaylistName.trim());
    addTrackToPlaylist(pl.id, track);
    setNewPlaylistName('');
    setIsCreating(false);
  };

  const handleToggleTrack = (playlistId: string) => {
    if (isTrackInPlaylist(playlistId, track.file_path)) {
      removeTrackFromPlaylist(playlistId, track.file_path);
    } else {
      addTrackToPlaylist(playlistId, track);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/75 backdrop-blur-sm animate-in fade-in duration-150">
      <div
        className="w-full max-w-md rounded-2xl bg-surface p-6 shadow-2xl ring-1 ring-border relative animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-5 top-5 rounded-lg p-1.5 text-tertiary hover:text-primary hover:bg-surface-hover transition"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/15 text-accent ring-1 ring-accent/30 shrink-0">
            <ListMusic className="h-5 w-5" />
          </div>
          <div className="min-w-0 pr-6">
            <h3 className="font-serif text-lg font-normal text-primary truncate">
              {t('playlists.addToPlaylist')}
            </h3>
            <p className="text-xs text-secondary truncate mt-0.5">
              {track.title} {track.artist ? `· ${track.artist}` : ''}
            </p>
          </div>
        </div>

        {/* Yeni Çalma Listesi Oluştur */}
        <div className="mt-5">
          {isCreating ? (
            <form onSubmit={handleCreateAndAdd} className="flex items-center gap-2">
              <input
                type="text"
                autoFocus
                placeholder={t('playlists.newPlaylistPlaceholder')}
                value={newPlaylistName}
                onChange={(e) => setNewPlaylistName(e.target.value)}
                className="flex-1 rounded-xl bg-surface-hover px-3.5 py-2 text-xs text-primary ring-1 ring-border focus:ring-accent focus:outline-none"
              />
              <button
                type="submit"
                disabled={!newPlaylistName.trim()}
                className="rounded-xl bg-accent px-3.5 py-2 text-xs font-semibold text-background hover:bg-accent-hover transition disabled:opacity-50"
              >
                {t('common.add')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsCreating(false);
                  setNewPlaylistName('');
                }}
                className="rounded-xl bg-surface-hover px-3 py-2 text-xs text-secondary hover:text-primary transition"
              >
                {t('common.cancel')}
              </button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setIsCreating(true)}
              className="flex w-full items-center gap-2.5 rounded-xl border border-dashed border-border px-3.5 py-2.5 text-xs font-medium text-secondary hover:text-primary hover:border-accent hover:bg-surface-hover transition"
            >
              <Plus className="h-4 w-4 text-accent" />
              <span>{t('playlists.createNew')}</span>
            </button>
          )}
        </div>

        {/* Var Olan Listeler */}
        <div className="mt-4 max-h-60 overflow-y-auto divide-y divide-border/40 pr-1">
          {playlists.length === 0 ? (
            <p className="py-4 text-center text-xs text-tertiary">
              {t('playlists.noPlaylistsYet')}
            </p>
          ) : (
            playlists.map((pl) => {
              const inPlaylist = isTrackInPlaylist(pl.id, track.file_path);
              return (
                <button
                  key={pl.id}
                  type="button"
                  onClick={() => handleToggleTrack(pl.id)}
                  className="flex w-full items-center justify-between py-2.5 px-1 text-left text-xs transition hover:text-accent group"
                >
                  <div className="min-w-0 pr-3">
                    <p className={`font-medium truncate ${inPlaylist ? 'text-accent' : 'text-primary'}`}>
                      {pl.name}
                    </p>
                    <p className="text-[11px] text-tertiary">
                      {pl.tracks.length} {t('music.songCount', { n: pl.tracks.length })}
                    </p>
                  </div>
                  <div
                    className={`flex h-5 w-5 items-center justify-center rounded-md border transition ${
                      inPlaylist
                        ? 'border-accent bg-accent text-background'
                        : 'border-border text-transparent group-hover:border-tertiary'
                    }`}
                  >
                    <Check className="h-3.5 w-3.5 stroke-[3]" />
                  </div>
                </button>
              );
            })
          )}
        </div>

        <div className="mt-5 pt-4 border-t border-border flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-surface-hover px-4 py-2 text-xs font-medium text-primary hover:bg-border transition"
          >
            {t('common.done')}
          </button>
        </div>
      </div>
    </div>
  );
}

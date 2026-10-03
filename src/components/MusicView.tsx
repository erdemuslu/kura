import { useEffect, useState } from 'react';
import {
  Edit2,
  Heart,
  ListMusic,
  ListPlus,
  Play,
  Plus,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react';
import {
  coverUrl,
  getAlbumTracks,
  getArtistTracks,
  launchPlayer,
  launchPlayerBatch,
  type AlbumSummary,
  type ArtistSummary,
  type MediaItem,
} from '../api/client';
import { useAudioPlayer } from '../context/AudioPlayerContext';
import { useLocale } from '../context/LocaleContext';
import { useFavorites } from '../context/FavoritesContext';
import { usePlaylists } from '../context/PlaylistContext';
import { useAlbums, useAlbumTracks, useArtists } from '../hooks/useMedia';
import { formatDuration, formatQuality } from '../lib/format';
import { matchesCategoryPath } from '../lib/path';
import { resetScrollTop } from '../lib/scroll';
import MediaCard from './MediaCard';
import AddToPlaylistModal from './AddToPlaylistModal';

type Level =
  | { kind: 'top'; view: 'albums' | 'artists' | 'favorites' | 'playlists' }
  | { kind: 'artist'; artist: string }
  | { kind: 'album'; album: string; artist: string }
  | { kind: 'playlist'; playlistId: string };

interface MusicViewProps {
  player: string;
  query: string;
  playingPath: string | null;
  onPlayed: (path: string | null) => void;
  onOpenScanModal?: () => void;
  hasSources?: boolean;
  onManageSources?: () => void;
  categoryLabel?: string;
  categoryPaths?: string[];
}

export default function MusicView({
  player,
  query,
  playingPath,
  onPlayed,
  onOpenScanModal,
  hasSources,
  onManageSources,
  categoryLabel,
  categoryPaths,
}: MusicViewProps) {
  const { t } = useLocale();
  const { favorites, isFavorite, toggleFavorite } = useFavorites();
  const { playlists, createPlaylist, renamePlaylist, deletePlaylist, removeTrackFromPlaylist } =
    usePlaylists();
  const [level, setLevel] = useState<Level>({ kind: 'top', view: 'albums' });
  const [batchLabel, setBatchLabel] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ success: boolean; message: string } | null>(null);
  const [trackForPlaylist, setTrackForPlaylist] = useState<MediaItem | null>(null);
  const [isCreatingPlaylist, setIsCreatingPlaylist] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [isRenamingPlaylist, setIsRenamingPlaylist] = useState(false);
  const [renameValue, setRenameValue] = useState('');

  const { currentTrack, isPlaying, playTrack, playQueue } = useAudioPlayer();
  const favoriteSongs = favorites.filter((f) => f.mediaType === 'song');

  // Görünüm veya seviye değişiminde (albüm -> sanatçı -> albüm detayı) sayfayı tepeye kaydır
  useEffect(() => {
    resetScrollTop();
  }, [level]);

  // Sanatçı detayında üst seviye arama query'si filtrelemeyi bozmasın, sanatçının tüm albümleri gelsin.
  const activeArtist = level.kind === 'artist' ? level.artist : undefined;
  const albumQuery = level.kind === 'artist' ? '' : query;

  const artists = useArtists(query);
  const albums = useAlbums(albumQuery, activeArtist);

  const rawAlbums = albums.data ?? [];
  const displayedAlbums = rawAlbums.filter((a) =>
    matchesCategoryPath(a.folder_path, categoryPaths),
  );

  const rawArtists = artists.data ?? [];
  const displayedArtists = rawArtists.filter((a) =>
    matchesCategoryPath(a.folder_path, categoryPaths),
  );

  const tracks = useAlbumTracks(
    level.kind === 'album' ? level.album : '',
    level.kind === 'album' ? level.artist : '',
    level.kind === 'album',
  );

  const artistTrackCount =
    level.kind === 'artist'
      ? displayedAlbums.reduce((sum, a) => sum + (a.track_count ?? 0), 0)
      : 0;
  const artistDuration =
    level.kind === 'artist'
      ? displayedAlbums.reduce((sum, a) => sum + (a.total_duration ?? 0), 0)
      : 0;

  const playSingle = async (item: MediaItem) => {
    onPlayed(item.file_path);
    if (player === 'in_app') {
      // Video teardown'unun (pause/src clear) bir frame tamamlanmasına izin ver
      requestAnimationFrame(() => {
        playTrack(item, tracks.data ?? [item]);
      });
      return;
    }
    setFeedback(await launchPlayer({ filePath: item.file_path, targetApp: player }));
  };

  const playAll = async (label: string, fetchTracks: () => Promise<MediaItem[]>) => {
    setBatchLabel(label);
    setFeedback(null);
    try {
      const list = await fetchTracks();
      if (list.length === 0) {
        setFeedback({ success: false, message: t('music.noTracks', { label }) });
        return;
      }
      if (player === 'in_app') {
        onPlayed(list[0]?.file_path ?? null);
        requestAnimationFrame(() => {
          playQueue(list, 0);
        });
        return;
      }
      const result = await launchPlayerBatch(
        list.map((track) => track.file_path),
        player,
        label,
      );
      setFeedback(result);
      onPlayed(null);
    } catch (e) {
      setFeedback({ success: false, message: String(e) });
    } finally {
      setBatchLabel(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Üst Navigasyon & Araçlar */}
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border/40 pb-4 min-h-[72px]">
        {level.kind === 'top' ? (
          <div>
            <h1 className="font-serif text-3xl sm:text-4xl font-normal tracking-tight text-primary">
              {categoryLabel || t('music.title')}
            </h1>
            <p className="mt-1 text-xs text-tertiary font-mono">
              {t('music.summary', { a: displayedAlbums.length, r: displayedArtists.length })}
            </p>
          </div>
        ) : (
          <nav className="flex items-center gap-2 text-xs text-tertiary">
            <button
              type="button"
              onClick={() =>
                setLevel({
                  kind: 'top',
                  view: level.kind === 'artist' ? 'artists' : 'albums',
                })
              }
              className="hover:text-primary transition"
            >
              {categoryLabel || t('music.title')}
            </button>
            {level.kind === 'artist' && (
              <>
                <span>›</span>
                <button
                  type="button"
                  onClick={() => setLevel({ kind: 'top', view: 'artists' })}
                  className="hover:text-primary transition"
                >
                  {t('music.artists')}
                </button>
                <span>›</span>
                <span className="font-medium text-primary">{level.artist}</span>
              </>
            )}
            {level.kind === 'album' && (
              <>
                <span>›</span>
                <button
                  type="button"
                  onClick={() => setLevel({ kind: 'artist', artist: level.artist })}
                  className="hover:text-primary transition"
                >
                  {level.artist}
                </button>
                <span>›</span>
                <span className="font-medium text-primary">{level.album}</span>
              </>
            )}
            {level.kind === 'playlist' && (
              <>
                <span>›</span>
                <button
                  type="button"
                  onClick={() => setLevel({ kind: 'top', view: 'playlists' })}
                  className="hover:text-primary transition"
                >
                  {t('playlists.title')}
                </button>
                <span>›</span>
                <span className="font-medium text-primary">
                  {playlists.find((p) => p.id === level.playlistId)?.name || t('playlists.title')}
                </span>
              </>
            )}
          </nav>
        )}

        <div className="flex items-center gap-3 h-8">
          {level.kind === 'top' && (
            <div className="flex rounded-lg bg-surface p-1 ring-1 ring-border">
              {(['albums', 'artists', 'favorites', 'playlists'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setLevel({ kind: 'top', view: v })}
                  className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                    level.view === v
                      ? 'bg-surface-hover text-primary shadow-sm font-semibold'
                      : 'text-tertiary hover:text-secondary'
                  }`}
                >
                  {v === 'albums'
                    ? t('music.albums')
                    : v === 'artists'
                    ? t('music.artists')
                    : v === 'favorites'
                    ? t('common.favorites')
                    : t('playlists.title')}
                </button>
              ))}
            </div>
          )}

          {level.kind === 'top' &&
            (hasSources ? (
              <button
                type="button"
                onClick={onManageSources}
                className="flex items-center gap-1.5 rounded-lg bg-surface-hover px-3 py-1.5 text-xs font-medium text-secondary hover:text-primary ring-1 ring-border transition"
                title={t('sources.manageTitle')}
              >
                <SlidersHorizontal className="h-3.5 w-3.5 text-accent" />
                <span>{t('sources.manage')}</span>
              </button>
            ) : (
              onOpenScanModal && (
                <button
                  type="button"
                  onClick={onOpenScanModal}
                  className="flex items-center gap-1.5 rounded-lg bg-surface-hover px-3 py-1.5 text-xs font-medium text-secondary hover:text-primary ring-1 ring-border transition"
                >
                  <Plus className="h-3.5 w-3.5 text-accent" />
                  <span>{t('sources.add')}</span>
                </button>
              )
            ))}
        </div>
      </div>

      {feedback && (
        <p className={`text-xs ${feedback.success ? 'text-accent' : 'text-status-offline'}`}>
          {feedback.message}
        </p>
      )}

      {/* Sanatçı Başlık Banner'ı (Sanatçı Detay Görünümünde) */}
      {level.kind === 'artist' && (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-surface p-6 ring-1 ring-border">
          <div>
            <h1 className="font-serif text-3xl font-normal tracking-tight text-primary sm:text-4xl">
              {level.artist}
            </h1>
            <p className="mt-1 text-xs font-mono text-tertiary">
              {t('music.albumCount', { n: displayedAlbums.length })}
              {artistTrackCount > 0 ? ` · ${t('music.trackCount', { n: artistTrackCount })}` : ''}
              {artistDuration > 0 ? ` · ${formatDuration(artistDuration)}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              playAll(level.artist, () => getArtistTracks(level.artist))
            }
            disabled={batchLabel !== null || displayedAlbums.length === 0}
            className="rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-background transition hover:bg-accent-hover disabled:opacity-50"
          >
            {batchLabel === level.artist ? t('music.adding') : t('music.playAll')}
          </button>
        </div>
      )}

      {/* Ana Albüm Izgarası (Ana Sayfa) */}
      {level.kind === 'top' && level.view === 'albums' &&
        (albums.isLoading ? (
          <div className="py-24 text-center text-xs text-tertiary font-serif">
            {t('music.scanning')}
          </div>
        ) : displayedAlbums.length === 0 ? (
          <div className="py-24 text-center space-y-3">
            <p className="font-serif text-2xl text-secondary font-normal">{t('music.emptyAlbums')}</p>
            <p className="text-xs text-tertiary max-w-sm mx-auto">
              {hasSources
                ? t('music.emptyWithSources')
                : t('music.emptyNoSources')}
            </p>
            {hasSources ? (
              <button
                type="button"
                onClick={onManageSources}
                className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-xs font-medium text-background hover:bg-accent-hover transition"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                <span>{t('sources.manage')}</span>
              </button>
            ) : (
              onOpenScanModal && (
                <button
                  type="button"
                  onClick={onOpenScanModal}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-xs font-medium text-background hover:bg-accent-hover transition"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>{t('sources.addFirst')}</span>
                </button>
              )
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-x-5 gap-y-7 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8">
            {displayedAlbums.map((a: AlbumSummary) => {
              const label = `${a.artist} — ${a.album}`;
              const isCurrentAlbum =
                player === 'in_app' &&
                currentTrack?.album === a.album &&
                currentTrack?.artist === a.artist;

              return (
                <MediaCard
                  key={`${a.artist}::${a.album}`}
                  title={a.album || t('common.unknownAlbum')}
                  subtitle={a.artist || t('common.unknownArtist')}
                  meta={`${t('music.songCount', { n: a.track_count })}${
                    a.total_duration ? ` · ${formatDuration(a.total_duration)}` : ''
                  }`}
                  coverUrl={coverUrl(a.album, a.artist)}
                  aspect="1:1"
                  isPlaying={isCurrentAlbum}
                  isFavorite={isFavorite(a.folder_path || `album:${a.album}:${a.artist}`)}
                  onToggleFavorite={() =>
                    toggleFavorite({
                      id: a.folder_path || `album:${a.album}:${a.artist}`,
                      mediaType: 'song',
                      title: a.album,
                      subtitle: a.artist,
                      posterUrl: coverUrl(a.album, a.artist),
                    })
                  }
                  onClick={() => setLevel({ kind: 'album', album: a.album, artist: a.artist })}
                  onPlayHover={() =>
                    playAll(label, () => getAlbumTracks(a.album, a.artist))
                  }
                  playHoverLoading={batchLabel === label}
                />
              );
            })}
          </div>
        ))}

      {/* Favoriler Sekmesi (Müzik Ana Sayfası) */}
      {level.kind === 'top' && level.view === 'favorites' && (
        favoriteSongs.length === 0 ? (
          <div className="py-24 text-center space-y-3">
            <Heart className="h-10 w-10 text-tertiary mx-auto opacity-40 stroke-[1.2]" />
            <p className="font-serif text-2xl text-secondary font-normal">{t('common.noFavorites')}</p>
            <p className="text-xs text-tertiary max-w-sm mx-auto">
              {t('common.tip')} {t('common.addToFavorites')}
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl bg-surface ring-1 ring-border">
            <header className="flex items-center justify-between border-b border-border px-4 py-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-tertiary">
                {t('common.favorites')} ({favoriteSongs.length})
              </span>
              <button
                type="button"
                onClick={() => {
                  const mediaItems: MediaItem[] = favoriteSongs.map((f, i) => ({
                    id: `fav_${i}_${f.id}`,
                    title: f.title,
                    artist: f.subtitle || null,
                    album: f.meta || null,
                    file_path: f.id,
                    media_type: 'music',
                    file_size: 0,
                    disk_label: '',
                    format: 'mp3',
                    duration: null,
                    track_number: null,
                    disc_number: null,
                    year: null,
                    show_title: null,
                    season: null,
                    episode: null,
                    folder_path: null,
                    subtitle_count: 0,
                    subtitle_path: null,
                    genre: null,
                    sample_rate: null,
                    bit_depth: null,
                    channels: null,
                    cover_image_path: f.posterUrl || null,
                    created_at: null,
                    updated_at: null,
                  }));
                  if (player === 'in_app' && mediaItems.length > 0) {
                    playQueue(mediaItems, 0);
                  }
                }}
                className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-background hover:bg-accent-hover transition"
              >
                <span>{t('music.playAll')}</span>
              </button>
            </header>
            <div className="divide-y divide-border/40">
              {favoriteSongs.map((fav, i) => {
                const isCurrentInApp =
                  player === 'in_app' && currentTrack?.file_path === fav.id;
                const isPlayingRow = isCurrentInApp || playingPath === fav.id;

                const item: MediaItem = {
                  id: `fav_${i}_${fav.id}`,
                  title: fav.title,
                  artist: fav.subtitle || null,
                  album: fav.meta || null,
                  file_path: fav.id,
                  media_type: 'music',
                  file_size: 0,
                  disk_label: '',
                  format: 'mp3',
                  duration: null,
                  track_number: null,
                  disc_number: null,
                  year: null,
                  show_title: null,
                  season: null,
                  episode: null,
                  folder_path: null,
                  subtitle_count: 0,
                  subtitle_path: null,
                  genre: null,
                  sample_rate: null,
                  bit_depth: null,
                  channels: null,
                  cover_image_path: fav.posterUrl || null,
                  created_at: null,
                  updated_at: null,
                };

                return (
                  <div
                    key={fav.id}
                    onClick={() => playSingle(item)}
                    className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-xs transition hover:bg-surface-hover cursor-pointer ${
                      isPlayingRow ? 'bg-accent/10 text-accent font-medium' : 'text-primary'
                    }`}
                  >
                    <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded bg-surface-hover ring-1 ring-border">
                      {fav.posterUrl ? (
                        <img
                          src={fav.posterUrl}
                          alt={fav.title}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-tertiary">
                          ♪
                        </div>
                      )}
                    </div>

                    <div className="min-w-0 flex-1 flex flex-col justify-center">
                      <span className={`truncate ${isPlayingRow ? 'font-semibold text-accent' : 'text-primary'}`}>
                        {fav.title}
                      </span>
                      {fav.subtitle && (
                        <span className="truncate text-[11px] text-secondary">
                          {fav.subtitle} {fav.meta ? `— ${fav.meta}` : ''}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setTrackForPlaylist(item);
                        }}
                        title={t('playlists.addToPlaylist')}
                        className="p-1.5 text-tertiary hover:text-accent transition shrink-0 opacity-40 hover:opacity-100"
                      >
                        <ListPlus className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleFavorite({
                            id: fav.id,
                            mediaType: 'song',
                            title: fav.title,
                          });
                        }}
                        title={t('common.removeFromFavorites')}
                        className="p-1.5 text-accent hover:opacity-75 transition shrink-0"
                      >
                        <Heart className="h-4 w-4 fill-current" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )
      )}

      {/* Çalma Listeleri Sekmesi (Müzik Ana Sayfası) */}
      {level.kind === 'top' && level.view === 'playlists' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-tertiary">
              {t('playlists.title')} ({playlists.length})
            </h2>
            {!isCreatingPlaylist && (
              <button
                type="button"
                onClick={() => setIsCreatingPlaylist(true)}
                className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-background hover:bg-accent-hover transition shadow-sm"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>{t('playlists.createNew')}</span>
              </button>
            )}
          </div>

          {isCreatingPlaylist && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!newPlaylistName.trim()) return;
                const pl = createPlaylist(newPlaylistName.trim());
                setNewPlaylistName('');
                setIsCreatingPlaylist(false);
                setLevel({ kind: 'playlist', playlistId: pl.id });
              }}
              className="flex items-center gap-2 max-w-md rounded-xl bg-surface p-3 ring-1 ring-border"
            >
              <input
                type="text"
                autoFocus
                placeholder={t('playlists.namePlaceholder')}
                value={newPlaylistName}
                onChange={(e) => setNewPlaylistName(e.target.value)}
                className="flex-1 rounded-lg bg-surface-hover px-3 py-1.5 text-xs text-primary ring-1 ring-border focus:ring-accent focus:outline-none"
              />
              <button
                type="submit"
                disabled={!newPlaylistName.trim()}
                className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-background hover:bg-accent-hover transition disabled:opacity-50"
              >
                {t('common.add')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsCreatingPlaylist(false);
                  setNewPlaylistName('');
                }}
                className="rounded-lg bg-surface-hover px-3 py-1.5 text-xs text-secondary hover:text-primary transition"
              >
                {t('common.cancel')}
              </button>
            </form>
          )}

          {playlists.length === 0 && !isCreatingPlaylist ? (
            <div className="py-24 text-center space-y-3">
              <ListMusic className="h-10 w-10 text-tertiary mx-auto opacity-40 stroke-[1.2]" />
              <p className="font-serif text-2xl text-secondary font-normal">{t('playlists.noPlaylistsYet')}</p>
              <button
                type="button"
                onClick={() => setIsCreatingPlaylist(true)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-background hover:bg-accent-hover transition"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>{t('playlists.createNew')}</span>
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {playlists.map((pl) => {
                const firstCover = pl.tracks.find((t) => t.coverUrl)?.coverUrl;
                const plMediaItems: MediaItem[] = pl.tracks.map((trk, i) => ({
                  id: `pl_${pl.id}_${i}_${trk.filePath}`,
                  title: trk.title,
                  artist: trk.artist,
                  album: trk.album,
                  media_type: 'music',
                  file_path: trk.filePath,
                  file_size: 0,
                  disk_label: '',
                  format: 'mp3',
                  duration: trk.duration,
                  track_number: i + 1,
                  disc_number: null,
                  year: null,
                  show_title: null,
                  season: null,
                  episode: null,
                  folder_path: null,
                  subtitle_count: 0,
                  subtitle_path: null,
                  genre: null,
                  sample_rate: null,
                  bit_depth: null,
                  channels: null,
                  cover_image_path: trk.coverUrl || null,
                  created_at: null,
                  updated_at: null,
                }));

                return (
                  <div
                    key={pl.id}
                    onClick={() => setLevel({ kind: 'playlist', playlistId: pl.id })}
                    className="group relative flex flex-col cursor-pointer rounded-xl bg-surface p-3 ring-1 ring-border hover:ring-border-hover transition shadow-sm hover:shadow-md"
                  >
                    <div className="relative aspect-square w-full overflow-hidden rounded-lg bg-surface-hover flex items-center justify-center">
                      {firstCover ? (
                        <img
                          src={firstCover}
                          alt={pl.name}
                          className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-accent/10 to-accent/25 text-accent">
                          <ListMusic className="h-10 w-10 stroke-[1.2]" />
                        </div>
                      )}
                      {plMediaItems.length > 0 && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (player === 'in_app') {
                              playQueue(plMediaItems, 0);
                            }
                          }}
                          title={t('playlists.playAll')}
                          className="absolute bottom-2.5 right-2.5 flex h-10 w-10 items-center justify-center rounded-full bg-accent text-background shadow-lg opacity-0 translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-200 hover:scale-105"
                        >
                          <Play className="h-5 w-5 fill-current ml-0.5" />
                        </button>
                      )}
                    </div>
                    <div className="mt-2.5 min-w-0">
                      <p className="truncate font-medium text-xs text-primary group-hover:text-accent transition-colors">
                        {pl.name}
                      </p>
                      <p className="text-[11px] text-tertiary">
                        {t('playlists.trackCount', { n: pl.tracks.length })}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Sanatçıya Ait Albümler Izgarası (Sanatçı Tıklandığında) */}
      {level.kind === 'artist' &&
        (albums.isLoading ? (
          <div className="py-24 text-center text-xs text-tertiary font-serif">
            {t('music.loadingAlbums')}
          </div>
        ) : albums.isError ? (
          <div className="py-24 text-center space-y-3">
            <p className="font-serif text-xl text-status-offline">{t('music.albumsError')}</p>
            <button
              type="button"
              onClick={() => albums.refetch()}
              className="rounded-lg bg-surface-hover px-4 py-2 text-xs font-medium text-secondary hover:text-primary ring-1 ring-border transition"
            >
              {t('common.retry')}
            </button>
          </div>
        ) : displayedAlbums.length === 0 ? (
          <div className="py-24 text-center space-y-3">
            <p className="font-serif text-2xl text-secondary font-normal">{t('music.noArtistAlbums')}</p>
            <button
              type="button"
              onClick={() => setLevel({ kind: 'top', view: 'artists' })}
              className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-xs font-medium text-background hover:bg-accent-hover transition"
            >
              {t('music.backToArtists')}
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-x-5 gap-y-7 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8">
            {displayedAlbums.map((a: AlbumSummary) => {
              const label = `${a.artist} — ${a.album}`;
              const isCurrentAlbum =
                player === 'in_app' &&
                currentTrack?.album === a.album &&
                currentTrack?.artist === a.artist;

              return (
                <MediaCard
                  key={`${a.artist}::${a.album}`}
                  title={a.album || t('common.unknownAlbum')}
                  subtitle={a.artist || t('common.unknownArtist')}
                  meta={`${t('music.songCount', { n: a.track_count })}${
                    a.total_duration ? ` · ${formatDuration(a.total_duration)}` : ''
                  }`}
                  coverUrl={coverUrl(a.album, a.artist)}
                  aspect="1:1"
                  isPlaying={isCurrentAlbum}
                  onClick={() => setLevel({ kind: 'album', album: a.album, artist: a.artist })}
                  onPlayHover={() =>
                    playAll(label, () => getAlbumTracks(a.album, a.artist))
                  }
                  playHoverLoading={batchLabel === label}
                />
              );
            })}
          </div>
        ))}

      {/* Sanatçı Izgarası */}
      {level.kind === 'top' && level.view === 'artists' &&
        (artists.isLoading ? (
          <div className="py-24 text-center text-xs text-tertiary font-serif">
            {t('common.loading')}
          </div>
        ) : displayedArtists.length === 0 ? (
          <p className="py-24 text-center text-xs text-tertiary">{t('music.noArtists')}</p>
        ) : (
          <div className="grid grid-cols-2 gap-x-5 gap-y-7 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8">
            {displayedArtists.map((a: ArtistSummary) => (
              <MediaCard
                key={a.artist}
                title={a.artist || t('common.unknownArtist')}
                subtitle={t('music.albumCount', { n: a.album_count })}
                meta={t('music.trackCount', { n: a.track_count })}
                aspect="1:1"
                onClick={() => setLevel({ kind: 'artist', artist: a.artist })}
              />
            ))}
          </div>
        ))}

      {/* Albüm Detayı & Parça Listesi */}
      {level.kind === 'album' && (
        <section className="space-y-6">
          <header className="flex flex-col gap-6 rounded-xl bg-surface p-6 ring-1 ring-border sm:flex-row">
            <div className="relative aspect-square w-40 shrink-0 self-center overflow-hidden rounded-lg bg-surface-hover shadow-xl sm:self-start">
              <img
                src={coverUrl(level.album, level.artist)}
                alt={level.album}
                className="h-full w-full object-cover"
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                }}
              />
              <div className="absolute inset-0 -z-10 flex items-center justify-center font-serif text-4xl text-tertiary">
                {(level.album || '♪').slice(0, 1)}
              </div>
            </div>

            <div className="min-w-0 flex-1 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h1 className="font-serif text-3xl font-normal text-primary tracking-tight">
                    {level.album}
                  </h1>
                  <p className="text-base text-secondary mt-0.5">{level.artist}</p>
                </div>
                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    onClick={() =>
                      playAll(`${level.artist} — ${level.album}`, () =>
                        Promise.resolve(tracks.data ?? []),
                      )
                    }
                    disabled={batchLabel !== null || !tracks.data || tracks.data.length === 0}
                    className="rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-background transition hover:bg-accent-hover disabled:opacity-50"
                  >
                    {batchLabel ? t('music.adding') : t('music.playAll')}
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      toggleFavorite({
                        id: `album:${level.album}:${level.artist}`,
                        mediaType: 'song',
                        title: level.album,
                        subtitle: level.artist,
                        posterUrl: coverUrl(level.album, level.artist),
                      })
                    }
                    className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-medium transition ring-1 ${
                      isFavorite(`album:${level.album}:${level.artist}`)
                        ? 'bg-accent/15 text-accent ring-accent/40 font-semibold'
                        : 'bg-surface-hover text-secondary hover:text-primary ring-border'
                    }`}
                  >
                    <Heart
                      className={`h-4 w-4 ${
                        isFavorite(`album:${level.album}:${level.artist}`) ? 'fill-current' : ''
                      }`}
                    />
                    <span>
                      {isFavorite(`album:${level.album}:${level.artist}`)
                        ? t('common.removeFromFavorites')
                        : t('common.addToFavorites')}
                    </span>
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 text-xs text-tertiary pt-1">
                {(() => {
                  const first = tracks.data?.[0];
                  const total = (tracks.data ?? []).reduce(
                    (sum, track) => sum + (track.duration ?? 0),
                    0,
                  );
                  const parts = [
                    first?.year ? String(first.year) : null,
                    first?.genre ?? null,
                    tracks.data ? t('music.songCount', { n: tracks.data.length }) : null,
                    total > 0 ? formatDuration(total) : null,
                  ].filter(Boolean);
                  return parts.length > 0 ? <span>{parts.join(' • ')}</span> : null;
                })()}
              </div>
            </div>
          </header>

          {/* Parça Tablosu */}
          <div className="overflow-hidden rounded-xl bg-surface ring-1 ring-border">
            {tracks.isLoading ? (
              <p className="px-4 py-6 text-xs text-tertiary">{t('common.loading')}</p>
            ) : (
              <div className="divide-y divide-border/40">
                {tracks.data?.map((track, i) => {
                  const isCurrentInApp =
                    player === 'in_app' && currentTrack?.file_path === track.file_path;
                  const isPlayingRow = isCurrentInApp || playingPath === track.file_path;
                  const q = formatQuality(track);

                  return (
                    <button
                      key={track.id}
                      type="button"
                      onClick={() => playSingle(track)}
                      title={track.file_path}
                      className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-xs transition hover:bg-surface-hover ${
                        isPlayingRow ? 'bg-accent/10 text-accent font-medium' : 'text-primary'
                      }`}
                    >
                      <span className="w-8 shrink-0 text-center font-mono text-[11px] text-tertiary">
                        {isCurrentInApp ? (
                          <span className="text-accent font-bold">
                            {isPlaying ? '▶' : '⏸'}
                          </span>
                        ) : (
                          track.track_number ?? i + 1
                        )}
                      </span>
                      <div className="min-w-0 flex-1 flex flex-col justify-center">
                        <span
                          className={`truncate ${
                            isCurrentInApp ? 'font-semibold text-accent' : 'text-primary'
                          }`}
                        >
                          {track.title}
                        </span>
                        {track.artist && track.artist !== level.artist && (
                          <span className="truncate text-[11px] text-secondary">
                            {track.artist}
                          </span>
                        )}
                      </div>
                      {q && (
                        <span className="hidden shrink-0 rounded bg-surface-hover px-1.5 py-0.5 font-mono text-[10px] text-tertiary md:inline">
                          {q}
                        </span>
                      )}
                      {track.year && (
                        <span className="hidden shrink-0 text-xs text-tertiary sm:inline font-mono">
                          {track.year}
                        </span>
                      )}
                      <span
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleFavorite({
                            id: track.file_path,
                            mediaType: 'song',
                            title: track.title,
                            subtitle: track.artist || level.artist,
                            meta: level.album,
                            posterUrl: coverUrl(level.album, track.artist || level.artist),
                          });
                        }}
                        title={
                          isFavorite(track.file_path)
                            ? t('common.removeFromFavorites')
                            : t('common.addToFavorites')
                        }
                        className="p-1 text-tertiary hover:text-accent transition shrink-0"
                      >
                        <Heart
                          className={`h-3.5 w-3.5 ${
                            isFavorite(track.file_path)
                              ? 'fill-current text-accent'
                              : 'opacity-30 hover:opacity-100'
                          }`}
                        />
                      </span>
                      <span
                        onClick={(e) => {
                          e.stopPropagation();
                          setTrackForPlaylist(track);
                        }}
                        title={t('playlists.addToPlaylist')}
                        className="p-1 text-tertiary hover:text-accent transition shrink-0 opacity-30 hover:opacity-100"
                      >
                        <ListPlus className="h-3.5 w-3.5" />
                      </span>
                      <span className="w-12 shrink-0 text-right font-mono text-[11px] text-tertiary">
                        {formatDuration(track.duration)}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      )}

      {level.kind === 'playlist' && (() => {
        const pl = playlists.find((p) => p.id === level.playlistId);
        if (!pl) {
          return (
            <div className="py-20 text-center text-xs text-tertiary">
              <p>Playlist not found.</p>
              <button
                type="button"
                onClick={() => setLevel({ kind: 'top', view: 'playlists' })}
                className="mt-3 text-accent hover:underline"
              >
                Back to Playlists
              </button>
            </div>
          );
        }

        const plMediaItems: MediaItem[] = pl.tracks.map((trk, i) => ({
          id: `pl_${pl.id}_${i}_${trk.filePath}`,
          title: trk.title,
          artist: trk.artist,
          album: trk.album,
          media_type: 'music',
          file_path: trk.filePath,
          file_size: 0,
          disk_label: '',
          format: 'mp3',
          duration: trk.duration,
          track_number: i + 1,
          disc_number: null,
          year: null,
          show_title: null,
          season: null,
          episode: null,
          folder_path: null,
          subtitle_count: 0,
          subtitle_path: null,
          genre: null,
          sample_rate: null,
          bit_depth: null,
          channels: null,
          cover_image_path: trk.coverUrl || null,
          created_at: null,
          updated_at: null,
        }));

        const totalDuration = pl.tracks.reduce((sum, trk) => sum + (trk.duration ?? 0), 0);
        const firstCover = pl.tracks.find((t) => t.coverUrl)?.coverUrl;

        return (
          <section className="space-y-6 animate-in fade-in duration-150">
            {/* Playlist Header */}
            <header className="flex flex-col gap-6 sm:flex-row sm:items-end border-b border-border/40 pb-6">
              <div className="relative h-40 w-40 shrink-0 overflow-hidden rounded-2xl bg-surface ring-1 ring-border shadow-md flex items-center justify-center">
                {firstCover ? (
                  <img
                    src={firstCover}
                    alt={pl.name}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-accent/15 to-accent/30 text-accent">
                    <ListMusic className="h-16 w-16 stroke-[1.2]" />
                  </div>
                )}
              </div>

              <div className="flex-1 min-w-0 space-y-2">
                <span className="text-[11px] font-mono uppercase tracking-widest text-accent font-semibold">
                  {t('playlists.title')}
                </span>

                {isRenamingPlaylist ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (renameValue.trim()) {
                        renamePlaylist(pl.id, renameValue.trim());
                      }
                      setIsRenamingPlaylist(false);
                    }}
                    className="flex items-center gap-2 max-w-md"
                  >
                    <input
                      type="text"
                      autoFocus
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      className="flex-1 rounded-xl bg-surface px-3 py-1.5 text-xl font-serif text-primary ring-1 ring-border focus:ring-accent focus:outline-none"
                    />
                    <button
                      type="submit"
                      className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-background hover:bg-accent-hover transition"
                    >
                      {t('common.save')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsRenamingPlaylist(false)}
                      className="rounded-lg bg-surface-hover px-3 py-1.5 text-xs text-secondary hover:text-primary transition"
                    >
                      {t('common.cancel')}
                    </button>
                  </form>
                ) : (
                  <div className="flex items-center gap-3">
                    <h1 className="font-serif text-3xl sm:text-4xl text-primary font-normal tracking-tight truncate">
                      {pl.name}
                    </h1>
                    <button
                      type="button"
                      onClick={() => {
                        setRenameValue(pl.name);
                        setIsRenamingPlaylist(true);
                      }}
                      title={t('playlists.rename')}
                      className="p-1.5 text-tertiary hover:text-primary rounded-lg hover:bg-surface-hover transition"
                    >
                      <Edit2 className="h-4 w-4" />
                    </button>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2 text-xs text-tertiary">
                  <span>{t('playlists.trackCount', { n: pl.tracks.length })}</span>
                  {totalDuration > 0 && <span>• {formatDuration(totalDuration)}</span>}
                </div>

                <div className="flex flex-wrap items-center gap-3 pt-2">
                  <button
                    type="button"
                    disabled={plMediaItems.length === 0}
                    onClick={() => {
                      if (player === 'in_app' && plMediaItems.length > 0) {
                        playQueue(plMediaItems, 0);
                      }
                    }}
                    className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-xs font-semibold text-background hover:bg-accent-hover transition disabled:opacity-40 shadow-sm"
                  >
                    <Play className="h-4 w-4 fill-current" />
                    <span>{t('playlists.playAll')}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm(t('playlists.deleteConfirm'))) {
                        deletePlaylist(pl.id);
                        setLevel({ kind: 'top', view: 'playlists' });
                      }
                    }}
                    className="flex items-center gap-1.5 rounded-xl bg-surface-hover px-3.5 py-2 text-xs font-medium text-status-offline hover:bg-status-offline/10 transition ring-1 ring-border"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>{t('playlists.delete')}</span>
                  </button>
                </div>
              </div>
            </header>

            {/* Track List */}
            <div className="overflow-hidden rounded-xl bg-surface ring-1 ring-border">
              {pl.tracks.length === 0 ? (
                <div className="py-16 text-center text-xs text-tertiary space-y-2">
                  <ListMusic className="h-8 w-8 mx-auto opacity-40" />
                  <p>{t('playlists.emptyTracks')}</p>
                </div>
              ) : (
                <div className="divide-y divide-border/40">
                  {plMediaItems.map((trk, i) => {
                    const isCurrentInApp =
                      player === 'in_app' && currentTrack?.file_path === trk.file_path;
                    const isPlayingRow = isCurrentInApp || playingPath === trk.file_path;

                    return (
                      <div
                        key={`${trk.file_path}-${i}`}
                        onClick={() => playSingle(trk)}
                        className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-xs transition hover:bg-surface-hover cursor-pointer ${
                          isPlayingRow ? 'bg-accent/10 text-accent font-medium' : 'text-primary'
                        }`}
                      >
                        <span className="w-8 shrink-0 text-center font-mono text-[11px] text-tertiary">
                          {isCurrentInApp ? (
                            <span className="text-accent font-bold">
                              {isPlaying ? '▶' : '⏸'}
                            </span>
                          ) : (
                            i + 1
                          )}
                        </span>
                        <div className="min-w-0 flex-1 flex flex-col justify-center">
                          <span className={`truncate ${isCurrentInApp ? 'font-semibold text-accent' : 'text-primary'}`}>
                            {trk.title}
                          </span>
                          {trk.artist && (
                            <span className="truncate text-[11px] text-secondary">
                              {trk.artist}
                            </span>
                          )}
                        </div>
                        {trk.album && (
                          <span className="hidden sm:inline truncate text-[11px] text-tertiary max-w-[200px]">
                            {trk.album}
                          </span>
                        )}
                        <span
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleFavorite({
                              id: trk.file_path,
                              mediaType: 'song',
                              title: trk.title,
                              subtitle: trk.artist || undefined,
                              meta: trk.album || undefined,
                              posterUrl: trk.cover_image_path || undefined,
                            });
                          }}
                          title={
                            isFavorite(trk.file_path)
                              ? t('common.removeFromFavorites')
                              : t('common.addToFavorites')
                          }
                          className="p-1 text-tertiary hover:text-accent transition shrink-0"
                        >
                          <Heart
                            className={`h-3.5 w-3.5 ${
                              isFavorite(trk.file_path)
                                ? 'fill-current text-accent'
                                : 'opacity-30 hover:opacity-100'
                            }`}
                          />
                        </span>
                        <span
                          onClick={(e) => {
                            e.stopPropagation();
                            removeTrackFromPlaylist(pl.id, trk.file_path);
                          }}
                          title={t('playlists.removeFromPlaylist')}
                          className="p-1 text-tertiary hover:text-status-offline transition shrink-0 opacity-40 hover:opacity-100"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </span>
                        <span className="w-12 shrink-0 text-right font-mono text-[11px] text-tertiary">
                          {formatDuration(trk.duration)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        );
      })()}

      <AddToPlaylistModal
        isOpen={Boolean(trackForPlaylist)}
        track={trackForPlaylist}
        onClose={() => setTrackForPlaylist(null)}
      />
    </div>
  );
}

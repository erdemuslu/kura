import { useEffect, useState } from 'react';
import { Plus, SlidersHorizontal } from 'lucide-react';
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
import { useAlbums, useAlbumTracks, useArtists } from '../hooks/useMedia';
import { formatDuration, formatQuality } from '../lib/format';
import { matchesCategoryPath } from '../lib/path';
import { resetScrollTop } from '../lib/scroll';
import MediaCard from './MediaCard';

type Level =
  | { kind: 'top'; view: 'albums' | 'artists' }
  | { kind: 'artist'; artist: string }
  | { kind: 'album'; album: string; artist: string };

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
  const [level, setLevel] = useState<Level>({ kind: 'top', view: 'albums' });
  const [batchLabel, setBatchLabel] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ success: boolean; message: string } | null>(null);

  const { currentTrack, isPlaying, playTrack, playQueue } = useAudioPlayer();

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
          </nav>
        )}

        <div className="flex items-center gap-3 h-8">
          {level.kind === 'top' && (
            <div className="flex rounded-lg bg-surface p-1 ring-1 ring-border">
              {(['albums', 'artists'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setLevel({ kind: 'top', view: v })}
                  className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                    level.view === v
                      ? 'bg-surface-hover text-primary shadow-sm'
                      : 'text-tertiary hover:text-secondary'
                  }`}
                >
                  {v === 'albums' ? t('music.albums') : t('music.artists')}
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
    </div>
  );
}

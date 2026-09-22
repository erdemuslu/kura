/**
 * Hiyerarşik müzik tarayıcı:
 *   Müzik › (Albümler | Sanatçılar) › Sanatçı › Albüm › Şarkı listesi
 *
 * - Albüm kartına tıklayınca içindeki şarkılar (tek tek çalanabilir)
 * - Sanatçı kartuna tıklayınca albümleri
 * - Her kartta "⋯" menüsü → "Tümünü Çal": kartın tüm şarkılarını
 *   .m3u8 playlist olarak seçili oynatıcıya ekler
 * - Hem masaüstünde (IPC) hem tarayıcıda (REST) çalışır
 */
import { useState } from 'react';
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
import { useAlbums, useAlbumTracks, useArtists } from '../hooks/useMedia';
import { formatDuration } from './MediaGrid';

/** Parça için ses kalitesi rozeti metni: "44.1 kHz • 16 bit". */
function formatQuality(item: MediaItem): string {
  const parts: string[] = [];
  if (item.sample_rate) {
    const khz = item.sample_rate / 1000;
    parts.push(`${Number.isInteger(khz) ? khz : khz.toFixed(1)} kHz`);
  }
  if (item.bit_depth) parts.push(`${item.bit_depth} bit`);
  return parts.join(' • ');
}

type Level =
  | { kind: 'top'; view: 'albums' | 'artists' }
  | { kind: 'artist'; artist: string }
  | { kind: 'album'; album: string; artist: string };

interface MusicCardProps {
  title: string;
  subtitle: string;
  meta: string;
  cover: string | null;
  onClick: () => void;
  onPlayAll: () => void;
  playAllLoading: boolean;
}

/** Albüm/sanatçı kartı — kapak imajı + köşede "⋯" menüsü ("Tümünü Çal").
 *  Kapak yüklenemezse (404) onError ile gizlenir, gradient placeholder kalır. */
function MusicCard({
  title,
  subtitle,
  meta,
  cover,
  onClick,
  onPlayAll,
  playAllLoading,
}: MusicCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div className="group overflow-hidden rounded-xl bg-slate-800/60 ring-1 ring-slate-700 transition hover:ring-sky-400">
      <div
        className="relative flex aspect-square cursor-pointer items-center justify-center bg-gradient-to-br from-emerald-600/40 to-teal-900/60"
        onClick={onClick}
      >
        <span className="select-none text-4xl font-bold text-white/15 group-hover:text-white/25">
          {title.trim().slice(0, 1).toUpperCase() || '?'}
        </span>
        {cover && (
          <img
            src={cover}
            alt={title}
            loading="lazy"
            className="absolute inset-0 h-full w-full object-cover"
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
          />
        )}
        <div className="absolute right-2 top-2" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={() => setMenuOpen(!menuOpen)}
            title="Menü"
            className="rounded-lg bg-slate-900/70 px-2 py-0.5 text-sm text-slate-300 opacity-0 ring-1 ring-slate-600 transition group-hover:opacity-100 focus:opacity-100"
          >
            ⋯
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-full z-20 mt-1 w-40 rounded-lg bg-slate-800 py-1 shadow-xl ring-1 ring-slate-600">
              <button
                type="button"
                disabled={playAllLoading}
                onClick={() => {
                  setMenuOpen(false);
                  onPlayAll();
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-slate-100 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {playAllLoading ? '⏳ Ekleniyor…' : '▶ Tümünü Çal'}
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="cursor-pointer p-3" onClick={onClick}>
        <p className="truncate text-sm font-medium text-slate-100">{title}</p>
        <p className="truncate text-xs text-slate-400">{subtitle}</p>
        <p className="mt-1 truncate text-[11px] text-slate-500">{meta}</p>
      </div>
    </div>
  );
}

interface MusicViewProps {
  player: string;
  query: string;
  playingPath: string | null;
  onPlayed: (path: string | null) => void;
}

export default function MusicView({ player, query, playingPath, onPlayed }: MusicViewProps) {
  const [level, setLevel] = useState<Level>({ kind: 'top', view: 'albums' });
  const [batchLabel, setBatchLabel] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ success: boolean; message: string } | null>(null);

  const showAlbums = level.kind !== 'top' || level.view === 'albums';
  const artists = useArtists(query);
  // Sanatçı seviyesindeysek o sanatçının albümleri, yoksa tüm albümler
  const albums = useAlbums(query, level.kind === 'artist' ? level.artist : undefined);
  const tracks = useAlbumTracks(
    level.kind === 'album' ? level.album : '',
    level.kind === 'album' ? level.artist : '',
    level.kind === 'album',
  );

  const playSingle = async (item: MediaItem) => {
    onPlayed(item.file_path);
    setFeedback(await launchPlayer({ filePath: item.file_path, targetApp: player }));
  };

  /** Kartın tüm şarkılarını playlist olarak oynatıcıya ekler. */
  const playAll = async (label: string, fetchTracks: () => Promise<MediaItem[]>) => {
    setBatchLabel(label);
    setFeedback(null);
    try {
      const list = await fetchTracks();
      if (list.length === 0) {
        setFeedback({ success: false, message: `"${label}" için çalınacak şarkı bulunamadı` });
        return;
      }
      const result = await launchPlayerBatch(
        list.map((t) => t.file_path),
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
    <div className="space-y-4">
      {/* Breadcrumb + görünüm değiştirici */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav className="flex flex-wrap items-center gap-1.5 text-sm">
          <button
            type="button"
            onClick={() => setLevel({ kind: 'top', view: 'albums' })}
            className="text-slate-400 hover:text-slate-200"
          >
            Müzik
          </button>
          {level.kind === 'artist' && (
            <>
              <span className="text-slate-600">›</span>
              <span className="font-medium text-slate-100">{level.artist}</span>
            </>
          )}
          {level.kind === 'album' && (
            <>
              <span className="text-slate-600">›</span>
              <button
                type="button"
                onClick={() => setLevel({ kind: 'artist', artist: level.artist })}
                className="text-slate-400 hover:text-slate-200"
              >
                {level.artist}
              </button>
              <span className="text-slate-600">›</span>
              <span className="font-medium text-slate-100">{level.album}</span>
            </>
          )}
        </nav>
        {level.kind === 'top' && (
          <div className="flex w-fit gap-1 rounded-lg bg-slate-800/60 p-1">
            {(['albums', 'artists'] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setLevel({ kind: 'top', view: v })}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                  level.view === v
                    ? 'bg-slate-700 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {v === 'albums' ? 'Albümler' : 'Sanatçılar'}
              </button>
            ))}
          </div>
        )}
      </div>

      {feedback && (
        <p className={`text-sm ${feedback.success ? 'text-emerald-300' : 'text-red-400'}`}>
          {feedback.message}
        </p>
      )}

      {/* Albüm ızgarası (üst seviye "Albümler" veya sanatçı seviyesi) */}
      {showAlbums && level.kind !== 'album' &&
        (albums.isLoading ? (
          <p className="py-16 text-center text-slate-400">Yükleniyor…</p>
        ) : (albums.data ?? []).length === 0 ? (
          <p className="py-16 text-center text-slate-400">
            Kayıtlı albüm yok. Dizin tarayıcı ile bir müzik klasörü ekleyin.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
            {(albums.data ?? []).map((a: AlbumSummary) => {
              const label = `${a.artist} — ${a.album}`;
              return (
                <MusicCard
                  key={label}
                  title={a.album}
                  subtitle={a.artist}
                  meta={`${a.track_count} şarkı${
                    a.total_duration ? ` • ${formatDuration(a.total_duration)}` : ''
                  }`}
                  cover={a.has_cover ? coverUrl(a.album, a.artist) : null}
                  onClick={() => setLevel({ kind: 'album', album: a.album, artist: a.artist })}
                  onPlayAll={() => playAll(label, () => getAlbumTracks(a.album, a.artist))}
                  playAllLoading={batchLabel === label}
                />
              );
            })}
          </div>
        ))}

      {/* Sanatçı ızgarası (yalnızca üst seviye "Sanatçılar" görünümü) */}
      {level.kind === 'top' && level.view === 'artists' &&
        (artists.isLoading ? (
          <p className="py-16 text-center text-slate-400">Yükleniyor…</p>
        ) : (artists.data ?? []).length === 0 ? (
          <p className="py-16 text-center text-slate-400">
            Kayıtlı sanatçı yok. Dizin tarayıcı ile bir müzik klasörü ekleyin.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
            {(artists.data ?? []).map((a: ArtistSummary) => (
              <MusicCard
                key={a.artist}
                title={a.artist}
                subtitle={`${a.album_count} albüm`}
                meta={`${a.track_count} şarkı`}
                cover={null}
                onClick={() => setLevel({ kind: 'artist', artist: a.artist })}
                onPlayAll={() => playAll(a.artist, () => getArtistTracks(a.artist))}
                playAllLoading={batchLabel === a.artist}
              />
            ))}
          </div>
        ))}

      {/* Şarkı listesi (albüm seviyesi) */}
      {level.kind === 'album' && (
        <section className="overflow-hidden rounded-xl ring-1 ring-slate-700">
          <header className="flex flex-col gap-4 bg-slate-800/60 p-4 sm:flex-row">
            {/* Büyük albüm kapağı — yüklenemezse gradient placeholder kalır */}
            <div className="relative h-36 w-36 shrink-0 overflow-hidden rounded-xl bg-gradient-to-br from-emerald-600/40 to-teal-900/60 ring-1 ring-slate-700">
              <span className="absolute inset-0 flex items-center justify-center text-3xl font-bold text-white/15">
                {level.album.trim().slice(0, 1).toUpperCase() || '?'}
              </span>
              <img
                src={coverUrl(level.album, level.artist)}
                alt={level.album}
                className="absolute inset-0 h-full w-full object-cover"
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                }}
              />
            </div>
            <div className="flex min-w-0 flex-1 items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="truncate text-base font-semibold text-slate-100">
                  {level.album}
                </p>
                <p className="truncate text-sm text-slate-400">{level.artist}</p>
                <div className="mt-1.5 flex flex-wrap gap-x-2 gap-y-1 text-xs text-slate-400">
                  {(() => {
                    const first = tracks.data?.[0];
                    const total = (tracks.data ?? []).reduce(
                      (sum, t) => sum + (t.duration ?? 0),
                      0,
                    );
                    const parts = [
                      first?.year ? String(first.year) : null,
                      first?.genre ?? null,
                      tracks.data ? `${tracks.data.length} şarkı` : null,
                      total > 0 ? formatDuration(total) : null,
                    ].filter(Boolean);
                    return parts.length > 0 ? <span>{parts.join(' • ')}</span> : null;
                  })()}
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  playAll(`${level.artist} — ${level.album}`, () =>
                    Promise.resolve(tracks.data ?? []),
                  )
                }
                disabled={batchLabel !== null || !tracks.data || tracks.data.length === 0}
                className="shrink-0 self-end rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {batchLabel ? 'Ekleniyor…' : '▶ Tümünü Çal'}
              </button>
            </div>
          </header>
          {tracks.isLoading ? (
            <p className="px-4 py-6 text-sm text-slate-400">Yüklenıyor…</p>
          ) : (
            <div className="divide-y divide-slate-800">
              {tracks.data?.map((t, i) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => playSingle(t)}
                  title={t.file_path}
                  className={`flex w-full items-center gap-3 px-4 py-2 text-left text-sm transition hover:bg-slate-800/60 ${
                    playingPath === t.file_path ? 'bg-emerald-500/10' : ''
                  }`}
                >
                  <span className="w-8 shrink-0 text-right font-mono text-xs text-slate-500">
                    {t.track_number ?? i + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-slate-100">{t.title}</span>
                  {(() => {
                    const q = formatQuality(t);
                    return q ? (
                      <span className="hidden shrink-0 rounded bg-slate-700/70 px-1.5 py-0.5 font-mono text-[10px] text-slate-400 md:inline">
                        {q}
                      </span>
                    ) : null;
                  })()}
                  {t.year ? (
                    <span className="hidden shrink-0 text-xs text-slate-500 sm:inline">
                      {t.year}
                    </span>
                  ) : null}
                  <span className="w-12 shrink-0 text-right font-mono text-xs text-slate-400">
                    {formatDuration(t.duration)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

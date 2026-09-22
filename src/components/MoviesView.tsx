/**
 * Film tarayıcı: klasör bazında gruplanmış film kartları.
 * - Her kart = bir klasör (CD1/CD2 gibi çoklu videolar tek kartta birleşir)
 * - Kart tıklaması grubu oynatır (tek dosya direkt açılır, çoklu dosya
 *   m3u8 playlist olarak sırayla açılır)
 * - "CC" rozeti: aynı adlı altyazı mevcut (oynatıcı otomatik yükler)
 */
import { useState } from 'react';
import {
  getMovieFiles,
  launchPlayerBatch,
  posterUrlMovie,
  type LaunchResult,
  type MovieGroup,
} from '../api/client';
import { useMovies } from '../hooks/useMedia';
import { formatSize } from '../lib/format';

interface MoviesViewProps {
  player: string;
  query: string;
  playingLabel: string | null;
  onPlayed: (label: string | null) => void;
}

export default function MoviesView({
  player,
  query,
  playingLabel,
  onPlayed,
}: MoviesViewProps) {
  const movies = useMovies(query);
  const [playing, setPlaying] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<LaunchResult | null>(null);

  /** Grubu oynat: tek dosya direkt, çoklu dosya playlist olarak. */
  const playGroup = async (group: MovieGroup) => {
    setPlaying(group.title);
    onPlayed(group.title);
    setFeedback(null);
    try {
      const files = await getMovieFiles(group.folder_path);
      if (files.length === 0) {
        setFeedback({ success: false, message: 'Film dosyaları bulunamadı' });
        return;
      }
      setFeedback(
        await launchPlayerBatch(
          files.map((f) => f.file_path),
          player,
          group.title,
        ),
      );
    } catch (e) {
      setFeedback({ success: false, message: String(e) });
    } finally {
      setPlaying(null);
    }
  };

  return (
    <div className="space-y-4">
      {feedback && (
        <p className={`text-sm ${feedback.success ? 'text-emerald-300' : 'text-red-400'}`}>
          {feedback.message}
        </p>
      )}

      {movies.isLoading ? (
        <p className="py-16 text-center text-slate-400">Yükleniyor…</p>
      ) : (movies.data ?? []).length === 0 ? (
        <p className="py-16 text-center text-slate-400">
          Kayıtlı film yok. Dizin tarayıcı ile bir film klasörü ekleyin.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
          {(movies.data ?? []).map((m) => (
            <button
              key={m.folder_path}
              type="button"
              disabled={playing !== null}
              onClick={() => playGroup(m)}
              title={m.title}
              className={`group relative flex aspect-[2/3] flex-col justify-end overflow-hidden rounded-xl bg-gradient-to-br from-indigo-600/40 to-violet-900/60 p-3 text-left ring-1 transition hover:ring-sky-400 disabled:cursor-not-allowed disabled:opacity-60 ${
                playingLabel === m.title ? 'ring-2 ring-emerald-400' : 'ring-slate-700'
              }`}
            >
              <span className="select-none text-4xl font-bold text-white/15 group-hover:text-white/25">
                {m.title.trim().slice(0, 1).toUpperCase() || '?'}
              </span>
              {/* Poster: klasör posteri → TMDB zinciri; 404'de gizlenir,
                  gradient + başlık bilgisi yerinde kalır */}
              <img
                src={posterUrlMovie(m.title, m.folder_path)}
                alt={m.title}
                loading="lazy"
                className="absolute inset-0 h-full w-full object-cover"
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                }}
              />
              <div className="relative z-10 min-w-0">
                <p className="truncate text-sm font-medium text-white drop-shadow">
                  {m.title}
                </p>
                <div className="mt-1 flex flex-wrap gap-1 font-mono text-[10px] text-slate-200">
                  {m.file_count > 1 && (
                    <span className="rounded bg-slate-900/70 px-1.5 py-0.5">
                      {m.file_count} dosya
                    </span>
                  )}
                  {m.has_subtitles && (
                    <span className="rounded bg-slate-900/70 px-1.5 py-0.5">CC</span>
                  )}
                  <span className="rounded bg-slate-900/70 px-1.5 py-0.5">
                    {formatSize(m.total_size)}
                  </span>
                </div>
              </div>
              {playing === m.title && (
                <span className="absolute inset-x-0 top-2 text-center text-xs text-sky-300">
                  Açılıyor…
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Film tarayıcı: klasör bazında gruplanmış film kartları + detay view.
 * - Kart tıklaması detay sayfası açar (Dizi tarayıcısıyla aynı UX)
 * - Detayda: büyük poster, metadata (yıl/puan/süre/türler/özet),
 *   "▶ Oynat" düğmesi (çoklu dosya = playlist) ve dosya listesi
 *   (tek tıkla o dosyayı çalma)
 */
import { useState } from 'react';
import {
  launchPlayer,
  launchPlayerBatch,
  posterUrlMovie,
  type LaunchResult,
  type MediaItem,
  type MovieGroup,
} from '../api/client';
import { useMeta, useMovieFiles, useMovies } from '../hooks/useMedia';
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
  const [detail, setDetail] = useState<MovieGroup | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<LaunchResult | null>(null);

  // Detay view sorguları (detail null iken atlanır)
  const detailFiles = useMovieFiles(detail ? detail.folder_path : null);
  const detailMeta = useMeta('movie', detail ? detail.title : null);

  /** Detaydaki grubu oynat: tek dosya direkt, çoklu dosya playlist olarak. */
  const playGroup = async (group: MovieGroup) => {
    setPlaying(group.title);
    onPlayed(group.title);
    setFeedback(null);
    try {
      const files = detailFiles.data ?? [];
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

  /** Detaydaki tek dosyayı çalar. */
  const playFile = async (file: MediaItem) => {
    setPlaying(file.file_path);
    onPlayed(file.file_path);
    setFeedback(null);
    try {
      setFeedback(
        await launchPlayer({ filePath: file.file_path, targetApp: player }),
      );
    } catch (e) {
      setFeedback({ success: false, message: String(e) });
    } finally {
      setPlaying(null);
    }
  };

  // ——— Detay view ———
  if (detail) {
    const meta = detailMeta.data;
    const files = detailFiles.data ?? [];
    const badges: string[] = [];
    if (meta?.year) badges.push(meta.year);
    if (meta?.rating) badges.push(`★ ${meta.rating.toFixed(1)}`);
    if (meta?.runtime) {
      const h = Math.floor(meta.runtime / 60);
      const m = meta.runtime % 60;
      badges.push(h > 0 ? `${h}s ${m}dk` : `${m}dk`);
    }
    return (
      <div className="space-y-4">
        <nav className="flex flex-wrap items-center gap-1.5 text-sm">
          <button
            type="button"
            onClick={() => setDetail(null)}
            className="text-slate-400 hover:text-slate-200"
          >
            Filmler
          </button>
          <span className="text-slate-600">›</span>
          <span className="font-medium text-slate-100">{detail.title}</span>
        </nav>

        {feedback && (
          <p className={`text-sm ${feedback.success ? 'text-emerald-300' : 'text-red-400'}`}>
            {feedback.message}
          </p>
        )}

        {/* Başlık: poster + metadata */}
        <section className="flex flex-col gap-4 rounded-xl bg-slate-800/60 p-4 ring-1 ring-slate-700 sm:flex-row">
          <div className="relative h-48 w-32 shrink-0 self-center overflow-hidden rounded-lg bg-gradient-to-br from-indigo-600/40 to-violet-900/60 ring-1 ring-slate-700 sm:self-start">
            <span className="absolute inset-0 flex items-center justify-center text-2xl font-bold text-white/15">
              {detail.title.trim().slice(0, 1).toUpperCase() || '?'}
            </span>
            <img
              src={posterUrlMovie(detail.title, detail.folder_path)}
              alt={detail.title}
              className="absolute inset-0 h-full w-full object-cover"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
              }}
            />
          </div>
          <div className="min-w-0 flex-1 space-y-2">
            <p className="text-lg font-semibold text-slate-100">{detail.title}</p>
            {badges.length > 0 && (
              <div className="flex flex-wrap gap-1.5 text-[11px]">
                {badges.map((b) => (
                  <span key={b} className="rounded-full bg-slate-700/70 px-2 py-0.5 text-slate-300">
                    {b}
                  </span>
                ))}
              </div>
            )}
            {meta?.genres && meta.genres.length > 0 && (
              <div className="flex flex-wrap gap-1.5 text-[11px]">
                {meta.genres.map((g) => (
                  <span key={g} className="rounded-full bg-sky-500/15 px-2 py-0.5 text-sky-300">
                    {g}
                  </span>
                ))}
              </div>
            )}
            <p className="text-xs text-slate-500">
              {detail.file_count} dosya • {formatSize(detail.total_size)}
              {detail.has_subtitles ? ' • CC' : ''}
              {detail.disk_label ? ` • ${detail.disk_label}` : ''}
            </p>
            {meta?.overview && (
              <p className="text-sm leading-relaxed text-slate-300">{meta.overview}</p>
            )}
            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                onClick={() => playGroup(detail)}
                disabled={playing !== null}
                className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {playing === detail.title
                  ? 'Açılıyor…'
                  : `▶ Oynat${detail.file_count > 1 ? ' (tümü)' : ''}`}
              </button>
            </div>
          </div>
        </section>

        {/* Dosya listesi */}
        <section className="overflow-hidden rounded-xl ring-1 ring-slate-700">
          {detailFiles.isLoading ? (
            <p className="px-4 py-6 text-sm text-slate-400">Yükleniyor…</p>
          ) : (
            <div className="divide-y divide-slate-800">
              {files.map((f) => {
                const name = f.file_path.split('/').pop() ?? f.file_path;
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => playFile(f)}
                    title={f.file_path}
                    className={`flex w-full items-center gap-3 px-4 py-2 text-left text-sm transition hover:bg-slate-800/60 ${
                      playingLabel === f.file_path ? 'bg-emerald-500/10' : ''
                    }`}
                  >
                    <span className="min-w-0 flex-1 truncate text-slate-100">{name}</span>
                    {f.subtitle_count > 0 && (
                      <span className="shrink-0 rounded bg-slate-700/70 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">
                        CC
                      </span>
                    )}
                    <span className="w-14 shrink-0 text-right font-mono text-[10px] text-slate-500 uppercase">
                      {f.format}
                    </span>
                    <span className="w-16 shrink-0 text-right font-mono text-[10px] text-slate-500">
                      {formatSize(f.file_size)}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      </div>
    );
  }

  // ——— Kart ızgarası ———
  return (
    <div className="space-y-4">
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
              onClick={() => setDetail(m)}
              title={m.title}
              className={`group relative flex aspect-[2/3] flex-col justify-end overflow-hidden rounded-xl bg-gradient-to-br from-indigo-600/40 to-violet-900/60 p-3 text-left ring-1 transition hover:ring-sky-400 ${
                playingLabel === m.title ? 'ring-2 ring-emerald-400' : 'ring-slate-700'
              }`}
            >
              <span className="select-none text-4xl font-bold text-white/15 group-hover:text-white/25">
                {m.title.trim().slice(0, 1).toUpperCase() || '?'}
              </span>
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
            </button>
          ))}
        </div>
      )}
    </div>
  );
}


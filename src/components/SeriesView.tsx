/**
 * Dizi tarayıcı: Dizi → Sezon → Bölüm hiyerarşisi (breadcrumb'lı).
 * - Dizi kartı → sezon listesi → bölüm satırları
 * - Dizi/sezon kartında "⋯" menüsü → "Tümünü Çal" (bölümler playlist olarak)
 * - Bölüm satırına tıklama = tek bölüm oynatma; "CC" = altyazı mevcut
 */
import { useState } from 'react';
import {
  getEpisodes,
  launchPlayer,
  launchPlayerBatch,
  posterUrlSeries,
  type LaunchResult,
  type MediaItem,
} from '../api/client';
import { useEpisodes, useSeasons, useShows } from '../hooks/useMedia';

type Level =
  | { kind: 'shows' }
  | { kind: 'seasons'; show: string }
  | { kind: 'episodes'; show: string; season: number };

interface SeriesViewProps {
  player: string;
  query: string;
  playingPath: string | null;
  onPlayed: (path: string | null) => void;
}

export default function SeriesView({
  player,
  query,
  playingPath,
  onPlayed,
}: SeriesViewProps) {
  const [level, setLevel] = useState<Level>({ kind: 'shows' });
  const [batchLabel, setBatchLabel] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<LaunchResult | null>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  const shows = useShows(query);
  const seasons = useSeasons(
    level.kind === 'shows' ? null : level.show,
  );
  const atEpisodes = level.kind === 'episodes';
  const episodes = useEpisodes(
    level.kind === 'shows' ? null : level.show,
    atEpisodes ? level.season : null,
    false,
  );

  const playEpisode = async (item: MediaItem) => {
    onPlayed(item.file_path);
    setFeedback(await launchPlayer({ filePath: item.file_path, targetApp: player }));
  };

  const playAll = async (label: string, fetchEps: () => Promise<MediaItem[]>) => {
    setBatchLabel(label);
    setFeedback(null);
    try {
      const eps = await fetchEps();
      if (eps.length === 0) {
        setFeedback({ success: false, message: `"${label}" için oynatılacak bölüm yok` });
        return;
      }
      setFeedback(
        await launchPlayerBatch(
          eps.map((e) => e.file_path),
          player,
          label,
        ),
      );
      onPlayed(null);
    } catch (e) {
      setFeedback({ success: false, message: String(e) });
    } finally {
      setBatchLabel(null);
    }
  };

  const menuButton = (id: string, onPlayAll: () => void, loading: boolean) => (
    <div className="absolute right-2 top-2" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpenMenu(openMenu === id ? null : id)}
        title="Menü"
        className="rounded-lg bg-slate-900/70 px-2 py-0.5 text-sm text-slate-300 opacity-0 ring-1 ring-slate-600 transition group-hover:opacity-100 focus:opacity-100"
      >
        ⋯
      </button>
      {openMenu === id && (
        <div className="absolute right-0 top-full z-20 mt-1 w-40 rounded-lg bg-slate-800 py-1 shadow-xl ring-1 ring-slate-600">
          <button
            type="button"
            disabled={loading}
            onClick={() => {
              setOpenMenu(null);
              onPlayAll();
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-slate-100 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? '⏳ Ekleniyor…' : '▶ Tümünü Çal'}
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Breadcrumb */}
      <nav className="flex flex-wrap items-center gap-1.5 text-sm">
        <button
          type="button"
          onClick={() => setLevel({ kind: 'shows' })}
          className="text-slate-400 hover:text-slate-200"
        >
          Diziler
        </button>
        {level.kind === 'seasons' && (
          <>
            <span className="text-slate-600">›</span>
            <span className="font-medium text-slate-100">{level.show}</span>
          </>
        )}
        {level.kind === 'episodes' && (
          <>
            <span className="text-slate-600">›</span>
            <button
              type="button"
              onClick={() => setLevel({ kind: 'seasons', show: level.show })}
              className="text-slate-400 hover:text-slate-200"
            >
              {level.show}
            </button>
            <span className="text-slate-600">›</span>
            <span className="font-medium text-slate-100">Sezon {level.season}</span>
          </>
        )}
      </nav>

      {feedback && (
        <p className={`text-sm ${feedback.success ? 'text-emerald-300' : 'text-red-400'}`}>
          {feedback.message}
        </p>
      )}

      {/* Dizi ızgarası (üst seviye) */}
      {level.kind === 'shows' &&
        (shows.isLoading ? (
          <p className="py-16 text-center text-slate-400">Yükleniyor…</p>
        ) : (shows.data ?? []).length === 0 ? (
          <p className="py-16 text-center text-slate-400">
            Kayıtlı dizi yok. Dizin tarayıcı ile bir dizi klasörü ekleyin
            (dosya adlarında S01E01 gibi bölüm deseni olmalı).
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
            {(shows.data ?? []).map((s) => (
              <div
                key={s.show_title}
                className="group relative cursor-pointer overflow-hidden rounded-xl bg-slate-800/60 ring-1 ring-slate-700 transition hover:ring-sky-400"
                onClick={() => setLevel({ kind: 'seasons', show: s.show_title })}
              >
                <div className="relative flex aspect-[2/3] items-center justify-center bg-gradient-to-br from-sky-600/40 to-cyan-900/60">
                  <span className="select-none text-4xl font-bold text-white/15 group-hover:text-white/25">
                    {s.show_title.trim().slice(0, 1).toUpperCase() || '?'}
                  </span>
                  {/* Poster: TMDB; 404'de gizlenir, gradient kalır */}
                  <img
                    src={posterUrlSeries(s.show_title)}
                    alt={s.show_title}
                    loading="lazy"
                    className="absolute inset-0 h-full w-full object-cover"
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                    }}
                  />
                </div>
                {menuButton(
                  s.show_title,
                  () => playAll(s.show_title, () => getEpisodes(s.show_title)),
                  batchLabel === s.show_title,
                )}
                <div className="p-3">
                  <p className="truncate text-sm font-medium text-slate-100">
                    {s.show_title}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-500">
                    {s.season_count} sezon • {s.episode_count} bölüm
                  </p>
                </div>
              </div>
            ))}
          </div>
        ))}

      {/* Sezon listesi */}
      {level.kind !== 'shows' &&
        (seasons.isLoading ? (
          <p className="py-8 text-center text-slate-400">Yükleniyor…</p>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
            {(seasons.data ?? []).map((s) => (
              <div
                key={s.season}
                className="group relative cursor-pointer rounded-xl bg-slate-800/60 p-4 ring-1 ring-slate-700 transition hover:ring-sky-400"
                onClick={() =>
                  setLevel({ kind: 'episodes', show: level.show, season: s.season })
                }
              >
                <p className="text-sm font-medium text-slate-100">Sezon {s.season}</p>
                <p className="mt-1 text-[11px] text-slate-500">{s.episode_count} bölüm</p>
                {menuButton(
                  `season-${s.season}`,
                  () => playAll(`${level.show} S${s.season}`, () => getEpisodes(level.show, s.season)),
                  batchLabel === `${level.show} S${s.season}`,
                )}
              </div>
            ))}
          </div>
        ))}

      {/* Bölüm listesi (sezon seviyesi) */}
      {level.kind === 'episodes' && (
        <section className="overflow-hidden rounded-xl ring-1 ring-slate-700">
          <header className="flex items-center gap-3 bg-slate-800/60 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-slate-100">
                {level.show} — Sezon {level.season}
              </p>
              <p className="text-xs text-slate-400">
                {episodes.data ? `${episodes.data.length} bölüm` : ''}
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                playAll(`${level.show} S${level.season}`, () =>
                  Promise.resolve(episodes.data ?? []),
                )
              }
              disabled={batchLabel !== null || !episodes.data || episodes.data.length === 0}
              className="shrink-0 rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {batchLabel ? 'Ekleniyor…' : '▶ Tümünü Çal'}
            </button>
          </header>
          {episodes.isLoading ? (
            <p className="px-4 py-6 text-sm text-slate-400">Yükleniyor…</p>
          ) : (
            <div className="divide-y divide-slate-800">
              {episodes.data?.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => playEpisode(e)}
                  title={e.file_path}
                  className={`flex w-full items-center gap-3 px-4 py-2 text-left text-sm transition hover:bg-slate-800/60 ${
                    playingPath === e.file_path ? 'bg-emerald-500/10' : ''
                  }`}
                >
                  <span className="w-10 shrink-0 text-right font-mono text-xs text-slate-500">
                    {e.episode ?? '–'}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-slate-100">{e.title}</span>
                  {e.subtitle_count > 0 && (
                    <span className="shrink-0 rounded bg-slate-700/70 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">
                      CC
                    </span>
                  )}
                  <span className="w-14 shrink-0 text-right font-mono text-[10px] text-slate-500 uppercase">
                    {e.format}
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

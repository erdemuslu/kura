import { useEffect, useState } from 'react';
import { Plus, SlidersHorizontal } from 'lucide-react';
import {
  launchPlayer,
  posterUrlSeries,
  type LaunchResult,
  type MediaItem,
} from '../api/client';
import { useEpisodes, useMeta, useSeasons, useShows } from '../hooks/useMedia';
import { formatDuration, formatSize } from '../lib/format';
import { matchesCategoryPath } from '../lib/path';
import { resetScrollTop } from '../lib/scroll';
import MediaCard from './MediaCard';
import type { VideoPlayerItem } from './VideoPlayerModal';

type Level =
  | { kind: 'shows' }
  | { kind: 'seasons'; show: string }
  | { kind: 'episodes'; show: string; season: number };

interface SeriesViewProps {
  player: string;
  query: string;
  playingPath: string | null;
  onPlayed: (path: string | null) => void;
  onPlayVideo?: (video: VideoPlayerItem) => void;
  onOpenScanModal?: () => void;
  hasSources?: boolean;
  onManageSources?: () => void;
  categoryLabel?: string;
  categoryPaths?: string[];
}

export default function SeriesView({
  player,
  query,
  playingPath,
  onPlayed,
  onPlayVideo,
  onOpenScanModal,
  hasSources,
  onManageSources,
  categoryLabel,
  categoryPaths,
}: SeriesViewProps) {
  const [level, setLevel] = useState<Level>({ kind: 'shows' });
  const [feedback, setFeedback] = useState<LaunchResult | null>(null);

  // Dizi, sezon veya bölüm seviyesi geçişlerinde scroll'u sıfırla
  useEffect(() => {
    resetScrollTop();
  }, [level]);

  const shows = useShows(query);
  const rawShows = shows.data ?? [];
  const displayedShows = rawShows.filter((s) =>
    matchesCategoryPath(s.folder_path, categoryPaths),
  );
  const seasons = useSeasons(level.kind === 'shows' ? null : level.show);
  const atEpisodes = level.kind === 'episodes';
  const episodes = useEpisodes(
    level.kind === 'shows' ? null : level.show,
    atEpisodes ? level.season : null,
    false,
  );
  const showMeta = useMeta('series', level.kind === 'shows' ? null : level.show);

  const playEpisode = async (item: MediaItem) => {
    onPlayed(item.file_path);
    if (player === 'in_app' && onPlayVideo) {
      const showTitle = level.kind !== 'shows' ? level.show : (item.show_title || item.title);
      const epLabel = item.season && item.episode ? `S${String(item.season).padStart(2, '0')}E${String(item.episode).padStart(2, '0')}` : '';
      onPlayVideo({
        filePath: item.file_path,
        title: item.title,
        subTitle: epLabel ? `${showTitle} · ${epLabel}` : showTitle,
        duration: item.duration ?? undefined,
        hasSubtitles: item.subtitle_count > 0,
        subtitlePath: item.subtitle_path,
      });
      return;
    }
    setFeedback(await launchPlayer({ filePath: item.file_path, targetApp: player }));
  };

  return (
    <div className="space-y-6">
      {/* Breadcrumb & Üst Navigasyon */}
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border/40 pb-4 min-h-[72px]">
        {level.kind === 'shows' ? (
          <div>
            <h1 className="font-serif text-3xl sm:text-4xl font-normal tracking-tight text-primary">
              {categoryLabel || 'Diziler'}
            </h1>
            <p className="mt-1 text-xs text-tertiary font-mono">
              {displayedShows.length} dizi
            </p>
          </div>
        ) : (
          <nav className="flex items-center gap-2 text-xs text-tertiary">
            <button
              type="button"
              onClick={() => setLevel({ kind: 'shows' })}
              className="hover:text-primary transition"
            >
              {categoryLabel || 'Diziler'}
            </button>
            <span>›</span>
            {level.kind === 'seasons' ? (
              <span className="font-medium text-primary">{level.show}</span>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setLevel({ kind: 'seasons', show: level.show })}
                  className="hover:text-primary transition"
                >
                  {level.show}
                </button>
                <span>›</span>
                <span className="font-medium text-primary">Sezon {level.season}</span>
              </>
            )}
          </nav>
        )}

        <div className="flex items-center gap-3 h-8">
          {level.kind === 'shows' &&
            (hasSources ? (
              <button
                type="button"
                onClick={onManageSources}
                className="flex items-center gap-1.5 rounded-lg bg-surface-hover px-3 py-1.5 text-xs font-medium text-secondary hover:text-primary ring-1 ring-border transition"
                title="Bağlı klasörleri yönet veya kaldır"
              >
                <SlidersHorizontal className="h-3.5 w-3.5 text-accent" />
                <span>Kaynakları Düzenle</span>
              </button>
            ) : (
              onOpenScanModal && (
                <button
                  type="button"
                  onClick={onOpenScanModal}
                  className="flex items-center gap-1.5 rounded-lg bg-surface-hover px-3 py-1.5 text-xs font-medium text-secondary hover:text-primary ring-1 ring-border transition"
                >
                  <Plus className="h-3.5 w-3.5 text-accent" />
                  <span>Kaynak ekle</span>
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

      {/* Dizi Izgarası (Ana Görünüm) */}
      {level.kind === 'shows' &&
        (shows.isLoading ? (
          <div className="py-24 text-center text-xs text-tertiary font-serif">
            Kütüphane taranıyor…
          </div>
        ) : displayedShows.length === 0 ? (
          <div className="py-24 text-center space-y-3">
            <p className="font-serif text-2xl text-secondary font-normal">Kayıtlı dizi bulunamadı</p>
            <p className="text-xs text-tertiary max-w-sm mx-auto">
              {hasSources
                ? 'Bu menüye bağlı klasörlerde dizi formatında (S01E01 vb.) dosya bulunamadı.'
                : 'Dizi klasörünüzü (S01E01 vb. desenli dosyalar) ekleyerek başlayabilirsiniz.'}
            </p>
            {hasSources ? (
              <button
                type="button"
                onClick={onManageSources}
                className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-xs font-medium text-background hover:bg-accent-hover transition"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                <span>Kaynakları Düzenle</span>
              </button>
            ) : (
              onOpenScanModal && (
                <button
                  type="button"
                  onClick={onOpenScanModal}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-xs font-medium text-background hover:bg-accent-hover transition"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>İlk Kaynağınızı Ekleyin</span>
                </button>
              )
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-x-5 gap-y-7 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8">
            {displayedShows.map((s) => (
              <MediaCard
                key={s.show_title}
                title={s.show_title}
                meta={`${s.season_count} sezon · ${s.episode_count} bölüm`}
                coverUrl={posterUrlSeries(s.show_title)}
                aspect="2:3"
                badges={[`${s.season_count} Sezon`]}
                onClick={() => setLevel({ kind: 'seasons', show: s.show_title })}
              />
            ))}
          </div>
        ))}

      {/* Dizi Detay Başlığı (Sezon veya Bölüm seviyesinde) */}
      {level.kind !== 'shows' && (
        <section className="flex flex-col gap-6 rounded-xl bg-surface p-6 ring-1 ring-border sm:flex-row">
          <div className="relative aspect-[2/3] w-36 shrink-0 self-center overflow-hidden rounded-lg bg-surface-hover shadow-xl sm:self-start">
            <img
              src={posterUrlSeries(level.show)}
              alt={level.show}
              className="h-full w-full object-cover"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
              }}
            />
            <div className="absolute inset-0 -z-10 flex items-center justify-center font-serif text-4xl text-tertiary">
              {level.show.slice(0, 1)}
            </div>
          </div>

          <div className="min-w-0 flex-1 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <h1 className="font-serif text-3xl font-normal text-primary tracking-tight">
                {level.show}
              </h1>
            </div>

            {(() => {
              const m = showMeta.data;
              const badges = [
                m?.rating ? `★ ${m.rating.toFixed(1)}` : null,
                m?.year,
                m?.runtime ? `${m.runtime} dk/bölüm` : null,
                m?.status,
              ].filter((b): b is string => b !== null);

              return (
                <>
                  {badges.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 text-xs">
                      {badges.map((b) => (
                        <span
                          key={b}
                          className="rounded-full bg-surface-hover px-2.5 py-0.5 text-secondary font-mono text-[11px]"
                        >
                          {b}
                        </span>
                      ))}
                    </div>
                  )}
                  {m?.genres && m.genres.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 text-xs">
                      {m.genres.map((g) => (
                        <span
                          key={g}
                          className="rounded-full bg-accent/15 px-2.5 py-0.5 text-[11px] text-accent font-medium"
                        >
                          {g}
                        </span>
                      ))}
                    </div>
                  )}
                  {m?.overview && (
                    <p className="line-clamp-4 text-sm leading-relaxed text-secondary pt-1 font-normal">
                      {m.overview}
                    </p>
                  )}
                </>
              );
            })()}
          </div>
        </section>
      )}

      {/* Sezon Listesi */}
      {level.kind === 'seasons' &&
        (seasons.isLoading ? (
          <p className="py-8 text-center text-xs text-tertiary">Yükleniyor…</p>
        ) : (seasons.data ?? []).length === 0 ? (
          <p className="py-8 text-center text-xs text-tertiary">Kayıtlı sezon bulunamadı</p>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {(seasons.data ?? []).map((s) => (
              <div
                key={s.season}
                className="group relative cursor-pointer rounded-xl bg-surface p-5 ring-1 ring-border transition hover:ring-border-hover hover:scale-[1.02] hover:bg-surface-hover"
                onClick={() =>
                  setLevel({ kind: 'episodes', show: level.show, season: s.season })
                }
              >
                <p className="font-serif text-xl font-normal text-primary">Sezon {s.season}</p>
                <p className="mt-2 text-xs text-tertiary font-mono">{s.episode_count} bölüm</p>
                <span className="mt-4 inline-block text-[11px] text-accent font-medium group-hover:underline">
                  Bölümleri Görüntüle →
                </span>
              </div>
            ))}
          </div>
        ))}

      {/* Bölüm Listesi */}
      {level.kind === 'episodes' && (
        <section className="overflow-hidden rounded-xl bg-surface ring-1 ring-border">
          <header className="flex items-center justify-between border-b border-border px-4 py-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-tertiary">
              Sezon {level.season} Bölümleri ({episodes.data?.length ?? 0})
            </span>
          </header>
          {episodes.isLoading ? (
            <p className="px-4 py-8 text-center text-xs text-tertiary">Bölümler yükleniyor…</p>
          ) : episodes.isError ? (
            <p className="px-4 py-8 text-center text-xs text-status-offline">
              Bölümler yüklenirken bir hata oluştu.
            </p>
          ) : (episodes.data ?? []).length === 0 ? (
            <p className="px-4 py-8 text-center text-xs text-tertiary">
              Bu sezonda henüz bölüm bulunamadı.
            </p>
          ) : (
            <div className="divide-y divide-border/40">
              {episodes.data?.map((ep, i) => (
                <button
                  key={ep.id}
                  type="button"
                  onClick={() => playEpisode(ep)}
                  title={ep.file_path}
                  className={`flex w-full items-center gap-3 px-4 py-3 text-left text-xs transition hover:bg-surface-hover group ${
                    playingPath === ep.file_path
                      ? 'bg-accent/10 text-accent font-medium'
                      : 'text-primary'
                  }`}
                >
                  <span className="w-8 shrink-0 text-center font-mono text-[11px] text-tertiary group-hover:text-primary">
                    {ep.episode ? `B${ep.episode}` : i + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium">{ep.title}</span>
                  {ep.subtitle_count > 0 && (
                    <span className="shrink-0 rounded bg-surface-hover px-1.5 py-0.5 font-mono text-[10px] text-accent ring-1 ring-accent/20">
                      CC
                    </span>
                  )}
                  <span className="w-16 shrink-0 text-right font-mono text-[10px] text-tertiary">
                    {formatSize(ep.file_size)}
                  </span>
                  <span className="w-14 shrink-0 text-right font-mono text-[10px] text-tertiary">
                    {formatDuration(ep.duration)}
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

import { useState } from 'react';
import { Plus, SlidersHorizontal } from 'lucide-react';
import {
  getMovieFiles,
  launchPlayer,
  launchPlayerBatch,
  posterUrlMovie,
  type LaunchResult,
  type MediaItem,
  type MovieGroup,
} from '../api/client';
import { useMeta, useMovieFiles, useMovies } from '../hooks/useMedia';
import { formatSize } from '../lib/format';
import MediaCard from './MediaCard';
import type { VideoPlayerItem } from './VideoPlayerModal';

interface MoviesViewProps {
  player: string;
  query: string;
  playingLabel: string | null;
  onPlayed: (label: string | null) => void;
  onPlayVideo?: (video: VideoPlayerItem) => void;
  onOpenScanModal?: () => void;
  hasSources?: boolean;
  onManageSources?: () => void;
  categoryLabel?: string;
  categoryPaths?: string[];
}

export default function MoviesView({
  player,
  query,
  playingLabel,
  onPlayed,
  onPlayVideo,
  onOpenScanModal,
  hasSources,
  onManageSources,
  categoryLabel,
  categoryPaths,
}: MoviesViewProps) {
  const movies = useMovies(query);
  const [detail, setDetail] = useState<MovieGroup | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<LaunchResult | null>(null);

  const rawMovies = movies.data ?? [];
  const displayedMovies =
    categoryPaths && categoryPaths.length > 0
      ? rawMovies.filter((m) =>
          categoryPaths.some(
            (p) => m.folder_path.startsWith(p) || p.startsWith(m.folder_path),
          ),
        )
      : rawMovies;
  const totalSize = displayedMovies.reduce((acc, m) => acc + m.total_size, 0);

  const detailFiles = useMovieFiles(detail ? detail.folder_path : null);
  const detailMeta = useMeta('movie', detail ? detail.title : null);

  const playGroup = async (group: MovieGroup) => {
    setPlaying(group.title);
    onPlayed(group.title);
    setFeedback(null);
    try {
      const files =
        detail && detail.folder_path === group.folder_path
          ? detailFiles.data ?? []
          : await getMovieFiles(group.folder_path);

      if (files.length === 0) {
        setFeedback({ success: false, message: 'Film dosyaları bulunamadı' });
        return;
      }

      if (player === 'in_app' && onPlayVideo) {
        const f = files[0];
        onPlayVideo({
          filePath: f.file_path,
          title: group.title,
          subTitle: `${f.format.toUpperCase()} · ${formatSize(f.file_size)}`,
          duration: f.duration ?? undefined,
          hasSubtitles: f.subtitle_count > 0,
          subtitlePath: f.subtitle_path,
        });
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

  const playFile = async (file: MediaItem) => {
    setPlaying(file.file_path);
    onPlayed(file.file_path);
    setFeedback(null);
    try {
      if (player === 'in_app' && onPlayVideo) {
        onPlayVideo({
          filePath: file.file_path,
          title: detail ? detail.title : file.title,
          subTitle: `${file.format.toUpperCase()} · ${formatSize(file.file_size)}`,
          duration: file.duration ?? undefined,
          hasSubtitles: file.subtitle_count > 0,
          subtitlePath: file.subtitle_path,
        });
        return;
      }

      setFeedback(
        await launchPlayer({ filePath: file.file_path, targetApp: player }),
      );
    } catch (e) {
      setFeedback({ success: false, message: String(e) });
    } finally {
      setPlaying(null);
    }
  };

  // ——— Detay Sayfası ———
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
      <div className="space-y-6">
        <nav className="flex items-center gap-2 text-xs text-tertiary">
          <button
            type="button"
            onClick={() => setDetail(null)}
            className="hover:text-primary transition"
          >
            Filmler
          </button>
          <span>›</span>
          <span className="font-medium text-primary">{detail.title}</span>
        </nav>

        {feedback && (
          <p className={`text-xs ${feedback.success ? 'text-accent' : 'text-status-offline'}`}>
            {feedback.message}
          </p>
        )}

        {/* Detay Kartı */}
        <section className="flex flex-col gap-6 rounded-xl bg-surface p-6 ring-1 ring-border sm:flex-row">
          <div className="relative aspect-[2/3] w-40 shrink-0 self-center overflow-hidden rounded-lg bg-surface-hover shadow-xl sm:self-start">
            <img
              src={posterUrlMovie(detail.title, detail.folder_path)}
              alt={detail.title}
              className="h-full w-full object-cover"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
              }}
            />
            <div className="absolute inset-0 -z-10 flex items-center justify-center font-serif text-4xl text-tertiary">
              {detail.title.slice(0, 1)}
            </div>
          </div>

          <div className="min-w-0 flex-1 space-y-3">
            <h1 className="font-serif text-3xl font-normal text-primary tracking-tight">
              {detail.title}
            </h1>

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

            {meta?.genres && meta.genres.length > 0 && (
              <div className="flex flex-wrap gap-1.5 text-xs">
                {meta.genres.map((g) => (
                  <span
                    key={g}
                    className="rounded-full bg-accent/15 px-2.5 py-0.5 text-[11px] text-accent font-medium"
                  >
                    {g}
                  </span>
                ))}
              </div>
            )}

            <p className="text-xs text-tertiary">
              {detail.file_count} dosya • {formatSize(detail.total_size)}
              {detail.has_subtitles ? ' • CC' : ''}
              {detail.disk_label ? ` • ${detail.disk_label}` : ''}
            </p>

            {meta?.overview && (
              <p className="text-sm leading-relaxed text-secondary pt-1 font-normal">
                {meta.overview}
              </p>
            )}

            <div className="pt-2">
              <button
                type="button"
                onClick={() => playGroup(detail)}
                disabled={playing !== null}
                className="rounded-lg bg-accent px-5 py-2 text-xs font-semibold text-background transition hover:bg-accent-hover disabled:opacity-50"
              >
                {playing === detail.title
                  ? 'Açılıyor…'
                  : `▶ Oynat${detail.file_count > 1 ? ' (Tümü)' : ''}`}
              </button>
            </div>
          </div>
        </section>

        {/* Dosya Listesi */}
        <section className="overflow-hidden rounded-xl bg-surface ring-1 ring-border">
          <header className="border-b border-border px-4 py-2.5">
            <span className="text-xs font-semibold uppercase tracking-wider text-tertiary">
              Dosyalar ({files.length})
            </span>
          </header>
          {detailFiles.isLoading ? (
            <p className="px-4 py-6 text-xs text-tertiary">Yükleniyor…</p>
          ) : (
            <div className="divide-y divide-border/40">
              {files.map((f) => {
                const name = f.file_path.split('/').pop() ?? f.file_path;
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => playFile(f)}
                    title={f.file_path}
                    className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-xs transition hover:bg-surface-hover ${
                      playingLabel === f.file_path ? 'bg-accent/10 text-accent font-medium' : 'text-primary'
                    }`}
                  >
                    <span className="min-w-0 flex-1 truncate">{name}</span>
                    {f.subtitle_count > 0 && (
                      <span className="shrink-0 rounded bg-surface-hover px-1.5 py-0.5 font-mono text-[10px] text-tertiary">
                        CC
                      </span>
                    )}
                    <span className="w-14 shrink-0 text-right font-mono text-[10px] text-tertiary uppercase">
                      {f.format}
                    </span>
                    <span className="w-16 shrink-0 text-right font-mono text-[10px] text-tertiary">
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

  // ——— Ana Film Izgarası ———
  return (
    <div className="space-y-6">
      {/* Bölüm Başlığı & Araçlar */}
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border/40 pb-4 min-h-[72px]">
        <div>
          <h1 className="font-serif text-3xl sm:text-4xl font-normal tracking-tight text-primary">
            {categoryLabel || 'Filmler'}
          </h1>
          <p className="mt-1 text-xs text-tertiary font-mono">
            {displayedMovies.length} film
            {totalSize > 0 ? ` · ${formatSize(totalSize)}` : ''}
          </p>
        </div>

        <div className="flex items-center gap-3 h-8">
          {hasSources ? (
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
          )}
        </div>
      </div>

      {movies.isLoading ? (
        <div className="py-24 text-center text-xs text-tertiary font-serif">
          Kütüphane taranıyor…
        </div>
      ) : displayedMovies.length === 0 ? (
        <div className="py-24 text-center space-y-3">
          <p className="font-serif text-2xl text-secondary font-normal">Kayıtlı film bulunamadı</p>
          <p className="text-xs text-tertiary max-w-sm mx-auto">
            {hasSources
              ? 'Bu menüye bağlı klasörlerde film formatında dosya bulunamadı.'
              : 'Dizin tarayıcı ile film klasörünüzü ekleyerek koleksiyonunuzu buraya getirebilirsiniz.'}
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
          {displayedMovies.map((m) => {
            const badges: string[] = [];
            if (m.has_subtitles) badges.push('CC');
            if (m.file_count > 1) badges.push(`${m.file_count} dosya`);
            badges.push(formatSize(m.total_size));

            return (
              <MediaCard
                key={m.folder_path}
                title={m.title}
                meta={`${formatSize(m.total_size)}${m.has_subtitles ? ' · CC' : ''}`}
                coverUrl={posterUrlMovie(m.title, m.folder_path)}
                aspect="2:3"
                badges={badges}
                isPlaying={playingLabel === m.title}
                onClick={() => setDetail(m)}
                onPlayHover={() => playGroup(m)}
                playHoverLoading={playing === m.title}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

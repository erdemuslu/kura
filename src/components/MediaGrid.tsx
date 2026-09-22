import type { MediaItem } from '../api/client';

interface MediaGridProps {
  items: MediaItem[] | undefined;
  loading: boolean;
  playingPath: string | null;
  onPlay: (item: MediaItem) => void;
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

function formatSize(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(0)} MB`;
  return `${(bytes / 1_000).toFixed(0)} KB`;
}

const GRADIENTS: Record<string, string> = {
  movie: 'from-indigo-600/40 to-violet-900/60',
  series: 'from-sky-600/40 to-cyan-900/60',
  music: 'from-emerald-600/40 to-teal-900/60',
};


function initials(title: string): string {
  const parts = title.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return parts.slice(0, 2).map((p) => p[0]!.toUpperCase()).join('');
}

export default function MediaGrid({ items, loading, playingPath, onPlay }: MediaGridProps) {
  if (loading) {
    return <p className="py-16 text-center text-slate-400">Yükleniyor…</p>;
  }
  if (!items || items.length === 0) {
    return (
      <p className="py-16 text-center text-slate-400">
        Bu bölümde kayıtlı medya yok. Yukarıdaki dizin tarayıcı ile bir klasör ekleyin.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onPlay(item)}
          title={`${item.title}\n${item.file_path}`}
          className={`group text-left ring-1 transition hover:ring-sky-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 ${
            playingPath === item.file_path
              ? 'ring-2 ring-emerald-400'
              : 'ring-slate-700'
          } rounded-xl overflow-hidden bg-slate-800/60`}
        >
          <div
            className={`flex items-end justify-end ${
              item.media_type === 'music'
                ? 'aspect-square'
                : 'aspect-[2/3]'
            } bg-gradient-to-br ${
              GRADIENTS[item.media_type] ?? 'from-slate-700 to-slate-900'
            } p-3`}
          >
            <span className="select-none text-4xl font-bold text-white/15 group-hover:text-white/25">
              {initials(item.title)}
            </span>
          </div>
          <div className="p-3">
            <p className="truncate text-sm font-medium text-slate-100">{item.title}</p>
            <p className="truncate text-xs text-slate-400">
              {item.artist
                ? `${item.artist}${item.album ? ` • ${item.album}` : ''}`
                : item.disk_label}
            </p>
            <div className="mt-2 flex flex-wrap gap-1 font-mono text-[10px] text-slate-400">
              <span className="rounded bg-slate-700/70 px-1.5 py-0.5 uppercase">{item.format}</span>
              {item.duration ? (
                <span className="rounded bg-slate-700/70 px-1.5 py-0.5">
                  {formatDuration(item.duration)}
                </span>
              ) : null}
              <span className="rounded bg-slate-700/70 px-1.5 py-0.5">
                {formatSize(item.file_size)}
              </span>
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { browseDirectory, diskLabelFromPath, isRunningInTauri } from '../api/client';
import { useLocale } from '../context/LocaleContext';
import { useScan } from '../hooks/useMedia';

/** `scan-progress` event yükü (yalnızca masaüstünde gelir). */
interface ScanProgress {
  scanned_files: number;
  indexed: number;
}

/** Dizin yolu girilip kütüphaneyi tarayan panel. */
export default function ScanPanel() {
  const { t } = useLocale();
  const [path, setPath] = useState('');
  const [diskLabel, setDiskLabel] = useState('');
  const [browsing, setBrowsing] = useState(false);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const scan = useScan();

  useEffect(() => {
    if (!isRunningInTauri()) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    import('@tauri-apps/api/event')
      .then(({ listen }) =>
        listen<ScanProgress>('scan-progress', (e) => setProgress(e.payload)),
      )
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!scan.isPending && path.trim()) {
      setProgress(null);
      scan.mutate({ path: path.trim(), diskLabel: diskLabel.trim() || undefined });
    }
  };

  const onBrowse = async () => {
    setBrowsing(true);
    try {
      const selected = await browseDirectory();
      if (selected) {
        setPath(selected);
        if (!diskLabel.trim()) {
          setDiskLabel(diskLabelFromPath(selected));
        }
      }
    } finally {
      setBrowsing(false);
    }
  };

  return (
    <section className="rounded-xl bg-slate-800/60 p-4 ring-1 ring-slate-700">
      <form onSubmit={onSubmit} className="flex flex-col gap-2 sm:flex-row">
        <div className="flex min-w-0 flex-1 gap-2">
          <input
            type="text"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder={t('scan.panelPathPlaceholder')}
            className="min-w-0 flex-1 rounded-lg bg-slate-900 px-3 py-2 text-sm text-slate-100 ring-1 ring-slate-700 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-400"
          />
          {isRunningInTauri() && (
            <button
              type="button"
              onClick={onBrowse}
              disabled={browsing}
              title={t('common.browseEllipsis')}
              className="shrink-0 rounded-lg bg-slate-700 px-3 py-2 text-sm text-slate-100 ring-1 ring-slate-600 transition hover:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {browsing ? '…' : t('common.browseEllipsis')}
            </button>
          )}
        </div>
        <input
          type="text"
          value={diskLabel}
          onChange={(e) => setDiskLabel(e.target.value)}
          placeholder={t('scan.panelDiskPlaceholder')}
          className="w-full rounded-lg bg-slate-900 px-3 py-2 text-sm text-slate-100 ring-1 ring-slate-700 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-400 sm:w-52"
        />
        <button
          type="submit"
          disabled={scan.isPending || !path.trim()}
          className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {scan.isPending ? t('scan.scanning') : t('scan.action')}
        </button>
      </form>

      {scan.isPending && progress && (
        <p className="mt-2 text-sm text-sky-300">
          {t('scan.progressLive', {
            n: progress.scanned_files,
            m: progress.indexed,
          })}
        </p>
      )}
      {scan.isError && (
        <p className="mt-2 text-sm text-red-400">
          {t('scan.errorPrefix', { error: String(scan.error) })}
        </p>
      )}
      {scan.data && (
        <p className="mt-2 text-sm text-emerald-300">
          {t('scan.result', {
            n: scan.data.indexed,
            m: scan.data.scanned_files,
            e: scan.data.errors,
          })}
          {scan.data.cleaned > 0 ? t('scan.cleaned', { n: scan.data.cleaned }) : ''} —{' '}
          {scan.data.disk_label}
        </p>
      )}
    </section>
  );
}

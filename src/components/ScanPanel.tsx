import { useState } from 'react';
import { browseDirectory, diskLabelFromPath, isRunningInTauri } from '../api/client';
import { useScan } from '../hooks/useMedia';

/** Dizin yolu girilip kütüphaneyi tarayan panel. */
export default function ScanPanel() {
  const [path, setPath] = useState('');
  const [diskLabel, setDiskLabel] = useState('');
  const [browsing, setBrowsing] = useState(false);
  const scan = useScan();

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!scan.isPending && path.trim()) {
      scan.mutate({ path: path.trim(), diskLabel: diskLabel.trim() || undefined });
    }
  };

  /** Native klasör seçme diyaloğunu açar; seçince yolu ve (boşsa) disk
   *  etiketini otomatik doldurur. Yalnızca masaüstünde görünür. */
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
            placeholder="Dizin yolu (örn. /Volumes/Media/Filmler)"
            className="min-w-0 flex-1 rounded-lg bg-slate-900 px-3 py-2 text-sm text-slate-100 ring-1 ring-slate-700 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-400"
          />
          {isRunningInTauri() && (
            <button
              type="button"
              onClick={onBrowse}
              disabled={browsing}
              title="Klasör seç…"
              className="shrink-0 rounded-lg bg-slate-700 px-3 py-2 text-sm text-slate-100 ring-1 ring-slate-600 transition hover:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {browsing ? '…' : '📁 Gözat…'}
            </button>
          )}
        </div>
        <input
          type="text"
          value={diskLabel}
          onChange={(e) => setDiskLabel(e.target.value)}
          placeholder="Disk etiketi (opsiyonel)"
          className="w-full rounded-lg bg-slate-900 px-3 py-2 text-sm text-slate-100 ring-1 ring-slate-700 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-400 sm:w-52"
        />
        <button
          type="submit"
          disabled={scan.isPending || !path.trim()}
          className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {scan.isPending ? 'Taranıyor…' : 'Tara'}
        </button>
      </form>

      {scan.isError && (
        <p className="mt-2 text-sm text-red-400">Hata: {String(scan.error)}</p>
      )}
      {scan.data && (
        <p className="mt-2 text-sm text-emerald-300">
          {scan.data.indexed} dosya indekslendi ({scan.data.scanned_files} tarandı,{' '}
          {scan.data.errors} hata) — disk: {scan.data.disk_label}
        </p>
      )}
    </section>
  );
}

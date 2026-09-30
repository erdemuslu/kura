import { useEffect, useState } from 'react';
import { CheckCircle2, FolderOpen, Loader2, X } from 'lucide-react';
import { browseDirectory, diskLabelFromPath, isRunningInTauri, type ScanSummary } from '../api/client';
import { useScan } from '../hooks/useMedia';

interface ScanModalProps {
  isOpen: boolean;
  onClose: () => void;
  onScanStarted?: (path: string, summary?: ScanSummary) => void;
  scanProgress?: { scanned_files: number; indexed: number } | null;
  targetCategoryLabel?: string;
  initialPath?: string;
}

export default function ScanModal({
  isOpen,
  onClose,
  onScanStarted,
  scanProgress,
  targetCategoryLabel,
  initialPath = '',
}: ScanModalProps) {
  const [path, setPath] = useState(initialPath);
  const [diskLabel, setDiskLabel] = useState('');
  const [browsing, setBrowsing] = useState(false);
  const [internalProgress, setInternalProgress] = useState<{
    scanned_files: number;
    indexed: number;
  } | null>(null);

  const scan = useScan();

  useEffect(() => {
    if (initialPath) {
      setPath(initialPath);
      setDiskLabel(diskLabelFromPath(initialPath));
    }
  }, [initialPath]);

  // Canlı tarama ilerlemesini dinle
  useEffect(() => {
    if (!isRunningInTauri() || !isOpen) return;
    let unlisten: (() => void) | undefined;
    import('@tauri-apps/api/event')
      .then(({ listen }) =>
        listen<{ scanned_files: number; indexed: number }>('scan-progress', (e) => {
          setInternalProgress(e.payload);
        }),
      )
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {});
    return () => {
      unlisten?.();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const currentProgress = scanProgress || internalProgress;

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

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!scan.isPending && path.trim()) {
      const targetPath = path.trim();
      scan.mutate(
        { path: targetPath, diskLabel: diskLabel.trim() || undefined },
        {
          onSuccess: (data) => {
            onScanStarted?.(targetPath, data);
            // 2 saniye sonra otomatik kapat
            setTimeout(() => {
              onClose();
              scan.reset();
            }, 2200);
          },
        },
      );
    }
  };

  const handleClose = () => {
    scan.reset();
    setInternalProgress(null);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        className="w-full max-w-lg rounded-xl bg-surface p-6 shadow-2xl ring-1 ring-border relative animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Kapat Butonu */}
        <button
          type="button"
          onClick={handleClose}
          className="absolute right-4 top-4 rounded-lg p-1.5 text-tertiary hover:text-primary transition"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Başlık */}
        <div>
          <h2 className="font-serif text-2xl font-normal text-primary">
            {targetCategoryLabel ? `Kaynak Ekle: ${targetCategoryLabel}` : 'Kaynak Ekle'}
          </h2>
          <p className="mt-1 text-xs text-secondary">
            Yerel diskinizdeki bir medya klasörünü tarayıp arşive dahil edin.
          </p>
        </div>

        <form onSubmit={onSubmit} className="mt-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-secondary mb-1.5">
              Dizin Yolu
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={path}
                onChange={(e) => setPath(e.target.value)}
                disabled={scan.isPending || scan.isSuccess}
                placeholder="/Volumes/Media/Filmler veya D:\Müzik"
                className="min-w-0 flex-1 rounded-lg bg-surface-hover px-3 py-2 text-sm text-primary ring-1 ring-border placeholder:text-tertiary focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-60"
                autoFocus
              />
              {isRunningInTauri() && (
                <button
                  type="button"
                  onClick={onBrowse}
                  disabled={browsing || scan.isPending || scan.isSuccess}
                  className="flex items-center gap-1.5 shrink-0 rounded-lg bg-surface-active px-3 py-2 text-xs font-medium text-primary ring-1 ring-border hover:bg-border transition disabled:opacity-50"
                  title="Klasör seç"
                >
                  <FolderOpen className="h-4 w-4 text-accent" />
                  <span>{browsing ? '…' : 'Gözat'}</span>
                </button>
              )}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-secondary mb-1.5">
              Disk Etiketi (Opsiyonel)
            </label>
            <input
              type="text"
              value={diskLabel}
              onChange={(e) => setDiskLabel(e.target.value)}
              disabled={scan.isPending || scan.isSuccess}
              placeholder="HariciDisk1 (boş bırakılırsa yoldan çıkarılır)"
              className="w-full rounded-lg bg-surface-hover px-3 py-2 text-sm text-primary ring-1 ring-border placeholder:text-tertiary focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-60"
            />
          </div>

          {/* Canlı İlerleme / Tarama Durumu */}
          {scan.isPending && (
            <div className="rounded-xl bg-surface-hover/80 p-4 ring-1 ring-border space-y-3 animate-in fade-in duration-200">
              <div className="flex items-center gap-3">
                <Loader2 className="h-5 w-5 animate-spin text-accent shrink-0" />
                <div>
                  <p className="text-xs font-medium text-primary">Klasör taranıyor…</p>
                  <p className="text-[11px] text-secondary">
                    Dosyalar analiz ediliyor, meta veriler ve kapaklar indeksleniyor
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-1">
                <div className="rounded-lg bg-surface p-3 ring-1 ring-border/80">
                  <span className="block text-[10px] font-mono text-tertiary uppercase tracking-wider">
                    Taranan Dosya
                  </span>
                  <span className="mt-0.5 block font-mono text-xl font-medium text-primary">
                    {currentProgress?.scanned_files ?? 0}
                  </span>
                </div>
                <div className="rounded-lg bg-surface p-3 ring-1 ring-border/80">
                  <span className="block text-[10px] font-mono text-tertiary uppercase tracking-wider">
                    İndekslenen
                  </span>
                  <span className="mt-0.5 block font-mono text-xl font-medium text-accent">
                    {currentProgress?.indexed ?? 0}
                  </span>
                </div>
              </div>

              <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface ring-1 ring-border/40">
                <div className="h-full w-full animate-[pulse_1.2s_ease-in-out_infinite] bg-accent" />
              </div>
            </div>
          )}

          {/* Tamamlandı Durumu */}
          {scan.isSuccess && scan.data && (
            <div className="rounded-xl bg-accent/10 p-4 ring-1 ring-accent/30 space-y-2 animate-in fade-in duration-200">
              <div className="flex items-center gap-2.5 text-accent">
                <CheckCircle2 className="h-5 w-5 shrink-0" />
                <p className="text-xs font-semibold">Tarama Başarıyla Tamamlandı</p>
              </div>
              <p className="text-xs text-secondary pl-7">
                <span className="font-semibold text-primary">{scan.data.indexed}</span> medya indekslendi (toplam{' '}
                <span className="font-semibold text-primary">{scan.data.scanned_files}</span> dosya incelendi).
              </p>
            </div>
          )}

          {scan.isError && (
            <p className="text-xs text-status-offline">
              Hata: {String(scan.error)}
            </p>
          )}

          <div className="flex justify-end gap-2.5 pt-2">
            {scan.isSuccess ? (
              <button
                type="button"
                onClick={handleClose}
                className="rounded-lg bg-accent px-5 py-2 text-xs font-medium text-background transition hover:bg-accent-hover"
              >
                Tamam
              </button>
            ) : scan.isPending ? (
              <button
                type="button"
                onClick={handleClose}
                className="rounded-lg bg-surface-hover px-4 py-2 text-xs font-medium text-secondary hover:text-primary transition"
              >
                Arka Planda Devam Et
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={handleClose}
                  className="rounded-lg px-3.5 py-2 text-xs font-medium text-secondary hover:text-primary transition"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  disabled={!path.trim()}
                  className="rounded-lg bg-accent px-4 py-2 text-xs font-medium text-background transition hover:bg-accent-hover disabled:opacity-50"
                >
                  Taramayı Başlat
                </button>
              </>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

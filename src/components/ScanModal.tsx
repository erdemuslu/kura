import { useEffect, useState } from 'react';
import { CheckCircle2, FolderOpen, Loader2, X } from 'lucide-react';
import { browseDirectory, diskLabelFromPath, isRunningInTauri, type ScanSummary } from '../api/client';
import { useLocale } from '../context/LocaleContext';
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
  const { t } = useLocale();
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
        <button
          type="button"
          onClick={handleClose}
          className="absolute right-4 top-4 rounded-lg p-1.5 text-tertiary hover:text-primary transition"
        >
          <X className="h-4 w-4" />
        </button>

        <div>
          <h2 className="font-serif text-2xl font-normal text-primary">
            {targetCategoryLabel
              ? t('scan.addSourceNamed', { label: targetCategoryLabel })
              : t('scan.addSource')}
          </h2>
          <p className="mt-1 text-xs text-secondary">{t('scan.desc')}</p>
        </div>

        <form onSubmit={onSubmit} className="mt-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-secondary mb-1.5">
              {t('scan.pathLabel')}
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={path}
                onChange={(e) => setPath(e.target.value)}
                disabled={scan.isPending || scan.isSuccess}
                placeholder={t('scan.pathPlaceholder')}
                className="min-w-0 flex-1 rounded-lg bg-surface-hover px-3 py-2 text-sm text-primary ring-1 ring-border placeholder:text-tertiary focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-60"
                autoFocus
              />
              {isRunningInTauri() && (
                <button
                  type="button"
                  onClick={onBrowse}
                  disabled={browsing || scan.isPending || scan.isSuccess}
                  className="flex items-center gap-1.5 shrink-0 rounded-lg bg-surface-active px-3 py-2 text-xs font-medium text-primary ring-1 ring-border hover:bg-border transition disabled:opacity-50"
                  title={t('common.browseTitle')}
                >
                  <FolderOpen className="h-4 w-4 text-accent" />
                  <span>{browsing ? '…' : t('common.browse')}</span>
                </button>
              )}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-secondary mb-1.5">
              {t('scan.diskLabel')}
            </label>
            <input
              type="text"
              value={diskLabel}
              onChange={(e) => setDiskLabel(e.target.value)}
              disabled={scan.isPending || scan.isSuccess}
              placeholder={t('scan.diskPlaceholder')}
              className="w-full rounded-lg bg-surface-hover px-3 py-2 text-sm text-primary ring-1 ring-border placeholder:text-tertiary focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-60"
            />
          </div>

          {scan.isPending && (
            <div className="rounded-xl bg-surface-hover/80 p-4 ring-1 ring-border space-y-3 animate-in fade-in duration-200">
              <div className="flex items-center gap-3">
                <Loader2 className="h-5 w-5 animate-spin text-accent shrink-0" />
                <div>
                  <p className="text-xs font-medium text-primary">{t('scan.inProgress')}</p>
                  <p className="text-[11px] text-secondary">{t('scan.analyzing')}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-1">
                <div className="rounded-lg bg-surface p-3 ring-1 ring-border/80">
                  <span className="block text-[10px] font-mono text-tertiary uppercase tracking-wider">
                    {t('scan.scannedFiles')}
                  </span>
                  <span className="mt-0.5 block font-mono text-xl font-medium text-primary">
                    {currentProgress?.scanned_files ?? 0}
                  </span>
                </div>
                <div className="rounded-lg bg-surface p-3 ring-1 ring-border/80">
                  <span className="block text-[10px] font-mono text-tertiary uppercase tracking-wider">
                    {t('scan.indexed')}
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

          {scan.isSuccess && scan.data && (
            <div className="rounded-xl bg-accent/10 p-4 ring-1 ring-accent/30 space-y-2 animate-in fade-in duration-200">
              <div className="flex items-center gap-2.5 text-accent">
                <CheckCircle2 className="h-5 w-5 shrink-0" />
                <p className="text-xs font-semibold">{t('scan.successTitle')}</p>
              </div>
              <p className="text-xs text-secondary pl-7">
                {t('scan.successBody', {
                  n: scan.data.indexed,
                  m: scan.data.scanned_files,
                })}
              </p>
            </div>
          )}

          {scan.isError && (
            <p className="text-xs text-status-offline">
              {t('scan.errorPrefix', { error: String(scan.error) })}
            </p>
          )}

          <div className="flex justify-end gap-2.5 pt-2">
            {scan.isSuccess ? (
              <button
                type="button"
                onClick={handleClose}
                className="rounded-lg bg-accent px-5 py-2 text-xs font-medium text-background transition hover:bg-accent-hover"
              >
                {t('common.ok')}
              </button>
            ) : scan.isPending ? (
              <button
                type="button"
                onClick={handleClose}
                className="rounded-lg bg-surface-hover px-4 py-2 text-xs font-medium text-secondary hover:text-primary transition"
              >
                {t('scan.continueBackground')}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={handleClose}
                  className="rounded-lg px-3.5 py-2 text-xs font-medium text-secondary hover:text-primary transition"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="submit"
                  disabled={!path.trim()}
                  className="rounded-lg bg-accent px-4 py-2 text-xs font-medium text-background transition hover:bg-accent-hover disabled:opacity-50"
                >
                  {t('scan.start')}
                </button>
              </>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

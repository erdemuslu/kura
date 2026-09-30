import { useState } from 'react';
import { Film, FolderOpen, Music, Tv, X } from 'lucide-react';
import { browseDirectory, isRunningInTauri } from '../api/client';
import type { CategoryInfo } from './ManageSourcesModal';

interface CreateCategoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (category: CategoryInfo, initialPath?: string) => void;
}

export default function CreateCategoryModal({
  isOpen,
  onClose,
  onCreate,
}: CreateCategoryModalProps) {
  const [label, setLabel] = useState('');
  const [mediaType, setMediaType] = useState<'movie' | 'series' | 'music'>('movie');
  const [path, setPath] = useState('');
  const [browsing, setBrowsing] = useState(false);

  if (!isOpen) return null;

  const onBrowse = async () => {
    setBrowsing(true);
    try {
      const selected = await browseDirectory();
      if (selected) {
        setPath(selected);
        if (!label.trim()) {
          // Klasör adından menü adı öner
          const folderName = selected.split(/[\\/]/).filter(Boolean).pop();
          if (folderName) setLabel(folderName);
        }
      }
    } finally {
      setBrowsing(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!label.trim()) return;

    const id = `cat_${Date.now()}`;
    const paths = path.trim() ? [path.trim()] : [];

    onCreate(
      {
        id,
        label: label.trim(),
        mediaType,
        paths,
      },
      path.trim() || undefined,
    );

    setLabel('');
    setPath('');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        className="w-full max-w-md rounded-xl bg-surface p-6 shadow-2xl ring-1 ring-border relative animate-in zoom-in-95 duration-200 space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-lg p-1.5 text-tertiary hover:text-primary transition"
        >
          <X className="h-4 w-4" />
        </button>

        <div>
          <h2 className="font-serif text-2xl font-normal text-primary">Yeni Menü Oluştur</h2>
          <p className="mt-1 text-xs text-secondary">
            Arşiviniz için özel bir sekme oluşturun ve ilgili medya klasörünü bağlayın.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-secondary mb-1.5">
              Menü Adı
            </label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Örn: Belgeseller, Animeler, Konserler…"
              className="w-full rounded-lg bg-surface-hover px-3 py-2 text-sm text-primary ring-1 ring-border placeholder:text-tertiary focus:outline-none focus:ring-2 focus:ring-accent"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-secondary mb-1.5">
              İçerik Türü
            </label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setMediaType('movie')}
                className={`flex flex-col items-center justify-center gap-1.5 p-3 rounded-lg ring-1 transition text-xs ${
                  mediaType === 'movie'
                    ? 'bg-accent/15 text-accent ring-accent/40 font-medium'
                    : 'bg-surface-hover/70 text-secondary ring-border hover:bg-surface-hover hover:text-primary'
                }`}
              >
                <Film className="h-5 w-5" />
                <span>Film</span>
              </button>

              <button
                type="button"
                onClick={() => setMediaType('series')}
                className={`flex flex-col items-center justify-center gap-1.5 p-3 rounded-lg ring-1 transition text-xs ${
                  mediaType === 'series'
                    ? 'bg-accent/15 text-accent ring-accent/40 font-medium'
                    : 'bg-surface-hover/70 text-secondary ring-border hover:bg-surface-hover hover:text-primary'
                }`}
              >
                <Tv className="h-5 w-5" />
                <span>Dizi</span>
              </button>

              <button
                type="button"
                onClick={() => setMediaType('music')}
                className={`flex flex-col items-center justify-center gap-1.5 p-3 rounded-lg ring-1 transition text-xs ${
                  mediaType === 'music'
                    ? 'bg-accent/15 text-accent ring-accent/40 font-medium'
                    : 'bg-surface-hover/70 text-secondary ring-border hover:bg-surface-hover hover:text-primary'
                }`}
              >
                <Music className="h-5 w-5" />
                <span>Müzik</span>
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-secondary mb-1.5">
              Klasör Yolu (Opsiyonel)
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder="/Volumes/Disk/Belgeseller"
                className="min-w-0 flex-1 rounded-lg bg-surface-hover px-3 py-2 text-sm text-primary ring-1 ring-border placeholder:text-tertiary focus:outline-none focus:ring-2 focus:ring-accent"
              />
              {isRunningInTauri() && (
                <button
                  type="button"
                  onClick={onBrowse}
                  disabled={browsing}
                  className="flex items-center gap-1.5 shrink-0 rounded-lg bg-surface-active px-3 py-2 text-xs font-medium text-primary ring-1 ring-border hover:bg-border transition disabled:opacity-50"
                  title="Klasör seç"
                >
                  <FolderOpen className="h-4 w-4 text-accent" />
                  <span>{browsing ? '…' : 'Gözat'}</span>
                </button>
              )}
            </div>
            <p className="mt-1 text-[11px] text-tertiary">
              Klasörü şimdi veya menüyü oluşturduktan sonra ekleyebilirsiniz.
            </p>
          </div>

          <div className="flex justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-3.5 py-2 text-xs font-medium text-secondary hover:text-primary transition"
            >
              İptal
            </button>
            <button
              type="submit"
              disabled={!label.trim()}
              className="rounded-lg bg-accent px-4 py-2 text-xs font-medium text-background transition hover:bg-accent-hover disabled:opacity-50"
            >
              Menüyü Oluştur
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

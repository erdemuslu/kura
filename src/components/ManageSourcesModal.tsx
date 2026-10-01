import { useState } from 'react';
import {
  AlertTriangle,
  Check,
  Edit2,
  Folder,
  FolderPlus,
  Loader2,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react';
import { browseDirectory, isRunningInTauri } from '../api/client';
import { useLocale } from '../context/LocaleContext';

export interface CategoryInfo {
  id: string;
  label: string;
  mediaType: 'movie' | 'series' | 'music';
  paths: string[];
}

interface ManageSourcesModalProps {
  isOpen: boolean;
  onClose: () => void;
  category: CategoryInfo | null;
  onRemovePath: (categoryId: string, path: string) => Promise<void>;
  onAddPath: (categoryId: string, path: string) => void;
  onScanPath: (path: string, categoryLabel: string) => void;
  onRenameCategory?: (categoryId: string, newLabel: string) => void;
  onDeleteCategory?: (categoryId: string) => void;
  isDefault?: boolean;
}

export default function ManageSourcesModal({
  isOpen,
  onClose,
  category,
  onRemovePath,
  onAddPath,
  onScanPath,
  onRenameCategory,
  onDeleteCategory,
  isDefault = false,
}: ManageSourcesModalProps) {
  const { t } = useLocale();
  const [removingPath, setRemovingPath] = useState<string | null>(null);
  const [confirmPath, setConfirmPath] = useState<string | null>(null);
  const [confirmDeleteCat, setConfirmDeleteCat] = useState(false);
  const [editingLabel, setEditingLabel] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [browsing, setBrowsing] = useState(false);
  const [manualPath, setManualPath] = useState('');
  const [showManualInput, setShowManualInput] = useState(false);

  if (!isOpen || !category) return null;

  const handleAddFolder = async () => {
    if (isRunningInTauri()) {
      setBrowsing(true);
      try {
        const selected = await browseDirectory();
        if (selected) {
          if (!category.paths.includes(selected)) {
            onAddPath(category.id, selected);
            onScanPath(selected, category.label);
          }
        }
      } finally {
        setBrowsing(false);
      }
    } else {
      setShowManualInput(true);
    }
  };

  const handleManualAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (manualPath.trim()) {
      const p = manualPath.trim();
      if (!category.paths.includes(p)) {
        onAddPath(category.id, p);
        onScanPath(p, category.label);
      }
      setManualPath('');
      setShowManualInput(false);
    }
  };

  const handleExecuteRemove = async (path: string) => {
    setRemovingPath(path);
    try {
      await onRemovePath(category.id, path);
    } finally {
      setRemovingPath(null);
      setConfirmPath(null);
    }
  };

  const handleSaveRename = () => {
    if (newLabel.trim() && onRenameCategory) {
      onRenameCategory(category.id, newLabel.trim());
      setEditingLabel(false);
    }
  };

  const mediaTypeLabel =
    category.mediaType === 'movie'
      ? t('categories.movieMenu')
      : category.mediaType === 'series'
        ? t('categories.seriesMenu')
        : t('categories.musicMenu');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        className="w-full max-w-lg rounded-xl bg-surface p-6 shadow-2xl ring-1 ring-border relative animate-in zoom-in-95 duration-200 space-y-5"
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
          <div className="flex items-center gap-2">
            {editingLabel ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  className="rounded-lg bg-surface-hover px-2.5 py-1 text-lg font-serif text-primary ring-1 ring-border focus:outline-none focus:ring-1 focus:ring-accent"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={handleSaveRename}
                  className="rounded p-1 text-accent hover:bg-surface-hover"
                  title={t('common.save')}
                >
                  <Check className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setEditingLabel(false)}
                  className="rounded p-1 text-tertiary hover:text-primary"
                  title={t('common.cancel')}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <h2 className="font-serif text-2xl font-normal text-primary">
                  {category.label}
                </h2>
                {!isDefault && onRenameCategory && (
                  <button
                    type="button"
                    onClick={() => {
                      setNewLabel(category.label);
                      setEditingLabel(true);
                    }}
                    className="p-1 text-tertiary hover:text-primary transition rounded"
                    title={t('sources.rename')}
                  >
                    <Edit2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            )}
            <span className="rounded bg-surface-hover px-2 py-0.5 text-[10px] font-mono uppercase text-tertiary ring-1 ring-border/60">
              {mediaTypeLabel}
            </span>
          </div>
          <p className="mt-1 text-xs text-secondary">{t('sources.desc')}</p>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-secondary">
              {t('sources.linked', { n: category.paths.length })}
            </span>
            <button
              type="button"
              onClick={handleAddFolder}
              disabled={browsing}
              className="flex items-center gap-1.5 rounded-lg bg-accent/15 px-2.5 py-1 text-xs font-medium text-accent ring-1 ring-accent/30 hover:bg-accent/25 transition disabled:opacity-50"
            >
              <FolderPlus className="h-3.5 w-3.5" />
              <span>{browsing ? t('common.selecting') : t('sources.addFolder')}</span>
            </button>
          </div>

          {showManualInput && (
            <form onSubmit={handleManualAddSubmit} className="flex gap-2 pt-1 animate-in fade-in">
              <input
                type="text"
                value={manualPath}
                onChange={(e) => setManualPath(e.target.value)}
                placeholder="/Volumes/Disk/Folder"
                className="flex-1 rounded-lg bg-surface-hover px-3 py-1.5 text-xs text-primary ring-1 ring-border focus:outline-none focus:ring-1 focus:ring-accent"
                autoFocus
              />
              <button
                type="submit"
                className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-background hover:bg-accent-hover transition"
              >
                {t('common.add')}
              </button>
              <button
                type="button"
                onClick={() => setShowManualInput(false)}
                className="rounded-lg px-2 text-xs text-tertiary hover:text-primary"
              >
                {t('common.dismiss')}
              </button>
            </form>
          )}

          <div className="max-h-60 overflow-y-auto rounded-lg ring-1 ring-border divide-y divide-border/50 bg-surface-hover/30">
            {category.paths.length === 0 ? (
              <div className="p-6 text-center text-xs text-tertiary">{t('sources.empty')}</div>
            ) : (
              category.paths.map((p) => {
                const isConfirming = confirmPath === p;
                const isRemoving = removingPath === p;

                return (
                  <div
                    key={p}
                    className="flex items-center justify-between gap-3 p-3 text-xs transition hover:bg-surface-hover/60"
                  >
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <Folder className="h-4 w-4 shrink-0 text-accent/80" />
                      <span className="truncate font-mono text-[11px] text-primary" title={p}>
                        {p}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {isConfirming ? (
                        <div className="flex items-center gap-1.5 animate-in fade-in">
                          <button
                            type="button"
                            onClick={() => handleExecuteRemove(p)}
                            disabled={isRemoving}
                            className="rounded bg-status-offline/20 px-2 py-1 text-[11px] font-medium text-status-offline hover:bg-status-offline/30 transition flex items-center gap-1"
                          >
                            {isRemoving && <Loader2 className="h-3 w-3 animate-spin" />}
                            <span>{t('common.confirm')}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmPath(null)}
                            disabled={isRemoving}
                            className="rounded px-2 py-1 text-[11px] text-tertiary hover:text-primary transition"
                          >
                            {t('common.cancel')}
                          </button>
                        </div>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => onScanPath(p, category.label)}
                            title={t('sources.rescan')}
                            className="p-1 text-tertiary hover:text-primary transition rounded hover:bg-surface"
                          >
                            <RefreshCw className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmPath(p)}
                            title={t('sources.remove')}
                            className="p-1 text-tertiary hover:text-status-offline transition rounded hover:bg-status-offline/10"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {!isDefault && onDeleteCategory && (
          <div className="pt-2 border-t border-border/40 flex items-center justify-between text-xs">
            {confirmDeleteCat ? (
              <div className="flex items-center justify-between w-full p-2.5 rounded-lg bg-status-offline/10 ring-1 ring-status-offline/30 animate-in fade-in">
                <div className="flex items-center gap-2 text-status-offline">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>{t('sources.deleteConfirm')}</span>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      onDeleteCategory(category.id);
                      onClose();
                    }}
                    className="rounded bg-status-offline px-2.5 py-1 text-background font-semibold hover:bg-status-offline/90 transition text-[11px]"
                  >
                    {t('common.delete')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteCat(false)}
                    className="rounded px-2 py-1 text-tertiary hover:text-primary text-[11px]"
                  >
                    {t('common.dismiss')}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDeleteCat(true)}
                className="text-tertiary hover:text-status-offline transition text-xs flex items-center gap-1.5"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>{t('sources.deleteMenu')}</span>
              </button>
            )}
          </div>
        )}

        <div className="flex justify-end pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-surface-hover px-4 py-2 text-xs font-medium text-primary hover:bg-border transition ring-1 ring-border"
          >
            {t('common.ok')}
          </button>
        </div>
      </div>
    </div>
  );
}

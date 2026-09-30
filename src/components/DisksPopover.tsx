import { useEffect, useRef } from 'react';
import { HardDrive, X } from 'lucide-react';
import type { DiskInfo } from '../api/client';

interface DisksPopoverProps {
  isOpen: boolean;
  onClose: () => void;
  disks: DiskInfo[];
  triggerRef?: React.RefObject<HTMLElement | null>;
}

export default function DisksPopover({ isOpen, onClose, disks, triggerRef }: DisksPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        (popoverRef.current && popoverRef.current.contains(target)) ||
        (triggerRef?.current && triggerRef.current.contains(target))
      ) {
        return;
      }
      onClose();
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isOpen, onClose, triggerRef]);

  if (!isOpen) return null;

  return (
    <div
      ref={popoverRef}
      className="absolute right-12 top-full mt-2 w-72 rounded-xl bg-surface p-3.5 shadow-2xl ring-1 ring-border z-50 animate-in fade-in zoom-in-95 duration-150"
    >
      <div className="flex items-center justify-between pb-2.5 border-b border-border">
        <div className="flex items-center gap-2">
          <HardDrive className="h-4 w-4 text-accent" />
          <span className="text-xs font-semibold text-primary">Bağlı Diskler</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-tertiary hover:text-primary transition"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="mt-2.5 space-y-2 max-h-60 overflow-y-auto">
        {disks.length === 0 ? (
          <p className="py-3 text-center text-xs text-tertiary">
            Bağlı disk bulunamadı
          </p>
        ) : (
          disks.map((d) => (
            <div
              key={d.label}
              className="flex items-center justify-between gap-2 rounded-lg bg-surface-hover p-2 text-xs"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-primary">{d.label}</p>
                <p className="truncate font-mono text-[10px] text-tertiary" title={d.path}>
                  {d.path}
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <span
                  className={`h-2 w-2 rounded-full ${
                    d.online ? 'bg-status-online' : 'bg-status-offline'
                  }`}
                  title={d.online ? 'Bağlı (Çevrimiçi)' : 'Çevrimdışı'}
                />
                <span className="text-[10px] text-secondary">
                  {d.online ? 'Aktif' : 'Yok'}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { Check, Copy, ExternalLink, Radio, Shield, X } from 'lucide-react';
import type { RemoteInfo } from '../api/client';
import { useLocale } from '../context/LocaleContext';

interface RemotePopoverProps {
  isOpen: boolean;
  onClose: () => void;
  remote: RemoteInfo | null;
  triggerRef?: React.RefObject<HTMLElement | null>;
}

export default function RemotePopover({ isOpen, onClose, remote, triggerRef }: RemotePopoverProps) {
  const { t } = useLocale();
  const popoverRef = useRef<HTMLDivElement>(null);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedToken, setCopiedToken] = useState(false);

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

  const url = remote?.local_ip
    ? `http://${remote.local_ip}:${remote.port}`
    : `http://localhost:${remote?.port ?? 8080}`;

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);
    } catch {}
  };

  const copyToken = async () => {
    if (!remote?.token) return;
    try {
      await navigator.clipboard.writeText(remote.token);
      setCopiedToken(true);
      setTimeout(() => setCopiedToken(false), 2000);
    } catch {}
  };

  return (
    <div
      ref={popoverRef}
      className="absolute right-6 top-full mt-2 w-80 rounded-xl bg-surface p-4 shadow-2xl ring-1 ring-border z-50 animate-in fade-in zoom-in-95 duration-150"
    >
      <div className="flex items-center justify-between pb-2.5 border-b border-border">
        <div className="flex items-center gap-2">
          <Radio className="h-4 w-4 text-accent" />
          <span className="text-xs font-semibold text-primary">{t('nav.remote')}</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-tertiary hover:text-primary transition"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="mt-3 space-y-3">
        <div>
          <p className="text-[11px] text-tertiary mb-1">{t('remote.networkAddress')}</p>
          <div className="flex items-center justify-between gap-2 rounded-lg bg-surface-hover p-2">
            <span className="font-mono text-xs text-primary truncate">{url}</span>
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={copyUrl}
                title={t('remote.copyUrl')}
                className="rounded p-1 text-secondary hover:text-primary transition"
              >
                {copiedUrl ? <Check className="h-3.5 w-3.5 text-accent" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                title={t('remote.openInBrowser')}
                className="rounded p-1 text-secondary hover:text-primary transition"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          </div>
        </div>

        <div className="rounded-lg bg-surface-hover/70 p-2.5 text-xs space-y-1.5 border border-border-subtle">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-secondary">
              <Shield className="h-3.5 w-3.5 text-tertiary" />
              {t('remote.security')}
            </span>
            <span className="text-[10px] text-tertiary font-mono">
              {remote?.auth_enabled ? t('remote.tokenRequired') : t('common.off')}
            </span>
          </div>
          {remote?.auth_enabled && (
            <div className="flex items-center justify-between gap-2 pt-1 border-t border-border-subtle">
              <code className="font-mono text-[11px] text-secondary truncate">
                {remote.token}
              </code>
              <button
                type="button"
                onClick={copyToken}
                className="text-[10px] text-accent hover:underline shrink-0"
              >
                {copiedToken ? t('common.copied') : t('common.copy')}
              </button>
            </div>
          )}
        </div>

        <p className="text-[11px] leading-relaxed text-tertiary">{t('remote.help')}</p>
      </div>
    </div>
  );
}

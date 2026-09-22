/**
 * Ayarlar paneli (yalnızca masaüstünde görünür):
 * - Uzaktan erişim token doğrulamasını açma/kapama
 * - Token'ı görüntüleme, kopyalama ve yeniden üretme
 * Ayarlar bilinçli olarak yalnızca IPC üzerinden değiştirilebilir;
 * ağdan (tarayıcı remote) erişilemez.
 */
import { useState } from 'react';
import {
  regenerateRemoteToken,
  setRemoteAuthEnabled,
  type RemoteInfo,
} from '../api/client';

interface SettingsPanelProps {
  remote: RemoteInfo;
  onAuthChange: (enabled: boolean) => void;
  onTokenChange: (token: string) => void;
}

export default function SettingsPanel({
  remote,
  onAuthChange,
  onTokenChange,
}: SettingsPanelProps) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleAuth = async (enabled: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await setRemoteAuthEnabled(enabled);
      onAuthChange(enabled);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const regenerate = async () => {
    setBusy(true);
    setError(null);
    try {
      const token = await regenerateRemoteToken();
      onTokenChange(token);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const copyToken = async () => {
    try {
      await navigator.clipboard.writeText(remote.token);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('Token kopyalanamadı');
    }
  };

  return (
    <section className="space-y-4 rounded-xl bg-slate-800/60 p-4 ring-1 ring-slate-700">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-100">
            Token doğrulaması
          </p>
          <p className="text-xs text-slate-400">
            Açıkken, ağdan gelen değiştirici istekler (oynatma, tarama) token
            ister. Tarayıcıdan ilk girişte token sorulur.
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => toggleAuth(!remote.auth_enabled)}
          className={`relative h-7 w-14 shrink-0 rounded-full transition disabled:opacity-50 ${
            remote.auth_enabled ? 'bg-emerald-500' : 'bg-slate-600'
          }`}
          title={remote.auth_enabled ? 'Kapat' : 'Aç'}
        >
          <span
            className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${
              remote.auth_enabled ? 'left-[1.875rem]' : 'left-0.5'
            }`}
          />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-slate-300">Token:</span>
        <code className="rounded bg-slate-900 px-2 py-1 font-mono text-emerald-300">
          {remote.auth_enabled ? remote.token : '— (doğrulama kapalı)'}
        </code>
        {remote.auth_enabled && (
          <>
            <button
              type="button"
              onClick={copyToken}
              className="rounded-lg bg-slate-700 px-3 py-1.5 text-xs text-slate-100 transition hover:bg-slate-600"
            >
              {copied ? '✓ Kopyalandı' : 'Kopyala'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={regenerate}
              className="rounded-lg bg-slate-700 px-3 py-1.5 text-xs text-slate-100 transition hover:bg-slate-600 disabled:opacity-50"
            >
              Yenile
            </button>
          </>
        )}
      </div>

      {error && <p className="text-sm text-red-400">Hata: {error}</p>}
    </section>
  );
}

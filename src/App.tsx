import { useEffect, useState } from 'react';
import MediaGrid from './components/MediaGrid';
import MusicView from './components/MusicView';
import PlayerSelect from './components/PlayerSelect';
import ScanPanel from './components/ScanPanel';
import SettingsPanel from './components/SettingsPanel';
import StorageBadge from './components/StorageBadge';
import {
  ApiAuthError,
  getRemoteInfo,
  isRunningInTauri,
  setRemoteToken,
  type MediaType,
  type RemoteInfo,
} from './api/client';
import { useDisks, useLaunchPlayer, useLibrary } from './hooks/useMedia';

const TABS: { id: MediaType; label: string }[] = [
  { id: 'movie', label: 'Film' },
  { id: 'series', label: 'Dizi' },
  { id: 'music', label: 'Müzik' },
];

export default function App() {
  const [tab, setTab] = useState<MediaType>('movie');
  const [query, setQuery] = useState('');
  const [player, setPlayer] = useState('system');
  const [playingPath, setPlayingPath] = useState<string | null>(null);
  const [remote, setRemote] = useState<RemoteInfo | null>(null);
  const [tokenInput, setTokenInput] = useState('');
  const [showSettings, setShowSettings] = useState(false);

  // Müzik sekmesinde düz liste sorgusu atlanır; MusicView hiyerarşik
  // (sanatçı/albüm) sorgularını kendisi yapar.
  const library = useLibrary(tab, query, tab !== 'music');
  const disks = useDisks();
  const launch = useLaunchPlayer();

  // Uzaktan kumanda bilgisi yalnızca masaüstünde (IPC) çekilir.
  useEffect(() => {
    getRemoteInfo()
      .then((info) => setRemote(info))
      .catch(() => setRemote(null));
  }, []);

  const handlePlay = (filePath: string) => {
    setPlayingPath(filePath);
    launch.mutate({ filePath, targetApp: player });
  };

  const authError = library.error instanceof ApiAuthError;
  const remoteUrl = remote?.local_ip
    ? `http://${remote.local_ip}:${remote.port}`
    : null;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="sticky top-0 z-10 border-b border-slate-800 bg-slate-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-lg font-semibold tracking-tight">Local Media Hub</h1>
            {disks.data?.map((d) => <StorageBadge key={d.label} disk={d} />)}
            <div className="ml-auto flex items-center gap-3">
              <PlayerSelect value={player} onChange={setPlayer} />
              {isRunningInTauri() && (
                <button
                  type="button"
                  onClick={() => setShowSettings(!showSettings)}
                  title="Ayarlar"
                  className={`rounded-lg px-2.5 py-1.5 text-sm transition ${
                    showSettings
                      ? 'bg-sky-600 text-white'
                      : 'bg-slate-800 text-slate-300 ring-1 ring-slate-700 hover:text-slate-100'
                  }`}
                >
                  ⚙
                </button>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <nav className="flex gap-1 rounded-lg bg-slate-800/60 p-1">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                    tab === t.id
                      ? 'bg-slate-700 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </nav>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Ara…"
              className="min-w-0 flex-1 rounded-lg bg-slate-900 px-3 py-2 text-sm ring-1 ring-slate-700 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-400 sm:max-w-xs"
            />
            {!isRunningInTauri() && (
              <span className="rounded-full bg-sky-500/15 px-2.5 py-1 text-[11px] font-medium text-sky-300">
                📱 Uzaktan kumanda modu
              </span>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-4 p-4">
        {authError && (
          <section className="rounded-xl bg-amber-500/10 p-4 text-sm text-amber-200 ring-1 ring-amber-500/40">
            <p className="font-medium">Uzaktan erişim token’ı gerekli.</p>
            <p className="mt-1 text-amber-200/70">
              Masaüstü uygulamasında “Uzaktan kumanda” bölümünde gösterilen token’ı girin.
            </p>
            <div className="mt-2 flex max-w-md gap-2">
              <input
                type="text"
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                placeholder="Token"
                className="min-w-0 flex-1 rounded-lg bg-slate-900 px-3 py-2 text-sm ring-1 ring-amber-500/40 focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
              <button
                type="button"
                onClick={() => {
                  setRemoteToken(tokenInput.trim());
                  library.refetch();
                }}
                className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-amber-400"
              >
                Kaydet
              </button>
            </div>
          </section>
        )}

        {remote && (
          <section className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-xl bg-slate-800/40 p-4 text-sm text-slate-300 ring-1 ring-slate-700">
            <span className="font-medium text-slate-100">Uzaktan kumanda</span>
            <span>
              Ağ adresi:{' '}
              {remoteUrl ? (
                <code className="rounded bg-slate-900 px-1.5 py-0.5 text-sky-300">
                  {remoteUrl}
                </code>
              ) : (
                'bulunamadı'
              )}
            </span>
            <span>
              Token:{' '}
              <code className="rounded bg-slate-900 px-1.5 py-0.5 text-emerald-300">
                {remote.auth_enabled ? remote.token : '— (doğrulama kapalı)'}
              </code>
            </span>
          </section>
        )}

        {showSettings && remote && (
          <SettingsPanel
            remote={remote}
            onAuthChange={(enabled) =>
              setRemote((r) => (r ? { ...r, auth_enabled: enabled } : r))
            }
            onTokenChange={(token) =>
              setRemote((r) => (r ? { ...r, token } : r))
            }
          />
        )}

        <ScanPanel />

        {launch.data && (
          <p
            className={`text-sm ${
              launch.data.success ? 'text-emerald-300' : 'text-red-400'
            }`}
          >
            {launch.data.message}
          </p>
        )}
        {launch.isError && (
          <p className="text-sm text-red-400">Hata: {String(launch.error)}</p>
        )}

        {tab === 'music' ? (
          <MusicView
            player={player}
            query={query}
            playingPath={playingPath}
            onPlayed={setPlayingPath}
          />
        ) : (
          <MediaGrid
            items={library.data}
            loading={library.isLoading}
            playingPath={playingPath}
            onPlay={(item) => handlePlay(item.file_path)}
          />
        )}
      </main>
    </div>
  );
}

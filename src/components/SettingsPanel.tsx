import { useEffect, useState, useMemo, useRef } from 'react';
import {
  BarChart2,
  Check,
  ChevronDown,
  Clock,
  Copy,
  Database,
  Download,
  ExternalLink,
  Film,
  Headphones,
  Loader2,
  Monitor,
  Music,
  PlaySquare,
  Radio,
  RefreshCw,
  Trash2,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  AUDIO_PLAYERS,
  completeLastFmAuth,
  disconnectLastFm,
  getLastFmStatus,
  getTmdbApiKey,
  regenerateRemoteToken,
  setLastFmScrobbleEnabled,
  setPlayerSetting,
  setRemoteAuthEnabled,
  setTmdbApiKey,
  startLastFmAuth,
  VIDEO_PLAYERS,
  type LastFmStatus,
  type RemoteInfo,
} from '../api/client';
import { useLocale } from '../context/LocaleContext';
import { useStats } from '../context/StatsContext';
import { useFavorites } from '../context/FavoritesContext';
import { usePlaylists } from '../context/PlaylistContext';
import { exportUserData, parseUserDataFile } from '../lib/userData';
import type { Locale } from '../i18n';

type SettingsTab = 'appearance' | 'players' | 'remote' | 'tmdb' | 'lastfm' | 'stats' | 'backup';

function formatListenTime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  return remM > 0 ? `${h}h ${remM}m` : `${h}h`;
}

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  remote: RemoteInfo | null;
  audioPlayer: string;
  videoPlayer: string;
  onAudioPlayerChange: (player: string) => void;
  onVideoPlayerChange: (player: string) => void;
  onAuthChange: (enabled: boolean) => void;
  onTokenChange: (token: string) => void;
}

export default function SettingsPanel({
  isOpen,
  onClose,
  remote,
  audioPlayer,
  videoPlayer,
  onAudioPlayerChange,
  onVideoPlayerChange,
  onAuthChange,
  onTokenChange,
}: SettingsPanelProps) {
  const { t, locale, setLocale } = useLocale();
  const { favorites, importFavorites } = useFavorites();
  const { playlists, importPlaylists } = usePlaylists();
  const { isEnabled: statsEnabled, setIsEnabled: setStatsEnabled, stats, clearStats, importStats } =
    useStats();
  const [activeTab, setActiveTab] = useState<SettingsTab>('appearance');
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');
  const [backupFeedback, setBackupFeedback] = useState<{ success: boolean; message: string } | null>(
    null,
  );
  const [isExporting, setIsExporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const topArtists = useMemo(() => {
    return Object.values(stats.artists)
      .sort((a, b) => b.playCount - a.playCount)
      .slice(0, 5);
  }, [stats.artists]);

  const topTracks = useMemo(() => {
    return Object.values(stats.tracks)
      .sort((a, b) => b.playCount - a.playCount)
      .slice(0, 5);
  }, [stats.tracks]);

  const maxArtistPlays = useMemo(() => {
    return topArtists[0]?.playCount || 1;
  }, [topArtists]);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tmdbKeyInput, setTmdbKeyInput] = useState('');
  const [tmdbSaved, setTmdbSaved] = useState<string | null>(null);
  const [tmdbFeedback, setTmdbFeedback] = useState<string | null>(null);

  const [lastFmStatus, setLastFmStatus] = useState<LastFmStatus | null>(null);
  const [lastFmLoading, setLastFmLoading] = useState(false);
  const [lastFmPendingToken, setLastFmPendingToken] = useState<string | null>(null);
  const [lastFmAuthUrl, setLastFmAuthUrl] = useState<string | null>(null);
  const [lastFmFeedback, setLastFmFeedback] = useState<string | null>(null);

  const [scale, setScale] = useState<number>(() => {
    const saved = localStorage.getItem('lmh-ui-scale');
    return saved ? Number(saved) : 100;
  });

  const [showExternalInVideo, setShowExternalInVideo] = useState(() => {
    return localStorage.getItem('kura-show-external-video-player') === 'true';
  });

  const handleToggleExternalInVideo = (enabled: boolean) => {
    setShowExternalInVideo(enabled);
    localStorage.setItem('kura-show-external-video-player', enabled ? 'true' : 'false');
  };

  const applyScale = (newScale: number) => {
    const clamped = Math.max(75, Math.min(160, newScale));
    setScale(clamped);
    localStorage.setItem('lmh-ui-scale', String(clamped));
    document.documentElement.style.zoom = String(clamped / 100);
  };

  useEffect(() => {
    if (!isOpen) return;
    getTmdbApiKey()
      .then((k) => setTmdbSaved(k))
      .catch(() => setTmdbSaved(null));
    getLastFmStatus()
      .then((s) => setLastFmStatus(s))
      .catch(() => setLastFmStatus(null));
  }, [isOpen]);

  const handleStartLastFm = async () => {
    setLastFmLoading(true);
    setLastFmFeedback(null);
    try {
      const res = await startLastFmAuth();
      setLastFmPendingToken(res.token);
      setLastFmAuthUrl(res.url);
      setLastFmFeedback(t('lastfm.authStarted'));
    } catch (e: any) {
      setLastFmFeedback(e?.message || t('lastfm.authStartFailed'));
    } finally {
      setLastFmLoading(false);
    }
  };

  const handleCompleteLastFm = async () => {
    if (!lastFmPendingToken) return;
    setLastFmLoading(true);
    setLastFmFeedback(null);
    try {
      const username = await completeLastFmAuth(lastFmPendingToken);
      setLastFmPendingToken(null);
      setLastFmAuthUrl(null);
      setLastFmFeedback(t('lastfm.connected', { username }));
      const updated = await getLastFmStatus();
      setLastFmStatus(updated);
    } catch (e: any) {
      setLastFmFeedback(e?.message || t('lastfm.authIncomplete'));
    } finally {
      setLastFmLoading(false);
    }
  };

  const handleDisconnectLastFm = async () => {
    setLastFmLoading(true);
    try {
      await disconnectLastFm();
      setLastFmPendingToken(null);
      setLastFmAuthUrl(null);
      setLastFmFeedback(t('lastfm.disconnected'));
      const updated = await getLastFmStatus();
      setLastFmStatus(updated);
    } catch (e: any) {
      setLastFmFeedback(e?.message || t('lastfm.disconnectFailed'));
    } finally {
      setLastFmLoading(false);
    }
  };

  const handleToggleScrobble = async () => {
    if (!lastFmStatus) return;
    const nextVal = !lastFmStatus.scrobble_enabled;
    try {
      await setLastFmScrobbleEnabled(nextVal);
      setLastFmStatus((prev) => (prev ? { ...prev, scrobble_enabled: nextVal } : null));
    } catch {}
  };

  if (!isOpen) return null;

  const handleAudioChange = async (val: string) => {
    onAudioPlayerChange(val);
    await setPlayerSetting('audio', val);
  };

  const handleVideoChange = async (val: string) => {
    onVideoPlayerChange(val);
    await setPlayerSetting('video', val);
  };

  const saveTmdbKey = async () => {
    setBusy(true);
    setError(null);
    try {
      await setTmdbApiKey(tmdbKeyInput);
      const saved = await getTmdbApiKey();
      setTmdbSaved(saved);
      setTmdbFeedback(saved ? t('tmdb.saved') : t('tmdb.cleared'));
      setTimeout(() => setTmdbFeedback(null), 3000);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

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
    if (!remote?.token) return;
    try {
      await navigator.clipboard.writeText(remote.token);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError(t('remote.copyFailed'));
    }
  };

  const SETTINGS_TABS = [
    { id: 'appearance' as const, label: t('settings.tabAppearance'), icon: Monitor },
    { id: 'players' as const, label: t('settings.tabPlayers'), icon: PlaySquare },
    { id: 'remote' as const, label: t('settings.tabRemote'), icon: Radio },
    { id: 'tmdb' as const, label: t('settings.tabTmdb'), icon: Film },
    { id: 'lastfm' as const, label: t('settings.tabLastfm'), icon: Music },
    { id: 'stats' as const, label: t('settings.tabStats'), icon: BarChart2 },
    { id: 'backup' as const, label: t('settings.tabBackup'), icon: Database },
  ];

  const scalePresets = [
    { label: t('settings.scalePreset85'), val: 85 },
    { label: t('settings.scalePreset100'), val: 100 },
    { label: t('settings.scalePreset115'), val: 115 },
    { label: t('settings.scalePreset125'), val: 125 },
    { label: t('settings.scalePreset140'), val: 140 },
  ];

  const langOptions: { id: Locale; label: string }[] = [
    { id: 'en', label: t('settings.languageEn') },
    { id: 'tr', label: t('settings.languageTr') },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-2xl bg-surface p-7 sm:p-8 shadow-2xl ring-1 ring-border relative animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-6 top-6 rounded-lg p-2 text-tertiary hover:text-primary hover:bg-surface-hover transition"
          title={t('common.closeEsc')}
        >
          <X className="h-5 w-5" />
        </button>

        <div className="flex items-center gap-3.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/15 text-accent ring-1 ring-accent/30 shadow-sm shrink-0">
            <span className="text-[15px] font-serif font-medium leading-none select-none">
              蔵
            </span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-serif text-2xl font-normal text-primary tracking-tight">
                {t('common.settings')}
              </h2>
              <span className="rounded-md bg-accent/10 px-2 py-0.5 font-mono text-[10px] text-accent tracking-wider uppercase font-medium">
                {t('common.brandBadge')}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-secondary">{t('settings.subtitle')}</p>
          </div>
        </div>

        <div className="flex flex-wrap border-b border-border mt-6 gap-2 sm:gap-3">
          {SETTINGS_TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-3.5 py-2.5 text-xs font-medium border-b-2 transition -mb-px ${
                  isActive
                    ? 'border-accent text-primary font-semibold'
                    : 'border-transparent text-tertiary hover:text-secondary hover:border-border'
                }`}
              >
                <Icon className={`h-4 w-4 ${isActive ? 'text-accent' : 'text-tertiary'}`} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        <div className="flex-1 overflow-y-auto py-6 space-y-6 pr-1">
          {activeTab === 'appearance' && (
            <div className="space-y-6 animate-in fade-in duration-150">
              {/* Language */}
              <div className="rounded-xl bg-surface-hover/50 p-5 ring-1 ring-border space-y-4">
                <div>
                  <h3 className="text-sm font-semibold text-primary">
                    {t('settings.languageTitle')}
                  </h3>
                  <p className="text-xs text-secondary mt-0.5">{t('settings.languageDesc')}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {langOptions.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setLocale(opt.id)}
                      className={`rounded-xl px-4 py-2.5 text-xs font-medium transition ${
                        locale === opt.id
                          ? 'bg-accent text-background font-semibold shadow-md ring-2 ring-accent/40'
                          : 'bg-surface text-secondary hover:text-primary hover:bg-border ring-1 ring-border'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Scale */}
              <div className="rounded-xl bg-surface-hover/50 p-5 ring-1 ring-border space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-primary">
                      {t('settings.scaleTitle')}
                    </h3>
                    <p className="text-xs text-secondary mt-0.5">{t('settings.scaleDesc')}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-lg bg-accent/15 px-3 py-1 font-mono text-xs font-bold text-accent">
                      %{scale}
                    </span>
                    {scale !== 100 && (
                      <button
                        type="button"
                        onClick={() => applyScale(100)}
                        className="rounded-lg bg-surface px-2.5 py-1 text-[11px] text-tertiary hover:text-accent ring-1 ring-border transition"
                      >
                        {t('common.reset')}
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 pt-1">
                  {scalePresets.map((preset) => (
                    <button
                      key={preset.val}
                      type="button"
                      onClick={() => applyScale(preset.val)}
                      className={`rounded-xl px-3.5 py-2 text-xs font-medium transition ${
                        scale === preset.val
                          ? 'bg-accent text-background font-semibold shadow-md'
                          : 'bg-surface text-secondary hover:text-primary hover:bg-border ring-1 ring-border'
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => applyScale(scale - 5)}
                    disabled={scale <= 75}
                    className="flex h-9 w-9 items-center justify-center rounded-xl bg-surface text-secondary hover:text-primary hover:bg-surface-active ring-1 ring-border transition disabled:opacity-30"
                    title={t('settings.scaleZoomOut')}
                  >
                    <ZoomOut className="h-4 w-4" />
                  </button>
                  <input
                    type="range"
                    min={75}
                    max={160}
                    step={5}
                    value={scale}
                    onChange={(e) => applyScale(Number(e.target.value))}
                    className="h-2 flex-1 cursor-pointer appearance-none rounded-lg bg-surface ring-1 ring-border accent-accent"
                  />
                  <button
                    type="button"
                    onClick={() => applyScale(scale + 5)}
                    disabled={scale >= 160}
                    className="flex h-9 w-9 items-center justify-center rounded-xl bg-surface text-secondary hover:text-primary hover:bg-surface-active ring-1 ring-border transition disabled:opacity-30"
                    title={t('settings.scaleZoomIn')}
                  >
                    <ZoomIn className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="rounded-xl border border-border/60 bg-surface-hover/30 p-4 text-xs text-tertiary space-y-1">
                <p className="font-medium text-secondary">{t('common.tip')}</p>
                <p>{t('settings.scaleTip')}</p>
              </div>
            </div>
          )}

          {activeTab === 'players' && (
            <div className="space-y-5 animate-in fade-in duration-150">
              <div className="rounded-xl bg-surface-hover/50 p-5 ring-1 ring-border space-y-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/15 text-accent shrink-0">
                    <Music className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-primary">{t('players.audioTitle')}</h3>
                    <p className="text-xs text-secondary mt-0.5">{t('players.audioDesc')}</p>
                  </div>
                </div>

                <div className="relative pt-1">
                  <select
                    value={audioPlayer}
                    onChange={(e) => handleAudioChange(e.target.value)}
                    className="h-12 w-full appearance-none rounded-xl bg-surface px-4 py-3 pr-11 text-sm font-medium text-primary ring-1 ring-border transition cursor-pointer hover:bg-surface-active focus:outline-none focus:ring-2 focus:ring-accent"
                  >
                    {AUDIO_PLAYERS.map((p) => (
                      <option key={p.id} value={p.id} className="bg-surface py-2 text-primary">
                        {p.labelKey ? t(p.labelKey) : p.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-tertiary" />
                </div>

                <p className="text-[11px] text-tertiary pt-1">
                  {audioPlayer === 'in_app'
                    ? t('players.audioInAppHint')
                    : t('players.audioExternalHint', { app: audioPlayer })}
                </p>
              </div>

              <div className="rounded-xl bg-surface-hover/50 p-5 ring-1 ring-border space-y-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-surface text-secondary shrink-0 ring-1 ring-border">
                    <Film className="h-4 w-4 text-accent" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-primary">{t('players.videoTitle')}</h3>
                    <p className="text-xs text-secondary mt-0.5">{t('players.videoDesc')}</p>
                  </div>
                </div>

                <div className="relative pt-1">
                  <select
                    value={videoPlayer}
                    onChange={(e) => handleVideoChange(e.target.value)}
                    className="h-12 w-full appearance-none rounded-xl bg-surface px-4 py-3 pr-11 text-sm font-medium text-primary ring-1 ring-border transition cursor-pointer hover:bg-surface-active focus:outline-none focus:ring-2 focus:ring-accent"
                  >
                    {VIDEO_PLAYERS.map((p) => (
                      <option key={p.id} value={p.id} className="bg-surface py-2 text-primary">
                        {p.labelKey ? t(p.labelKey) : p.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-tertiary" />
                </div>

                <p className="text-[11px] text-tertiary pt-1">
                  {videoPlayer === 'in_app'
                    ? t('players.videoInAppHint')
                    : t('players.videoExternalHint', { app: videoPlayer })}
                </p>
              </div>

              <div className="rounded-xl bg-surface-hover/50 p-5 ring-1 ring-border space-y-3">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h3 className="text-sm font-semibold text-primary">
                      {t('players.externalShortcutTitle')}
                    </h3>
                    <p className="text-xs text-secondary mt-0.5 max-w-md">
                      {t('players.externalShortcutDesc')}
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={showExternalInVideo}
                    onClick={() => handleToggleExternalInVideo(!showExternalInVideo)}
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      showExternalInVideo ? 'bg-accent' : 'bg-surface'
                    } ring-1 ring-border`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                        showExternalInVideo ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'remote' && (
            <div className="space-y-5 animate-in fade-in duration-150">
              {remote ? (
                <>
                  <div className="rounded-xl bg-surface-hover/50 p-5 ring-1 ring-border space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-sm font-semibold text-primary">
                          {t('remote.authToggleTitle')}
                        </h3>
                        <p className="text-xs text-secondary mt-0.5">{t('remote.authToggleDesc')}</p>
                      </div>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => toggleAuth(!remote.auth_enabled)}
                        className={`relative h-6 w-11 shrink-0 rounded-full transition ${
                          remote.auth_enabled ? 'bg-accent' : 'bg-surface ring-1 ring-border'
                        }`}
                      >
                        <span
                          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
                            remote.auth_enabled ? 'left-[1.375rem]' : 'left-0.5'
                          }`}
                        />
                      </button>
                    </div>

                    <div className="flex items-center justify-between gap-3 rounded-xl bg-surface p-3.5 ring-1 ring-border text-xs">
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] text-tertiary">{t('remote.activeToken')}</p>
                        <code className="font-mono text-xs text-accent mt-0.5 block truncate">
                          {remote.auth_enabled ? remote.token : t('remote.authDisabled')}
                        </code>
                      </div>
                      {remote.auth_enabled && (
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={copyToken}
                            className="flex items-center gap-1 rounded-lg bg-surface-hover px-2.5 py-1.5 text-xs text-secondary hover:text-primary ring-1 ring-border transition"
                            title={t('common.copy')}
                          >
                            {copied ? <Check className="h-3.5 w-3.5 text-accent" /> : <Copy className="h-3.5 w-3.5" />}
                            <span>{copied ? t('common.copied') : t('common.copy')}</span>
                          </button>
                          <button
                            type="button"
                            onClick={regenerate}
                            disabled={busy}
                            className="flex items-center gap-1 rounded-lg bg-surface-hover px-2.5 py-1.5 text-xs text-secondary hover:text-primary ring-1 ring-border transition"
                            title={t('remote.regenerateTitle')}
                          >
                            <RefreshCw className="h-3.5 w-3.5" />
                            <span>{t('common.refresh')}</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="rounded-xl border border-border/60 bg-surface-hover/30 p-4 text-xs text-tertiary space-y-1">
                    <p className="font-medium text-secondary">{t('remote.connectionInfo')}</p>
                    <p>{t('remote.connectionHelp')}</p>
                  </div>
                </>
              ) : (
                <p className="py-8 text-center text-xs text-tertiary">{t('remote.desktopOnly')}</p>
              )}
            </div>
          )}

          {activeTab === 'tmdb' && (
            <div className="space-y-5 animate-in fade-in duration-150">
              <div className="rounded-xl bg-surface-hover/50 p-5 ring-1 ring-border space-y-3.5">
                <div>
                  <h3 className="text-sm font-semibold text-primary">{t('tmdb.title')}</h3>
                  <p className="text-xs text-secondary mt-1 leading-relaxed">{t('tmdb.desc')}</p>
                </div>

                <div className="flex flex-col sm:flex-row gap-2.5 pt-1">
                  <input
                    type="text"
                    value={tmdbKeyInput}
                    onChange={(e) => setTmdbKeyInput(e.target.value)}
                    placeholder={
                      tmdbSaved
                        ? t('tmdb.savedPlaceholder', { last4: tmdbSaved.slice(-4) })
                        : t('tmdb.placeholder')
                    }
                    className="h-11 flex-1 rounded-xl bg-surface px-4 py-2.5 text-xs font-mono text-primary ring-1 ring-border placeholder:text-tertiary focus:outline-none focus:ring-2 focus:ring-accent"
                  />
                  <button
                    type="button"
                    disabled={busy || !tmdbKeyInput.trim()}
                    onClick={saveTmdbKey}
                    className="h-11 rounded-xl bg-accent px-5 py-2.5 text-xs font-semibold text-background transition hover:bg-accent-hover disabled:opacity-50"
                  >
                    {t('common.save')}
                  </button>
                </div>

                {tmdbFeedback && (
                  <p className="text-xs text-accent font-medium">{tmdbFeedback}</p>
                )}
              </div>

              <div className="rounded-xl border border-border/60 bg-surface-hover/30 p-4 text-xs text-tertiary space-y-1">
                <p className="font-medium text-secondary">{t('tmdb.howTitle')}</p>
                <p className="leading-relaxed">
                  <a
                    href="https://www.themoviedb.org/signup"
                    target="_blank"
                    rel="noreferrer"
                    className="text-accent underline underline-offset-2 hover:opacity-80"
                  >
                    themoviedb.org
                  </a>{' '}
                  {t('tmdb.howBody')}
                </p>
              </div>
            </div>
          )}

          {activeTab === 'lastfm' && (
            <div className="space-y-6 animate-in fade-in duration-150">
              <div className="rounded-xl bg-surface-hover/50 p-5 ring-1 ring-border space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-primary">{t('lastfm.title')}</h3>
                      {lastFmStatus?.connected ? (
                        <span className="flex items-center gap-1.5 rounded-full bg-status-online/15 px-2.5 py-0.5 text-[11px] font-medium text-status-online ring-1 ring-status-online/30">
                          <span className="h-1.5 w-1.5 rounded-full bg-status-online" />
                          @{lastFmStatus.username}
                        </span>
                      ) : (
                        <span className="rounded-full bg-surface px-2.5 py-0.5 text-[11px] font-medium text-tertiary ring-1 ring-border">
                          {t('lastfm.notConnected')}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-secondary leading-relaxed">{t('lastfm.desc')}</p>
                  </div>
                </div>

                {!lastFmStatus?.has_api_keys ? (
                  <div className="rounded-lg bg-surface p-4 ring-1 ring-border text-xs text-status-offline space-y-1.5">
                    <p className="font-semibold">{t('lastfm.keysMissingTitle')}</p>
                    <p className="text-secondary leading-relaxed">{t('lastfm.keysMissingBody')}</p>
                  </div>
                ) : lastFmStatus.connected ? (
                  <div className="space-y-4 pt-2">
                    <div className="flex items-center justify-between rounded-lg bg-surface p-4 ring-1 ring-border">
                      <div className="space-y-0.5">
                        <div className="text-xs font-medium text-primary">
                          {t('lastfm.scrobbleToggle')}
                        </div>
                        <div className="text-[11px] text-tertiary">{t('lastfm.scrobbleHint')}</div>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={lastFmStatus.scrobble_enabled}
                          onChange={handleToggleScrobble}
                          className="sr-only peer"
                        />
                        <div className="w-9 h-5 bg-surface-active peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-accent"></div>
                      </label>
                    </div>

                    <div className="flex justify-end pt-1">
                      <button
                        type="button"
                        disabled={lastFmLoading}
                        onClick={handleDisconnectLastFm}
                        className="rounded-xl border border-border bg-surface px-4 py-2 text-xs font-medium text-status-offline hover:bg-status-offline/10 transition disabled:opacity-50"
                      >
                        {lastFmLoading ? t('common.processing') : t('lastfm.disconnect')}
                      </button>
                    </div>
                  </div>
                ) : lastFmPendingToken ? (
                  <div className="space-y-4 pt-2">
                    <div className="rounded-lg bg-surface p-4 ring-1 ring-border text-xs space-y-3">
                      <p className="text-secondary leading-relaxed">{t('lastfm.authPending')}</p>
                      {lastFmAuthUrl && (
                        <a
                          href={lastFmAuthUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 text-accent hover:underline text-xs"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          {t('lastfm.openAuthAgain')}
                        </a>
                      )}
                    </div>

                    <div className="flex items-center gap-2.5">
                      <button
                        type="button"
                        disabled={lastFmLoading}
                        onClick={handleCompleteLastFm}
                        className="flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-xs font-semibold text-background hover:bg-accent-hover transition disabled:opacity-50 shadow-sm"
                      >
                        {lastFmLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                        {t('lastfm.completeAuth')}
                      </button>
                      <button
                        type="button"
                        disabled={lastFmLoading}
                        onClick={() => {
                          setLastFmPendingToken(null);
                          setLastFmAuthUrl(null);
                          setLastFmFeedback(null);
                        }}
                        className="rounded-xl bg-surface px-4 py-2.5 text-xs font-medium text-tertiary hover:text-primary transition"
                      >
                        {t('common.cancel')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4 pt-2">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-lg bg-surface p-4 ring-1 ring-border">
                      <div className="space-y-1">
                        <div className="text-xs font-medium text-primary">
                          {t('lastfm.connectTitle')}
                        </div>
                        <div className="text-[11px] text-tertiary">{t('lastfm.connectHint')}</div>
                      </div>
                      <button
                        type="button"
                        disabled={lastFmLoading}
                        onClick={handleStartLastFm}
                        className="inline-flex items-center justify-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-xs font-semibold text-background hover:bg-accent-hover transition disabled:opacity-50 shadow-sm shrink-0"
                      >
                        {lastFmLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                        {t('lastfm.connect')}
                      </button>
                    </div>
                  </div>
                )}

                {lastFmFeedback && (
                  <p className="text-xs text-accent font-medium leading-relaxed pt-1">
                    {lastFmFeedback}
                  </p>
                )}
              </div>

              <div className="rounded-xl border border-border/60 bg-surface-hover/30 p-4 text-xs text-tertiary space-y-1.5">
                <p className="font-medium text-secondary">{t('lastfm.howTitle')}</p>
                <p className="leading-relaxed">{t('lastfm.howNowPlaying')}</p>
                <p className="leading-relaxed">{t('lastfm.howScrobble')}</p>
              </div>
            </div>
          )}

          {activeTab === 'stats' && (
            <div className="space-y-6 animate-in fade-in duration-150">
              {/* Privacy & Opt-in Toggle */}
              <div className="rounded-xl bg-surface-hover/50 p-5 ring-1 ring-border space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <h3 className="text-sm font-semibold text-primary">
                      {t('settings.statsTitle')}
                    </h3>
                    <p className="text-xs text-secondary leading-relaxed max-w-lg">
                      {t('settings.statsDesc')}
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={statsEnabled}
                    onClick={() => setStatsEnabled(!statsEnabled)}
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      statsEnabled ? 'bg-accent' : 'bg-surface-hover ring-1 ring-border'
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                        statsEnabled ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>

                <div className="pt-2 border-t border-border/40 flex items-center justify-between text-xs text-tertiary">
                  <span>{t('settings.statsToggle')}</span>
                  <span className={`font-mono text-[11px] ${statsEnabled ? 'text-accent font-semibold' : 'text-tertiary'}`}>
                    {statsEnabled ? 'ON' : 'OFF'}
                  </span>
                </div>
              </div>

              {!statsEnabled ? (
                <div className="rounded-xl border border-dashed border-border p-8 text-center text-xs text-secondary space-y-2">
                  <Headphones className="h-8 w-8 mx-auto text-tertiary/60" />
                  <p className="font-medium text-primary">{t('settings.statsDisabledNotice')}</p>
                </div>
              ) : (
                <>
                  {/* Summary Cards */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="rounded-xl bg-surface-hover/50 p-4 ring-1 ring-border flex flex-col justify-between">
                      <div className="flex items-center justify-between text-tertiary mb-2">
                        <span className="text-xs">{t('settings.statsTotalPlays')}</span>
                        <PlaySquare className="h-4 w-4 text-accent/80" />
                      </div>
                      <div className="text-2xl font-serif text-primary tabular-nums">
                        {stats.totalPlayCount}
                      </div>
                    </div>

                    <div className="rounded-xl bg-surface-hover/50 p-4 ring-1 ring-border flex flex-col justify-between">
                      <div className="flex items-center justify-between text-tertiary mb-2">
                        <span className="text-xs">{t('settings.statsTotalTime')}</span>
                        <Clock className="h-4 w-4 text-accent/80" />
                      </div>
                      <div className="text-2xl font-serif text-primary tabular-nums">
                        {formatListenTime(stats.totalListenSeconds)}
                      </div>
                    </div>

                    <div className="rounded-xl bg-surface-hover/50 p-4 ring-1 ring-border flex flex-col justify-between">
                      <div className="flex items-center justify-between text-tertiary mb-2">
                        <span className="text-xs">{t('settings.statsTopArtists')}</span>
                        <Music className="h-4 w-4 text-accent/80" />
                      </div>
                      <div className="text-2xl font-serif text-primary tabular-nums">
                        {Object.keys(stats.artists).length}
                      </div>
                    </div>
                  </div>

                  {stats.totalPlayCount === 0 ? (
                    <div className="rounded-xl bg-surface-hover/30 p-8 text-center text-xs text-secondary">
                      {t('settings.statsNoData')}
                    </div>
                  ) : (
                    <>
                      {/* Top Artists */}
                      {topArtists.length > 0 && (
                        <div className="rounded-xl bg-surface-hover/50 p-5 ring-1 ring-border space-y-3">
                          <h4 className="text-xs font-semibold uppercase tracking-wider text-tertiary">
                            {t('settings.statsTopArtists')}
                          </h4>
                          <div className="space-y-2.5">
                            {topArtists.map((artist, idx) => {
                              const pct = Math.round((artist.playCount / maxArtistPlays) * 100);
                              return (
                                <div key={artist.artist} className="space-y-1">
                                  <div className="flex items-center justify-between text-xs">
                                    <span className="text-primary truncate font-medium">
                                      <span className="font-mono text-tertiary mr-2">{idx + 1}.</span>
                                      {artist.artist}
                                    </span>
                                    <span className="text-secondary font-mono text-[11px] shrink-0 ml-2">
                                      {artist.playCount} {t('settings.statsPlaysUnit')}
                                    </span>
                                  </div>
                                  <div className="h-1.5 w-full bg-border rounded-full overflow-hidden">
                                    <div
                                      className="h-full bg-accent rounded-full transition-all"
                                      style={{ width: `${pct}%` }}
                                    />
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Top Tracks */}
                      {topTracks.length > 0 && (
                        <div className="rounded-xl bg-surface-hover/50 p-5 ring-1 ring-border space-y-3">
                          <h4 className="text-xs font-semibold uppercase tracking-wider text-tertiary">
                            {t('settings.statsTopTracks')}
                          </h4>
                          <div className="divide-y divide-border/40">
                            {topTracks.map((trk, idx) => (
                              <div
                                key={trk.id}
                                className="flex items-center justify-between py-2 text-xs first:pt-0 last:pb-0"
                              >
                                <div className="truncate mr-2">
                                  <span className="font-mono text-tertiary mr-2">{idx + 1}.</span>
                                  <span className="text-primary font-medium">{trk.title}</span>
                                  {trk.artist && (
                                    <span className="text-secondary ml-1.5">— {trk.artist}</span>
                                  )}
                                </div>
                                <span className="text-secondary font-mono text-[11px] shrink-0">
                                  {trk.playCount} {t('settings.statsPlaysUnit')}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Recent Plays */}
                      {stats.recentPlays.length > 0 && (
                        <div className="rounded-xl bg-surface-hover/50 p-5 ring-1 ring-border space-y-3">
                          <h4 className="text-xs font-semibold uppercase tracking-wider text-tertiary">
                            {t('settings.statsRecentPlays')}
                          </h4>
                          <div className="divide-y divide-border/40">
                            {stats.recentPlays.slice(0, 5).map((rp, idx) => (
                              <div
                                key={`${rp.id}-${rp.playedAt}-${idx}`}
                                className="flex items-center justify-between py-2 text-xs first:pt-0 last:pb-0"
                              >
                                <div className="truncate mr-2">
                                  <span className="text-primary font-medium">{rp.title}</span>
                                  {rp.artist && (
                                    <span className="text-secondary ml-1.5">— {rp.artist}</span>
                                  )}
                                </div>
                                <span className="text-tertiary font-mono text-[10px] shrink-0">
                                  {new Date(rp.playedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Clear Stats */}
                      <div className="pt-2 flex justify-end">
                        <button
                          type="button"
                          onClick={() => {
                            if (window.confirm(t('settings.statsClearConfirm'))) {
                              clearStats();
                            }
                          }}
                          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-status-offline hover:bg-status-offline/10 transition"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          <span>{t('settings.statsClear')}</span>
                        </button>
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          )}

          {activeTab === 'backup' && (
            <div className="space-y-6 animate-in fade-in duration-150">
              {/* Overview / Current data status */}
              <div className="rounded-xl bg-surface-hover/50 p-5 ring-1 ring-border space-y-3">
                <h3 className="text-sm font-semibold text-primary">
                  {t('settings.backupTitle')}
                </h3>
                <p className="text-xs text-secondary leading-relaxed">
                  {t('settings.backupDesc')}
                </p>
                <div className="pt-2 border-t border-border/40 flex flex-wrap items-center gap-4 text-xs text-tertiary font-mono">
                  <span>
                    {favorites.length} {t('common.favorites').toLowerCase()}
                  </span>
                  <span>•</span>
                  <span>
                    {playlists.length} {t('playlists.title').toLowerCase()}
                  </span>
                  <span>•</span>
                  <span>
                    {playlists.reduce((sum, p) => sum + p.tracks.length, 0)}{' '}
                    {t('playlists.trackCount', { n: '' }).trim()}
                  </span>
                  {stats && (
                    <>
                      <span>•</span>
                      <span>
                        {stats.totalPlayCount} {t('settings.statsPlaysUnit')}
                      </span>
                    </>
                  )}
                </div>
              </div>

              {/* Export Section */}
              <div className="rounded-xl bg-surface-hover/50 p-5 ring-1 ring-border flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-primary">
                    {t('settings.exportButton')}
                  </h4>
                  <p className="text-xs text-secondary">
                    {t('settings.backupDesc')}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setIsExporting(true);
                    try {
                      exportUserData({ favorites, playlists, stats });
                      setBackupFeedback({
                        success: true,
                        message: 'Backup downloaded successfully.',
                      });
                    } catch (e) {
                      setBackupFeedback({
                        success: false,
                        message: String(e),
                      });
                    } finally {
                      setIsExporting(false);
                    }
                  }}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-xs font-semibold text-background hover:bg-accent-hover transition shadow-sm shrink-0"
                >
                  <Download className="h-4 w-4" />
                  <span>{isExporting ? t('settings.exporting') : t('settings.exportButton')}</span>
                </button>
              </div>

              {/* Import Section */}
              <div className="rounded-xl bg-surface-hover/50 p-5 ring-1 ring-border space-y-4">
                <div className="space-y-1">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-primary">
                    {t('settings.importTitle')}
                  </h4>
                  <p className="text-xs text-secondary leading-relaxed">
                    {t('settings.importDesc')}
                  </p>
                </div>

                {/* Import Mode Selection */}
                <div className="space-y-2 pt-2 border-t border-border/40">
                  <p className="text-xs font-medium text-secondary">{t('settings.importModeLabel')}</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <label
                      className={`flex flex-col p-3 rounded-xl ring-1 cursor-pointer transition ${
                        importMode === 'merge'
                          ? 'bg-accent/10 ring-accent'
                          : 'bg-surface ring-border hover:bg-surface-hover'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="importMode"
                          value="merge"
                          checked={importMode === 'merge'}
                          onChange={() => setImportMode('merge')}
                          className="accent-accent"
                        />
                        <span className="text-xs font-medium text-primary">
                          {t('settings.importModeMerge')}
                        </span>
                      </div>
                      <span className="mt-1 text-[11px] text-tertiary pl-5">
                        {t('settings.importModeMergeHint')}
                      </span>
                    </label>

                    <label
                      className={`flex flex-col p-3 rounded-xl ring-1 cursor-pointer transition ${
                        importMode === 'replace'
                          ? 'bg-accent/10 ring-accent'
                          : 'bg-surface ring-border hover:bg-surface-hover'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="importMode"
                          value="replace"
                          checked={importMode === 'replace'}
                          onChange={() => setImportMode('replace')}
                          className="accent-accent"
                        />
                        <span className="text-xs font-medium text-primary">
                          {t('settings.importModeReplace')}
                        </span>
                      </div>
                      <span className="mt-1 text-[11px] text-tertiary pl-5">
                        {t('settings.importModeReplaceHint')}
                      </span>
                    </label>
                  </div>
                </div>

                <div className="pt-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".json,application/json"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onload = (event) => {
                        const content = event.target?.result as string;
                        const res = parseUserDataFile(content);
                        if (!res.success || !res.data) {
                          setBackupFeedback({
                            success: false,
                            message: t('settings.importInvalidFile'),
                          });
                          return;
                        }

                        if (res.data.favorites) {
                          importFavorites(res.data.favorites, importMode);
                        }
                        if (res.data.playlists) {
                          importPlaylists(res.data.playlists, importMode);
                        }
                        if (res.data.stats) {
                          importStats(res.data.stats, importMode);
                        }
                        if (res.data.categories) {
                          try {
                            localStorage.setItem(
                              'kura-categories',
                              JSON.stringify(res.data.categories),
                            );
                          } catch {}
                        }

                        setBackupFeedback({
                          success: true,
                          message: t('settings.importSuccess', {
                            fav: res.data.favorites.length,
                            pl: res.data.playlists.length,
                          }),
                        });
                        if (fileInputRef.current) {
                          fileInputRef.current.value = '';
                        }
                      };
                      reader.readAsText(file);
                    }}
                  />

                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center gap-2 rounded-xl bg-surface hover:bg-surface-hover px-4 py-2.5 text-xs font-medium text-primary ring-1 ring-border transition"
                  >
                    <Upload className="h-4 w-4 text-accent" />
                    <span>{t('settings.importFileButton')}</span>
                  </button>
                </div>

                {backupFeedback && (
                  <div
                    className={`rounded-xl p-3 text-xs flex items-center justify-between gap-2 ${
                      backupFeedback.success
                        ? 'bg-status-online/15 text-status-online ring-1 ring-status-online/30'
                        : 'bg-status-offline/15 text-status-offline ring-1 ring-status-offline/30'
                    }`}
                  >
                    <span>{backupFeedback.message}</span>
                    <button
                      type="button"
                      onClick={() => setBackupFeedback(null)}
                      className="p-1 hover:opacity-75"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {error && <p className="text-xs text-status-offline">{error}</p>}

        <div className="mt-4 pt-4 border-t border-border flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-tertiary text-[11px] font-mono select-none">
            <span className="font-serif text-accent/80 text-[13px]">蔵</span>
            <span>{t('common.brand')}</span>
            <span className="text-border">·</span>
            <span>{t('common.brandFull')}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-surface-hover px-5 py-2.5 text-xs font-medium text-primary hover:bg-border transition"
          >
            {t('common.ok')}
          </button>
        </div>
      </div>
    </div>
  );
}

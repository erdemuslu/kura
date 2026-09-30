import { useEffect, useState } from 'react';
import {
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  Film,
  Loader2,
  Monitor,
  Music,
  PlaySquare,
  Radio,
  RefreshCw,
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

type SettingsTab = 'appearance' | 'players' | 'remote' | 'tmdb' | 'lastfm';

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
  const [activeTab, setActiveTab] = useState<SettingsTab>('appearance');
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
      setLastFmFeedback(
        'Tarayıcınızda onay sayfası açıldı. Hesabınızla onay verdikten sonra "Yetkilendirmeyi Tamamla" butonuna tıklayın.',
      );
    } catch (e: any) {
      setLastFmFeedback(e?.message || 'Yetkilendirme başlatılamadı');
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
      setLastFmFeedback(`Harika! @${username} hesabı başarıyla bağlandı.`);
      const updated = await getLastFmStatus();
      setLastFmStatus(updated);
    } catch (e: any) {
      setLastFmFeedback(
        e?.message ||
          'Yetkilendirme henüz tamamlanmadı. Lütfen tarayıcıda izin verdiğinizden emin olun.',
      );
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
      setLastFmFeedback('Last.fm bağlantısı kesildi.');
      const updated = await getLastFmStatus();
      setLastFmStatus(updated);
    } catch (e: any) {
      setLastFmFeedback(e?.message || 'Bağlantı kesilemedi');
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
      setTmdbFeedback(saved ? 'TMDB API anahtarı başarıyla kaydedildi' : 'Anahtar temizlendi');
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
      setError('Token kopyalanamadı');
    }
  };

  const TABS = [
    { id: 'appearance' as const, label: 'Arayüz & Ölçek', icon: Monitor },
    { id: 'players' as const, label: 'Oynatıcılar', icon: PlaySquare },
    { id: 'remote' as const, label: 'Uzaktan Kumanda', icon: Radio },
    { id: 'tmdb' as const, label: 'Afişler & TMDB', icon: Film },
    { id: 'lastfm' as const, label: 'Last.fm Scrobbler', icon: Music },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-2xl bg-surface p-7 sm:p-8 shadow-2xl ring-1 ring-border relative animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Kapat Butonu */}
        <button
          type="button"
          onClick={onClose}
          className="absolute right-6 top-6 rounded-lg p-2 text-tertiary hover:text-primary hover:bg-surface-hover transition"
          title="Kapat (Esc)"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Modal Başlığı */}
        <div className="flex items-center gap-3.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/15 text-accent ring-1 ring-accent/30 shadow-sm shrink-0">
            <span className="text-[15px] font-serif font-medium leading-none select-none">
              蔵
            </span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-serif text-2xl font-normal text-primary tracking-tight">
                Ayarlar
              </h2>
              <span className="rounded-md bg-accent/10 px-2 py-0.5 font-mono text-[10px] text-accent tracking-wider uppercase font-medium">
                Kura · Medya Arşivi
              </span>
            </div>
            <p className="mt-0.5 text-xs text-secondary">
              Arayüz görünümü, varsayılan oynatıcılar ve servis tercihleri.
            </p>
          </div>
        </div>

        {/* Sekme Navigasyonu */}
        <div className="flex flex-wrap border-b border-border mt-6 gap-2 sm:gap-3">
          {TABS.map((t) => {
            const Icon = t.icon;
            const isActive = activeTab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveTab(t.id)}
                className={`flex items-center gap-2 px-3.5 py-2.5 text-xs font-medium border-b-2 transition -mb-px ${
                  isActive
                    ? 'border-accent text-primary font-semibold'
                    : 'border-transparent text-tertiary hover:text-secondary hover:border-border'
                }`}
              >
                <Icon className={`h-4 w-4 ${isActive ? 'text-accent' : 'text-tertiary'}`} />
                <span>{t.label}</span>
              </button>
            );
          })}
        </div>

        {/* Sekme İçerik Alanı */}
        <div className="flex-1 overflow-y-auto py-6 space-y-6 pr-1">
          {/* 1. SEKME: ARAYÜZ & EKRAN ÖLÇEĞİ */}
          {activeTab === 'appearance' && (
            <div className="space-y-6 animate-in fade-in duration-150">
              <div className="rounded-xl bg-surface-hover/50 p-5 ring-1 ring-border space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-primary">
                      Ekran Ölçeklendirme
                    </h3>
                    <p className="text-xs text-secondary mt-0.5">
                      4K ve yüksek çözünürlüklü ekranlar için tüm arayüzü orantılı büyütün.
                    </p>
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
                        Sıfırla
                      </button>
                    )}
                  </div>
                </div>

                {/* Hızlı Ön Ayarlar */}
                <div className="flex flex-wrap gap-2 pt-1">
                  {[
                    { label: '%85 Kompakt', val: 85 },
                    { label: '%100 Standart', val: 100 },
                    { label: '%115 Orta', val: 115 },
                    { label: '%125 (4K Önerilen)', val: 125 },
                    { label: '%140 Büyük / TV', val: 140 },
                  ].map((preset) => (
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

                {/* İnce Ayar Kaydırıcı & Stepper */}
                <div className="flex items-center gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => applyScale(scale - 5)}
                    disabled={scale <= 75}
                    className="flex h-9 w-9 items-center justify-center rounded-xl bg-surface text-secondary hover:text-primary hover:bg-surface-active ring-1 ring-border transition disabled:opacity-30"
                    title="5% Küçült"
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
                    title="5% Büyüt"
                  >
                    <ZoomIn className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="rounded-xl border border-border/60 bg-surface-hover/30 p-4 text-xs text-tertiary space-y-1">
                <p className="font-medium text-secondary">İpucu:</p>
                <p>
                  Ölçek değiştirildiğinde kart görselleri, yazı boyutları, arama çubuğu ve oynatıcı kontrolleri aynı kusursuz oranlarla ölçeklenir ve tarayıcı/sistem yeniden açıldığında korunur.
                </p>
              </div>
            </div>
          )}

          {/* 2. SEKME: OYNATICILAR (GENİŞ PADDINGLİ DROPDOWN'LAR) */}
          {activeTab === 'players' && (
            <div className="space-y-5 animate-in fade-in duration-150">
              {/* Müzik Oynatıcısı */}
              <div className="rounded-xl bg-surface-hover/50 p-5 ring-1 ring-border space-y-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/15 text-accent shrink-0">
                    <Music className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-primary">
                      Varsayılan Müzik Oynatıcısı
                    </h3>
                    <p className="text-xs text-secondary mt-0.5">
                      Albüm ve parçalar çalınırken kullanılacak ses motoru.
                    </p>
                  </div>
                </div>

                {/* Geniş ve Rahat Dropdown */}
                <div className="relative pt-1">
                  <select
                    value={audioPlayer}
                    onChange={(e) => handleAudioChange(e.target.value)}
                    className="h-12 w-full appearance-none rounded-xl bg-surface px-4 py-3 pr-11 text-sm font-medium text-primary ring-1 ring-border transition cursor-pointer hover:bg-surface-active focus:outline-none focus:ring-2 focus:ring-accent"
                  >
                    {AUDIO_PLAYERS.map((p) => (
                      <option key={p.id} value={p.id} className="bg-surface py-2 text-primary">
                        {p.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-tertiary" />
                </div>

                <p className="text-[11px] text-tertiary pt-1">
                  {audioPlayer === 'in_app'
                    ? '✓ Gömülü oynatıcı etkindir: alt çubuk, çalma sırası ve şarkı içi sarma aktiftir.'
                    : `✓ Harici uygulama modu: Şarkılar doğrudan ${audioPlayer} uygulamasına teslim edilir.`}
                </p>
              </div>

              {/* Video Oynatıcısı */}
              <div className="rounded-xl bg-surface-hover/50 p-5 ring-1 ring-border space-y-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-surface text-secondary shrink-0 ring-1 ring-border">
                    <Film className="h-4 w-4 text-accent" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-primary">
                      Varsayılan Video Oynatıcısı
                    </h3>
                    <p className="text-xs text-secondary mt-0.5">
                      Film ve dizi bölümlerini başlatmak için harici uygulama.
                    </p>
                  </div>
                </div>

                {/* Geniş ve Rahat Dropdown */}
                <div className="relative pt-1">
                  <select
                    value={videoPlayer}
                    onChange={(e) => handleVideoChange(e.target.value)}
                    className="h-12 w-full appearance-none rounded-xl bg-surface px-4 py-3 pr-11 text-sm font-medium text-primary ring-1 ring-border transition cursor-pointer hover:bg-surface-active focus:outline-none focus:ring-2 focus:ring-accent"
                  >
                    {VIDEO_PLAYERS.map((p) => (
                      <option key={p.id} value={p.id} className="bg-surface py-2 text-primary">
                        {p.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-tertiary" />
                </div>

                <p className="text-[11px] text-tertiary pt-1">
                  {videoPlayer === 'in_app'
                    ? '✓ Kura gömülü video oynatıcı etkindir: MP4 ve MKV dosyaları transmux ile anında uygulama içinde oynatılır.'
                    : `✓ Harici uygulama modu: Videolar doğrudan ${videoPlayer} uygulamasına teslim edilir.`}
                </p>
              </div>
            </div>
          )}

          {/* 3. SEKME: UZAKTAN KUMANDA */}
          {activeTab === 'remote' && (
            <div className="space-y-5 animate-in fade-in duration-150">
              {remote ? (
                <>
                  <div className="rounded-xl bg-surface-hover/50 p-5 ring-1 ring-border space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-sm font-semibold text-primary">
                          Erişim Token Doğrulaması
                        </h3>
                        <p className="text-xs text-secondary mt-0.5">
                          Yerel ağdaki diğer cihazlardan gelen oynatma ve tarama istekleri için güvenlik doğrulaması.
                        </p>
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
                        <p className="text-[11px] text-tertiary">Aktif Erişim Token’ı</p>
                        <code className="font-mono text-xs text-accent mt-0.5 block truncate">
                          {remote.auth_enabled ? remote.token : '— Doğrulama Devre Dışı'}
                        </code>
                      </div>
                      {remote.auth_enabled && (
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={copyToken}
                            className="flex items-center gap-1 rounded-lg bg-surface-hover px-2.5 py-1.5 text-xs text-secondary hover:text-primary ring-1 ring-border transition"
                            title="Kopyala"
                          >
                            {copied ? <Check className="h-3.5 w-3.5 text-accent" /> : <Copy className="h-3.5 w-3.5" />}
                            <span>{copied ? 'Kopyalandı' : 'Kopyala'}</span>
                          </button>
                          <button
                            type="button"
                            onClick={regenerate}
                            disabled={busy}
                            className="flex items-center gap-1 rounded-lg bg-surface-hover px-2.5 py-1.5 text-xs text-secondary hover:text-primary ring-1 ring-border transition"
                            title="Yeni Token Üret"
                          >
                            <RefreshCw className="h-3.5 w-3.5" />
                            <span>Yenile</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="rounded-xl border border-border/60 bg-surface-hover/30 p-4 text-xs text-tertiary space-y-1">
                    <p className="font-medium text-secondary">Bağlantı Bilgisi:</p>
                    <p>
                      Telefon veya tabletinizden Kura'ya bağlanmak için üst bardaki yayın simgesine tıklayarak QR ve yerel ağ adresini alabilirsiniz.
                    </p>
                  </div>
                </>
              ) : (
                <p className="py-8 text-center text-xs text-tertiary">
                  Uzaktan kumanda bilgisi yalnızca masaüstü uygulamasında görüntülenebilir.
                </p>
              )}
            </div>
          )}

          {/* 4. SEKME: AFİŞLER & TMDB */}
          {activeTab === 'tmdb' && (
            <div className="space-y-5 animate-in fade-in duration-150">
              <div className="rounded-xl bg-surface-hover/50 p-5 ring-1 ring-border space-y-3.5">
                <div>
                  <h3 className="text-sm font-semibold text-primary">
                    TheMovieDB (TMDB) API Anahtarı
                  </h3>
                  <p className="text-xs text-secondary mt-1 leading-relaxed">
                    Film ve dizi afişleri ile özet, puan ve tür bilgilerini otomatik çekmek için ücretsiz TMDB v3 API anahtarınızı tanımlayabilirsiniz.
                  </p>
                </div>

                <div className="flex flex-col sm:flex-row gap-2.5 pt-1">
                  <input
                    type="text"
                    value={tmdbKeyInput}
                    onChange={(e) => setTmdbKeyInput(e.target.value)}
                    placeholder={
                      tmdbSaved ? `Kayıtlı: …${tmdbSaved.slice(-4)}` : 'API Key (v3)'
                    }
                    className="h-11 flex-1 rounded-xl bg-surface px-4 py-2.5 text-xs font-mono text-primary ring-1 ring-border placeholder:text-tertiary focus:outline-none focus:ring-2 focus:ring-accent"
                  />
                  <button
                    type="button"
                    disabled={busy || !tmdbKeyInput.trim()}
                    onClick={saveTmdbKey}
                    className="h-11 rounded-xl bg-accent px-5 py-2.5 text-xs font-semibold text-background transition hover:bg-accent-hover disabled:opacity-50"
                  >
                    Kaydet
                  </button>
                </div>

                {tmdbFeedback && (
                  <p className="text-xs text-accent font-medium">{tmdbFeedback}</p>
                )}
              </div>

              <div className="rounded-xl border border-border/60 bg-surface-hover/30 p-4 text-xs text-tertiary space-y-1">
                <p className="font-medium text-secondary">Nasıl API Anahtarı Alınır?</p>
                <p className="leading-relaxed">
                  <a
                    href="https://www.themoviedb.org/signup"
                    target="_blank"
                    rel="noreferrer"
                    className="text-accent underline underline-offset-2 hover:opacity-80"
                  >
                    themoviedb.org
                  </a>{' '}
                  üzerinden ücretsiz hesap açıp Ayarlar → API sekmesinden anında bir v3 anahtarı oluşturabilirsiniz. Anahtar girilmediğinde yerel klasör posterleri ve iTunes zinciri fallback olarak çalışır.
                </p>
              </div>
            </div>
          )}

          {/* 5. SEKME: LAST.FM SCROBBLER */}
          {activeTab === 'lastfm' && (
            <div className="space-y-6 animate-in fade-in duration-150">
              <div className="rounded-xl bg-surface-hover/50 p-5 ring-1 ring-border space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-primary">
                        Last.fm Scrobbler & Now Playing
                      </h3>
                      {lastFmStatus?.connected ? (
                        <span className="flex items-center gap-1.5 rounded-full bg-status-online/15 px-2.5 py-0.5 text-[11px] font-medium text-status-online ring-1 ring-status-online/30">
                          <span className="h-1.5 w-1.5 rounded-full bg-status-online" />
                          @{lastFmStatus.username}
                        </span>
                      ) : (
                        <span className="rounded-full bg-surface px-2.5 py-0.5 text-[11px] font-medium text-tertiary ring-1 ring-border">
                          Bağlı Değil
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-secondary leading-relaxed">
                      Kura'da dinlediğiniz şarkıları anında Last.fm profilinize yansıtın ve dinleme istatistiklerinizi tutun.
                    </p>
                  </div>
                </div>

                {!lastFmStatus?.has_api_keys ? (
                  <div className="rounded-lg bg-surface p-4 ring-1 ring-border text-xs text-status-offline space-y-1.5">
                    <p className="font-semibold">Last.fm API Anahtarları Bulunamadı</p>
                    <p className="text-secondary leading-relaxed">
                      Proje kök dizinindeki <code className="font-mono text-accent">.env</code> dosyasında <code className="font-mono">LASTFM_API_KEY</code> ve <code className="font-mono">LASTFM_SHARED_SECRET</code> anahtarlarının tanımlı olduğundan emin olun.
                    </p>
                  </div>
                ) : lastFmStatus.connected ? (
                  <div className="space-y-4 pt-2">
                    <div className="flex items-center justify-between rounded-lg bg-surface p-4 ring-1 ring-border">
                      <div className="space-y-0.5">
                        <div className="text-xs font-medium text-primary">
                          Dinlemeleri Scrobble Et
                        </div>
                        <div className="text-[11px] text-tertiary">
                          Şarkının en az %50'si veya 4 dakikası dinlendiğinde profilinize eklenir
                        </div>
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
                        {lastFmLoading ? 'İşleniyor…' : 'Bağlantıyı Kes'}
                      </button>
                    </div>
                  </div>
                ) : lastFmPendingToken ? (
                  <div className="space-y-4 pt-2">
                    <div className="rounded-lg bg-surface p-4 ring-1 ring-border text-xs space-y-3">
                      <p className="text-secondary leading-relaxed">
                        Tarayıcınızda Last.fm yetkilendirme sayfası açıldı. Lütfen hesabınızla giriş yapıp <strong>"Yes, allow access" (İzin Ver)</strong> butonuna tıklayın.
                      </p>
                      {lastFmAuthUrl && (
                        <a
                          href={lastFmAuthUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 text-accent hover:underline text-xs"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          Sayfa açılmadıysa buraya tıklayın
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
                        Yetkilendirmeyi Tamamla
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
                        İptal
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4 pt-2">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-lg bg-surface p-4 ring-1 ring-border">
                      <div className="space-y-1">
                        <div className="text-xs font-medium text-primary">
                          Hesabınızı Bağlayın
                        </div>
                        <div className="text-[11px] text-tertiary">
                          Last.fm hesabınızla tek tıkla oturum açın
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={lastFmLoading}
                        onClick={handleStartLastFm}
                        className="inline-flex items-center justify-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-xs font-semibold text-background hover:bg-accent-hover transition disabled:opacity-50 shadow-sm shrink-0"
                      >
                        {lastFmLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                        Last.fm'e Bağlan
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
                <p className="font-medium text-secondary">Last.fm Scrobble Nasıl Çalışır?</p>
                <p className="leading-relaxed">
                  • <strong>Now Playing:</strong> Şarkı çalmaya başladığında profilinizde <em>"Şu an dinleniyor"</em> olarak görünür.
                </p>
                <p className="leading-relaxed">
                  • <strong>Scrobble:</strong> Şarkının en az %50'si veya 4 dakikası dinlendiğinde otomatik olarak dinleme geçmişinize kaydedilir.
                </p>
              </div>
            </div>
          )}
        </div>

        {error && <p className="text-xs text-status-offline">{error}</p>}

        {/* Modal Alt Bar */}
        <div className="mt-4 pt-4 border-t border-border flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-tertiary text-[11px] font-mono select-none">
            <span className="font-serif text-accent/80 text-[13px]">蔵</span>
            <span>Kura</span>
            <span className="text-border">·</span>
            <span>Kişisel Medya Arşivi</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-surface-hover px-5 py-2.5 text-xs font-medium text-primary hover:bg-border transition"
          >
            Tamam
          </button>
        </div>
      </div>
    </div>
  );
}

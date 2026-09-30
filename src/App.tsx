import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import {
  HardDrive,
  Menu,
  Plus,
  Radio,
  Search,
  Settings,
  X,
} from 'lucide-react';
import AudioPlayerBar from './components/AudioPlayerBar';
import CreateCategoryModal from './components/CreateCategoryModal';
import DisksPopover from './components/DisksPopover';
import ManageSourcesModal, { type CategoryInfo } from './components/ManageSourcesModal';
import MoviesView from './components/MoviesView';
import MusicView from './components/MusicView';
import RemotePopover from './components/RemotePopover';
import ScanModal from './components/ScanModal';
import SeriesView from './components/SeriesView';
import SettingsPanel from './components/SettingsPanel';
import VideoPlayerModal, { type VideoPlayerItem } from './components/VideoPlayerModal';
import {
  ApiAuthError,
  getPlayerSetting,
  getRemoteInfo,
  isRunningInTauri,
  removeSourcePath,
  setRemoteToken,
  type RemoteInfo,
} from './api/client';
import { AudioPlayerProvider, useAudioPlayer } from './context/AudioPlayerContext';
import { resetScrollTop } from './lib/scroll';
import { useDisks, useScan } from './hooks/useMedia';

const DEFAULT_CATEGORIES: CategoryInfo[] = [
  {
    id: 'movie',
    label: 'Film',
    mediaType: 'movie',
    paths: ["/Volumes/Erdem'sDisk/Sinema"],
  },
  {
    id: 'series',
    label: 'Dizi',
    mediaType: 'series',
    paths: ["/Volumes/Erdem'sDisk/Dizi"],
  },
  {
    id: 'music',
    label: 'Müzik',
    mediaType: 'music',
    paths: ["/Volumes/Erdem'sDisk/Müzik"],
  },
];

interface ScanProgress {
  scanned_files: number;
  indexed: number;
}

function MainLayout() {
  const [categories, setCategories] = useState<CategoryInfo[]>(() => {
    try {
      const saved = localStorage.getItem('kura-categories');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return DEFAULT_CATEGORIES;
  });

  const [activeCatId, setActiveCatId] = useState<string>(() => {
    return categories[0]?.id ?? 'movie';
  });

  const activeCategory =
    categories.find((c) => c.id === activeCatId) || categories[0] || DEFAULT_CATEGORIES[0];

  const [query, setQuery] = useState('');
  const [audioPlayer, setAudioPlayer] = useState('in_app');
  const [videoPlayer, setVideoPlayer] = useState('in_app');
  const [activeVideo, setActiveVideo] = useState<VideoPlayerItem | null>(null);
  const [playingPath, setPlayingPath] = useState<string | null>(null);
  const [remote, setRemote] = useState<RemoteInfo | null>(null);
  const [tokenInput, setTokenInput] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [showDisksPopover, setShowDisksPopover] = useState(false);
  const [showRemotePopover, setShowRemotePopover] = useState(false);
  const [showScanModal, setShowScanModal] = useState(false);
  const [showManageSources, setShowManageSources] = useState(false);
  const [showCreateCategory, setShowCreateCategory] = useState(false);
  const [scanInitialPath, setScanInitialPath] = useState('');
  const [scanTargetCat, setScanTargetCat] = useState<CategoryInfo | null>(null);
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [scanToast, setScanToast] = useState<string | null>(null);
  const [showMobileSearch, setShowMobileSearch] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const disksBtnRef = useRef<HTMLButtonElement>(null);
  const remoteBtnRef = useRef<HTMLButtonElement>(null);

  // Kategorileri localStorage'a kaydet
  useEffect(() => {
    try {
      localStorage.setItem('kura-categories', JSON.stringify(categories));
    } catch {}
  }, [categories]);

  // Sayfa / menü geçişlerinde scroll pozisyonunu sıfırla
  useEffect(() => {
    resetScrollTop();
  }, [activeCatId]);

  const {
    currentTrack,
    isPlaying,
    isQueueOpen,
    togglePlay,
    pause,
    seek,
    currentTime,
    duration,
    setVolume,
    volume,
    toggleMute,
    nextTrack,
    prevTrack,
    setIsQueueOpen,
  } = useAudioPlayer();

  const disks = useDisks();
  const scan = useScan();
  const queryClient = useQueryClient();

  // Uzaktan kumanda bilgisi yalnızca masaüstünde (IPC) çekilir.
  useEffect(() => {
    getRemoteInfo()
      .then((info) => setRemote(info))
      .catch(() => setRemote(null));
  }, []);

  // Oynatıcı ayarlarını ve arayüz ölçeğini yükle
  useEffect(() => {
    getPlayerSetting('audio')
      .then((p) => setAudioPlayer(p))
      .catch(() => {});
    getPlayerSetting('video')
      .then((p) => setVideoPlayer(p))
      .catch(() => {});

    const savedScale = localStorage.getItem('lmh-ui-scale');
    if (savedScale) {
      const s = Number(savedScale);
      if (!isNaN(s) && s >= 60 && s <= 200) {
        document.documentElement.style.zoom = String(s / 100);
      }
    }
  }, []);

  // Masaüstünde tarama ilerleme event'ini dinle
  useEffect(() => {
    if (!isRunningInTauri()) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    import('@tauri-apps/api/event')
      .then(({ listen }) =>
        listen<ScanProgress>('scan-progress', (e) => {
          setScanProgress(e.payload);
        }),
      )
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  // Tarama tamamlandığında toast bildirimi göster
  useEffect(() => {
    if (scan.data) {
      setScanToast(
        `${scan.data.indexed} dosya indekslendi (${scan.data.scanned_files} tarandı)`
      );
      const timer = setTimeout(() => setScanToast(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [scan.data]);

  // Global Klavye Kısayolları (Space, Oklar, M, Q, Cmd+K)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable;

      // Cmd+K veya Ctrl+K ile aramaya odaklan
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }

      if (e.key === 'Escape') {
        setShowSettings(false);
        setShowDisksPopover(false);
        setShowRemotePopover(false);
        setShowScanModal(false);
        searchInputRef.current?.blur();
        return;
      }

      // Video oynatıcı açıkken veya input içindeyken diğer kısayollar çalışmasın
      if (activeVideo || isInput) return;

      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'ArrowLeft') {
        if (e.shiftKey) {
          prevTrack();
        } else {
          e.preventDefault();
          seek(Math.max(0, currentTime - 5));
        }
      } else if (e.key === 'ArrowRight') {
        if (e.shiftKey) {
          nextTrack();
        } else {
          e.preventDefault();
          seek(Math.min(duration || 0, currentTime + 5));
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setVolume(Math.min(1, volume + 0.05));
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setVolume(Math.max(0, volume - 0.05));
      } else if (e.key.toLowerCase() === 'm') {
        toggleMute();
      } else if (e.key.toLowerCase() === 'q') {
        setIsQueueOpen(!isQueueOpen);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    activeVideo,
    togglePlay,
    seek,
    currentTime,
    duration,
    volume,
    setVolume,
    toggleMute,
    prevTrack,
    nextTrack,
    isQueueOpen,
    setIsQueueOpen,
  ]);

  const handleOpenScanForCategory = (cat: CategoryInfo, initialPath?: string) => {
    setScanTargetCat(cat);
    setScanInitialPath(initialPath || '');
    setShowScanModal(true);
  };

  // Video oynatılırken müzik çalıyorsa duraklat
  const handleMediaPlayed = (path: string | null) => {
    setPlayingPath(path);
    if (path && isPlaying && activeCategory.mediaType !== 'music') {
      pause();
    }
  };

  const closeVideo = () => {
    setActiveVideo(null);
    setPlayingPath(null);
  };

  const handlePlayVideo = (item: VideoPlayerItem) => {
    setActiveVideo(item);
    setPlayingPath(item.filePath);
    if (isPlaying) {
      pause();
    }
  };

  /** Müzik başlarken açık videoyu kapat (exclusive playback). */
  const handleMusicPlayed = (path: string | null) => {
    if (activeVideo) {
      setActiveVideo(null);
    }
    setPlayingPath(path);
  };

  const authError = disks.error instanceof ApiAuthError;
  const isOnlineDiskAvailable = disks.data?.some((d) => d.online) ?? false;

  return (
    <div className="min-h-screen bg-background text-primary selection:bg-accent/20 selection:text-accent">
      {/* 1. Üst Bar — Sabit & Blur (Masaüstü 56px, Mobilde ferah ve kompakt) */}
      <header className="sticky top-0 z-30 border-b border-border bg-surface/85 backdrop-blur-xl transition-colors">
        <div className="mx-auto flex h-14 max-w-[1600px] items-center justify-between px-4 sm:px-8 lg:px-12">
          {/* Sol: Logo + (Masaüstü) Sekmeler */}
          <div className="flex items-center gap-4 md:gap-8">
            {/* Marka: Kura (蔵) + Mühür + Alt Başlık */}
            <div
              className="flex items-center gap-2.5 select-none cursor-default group/brand"
              title="Kura (蔵) — Kişisel Medya Arşivi"
            >
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-accent/15 text-accent ring-1 ring-accent/30 transition-transform group-hover/brand:scale-105 shadow-sm">
                <span className="text-[12px] font-serif font-medium leading-none select-none">
                  蔵
                </span>
              </div>
              <div className="flex flex-col justify-center">
                <div className="flex items-center gap-1.5 leading-none">
                  <span className="font-serif text-[17px] font-normal tracking-tight text-primary">
                    Kura
                  </span>
                  <span className="h-1 w-1 rounded-full bg-accent/80" />
                </div>
                <span className="text-[9.5px] font-mono tracking-widest uppercase text-tertiary mt-0.5 hidden sm:inline">
                  Medya Arşivi
                </span>
              </div>
            </div>

            {/* Masaüstü Sekmeler — Yalnızca md: ve üstünde görünür */}
            <nav className="hidden md:flex items-center gap-1 h-14">
              {categories.map((c) => {
                const isActive = activeCategory.id === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setActiveCatId(c.id)}
                    className={`relative flex h-full items-center px-3.5 text-xs font-medium transition-colors ${
                      isActive
                        ? 'text-primary'
                        : 'text-tertiary hover:text-secondary'
                    }`}
                  >
                    {c.label}
                    {isActive && (
                      <span className="absolute bottom-0 left-3 right-3 h-[2px] bg-accent" />
                    )}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => setShowCreateCategory(true)}
                className="flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-medium text-tertiary hover:text-primary hover:bg-surface-hover transition-colors ml-1"
                title="Yeni Menü / Kategori Ekle"
              >
                <Plus className="h-3 w-3" />
                <span>Yeni Menü</span>
              </button>
            </nav>
          </div>

          {/* Masaüstü Sağ: Arama, Diskler, Uzaktan Kumanda, Ayarlar */}
          <div className="hidden md:flex items-center gap-2.5">
            {/* Arama Kutusu (⌘K ile odaklanır, sabit genişlik ve zarif 1px odak halkası) */}
            <div className="relative flex items-center">
              <Search className="absolute left-2.5 h-3.5 w-3.5 text-tertiary pointer-events-none" />
              <input
                ref={searchInputRef}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Ara…"
                className="h-8 w-44 sm:w-52 rounded-lg bg-surface-hover/80 pl-8 pr-11 text-xs text-primary ring-1 ring-border/80 placeholder:text-tertiary focus:outline-none focus:ring-1 focus:ring-accent/70 focus:bg-surface-hover transition-colors duration-150"
              />
              <kbd className="absolute right-2 hidden sm:inline-flex h-4 items-center rounded border border-border/70 px-1 font-mono text-[9px] text-tertiary pointer-events-none">
                ⌘K
              </kbd>
            </div>

            {/* Diskler Popover Butonu */}
            <div className="relative">
              <button
                ref={disksBtnRef}
                type="button"
                onClick={() => {
                  setShowDisksPopover(!showDisksPopover);
                  setShowRemotePopover(false);
                }}
                className={`relative flex h-8 w-8 items-center justify-center rounded-lg text-secondary transition hover:bg-surface-hover hover:text-primary ${
                  showDisksPopover ? 'bg-surface-hover text-primary' : ''
                }`}
                title="Diskler"
              >
                <HardDrive className="h-4 w-4" />
                <span
                  className={`absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full ${
                    isOnlineDiskAvailable ? 'bg-status-online' : 'bg-status-offline'
                  }`}
                />
              </button>
              <DisksPopover
                isOpen={showDisksPopover}
                onClose={() => setShowDisksPopover(false)}
                disks={disks.data ?? []}
                triggerRef={disksBtnRef}
              />
            </div>

            {/* Uzaktan Kumanda Popover Butonu */}
            <div className="relative">
              <button
                ref={remoteBtnRef}
                type="button"
                onClick={() => {
                  setShowRemotePopover(!showRemotePopover);
                  setShowDisksPopover(false);
                }}
                className={`relative flex h-8 w-8 items-center justify-center rounded-lg text-secondary transition hover:bg-surface-hover hover:text-primary ${
                  showRemotePopover ? 'bg-surface-hover text-primary' : ''
                }`}
                title="Uzaktan Kumanda"
              >
                <Radio className="h-4 w-4" />
                {remote && (
                  <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-status-online" />
                )}
              </button>
              <RemotePopover
                isOpen={showRemotePopover}
                onClose={() => setShowRemotePopover(false)}
                remote={remote}
                triggerRef={remoteBtnRef}
              />
            </div>

            {/* Ayarlar Butonu */}
            {isRunningInTauri() && (
              <button
                type="button"
                onClick={() => setShowSettings(true)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-secondary hover:bg-surface-hover hover:text-primary transition"
                title="Ayarlar"
              >
                <Settings className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* Mobil Sağ: Arama İkonu + Mobil Menü Butonu */}
          <div className="flex md:hidden items-center gap-1.5">
            <button
              type="button"
              onClick={() => setShowMobileSearch(!showMobileSearch)}
              className={`relative flex h-9 w-9 items-center justify-center rounded-lg transition ${
                showMobileSearch || query ? 'bg-accent/15 text-accent' : 'text-secondary hover:bg-surface-hover'
              }`}
              title="Arama Yap"
            >
              <Search className="h-4 w-4" />
              {query && (
                <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-accent" />
              )}
            </button>

            <button
              type="button"
              onClick={() => setShowMobileMenu(!showMobileMenu)}
              className={`flex h-9 w-9 items-center justify-center rounded-lg transition ${
                showMobileMenu ? 'bg-surface-hover text-primary' : 'text-secondary hover:bg-surface-hover'
              }`}
              title="Mobil Menü"
            >
              {showMobileMenu ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {/* Mobil Yatay Kategori Çubuğu (Pills) */}
        <div className="md:hidden flex items-center gap-2 overflow-x-auto px-4 py-2 border-t border-border/40 bg-surface/90 scrollbar-none select-none">
          {categories.map((c) => {
            const isActive = activeCategory.id === c.id;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  setActiveCatId(c.id);
                  setShowMobileMenu(false);
                }}
                className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-medium transition-all ${
                  isActive
                    ? 'bg-accent text-background font-semibold shadow-sm'
                    : 'bg-surface-hover/80 text-secondary hover:text-primary ring-1 ring-border/50'
                }`}
              >
                {c.label}
              </button>
            );
          })}
        </div>

        {/* Mobil Arama Kutusu (Açıldığında) */}
        {showMobileSearch && (
          <div className="md:hidden px-4 py-2.5 bg-surface border-t border-border/50 animate-in slide-in-from-top-1 duration-150">
            <div className="relative flex items-center">
              <Search className="absolute left-3 h-3.5 w-3.5 text-tertiary pointer-events-none" />
              <input
                autoFocus
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Film, dizi veya müzik ara…"
                className="h-9 w-full rounded-xl bg-surface-hover pl-9 pr-8 text-xs text-primary ring-1 ring-border/80 placeholder:text-tertiary focus:outline-none focus:ring-1 focus:ring-accent"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="absolute right-2.5 p-1 text-tertiary hover:text-primary"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Mobil Hamburger Açılır Menüsü */}
        {showMobileMenu && (
          <div className="md:hidden px-4 py-3 bg-surface border-t border-border/60 space-y-2 animate-in slide-in-from-top-1 duration-150 shadow-xl">
            <button
              type="button"
              onClick={() => {
                setShowMobileMenu(false);
                setShowCreateCategory(true);
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium text-secondary hover:text-primary hover:bg-surface-hover transition"
            >
              <Plus className="h-4 w-4 text-accent" />
              <span>Yeni Menü / Kategori Ekle</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setShowMobileMenu(false);
                setShowDisksPopover(!showDisksPopover);
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium text-secondary hover:text-primary hover:bg-surface-hover transition"
            >
              <HardDrive className="h-4 w-4 text-accent" />
              <span className="flex-1 text-left">Diskler & Depolama</span>
              <span
                className={`h-2 w-2 rounded-full ${
                  isOnlineDiskAvailable ? 'bg-status-online' : 'bg-status-offline'
                }`}
              />
            </button>
            <button
              type="button"
              onClick={() => {
                setShowMobileMenu(false);
                setShowRemotePopover(!showRemotePopover);
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium text-secondary hover:text-primary hover:bg-surface-hover transition"
            >
              <Radio className="h-4 w-4 text-accent" />
              <span className="flex-1 text-left">Uzaktan Kumanda Bilgisi</span>
              {remote && (
                <span className="h-2 w-2 rounded-full bg-status-online" />
              )}
            </button>
            {isRunningInTauri() && (
              <button
                type="button"
                onClick={() => {
                  setShowMobileMenu(false);
                  setShowSettings(true);
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium text-secondary hover:text-primary hover:bg-surface-hover transition"
              >
                <Settings className="h-4 w-4 text-accent" />
                <span>Ayarlar</span>
              </button>
            )}
          </div>
        )}

        {/* Tarama Sürerken İnce İlerleme Çizgisi */}
        {scan.isPending && (
          <div
            className="absolute bottom-0 left-0 right-0 h-[2px] overflow-hidden bg-surface-hover"
            title={scanProgress ? `Taranıyor: ${scanProgress.scanned_files} dosya` : 'Taranıyor…'}
          >
            <div className="h-full w-1/3 animate-[pulse_1s_ease-in-out_infinite] bg-accent" />
          </div>
        )}
      </header>

      {/* 2. Tarama Toast Bildirimi */}
      {(scanToast || (scan.isPending && scanProgress)) && (
        <div className="fixed bottom-24 right-6 z-50 rounded-lg bg-surface px-4 py-2.5 text-xs text-primary shadow-2xl ring-1 ring-border animate-in fade-in duration-200">
          <p className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-accent animate-ping" />
            {scanToast || `Taranıyor… ${scanProgress?.scanned_files ?? 0} dosya tarandı`}
          </p>
        </div>
      )}

      {/* 3. Ana İçerik Alanı (max-width: 1600px) */}
      <main
        className={`mx-auto max-w-[1600px] px-6 sm:px-8 lg:px-12 py-8 space-y-8 ${
          currentTrack ? 'pb-32' : 'pb-16'
        }`}
      >
        {authError && (
          <section className="rounded-xl bg-accent/10 p-4 text-xs text-accent ring-1 ring-accent/30 flex items-center justify-between gap-4">
            <div>
              <p className="font-semibold">Uzaktan erişim token’ı gerekli.</p>
              <p className="mt-0.5 text-secondary">
                Masaüstü uygulamasında “Uzaktan kumanda” bölümünde gösterilen token’ı girin.
              </p>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                placeholder="Token"
                className="rounded-lg bg-surface px-3 py-1.5 text-xs ring-1 ring-border focus:outline-none focus:ring-1 focus:ring-accent"
              />
              <button
                type="button"
                onClick={() => {
                  setRemoteToken(tokenInput.trim());
                  queryClient.invalidateQueries();
                }}
                className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-background hover:bg-accent-hover transition"
              >
                Kaydet
              </button>
            </div>
          </section>
        )}

        {activeCategory.mediaType === 'movie' && (
          <MoviesView
            key={activeCategory.id}
            player={videoPlayer}
            query={query}
            playingLabel={playingPath}
            onPlayed={handleMediaPlayed}
            onPlayVideo={handlePlayVideo}
            onOpenScanModal={() => handleOpenScanForCategory(activeCategory)}
            hasSources={activeCategory.paths.length > 0}
            onManageSources={() => setShowManageSources(true)}
            categoryLabel={activeCategory.label}
            categoryPaths={activeCategory.paths}
          />
        )}
        {activeCategory.mediaType === 'series' && (
          <SeriesView
            key={activeCategory.id}
            player={videoPlayer}
            query={query}
            playingPath={playingPath}
            onPlayed={handleMediaPlayed}
            onPlayVideo={handlePlayVideo}
            onOpenScanModal={() => handleOpenScanForCategory(activeCategory)}
            hasSources={activeCategory.paths.length > 0}
            onManageSources={() => setShowManageSources(true)}
            categoryLabel={activeCategory.label}
            categoryPaths={activeCategory.paths}
          />
        )}
        {activeCategory.mediaType === 'music' && (
          <MusicView
            key={activeCategory.id}
            player={audioPlayer}
            query={query}
            playingPath={playingPath}
            onPlayed={handleMusicPlayed}
            onOpenScanModal={() => handleOpenScanForCategory(activeCategory)}
            hasSources={activeCategory.paths.length > 0}
            onManageSources={() => setShowManageSources(true)}
            categoryLabel={activeCategory.label}
            categoryPaths={activeCategory.paths}
          />
        )}
      </main>

      {/* Kaynak Ekleme / Tarama Modalı */}
      <ScanModal
        isOpen={showScanModal}
        onClose={() => {
          setShowScanModal(false);
          setScanInitialPath('');
          setScanTargetCat(null);
        }}
        initialPath={scanInitialPath}
        targetCategoryLabel={scanTargetCat?.label || activeCategory.label}
        scanProgress={scanProgress}
        onScanStarted={(path) => {
          queryClient.invalidateQueries();
          const target = scanTargetCat || activeCategory;
          if (target && path && !target.paths.includes(path)) {
            setCategories((prev) =>
              prev.map((c) =>
                c.id === target.id ? { ...c, paths: [...c.paths, path] } : c
              )
            );
          }
        }}
      />

      {/* Kaynakları Düzenleme Modalı */}
      <ManageSourcesModal
        isOpen={showManageSources}
        onClose={() => setShowManageSources(false)}
        category={activeCategory}
        isDefault={DEFAULT_CATEGORIES.some((c) => c.id === activeCategory.id)}
        onRemovePath={async (catId, path) => {
          try {
            await removeSourcePath(path);
          } catch (err) {
            console.error('Kaynak kaldırılırken hata:', err);
          }
          setCategories((prev) =>
            prev.map((c) =>
              c.id === catId
                ? { ...c, paths: c.paths.filter((p) => p !== path) }
                : c
            )
          );
          queryClient.invalidateQueries();
        }}
        onAddPath={(catId, path) => {
          setCategories((prev) =>
            prev.map((c) =>
              c.id === catId && !c.paths.includes(path)
                ? { ...c, paths: [...c.paths, path] }
                : c
            )
          );
        }}
        onScanPath={(path) => {
          handleOpenScanForCategory(activeCategory, path);
        }}
        onRenameCategory={(catId, newLabel) => {
          setCategories((prev) =>
            prev.map((c) => (c.id === catId ? { ...c, label: newLabel } : c))
          );
        }}
        onDeleteCategory={(catId) => {
          setCategories((prev) => {
            const filtered = prev.filter((c) => c.id !== catId);
            if (activeCatId === catId && filtered.length > 0) {
              setActiveCatId(filtered[0].id);
            }
            return filtered;
          });
          setShowManageSources(false);
        }}
      />

      {/* Yeni Menü / Kategori Yaratma Modalı */}
      <CreateCategoryModal
        isOpen={showCreateCategory}
        onClose={() => setShowCreateCategory(false)}
        onCreate={(newCat, initialPath) => {
          setCategories((prev) => [...prev, newCat]);
          setActiveCatId(newCat.id);
          setShowCreateCategory(false);
          if (initialPath) {
            handleOpenScanForCategory(newCat, initialPath);
          }
        }}
      />

      {/* Ayarlar Modalı */}
      <SettingsPanel
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        remote={remote}
        audioPlayer={audioPlayer}
        videoPlayer={videoPlayer}
        onAudioPlayerChange={setAudioPlayer}
        onVideoPlayerChange={setVideoPlayer}
        onAuthChange={(enabled) =>
          setRemote((r) => (r ? { ...r, auth_enabled: enabled } : r))
        }
        onTokenChange={(token) =>
          setRemote((r) => (r ? { ...r, token } : r))
        }
      />

      {/* 4. Müzik Player Alt Çubuğu (72px) */}
      <AudioPlayerBar />

      {/* 5. Gömülü Video Oynatıcı Modalı */}
      <VideoPlayerModal
        isOpen={Boolean(activeVideo)}
        video={activeVideo}
        onClose={closeVideo}
        onExternalLaunch={closeVideo}
      />
    </div>
  );
}

export default function App() {
  return (
    <AudioPlayerProvider>
      <MainLayout />
    </AudioPlayerProvider>
  );
}

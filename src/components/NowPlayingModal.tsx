import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  Copy,
  FolderOpen,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import {
  coverUrl,
  getAlbumTracks,
  getLyrics,
  revealInFinder,
  type LyricsResult,
  type MediaItem,
} from '../api/client';
import { useLocale } from '../context/LocaleContext';
import { formatDuration, formatSize, getAudioQualityInfo } from '../lib/format';

interface NowPlayingModalProps {
  isOpen: boolean;
  onClose: () => void;
  track: MediaItem | null;
  queue: MediaItem[];
  queueIndex: number;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  isMuted: boolean;
  repeatMode: 'off' | 'all' | 'one';
  isShuffle: boolean;
  onTogglePlay: () => void;
  onNext: () => void;
  onPrev: () => void;
  onSeek: (seconds: number) => void;
  onSetVolume: (vol: number) => void;
  onToggleMute: () => void;
  onToggleRepeat: () => void;
  onToggleShuffle: () => void;
  onPlayQueueItem: (index: number) => void;
  onPlayTrack?: (track: MediaItem, newQueue?: MediaItem[]) => void;
  onRemoveFromQueue?: (index: number) => void;
}

type TabType = 'queue' | 'album' | 'lyrics' | 'info';
type IdleLevel = 'active' | 'calm' | 'deep';

interface LrcLine {
  time: number;
  text: string;
}

function parseLrc(content: string): LrcLine[] {
  const lines = content.split('\n');
  const result: LrcLine[] = [];
  const timeRegex = /\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?\]/g;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const matches = Array.from(trimmed.matchAll(timeRegex));
    if (matches.length > 0) {
      const text = trimmed.replace(timeRegex, '').trim();
      for (const m of matches) {
        const min = parseInt(m[1]!, 10);
        const sec = parseInt(m[2]!, 10);
        const ms = m[3] ? parseInt(m[3]!.padEnd(3, '0').slice(0, 3), 10) : 0;
        const time = min * 60 + sec + ms / 1000;
        result.push({ time, text });
      }
    }
  }

  result.sort((a, b) => a.time - b.time);
  return result;
}

/** Kapaktan dominant rengi canvas ile çıkarıp OKLCH uyumlu HSL vurgu rengi türetir */
function extractAccentColor(
  imageUrl: string,
): Promise<{ accent: string; glow: string; isMonochrome: boolean }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.src = imageUrl;
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 32;
        canvas.height = 32;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve({ accent: '#f59e0b', glow: 'rgba(245, 158, 11, 0.35)', isMonochrome: false });
          return;
        }
        ctx.drawImage(img, 0, 0, 32, 32);
        const data = ctx.getImageData(0, 0, 32, 32).data;
        let count = 0;
        let maxSat = 0;
        let dominantR = 245,
          dominantG = 158,
          dominantB = 11;

        for (let i = 0; i < data.length; i += 4) {
          const r = data[i]!;
          const g = data[i + 1]!;
          const b = data[i + 2]!;
          const brightness = (r + g + b) / 3;
          // Çok karanlık ve saf beyaz pikselleri atla
          if (brightness > 24 && brightness < 232) {
            const max = Math.max(r, g, b);
            const min = Math.min(r, g, b);
            const sat = max === 0 ? 0 : (max - min) / max;
            if (sat > maxSat) {
              maxSat = sat;
              dominantR = r;
              dominantG = g;
              dominantB = b;
            }
            count++;
          }
        }

        const isMonochrome = maxSat < 0.12;
        if (isMonochrome || count === 0) {
          resolve({
            accent: '#f59e0b',
            glow: 'rgba(245, 158, 11, 0.3)',
            isMonochrome: true,
          });
          return;
        }

        // RGB -> HSL: Lightness ~74%, Saturation ~65% (karanlık zeminlerde mükemmel okunabilirlik)
        const rNorm = dominantR / 255;
        const gNorm = dominantG / 255;
        const bNorm = dominantB / 255;
        const max = Math.max(rNorm, gNorm, bNorm);
        const min = Math.min(rNorm, gNorm, bNorm);
        let h = 0;
        const d = max - min;
        if (d > 0) {
          if (max === rNorm) h = ((gNorm - bNorm) / d + (gNorm < bNorm ? 6 : 0)) / 6;
          else if (max === gNorm) h = ((bNorm - rNorm) / d + 2) / 6;
          else h = ((rNorm - gNorm) / d + 4) / 6;
        }

        const finalHue = Math.round(h * 360);
        const accent = `hsl(${finalHue}, 68%, 72%)`;
        const glow = `hsla(${finalHue}, 68%, 55%, 0.35)`;
        resolve({ accent, glow, isMonochrome: false });
      } catch {
        resolve({ accent: '#f59e0b', glow: 'rgba(245, 158, 11, 0.35)', isMonochrome: false });
      }
    };
    img.onerror = () => {
      resolve({ accent: '#f59e0b', glow: 'rgba(245, 158, 11, 0.35)', isMonochrome: false });
    };
  });
}

export default function NowPlayingModal({
  isOpen,
  onClose,
  track,
  queue,
  queueIndex,
  isPlaying,
  currentTime,
  duration,
  volume,
  isMuted,
  repeatMode,
  isShuffle,
  onTogglePlay,
  onNext,
  onPrev,
  onSeek,
  onSetVolume,
  onToggleMute,
  onToggleRepeat,
  onToggleShuffle,
  onPlayQueueItem,
  onPlayTrack,
  onRemoveFromQueue,
}: NowPlayingModalProps) {
  const { t } = useLocale();
  const [activeTab, setActiveTab] = useState<TabType>('queue');
  const [idleLevel, setIdleLevel] = useState<IdleLevel>('active');
  const [showRemainingTime, setShowRemainingTime] = useState(true);
  const [hoverSeekTime, setHoverSeekTime] = useState<number | null>(null);
  const [hoverSeekPos, setHoverSeekPos] = useState<number>(0);
  const [isHoveringProgress, setIsHoveringProgress] = useState(false);
  const [accent, setAccent] = useState<{ accent: string; glow: string; isMonochrome: boolean }>({
    accent: '#f59e0b',
    glow: 'rgba(245, 158, 11, 0.35)',
    isMonochrome: false,
  });

  const [currentCover, setCurrentCover] = useState<string>('');
  const [prevCover, setPrevCover] = useState<string>('');
  const [isCoverCrossfading, setIsCoverCrossfading] = useState(false);

  const [lyricsData, setLyricsData] = useState<LyricsResult | null>(null);
  const [albumTracks, setAlbumTracks] = useState<MediaItem[]>([]);
  const [copiedPath, setCopiedPath] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(Boolean(document.fullscreenElement));
  const [isTitleAnimating, setIsTitleAnimating] = useState(false);

  const activeLyricsLineRef = useRef<HTMLDivElement | null>(null);
  const progressBarRef = useRef<HTMLDivElement | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Kapak URL'si
  const cover = track
    ? coverUrl(track.album || 'Unknown', track.artist || 'Unknown')
    : '';

  // Kapak değiştiğinde renk ve crossfade ortam ışığı güncelle
  useEffect(() => {
    if (!cover) return;
    if (cover !== currentCover) {
      setPrevCover(currentCover);
      setCurrentCover(cover);
      setIsCoverCrossfading(true);
      const timer = setTimeout(() => setIsCoverCrossfading(false), 800);

      extractAccentColor(cover).then((c) => setAccent(c));
      return () => clearTimeout(timer);
    }
  }, [cover, currentCover]);

  // Şarkı değiştiğinde başlık animasyonu
  useEffect(() => {
    if (track) {
      setIsTitleAnimating(true);
      const timer = setTimeout(() => setIsTitleAnimating(false), 250);
      return () => clearTimeout(timer);
    }
  }, [track?.file_path]);

  // Şarkı değiştiğinde sözleri çek
  useEffect(() => {
    if (!track?.file_path) {
      setLyricsData(null);
      return;
    }
    let cancelled = false;
    getLyrics(track.file_path)
      .then((res) => {
        if (!cancelled) {
          setLyricsData(res);
          if (!res && activeTab === 'lyrics') {
            setActiveTab('queue');
          }
        }
      })
      .catch(() => {
        if (!cancelled) setLyricsData(null);
      });

    return () => {
      cancelled = true;
    };
  }, [track?.file_path, activeTab]);

  // Albüm şarkılarını çek
  useEffect(() => {
    if (!track?.album || !track?.artist) {
      setAlbumTracks([]);
      return;
    }
    let cancelled = false;
    getAlbumTracks(track.album, track.artist)
      .then((tracks) => {
        if (!cancelled) setAlbumTracks(tracks);
      })
      .catch(() => {
        if (!cancelled) setAlbumTracks([]);
      });

    return () => {
      cancelled = true;
    };
  }, [track?.album, track?.artist]);

  // LRC ayrıştırma
  const parsedLyrics = useMemo(() => {
    if (!lyricsData?.text) return [];
    return parseLrc(lyricsData.text);
  }, [lyricsData]);

  // Aktif şarkı sözü satırı indexi
  const activeLyricIndex = useMemo(() => {
    if (parsedLyrics.length === 0) return -1;
    let idx = -1;
    for (let i = 0; i < parsedLyrics.length; i++) {
      if (currentTime >= parsedLyrics[i]!.time) {
        idx = i;
      } else {
        break;
      }
    }
    return idx;
  }, [parsedLyrics, currentTime]);

  // Senkronize sözlerde aktif satırı yumuşakça merkeze kaydır
  useEffect(() => {
    if (activeTab === 'lyrics' && activeLyricsLineRef.current) {
      activeLyricsLineRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }
  }, [activeLyricIndex, activeTab]);

  // Sakin mod zamanlayıcısı (4s -> calm, 10s -> deep)
  useEffect(() => {
    if (!isOpen) return;

    const resetIdleTimer = () => {
      setIdleLevel('active');
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);

      idleTimerRef.current = setTimeout(() => {
        setIdleLevel('calm');
        idleTimerRef.current = setTimeout(() => {
          setIdleLevel('deep');
        }, 6000); // 4s + 6s = 10s
      }, 4000);
    };

    resetIdleTimer();

    const handleUserActivity = () => {
      resetIdleTimer();
    };

    window.addEventListener('mousemove', handleUserActivity);
    window.addEventListener('mousedown', handleUserActivity);
    window.addEventListener('keydown', handleUserActivity);

    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      window.removeEventListener('mousemove', handleUserActivity);
      window.removeEventListener('mousedown', handleUserActivity);
      window.removeEventListener('keydown', handleUserActivity);
    };
  }, [isOpen]);

  // Tam ekran dinleyicisi
  useEffect(() => {
    const handleFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', handleFsChange);
    return () => document.removeEventListener('fullscreenchange', handleFsChange);
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  // Klavye kısayolları
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }

      // Cmd, Ctrl veya Alt basılıyken tek tuşlu kısayolları tetikleme (Cmd+Q, Cmd+W vb.)
      if (e.metaKey || e.ctrlKey || e.altKey) {
        return;
      }

      switch (e.key) {
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
        case ' ':
          e.preventDefault();
          onTogglePlay();
          break;
        case 'ArrowLeft':
          if (e.shiftKey) {
            e.preventDefault();
            onPrev();
          } else {
            e.preventDefault();
            onSeek(Math.max(0, currentTime - 10));
          }
          break;
        case 'ArrowRight':
          if (e.shiftKey) {
            e.preventDefault();
            onNext();
          } else {
            e.preventDefault();
            onSeek(Math.min(duration || track?.duration || 0, currentTime + 10));
          }
          break;
        case 'ArrowUp':
          e.preventDefault();
          onSetVolume(Math.min(1, volume + 0.05));
          break;
        case 'ArrowDown':
          e.preventDefault();
          onSetVolume(Math.max(0, volume - 0.05));
          break;
        case 's':
        case 'S':
          e.preventDefault();
          onToggleShuffle();
          break;
        case 'r':
        case 'R':
          e.preventDefault();
          onToggleRepeat();
          break;
        case 'l':
        case 'L':
          if (lyricsData) {
            e.preventDefault();
            setActiveTab('lyrics');
          }
          break;
        case 'q':
        case 'Q':
          e.preventDefault();
          setActiveTab('queue');
          break;
        case 'i':
        case 'I':
          e.preventDefault();
          setActiveTab('info');
          break;
        case 'f':
        case 'F':
          e.preventDefault();
          toggleFullscreen();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    isOpen,
    currentTime,
    duration,
    track,
    volume,
    lyricsData,
    onClose,
    onTogglePlay,
    onPrev,
    onNext,
    onSeek,
    onSetVolume,
    onToggleShuffle,
    onToggleRepeat,
  ]);

  if (!isOpen || !track) return null;

  const currentDuration = duration || track.duration || 0;
  const remainingTime = Math.max(0, currentDuration - currentTime);
  const progressPercent =
    currentDuration > 0 ? Math.min(100, (currentTime / currentDuration) * 100) : 0;
  const quality = getAudioQualityInfo(track);

  // Sıradaki liste: çalan şarkı tekrar gösterilmez, bir sonrakinden başlar
  const upcomingQueue = queue.slice(queueIndex + 1);

  // Albüm toplam süresi
  const totalAlbumDuration = albumTracks.reduce((acc, t) => acc + (t.duration || 0), 0);

  // İlerleme çubuğu tıklama / hover
  const handleProgressMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!progressBarRef.current) return;
    const rect = progressBarRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setHoverSeekTime(ratio * currentDuration);
    setHoverSeekPos(e.clientX - rect.left);
  };

  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!progressBarRef.current) return;
    const rect = progressBarRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    onSeek(ratio * currentDuration);
  };

  // Ses fare tekerleği
  const handleVolumeWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.04 : -0.04;
    onSetVolume(Math.max(0, Math.min(1, volume + delta)));
  };

  return (
    <div
      style={
        {
          '--accent-color': accent.accent,
          '--accent-glow': accent.glow,
        } as React.CSSProperties
      }
      className={`fixed inset-0 z-50 flex flex-col justify-between bg-[#121110] text-primary select-none overflow-hidden transition-all duration-300 ${
        idleLevel === 'deep' ? 'cursor-none' : 'cursor-auto'
      }`}
    >
      {/* 1. ARKA PLAN: KAPAKTAN GELEN IŞIK + RADIAL VİNYET + GRAIN DOKUSU */}
      <div className="absolute inset-0 pointer-events-none -z-10 overflow-hidden">
        {/* Ortam Işığı Katmanı (Blur 120px, Saturate 1.2, Opacity 0.35, 800ms Crossfade) */}
        {!accent.isMonochrome ? (
          <>
            {prevCover && isCoverCrossfading && (
              <img
                src={prevCover}
                alt=""
                className="absolute inset-0 h-full w-full object-cover blur-[120px] saturate-[1.2] scale-[1.4] opacity-35 transition-opacity duration-800"
              />
            )}
            <img
              src={currentCover}
              alt=""
              className="absolute inset-0 h-full w-full object-cover blur-[120px] saturate-[1.2] scale-[1.4] opacity-35 transition-opacity duration-800"
            />
          </>
        ) : (
          <div className="absolute inset-0 bg-[#171514]" />
        )}

        {/* Karartma Vinyeti: Kapağın arkası hafif aydınlık, kenarlar koyu */}
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(ellipse at 35% 50%, transparent 0%, rgba(18, 17, 16, 0.88) 70%)',
          }}
        />

        {/* Grain Dokusu (%3 statik noise, blur'un plastik hissini kırar) */}
        <svg
          className="absolute inset-0 h-full w-full opacity-[0.035] mix-blend-overlay pointer-events-none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <filter id="kuraGrain">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.75"
              numOctaves="3"
              stitchTiles="stitch"
            />
          </filter>
          <rect width="100%" height="100%" filter="url(#kuraGrain)" />
        </svg>
      </div>

      {/* 2. ÜST BAR (CHROME): SÜREKLİ GÖRÜNÜR ÜST KONTROLLER */}
      <header className="relative z-20 flex h-16 w-full items-center justify-between px-4 sm:px-8 lg:px-12 transition-opacity duration-300 opacity-100">
        {/* Sol: ⌄ Küçült */}
        <button
          type="button"
          onClick={onClose}
          className="flex h-10 w-10 items-center justify-center rounded-full text-secondary hover:text-primary hover:bg-white/[0.06] transition"
          title={t('player.minimizeEsc')}
        >
          <ChevronDown className="h-6 w-6 stroke-[1.5]" />
        </button>

        {/* Sağ: Sekmeler / Tam Ekran */}
        <div className="flex items-center gap-2 sm:gap-3">
          <button
            type="button"
            onClick={() => setActiveTab('queue')}
            className={`flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition ${
              activeTab === 'queue'
                ? 'bg-white/[0.1] text-white'
                : 'text-tertiary hover:text-white hover:bg-white/[0.05]'
            }`}
            title={t('player.upNextKey')}
          >
            <span>{t('player.upNext')}</span>
            {upcomingQueue.length > 0 && (
              <span className="font-mono text-[10px] opacity-60">
                {upcomingQueue.length}
              </span>
            )}
          </button>

          {lyricsData && (
            <button
              type="button"
              onClick={() => setActiveTab('lyrics')}
              className={`flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition ${
                activeTab === 'lyrics'
                  ? 'bg-white/[0.1] text-white'
                  : 'text-tertiary hover:text-white hover:bg-white/[0.05]'
              }`}
              title={t('player.lyricsKey')}
            >
              <span>{t('player.lyrics')}</span>
            </button>
          )}

          <button
            type="button"
            onClick={toggleFullscreen}
            className="flex h-9 w-9 items-center justify-center rounded-full text-secondary hover:text-primary hover:bg-white/[0.06] transition"
            title={isFullscreen ? t('player.exitFullscreen') : t('player.fullscreen')}
          >
            {isFullscreen ? (
              <Minimize2 className="h-4 w-4 stroke-[1.5]" />
            ) : (
              <Maximize2 className="h-4 w-4 stroke-[1.5]" />
            )}
          </button>
        </div>
      </header>

      {/* 3. ANA GÖVDE: BÜYÜK DİNLEME ODASI IZGARASI */}
      <main className="relative z-10 flex flex-1 items-center justify-center px-4 sm:px-8 lg:px-12 py-2 overflow-y-auto lg:overflow-visible">
        <div className="w-full max-w-[1400px] grid grid-cols-1 lg:grid-cols-[auto_minmax(360px,560px)] items-center justify-center gap-6 lg:gap-[clamp(48px,6vw,120px)] my-auto">
          {/* SOL SÜTUN: PLAK HİSSİ VEREN BÜYÜK KAPAK (4px radius, çerçevesiz, katmanlı gölge) */}
          <div className="flex justify-center items-center">
            <div
              onClick={() => setActiveTab('album')}
              title={t('player.goToAlbum')}
              style={{
                boxShadow: isPlaying
                  ? `0 2px 4px rgba(0, 0, 0, 0.3), 0 24px 48px -12px rgba(0, 0, 0, 0.5), 0 60px 120px -40px ${accent.glow}`
                  : '0 2px 4px rgba(0, 0, 0, 0.4), 0 16px 32px -8px rgba(0, 0, 0, 0.6)',
              }}
              className={`relative cursor-pointer aspect-square rounded-[4px] overflow-hidden bg-[#1a1817] transition-all duration-300 w-[min(76vw,36vh)] h-[min(76vw,36vh)] sm:w-[min(65vw,40vh)] sm:h-[min(65vw,40vh)] lg:w-[min(64vh,42vw)] lg:h-[min(64vh,42vw)] max-w-[680px] max-h-[680px] ${
                isPlaying ? 'scale-100' : 'scale-[0.97]'
              }`}
            >
              <img
                src={cover}
                alt={track.album || ''}
                className="h-full w-full object-cover select-none"
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                }}
              />
              <div className="absolute inset-0 -z-10 flex items-center justify-center font-serif text-7xl text-white/10 select-none">
                {track.album?.slice(0, 1) || '♪'}
              </div>
            </div>
          </div>

          {/* SAĞ SÜTUN: BİLGİ BLOĞU, İLERLEME, KONTROLLER & SEKME İÇERİĞİ */}
          <div className="flex flex-col justify-between w-full max-w-full lg:max-w-[560px] mx-auto lg:h-[min(64vh,42vw)] lg:max-h-[680px] min-h-0 lg:min-h-[460px]">
            {/* ÜST BİLGİ: ÜST ETİKET · ŞARKI ADI (SERIF) · SANATÇI */}
            <div
              className={`w-full transition-opacity duration-200 ${
                isHoveringProgress ? 'opacity-65' : 'opacity-100'
              }`}
            >
              {/* Üst Etiket */}
              <div className="flex items-center gap-1.5 text-[11px] font-mono tracking-[0.14em] uppercase text-white/40 w-full">
                <span>{t('player.nowPlaying')}</span>
                <span>·</span>
                <button
                  type="button"
                  onClick={() => setActiveTab('album')}
                  className="truncate hover:text-white transition-colors max-w-[220px] sm:max-w-none"
                >
                  {track.album || t('music.singleUnknown')}
                </button>
              </div>

              {/* Şarkı Adı (Büyük Serif, max 2 satır, Full Width) */}
              <h1
                className={`w-full font-serif text-[clamp(26px,4.5vw,56px)] leading-[1.08] text-white font-normal break-words line-clamp-2 mt-2 transition-all duration-250 ${
                  isTitleAnimating
                    ? '-translate-y-2 opacity-0'
                    : 'translate-y-0 opacity-100'
                }`}
              >
                {track.title}
              </h1>

              {/* Sanatçı & Ek Bilgi (Full Width) */}
              <div className="w-full flex flex-wrap items-baseline gap-x-2.5 gap-y-1 mt-2.5">
                <button
                  type="button"
                  onClick={() => setActiveTab('album')}
                  className="text-[clamp(15px,2vw,20px)] text-white/70 font-sans hover:text-white transition-colors truncate max-w-full"
                >
                  {track.artist || t('common.unknownArtist')}
                </button>

                {(track.year || track.disk_label) && (
                  <span className="text-[13px] font-mono text-white/40">
                    {track.year ? `${track.year} · ` : ''}
                    {track.disk_label || 'Stereo'}
                  </span>
                )}
              </div>
            </div>

            {/* ORTA KISIM: İLERLEME ÇUBUĞU (SÜRELER İKİ YANDA) & KONTROLLER */}
            <div className="w-full my-3 sm:my-4 transition-opacity duration-300 opacity-100">
              {/* İlerleme Çubuğu Satırı */}
              <div className="flex items-center gap-3 w-full">
                {/* Geçen Süre */}
                <span className="w-10 text-left font-mono text-xs text-white/40 tabular-nums">
                  {formatDuration(Math.floor(currentTime))}
                </span>

                {/* Çubuk (Hover'da tutamak ve zaman balonu) */}
                <div
                  ref={progressBarRef}
                  className="group relative flex-1 h-[3px] hover:h-[5px] bg-white/[0.12] rounded-full cursor-pointer transition-all"
                  onMouseEnter={() => setIsHoveringProgress(true)}
                  onMouseLeave={() => setIsHoveringProgress(false)}
                  onMouseMove={handleProgressMouseMove}
                  onClick={handleProgressClick}
                >
                  {/* Dolu İlerleme */}
                  <div
                    className="h-full rounded-full transition-all duration-75"
                    style={{
                      width: `${progressPercent}%`,
                      backgroundColor: accent.accent,
                    }}
                  />

                  {/* 12px Vurgu Tutamağı (Hover'da görünür) */}
                  <div
                    className="absolute -top-[3.5px] h-3 w-3 -translate-x-1/2 rounded-full shadow-md opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-150"
                    style={{
                      left: `${progressPercent}%`,
                      backgroundColor: accent.accent,
                    }}
                  />

                  {/* Hover Zaman Balonu (Tooltip) */}
                  {isHoveringProgress && hoverSeekTime !== null && (
                    <div
                      className="absolute -top-7 -translate-x-1/2 rounded bg-black/90 px-1.5 py-0.5 font-mono text-[10px] text-white shadow-xl ring-1 ring-white/10 pointer-events-none"
                      style={{ left: `${hoverSeekPos}px` }}
                    >
                      {formatDuration(Math.floor(hoverSeekTime))}
                    </div>
                  )}
                </div>

                {/* Kalan / Toplam Süre (Tıklanabilir) */}
                <button
                  type="button"
                  onClick={() => setShowRemainingTime(!showRemainingTime)}
                  className="w-12 text-right font-mono text-xs text-white/40 tabular-nums hover:text-white/80 transition-colors"
                  title={t('player.toggleRemaining')}
                >
                  {showRemainingTime
                    ? `−${formatDuration(Math.floor(remainingTime))}`
                    : formatDuration(Math.floor(currentDuration))}
                </button>
              </div>

              {/* Oynatma Kontrolleri (64px Oynat Butonu, 22px Yan Butonlar) */}
              <div className="flex items-center justify-center gap-6 sm:gap-8 mt-5">
                {/* Karıştır */}
                <button
                  type="button"
                  onClick={onToggleShuffle}
                  className={`relative p-2.5 transition ${
                    isShuffle
                      ? 'text-[var(--accent-color)]'
                      : 'text-white/50 hover:text-white'
                  }`}
                  title={t('player.shuffleKey')}
                >
                  <Shuffle className="h-[21px] w-[21px] stroke-[1.5]" />
                  {isShuffle && (
                    <span
                      className="absolute bottom-1 left-1/2 -translate-x-1/2 h-1 w-1 rounded-full"
                      style={{ backgroundColor: accent.accent }}
                    />
                  )}
                </button>

                {/* Önceki Şarkı */}
                <button
                  type="button"
                  onClick={onPrev}
                  className="p-2.5 text-white/70 hover:text-white transition active:scale-95"
                  title={t('player.previousShift')}
                >
                  <SkipBack className="h-[22px] w-[22px] stroke-[1.5]" />
                </button>

                {/* Oynat / Duraklat Butonu (64px Daire, Vurgu Rengi, Koyu İkon) */}
                <button
                  type="button"
                  onClick={onTogglePlay}
                  style={{
                    backgroundColor: accent.accent,
                    color: '#171514',
                  }}
                  className="flex h-16 w-16 items-center justify-center rounded-full shadow-2xl hover:scale-[1.04] active:scale-[0.96] transition-transform"
                  title={isPlaying ? t('player.pauseSpace') : t('player.playSpace')}
                >
                  {isPlaying ? (
                    <Pause className="h-7 w-7 fill-current stroke-0" />
                  ) : (
                    <Play className="h-7 w-7 fill-current stroke-0 ml-0.5" />
                  )}
                </button>

                {/* Sonraki Şarkı */}
                <button
                  type="button"
                  onClick={onNext}
                  className="p-2.5 text-white/70 hover:text-white transition active:scale-95"
                  title={t('player.nextShift')}
                >
                  <SkipForward className="h-[22px] w-[22px] stroke-[1.5]" />
                </button>

                {/* Tekrarla */}
                <button
                  type="button"
                  onClick={onToggleRepeat}
                  className={`relative p-2.5 transition ${
                    repeatMode !== 'off'
                      ? 'text-[var(--accent-color)]'
                      : 'text-white/50 hover:text-white'
                  }`}
                  title={t('player.repeatKey')}
                >
                  {repeatMode === 'one' ? (
                    <Repeat1 className="h-[21px] w-[21px] stroke-[1.5]" />
                  ) : (
                    <Repeat className="h-[21px] w-[21px] stroke-[1.5]" />
                  )}
                  {repeatMode !== 'off' && (
                    <span
                      className="absolute bottom-1 left-1/2 -translate-x-1/2 h-1 w-1 rounded-full"
                      style={{ backgroundColor: accent.accent }}
                    />
                  )}
                </button>
              </div>
            </div>

            {/* ALT KISIM: SEKME PANELİ (SIRADAKİ · ALBÜM · SÖZLER · BİLGİ) - SÜREKLİ GÖRÜNÜR */}
            <div className="w-full transition-opacity duration-300 opacity-100">
              {/* Sekme Başlıkları (Yalnızca Metin, 13px, 1px Alt Çizgi) */}
              <div className="flex items-center gap-6 border-b border-white/[0.08] pb-2 text-[13px] font-medium">
                <button
                  type="button"
                  onClick={() => setActiveTab('queue')}
                  className={`relative pb-2 transition-colors ${
                    activeTab === 'queue'
                      ? 'text-white'
                      : 'text-white/40 hover:text-white/75'
                  }`}
                >
                  <span>{t('player.upNext')}</span>
                  {activeTab === 'queue' && (
                    <span
                      className="absolute bottom-0 left-0 right-0 h-[1.5px]"
                      style={{ backgroundColor: accent.accent }}
                    />
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab('album')}
                  className={`relative pb-2 transition-colors ${
                    activeTab === 'album'
                      ? 'text-white'
                      : 'text-white/40 hover:text-white/75'
                  }`}
                >
                  <span>{t('player.album')}</span>
                  {activeTab === 'album' && (
                    <span
                      className="absolute bottom-0 left-0 right-0 h-[1.5px]"
                      style={{ backgroundColor: accent.accent }}
                    />
                  )}
                </button>

                {lyricsData && (
                  <button
                    type="button"
                    onClick={() => setActiveTab('lyrics')}
                    className={`relative pb-2 transition-colors ${
                      activeTab === 'lyrics'
                        ? 'text-white'
                        : 'text-white/40 hover:text-white/75'
                    }`}
                  >
                    <span>{t('player.lyrics')}</span>
                    {activeTab === 'lyrics' && (
                      <span
                        className="absolute bottom-0 left-0 right-0 h-[1.5px]"
                        style={{ backgroundColor: accent.accent }}
                      />
                    )}
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setActiveTab('info')}
                  className={`relative pb-2 transition-colors ${
                    activeTab === 'info'
                      ? 'text-white'
                      : 'text-white/40 hover:text-white/75'
                  }`}
                >
                  <span>{t('player.info')}</span>
                  {activeTab === 'info' && (
                    <span
                      className="absolute bottom-0 left-0 right-0 h-[1.5px]"
                      style={{ backgroundColor: accent.accent }}
                    />
                  )}
                </button>
              </div>

              {/* Sekme İçerik Kutusu (Maksimum ~5 Satır, Altta Yumuşak Solma Maskesi) */}
              <div
                style={{
                  maskImage: 'linear-gradient(to bottom, black 65%, transparent 100%)',
                  WebkitMaskImage:
                    'linear-gradient(to bottom, black 65%, transparent 100%)',
                }}
                className="mt-2 h-44 overflow-y-auto pr-1"
              >
                {/* 1. SIRADAKİ SEKME: ÇALAN ŞARKI GÖSTERİLMEZ, BİR SONRAKİNDEN BAŞLAR */}
                {activeTab === 'queue' && (
                  <div className="space-y-0.5">
                    {upcomingQueue.length > 0 ? (
                      upcomingQueue.map((item, idx) => {
                        const actualIdx = queueIndex + 1 + idx;
                        return (
                          <div
                            key={`${item.file_path}-${actualIdx}`}
                            onClick={() => onPlayQueueItem(actualIdx)}
                            className="group flex h-10 items-center justify-between gap-3 px-2 rounded hover:bg-white/[0.04] text-xs cursor-pointer transition-colors"
                          >
                            <span className="w-6 text-left font-mono text-[11px] text-white/40">
                              {String(actualIdx + 1).padStart(2, '0')}
                            </span>
                            <span className="flex-1 truncate text-white/90">
                              {item.title}
                            </span>
                            <span className="font-mono text-[11px] text-white/40">
                              {formatDuration(item.duration)}
                            </span>
                            {onRemoveFromQueue && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onRemoveFromQueue(actualIdx);
                                }}
                                className="opacity-0 group-hover:opacity-100 p-1 text-white/30 hover:text-white transition"
                                title={t('player.remove')}
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        );
                      })
                    ) : (
                      <div className="flex h-32 items-center justify-center text-xs font-mono text-white/40">
                        {t('music.queueAutoContinue', { artist: track.artist || t('music.artistFallback') })}
                        {track.album ? `, ${track.album}` : ''}
                      </div>
                    )}
                  </div>
                )}

                {/* 2. ALBÜM SEKME: ALBÜMÜN TÜM ŞARKILARI + ÇALAN SATIRDA MİNİK EKOLAYZER */}
                {activeTab === 'album' && (
                  <div className="space-y-0.5">
                    {albumTracks.map((item) => {
                      const isCurrent = item.file_path === track.file_path;
                      return (
                        <div
                          key={item.file_path}
                          onClick={() => onPlayTrack?.(item, albumTracks)}
                          className={`group flex h-10 items-center justify-between gap-3 px-2 rounded hover:bg-white/[0.04] text-xs cursor-pointer transition-colors ${
                            isCurrent ? 'font-medium' : ''
                          }`}
                        >
                          <span className="w-6 flex items-center justify-start">
                            {isCurrent ? (
                              <span className="flex items-end gap-[2px] h-3 w-3">
                                <span
                                  className="w-[2px] rounded-full animate-[equalizer_0.8s_ease-in-out_infinite]"
                                  style={{ backgroundColor: accent.accent }}
                                />
                                <span
                                  className="w-[2px] rounded-full animate-[equalizer_0.8s_ease-in-out_0.2s_infinite]"
                                  style={{ backgroundColor: accent.accent }}
                                />
                                <span
                                  className="w-[2px] rounded-full animate-[equalizer_0.8s_ease-in-out_0.4s_infinite]"
                                  style={{ backgroundColor: accent.accent }}
                                />
                              </span>
                            ) : (
                              <span className="font-mono text-[11px] text-white/40">
                                {String(item.track_number || 1).padStart(2, '0')}
                              </span>
                            )}
                          </span>

                          <span
                            className="flex-1 truncate"
                            style={isCurrent ? { color: accent.accent } : { color: 'rgba(255,255,255,0.9)' }}
                          >
                            {item.title}
                          </span>

                          <span className="font-mono text-[11px] text-white/40">
                            {formatDuration(item.duration)}
                          </span>
                        </div>
                      );
                    })}
                    {albumTracks.length > 0 && (
                      <div className="pt-2 text-right font-mono text-[11px] text-white/35">
                        {albumTracks.length} şarkı · {formatDuration(totalAlbumDuration)}
                      </div>
                    )}
                  </div>
                )}

                {/* 3. SÖZLER SEKME: SENKRONİZE LRC KAYDIRMA */}
                {activeTab === 'lyrics' && (
                  <div className="py-2 space-y-3">
                    {parsedLyrics.length > 0 ? (
                      parsedLyrics.map((line, idx) => {
                        const isActive = idx === activeLyricIndex;
                        return (
                          <div
                            key={`${line.time}-${idx}`}
                            ref={isActive ? activeLyricsLineRef : null}
                            onClick={() => onSeek(line.time)}
                            className={`cursor-pointer transition-all duration-300 ${
                              isActive
                                ? 'text-lg font-medium text-white scale-[1.01]'
                                : 'text-sm text-white/35 hover:text-white/70'
                            }`}
                          >
                            {line.text || '♪'}
                          </div>
                        );
                      })
                    ) : lyricsData?.text ? (
                      <div className="whitespace-pre-line text-sm text-white/70 leading-relaxed">
                        {lyricsData.text}
                      </div>
                    ) : (
                      <div className="flex h-32 items-center justify-center text-xs text-white/40">
                        {t('music.lyricsNotFound')}
                      </div>
                    )}
                  </div>
                )}

                {/* 4. TEKNİK BİLGİ SEKME: 2 SÜTUNLU TANIM LİSTESİ + YOLU KOPYALA / FINDER */}
                {activeTab === 'info' && (
                  <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-xs pt-1">
                    <div>
                      <span className="font-mono text-[11px] text-white/40">{t('player.metaFormat')}</span>
                      <p className="font-mono text-white/90 mt-0.5">
                        {track.format.toUpperCase()}
                      </p>
                    </div>

                    <div>
                      <span className="font-mono text-[11px] text-white/40">{t('player.metaResolution')}</span>
                      <p className="font-mono text-white/90 mt-0.5">
                        {quality.bitDepthStr || (track.bit_depth ? `${track.bit_depth}-bit` : '16-bit')} /{' '}
                        {quality.sampleRateStr || (track.sample_rate ? `${Math.round(track.sample_rate / 100) / 10} kHz` : '44.1 kHz')}
                      </p>
                    </div>

                    <div>
                      <span className="font-mono text-[11px] text-white/40">{t('player.metaBitrate')}</span>
                      <p className="font-mono text-white/90 mt-0.5">
                        {quality.bitrateStr ||
                          (track.duration
                            ? `${Math.round((track.file_size * 8) / track.duration / 1000)} kbps`
                            : '—')}
                      </p>
                    </div>

                    <div>
                      <span className="font-mono text-[11px] text-white/40">{t('player.metaSize')}</span>
                      <p className="font-mono text-white/90 mt-0.5">
                        {formatSize(track.file_size)}
                      </p>
                    </div>

                    <div>
                      <span className="font-mono text-[11px] text-white/40">{t('player.metaSource')}</span>
                      <p className="font-mono text-white/90 mt-0.5">
                        {track.disk_label || t('player.localArchive')}
                      </p>
                    </div>

                    <div>
                      <span className="font-mono text-[11px] text-white/40">{t('player.metaChannel')}</span>
                      <p className="font-mono text-white/90 mt-0.5">
                        {track.channels === 1 ? 'Mono' : 'Stereo (2ch)'}
                      </p>
                    </div>

                    <div className="col-span-2 pt-2 border-t border-white/[0.06]">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-[11px] text-white/40">{t('player.metaPath')}</span>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard.writeText(track.file_path);
                              setCopiedPath(true);
                              setTimeout(() => setCopiedPath(false), 2000);
                            }}
                            className="flex items-center gap-1 text-[11px] font-mono text-secondary hover:text-white transition"
                          >
                            <Copy className="h-3 w-3" />
                            <span>{copiedPath ? t('common.copied') : t('common.copy')}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => revealInFinder(track.file_path)}
                            className="flex items-center gap-1 text-[11px] font-mono text-secondary hover:text-white transition"
                          >
                            <FolderOpen className="h-3 w-3" />
                            <span>{t('player.showInFinder')}</span>
                          </button>
                        </div>
                      </div>
                      <p
                        className="font-mono text-[11px] text-white/60 mt-1 truncate"
                        title={track.file_path}
                      >
                        {track.file_path}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* 4. ALT KENAR (CHROME): SOLDA FORMAT ETİKETİ, SAĞDA 120PX SES KAYDIRICI */}
      <footer className="relative z-20 flex h-16 w-full items-center justify-between px-4 sm:px-8 lg:px-12 transition-opacity duration-300 opacity-100">
        {/* Sol: Format Etiketi (Hi-Res kaynaklarda başta 4px nokta) */}
        <div className="flex items-center gap-2 font-mono text-[11px] text-white/50">
          {quality.isHiRes && (
            <span
              className="h-1.5 w-1.5 rounded-full shadow"
              style={{ backgroundColor: accent.accent }}
              title={t('player.hiResFull')}
            />
          )}
          <span>
            {track.format.toUpperCase()} ·{' '}
            {quality.bitDepthStr ? `${quality.bitDepthStr} / ` : ''}
            {quality.sampleRateStr || (track.sample_rate ? `${Math.round(track.sample_rate / 100) / 10} kHz` : '44.1 kHz')}
          </span>
        </div>

        {/* Sağ: Ses İkonu + 120px Kaydırıcı (Fare tekerleği destekli) */}
        <div
          onWheel={handleVolumeWheel}
          className="flex items-center gap-2.5"
          title={t('player.volumeHint')}
        >
          <button
            type="button"
            onClick={onToggleMute}
            className="p-1 text-white/50 hover:text-white transition"
          >
            {isMuted || volume === 0 ? (
              <VolumeX className="h-4 w-4 stroke-[1.5]" />
            ) : (
              <Volume2 className="h-4 w-4 stroke-[1.5]" />
            )}
          </button>

          <div
            className="group relative h-[3px] hover:h-[5px] w-[120px] bg-white/[0.15] rounded-full cursor-pointer transition-all"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
              onSetVolume(pos);
            }}
          >
            {/* Ses Dolgusu */}
            <div
              className="h-full rounded-full bg-white transition-all duration-75"
              style={{ width: `${(isMuted ? 0 : volume) * 100}%` }}
            />

            {/* 12px Daire Tutamak */}
            <div
              className="absolute -top-[4.5px] h-3 w-3 -translate-x-1/2 rounded-full bg-white shadow pointer-events-none"
              style={{ left: `${(isMuted ? 0 : volume) * 100}%` }}
            />
          </div>
        </div>
      </footer>
    </div>
  );
}

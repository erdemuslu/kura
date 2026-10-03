import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import {
  ArrowLeft,
  Check,
  ExternalLink,
  Loader2,
  Maximize,
  Minimize,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Subtitles,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { formatDuration } from '../lib/format';
import {
  hlsSessionId,
  isRunningInTauri,
  launchPlayer,
  probeKeyframeBefore,
  probeMediaDuration,
  stopHlsSession,
  streamVideoUrl,
  subtitleUrl,
} from '../api/client';
import { useLocale } from '../context/LocaleContext';

export interface VideoPlayerItem {
  filePath: string;
  title: string;
  subTitle?: string;
  duration?: number | null;
  subtitlePath?: string | null;
  hasSubtitles?: boolean;
}

interface VideoPlayerModalProps {
  isOpen: boolean;
  onClose: () => void;
  video: VideoPlayerItem | null;
  onExternalLaunch?: () => void;
}

export interface SubtitleCue {
  start: number;
  end: number;
  text: string;
}

export interface SubtitleSettings {
  size: 'sm' | 'md' | 'lg' | 'xl';
  color: 'white' | 'yellow' | 'cyan';
  background: 'translucent' | 'solid' | 'shadow';
  position: 'letterbox' | 'video';
  offset: number; // saniye cinsinden gecikme/kaydırma (+/-)
}

const DEFAULT_SUBTITLE_SETTINGS: SubtitleSettings = {
  size: 'md',
  color: 'yellow',
  background: 'translucent',
  position: 'letterbox',
  offset: 0,
};

function parseVttTimestamp(ts: string): number | null {
  const clean = ts.trim().replace(',', '.');
  const parts = clean.split(':');
  if (parts.length === 3) {
    const h = parseFloat(parts[0]);
    const m = parseFloat(parts[1]);
    const s = parseFloat(parts[2]);
    if (!isNaN(h) && !isNaN(m) && !isNaN(s)) return h * 3600 + m * 60 + s;
  } else if (parts.length === 2) {
    const m = parseFloat(parts[0]);
    const s = parseFloat(parts[1]);
    if (!isNaN(m) && !isNaN(s)) return m * 60 + s;
  }
  return null;
}

export function parseVtt(vtt: string): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  const lines = vtt.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();

    // Skip NOTE or WEBVTT header
    if (line.startsWith('NOTE') || line.startsWith('WEBVTT')) {
      while (i < lines.length && lines[i].trim() !== '') i++;
      i++;
      continue;
    }

    if (line.includes('-->')) {
      const arrowIdx = line.indexOf('-->');
      const startStr = line.substring(0, arrowIdx).trim();
      const endStr = line.substring(arrowIdx + 3).trim().split(/\s+/)[0];

      const start = parseVttTimestamp(startStr);
      const end = parseVttTimestamp(endStr);

      if (start !== null && end !== null) {
        i++;
        const textLines: string[] = [];
        while (i < lines.length && lines[i].trim() !== '') {
          const clean = lines[i].replace(/<\/?[^>]+(>|$)/g, '').trim();
          if (clean) textLines.push(clean);
          i++;
        }
        if (textLines.length > 0) {
          cues.push({ start, end, text: textLines.join('\n') });
        }
      }
    }
    i++;
  }
  return cues;
}

const SPEED_OPTIONS = [0.75, 1, 1.25, 1.5, 2];

export default function VideoPlayerModal({
  isOpen,
  onClose,
  video,
  onExternalLaunch,
}: VideoPlayerModalProps) {
  const { t } = useLocale();
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  /** HLS effective time hesabı için senkron offset (React state gecikmesinden bağımsız). */
  const hlsOffsetRef = useRef(0);
  const isHlsStreamRef = useRef(false);
  /** Aktif sunucu HLS oturumu — kapanışta FFmpeg kill için. */
  const hlsSessionRef = useRef<string | null>(null);
  /** Yeni HLS oturumu açıldıktan sonra istenen mutlak zamana yaklaşmak için. */
  const pendingRelativeSeekRef = useRef<number | null>(null);
  /** Eski async seek sonuçlarının üzerine yazmasını engeller. */
  const seekGenerationRef = useRef(0);
  /** Parent video=null yapsa bile teardown sırasında <video> mount kalsın. */
  const [mountedVideo, setMountedVideo] = useState<VideoPlayerItem | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [totalDuration, setTotalDuration] = useState(0);
  const [hlsOffset, setHlsOffset] = useState(0);
  const [isHlsStream, setIsHlsStream] = useState(false);

  const [volume, setVolume] = useState(() => {
    const s = localStorage.getItem('kura-video-volume');
    return s ? parseFloat(s) : 1;
  });
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [showSubtitleMenu, setShowSubtitleMenu] = useState(false);
  const [showExternalOption] = useState(() => {
    if (!isRunningInTauri()) return false;
    return localStorage.getItem('kura-show-external-video-player') === 'true';
  });

  // Altyazı ve Özel Altyazı Ayarları
  const [subtitleEnabled, setSubtitleEnabled] = useState(true);
  const [subtitleCues, setSubtitleCues] = useState<SubtitleCue[]>([]);
  const [subSettings, setSubSettings] = useState<SubtitleSettings>(() => {
    try {
      const saved = localStorage.getItem('kura-sub-settings');
      if (saved) return { ...DEFAULT_SUBTITLE_SETTINGS, ...JSON.parse(saved) };
    } catch {}
    return DEFAULT_SUBTITLE_SETTINGS;
  });

  const [syncToast, setSyncToast] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updateSubSettings = (partial: Partial<SubtitleSettings>) => {
    setSubSettings((prev) => {
      const next = { ...prev, ...partial };
      localStorage.setItem('kura-sub-settings', JSON.stringify(next));
      return next;
    });
  };

  const showToast = (msg: string) => {
    setSyncToast(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => {
      setSyncToast(null);
    }, 1600);
  };

  // Kontrollerin görünürlüğü
  const [controlsVisible, setControlsVisible] = useState(true);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Scrubber hover önizleme
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverPos, setHoverPos] = useState<number>(0);

  // Hata durumu ve devam etme (resume)
  const [hasError, setHasError] = useState(false);
  const [resumePrompt, setResumePrompt] = useState<number | null>(null);

  // Parent isOpen/video değişince local mount kopyasını yönet
  useEffect(() => {
    if (isOpen && video) {
      setMountedVideo(video);
    }
  }, [isOpen, video]);

  // Parent kapattığında (müzik exclusive vb.) — video hâlâ mountken teardown
  useEffect(() => {
    if (!isOpen && mountedVideo) {
      teardownMedia();
      setMountedVideo(null);
    }
  }, [isOpen, mountedVideo]);

  // 1. Altyazıyı çek ve ayrıştır
  useEffect(() => {
    const item = mountedVideo;
    if (!isOpen || !item) {
      setSubtitleCues([]);
      return;
    }

    const url = subtitleUrl(item.filePath, item.subtitlePath ?? undefined);
    let cancelled = false;

    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error('No subtitles');
        return res.text();
      })
      .then((vttText) => {
        if (cancelled) return;
        const parsed = parseVtt(vttText);
        setSubtitleCues(parsed);
      })
      .catch(() => {
        if (!cancelled) setSubtitleCues([]);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, mountedVideo?.filePath, mountedVideo?.subtitlePath]);

  // 2. Medya süresini hızlıca tespit et (<50ms probe)
  useEffect(() => {
    const item = mountedVideo;
    if (!isOpen || !item) return;

    const initialDur = item.duration ?? 0;
    setTotalDuration(initialDur);

    if (initialDur <= 0) {
      let cancelled = false;
      probeMediaDuration(item.filePath).then((dur) => {
        if (!cancelled && dur && dur > 0) {
          setTotalDuration(dur);
        }
      });
      return () => {
        cancelled = true;
      };
    }
  }, [isOpen, mountedVideo?.filePath, mountedVideo?.duration]);

  // 3. Medyayı başlat (Native MP4 vs HLS.js)
  const destroyHlsClient = () => {
    if (hlsRef.current) {
      hlsRef.current.stopLoad();
      hlsRef.current.detachMedia();
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
  };

  const stopServerHlsSession = () => {
    const session = hlsSessionRef.current;
    hlsSessionRef.current = null;
    if (session) {
      void stopHlsSession(session);
    }
  };

  const teardownMedia = () => {
    destroyHlsClient();
    stopServerHlsSession();
    const el = videoRef.current;
    if (el) {
      el.pause();
      el.removeAttribute('src');
      el.load();
    }
    hlsOffsetRef.current = 0;
    isHlsStreamRef.current = false;
    pendingRelativeSeekRef.current = null;
  };

  const applyHlsOffset = (seconds: number) => {
    hlsOffsetRef.current = seconds;
    setHlsOffset(seconds);
  };

  const syncEffectiveTime = () => {
    const el = videoRef.current;
    if (!el) return;
    const raw = el.currentTime || 0;
    const effective = isHlsStreamRef.current ? hlsOffsetRef.current + raw : raw;
    setCurrentTime(effective);
  };

  const loadMedia = (startSeconds = 0, seekTargetAbsolute?: number) => {
    const item = mountedVideo;
    if (!item) return;
    const videoEl = videoRef.current;
    if (!videoEl) return;

    setHasError(false);
    setIsBuffering(true);

    // Önceki sunucu oturumunu ve istemci HLS'ini temizle
    destroyHlsClient();
    stopServerHlsSession();

    const videoSrc = streamVideoUrl(item.filePath, startSeconds);
    const isHls = videoSrc.includes('.m3u8');
    isHlsStreamRef.current = isHls;
    setIsHlsStream(isHls);

    if (isHls) {
      hlsSessionRef.current = hlsSessionId(item.filePath, startSeconds);
      const relative =
        seekTargetAbsolute !== undefined && seekTargetAbsolute > startSeconds
          ? seekTargetAbsolute - startSeconds
          : null;
      pendingRelativeSeekRef.current = relative;

      if (Hls.isSupported()) {
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: false,
          maxBufferLength: 60,
          maxMaxBufferLength: 120,
          backBufferLength: 30,
        });
        hlsRef.current = hls;

        hls.loadSource(videoSrc);
        hls.attachMedia(videoEl);

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          setIsBuffering(false);
          const rel = pendingRelativeSeekRef.current;
          pendingRelativeSeekRef.current = null;
          videoEl.currentTime = rel && rel > 0.15 ? rel : 0;
          videoEl.play().catch(() => {
            setIsPlaying(false);
            setControlsVisible(true);
          });
          setIsPlaying(true);
          syncEffectiveTime();
        });

        hls.on(Hls.Events.ERROR, (_, data) => {
          if (data.fatal) {
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                hls.startLoad();
                break;
              case Hls.ErrorTypes.MEDIA_ERROR:
                hls.recoverMediaError();
                break;
              default:
                hls.destroy();
                setHasError(true);
                break;
            }
          }
        });
      } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
        videoEl.src = videoSrc;
        videoEl.play().catch(() => {});
      } else {
        setHasError(true);
      }
    } else {
      hlsSessionRef.current = null;
      pendingRelativeSeekRef.current = null;
      // Standart MP4 / WebM / MOV
      videoEl.src = videoSrc;
      if (startSeconds > 0) {
        videoEl.currentTime = startSeconds;
      }
      videoEl.play().catch(() => {
        setIsPlaying(false);
        setControlsVisible(true);
      });
    }
  };

  useEffect(() => {
    if (!isOpen || !mountedVideo) return;

    setCurrentTime(0);
    applyHlsOffset(0);
    setIsPlaying(false);
    setControlsVisible(true);

    loadMedia(0);

    // Kaldığı yerden devam etme kontrolü
    const savedPos = localStorage.getItem(`kura-resume-${mountedVideo.filePath}`);
    if (savedPos) {
      const pos = parseFloat(savedPos);
      if (pos > 10) {
        setResumePrompt(pos);
      }
    } else {
      setResumePrompt(null);
    }

    return () => {
      // Dosya değişiminde temizle; parent close ayrı effect ile handle edilir
      destroyHlsClient();
      stopServerHlsSession();
    };
  }, [isOpen, mountedVideo?.filePath]);

  // İzleme pozisyonunu kaydet
  useEffect(() => {
    if (!isOpen || !mountedVideo || currentTime < 5) return;
    const filePath = mountedVideo.filePath;
    const interval = setInterval(() => {
      if (currentTime > 10 && totalDuration > 0 && currentTime < totalDuration - 15) {
        localStorage.setItem(`kura-resume-${filePath}`, String(currentTime));
      } else if (totalDuration > 0 && currentTime >= totalDuration - 15) {
        localStorage.removeItem(`kura-resume-${filePath}`);
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [isOpen, mountedVideo, currentTime, totalDuration]);

  // Fare hareketiyle kontrolleri göster
  const handleMouseMove = () => {
    setControlsVisible(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    if (isPlaying && currentTime > 0) {
      hideTimerRef.current = setTimeout(() => {
        setControlsVisible(false);
        setShowSpeedMenu(false);
        setShowSubtitleMenu(false);
      }, 3000);
    }
  };

  // Tam ekran dinleyicisi
  useEffect(() => {
    const handleFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', handleFsChange);
    return () => document.removeEventListener('fullscreenchange', handleFsChange);
  }, []);

  // Global Klavye Kısayolları
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      // Cmd, Ctrl veya Alt basılıyken tek tuşlu kısayolları tetikleme (Cmd+Q, Cmd+W, Cmd+H vb.)
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        seekRelative(e.shiftKey ? 30 : 10);
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        seekRelative(e.shiftKey ? -30 : -10);
      } else if (e.code === 'ArrowUp') {
        e.preventDefault();
        changeVolume(0.1);
      } else if (e.code === 'ArrowDown') {
        e.preventDefault();
        changeVolume(-0.1);
      } else if (e.key.toLowerCase() === 'f') {
        e.preventDefault();
        toggleFullscreen();
      } else if (e.key.toLowerCase() === 'm') {
        e.preventDefault();
        toggleMute();
      } else if (e.key.toLowerCase() === 'g') {
        e.preventDefault();
        const next = Number(((subSettings.offset || 0) - 0.25).toFixed(2));
        updateSubSettings({ offset: next });
        showToast(t('player.subToast', { offset: `${next > 0 ? '+' : ''}${next.toFixed(2)}` }));
      } else if (e.key.toLowerCase() === 'h') {
        e.preventDefault();
        const next = Number(((subSettings.offset || 0) + 0.25).toFixed(2));
        updateSubSettings({ offset: next });
        showToast(t('player.subToast', { offset: `${next > 0 ? '+' : ''}${next.toFixed(2)}` }));
      } else if (e.key === 'Escape') {
        if (isFullscreen) {
          document.exitFullscreen().catch(() => {});
        } else {
          teardownMedia();
          onClose();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isPlaying, isFullscreen, volume, isMuted, currentTime, totalDuration, isHlsStream, hlsOffset, subSettings.offset]);

  const handleClose = () => {
    teardownMedia();
    setMountedVideo(null);
    onClose();
  };

  if (!mountedVideo) return null;

  const displayVideo = mountedVideo;

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      videoRef.current.play().catch(() => {});
      setIsPlaying(true);
    } else {
      videoRef.current.pause();
      setIsPlaying(false);
      setControlsVisible(true);
    }
  };

  const handleSeek = (targetSeconds: number) => {
    const bounded = Math.max(0, Math.min(totalDuration || Infinity, targetSeconds));
    setControlsVisible(true);

    if (!isHlsStreamRef.current) {
      if (videoRef.current) {
        videoRef.current.currentTime = bounded;
        setCurrentTime(bounded);
      }
      return;
    }

    // HLS akışı: Eğer aranan nokta mevcut segment tamponunun içindeyse
    const offset = hlsOffsetRef.current;
    const relativeTarget = bounded - offset;
    const currentDuration = videoRef.current?.duration || 0;

    if (relativeTarget >= 0 && relativeTarget <= currentDuration) {
      if (videoRef.current) {
        videoRef.current.currentTime = relativeTarget;
        setCurrentTime(bounded);
      }
      return;
    }

    // Tampon dışı: gerçek keyframe zamanını bul, FFmpeg'i oradan başlat
    void (async () => {
      const gen = ++seekGenerationRef.current;
      setIsBuffering(true);

      let actualStart = bounded;
      const probed = await probeKeyframeBefore(displayVideo.filePath, bounded);
      if (gen !== seekGenerationRef.current) return;

      if (probed !== null && Number.isFinite(probed)) {
        actualStart = Math.max(0, Math.min(bounded, probed));
      }

      destroyHlsClient();
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.currentTime = 0;
      }

      applyHlsOffset(actualStart);
      setCurrentTime(bounded);
      loadMedia(actualStart, bounded);
    })();
  };

  const seekRelative = (delta: number) => {
    handleSeek(currentTime + delta);
  };

  const changeVolume = (delta: number) => {
    const next = Math.max(0, Math.min(1, volume + delta));
    setVolume(next);
    setIsMuted(next === 0);
    if (videoRef.current) {
      videoRef.current.volume = next;
      videoRef.current.muted = next === 0;
    }
    localStorage.setItem('kura-video-volume', String(next));
  };

  const toggleMute = () => {
    if (!videoRef.current) return;
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    videoRef.current.muted = nextMuted;
  };

  const handleVolumeSlider = (val: number) => {
    setVolume(val);
    setIsMuted(val === 0);
    if (videoRef.current) {
      videoRef.current.volume = val;
      videoRef.current.muted = val === 0;
    }
    localStorage.setItem('kura-video-volume', String(val));
  };

  const toggleFullscreen = async () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      await containerRef.current.requestFullscreen().catch(() => {});
    } else {
      await document.exitFullscreen().catch(() => {});
    }
  };

  const handleSpeedSelect = (speed: number) => {
    setPlaybackSpeed(speed);
    if (videoRef.current) videoRef.current.playbackRate = speed;
    setShowSpeedMenu(false);
  };

  const handleScrubberMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (totalDuration <= 0 || (isBuffering && currentTime === 0)) {
      setHoverTime(null);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setHoverTime(ratio * totalDuration);
    setHoverPos(e.clientX);
  };

  const handleScrubberClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (totalDuration <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    handleSeek(ratio * totalDuration);
  };

  const launchExternally = async (targetApp = 'system') => {
    const filePath = displayVideo.filePath;
    teardownMedia();
    setMountedVideo(null);
    onClose();
    onExternalLaunch?.();
    await launchPlayer({ filePath, targetApp }).catch(() => {});
  };

  const resumeAtSaved = () => {
    if (resumePrompt) {
      handleSeek(resumePrompt);
      setResumePrompt(null);
    }
  };

  const progressPercent = totalDuration > 0 ? (currentTime / totalDuration) * 100 : 0;

  // Aktif Altyazı Cues (Zaman senkron ayarıyla hesaplanır)
  const adjustedTime = currentTime + (subSettings.offset || 0);
  const activeCues =
    subtitleEnabled && subtitleCues.length > 0
      ? subtitleCues.filter((c) => adjustedTime >= c.start && adjustedTime <= c.end)
      : [];

  return (
    <div
      ref={containerRef}
      onMouseMove={handleMouseMove}
      className={`fixed inset-0 z-50 flex flex-col justify-between bg-black select-none ${
        !isOpen ? 'invisible pointer-events-none' : ''
      } ${
        !controlsVisible && isPlaying ? 'cursor-none' : 'cursor-default'
      }`}
    >
      {/* 1. Video Elementi (Native HTML5) */}
      <video
        ref={videoRef}
        playsInline
        preload="auto"
        onClick={togglePlay}
        onTimeUpdate={syncEffectiveTime}
        onSeeked={syncEffectiveTime}
        onDurationChange={() => {
          if (videoRef.current) {
            const nativeDur = videoRef.current.duration;
            if (!isHlsStreamRef.current && nativeDur && !isNaN(nativeDur) && nativeDur > 0) {
              setTotalDuration(nativeDur);
            }
          }
        }}
        onWaiting={() => setIsBuffering(true)}
        onPlaying={() => {
          setIsBuffering(false);
          setIsPlaying(true);
        }}
        onCanPlay={() => setIsBuffering(false)}
        onPlay={() => setIsPlaying(true)}
        onPause={() => {
          setIsPlaying(false);
          setControlsVisible(true);
        }}
        onError={() => {
          setIsBuffering(false);
          setHasError(true);
        }}
        className={`absolute inset-0 h-full w-full object-contain ${
          !controlsVisible && isPlaying ? 'cursor-none' : 'cursor-pointer'
        }`}
      />

      {/* 2. Özel Altyazı Katmanı (Merkezi, Şık ve Ayarlanabilir) */}
      {activeCues.length > 0 && (
        <div
          className={`absolute left-0 right-0 z-25 flex justify-center pointer-events-none px-6 transition-all duration-200 ${
            subSettings.position === 'letterbox'
              ? controlsVisible
                ? 'bottom-28 sm:bottom-32'
                : 'bottom-6 sm:bottom-8'
              : controlsVisible
              ? 'bottom-36 sm:bottom-40'
              : 'bottom-16 sm:bottom-20'
          }`}
        >
          <div className="max-w-[85%] sm:max-w-[75%] flex flex-col items-center gap-1.5 pointer-events-none">
            {activeCues.map((cue, idx) => (
              <span
                key={idx}
                className={`text-center font-sans tracking-wide whitespace-pre-line leading-relaxed font-semibold transition-all ${
                  subSettings.size === 'sm'
                    ? 'text-sm sm:text-base'
                    : subSettings.size === 'lg'
                    ? 'text-xl sm:text-2xl'
                    : subSettings.size === 'xl'
                    ? 'text-2xl sm:text-3xl'
                    : 'text-base sm:text-xl'
                } ${
                  subSettings.color === 'white'
                    ? 'text-white'
                    : subSettings.color === 'cyan'
                    ? 'text-[#67e8f9]'
                    : 'text-[#facc15]'
                } ${
                  subSettings.background === 'solid'
                    ? 'bg-black px-4 py-1.5 rounded-lg shadow-2xl'
                    : subSettings.background === 'shadow'
                    ? 'bg-transparent px-2 py-0.5 drop-shadow-[0_2px_4px_rgba(0,0,0,1)] [text-shadow:_0_1px_3px_black,_0_2px_6px_black]'
                    : 'bg-black/75 backdrop-blur-xs px-4 py-1.5 rounded-lg shadow-2xl ring-1 ring-white/10'
                }`}
              >
                {cue.text}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 3. Senkron Bildirim Rozeti (G / H tuşları) */}
      {syncToast && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-40 rounded-xl bg-black/85 px-4 py-2 font-mono text-xs font-semibold text-accent shadow-2xl ring-1 ring-white/10 backdrop-blur-md animate-in fade-in duration-150">
          {syncToast}
        </div>
      )}

      {/* 4. Yükleniyor / Arabelleğe Alınıyor Spinner */}
      {isBuffering && !hasError && (
        <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
          <div className="flex flex-col items-center gap-3 rounded-2xl bg-black/60 px-6 py-4 backdrop-blur-md">
            <Loader2 className="h-8 w-8 animate-spin text-accent" />
            <span className="font-mono text-xs text-white/80">{t('player.buffering')}</span>
          </div>
        </div>
      )}

      {/* 5. Kaldığınız Yerden Devam Et Balonu */}
      {resumePrompt && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 rounded-xl bg-surface/95 px-5 py-3 text-xs text-primary shadow-2xl ring-1 ring-border backdrop-blur-md animate-in fade-in slide-in-from-top-4 duration-200">
          <span>
            {t('player.resumePrompt', { time: formatDuration(Math.floor(resumePrompt)) })}
          </span>
          <button
            type="button"
            onClick={resumeAtSaved}
            className="rounded-lg bg-accent px-3 py-1 font-semibold text-background hover:bg-accent-hover transition"
          >
            {t('player.resume')}
          </button>
          <button
            type="button"
            onClick={() => setResumePrompt(null)}
            className="rounded-lg p-1 text-tertiary hover:text-primary transition"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* 6. Hata Durumu (Harici Oynatıcı Seçenekleriyle) */}
      {hasError && (
        <div className="absolute inset-0 z-30 flex items-center justify-center p-6 bg-black/85 backdrop-blur-sm">
          <div className="max-w-md rounded-2xl bg-surface p-7 text-center shadow-2xl ring-1 ring-border space-y-4">
            <h3 className="font-serif text-2xl text-primary font-normal">
              {t('player.playbackFailed')}
            </h3>
            <p className="text-xs text-secondary leading-relaxed">
              {t('player.playbackFailedHint')}
            </p>
            <div className="flex justify-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => launchExternally('IINA')}
                className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-xs font-semibold text-background hover:bg-accent-hover transition"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                <span>{t('player.openWithIina')}</span>
              </button>
              <button
                type="button"
                onClick={() => launchExternally('VLC')}
                className="flex items-center gap-2 rounded-xl bg-surface-hover px-4 py-2.5 text-xs font-medium text-primary ring-1 ring-border hover:bg-border transition"
              >
                <span>{t('player.openWithVlc')}</span>
              </button>
              <button
                type="button"
                onClick={handleClose}
                className="rounded-xl px-4 py-2.5 text-xs text-tertiary hover:text-primary transition"
              >
                {t('common.close')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 7. Üst Kontrol Barı (Başlık, Kapat, Harici Oynatıcı) */}
      <div
        className={`relative z-30 flex items-center justify-between p-6 sm:p-8 bg-gradient-to-b from-black/85 via-black/40 to-transparent transition-opacity duration-300 ${
          controlsVisible || !isPlaying ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        {/* Sol: Geri butonu + Başlık */}
        <div className="flex items-center gap-4 min-w-0">
          <button
            type="button"
            onClick={handleClose}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-primary ring-1 ring-white/10 hover:bg-white/20 transition backdrop-blur-md"
            title={t('common.closeEsc')}
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0">
            <h2 className="font-serif text-lg sm:text-xl font-normal text-white truncate tracking-tight">
              {displayVideo.title}
            </h2>
            {displayVideo.subTitle && (
              <p className="text-xs text-secondary truncate mt-0.5">{displayVideo.subTitle}</p>
            )}
          </div>
        </div>

        {/* Sağ: Harici Oynatıcı (yalnızca kullanıcı ayarlardan bilerek açtıysa) + Kapat */}
        <div className="flex items-center gap-2.5">
          {showExternalOption && isRunningInTauri() && (
            <button
              type="button"
              onClick={() => launchExternally('IINA')}
              className="flex items-center gap-1.5 rounded-lg bg-black/50 px-3 py-1.5 text-xs font-medium text-secondary ring-1 ring-white/10 hover:bg-white/15 hover:text-white transition backdrop-blur-md"
              title={t('player.openExternally')}
            >
              <ExternalLink className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">IINA / VLC</span>
            </button>
          )}
          <button
            type="button"
            onClick={handleClose}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-tertiary ring-1 ring-white/10 hover:bg-white/20 hover:text-white transition backdrop-blur-md"
            title={t('common.close')}
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* 8. Alt Kontrol Barı (Scrubber + Oynatma Araçları) */}
      <div
        className={`relative z-30 flex flex-col justify-end bg-gradient-to-t from-black/90 via-black/50 to-transparent p-6 sm:p-8 pt-12 transition-opacity duration-300 ${
          controlsVisible || !isPlaying ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        {/* Scrubber İlerleme Çubuğu */}
        <div
          onMouseMove={handleScrubberMove}
          onMouseLeave={() => setHoverTime(null)}
          onClick={handleScrubberClick}
          className="group/scrub relative flex h-6 w-full cursor-pointer items-center"
        >
          {/* Arka plan rayı */}
          <div className="h-1.5 group-hover/scrub:h-2 w-full rounded-full bg-white/20 transition-all">
            {/* İlerleme */}
            <div
              className="relative h-full rounded-full bg-accent"
              style={{ width: `${progressPercent}%` }}
            >
              {/* Tutamak (Thumb) */}
              <div className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 h-3.5 w-3.5 rounded-full bg-white shadow-lg opacity-0 group-hover/scrub:opacity-100 transition-opacity" />
            </div>
          </div>

          {/* Hover Süre Önizleme Balonu */}
          {hoverTime !== null && totalDuration > 0 && !(isBuffering && currentTime === 0) && (
            <div
              className="absolute bottom-6 -translate-x-1/2 rounded bg-black/90 px-2 py-0.5 font-mono text-[11px] text-white shadow-lg ring-1 ring-white/20 pointer-events-none backdrop-blur-sm"
              style={{ left: `${hoverPos}px` }}
            >
              {formatDuration(Math.floor(hoverTime))}
            </div>
          )}
        </div>

        {/* Alt Butonlar Satırı */}
        <div className="flex items-center justify-between mt-3 text-white">
          {/* Sol: Oynat, 10s Geri/İleri, Süre */}
          <div className="flex items-center gap-4 sm:gap-6">
            <button
              type="button"
              onClick={togglePlay}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-accent text-background hover:bg-accent-hover transition shadow-md"
              title={isPlaying ? t('player.pauseSpace') : t('player.playSpace')}
            >
              {isPlaying ? <Pause className="h-5 w-5 fill-current" /> : <Play className="h-5 w-5 fill-current ml-0.5" />}
            </button>

            <button
              type="button"
              onClick={() => seekRelative(-10)}
              className="text-white/80 hover:text-white transition p-1"
              title={t('player.seekBack10')}
            >
              <RotateCcw className="h-5 w-5" />
            </button>

            <button
              type="button"
              onClick={() => seekRelative(10)}
              className="text-white/80 hover:text-white transition p-1"
              title={t('player.seekFwd10')}
            >
              <RotateCw className="h-5 w-5" />
            </button>

            {/* Süre — Hazırlanırken yanıltıcı olmaması için --:-- gösterilir */}
            <div className="font-mono text-xs text-white/80 tabular-nums">
              {isBuffering && currentTime === 0 ? (
                <span className="text-white/40">--:-- / --:--</span>
              ) : (
                <>
                  <span>{formatDuration(Math.floor(currentTime))}</span>
                  <span className="mx-1 text-white/40">/</span>
                  <span>{totalDuration > 0 ? formatDuration(Math.floor(totalDuration)) : '--:--'}</span>
                </>
              )}
            </div>
          </div>

          {/* Sağ: Ses, Altyazı, Hız, Tam Ekran */}
          <div className="flex items-center gap-4 sm:gap-5">
            {/* Ses Kontrolü */}
            <div className="flex items-center gap-2 group/vol">
              <button
                type="button"
                onClick={toggleMute}
                className="text-white/80 hover:text-white transition p-1"
                title={isMuted ? t('player.unmuteM') : t('player.muteM')}
              >
                {isMuted || volume === 0 ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={isMuted ? 0 : volume}
                onChange={(e) => handleVolumeSlider(Number(e.target.value))}
                className="h-1 w-16 sm:w-20 cursor-pointer appearance-none rounded-lg bg-white/20 accent-accent transition"
              />
            </div>

            {/* Altyazı Seçici & Kapsamlı Ayarlar Popover */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowSubtitleMenu(!showSubtitleMenu)}
                className={`p-1.5 rounded-lg transition ${
                  subtitleEnabled ? 'text-accent' : 'text-white/60 hover:text-white'
                }`}
                title={t('player.subtitleSettings')}
              >
                <Subtitles className="h-5 w-5" />
              </button>

              {showSubtitleMenu && (
                <div className="absolute bottom-full right-0 mb-3 w-72 rounded-2xl bg-[#18181b]/95 p-3.5 shadow-2xl ring-1 ring-white/10 backdrop-blur-md text-xs text-white/80 z-50 space-y-3 animate-in fade-in zoom-in-95 duration-150">
                  {/* Başlık ve Aç/Kapa Düğmesi */}
                  <div className="flex items-center justify-between pb-2 border-b border-white/10">
                    <div className="flex items-center gap-2">
                      <Subtitles className="h-4 w-4 text-accent" />
                      <span className="font-semibold text-white text-[13px]">{t('player.subtitles')}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSubtitleEnabled(!subtitleEnabled)}
                      className={`px-3 py-1 rounded-full text-[11px] font-semibold transition ${
                        subtitleEnabled
                          ? 'bg-accent text-background shadow'
                          : 'bg-white/10 text-white/60 hover:text-white'
                      }`}
                    >
                      {subtitleEnabled ? t('common.on') : t('common.off')}
                    </button>
                  </div>

                  {subtitleEnabled && (
                    <>
                      {/* Boyut */}
                      <div className="space-y-1.5">
                        <span className="text-[11px] font-medium text-white/50">{t('player.subSize')}</span>
                        <div className="grid grid-cols-4 gap-1">
                          {[
                            { id: 'sm', label: t('player.subSizeSm') },
                            { id: 'md', label: t('player.subSizeMd') },
                            { id: 'lg', label: t('player.subSizeLg') },
                            { id: 'xl', label: t('player.subSizeXl') },
                          ].map((s) => (
                            <button
                              key={s.id}
                              type="button"
                              onClick={() => updateSubSettings({ size: s.id as SubtitleSettings['size'] })}
                              className={`py-1 rounded text-[11px] font-medium transition text-center ${
                                subSettings.size === s.id
                                  ? 'bg-accent text-background font-semibold shadow'
                                  : 'bg-white/5 hover:bg-white/10 text-white/70'
                              }`}
                            >
                              {s.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Yazı Rengi */}
                      <div className="space-y-1.5">
                        <span className="text-[11px] font-medium text-white/50">{t('player.subColor')}</span>
                        <div className="grid grid-cols-3 gap-1.5">
                          {[
                            { id: 'yellow', label: t('player.subYellow'), color: '#facc15' },
                            { id: 'white', label: t('player.subWhite'), color: '#ffffff' },
                            { id: 'cyan', label: t('player.subCyan'), color: '#67e8f9' },
                          ].map((c) => (
                            <button
                              key={c.id}
                              type="button"
                              onClick={() => updateSubSettings({ color: c.id as SubtitleSettings['color'] })}
                              className={`flex items-center justify-center gap-1.5 py-1 rounded text-[11px] font-medium transition ${
                                subSettings.color === c.id
                                  ? 'bg-white/20 text-white ring-1 ring-accent font-semibold'
                                  : 'bg-white/5 hover:bg-white/10 text-white/70'
                              }`}
                            >
                              <span className="h-2.5 w-2.5 rounded-full shadow-sm" style={{ backgroundColor: c.color }} />
                              <span>{c.label}</span>
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Arka Plan Stili */}
                      <div className="space-y-1.5">
                        <span className="text-[11px] font-medium text-white/50">{t('player.subBg')}</span>
                        <div className="grid grid-cols-3 gap-1">
                          {[
                            { id: 'translucent', label: t('player.subBgTranslucent') },
                            { id: 'solid', label: t('player.subBgSolid') },
                            { id: 'shadow', label: t('player.subBgShadow') },
                          ].map((bg) => (
                            <button
                              key={bg.id}
                              type="button"
                              onClick={() => updateSubSettings({ background: bg.id as SubtitleSettings['background'] })}
                              className={`py-1 rounded text-[11px] font-medium transition text-center ${
                                subSettings.background === bg.id
                                  ? 'bg-accent text-background font-semibold shadow'
                                  : 'bg-white/5 hover:bg-white/10 text-white/70'
                              }`}
                            >
                              {bg.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Konum: Alt Siyah Bant vs Görüntü Üzeri */}
                      <div className="space-y-1.5">
                        <span className="text-[11px] font-medium text-white/50">{t('player.subPosition')}</span>
                        <div className="grid grid-cols-2 gap-1.5">
                          {[
                            { id: 'letterbox', label: t('player.subLetterbox') },
                            { id: 'video', label: t('player.subOnVideo') },
                          ].map((pos) => (
                            <button
                              key={pos.id}
                              type="button"
                              onClick={() => updateSubSettings({ position: pos.id as SubtitleSettings['position'] })}
                              className={`py-1.5 px-2 rounded text-[11px] font-medium transition text-center ${
                                subSettings.position === pos.id
                                  ? 'bg-accent text-background font-semibold shadow'
                                  : 'bg-white/5 hover:bg-white/10 text-white/70'
                              }`}
                            >
                              {pos.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Senkronizasyon Zaman Ayarı (G / H Kısayolları) */}
                      <div className="space-y-1.5 pt-1 border-t border-white/10">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-medium text-white/50">{t('player.subSync')}</span>
                          {subSettings.offset !== 0 && (
                            <button
                              type="button"
                              onClick={() => updateSubSettings({ offset: 0 })}
                              className="text-[10px] text-accent hover:underline font-medium"
                            >
                              Sıfırla
                            </button>
                          )}
                        </div>
                        <div className="flex items-center justify-between bg-white/5 px-2.5 py-1.5 rounded-lg">
                          <button
                            type="button"
                            onClick={() => updateSubSettings({ offset: Number(((subSettings.offset || 0) - 0.25).toFixed(2)) })}
                            className="h-6 w-6 flex items-center justify-center rounded bg-white/10 text-white font-bold hover:bg-white/20 transition active:scale-95 text-xs"
                            title={t('player.subEarlier')}
                          >
                            -
                          </button>
                          <span className="font-mono text-xs font-semibold text-white">
                            {subSettings.offset === 0
                              ? t('player.subOffsetDefault')
                              : `${subSettings.offset > 0 ? '+' : ''}${subSettings.offset.toFixed(2)}s`}
                          </span>
                          <button
                            type="button"
                            onClick={() => updateSubSettings({ offset: Number(((subSettings.offset || 0) + 0.25).toFixed(2)) })}
                            className="h-6 w-6 flex items-center justify-center rounded bg-white/10 text-white font-bold hover:bg-white/20 transition active:scale-95 text-xs"
                            title={t('player.subLater')}
                          >
                            +
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Hız Seçici */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowSpeedMenu(!showSpeedMenu)}
                className="px-2 py-1 rounded-lg text-xs font-mono text-white/80 hover:text-white hover:bg-white/10 transition"
                title={t('player.speed')}
              >
                {playbackSpeed}x
              </button>

              {showSpeedMenu && (
                <div className="absolute bottom-full right-0 mb-3 w-28 rounded-xl bg-surface p-1.5 shadow-2xl ring-1 ring-border text-xs z-50">
                  {SPEED_OPTIONS.map((speed) => (
                    <button
                      key={speed}
                      type="button"
                      onClick={() => handleSpeedSelect(speed)}
                      className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 transition ${
                        playbackSpeed === speed
                          ? 'bg-accent/15 text-accent font-semibold'
                          : 'text-secondary hover:bg-surface-hover hover:text-primary'
                      }`}
                    >
                      <span>{speed}x</span>
                      {playbackSpeed === speed && <Check className="h-3.5 w-3.5" />}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Tam Ekran */}
            <button
              type="button"
              onClick={toggleFullscreen}
              className="text-white/80 hover:text-white transition p-1"
              title={isFullscreen ? t('player.exitFullscreen') : t('player.fullscreen')}
            >
              {isFullscreen ? <Minimize className="h-5 w-5" /> : <Maximize className="h-5 w-5" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { streamUrl, type MediaItem } from '../api/client';

export type RepeatMode = 'off' | 'all' | 'one';

export interface AudioPlayerContextType {
  currentTrack: MediaItem | null;
  queue: MediaItem[];
  queueIndex: number;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  isMuted: boolean;
  repeatMode: RepeatMode;
  isShuffle: boolean;
  isQueueOpen: boolean;
  playTrack: (track: MediaItem, newQueue?: MediaItem[]) => void;
  playQueue: (tracks: MediaItem[], startIndex?: number) => void;
  togglePlay: () => void;
  pause: () => void;
  resume: () => void;
  nextTrack: () => void;
  prevTrack: () => void;
  seek: (seconds: number) => void;
  setVolume: (v: number) => void;
  toggleMute: () => void;
  toggleRepeat: () => void;
  toggleShuffle: () => void;
  setIsQueueOpen: (open: boolean) => void;
  removeFromQueue: (index: number) => void;
  clearQueue: () => void;
}

const AudioPlayerContext = createContext<AudioPlayerContextType | null>(null);

const VOLUME_STORAGE_KEY = 'lmh-audio-volume';

export function AudioPlayerProvider({ children }: { children: React.ReactNode }) {
  const [currentTrack, setCurrentTrack] = useState<MediaItem | null>(null);
  const [queue, setQueue] = useState<MediaItem[]>([]);
  const [queueIndex, setQueueIndex] = useState<number>(-1);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [volume, setVolumeState] = useState<number>(() => {
    const saved = localStorage.getItem(VOLUME_STORAGE_KEY);
    return saved ? Math.max(0, Math.min(1, parseFloat(saved))) : 0.8;
  });
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>('off');
  const [isShuffle, setIsShuffle] = useState<boolean>(false);
  const [isQueueOpen, setIsQueueOpen] = useState<boolean>(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Audio elementini başlat
  useEffect(() => {
    const audio = new Audio();
    audio.preload = 'metadata';
    audioRef.current = audio;

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
    };

    const handleDurationChange = () => {
      if (!isNaN(audio.duration) && isFinite(audio.duration)) {
        setDuration(audio.duration);
      }
    };

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);

    const handleError = (e: Event) => {
      console.warn('Audio playback error:', e);
      setIsPlaying(false);
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('durationchange', handleDurationChange);
    audio.addEventListener('loadedmetadata', handleDurationChange);
    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('error', handleError);

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('durationchange', handleDurationChange);
      audio.removeEventListener('loadedmetadata', handleDurationChange);
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('error', handleError);
      audio.pause();
      audio.src = '';
    };
  }, []);

  // Ses seviyesi güncellemesi
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = isMuted ? 0 : volume;
    }
  }, [volume, isMuted]);

  // Şarkıyı yükleyip çalma
  const loadAndPlay = useCallback((track: MediaItem) => {
    const audio = audioRef.current;
    if (!audio) return;

    setCurrentTrack(track);
    setCurrentTime(0);
    setDuration(track.duration ?? 0);

    const url = streamUrl(track.file_path);
    audio.src = url;
    audio
      .play()
      .then(() => setIsPlaying(true))
      .catch((err) => {
        console.warn('Otomatik oynatma engellendi veya dosya açılamadı:', err);
        setIsPlaying(false);
      });
  }, []);

  const nextTrack = useCallback(() => {
    if (queue.length === 0) return;

    if (repeatMode === 'one' && currentTrack) {
      if (audioRef.current) {
        audioRef.current.currentTime = 0;
        audioRef.current.play().catch(() => {});
      }
      return;
    }

    if (isShuffle && queue.length > 1) {
      let nextIdx = Math.floor(Math.random() * queue.length);
      if (nextIdx === queueIndex) {
        nextIdx = (nextIdx + 1) % queue.length;
      }
      setQueueIndex(nextIdx);
      loadAndPlay(queue[nextIdx]!);
      return;
    }

    if (queueIndex < queue.length - 1) {
      const nextIdx = queueIndex + 1;
      setQueueIndex(nextIdx);
      loadAndPlay(queue[nextIdx]!);
    } else if (repeatMode === 'all') {
      setQueueIndex(0);
      loadAndPlay(queue[0]!);
    } else {
      setIsPlaying(false);
    }
  }, [queue, queueIndex, repeatMode, isShuffle, currentTrack, loadAndPlay]);

  const prevTrack = useCallback(() => {
    const audio = audioRef.current;
    if (audio && audio.currentTime > 3) {
      audio.currentTime = 0;
      return;
    }

    if (queue.length === 0) return;

    if (queueIndex > 0) {
      const prevIdx = queueIndex - 1;
      setQueueIndex(prevIdx);
      loadAndPlay(queue[prevIdx]!);
    } else if (repeatMode === 'all') {
      const lastIdx = queue.length - 1;
      setQueueIndex(lastIdx);
      loadAndPlay(queue[lastIdx]!);
    } else if (audio) {
      audio.currentTime = 0;
    }
  }, [queue, queueIndex, repeatMode, loadAndPlay]);

  // audio ended dinleyicisi
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleEnded = () => {
      nextTrack();
    };

    audio.addEventListener('ended', handleEnded);
    return () => {
      audio.removeEventListener('ended', handleEnded);
    };
  }, [nextTrack]);

  const playTrack = useCallback(
    (track: MediaItem, newQueue?: MediaItem[]) => {
      if (newQueue && newQueue.length > 0) {
        setQueue(newQueue);
        const idx = newQueue.findIndex((t) => t.file_path === track.file_path);
        setQueueIndex(idx >= 0 ? idx : 0);
      } else {
        setQueue([track]);
        setQueueIndex(0);
      }
      loadAndPlay(track);
    },
    [loadAndPlay],
  );

  const playQueue = useCallback(
    (tracks: MediaItem[], startIndex = 0) => {
      if (!tracks || tracks.length === 0) return;
      const validStart = Math.max(0, Math.min(tracks.length - 1, startIndex));
      setQueue(tracks);
      setQueueIndex(validStart);
      loadAndPlay(tracks[validStart]!);
    },
    [loadAndPlay],
  );

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (audio.paused) {
      if (!currentTrack && queue.length > 0) {
        setQueueIndex(0);
        loadAndPlay(queue[0]!);
      } else {
        audio
          .play()
          .then(() => setIsPlaying(true))
          .catch(() => setIsPlaying(false));
      }
    } else {
      audio.pause();
      setIsPlaying(false);
    }
  }, [currentTrack, queue, loadAndPlay]);

  const pause = useCallback(() => {
    audioRef.current?.pause();
    setIsPlaying(false);
  }, []);

  const resume = useCallback(() => {
    audioRef.current?.play().catch(() => {});
    setIsPlaying(true);
  }, []);

  const seek = useCallback((seconds: number) => {
    const audio = audioRef.current;
    if (audio) {
      audio.currentTime = Math.max(0, seconds);
      setCurrentTime(audio.currentTime);
    }
  }, []);

  const setVolume = useCallback((v: number) => {
    const clamped = Math.max(0, Math.min(1, v));
    setVolumeState(clamped);
    if (clamped > 0) {
      setIsMuted(false);
    }
    localStorage.setItem(VOLUME_STORAGE_KEY, String(clamped));
  }, []);

  const toggleMute = useCallback(() => {
    setIsMuted((m) => !m);
  }, []);

  const toggleRepeat = useCallback(() => {
    setRepeatMode((prev) => {
      if (prev === 'off') return 'all';
      if (prev === 'all') return 'one';
      return 'off';
    });
  }, []);

  const toggleShuffle = useCallback(() => {
    setIsShuffle((s) => !s);
  }, []);

  const removeFromQueue = useCallback(
    (index: number) => {
      setQueue((prev) => {
        const next = [...prev];
        next.splice(index, 1);
        return next;
      });
      if (index < queueIndex) {
        setQueueIndex((i) => i - 1);
      } else if (index === queueIndex) {
        // Çalan şarkı silindiyse bir sonrakine geç veya durdur
        if (queue.length > 1) {
          const nextIdx = index < queue.length - 1 ? index : 0;
          setQueueIndex(nextIdx);
          loadAndPlay(queue[nextIdx]!);
        } else {
          audioRef.current?.pause();
          setCurrentTrack(null);
          setQueueIndex(-1);
          setIsPlaying(false);
        }
      }
    },
    [queue, queueIndex, loadAndPlay],
  );

  const clearQueue = useCallback(() => {
    audioRef.current?.pause();
    setQueue([]);
    setCurrentTrack(null);
    setQueueIndex(-1);
    setIsPlaying(false);
  }, []);

  return (
    <AudioPlayerContext.Provider
      value={{
        currentTrack,
        queue,
        queueIndex,
        isPlaying,
        currentTime,
        duration,
        volume,
        isMuted,
        repeatMode,
        isShuffle,
        isQueueOpen,
        playTrack,
        playQueue,
        togglePlay,
        pause,
        resume,
        nextTrack,
        prevTrack,
        seek,
        setVolume,
        toggleMute,
        toggleRepeat,
        toggleShuffle,
        setIsQueueOpen,
        removeFromQueue,
        clearQueue,
      }}
    >
      {children}
    </AudioPlayerContext.Provider>
  );
}

export function useAudioPlayer() {
  const context = useContext(AudioPlayerContext);
  if (!context) {
    throw new Error('useAudioPlayer must be used within an AudioPlayerProvider');
  }
  return context;
}

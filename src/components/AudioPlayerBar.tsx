import { useEffect, useRef, useState } from 'react';
import {
  ListMusic,
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
import { coverUrl } from '../api/client';
import { useAudioPlayer } from '../context/AudioPlayerContext';
import { formatDuration, formatSize, getAudioQualityInfo } from '../lib/format';
import NowPlayingModal from './NowPlayingModal';

export default function AudioPlayerBar() {
  const {
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
    togglePlay,
    nextTrack,
    prevTrack,
    seek,
    setVolume,
    toggleMute,
    toggleRepeat,
    toggleShuffle,
    setIsQueueOpen,
    playTrack,
    playQueue,
    removeFromQueue,
    clearQueue,
  } = useAudioPlayer();

  const [isNowPlayingOpen, setIsNowPlayingOpen] = useState(false);
  const [hoverSeekTime, setHoverSeekTime] = useState<number | null>(null);
  const [hoverSeekPos, setHoverSeekPos] = useState<number>(0);
  const [isHoveringProgress, setIsHoveringProgress] = useState(false);
  const queueDrawerRef = useRef<HTMLDivElement | null>(null);
  const queueToggleBtnRef = useRef<HTMLButtonElement | null>(null);

  // Kuyruk dışına tıklanınca kapat (açma butonuna tıklandığında çakışmayı önlemek için buton hariç tutulur)
  useEffect(() => {
    if (!isQueueOpen) return;
    const handleOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        queueDrawerRef.current?.contains(target) ||
        queueToggleBtnRef.current?.contains(target)
      ) {
        return;
      }
      setIsQueueOpen(false);
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [isQueueOpen, setIsQueueOpen]);

  if (!currentTrack) return null;

  const currentDuration = duration || currentTrack.duration || 0;
  const progressPercent =
    currentDuration > 0 ? Math.min(100, (currentTime / currentDuration) * 100) : 0;
  const quality = getAudioQualityInfo(currentTrack);
  const cover = coverUrl(currentTrack.album || 'Unknown', currentTrack.artist || 'Unknown');

  // Sade format etiketi: FLAC · 16/44.1
  const compactFormat = `${currentTrack.format.toUpperCase()}${
    currentTrack.bit_depth && currentTrack.sample_rate
      ? ` · ${currentTrack.bit_depth}/${Math.round(currentTrack.sample_rate / 100) / 10}`
      : ''
  }`;

  const handleProgressMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setHoverSeekTime(ratio * currentDuration);
    setHoverSeekPos(e.clientX);
  };

  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    seek(ratio * currentDuration);
  };

  return (
    <>
      {/* Tam Ekran Şimdi Çalıyor Görünümü */}
      <NowPlayingModal
        isOpen={isNowPlayingOpen}
        onClose={() => setIsNowPlayingOpen(false)}
        track={currentTrack}
        queue={queue}
        queueIndex={queueIndex}
        isPlaying={isPlaying}
        currentTime={currentTime}
        duration={currentDuration}
        volume={volume}
        isMuted={isMuted}
        repeatMode={repeatMode}
        isShuffle={isShuffle}
        onTogglePlay={togglePlay}
        onNext={nextTrack}
        onPrev={prevTrack}
        onSeek={seek}
        onSetVolume={setVolume}
        onToggleMute={toggleMute}
        onToggleRepeat={toggleRepeat}
        onToggleShuffle={toggleShuffle}
        onPlayQueueItem={(idx) => playQueue(queue, idx)}
        onPlayTrack={playTrack}
        onRemoveFromQueue={removeFromQueue}
      />

      {/* Sağdan Açılan Kuyruk (Drawer) */}
      {isQueueOpen && (
        <aside
          ref={queueDrawerRef}
          className="fixed bottom-0 right-0 top-0 z-50 flex w-80 sm:w-96 flex-col bg-surface shadow-2xl ring-1 ring-border animate-in slide-in-from-right duration-200"
        >
          <header className="flex items-center justify-between border-b border-border px-4 py-3.5">
            <div className="flex items-center gap-2">
              <span className="font-serif text-base font-normal text-primary">Çalma Sırası</span>
              <span className="rounded-full bg-surface-hover px-2 py-0.5 text-xs text-secondary font-mono">
                {queue.length}
              </span>
            </div>
            <div className="flex items-center gap-3">
              {queue.length > 0 && (
                <button
                  type="button"
                  onClick={clearQueue}
                  className="text-xs text-tertiary hover:text-status-offline transition"
                >
                  Temizle
                </button>
              )}
              <button
                type="button"
                onClick={() => setIsQueueOpen(false)}
                className="text-tertiary hover:text-primary transition p-1"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </header>

          <div className="flex-1 overflow-y-auto divide-y divide-border/40 p-1">
            {queue.map((track, i) => {
              const isCurrent = i === queueIndex;
              return (
                <div
                  key={`${track.file_path}-${i}`}
                  className={`group flex items-center justify-between gap-2.5 rounded-lg px-3 py-2 text-left transition ${
                    isCurrent ? 'bg-accent/15 text-accent' : 'hover:bg-surface-hover text-secondary'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => playQueue(queue, i)}
                    className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                  >
                    <span className="w-5 text-center font-mono text-[11px] text-tertiary">
                      {isCurrent ? (isPlaying ? '▶' : '⏸') : i + 1}
                    </span>
                    <div className="min-w-0 flex-1 truncate">
                      <p
                        className={`truncate text-xs ${
                          isCurrent ? 'font-semibold text-accent' : 'font-medium text-primary'
                        }`}
                      >
                        {track.title}
                      </p>
                      <p className="truncate text-[11px] text-tertiary">
                        {track.artist || 'Bilinmeyen Sanatçı'}
                      </p>
                    </div>
                    <span className="font-mono text-[11px] text-tertiary shrink-0">
                      {formatDuration(track.duration)}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => removeFromQueue(i)}
                    title="Kuyruktan Çıkar"
                    className="opacity-0 group-hover:opacity-100 text-tertiary hover:text-status-offline p-1 transition"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        </aside>
      )}

      {/* Alt Oynatıcı Çubuğu (72px) */}
      <footer className="fixed bottom-0 left-0 right-0 z-40 h-[72px] bg-surface/95 backdrop-blur-2xl border-t border-border select-none shadow-[0_-10px_30px_rgba(0,0,0,0.5)]">
        {/* Üst Kenar Tam Genişlik İlerleme Çubuğu */}
        <div
          className="group/progress absolute -top-[3px] left-0 right-0 h-[6px] cursor-pointer z-50"
          onMouseEnter={() => setIsHoveringProgress(true)}
          onMouseLeave={() => setIsHoveringProgress(false)}
          onMouseMove={handleProgressMouseMove}
          onClick={handleProgressClick}
        >
          {/* Arka Plan İzi */}
          <div className="h-[3px] w-full bg-border-hover transition-all group-hover/progress:h-[5px]" />
          {/* İlerleme Dolgusu */}
          <div
            className="absolute top-0 left-0 h-[3px] bg-accent transition-all group-hover/progress:h-[5px]"
            style={{ width: `${progressPercent}%` }}
          />
          {/* Tutamak (Hover'da görünür) */}
          {isHoveringProgress && (
            <div
              className="absolute -top-[3px] h-3 w-3 -translate-x-1/2 rounded-full bg-accent shadow-md pointer-events-none"
              style={{ left: `${progressPercent}%` }}
            />
          )}

          {/* Zaman Önizleme Balonu (Tooltip) */}
          {isHoveringProgress && hoverSeekTime !== null && (
            <div
              className="absolute -top-7 -translate-x-1/2 rounded bg-black/90 px-1.5 py-0.5 font-mono text-[10px] text-primary shadow-lg ring-1 ring-border pointer-events-none"
              style={{ left: `${hoverSeekPos}px` }}
            >
              {formatDuration(Math.floor(hoverSeekTime))}
            </div>
          )}
        </div>

        {/* 3 Bölge: Sol (Kapak/Şarkı), Orta (Masaüstü Kontroller), Sağ (Mobil Kontroller + Masaüstü Araçlar) */}
        <div className="mx-auto flex h-full max-w-[1600px] items-center justify-between px-3 sm:px-6">
          {/* 1. Sol Bölge: Kapak + Başlık/Sanatçı (Mobilde flex-1 ile genişler) */}
          <div
            className="flex min-w-0 flex-1 md:flex-initial md:w-1/3 items-center gap-2.5 sm:gap-3 cursor-pointer select-none pr-2"
            onClick={() => setIsNowPlayingOpen(true)}
            title="Şimdi Çalıyor görünümünü aç"
          >
            <div className="relative h-11 w-11 sm:h-12 sm:w-12 shrink-0 overflow-hidden rounded-[6px] bg-surface-hover ring-1 ring-border shadow transition hover:opacity-90 active:scale-95">
              <img
                src={cover}
                alt={currentTrack.album || ''}
                className="h-full w-full object-cover"
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                }}
              />
              <div className="absolute inset-0 -z-10 flex items-center justify-center font-serif text-sm text-tertiary">
                {currentTrack.album?.slice(0, 1) || '♪'}
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium text-primary hover:text-accent transition-colors">
                {currentTrack.title}
              </p>
              <p className="truncate text-[11px] text-secondary hover:text-primary transition-colors">
                {currentTrack.artist || 'Bilinmeyen Sanatçı'}
                {currentTrack.album ? (
                  <span className="hidden sm:inline text-tertiary"> — {currentTrack.album}</span>
                ) : null}
              </p>
            </div>
          </div>

          {/* 2. Orta Bölge: Masaüstü Oynatıcı Kontrolleri (Mobilde gizlenir) */}
          <div className="hidden md:flex items-center justify-center gap-4 lg:gap-6">
            <button
              type="button"
              onClick={toggleShuffle}
              title={isShuffle ? 'Karıştırma: Açık' : 'Karıştırma: Kapalı'}
              className={`relative p-1.5 transition ${
                isShuffle ? 'text-accent' : 'text-tertiary hover:text-primary'
              }`}
            >
              <Shuffle className="h-4 w-4" />
              {isShuffle && (
                <span className="absolute bottom-0 left-1/2 -translate-x-1/2 h-1 w-1 rounded-full bg-accent" />
              )}
            </button>
            <button
              type="button"
              onClick={prevTrack}
              title="Önceki"
              className="p-1.5 text-secondary hover:text-primary transition active:scale-95"
            >
              <SkipBack className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={togglePlay}
              title={isPlaying ? 'Duraklat' : 'Oynat'}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-accent text-background shadow-md hover:scale-105 active:scale-95 transition-all"
            >
              {isPlaying ? (
                <Pause className="h-5 w-5 fill-current" />
              ) : (
                <Play className="h-5 w-5 fill-current ml-0.5" />
              )}
            </button>
            <button
              type="button"
              onClick={nextTrack}
              title="Sonraki"
              className="p-1.5 text-secondary hover:text-primary transition active:scale-95"
            >
              <SkipForward className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={toggleRepeat}
              title={
                repeatMode === 'off'
                  ? 'Tekrar: Kapalı'
                  : repeatMode === 'all'
                  ? 'Tekrar: Tüm Kuyruk'
                  : 'Tekrar: Aynı Parça'
              }
              className={`relative p-1.5 transition ${
                repeatMode !== 'off' ? 'text-accent' : 'text-tertiary hover:text-primary'
              }`}
            >
              {repeatMode === 'one' ? (
                <Repeat1 className="h-4 w-4" />
              ) : (
                <Repeat className="h-4 w-4" />
              )}
              {repeatMode !== 'off' && (
                <span className="absolute bottom-0 left-1/2 -translate-x-1/2 h-1 w-1 rounded-full bg-accent" />
              )}
            </button>
          </div>

          {/* 3. Sağ Bölge: Mobilde Kompakt Oynatıcı Kontrolleri + Masaüstünde Süre, Format, Ses, Kuyruk */}
          <div className="flex items-center justify-end gap-1.5 sm:gap-3 md:gap-4 md:w-1/3 shrink-0">
            {/* Mobilde Hızlı Kontroller (md:hidden) */}
            <div className="flex md:hidden items-center gap-1">
              <button
                type="button"
                onClick={prevTrack}
                title="Önceki"
                className="p-2 text-secondary hover:text-primary active:scale-95 transition"
              >
                <SkipBack className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={togglePlay}
                title={isPlaying ? 'Duraklat' : 'Oynat'}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-background shadow active:scale-95 transition"
              >
                {isPlaying ? (
                  <Pause className="h-4 w-4 fill-current" />
                ) : (
                  <Play className="h-4 w-4 fill-current ml-0.5" />
                )}
              </button>
              <button
                type="button"
                onClick={nextTrack}
                title="Sonraki"
                className="p-2 text-secondary hover:text-primary active:scale-95 transition"
              >
                <SkipForward className="h-4 w-4" />
              </button>
            </div>

            {/* Süre (Masaüstü) */}
            <span className="hidden md:inline font-mono text-xs text-tertiary tabular-nums">
              {formatDuration(Math.floor(currentTime)) || '0:00'} /{' '}
              {formatDuration(Math.floor(currentDuration)) || '0:00'}
            </span>

            {/* Format Etiketi + Hi-Res Vurgu Noktası (Geniş Ekran) */}
            <div className="group/fmt relative hidden lg:flex items-center gap-1.5 shrink-0">
              <span className="flex items-center gap-1 rounded bg-surface-hover px-2 py-0.5 font-mono text-[10px] text-secondary ring-1 ring-border cursor-help">
                {quality.isHiRes && (
                  <span className="h-1.5 w-1.5 rounded-full bg-accent" title="Hi-Res Audio" />
                )}
                <span>{compactFormat}</span>
              </span>
              {/* Tooltip */}
              <div className="absolute bottom-full right-0 mb-2 hidden group-hover/fmt:block w-48 rounded-lg bg-surface p-2.5 text-[11px] text-secondary shadow-xl ring-1 ring-border z-50">
                <p className="font-semibold text-primary">{quality.fullLabel}</p>
                <p className="text-tertiary mt-1">{formatSize(currentTrack.file_size)}</p>
                <p className="text-tertiary font-mono text-[10px] truncate mt-0.5" title={currentTrack.file_path}>
                  {currentTrack.file_path}
                </p>
              </div>
            </div>

            {/* Ses Kontrolü (sm ve üzeri) */}
            <div className="hidden sm:flex items-center gap-1.5">
              <button
                type="button"
                onClick={toggleMute}
                title={isMuted ? 'Sesi Aç' : 'Sessiz'}
                className="text-tertiary hover:text-primary transition p-1"
              >
                {isMuted || volume === 0 ? (
                  <VolumeX className="h-4 w-4" />
                ) : (
                  <Volume2 className="h-4 w-4" />
                )}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.02}
                value={isMuted ? 0 : volume}
                onChange={(e) => setVolume(Number(e.target.value))}
                className="h-1 w-16 md:w-20 cursor-pointer appearance-none rounded-lg bg-surface-hover accent-accent hover:opacity-100 opacity-80 transition"
              />
            </div>

            {/* Kuyruk Butonu (Her Zaman Erişilebilir) */}
            <button
              ref={queueToggleBtnRef}
              type="button"
              onClick={() => setIsQueueOpen(!isQueueOpen)}
              title="Çalma Sırası"
              className={`rounded-lg p-2 text-xs transition ${
                isQueueOpen
                  ? 'bg-accent text-background'
                  : 'text-tertiary hover:text-primary hover:bg-surface-hover'
              }`}
            >
              <ListMusic className="h-4 w-4" />
            </button>
          </div>
        </div>
      </footer>
    </>
  );
}

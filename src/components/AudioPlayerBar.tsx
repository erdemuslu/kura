import { useEffect, useRef } from 'react';
import { coverUrl } from '../api/client';
import { useAudioPlayer } from '../context/AudioPlayerContext';
import { formatDuration, getAudioQualityInfo } from '../lib/format';

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
    playQueue,
    removeFromQueue,
    clearQueue,
  } = useAudioPlayer();

  const queueRef = useRef<HTMLDivElement | null>(null);

  // Dışarı tıklandığında kuyruk panelini kapatma
  useEffect(() => {
    if (!isQueueOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (queueRef.current && !queueRef.current.contains(e.target as Node)) {
        setIsQueueOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [isQueueOpen, setIsQueueOpen]);

  if (!currentTrack) return null;

  const currentDuration = duration || currentTrack.duration || 0;
  const progressPercent =
    currentDuration > 0 ? Math.min(100, (currentTime / currentDuration) * 100) : 0;
  const qualityInfo = getAudioQualityInfo(currentTrack);

  return (
    <>
      {/* Çalma Sırası (Queue) Paneli */}
      {isQueueOpen && (
        <div
          ref={queueRef}
          className="fixed bottom-24 right-4 z-50 flex max-h-[28rem] w-80 flex-col overflow-hidden rounded-2xl bg-slate-900/95 shadow-2xl ring-1 ring-slate-700 backdrop-blur-md sm:w-96"
        >
          <div className="flex items-center justify-between border-b border-slate-800 p-3">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-slate-100">Çalma Sırası</span>
              <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-400">
                {queue.length}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {queue.length > 0 && (
                <button
                  type="button"
                  onClick={clearQueue}
                  className="text-xs text-slate-400 hover:text-red-400 transition"
                >
                  Temizle
                </button>
              )}
              <button
                type="button"
                onClick={() => setIsQueueOpen(false)}
                className="text-slate-400 hover:text-slate-200 transition text-sm px-1.5"
              >
                ✕
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto divide-y divide-slate-800/60 p-1">
            {queue.map((track, i) => {
              const isCurrent = i === queueIndex;
              return (
                <div
                  key={`${track.file_path}-${i}`}
                  className={`group flex items-center justify-between gap-2 rounded-lg p-2 text-left text-sm transition ${
                    isCurrent
                      ? 'bg-sky-500/15 text-sky-300 font-medium'
                      : 'hover:bg-slate-800/60 text-slate-300'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => playQueue(queue, i)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <span className="w-5 text-center text-xs text-slate-500">
                      {isCurrent ? (isPlaying ? '▶' : '⏸') : i + 1}
                    </span>
                    <div className="min-w-0 flex-1 truncate">
                      <p className="truncate text-xs sm:text-sm text-slate-100">
                        {track.title}
                      </p>
                      <p className="truncate text-[11px] text-slate-400">
                        {track.artist || 'Bilinmeyen Sanatçı'}
                      </p>
                    </div>
                    <span className="text-xs text-slate-400 font-mono">
                      {formatDuration(track.duration)}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => removeFromQueue(i)}
                    title="Kuyruktan Çıkar"
                    className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400 text-xs px-1.5 transition"
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Alt Oynatıcı Çubuğu */}
      <footer className="fixed bottom-0 left-0 right-0 z-40 border-t border-slate-800 bg-slate-950/95 backdrop-blur-lg text-slate-100 shadow-2xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-2.5">
          {/* Sol: Parça Bilgileri & Albüm Kapağı */}
          <div className="flex min-w-0 items-center gap-3 w-1/4 sm:w-1/3">
            <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-gradient-to-br from-emerald-600/30 to-teal-900/40 ring-1 ring-slate-700">
              <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-white/20">
                {currentTrack.album?.trim().slice(0, 1).toUpperCase() || '♪'}
              </span>
              <img
                src={coverUrl(
                  currentTrack.album || 'Unknown',
                  currentTrack.artist || 'Unknown',
                )}
                alt={currentTrack.album || ''}
                className="absolute inset-0 h-full w-full object-cover"
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                }}
              />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-slate-100" title={currentTrack.title}>
                {currentTrack.title}
              </p>
              <p
                className="truncate text-xs text-slate-400"
                title={`${currentTrack.artist || 'Bilinmeyen'} • ${currentTrack.album || ''}`}
              >
                {currentTrack.artist || 'Bilinmeyen Sanatçı'}
                {currentTrack.album ? ` • ${currentTrack.album}` : ''}
              </p>
            </div>
          </div>

          {/* Orta: Kontroller & İlerleme Çubuğu */}
          <div className="flex flex-1 flex-col items-center max-w-xl gap-1">
            <div className="flex items-center gap-3 sm:gap-5">
              <button
                type="button"
                onClick={toggleShuffle}
                title={isShuffle ? 'Karıştırma: Açık' : 'Karıştırma: Kapalı'}
                className={`text-sm transition ${
                  isShuffle ? 'text-sky-400 font-bold' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                🔀
              </button>
              <button
                type="button"
                onClick={prevTrack}
                title="Önceki"
                className="text-slate-300 hover:text-white transition text-base"
              >
                ⏮
              </button>
              <button
                type="button"
                onClick={togglePlay}
                title={isPlaying ? 'Duraklat' : 'Oynat'}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-sky-500 text-white shadow-md transition hover:bg-sky-400 hover:scale-105 active:scale-95"
              >
                {isPlaying ? '⏸' : '▶'}
              </button>
              <button
                type="button"
                onClick={nextTrack}
                title="Sonraki"
                className="text-slate-300 hover:text-white transition text-base"
              >
                ⏭
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
                className={`text-sm transition ${
                  repeatMode !== 'off'
                    ? 'text-sky-400 font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {repeatMode === 'one' ? '🔂' : '🔁'}
              </button>
            </div>

            {/* İlerleme & Zaman Çubuğu */}
            <div className="flex w-full items-center gap-2 text-[11px] font-mono text-slate-400">
              <span className="w-9 text-right shrink-0">
                {formatDuration(Math.floor(currentTime)) || '0:00'}
              </span>
              <div className="relative flex flex-1 items-center">
                <input
                  type="range"
                  min={0}
                  max={currentDuration || 1}
                  step={0.5}
                  value={currentTime}
                  onChange={(e) => seek(Number(e.target.value))}
                  className="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-slate-800 accent-sky-400 hover:bg-slate-700"
                  style={{
                    background: `linear-gradient(to right, rgb(56 189 248) ${progressPercent}%, rgb(30 41 59) ${progressPercent}%)`,
                  }}
                />
              </div>
              <span className="w-9 text-left shrink-0">
                {formatDuration(Math.floor(currentDuration)) || '0:00'}
              </span>
            </div>
          </div>

          {/* Sağ: Kalite Rozeti, Ses Kontrolü & Kuyruk */}
          <div className="flex items-center justify-end gap-3 w-1/4 sm:w-1/3">
            <div className="hidden lg:flex items-center gap-1.5 shrink-0">
              {qualityInfo.isHiRes ? (
                <span
                  title="Hi-Res Kayıpsız Ses (24-bit veya 88.2+ kHz)"
                  className="rounded bg-amber-400/20 px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-amber-300 ring-1 ring-amber-400/40"
                >
                  HI-RES
                </span>
              ) : qualityInfo.isLossless ? (
                <span
                  title="Kayıpsız Ses (Lossless)"
                  className="rounded bg-emerald-400/20 px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-emerald-300 ring-1 ring-emerald-400/40"
                >
                  LOSSLESS
                </span>
              ) : null}
              <span
                title={`${qualityInfo.fullLabel}${qualityInfo.channelsStr ? ` • ${qualityInfo.channelsStr}` : ''}`}
                className="rounded-md bg-slate-800/90 px-2 py-0.5 text-[10px] font-mono text-slate-300 ring-1 ring-slate-700"
              >
                {qualityInfo.fullLabel}
              </span>
            </div>

            <div className="hidden sm:flex items-center gap-1.5">
              <button
                type="button"
                onClick={toggleMute}
                title={isMuted ? 'Sesi Aç' : 'Sessiz'}
                className="text-slate-400 hover:text-slate-200 transition text-sm"
              >
                {isMuted || volume === 0 ? '🔇' : volume < 0.5 ? '🔉' : '🔊'}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.02}
                value={isMuted ? 0 : volume}
                onChange={(e) => setVolume(Number(e.target.value))}
                className="h-1.5 w-16 md:w-20 cursor-pointer appearance-none rounded-lg bg-slate-800 accent-sky-400 hover:bg-slate-700"
              />
            </div>

            <button
              type="button"
              onClick={() => setIsQueueOpen(!isQueueOpen)}
              title="Çalma Sırası"
              className={`relative rounded-lg p-1.5 text-sm transition ${
                isQueueOpen
                  ? 'bg-sky-600 text-white'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              📑
              {queue.length > 0 && (
                <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-sky-500 text-[9px] font-bold text-white">
                  {queue.length > 99 ? '99+' : queue.length}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={clearQueue}
              title="Kapat"
              className="text-slate-500 hover:text-slate-300 text-sm transition px-1"
            >
              ✕
            </button>
          </div>
        </div>
      </footer>
    </>
  );
}

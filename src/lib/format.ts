/** Paylaşılan görüntüleme yardımcıları (kartlar, müzik/film/dizi görünümleri). */
import type { MediaItem } from '../api/client';

export function formatDuration(seconds: number | null): string {
  if (!seconds) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

export function formatSize(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(0)} MB`;
  return `${(bytes / 1_000).toFixed(0)} KB`;
}

/** Parçanın yaklaşık/efektif ses bitrate'ini (kbps) hesaplar. */
export function calculateBitrateKbps(
  fileSizeBytes: number,
  durationSeconds: number | null,
): number | null {
  if (!durationSeconds || durationSeconds <= 0 || fileSizeBytes <= 0) return null;
  return Math.round((fileSizeBytes * 8) / (durationSeconds * 1000));
}

export interface AudioQualityInfo {
  format: string;
  isLossless: boolean;
  isHiRes: boolean;
  sampleRateStr: string | null;
  bitDepthStr: string | null;
  bitrateStr: string | null;
  channelsStr: string | null;
  badgeLabel: string;
  fullLabel: string;
}

/** Parçanın ses formatı, örnekleme hızı, bit derinliği ve bitrate bilgilerini ayrıştırır. */
export function getAudioQualityInfo(item: MediaItem): AudioQualityInfo {
  const ext = (item.format || '').toLowerCase();
  const formatUpper = ext ? ext.toUpperCase() : 'AUDIO';
  const isLossless =
    ['flac', 'wav', 'aiff', 'aif', 'alac'].includes(ext) ||
    (item.bit_depth !== null && item.bit_depth >= 16);
  const isHiRes =
    (item.bit_depth !== null && item.bit_depth >= 24) ||
    (item.sample_rate !== null && item.sample_rate >= 88200);

  let sampleRateStr: string | null = null;
  if (item.sample_rate) {
    const khz = item.sample_rate / 1000;
    sampleRateStr = `${Number.isInteger(khz) ? khz : khz.toFixed(1)} kHz`;
  }

  const bitDepthStr = item.bit_depth ? `${item.bit_depth}-bit` : null;

  const bitrateKbps = calculateBitrateKbps(item.file_size, item.duration);
  const bitrateStr = bitrateKbps ? `${bitrateKbps} kbps` : null;

  let channelsStr: string | null = null;
  if (item.channels === 1) channelsStr = 'Mono';
  else if (item.channels === 2) channelsStr = 'Stereo';
  else if (item.channels && item.channels > 2) channelsStr = `${item.channels} ch`;

  // Kompakt rozet etiketi (şarkı listesi için)
  let badgeLabel = formatUpper;
  if (isLossless) {
    if (bitDepthStr && sampleRateStr) {
      badgeLabel = `${formatUpper} ${item.bit_depth}b/${sampleRateStr.replace(' kHz', 'k')}`;
    } else if (sampleRateStr) {
      badgeLabel = `${formatUpper} ${sampleRateStr}`;
    }
  } else {
    if (bitrateStr) {
      badgeLabel = `${formatUpper} ${bitrateKbps}k`;
    } else if (sampleRateStr) {
      badgeLabel = `${formatUpper} ${sampleRateStr}`;
    }
  }

  // Detaylı etiket (alt oynatıcı çubuğu için)
  const fullParts: string[] = [formatUpper];
  if (bitDepthStr && sampleRateStr) {
    fullParts.push(`${bitDepthStr} / ${sampleRateStr}`);
  } else if (sampleRateStr) {
    fullParts.push(sampleRateStr);
  } else if (bitDepthStr) {
    fullParts.push(bitDepthStr);
  }

  if (bitrateStr) {
    fullParts.push(bitrateStr);
  }

  return {
    format: formatUpper,
    isLossless,
    isHiRes,
    sampleRateStr,
    bitDepthStr,
    bitrateStr,
    channelsStr,
    badgeLabel,
    fullLabel: fullParts.join(' • '),
  };
}

/** Parça için kompakt ses kalitesi rozeti metni: "FLAC 24b/96k" veya "MP3 320k". */
export function formatQuality(item: MediaItem): string {
  return getAudioQualityInfo(item).badgeLabel;
}

/** Oynatıcı çubuğu için detaylı ses kalitesi rozeti: "FLAC • 24-bit / 96 kHz • 2850 kbps". */
export function formatDetailedQuality(item: MediaItem): string {
  return getAudioQualityInfo(item).fullLabel;
}

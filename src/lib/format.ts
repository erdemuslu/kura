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

/** Parça için ses kalitesi rozeti metni: "44.1 kHz • 16 bit". */
export function formatQuality(item: MediaItem): string {
  const parts: string[] = [];
  if (item.sample_rate) {
    const khz = item.sample_rate / 1000;
    parts.push(`${Number.isInteger(khz) ? khz : khz.toFixed(1)} kHz`);
  }
  if (item.bit_depth) parts.push(`${item.bit_depth} bit`);
  return parts.join(' • ');
}

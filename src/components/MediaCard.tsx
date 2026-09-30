import { useState } from 'react';
import { Loader2, Play } from 'lucide-react';

export type CardAspect = '1:1' | '2:3';

export interface MediaCardProps {
  title: string;
  subtitle?: string | null;
  meta?: string | null;
  coverUrl?: string | null;
  aspect?: CardAspect;
  badges?: string[];
  isPlaying?: boolean;
  onClick: () => void;
  onPlayHover?: () => void;
  playHoverLoading?: boolean;
  menuActions?: { label: string; onClick: () => void; disabled?: boolean }[];
}

/**
 * Birleşik Medya Kartı:
 * - 3 oran desteği: 1:1 (müzik albüm/sanatçı), 2:3 (film & dizi)
 * - Başlık her zaman görselin altında, 2 satır clamp (okunabilirlik garantisi)
 * - Kart yüzeyi/çerçevesi yok; görsel taşır
 * - Görsel köşesinde hover rozetleri (koyu cam zemin, 10px mono)
 * - Hover'da 1.02 ölçek + yumuşak derin gölge
 * - Hover play butonu (albümde sağ altta amber, filmde ortada)
 * - Çalan içerikte animasyonlu ekolayzer ve amber başlık
 * - Kapak yoksa nötr sıcak yüzey ve zarif serif baş harf
 */
export default function MediaCard({
  title,
  subtitle,
  meta,
  coverUrl,
  aspect = '2:3',
  badges = [],
  isPlaying = false,
  onClick,
  onPlayHover,
  playHoverLoading = false,
  menuActions,
}: MediaCardProps) {
  const [imgError, setImgError] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const initial = title.trim().slice(0, 1).toUpperCase() || '♪';
  const hasCover = coverUrl && !imgError;

  return (
    <div className="group/card flex flex-col cursor-pointer select-none" onClick={onClick}>
      {/* Görsel Taşıyıcı */}
      <div
        className={`relative w-full overflow-hidden rounded-[6px] bg-surface transition-all duration-200 ease-out group-hover/card:scale-[1.02] group-hover/card:shadow-[0_12px_32px_-12px_rgba(0,0,0,0.65)] ${
          aspect === '1:1' ? 'aspect-square' : 'aspect-[2/3]'
        } ${isPlaying ? 'ring-2 ring-accent' : ''}`}
      >
        {/* Placeholder (görsel yokken veya yüklenirken) */}
        <div className="absolute inset-0 flex items-center justify-center bg-surface-hover text-tertiary">
          <span className="font-serif text-3xl font-light opacity-30 group-hover/card:opacity-50 transition-opacity">
            {initial}
          </span>
        </div>

        {/* Gerçek Kapak Görseli */}
        {hasCover && (
          <img
            src={coverUrl}
            alt={title}
            loading="lazy"
            className="absolute inset-0 h-full w-full object-cover transition-opacity duration-300"
            onError={() => setImgError(true)}
          />
        )}

        {/* Sol Üst: Rozetler (hover'da görünür, koyu cam zemin) */}
        {badges.length > 0 && (
          <div className="absolute left-2 top-2 z-10 flex flex-wrap gap-1 opacity-0 group-hover/card:opacity-100 transition-opacity duration-150 pointer-events-none">
            {badges.map((b) => (
              <span
                key={b}
                className="rounded bg-black/75 px-1.5 py-0.5 font-mono text-[10px] tracking-wide text-secondary backdrop-blur-md"
              >
                {b}
              </span>
            ))}
          </div>
        )}

        {/* Çalan Öğe Göstergesi: Ekolayzer Çubukları */}
        {isPlaying && (
          <div className="absolute left-2.5 bottom-2.5 z-10 flex items-end gap-0.5 rounded bg-black/80 px-1.5 py-1 backdrop-blur-md">
            <span className="h-3 w-0.5 animate-[pulse_0.6s_ease-in-out_infinite] bg-accent" />
            <span className="h-4 w-0.5 animate-[pulse_0.4s_ease-in-out_infinite_0.15s] bg-accent" />
            <span className="h-2 w-0.5 animate-[pulse_0.7s_ease-in-out_infinite_0.3s] bg-accent" />
          </div>
        )}

        {/* Hover Oynat Butonu */}
        {onPlayHover && (
          <div
            className="absolute inset-0 z-10 flex items-center justify-center opacity-0 group-hover/card:opacity-100 transition-opacity duration-150"
            onClick={(e) => {
              e.stopPropagation();
              onPlayHover();
            }}
          >
            {aspect === '1:1' ? (
              // Albümlerde sağ altta amber buton
              <div className="absolute right-2.5 bottom-2.5 flex h-10 w-10 items-center justify-center rounded-full bg-accent text-background shadow-lg transition-transform hover:scale-105 active:scale-95">
                {playHoverLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin text-background" />
                ) : (
                  <Play className="h-4 w-4 fill-current ml-0.5" />
                )}
              </div>
            ) : (
              // Filmlerde ortada yarı saydam zarif daire
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-black/60 text-primary shadow-xl backdrop-blur-md transition-transform hover:scale-110 active:scale-95 hover:bg-accent hover:text-background">
                {playHoverLoading ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Play className="h-5 w-5 fill-current ml-0.5" />
                )}
              </div>
            )}
          </div>
        )}

        {/* Sağ Üst Taşma Menüsü (opsiyonel) */}
        {menuActions && menuActions.length > 0 && (
          <div
            className="absolute right-2 top-2 z-20 opacity-0 group-hover/card:opacity-100 transition-opacity duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setMenuOpen(!menuOpen)}
              className="flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-secondary backdrop-blur-md hover:text-primary transition"
              title="Seçenekler"
            >
              ⋯
            </button>
            {menuOpen && (
              <div
                className="absolute right-0 top-full mt-1 w-44 rounded-lg bg-surface py-1 shadow-2xl ring-1 ring-border z-30"
                onClick={() => setMenuOpen(false)}
              >
                {menuActions.map((action, idx) => (
                  <button
                    key={idx}
                    type="button"
                    disabled={action.disabled}
                    onClick={action.onClick}
                    className="flex w-full items-center px-3 py-1.5 text-left text-xs text-primary hover:bg-surface-hover disabled:opacity-50"
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Metin Alanı — Her Zaman Görselin Altında */}
      <div className="mt-2.5 min-w-0">
        <p
          className={`line-clamp-2 text-[14px] font-medium leading-snug transition-colors ${
            isPlaying ? 'text-accent' : 'text-primary group-hover/card:text-accent'
          }`}
          title={title}
        >
          {title}
        </p>
        {subtitle && (
          <p className="mt-0.5 truncate text-[12px] text-secondary font-normal" title={subtitle}>
            {subtitle}
          </p>
        )}
        {meta && (
          <p className="mt-0.5 truncate text-[11px] text-tertiary font-normal" title={meta}>
            {meta}
          </p>
        )}
      </div>
    </div>
  );
}

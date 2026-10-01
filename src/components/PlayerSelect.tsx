import { AUDIO_PLAYERS, VIDEO_PLAYERS } from '../api/client';
import { useLocale } from '../context/LocaleContext';

interface PlayerSelectProps {
  value: string;
  kind?: 'audio' | 'video';
  onChange: (value: string) => void;
}

/** Hedef oynatıcı seçici (medya türüne göre uygun oynatıcı listesi). */
export default function PlayerSelect({ value, kind = 'audio', onChange }: PlayerSelectProps) {
  const { t } = useLocale();
  const options = kind === 'video' ? VIDEO_PLAYERS : AUDIO_PLAYERS;

  return (
    <label className="flex items-center gap-2 text-sm text-slate-300">
      <span className="hidden shrink-0 sm:inline">{t('players.label')}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg bg-slate-800 px-2 py-1.5 text-sm text-slate-100 ring-1 ring-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-400"
      >
        {options.map((p) => (
          <option key={p.id} value={p.id}>
            {p.labelKey ? t(p.labelKey) : p.label}
          </option>
        ))}
      </select>
    </label>
  );
}

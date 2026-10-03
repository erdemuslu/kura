import { VIDEO_PLAYERS } from '../api/client';
import { useLocale } from '../context/LocaleContext';

interface PlayerSelectProps {
  value: string;
  kind?: 'video';
  onChange: (value: string) => void;
}

/** Hedef oynatıcı seçici (medya türüne göre uygun oynatıcı listesi). */
export default function PlayerSelect({ value, onChange }: PlayerSelectProps) {
  const { t } = useLocale();
  const options = VIDEO_PLAYERS;

  return (
    <label className="flex items-center gap-2 text-xs text-secondary">
      <span className="hidden shrink-0 sm:inline">{t('players.label')}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg bg-surface px-2.5 py-1.5 text-xs text-primary ring-1 ring-border hover:bg-surface-hover focus:outline-none focus:ring-2 focus:ring-accent transition cursor-pointer"
      >
        {options.map((p) => (
          <option key={p.id} value={p.id} className="bg-surface text-primary">
            {p.labelKey ? t(p.labelKey) : p.label}
          </option>
        ))}
      </select>
    </label>
  );
}

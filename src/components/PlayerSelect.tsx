import { PLAYERS } from '../api/client';

interface PlayerSelectProps {
  value: string;
  onChange: (value: string) => void;
}

/** Hedef harici oynatıcı seçici (Rust beyaz listesiyle eşleşir). */
export default function PlayerSelect({ value, onChange }: PlayerSelectProps) {
  return (
    <label className="flex items-center gap-2 text-sm text-slate-300">
      <span className="hidden shrink-0 sm:inline">Oynatıcı</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg bg-slate-800 px-2 py-1.5 text-sm text-slate-100 ring-1 ring-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-400"
      >
        {PLAYERS.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </select>
    </label>
  );
}

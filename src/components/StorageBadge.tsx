import type { DiskInfo } from '../api/client';

interface StorageBadgeProps {
  disk: DiskInfo;
}

/** Disk online/offline durum göstergesi. */
export default function StorageBadge({ disk }: StorageBadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${
        disk.online
          ? 'bg-emerald-500/15 text-emerald-300'
          : 'bg-red-500/15 text-red-300'
      }`}
      title={disk.path}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          disk.online ? 'bg-emerald-400' : 'bg-red-400'
        }`}
      />
      {disk.label}
    </span>
  );
}

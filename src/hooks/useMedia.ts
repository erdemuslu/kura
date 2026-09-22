import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getDisks,
  getLibrary,
  launchPlayer,
  startScan,
  type MediaType,
  type PlayRequest,
} from '../api/client';

/** Kütüphane sorgusu (tür + arama metni). */
export function useLibrary(type: MediaType, query: string) {
  return useQuery({
    queryKey: ['library', type, query],
    queryFn: () => getLibrary(type, query),
  });
}

/** Bağlı diskler; offline tespiti için 15 sn'de bir yenilenir. */
export function useDisks() {
  return useQuery({
    queryKey: ['disks'],
    queryFn: getDisks,
    refetchInterval: 15_000,
  });
}

/** Medya başlatma mutasyonu. */
export function useLaunchPlayer() {
  return useMutation({ mutationFn: (req: PlayRequest) => launchPlayer(req) });
}

/** Dizin tarama mutasyonu; sonrasında kütüphane ve disk sorgularını invalidete eder. */
export function useScan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ path, diskLabel }: { path: string; diskLabel?: string }) =>
      startScan(path, diskLabel),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['library'] });
      queryClient.invalidateQueries({ queryKey: ['disks'] });
    },
  });
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getAlbums,
  getAlbumTracks,
  getArtists,
  getDisks,
  getLibrary,
  launchPlayer,
  startScan,
  type MediaType,
  type PlayRequest,
} from '../api/client';

/** Kütüphane sorgusu (tür + arama metni). `enabled=false` ile müzik
 *  sekmesindeki gereksiz düz-liste sorgusu atlanır (MusicView kendi
 *  hiyerarşik sorgularını kullanır). */
export function useLibrary(type: MediaType, query: string, enabled = true) {
  return useQuery({
    queryKey: ['library', type, query],
    queryFn: () => getLibrary(type, query),
    enabled,
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

/** Müzik tarayıcı sorguları. */
export function useArtists(query: string) {
  return useQuery({
    queryKey: ['music-artists', query],
    queryFn: () => getArtists(query),
  });
}

export function useAlbums(query: string, artist?: string) {
  return useQuery({
    queryKey: ['music-albums', query, artist ?? ''],
    queryFn: () => getAlbums(query, artist),
  });
}

export function useAlbumTracks(album: string, artist: string, enabled: boolean) {
  return useQuery({
    queryKey: ['album-tracks', album, artist],
    queryFn: () => getAlbumTracks(album, artist),
    enabled,
  });
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

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getAlbums,
  getAlbumTracks,
  getArtists,
  getDisks,
  getEpisodes,
  getLibrary,
  getMovies,
  getSeasons,
  getShows,
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

/** Film tarayıcı sorguları. */
export function useMovies(query: string) {
  return useQuery({
    queryKey: ['movies', query],
    queryFn: () => getMovies(query),
  });
}

/** Dizi tarayıcı sorguları. */
export function useShows(query: string) {
  return useQuery({
    queryKey: ['shows', query],
    queryFn: () => getShows(query),
  });
}

export function useSeasons(show: string | null) {
  return useQuery({
    queryKey: ['seasons', show],
    queryFn: () => getSeasons(show!),
    enabled: show !== null,
  });
}

export function useEpisodes(
  show: string | null,
  season: number | null,
  /** season null ise tüm sezonların bölümleri */
  allSeasons: boolean,
) {
  return useQuery({
    queryKey: ['episodes', show, season, allSeasons],
    queryFn: () => getEpisodes(show!, allSeasons ? undefined : season ?? undefined),
    enabled: show !== null && (allSeasons || season !== null),
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

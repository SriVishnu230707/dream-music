import rawCatalog from './catalog.json';
import { selectLongTrackCandidates } from './plan';
export { MIN_FULL_SONG_SECONDS } from './plan';

export type Track = {
  id: string;
  title: string;
  artist: string;
  album?: string;
  genre: string;
  language?: string;
  durationSeconds: number;
  attribution: string;
  audioUrl: string;
  youtubeId?: string;
  spotifyId?: string;
  bpm?: number;
  mood?: { valence: number; arousal: number };
  artworkUrl?: string;
};

// Embed only an explicitly cataloged and well-formed track ID. Search links
// remain available when a track has not been verified for embedded playback.
export function getTrackSpotifyId(track: Track): string | null {
  return track.spotifyId && /^[A-Za-z0-9]{22}$/.test(track.spotifyId)
    ? track.spotifyId
    : null;
}

export function getSpotifySearchUrl(track: Track): string {
  const query = encodeURIComponent(`${track.title} ${track.artist}`);
  return `https://open.spotify.com/search/${query}`;
}

export const CATALOG_TRACKS: Track[] = rawCatalog as Track[];

// The source file repeats video IDs under invented alternate-version labels.
// Keep one canonical entry per video and only songs listed at four minutes or more.
export const LONG_CATALOG_TRACKS: Track[] = selectLongTrackCandidates(CATALOG_TRACKS);

export const CATALOG_MAP: Record<string, Track> = Object.fromEntries(
  CATALOG_TRACKS.map((t) => [t.id, t])
);

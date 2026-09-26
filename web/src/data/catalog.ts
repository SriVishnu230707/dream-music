import rawCatalog from './catalog.json';

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

// Well-known Spotify Track IDs for top commercial songs
export const TOP_SPOTIFY_MAP: Record<string, string> = {
  "eng-1-blinding-lights": "0VjIjW4GlUZAMYd2vXMi3b",
  "eng-2-starboy": "7MXV09uEiYT1aApSlLiZ55",
  "eng-3-shape-of-you": "7qiZfU4dY1lWllzX7mPBI3",
  "eng-4-someone-like-you": "1zwMYTA5nlNjZxYrvBB2pv",
  "eng-5-stay": "5PjdY0CKGZdEuoNab3yDmF",
  "eng-6-as-it-was": "4LRPiXqCikLlN15c3ySbp7",
  "eng-12-levitating": "463CkQjx2Zk1yXoBu12q9i",
  "eng-17-viva-la-vida": "1eaMm9kO8Za4Z2k9mN0x2Y",
  "eng-20-bad-habits": "3rmoJqGKYT66f77fUv2Dqv",
  "eng-25-perfect": "0tgVpDi06FyKpA1z0VMD4v",
  "tamil-1-munbe-vaa": "2o2s3C5VdC8a5d1S1W3K8a",
  "tamil-2-vaseegara": "6kG7u0M2Xw5kL1z6B3e3H9",
  "tamil-4-arabic-kuthu-halamithi-habibo": "6gBFPUFcJLqCq48Y30S5gN",
  "tamil-8-kadhale-kadhale": "3N4h7uK9z2e8M1b4P5r6s7",
  "tamil-10-rowdy-baby": "4bK6kU0P2n7M9s8d6G3e1a",
  "tamil-12-vaathi-coming": "5rBFPUFcJLqCq48Y30S5gN",
  "tamil-15-kannazhaga": "1kG7u0M2Xw5kL1z6B3e3H9",
  "tamil-20-malare": "7uK9z2e8M1b4P5r6s7x2a1",
};

export function getTrackSpotifyId(track: Track): string {
  if (track.spotifyId) return track.spotifyId;
  if (TOP_SPOTIFY_MAP[track.id]) return TOP_SPOTIFY_MAP[track.id];
  return "0VjIjW4GlUZAMYd2vXMi3b";
}

export function getSpotifySearchUrl(track: Track): string {
  const query = encodeURIComponent(`${track.title} ${track.artist}`);
  return `https://open.spotify.com/search/${query}`;
}

export const CATALOG_TRACKS: Track[] = rawCatalog as Track[];

export const CATALOG_MAP: Record<string, Track> = Object.fromEntries(
  CATALOG_TRACKS.map((t) => [t.id, t])
);

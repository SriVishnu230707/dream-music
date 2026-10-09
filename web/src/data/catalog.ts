import rawCatalog from './archiveCatalog.json';
import { selectLongTrackCandidates } from './plan';

export type Track = {
  id: string;
  title: string;
  artist: string;
  album: string;
  genre: string;
  language: 'Instrumental';
  durationSeconds: number;
  attribution: string;
  licenseUrl: string;
  sourceUrl: string;
  audioUrl: string;
  artworkUrl: string;
  mood: { valence: number; arousal: number };
};

export const CATALOG_TRACKS: Track[] = rawCatalog as Track[];
export const LONG_CATALOG_TRACKS = selectLongTrackCandidates(CATALOG_TRACKS);
export const CATALOG_MAP: Record<string, Track> = Object.fromEntries(
  CATALOG_TRACKS.map((track) => [track.id, track]),
);

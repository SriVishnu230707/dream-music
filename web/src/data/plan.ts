export type MoodPoint = { valence: number; arousal: number };
export type PlanTrack = {
  id: string;
  genre: string;
  artist: string;
  language?: string;
  mood?: MoodPoint;
  audioUrl?: string;
};
export type PlannedItem = {
  trackId: string;
  pathPoint: MoodPoint;
  trackMood: MoodPoint;
};
export type ListeningRecord = { trackId: string; listenedSeconds: number; completed: boolean };
export type TasteProfile = { genres: ReadonlyMap<string, number>; artists: ReadonlyMap<string, number> };

const clamp = (value: number) => Math.max(0, Math.min(1, value));

export const MIN_FULL_SONG_SECONDS = 240;

export function selectLongTrackCandidates<T extends { audioUrl?: string; durationSeconds: number }>(tracks: T[]): T[] {
  const seen = new Set<string>();
  return tracks.filter((track) => {
    if (!track.audioUrl || seen.has(track.audioUrl)) return false;
    let source: URL;
    try { source = new URL(track.audioUrl); } catch { return false; }
    if (source.protocol !== 'https:' || source.hostname !== 'archive.org' ||
        !source.pathname.startsWith('/download/')) return false;
    seen.add(track.audioUrl);
    return Number.isFinite(track.durationSeconds) && track.durationSeconds >= MIN_FULL_SONG_SECONDS;
  });
}

export function buildTasteProfile(
  tracks: PlanTrack[], records: ListeningRecord[], likedIds: ReadonlySet<string>,
): TasteProfile {
  const byId = new Map(tracks.map((track) => [track.id, track]));
  const genres = new Map<string, number>();
  const artists = new Map<string, number>();
  const add = (track: PlanTrack, weight: number) => {
    genres.set(track.genre, (genres.get(track.genre) ?? 0) + weight);
    artists.set(track.artist, (artists.get(track.artist) ?? 0) + weight);
  };
  for (const record of records) {
    const track = byId.get(record.trackId);
    if (!track || !Number.isFinite(record.listenedSeconds)) continue;
    const seconds = Math.max(0, record.listenedSeconds);
    // A 30-second preview is useful feedback, but weaker than a full listen.
    const weight = Math.min(seconds / 120, 1) + (record.completed ? 0.25 : 0);
    add(track, seconds < 10 && !record.completed ? -0.25 : weight);
  }
  for (const id of likedIds) {
    const track = byId.get(id);
    if (track) add(track, 1.5);
  }
  return { genres, artists };
}

export function planJourney(
  tracks: PlanTrack[],
  start: MoodPoint,
  target: MoodPoint,
  count: number,
  language: "All" | "Tamil" | "English" = "All",
  excludedIds: ReadonlySet<string> = new Set(),
  taste?: TasteProfile,
): PlannedItem[] {
  if (!Number.isInteger(count) || count < 1 || count > 20 ||
      ![start.valence, start.arousal, target.valence, target.arousal].every(
        (value) => Number.isFinite(value) && value >= 0 && value <= 1,
      )) {
    throw new Error("Invalid journey length or mood coordinates");
  }
  const eligible = tracks.filter((track) =>
    (language === "All" || track.language === language) &&
    !excludedIds.has(track.id) &&
    Boolean(track.audioUrl) &&
    track.mood &&
    Number.isFinite(track.mood.valence) &&
    Number.isFinite(track.mood.arousal) &&
    track.mood.valence >= 0 && track.mood.valence <= 1 &&
    track.mood.arousal >= 0 && track.mood.arousal <= 1,
  );
  if (eligible.length < count) {
    throw new Error(`Only ${eligible.length} playable tracks match this journey`);
  }
  const used = new Set(excludedIds);
  const output: PlannedItem[] = [];
  let previous: PlanTrack | undefined;
  for (let slot = 0; slot < count; slot++) {
    const fraction = count === 1 ? 1 : slot / (count - 1);
    const point = {
      valence: clamp(start.valence + (target.valence - start.valence) * fraction),
      arousal: clamp(start.arousal + (target.arousal - start.arousal) * fraction),
    };
    let best: PlanTrack | undefined;
    let bestScore = Infinity;
    for (const track of eligible) {
      if (used.has(track.id)) continue;
      const mood = track.mood!;
      const moodGap = Math.hypot(mood.valence - point.valence, mood.arousal - point.arousal);
      const transition = previous?.mood
        ? Math.hypot(mood.valence - previous.mood.valence, mood.arousal - previous.mood.arousal)
        : 0;
      const repeatGenre = previous?.genre === track.genre ? 0.025 : 0;
      const repeatArtist = previous?.artist === track.artist ? 0.025 : 0;
      const tasteAffinity = taste
        ? Math.tanh((taste.genres.get(track.genre) ?? 0) / 3) * 0.22 +
          Math.tanh((taste.artists.get(track.artist) ?? 0) / 3) * 0.12
        : 0;
      const score = moodGap + 0.15 * transition + repeatGenre + repeatArtist - tasteAffinity;
      if (score < bestScore || (score === bestScore && track.id < (best?.id ?? ""))) {
        best = track;
        bestScore = score;
      }
    }
    if (!best) throw new Error("No distinct playable track remains");
    used.add(best.id);
    output.push({ trackId: best.id, pathPoint: point, trackMood: best.mood! });
    previous = best;
  }
  return output;
}

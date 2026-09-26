export type MoodPoint = { valence: number; arousal: number };
export type PlanTrack = {
  id: string;
  genre: string;
  artist: string;
  language?: string;
  mood?: MoodPoint;
  audioUrl?: string;
  youtubeId?: string;
};
export type PlannedItem = {
  trackId: string;
  pathPoint: MoodPoint;
  trackMood: MoodPoint;
};

const clamp = (value: number) => Math.max(0, Math.min(1, value));

export function planJourney(
  tracks: PlanTrack[],
  start: MoodPoint,
  target: MoodPoint,
  count: number,
  language: "All" | "Tamil" | "English" = "All",
  excludedIds: ReadonlySet<string> = new Set(),
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
    (Boolean(track.audioUrl) || Boolean(track.youtubeId)) &&
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
    const fraction = count === 1 ? 0 : slot / (count - 1);
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
      const score = moodGap + 0.15 * transition + repeatGenre + repeatArtist;
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

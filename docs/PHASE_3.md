# Phase 3: taste baselines and candidate generation

## Run

First generate and verify the Phase 0 playable catalog, then run the Go tests and local API:

```powershell
npm run generate:demo
npm run verify:phase0
go test ./...
go run ./cmd/taste-api -root . -listen 127.0.0.1:8081
```

Example request to `POST http://127.0.0.1:8081/v1/candidates`:

```json
{
  "userId": "demo-listener",
  "strategy": "taste-explore",
  "limit": 5,
  "preferredGenres": ["ambient"],
  "likedTrackIds": ["night-rain"],
  "events": [{"eventId": "demo-replay-1", "trackId": "soft-shadow", "type": "replay", "listenedSeconds": 12}]
}
```

The response includes `catalogId`, `featureVersion`, `coldStart`, `available`, explicit feature availability, unsupported genres, and ordered playable candidates. An unsupported genre is reported and does not masquerade as personalization. Each candidate includes the audio path, component scores, and a reason. `tasteTotal` is the content score, while `selectionScore` also reflects the shown cold-start diversity penalty or deterministic exploration tie-break. The catalog loader verifies WAV format and non-silent samples; the API rechecks selected audio before responding and returns 503 if a clip disappeared or changed. The API accepts at most 64 KiB per request, rejects unknown JSON fields, and binds to loopback until authentication exists. It holds no user history; the caller supplies events for this request. Phase 6 will implement persistent, idempotent ingestion.

## Feature and score definition

`content-v1` uses only catalog fields that exist. Genre match is categorical; tempo similarity is `1 - min(1, |BPM difference| / 100)`. History affinity averages genre, tempo, and artist similarity over positive interactions. Artist contributes only when the catalog has more than one artist; the current 12 demo clips all use the same artist. Language is explicitly unavailable. Valence and arousal are reserved for Phase 4 sequencing, so taste ranking does not mistake the design-proxy mood coordinates for taste evidence.

Stated liked tracks contribute weight 2. Likes add 2, replays 1.5, and completions 0.75, with a per-track positive cap of 3. Short skips (before half the clip) add a weak negative weight of 0.2, capped at 0.6 per track. Long skips and skips without a known duration have no negative weight. `start` marks a track as heard without changing taste. Duplicate event IDs with identical content count once; conflicting reuse is rejected. These weights are engineering defaults to be revised after real feedback is available.

The popularity baseline uses caller-supplied aggregate counts. Without real counts, every track receives a uniform fallback; this is **not measured popularity**. The taste strategy combines content affinity, stated genre preference, a small popularity term, and a capped negative penalty. Taste-explore reserves about 20% of a multi-track result for unseen playable tracks, chosen deterministically per user. A zero-history user receives genre coverage rather than fabricated personalization. Unknown or unplayable track IDs cause errors; exclusions are applied before ranking.

## Offline evaluation

`go run ./cmd/taste-eval --input <real-cases.jsonl> --k 5` computes macro-averaged Precision@K, Recall@K, and NDCG@K for the same cases and catalog under all three strategies. Each JSONL row needs a `userId`, a `cutoffAt` RFC3339 timestamp, `isSynthetic:false`, history events before the cutoff, and relevant played or liked tracks after it. Each history and relevance item must also explicitly have `isSynthetic:false` and an `occurredAt` timestamp. If preferred genres or popularity counts are present, provide `preferencesAsOf` or `popularityAsOf` no later than the cutoff. The evaluator rejects empty, synthetic, time-leaking, and unplayable cases.

No real listener cases exist yet. The Phase 1 fictional likes are development fixtures and cannot produce a meaningful relevance report. The evaluator is ready for consented events from the future playback app; unit tests check its calculations and guards without claiming product quality.

## Boundary

Phase 3 returns a **candidate pool**, not a mood-drift playlist. Phase 4 will select and order candidates along the listener-confirmed mood path. The API has no authentication or persistence and must remain local until those services are built.

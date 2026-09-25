# Phase 0 API and event contracts

These are version 1 contracts. Phase 2 implements mood prediction and confirmation locally. Phase 3 implements candidate generation locally. Phase 6 implements persisted local sessions and feedback. All coordinates use the inclusive range `[0, 1]`. Requests and responses use JSON and UTF-8.

## `POST /v1/candidates`

Input follows [candidate-request.schema.json](candidate-request.schema.json): `userId`, `strategy` (`popularity`, `taste`, or `taste-explore`), `limit`, and optional stated genres, liked track IDs, exclusions, feedback events, and aggregate popularity counts. The response contains an ordered list of playable candidates with component scores and an explicit feature-availability map. Unknown tracks and conflicting duplicate event IDs are rejected. This local Go endpoint does not persist feedback or generate a mood path; see [Phase 3](../PHASE_3.md).

## `POST /v1/mood/predict`

Input: `{ "text": "I feel a little low and tired" }` (maximum 1,000 characters). Output includes `labels` with scores, `suggestedMood` with valence/arousal or `null`, `confidence`, `modelVersion`, `mappingVersion`, `requiresConfirmation`, `needsManualSelection`, and `reason`. Empty or out-of-vocabulary input has no suggestion and requires manual selection. A low top-label score also prompts manual selection. The scores are model outputs, not calibrated certainty about personal mood.

## `POST /v1/mood/confirm`

Input: `{ "valence": 0.25, "arousal": 0.2, "source": "user-corrected" }`. Output: `{ "startMood": { "valence": 0.25, "arousal": 0.2, "source": "user-corrected", "confidence": null }, "confirmed": true }`. Allowed sources are `manual`, `text-model`, and `user-corrected`. This stateless endpoint checks the coordinate range and returns the shape expected by a future session request. It does not create a session or save text.

## `POST /v1/sessions`

Input conforms to [session-create.schema.json](session-create.schema.json). The confirmed `startMood` is authoritative; `checkInText` can be omitted or `null` and is not persisted. `trackCount` is between 1 and 20. Optional `retentionDays` is 1, 7, or 30 (default 30). The listening API at `/api/v1/sessions` persists the generated queue and returns `sessionId`, `status`, `catalogId`, `revision`, `currentIndex`, ordered `queue`, and `expiresAt`. The Phase 4 planning API remains available separately at `/v1/sessions` on its own local port.

Each queue item includes `position`, `trackId`, `pathPoint`, `score`, and `reason`. `pathPoint` is the requested valence–arousal point for that slot, not a claim about the listener's actual mood. For `trackCount = 1`, it equals `startMood`.

## `GET /v1/sessions/{sessionId}`

`/api/v1/sessions/{sessionId}` returns the persisted current position and queue. The legacy `POST /api/v1/sessions/{sessionId}/advance` accepts an expected revision and `skip` or `complete`; it creates an audited event and moves one track forward atomically.

## `POST /v1/sessions/{sessionId}/events`

The implemented route is `POST /api/v1/sessions/{sessionId}/events`. Input conforms to [feedback-event.schema.json](feedback-event.schema.json), including `expectedRevision`. `eventId` is an idempotency key unique within the session. Retries with the same ID and same payload return the original event outcome with the current session state; reuse with a different payload returns `409`. `start`, `skip`, `complete`, `replay`, and `like` are audited. Feedback can rerank future tracks; the current and played tracks remain fixed. The response includes `accepted`, `revision`, `queueChanged`, `futureReplanned`, and the updated `session`. `GET` on the same route returns the audit events.

## `POST /v1/sessions/{sessionId}/check-ins`

The implemented route is `POST /api/v1/sessions/{sessionId}/check-ins`. Input: `{ "expectedRevision": 2, "valence": 0.4, "arousal": 0.3, "source": "manual" }`. An explicit check-in updates the path for future songs only. `GET` returns saved check-ins; `DELETE` with `{ "expectedRevision": 3 }` removes them and replans future tracks without the last check-in. `DELETE /api/v1/sessions/{sessionId}` removes the session and its events/check-ins. Expired sessions are purged hourly while the server runs and on startup.

## Error rules

- Invalid JSON or out-of-range coordinate: `400` with a field-specific message.
- Unknown session or track: `404`.
- Reused event ID with different content or event for an ineligible track: `409`.
- Catalog has too few distinct playable tracks for the requested queue: `422` with an available count.
- Playback failure is a player state, not proof that the track was disliked.

See [example-session.json](example-session.json) for a complete illustrative request and response. Values are examples; no classifier or ranking engine generated them.

# Phase 0 API and event contracts

These are version 1 contracts. Phase 2 implements mood prediction and confirmation locally. Phase 3 implements candidate generation locally. Phase 4 implements local session queue creation; retrieval and feedback endpoints remain future contracts. All coordinates use the inclusive range `[0, 1]`. Requests and responses use JSON and UTF-8.

## `POST /v1/candidates`

Input follows [candidate-request.schema.json](candidate-request.schema.json): `userId`, `strategy` (`popularity`, `taste`, or `taste-explore`), `limit`, and optional stated genres, liked track IDs, exclusions, feedback events, and aggregate popularity counts. The response contains an ordered list of playable candidates with component scores and an explicit feature-availability map. Unknown tracks and conflicting duplicate event IDs are rejected. This local Go endpoint does not persist feedback or generate a mood path; see [Phase 3](../PHASE_3.md).

## `POST /v1/mood/predict`

Input: `{ "text": "I feel a little low and tired" }` (maximum 1,000 characters). Output includes `labels` with scores, `suggestedMood` with valence/arousal or `null`, `confidence`, `modelVersion`, `mappingVersion`, `requiresConfirmation`, `needsManualSelection`, and `reason`. Empty or out-of-vocabulary input has no suggestion and requires manual selection. A low top-label score also prompts manual selection. The scores are model outputs, not calibrated certainty about personal mood.

## `POST /v1/mood/confirm`

Input: `{ "valence": 0.25, "arousal": 0.2, "source": "user-corrected" }`. Output: `{ "startMood": { "valence": 0.25, "arousal": 0.2, "source": "user-corrected", "confidence": null }, "confirmed": true }`. Allowed sources are `manual`, `text-model`, and `user-corrected`. This stateless endpoint checks the coordinate range and returns the shape expected by a future session request. It does not create a session or save text.

## `POST /v1/sessions`

Input conforms to [session-create.schema.json](session-create.schema.json). The confirmed `startMood` is authoritative; `checkInText` can be omitted or `null`. Do not persist raw text by default. `trackCount` is between 1 and 20. The Phase 4 local endpoint returns a generated `sessionId`, `status`, `catalogId`, `revision`, ordered `queue`, component scores, and quality metrics. The ID is ephemeral: sessions are not yet persisted or retrievable.

Each queue item includes `position`, `trackId`, `pathPoint`, `score`, and `reason`. `pathPoint` is the requested valence–arousal point for that slot, not a claim about the listener's actual mood. For `trackCount = 1`, it equals `startMood`.

## `GET /v1/sessions/{sessionId}`

Returns the current session and queue. The `revision` increments whenever future slots are re-ranked. The currently playing item and completed items do not move.

## `POST /v1/sessions/{sessionId}/events`

Input conforms to [feedback-event.schema.json](feedback-event.schema.json). `eventId` is an idempotency key unique within the session. Retries with the same ID and same payload return the existing result; reuse with a different payload is rejected. The response contains `accepted`, `sessionId`, and the current `revision`.

## `POST /v1/sessions/{sessionId}/check-ins`

Input: `{ "valence": 0.4, "arousal": 0.3, "source": "manual" }`. This explicit check-in can update the path for future songs only. It is stored separately from implicit playback events and follows the user's retention choice.

## Error rules

- Invalid JSON or out-of-range coordinate: `400` with a field-specific message.
- Unknown session or track: `404`.
- Reused event ID with different content or event for an ineligible track: `409`.
- Catalog has too few distinct playable tracks for the requested queue: `422` with an available count.
- Playback failure is a player state, not proof that the track was disliked.

See [example-session.json](example-session.json) for a complete illustrative request and response. Values are examples; no classifier or ranking engine generated them.

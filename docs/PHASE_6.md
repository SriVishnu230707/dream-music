# Phase 6 — adaptive feedback loop

Phase 6 records playback events and explicit mood check-ins in the existing PostgreSQL listening session. The browser shows the resulting queue revision and an event history. It continues to use the licensed local demo catalog and the Phase 4 sequencer.

## Session flow

1. Create a session with a confirmed start mood, target, taste input, and a 1, 7, or 30 day retention choice. The API stores the queue, taste input, target, and expiry time. It does not save the original check-in text.
2. On successful playback, send `start`; send `skip` or `complete` to move to the next track. `replay` and `like` are also accepted. Each event has a unique ID, timestamp, track ID, and expected session revision.
3. The server locks the session row, checks whether the event ID already exists, validates the expected revision and current track, applies the event, replans future slots, and commits the queue and audit event in one transaction. An identical retry returns its original result; a changed payload with the same ID is rejected.
4. The Phase 3 taste ranker receives recent events. A skip is a weak signal, especially for a short listen; likes, replays, and completed listens can improve taste affinity. Feedback is not interpreted as a measured mood change.
5. A new explicit check-in updates the starting coordinate for the remaining path. Replanning excludes all played tracks and the current track. Only later queue slots can change. The response reports whether their track IDs changed.
6. The listener can inspect events and check-ins, delete check-ins, or delete the entire session. Session deletion cascades to both audit tables. The server purges expired sessions at startup and hourly.

## Local interfaces

`POST /api/v1/sessions/{id}/events` accepts the [feedback event contract](contracts/feedback-event.schema.json). `GET` on the same route returns the audit trail. `POST`, `GET`, and `DELETE /api/v1/sessions/{id}/check-ins` manage explicit check-ins. `DELETE /api/v1/sessions/{id}` removes all persisted session data. The old `/advance` route still works and creates an audited skip or complete event. See [API contracts](contracts/API.md) for payloads and response details.

The service is designed for local loopback use. Session IDs act as bearer identifiers and there is no account authentication or per-user authorization. Do not expose this API publicly without adding those controls. The event trail and check-ins remain until the chosen expiry or explicit deletion. The browser retains only the active session ID and stated preferences locally.

## Verification and limits

Run `go test ./...` and `npm run build --prefix web`. The Go tests cover revision conflicts, duplicate events, queue locking, check-in updates, deletion endpoints, and malformed inputs using an in-memory store. A live PostgreSQL smoke test is still required when Docker/PostgreSQL is available on the host; the Docker daemon was unavailable during this implementation. Phase 7 will assess recommendation quality and mood outcomes. Phase 6 itself makes no therapeutic or effectiveness claim.

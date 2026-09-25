# Phase 5 — local listening application

The React app connects the Phase 2 mood suggestion and Phase 4 sequencer to original generated audio. The Go service stores sessions in PostgreSQL and serves the catalog and WAV files. The listener confirms or adjusts the starting mood, chooses a target, creates a queue, plays, pauses, skips, and resumes after a page refresh. A browser may require a click to resume audio after refresh.

## Run locally

From the repository root:

```powershell
npm run generate:demo
docker compose up -d postgres
$env:DATABASE_URL='postgres://mooddrift:local-demo-only@127.0.0.1:5432/mooddrift?sslmode=disable'
go run ./cmd/listening-app -root . -listen 127.0.0.1:8083
```

In a separate terminal:

```powershell
cd web
npm ci
npm run dev
```

Open `http://127.0.0.1:5173`. The generated demo audio and metadata are the only playback source. To enable text suggestions, train the Phase 2 model and run `python -m uvicorn mood_service.app:app --host 127.0.0.1 --port 8000` in another terminal. Manual mood selection works when that service is down.

The compose password and database port are for a loopback development environment only. The listening API also binds only to loopback and rejects nonlocal Host/Origin headers. There is no user authentication; do not expose this service to a network. `userId` is a label, not an identity proof. Session IDs are random bearer references. Phase 6 will add event history and retention controls. Raw check-in text is forwarded only for a requested prediction and is not stored with the session.

## API and persistence

`POST /api/v1/sessions` accepts the Phase 0 session request and returns a persisted queue with `sessionId`, `currentIndex`, `status`, and `revision`. `GET /api/v1/sessions/{id}` restores it. `POST /api/v1/sessions/{id}/advance` accepts `{ "expectedRevision": 1, "action": "skip" }` or `complete`. The database updates only when the revision matches, so duplicate or stale advances return `409`; refresh with GET before trying again. The final advance marks the session completed. `GET /api/v1/catalog` supplies metadata and attribution; `GET /audio/{trackId}` serves validated WAV files and supports browser range requests. `POST /api/v1/mood/predict` proxies a short check-in to the local Phase 2 service without storing it.

The database schema is embedded in `internal/session/schema.sql` and applied when the API starts. It stores the immutable generated queue, current index, last advance action, timestamps, and revision. It does not yet store individual playback events or play/pause timing. Phase 6 will add those without changing the already played part of the queue.

## Verification

```powershell
go test ./...
go vet ./...
cd web
npm run build
```

The Go tests exercise session creation, retrieval, completion, stale revision rejection, missing sessions, local request restrictions, and audio serving with an in-memory store. A live PostgreSQL smoke run is required before claiming database integration works on a given machine.

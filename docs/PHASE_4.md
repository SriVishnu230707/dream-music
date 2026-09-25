# Phase 4 — mood path and playable sequence

Phase 4 takes the Phase 2 confirmed mood and Phase 3 taste candidate scores and creates an ordered queue from the generated, playable Phase 0 catalog. It accepts a listener-selected target mood. Coordinates describe track annotations and the requested trajectory; they do not measure the listener's emotional response.

## Run

```powershell
npm run generate:demo
go test ./...
go run ./cmd/sequence-api -root . -listen 127.0.0.1:8082
```

Send `docs/contracts/example-session.json`'s `request` object as JSON to `POST http://127.0.0.1:8082/v1/sessions`. The endpoint also serves `GET /health`. It binds to loopback because there is no authentication. Session IDs are random and ephemeral; queue retrieval, event processing, persistence, and playback arrive in later phases.

## Selection

For `N > 1`, slot `i` has path point `start + i/(N-1) × (target-start)`; for `N = 1`, the point is the start mood. Phase 3 provides at most 20 candidates, ranked by taste. A deterministic width-128 beam search chooses distinct tracks. Each slot scores `0.4 × taste + 0.5 × (1 - moodDistance) - 0.08 × transitionDistance - 0.03` when the genre would repeat three times. Distances are Euclidean in valence–arousal space, divided by √2. This is a bounded heuristic and need not find a global optimum. The response exposes path points, component distances, score, and a coverage warning when the catalog cannot closely follow the path.

The API rejects missing or unknown fields, invalid coordinates, overlong text, and a request for more distinct tracks than exist. It checks the selected WAV files again before responding.

## Comparison

```powershell
go run ./cmd/sequence-eval -root .
```

The evaluator applies the same path and catalog to popularity ordering, Phase 3 taste ordering, and Phase 4 drift ordering, using deterministic synthetic scenarios in `docs/fixtures/phase4-scenarios.jsonl`. It reports path distance, transition size, taste score, and target gap. These are engineering measures, not evidence of therapeutic benefit or actual listener mood improvement. The catalog's mood features are design proxies for generated demo audio.

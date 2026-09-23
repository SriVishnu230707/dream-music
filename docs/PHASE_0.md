# Phase 0: catalog and contracts

## What is built

- A 12-track catalog covering low/high valence and low/high arousal, with both ambient and pulse styles.
- A deterministic Node.js generator that creates original, 12-second WAV clips locally. No third-party audio or provider credentials are needed.
- JSON schemas for the catalog, a track, session creation, and playback feedback.
- A complete illustrative session request/response and an event example.

The generated clips are **engineering fixtures**, not a production music catalog. Their mood coordinates are intentional design proxies, not empirical annotations. They establish the data and playback contracts; Phase 1 will add a validated music dataset and assess catalog quality.

## Generate playable demo audio

From the repository root:

```powershell
npm ci
npm run generate:demo
npm run verify:phase0
```

The generation command writes `data/catalog/audio/generated/*.wav`. These files are ignored by Git and can be regenerated at any time. A UI can serve them from a local static route in Phase 5. The generator contains no network calls and uses only Node.js built-ins. The verifier uses the development dependencies to validate the JSON Schemas and generated WAV files.

## Provenance and rights register

| Asset | Source | Rights and intended use | Attribution |
| --- | --- | --- | --- |
| 12 demo WAV clips | Synthesized by this repository's generator | Original project fixtures for local development | “Synthesized for Mood Drift Music by the project generator.” |
| Mood values in `demo-tracks.json` | Manually assigned design proxies | Testing data contracts only | Marked `design-proxy` per track |
| Future research corpus | To be selected in Phase 1 | Verify terms before import, hosting, or redistribution | Record per-source and per-track attribution |

No external audio or dataset files are committed. The manifest includes an audio path, provenance, rights marker, and attribution for each track. If the catalog is replaced, preserve stable IDs or provide an explicit migration map.

## Canonical contract decisions

- `schemaVersion` is `1.0.0` for the demo catalog.
- Valence and arousal are floating-point values in `[0, 1]`; `0.5` is neutral/medium.
- Track IDs are stable lowercase slugs. Session and event IDs are unique strings; event IDs support idempotent ingestion.
- Timestamps are UTC RFC 3339 / ISO 8601 strings.
- A text classifier may propose a mood, but the confirmed `startMood` is the value used to build the path.
- The user chooses the target. No therapeutic default is applied silently.
- Raw check-in text is optional and should not be retained by default.
- Generated audio remains local until the playback UI is implemented.

## Phase 0 verification

1. Parse every JSON artifact and confirm all 12 IDs and audio paths are unique.
2. Generate all 12 WAV files on a clean local setup.
3. Confirm every output has a valid RIFF/WAVE header, the expected sample rate/duration, and a matching manifest path.
4. Check that the example session references catalog tracks and its mood path moves from start to target.
5. Inspect the files in the already open Antigravity project.

The next phase can replace design-proxy mood labels with documented human annotations while keeping these contracts versioned.

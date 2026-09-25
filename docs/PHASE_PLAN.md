# Mood Drift Music — phased implementation plan

**Status:** Phases 0–4 implemented locally; Phase 5 is next. This file is the execution plan. The README remains the project overview.

## Product target

A listener writes a short check-in or chooses a mood, confirms the inferred starting point, chooses a target mood, and receives a playable sequence of personally relevant tracks that moves gradually through valence–arousal space. During playback, likes, skips, and optional check-ins can change upcoming tracks. The system can be compared fairly with popularity and taste-only playlists.

### First working version

One user can complete this flow with a documented, permitted demo catalog. The app records events, adapts the remaining queue, and produces reproducible offline evaluation. Collaborative filtering, DistilBERT, a contextual bandit, and commercial streaming integrations are later experiments.

## Findings that change the implementation

1. **Catalog and playback must be solved together.** A music emotion dataset is useful only if the corresponding audio can be played under its terms. DEAM provides valence–arousal annotations and Creative Commons licensed sound files, but each selected recording's terms and attribution still need review before redistribution or hosting. [DEAM dataset](https://cvml.unige.ch/databases/DEAM/)
2. **Spotify cannot be the source of ML training data for this plan.** Spotify's developer policy prohibits using Spotify Platform data or content to train or ingest into an ML/AI model, and its 2024 changes removed Audio Features access for new Web API use cases. Keep the first catalog, annotations, and training pipeline independent of Spotify. [Spotify policy](https://developer.spotify.com/policy), [API changes](https://developer.spotify.com/blog/2024-11-27-changes-to-the-web-api)
3. **Spotify playback is conditional.** The Web Playback SDK requires Premium. Current Development Mode rules require the app owner to have Premium and limit new apps to five users. Review policy and actual account access before treating this as a deliverable. [Web Playback SDK guide](https://developer.spotify.com/documentation/web-playback-sdk/howtos/web-app-player/), [2026 Development Mode guide](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide)
4. **Text labels and song mood are different problems.** GoEmotions contains Reddit comments labeled with 27 emotions plus Neutral. It can train a text classifier, but mapping its labels to valence–arousal coordinates needs a separately documented rule and validation on short check-ins. [GoEmotions documentation](https://github.com/google-research/google-research/blob/master/goemotions/README.md)
5. **Feedback is not a mood measurement.** A skip may mean the song is disliked, familiar, or simply interrupted. Use it as a weak preference signal; use optional explicit check-ins to assess perceived mood change.

## Architecture for the first version

```text
React + TypeScript UI
  ├── text/manual check-in and target selection
  ├── playlist and local audio player
  └── feedback controls
          │ HTTP
          ▼
Go API: sessions, ranking, drift path, feedback
  ├── PostgreSQL: tracks, users, interactions, sessions, events
  └── Python FastAPI: text mood inference
          │
          ▼
Licensed demo catalog + mood annotations
```

Use a Go monolith for application logic and one Python service for model inference. The UI can poll for queue changes initially. Add Node BFF, Redis, WebSockets, pgvector, and gRPC only if a specific integration or measured bottleneck calls for them.

## Phase 0 — lock the vertical slice and contracts

**Purpose:** Remove ambiguity before building separate components.

1. Choose the initial audio source and verify track-level license, attribution, and hosting permissions. Keep source audio out of Git.
2. Select a small catalog that spans the valence–arousal space and includes enough choice for at least two distinct taste profiles. Record source, license, feature provenance, and playable URI per track.
3. Define canonical values: mood coordinates in `[0, 1]`, track IDs, user IDs, event IDs, timestamps, and a schema version.
4. Write request/response contracts for mood inference, session creation, queue retrieval, and feedback ingestion.
5. Choose the first evaluation unit: session, user, and time-based splits; document what counts as a relevant track.

**Deliverables:** `data/catalog/` manifest template; `docs/contracts/` API and event schemas; source/attribution register; one example session payload.

**Exit gate:** Every demo track has a legally usable playback source and mood annotation; the example session can be represented end to end without undocumented fields.

## Phase 1 — reproducible data pipeline

**Purpose:** Make model inputs inspectable and repeatable.

1. Import catalog metadata and mood annotations with stable IDs; do not commit copyrighted audio or raw personal check-ins.
2. Normalize valence and arousal to `[0, 1]` and record original scales. Validate ranges, missing values, duplicates, and playable-URI coverage.
3. Prepare an emotion-text dataset with documented source, license, label mapping, and train/validation/test split.
4. Create a seed interaction set for development and keep it separate from evaluation data. Mark synthetic events as synthetic.

**Deliverables:** import scripts, data dictionary, validation report, reproducible seed catalog.

**Exit gate:** A clean checkout can rebuild the seed database and produce the same validation counts.

## Phase 2 — mood classifier and manual fallback

**Purpose:** Turn text into a usable, correctable starting mood.

1. Train TF-IDF with Logistic Regression and a linear SVM on the chosen labels; tune only on validation data.
2. Measure macro F1, per-class F1, confusion matrix, and confidence behavior on a held-out test set.
3. Define and document label-to-valence–arousal mapping. Test short, ambiguous, empty, and out-of-domain inputs.
4. Serve a versioned inference endpoint returning label, coordinates, confidence, and model version.
5. Fall back to a manual selector when confidence is insufficient or the user corrects the prediction.

**Deliverables:** training script, saved model, evaluation report, FastAPI inference endpoint, manual fallback contract.

**Exit gate:** Training is reproducible; the endpoint and fallback handle specified edge cases; metrics and failure cases are recorded.

## Phase 3 — taste baselines and candidate generation

**Purpose:** Personalize without requiring a large user base.

1. Encode genre, artist, language, tempo, and other available content fields. Keep missing fields explicit.
2. Build a user taste vector from stated preferences, likes, replays, and completed listens; cap the effect of negative signals.
3. Implement popularity and content-based taste-only baselines over the same eligible catalog.
4. Reserve a limited exploration share for unseen tracks and handle zero-history users.
5. Generate a candidate list before mood sequencing; log component scores for later inspection.

**Deliverables:** deterministic rankers, cold-start flow, feature definitions, baseline evaluation script.

**Exit gate:** Candidate ranking changes predictably with stated preferences and feedback; baselines can be run on the same held-out sessions.

## Phase 4 — drift path and playlist sequencer

**Purpose:** Produce a coherent ordered queue rather than an unordered recommendation list.

1. Interpolate from confirmed start `s` to target `t` over `N` slots: `p[i] = (1 - i/(N-1))s + (i/(N-1))t`; for `N = 1`, use `s`.
2. At each slot, score eligible candidates by taste affinity, mood distance, novelty, and transition cost.
3. Enforce playability, unique tracks, and configurable artist/genre diversity. Define fallback behavior if the catalog is too small.
4. Return per-track explanation fields and component scores for debugging.
5. Compare with popularity and taste-only queues on identical sessions.

**Deliverables:** Go sequencer, scoring configuration, deterministic test fixtures, sequence-quality report.

**Exit gate:** Queues are playable, contain no duplicate tracks, respect selected targets, and degrade gracefully when candidate coverage is sparse.

## Phase 5 — end-to-end playback application

**Purpose:** Complete an actual listening session.

1. Build the React check-in, manual correction, target selection, queue, and player controls.
2. Add Go endpoints for session creation, current queue, and track state.
3. Use the permitted demo catalog with HTML audio playback and visible attribution.
4. Persist the session and handle refresh/resume, missing audio, and player errors.
5. Ensure keyboard access and clear loading/error states.

**Deliverables:** browser app, API, PostgreSQL schema/migrations, local run configuration.

**Exit gate:** A new user can start, play, pause, skip, and finish a session on a clean local setup.

## Phase 6 — adaptive feedback loop

**Purpose:** Change future selections while keeping the session stable.

1. Record idempotent start, skip, completion, replay, like, and optional check-in events.
2. Update taste weights cautiously; use explicit check-ins to update the mood starting point for remaining slots.
3. Re-rank only unplayed songs. Preserve the currently playing track and event history.
4. Add retention/deletion controls for check-in text and session data.

**Deliverables:** event ingestion, queue revision logic, event audit trail, privacy controls.

**Exit gate:** The same event cannot be counted twice; feedback causes a traceable change to future recommendations without interrupting playback.

## Phase 7 — evaluation and refinement

**Purpose:** Test the research claim rather than infer success from a demo.

1. Freeze data splits and configurations for popularity, taste-only, and mood-drift comparisons.
2. Measure Precision@K, Recall@K, and NDCG@K for relevance; path distance, transition cost, and diversity for sequencing.
3. Run consented user sessions with balanced playlist order; collect relevance, coherence, and optional before/after mood ratings.
4. Report sample size, uncertainty, cold-start behavior, classifier mistakes, and cases where the target path performs poorly.
5. Adjust one component at a time and rerun the same evaluation.

**Deliverables:** reproducible evaluation pipeline and report.

**Exit gate:** The project can state whether mood drift improved, matched, or worsened each outcome relative to both baselines, with limitations.

## Phase 8 — optional extensions after evidence

- Collaborative filtering with SVD/ALS when interaction density supports it.
- DistilBERT if it improves held-out check-in classification enough to justify latency and maintenance.
- Approximate vector search if catalog size makes exact scoring too slow.
- Contextual bandit only after reward definition, offline policy evaluation, and user safeguards are credible.
- A separate provider adapter if its current API access and policy permit the specific use case. Keep its data isolated from model training unless its terms explicitly allow it.

## Build order and immediate next work

The dependency path is **catalog/permissions → schemas → reproducible data → classifier and taste baselines → sequencer → player → adaptation → comparative evaluation**. Work on the UI shell can proceed once Phase 0 contracts are fixed, but do not make provider integration the critical path.

The next implementation task is **Phase 0, steps 1–4**: choose a small permitted audio set, record provenance and attribution, define track/session/event schemas, and create one complete example session. Those artifacts will make the following phases concrete and testable.

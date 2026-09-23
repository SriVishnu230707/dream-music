# Mood Drift Music

**A mood-aware, personalized music recommendation and playback project.**

Mood Drift Music creates a listening session that begins near how a person feels now and gradually moves toward how they want to feel. It combines a mood signal, the listener's music preferences, and feedback from the current session to choose and sequence songs.

> **Project status:** Design stage. This README describes the intended system and a practical build path; no application or trained model is included yet.

## The idea

Most recommenders use past listening behavior to predict what someone generally likes. This project adds the emotional context of a particular session. A listener might start feeling low, choose a calmer or more positive target mood, and receive a playlist that changes gradually rather than jumping straight to high-energy songs.

```text
Mood check-in + target mood
           │
           ▼
    Valence/arousal path  ←  User taste profile
           │                       │
           └──────────┬────────────┘
                      ▼
            Ranked song sequence
                      │
                      ▼
              Playback + feedback
                      │
                      └──► Re-rank upcoming songs
```

## Goals

- Accept a mood check-in and a user-selected target mood.
- Learn music preferences from likes, skips, replays, and listening history.
- Build a playlist that balances personal taste with a gradual emotional trajectory.
- Adapt upcoming choices as the listener gives feedback.
- Compare the system with taste-only and popularity-based baselines.

## Initial scope

The first version uses **manual mood selection**. This gives the system a clear input and lets the recommendation and sequencing logic be evaluated independently. Text-based mood classification is a later extension. Facial-expression and voice analysis are outside the initial scope.

Each session has a starting mood, a target mood, and a requested number of songs. A mood is represented by two values in the range `[0, 1]`:

- **Valence:** negative to positive feeling.
- **Arousal:** low to high energy.

The listener chooses the target. The application should present the path as a listening preference, not a promise to change a person's emotional state.

## How recommendations work

1. **Build candidates.** Gather tracks from the listener's preferred artists, genres, languages, and previously liked material, plus a small exploration pool.
2. **Create a path.** Interpolate from the starting mood to the target mood across the requested number of songs.
3. **Score each track.** Combine taste affinity, distance from that step's mood point, novelty, and diversity. Penalize recently played tracks and repeats within the playlist.
4. **Sequence the list.** Choose the highest-scoring eligible track at each step while limiting abrupt changes between adjacent songs.
5. **Adapt.** Use likes, skips, replays, and optional mood check-ins to update the remaining sequence. Feedback indicates preference; it should not be treated as a reliable measurement of emotional change by itself.

A simple starting score is:

```text
score(song, step) =
    w_taste   × taste_affinity(song, user)
  + w_mood    × mood_similarity(song, path[step])
  + w_novelty × novelty(song, user)
  - w_repeat  × repeat_penalty(song, session)
  - w_jump    × transition_cost(previous_song, song)
```

Normalize component scores before combining them. Tune the weights against held-out sessions and user feedback rather than assuming one set works for everyone.

## Proposed architecture

| Layer | Proposed technology | Responsibility |
| --- | --- | --- |
| Web client | React, TypeScript, Tailwind CSS | Mood check-in, playlist, playback controls, feedback |
| Application API | Go | Sessions, candidate ranking, sequencing, feedback ingestion |
| ML service | Python, FastAPI, scikit-learn | Taste features and optional text mood inference |
| Data | PostgreSQL | Users, tracks, interactions, sessions, model features |
| Playback provider | Provider adapter | Track lookup and playback where permitted by provider access |
| Local development | Docker Compose | Run the services and database together |

Start with one Go API and one Python ML service. Add Redis, a vector index, WebSockets, or a separate Node BFF only when measurement or integration needs justify them. Provider APIs, catalog access, playback entitlements, and audio-feature availability must be verified before choosing an integration. A local catalog with licensed or permitted audio clips can support the first end-to-end demo.

## Data and model plan

| Data | Purpose |
| --- | --- |
| Track metadata and mood features | Locate songs in valence/arousal space and explain selections |
| User interactions | Estimate taste and evaluate ranking |
| Session events | Update upcoming recommendations |
| Optional mood-labeled text | Train and test a later text mood classifier |

For the first version, use a content-based taste profile and manually mapped or dataset-provided track mood features. Evaluate the quality and provenance of any dataset before use. Add collaborative filtering only after there are enough users and interactions to support it.

## Evaluation

Compare three playlist strategies on the same candidate catalog and test sessions:

1. **Popularity baseline:** popular eligible songs.
2. **Taste-only baseline:** songs ranked by preference, without a mood path.
3. **Mood drift:** taste-aware songs sequenced along the chosen path.

Measure `precision@k` or `NDCG@k` for preference relevance, skip and completion rates for engagement, and distance from each playlist step to its intended mood point for sequence fit. Use explicit listener ratings to assess whether transitions feel coherent and whether the session matches the selected target. Report results by starting mood and user group, with confidence intervals where sample size permits.

## Build path

- [ ] Define a track schema, mood mapping, and small legal demo catalog.
- [ ] Build the manual mood check-in and target selection screens.
- [ ] Implement taste scoring and a taste-only baseline.
- [ ] Implement drift path generation, ranking, and transition rules.
- [ ] Add playback through the selected provider or local demo catalog.
- [ ] Record likes, skips, replays, and optional check-ins; re-rank the remaining queue.
- [ ] Run offline evaluation and a small user study against the baselines.
- [ ] Add text mood inference if it improves the experience over manual selection.

## Privacy and responsible use

Mood check-ins can be sensitive. Store only what is needed for the session, explain how it is used, allow deletion, and obtain consent before retaining mood history. Present the system as a music discovery experience, not as a mental-health treatment or diagnostic tool.

## Repository layout (planned)

```text
apps/web/           React client
services/api/       Go application API
services/ml/        Python model training and inference
data/               Dataset documentation and sample schemas
docs/               Design decisions and evaluation reports
compose.yaml        Local development services
```

## Getting started

The repository currently contains the project design only. Follow the build path above to implement the first version. Setup commands, environment variables, and provider credentials will be documented here once the corresponding services exist.

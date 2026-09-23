# Mood Drift Music

**Mood-aware, personalized music recommendation with adaptive playback.**

> **Status:** Project design. The application, datasets, and trained models have not been implemented yet.

## Overview

Mood Drift Music starts a listening session with a short text check-in, learns what the listener tends to enjoy, and selects a sequence of songs that moves gradually from the current mood toward a chosen target. The sequence adapts to feedback during playback.

The project combines natural language emotion classification, hybrid recommendation, and playlist sequencing in a two-dimensional **valence–arousal** space. Valence describes negative to positive feeling; arousal describes low to high energy. Each song occupies a point in that space, based on available audio features or mood annotations.

```text
Text check-in ─► Mood classifier ─► Starting mood ─┐
                                                   ├─► Drift path ─► Song ranking ─► Playback
Target mood ────────────────────────────────────────┘                     ▲              │
                                                                         │              ▼
Listening history ─► Taste model ─► Candidate songs ─────────────────────┘        Feedback events
                                                                                      │
                                                                                      └─► Re-rank queue
```

For a step-by-step breakdown of the requirements, models, integration points, and success criteria, see the [problem analysis](docs/PROBLEM_ANALYSIS.md).

## Problem

Listening history and collaborative filtering capture broad taste, but they do not necessarily explain what a person wants to hear in a particular emotional context. Generic mood playlists capture context but may ignore individual preferences. This project studies whether combining both signals, then sequencing tracks along a gradual mood path, produces a more relevant listening session.

## Goals

- Infer a starting mood from a short text entry, with a manual correction option.
- Model personal taste from song content and historical interactions.
- Generate a playlist that balances taste, mood fit, diversity, and smooth transitions.
- Play the selected tracks and adapt upcoming selections using session feedback.
- Evaluate the result against popularity-based and taste-only baselines.

## Recommendation pipeline

### 1. Detect the starting mood

Train a text classifier on an emotion-labeled corpus such as GoEmotions or ISEAR. Start with **TF-IDF + Logistic Regression or a linear SVM**. Compare a fine-tuned **DistilBERT** model only if the baseline leaves a meaningful accuracy gap. Map predicted emotion labels to valence–arousal coordinates and retain uncertainty; allow the listener to correct the prediction.

The text check-in should be optional. A manual mood selector provides an accessible fallback and a useful baseline for testing the rest of the system.

### 2. Learn the listener's taste

- **Content-based model:** Represent tracks using available genre, artist, tempo, energy, valence, and other permitted metadata. Build a user vector from liked and completed tracks, with lower weights for weak signals.
- **Collaborative model:** When enough interaction data exists, train a matrix-factorization model such as SVD or ALS to discover songs enjoyed by listeners with similar patterns.
- **Hybrid candidate set:** Combine both models and reserve a small share for exploration. Handle cold-start users with stated preferences and content-based recommendations.

Skips and short listens are noisy signals. They should adjust rankings cautiously rather than be treated as certain dislikes.

### 3. Build a mood drift path

Let the starting mood be `s = (valence, arousal)` and the listener's target be `t`. For a session of `N` songs, a simple path is:

```text
path[i] = (1 - αᵢ) × s + αᵢ × t
αᵢ = i / (N - 1), for i = 0 … N - 1
```

The default experience asks the listener to select the target. An optional calm or more-positive suggestion may be offered, but the system does not assume that every listener wants their mood changed. The path is a playlist design choice, not a therapeutic claim.

At each step, rank eligible songs by personal taste, distance from the step's target point, novelty, and transition quality. Avoid repeats and large jumps between adjacent songs. A baseline scoring function is:

```text
score(song, step) =
    w_taste   × taste_affinity(song, user)
  + w_mood    × mood_similarity(song, path[step])
  + w_novelty × novelty(song, user)
  - w_repeat  × repeat_penalty(song, session)
  - w_jump    × transition_cost(previous_song, song)
```

Normalize the terms and tune weights on held-out data. A nearest-neighbor index such as pgvector or FAISS can narrow the candidate pool when the catalog grows.

### 4. Play and adapt

During playback, collect skips, replays, likes, and listen-through duration. Re-rank only upcoming tracks so the current song is not interrupted. Offer a lightweight mood check-in during longer sessions; that explicit signal is more informative about emotional state than engagement alone. A contextual bandit is a later experiment, after a transparent rule-based feedback loop is working and measurable.

## Proposed technology stack

| Layer | Technology | Responsibility |
| --- | --- | --- |
| Frontend | React, TypeScript, Tailwind CSS | Check-in, target selection, playlist, playback controls, feedback |
| Backend for frontend | Node.js with Fastify or Express | OAuth and frontend-facing aggregation, if provider integration requires it |
| Core API | Go with Gin or Fiber | Recommendations, session state, feedback ingestion |
| ML service | Python with FastAPI, scikit-learn, optional Transformers | Mood inference, taste features, model serving |
| Database | PostgreSQL; optional pgvector | Profiles, tracks, interactions, sessions, vector search |
| Cache | Redis, when needed | Session state, hot rankings, rate limits |
| Live updates | WebSockets, when needed | Check-ins and queue updates |
| Local development | Docker Compose | Run app services and data stores |

The initial implementation can start with React, one Go API, one Python service, and PostgreSQL. Split services or add Redis and WebSockets when their benefits are demonstrated. Use REST between services first; gRPC remains an option if the interfaces and traffic justify it.

## Playback and catalog

Spotify integration is a proposed provider option: OAuth, track metadata/search, and browser playback through the Web Playback SDK where the account and application are eligible. **Verify current API access, audio-feature availability, playback entitlements, and platform terms before implementation.** Do not assume every catalog track exposes valence and energy. A licensed or otherwise permitted demo catalog can provide an end-to-end fallback; Jamendo or Free Music Archive are possible sources subject to their current terms and available audio.

## Data plan

| Dataset or event | Use |
| --- | --- |
| GoEmotions or ISEAR | Train and evaluate text emotion classification |
| Track audio features or mood annotations | Place songs in valence–arousal space |
| User–song interactions | Train taste models and evaluate ranking |
| Session events and optional check-ins | Adapt the upcoming queue and evaluate sessions |

Check each dataset's license, coverage, label quality, and compatibility with the chosen playback catalog. Training and test splits should be separated by user or time where appropriate to avoid leakage.

## Evaluation plan

| Component | Measures |
| --- | --- |
| Mood classifier | Accuracy, macro F1, per-class F1, confusion matrix, calibration |
| Taste ranking | Precision@K, Recall@K, NDCG@K, cold-start performance |
| Drift sequence | Mood-path distance, transition smoothness, diversity |
| Listening session | Skip rate, completion rate, session length, listener-rated relevance and coherence |

Compare **popularity**, **taste-only**, and **mood-aware drift** strategies on the same catalog and user sessions. Use explicit before/after check-ins and subjective ratings when studying perceived mood change; engagement metrics alone cannot establish mood improvement or causality. Report sample size and uncertainty, and separate offline ranking results from user-study findings.

## Milestones

1. **Data and baseline:** Document datasets, define track and event schemas, create a legal demo catalog, and train the TF-IDF classifier.
2. **Personalization:** Build a content-based taste model and popularity/taste-only baselines. Add collaborative filtering when data volume supports it.
3. **Sequencing:** Implement valence–arousal interpolation, weighted ranking, repeat limits, and transition constraints.
4. **Application:** Build the React check-in and player UI, Go session API, Python inference service, and PostgreSQL persistence.
5. **Playback and feedback:** Integrate an eligible playback provider or demo catalog; capture events and adapt the remaining queue.
6. **Evaluation:** Run offline tests and user sessions; compare the three strategies and iterate on observed weaknesses.
7. **Advanced experiments:** Test DistilBERT, vector retrieval, and contextual bandits only after the baseline is measured.

## Privacy and responsible use

Mood entries may contain sensitive personal information. Minimize collection and retention, obtain consent for stored check-ins, protect session data, and let users delete it. Present the product as a music discovery experience rather than a mental-health diagnostic or treatment system.

## Planned repository layout

```text
apps/web/           React client
services/bff/       Optional Node.js provider integration
services/api/       Go API, recommendation and session logic
services/ml/        Python training and inference
data/               Dataset documentation and sample schemas
docs/               Design decisions and evaluation reports
compose.yaml        Local services
```

## Getting started

This repository currently contains the design only. Setup commands, environment variables, and provider credentials will be documented as each service is implemented.

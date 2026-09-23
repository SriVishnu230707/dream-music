# Problem analysis and implementation map

This document breaks the Mood Drift Music problem statement into decisions that can be built and tested. The repository is currently in the **design stage**; the components below are requirements and a proposed implementation path, not completed features.

## 1. Identify the user problem

A listener's long-term taste and their immediate listening intent are different signals. A user may usually enjoy energetic music but want something calm right now. A generic calm playlist can match the moment yet miss that user's artists, languages, and styles. The core problem is to choose **personally relevant songs for the current context**, then arrange them into a coherent session.

The claim that existing platforms do not solve this for every user is motivation, not an evaluation result. The project must show improvement against concrete baselines.

## 2. Define the session and its output

The unit of work is one listening session. Its inputs are a user profile, a short mood check-in or manual mood selection, a target mood, a desired session length, and a catalog of playable tracks. Its output is an ordered queue of distinct, playable songs with a reason for each selection. During playback, the queue can change in response to feedback.

| Input | Minimum representation | Why it is needed |
| --- | --- | --- |
| Current mood | Valence and arousal, each in `[0, 1]`, plus confidence/source | Establishes the start of the path |
| Target mood | Valence and arousal selected by the user | Establishes the desired direction |
| Taste | Weighted preferences and interaction history | Keeps songs personally relevant |
| Track catalog | Stable ID, playable source, features, metadata | Supplies eligible candidates |
| Session policy | Song count and constraints | Controls path length and variety |

The system should allow a listener to stay near the starting mood. A target is a listening preference, not a medical goal.

## 3. Turn text into a mood signal

**Baseline:** Train TF-IDF with Logistic Regression or a linear SVM on an emotion-labeled text dataset. Evaluate on a held-out split with macro F1, per-class F1, a confusion matrix, and confidence calibration. Map each predicted class to valence–arousal coordinates using a documented mapping, then let the listener correct the result. The mapping itself must be reviewed because emotion labels and two-dimensional mood coordinates are not interchangeable.

**Later experiment:** Fine-tune DistilBERT and compare it with the baseline using the same test split, latency budget, and class distribution. Adopt it only if the improvement justifies operational cost. GoEmotions and ISEAR are candidate datasets; their labels, licenses, and fit for short music check-ins need verification before training.

**Failure behavior:** Empty, ambiguous, multilingual, or out-of-domain text falls back to manual selection. Do not infer clinical conditions from a check-in.

## 4. Represent songs in a common mood space

Every eligible track needs a mood coordinate. Valence can come from a permitted feature source or a model trained on mood annotations. Arousal can be estimated from energy and related audio features. Both values require normalization to `[0, 1]`, provenance, and a missing-value strategy.

Genre, artist, language, tempo, and era are useful taste features, but they are not substitutes for mood labels. Verify coverage and access for any provider's track features before depending on them. If coverage is incomplete, use a small documented demo catalog with consistent annotations.

## 5. Learn individual taste

Build a **content-based baseline** first. Convert tracks into feature vectors and form the user's preference vector from liked, replayed, and completed tracks, weighted by recency and signal strength. Keep negative weights conservative because skipping may reflect context rather than dislike. Ask new users for a few preferences to address cold start.

Add **collaborative filtering** once there are enough distinct users and interactions. SVD or ALS can generate candidates from user–song patterns. Combine its candidate list with content-based candidates; do not rely on it for users or songs with sparse history. Keep popularity as an explicit baseline rather than allowing it to dominate the hybrid model unnoticed.

## 6. Generate and rank a mood path

Given starting point `s`, target `t`, and `N > 1` songs, generate an initial linear path:

```text
pᵢ = (1 - i/(N-1))s + (i/(N-1))t,  i = 0 … N-1
```

For a one-song session, use the starting point. At each step, select from playable taste candidates using a score that combines taste affinity, distance to `pᵢ`, novelty, and transition cost from the previous song. Enforce distinct tracks and configurable artist/genre diversity. If no candidate fits, relax soft mood-distance constraints before relaxing playability or duplicate constraints.

The output should include a small explanation such as “matches your indie preference and sits near the calm step.” The first working version can compute this with ordinary vector operations; pgvector or FAISS becomes useful only when catalog size or latency warrants an index.

## 7. Integrate real playback and feedback

The playback adapter is responsible for resolving the selected track to a playable item, starting and controlling playback, and reporting events. Provider integration must be tested against current entitlements, API access, and licensing. A permitted local/demo catalog keeps the recommendation pipeline testable when a commercial provider is unavailable.

The session service records track starts, completion, skip, replay, like, and optional mood check-ins. Re-rank **future** slots after an event; do not interrupt the current song. Maintain an idempotent event ID so retries do not double-count a skip or completion. Treat engagement as preference evidence, not direct proof that a user's mood changed.

## 8. Map requirements to services

| Requirement | Proposed component | First deliverable |
| --- | --- | --- |
| Check-in and playback UI | React client | Text/manual mood form, queue, controls |
| Mood inference | Python FastAPI service | Baseline classifier endpoint |
| Taste and candidate generation | Python training scripts + Go API | Content profile and ranked candidates |
| Path and sequence | Go recommendation module | Deterministic path and queue generation |
| Session and feedback | Go API + PostgreSQL | Session records and event ingestion |
| Provider OAuth/aggregation | Optional Node BFF | Add only for a selected provider integration |
| Live queue updates | WebSocket or polling | Begin with polling if it meets latency needs |
| Caching/vector search | Redis/pgvector, optional | Add after measuring bottlenecks |

Keep service boundaries small at first. A distributed architecture is a deployment choice, not proof that the recommender works.

## 9. Define evidence of success

The evaluation has three strategies using the same catalog, users, and session constraints:

1. **Popularity:** Rank globally popular eligible tracks.
2. **Taste-only:** Rank by personal preference without a mood path.
3. **Mood drift:** Rank by taste and the session's mood path.

Evaluate the classifier with macro F1 and class-level errors. Evaluate recommendation relevance with Precision@K, Recall@K, and NDCG@K using time-aware or user-aware splits to avoid leakage. Evaluate sequence quality with path distance, adjacent-song transition cost, and diversity. In a user study, measure perceived relevance and coherence, skips, completion, and session length. Ask for explicit before/after mood ratings if mood change is investigated. Report uncertainty and avoid claiming therapeutic benefit or causality from engagement alone.

## 10. Build in dependency order

| Phase | What gets built | Exit criterion |
| --- | --- | --- |
| 1. Catalog and contracts | Schemas, small permitted catalog, mood mapping, session/event API shapes | A reproducible set of playable, annotated tracks |
| 2. Classifier | TF-IDF baseline, evaluation script, inference endpoint, manual fallback | Documented held-out metrics and correct fallback |
| 3. Taste | Content profile, popularity and taste-only rankers | Reproducible offline comparison |
| 4. Drift | Interpolation, song scoring, transition and diversity rules | Valid queue from start to target with no duplicates |
| 5. Playback | UI, session API, working playback adapter | Complete end-to-end listening session |
| 6. Adaptation | Event logging, queue re-ranking, optional check-in | Feedback changes future choices predictably |
| 7. Evaluation | Offline tests and consented user sessions | Comparative results and limitations documented |
| 8. Advanced models | Collaborative filtering, DistilBERT, bandit experiments | Measured gain over simpler methods |

## 11. Key integration risks and decisions

- **Catalog mismatch:** A mood dataset may not contain tracks playable through the chosen provider. Establish track IDs and coverage before model training.
- **Feature availability:** Commercial audio features and playback permissions can change. Keep the catalog and player behind adapters.
- **Sparse interactions:** Collaborative filtering is weak for a new project. Keep content-based and manual-preference paths usable.
- **Mood uncertainty:** A classifier prediction is a guess. Display it as editable and track confidence.
- **Feedback ambiguity:** Skips may be caused by interruption, familiarity, or context. Use multiple signals and explicit check-ins.
- **Sensitive data:** Retain minimal mood text, document consent and deletion, and separate raw entries from aggregate metrics.
- **Scope growth:** Prove one complete session before adding separate services, real-time infrastructure, or reinforcement learning.

## Definition of a working first version

A listener can enter text or select a mood, correct the inferred start, choose a target, receive a distinct personalized queue from a documented catalog, play its tracks, provide feedback, and see later songs adapt. The repository includes reproducible evaluation against popularity and taste-only playlists. Anything beyond that is an enhancement rather than a prerequisite for the first end-to-end system.

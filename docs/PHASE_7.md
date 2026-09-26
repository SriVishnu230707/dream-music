# Phase 7 — evaluation and refinement

Phase 7 joins the existing popularity, taste, and mood-drift methods in one reproducible comparison. It adds a separate analysis path for consented listening sessions. The bundled inputs are explicitly synthetic smoke fixtures. The project has no real held-out listener cases or consented study responses yet, so it cannot report recommendation efficacy or mood improvement.

## Offline comparison

Run from the repository root:

```powershell
go run ./cmd/phase7-eval -root . -input docs/fixtures/phase7-smoke.jsonl -k 5 -seed 7
```

Each JSONL case has a unique case ID and pseudonymous user ID, `split: "test"`, `isSynthetic`, a cutoff timestamp, mood and preference timestamps, a Phase 4 session request, optional pre-cutoff popularity counts and feedback history, and post-cutoff relevant tracks. IDs are restricted to short letters, digits, underscores, and hyphens; use generated IDs rather than names. The evaluator rejects future inputs, mixed real/synthetic cohorts, duplicate users, missing provenance flags, unknown tracks, raw check-in text, or mismatched queue length. For real cases, set every provenance flag to `false` only when backed by real consented records; do not relabel the smoke fixture.

The same catalog, request, and ranking depth are used for popularity, taste-only, and drift. The report includes input and catalog SHA-256 hashes, catalog and scoring versions, bootstrap seed, cold-start flags, track IDs per case, Precision@K, Recall@K, NDCG@K, mean path distance, maximum adjacent transition, final target gap, and genre diversity. It also gives a deterministic 1,000-resample percentile interval for the paired drift-minus-baseline NDCG differences. Intervals from a tiny sample are descriptive and should not be interpreted as proof of superiority. The current generated catalog's mood coordinates are design proxies; close path distance does not mean the listener felt better.

The relevance denominator is the set of distinct post-cutoff relevant tracks in the same playable catalog. A relevant track may also have been heard before cutoff if the listener later chose it again. This avoids silently calling all historical tracks irrelevant. Cases should be assembled from a frozen, user-disjoint test cohort. Select `k`, scoring settings, and relevance rules using development data before opening the test results.

## Consented listening study

Use a short plain-language consent form, a pseudonymous participant ID, and three sessions per participant: popularity, taste, and drift. Counterbalance their order across participants. Give each method the same queue length and comparable starting mood, target, playback conditions, and catalog. Collect 1–5 relevance and coherence ratings after each session. Before/after valence–arousal ratings are optional; either collect both or neither. Do not collect free-text mood disclosures in the study file. Keep consent records outside the repository and allow withdrawal/deletion under the study procedure.

The study analyzer accepts one JSONL row per completed session:

```powershell
go run ./cmd/phase7-eval -study docs/fixtures/phase7-study-smoke.jsonl
```

Fields are `participantId`, `sessionId`, `strategy`, `order` (1–3), `consent: true`, `isSynthetic`, `relevanceRating`, `coherenceRating`, and optional `beforeMood`/`afterMood` coordinates. It rejects unconsented rows, duplicate sessions, repeated strategies or orders for a participant, invalid ratings, and mixed real/synthetic inputs. The output reports participant and complete-triplet counts, method-specific ratings and optional mood deltas, and order counts. `byStrategy` includes all completed sessions; `completeByStrategy` includes only participants who completed all three methods and is the fairer head-to-head summary. Partial participants remain visible in participant counts; only completed triplets count toward `completeTriplets`. These are descriptive self-reports, not a causal or therapeutic result.

## Interpretation and next decision

Inspect per-case failures and compare paired metrics, order balance, cold-start cases, and dropout before adjusting the algorithm. Change one scoring component at a time, keep the frozen test cases intact, and rerun the same commands. If there is no real consented data, report the engineering smoke result only and leave the research claim unanswered. Phase 8 extensions should be justified by this evidence and the observed bottleneck.

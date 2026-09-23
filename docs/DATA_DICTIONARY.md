# Phase 1 data dictionary

The pipeline is in `scripts/prepare_data.py`. It creates files under `data/processed/`; raw downloads are cached under `data/raw/`. Both directories are excluded from Git. The source catalog and pipeline code are versioned.

## `seed_tracks.jsonl`

One row per original demo clip. `id` is a stable lowercase slug. `title`, `artist`, `genre`, and `bpm` describe the clip. `valence` and `arousal` are normalized `[0, 1]` values copied from the Phase 0 catalog; `original_mood_scale` is `0..1` and `mood_provenance` is `design-proxy`. `audio_path` is relative to `data/catalog`, `playable` is true, and `rights` and `attribution` describe source and credit. These mood values are fixtures, not ground truth.

## `seed_interactions.jsonl`

Twelve `like` events across three fictional users. Fields: `event_id`, `user_id`, `track_id`, `event_type`, `is_synthetic`, and `partition`. Every row has `is_synthetic: true` and `partition: development_only`. These rows exist to exercise the relational schema and later taste code. **Never include them in evaluation metrics or present them as real listening history.**

## `seed.sqlite`

A disposable development database with `tracks` and `interactions` tables. Primary keys, mood range checks, an audio-path uniqueness constraint, and a foreign key from interactions to tracks catch common integration mistakes. It is a local seed fixture; the application database is planned for PostgreSQL in a later phase.

## `goemotions/{train,dev,test}.jsonl`

Each row has `id`, `text`, `labels` (one or more names), and `split`. The upstream split is preserved: train 43,410; dev 5,426; test 5,427. The 28 labels include Neutral. The additional `goemotions/model_splits/` files remove repeated text, preferring the first occurrence in train, then dev, then test. **Phase 2 must train and evaluate using `model_splits/` to avoid duplicate-text leakage.** No mapping to valence–arousal is asserted in this phase. The original data comes from Google Research's [GoEmotions](https://github.com/google-research/google-research/blob/master/goemotions/README.md); the [repository states CC BY 4.0 for datasets](https://github.com/google-research/google-research/). Short Reddit comments may differ from user mood check-ins, so Phase 2 must test transfer quality.

## `deam_tracks.jsonl`

Each row has a stable `id` prefixed with `deam-`, `source_song_id`, artist/title/genre, and `metadata_year`. `original_valence` and `original_arousal` are DEAM song-level means on the source's 1–9 scale. `valence` and `arousal` are `(source_value - 1) / 8`, rounded to six decimals. `mood_provenance` records human annotation. `playable` is false and `audio_path` is null because this pipeline does not download or verify recording rights. The [DEAM manual](https://cvml.unige.ch/databases/DEAM/manual.pdf) describes the annotations and non-commercial BY-NC terms. It reports that 2015 labels have different collection details; this pipeline retains `metadata_year` and does not treat all annotations as equally reliable.

## `validation_report.json`

Records counts, mood quadrant coverage, zero or missing metadata, normalization formula, source licenses, and pinned SHA-256 hashes. It intentionally contains no generated timestamp so repeated runs on unchanged inputs produce the same report bytes.

## Data boundaries

- `data/catalog/demo-tracks.json` is the only playable catalog in Phase 1.
- DEAM records are research annotations and are **not** joined to the generated clips.
- GoEmotions text is for classifier work, not a measurement of actual listener mood.
- Synthetic likes are development fixtures, not evaluation labels.
- Raw user check-ins are not collected or stored by this pipeline.

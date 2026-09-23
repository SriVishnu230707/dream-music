# Phase 1: reproducible data pipeline

## Run from a clean checkout

Requirements: Node.js for Phase 0 clip generation and Python 3.12+ for the standard-library data pipeline.

```powershell
npm ci
npm run generate:demo
npm run verify:phase0
python scripts/prepare_data.py --dataset all
python -m unittest discover -s tests -v
```

The first online run downloads GoEmotions split files plus DEAM metadata and annotations, checks each against a pinned SHA-256 value, and caches them in `data/raw/`. Later runs can use `--offline`. If an upstream file changes, the pipeline stops instead of silently changing the dataset; review and intentionally update its checksum before accepting a new version. Audio from DEAM is not downloaded. `data/raw/`, `data/processed/`, and generated demo WAV files are ignored by Git.

Use `--dataset seed`, `--dataset goemotions`, or `--dataset deam` to prepare one source. Run `--dataset all` for the complete validation report. A subset run rewrites the report with that subset only.

## Validation result on 2026-09-24

| Source | Result |
| --- | ---: |
| Playable project-generated demo tracks | 12 |
| Demo mood quadrants | 3 tracks each in 4 quadrants |
| Fictional development users | 3 |
| Synthetic development interactions | 12 |
| Evaluation-eligible synthetic interactions | 0 |
| GoEmotions train / dev / test | 43,410 / 5,426 / 5,427 |
| Duplicate-free model train / dev / test | 43,189 / 5,375 / 5,379 |
| Repeated text removed from model splits | 221 / 51 / 48 |
| Repeated text crossing upstream split boundaries | 97 |
| DEAM song-level annotations joined to metadata | 1,802 |
| DEAM records with missing metadata | 0 |
| Playable DEAM records in this pipeline | 0 |

The full machine-readable result is regenerated at `data/processed/validation_report.json`. The repeated-text counts are from normalized case and whitespace; 97 later-split rows repeated text from an earlier split. The original splits remain available, but Phase 2 should use `model_splits/`. See [the data dictionary](DATA_DICTIONARY.md) for field definitions and source limitations.

## Phase boundary

The seed database and dataset preparation are ready for model development. The next phase is to train and evaluate a text classifier, document how its labels map to valence–arousal coordinates, and build a manual fallback. Real listener interactions and a production PostgreSQL schema are not part of this data preparation phase.

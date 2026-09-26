# Phase 7 synthetic smoke report

This report verifies the evaluator on three authored engineering cases. These are **synthetic labels**, not listener judgments. The catalog contains generated audio with design-proxy mood coordinates. No real held-out or consented participant outcomes were available.

Command: `go run ./cmd/phase7-eval -root . -input docs/fixtures/phase7-smoke.jsonl -k 5 -seed 7`

- Evaluator: `phase7-eval-v1`; sequencer: `drift-beam-v1`; catalog: `generated-demo-v1`.
- Catalog SHA-256: `7fc753b2448790416f5e762196da448234265aceaca056e45af11d7a9b4669ef`.
- Input SHA-256: `faad5ced2e0173d6424894b15f3f1fab1858b9e8f96b5b619cf66a84d8c301ec`.
- Test cases: 3; queue length and ranking depth: 5; bootstrap seed: 7.

| Method | Precision@5 | Recall@5 | NDCG@5 | Mean path distance | Max adjacent transition | Final target gap |
|---|---:|---:|---:|---:|---:|---:|
| Popularity | 0.133 | 0.667 | 0.544 | 0.245 | 0.524 | 0.416 |
| Taste only | 0.133 | 0.500 | 0.412 | 0.279 | 0.410 | 0.432 |
| Mood drift | 0.200 | 0.833 | 0.352 | 0.161 | 0.295 | 0.191 |

On these authored cases, drift followed the requested path more closely, but popularity had higher NDCG. The paired drift-minus-popularity NDCG difference was −0.192, with a 1,000-resample percentile interval from −0.569 to 0.237. The interval is unstable with three cases and has no inferential value for listeners. The result illustrates a possible tradeoff that real evaluation must test, not a product benefit.

The study-format fixture contains one synthetic participant and three rows. It validates consent, order, ratings, optional mood pairs, and report shape. Its ratings and mood changes are invented test values and must not be cited as user outcomes.

The remaining evidence gap is a frozen real test cohort and balanced, consented listening sessions. Those data should remain outside Git; report only aggregate and pseudonymous outputs.

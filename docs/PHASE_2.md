# Phase 2: mood suggestion baseline

## Setup and run

From the repository root after Phase 1 preparation:

```powershell
python -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements-phase2.txt
.\.venv\Scripts\python scripts/train_mood.py
.\.venv\Scripts\python -m unittest discover -s tests -v
.\.venv\Scripts\python -m uvicorn mood_service.app:app --host 127.0.0.1 --port 8000
```

`models/mood-v1/` contains local `model.npz`, `vocabulary.json`, and `evaluation.json` and is excluded from Git. Rebuild them from the duplicate-free Phase 1 GoEmotions model splits. The service checks file hashes, array shapes, and finite values before loading data-only artifacts; it does not unpickle model objects.

The training script fits one shared word and bigram TF-IDF vectorizer on **train only**, then compares one-vs-rest logistic regression and linear SVM. It chooses a global decision threshold for each model using dev macro F1 and records held-out test metrics and per-label precision, recall, F1, and support. Logistic regression is served for its probability output; the SVM is an offline benchmark. Its probability is not calibrated as certainty about a person's mood.

## Prediction and confirmation

`POST /v1/mood/predict` accepts `{ "text": "..." }`, at most 1,000 characters. It returns predicted labels, a provisional `suggestedMood`, model and mapping versions, and `needsManualSelection`. Empty or out-of-vocabulary text has no suggested mood and requires manual selection. Every prediction requires user confirmation. The manual cutoff is selected from dev score bins by a documented rule: at least 70% top-label precision and 20% coverage. The current cutoff is 0.90; on dev, it covered 1,610 of 5,375 examples with 74.6% top-label precision. The test split was inspected during prototype development, so its metrics are descriptive rather than a blind final estimate. These results do not establish performance on personal check-ins.

`POST /v1/mood/confirm` accepts `valence`, `arousal`, and `source` (`manual`, `text-model`, or `user-corrected`), plus optional `confidence`. It returns `startMood` in the Phase 0 session contract shape. The API is stateless and does not retain check-in text. It binds to localhost in the run command; authentication and production deployment are outside this phase.

## Mapping limits

`mood_service/mapping.py` is versioned `goemotions-va-v1`. Its 28 coordinates are editorial hypotheses, not clinical measurements or validated song annotations. When multiple non-neutral labels pass the model threshold, their coordinates are averaged with predicted scores as weights. The user-confirmed mood is authoritative for a later session.

GoEmotions comments differ from personal check-ins. The API smoke phrases test integration and fallback behavior, **not** real-world accuracy. A consented, human-reviewed check-in evaluation set is still needed before claiming that the classifier generalizes to listener check-ins. No raw user check-in text is saved by this phase.

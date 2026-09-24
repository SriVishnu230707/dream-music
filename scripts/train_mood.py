"""Train and compare reproducible multi-label GoEmotions TF-IDF baselines."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import tempfile
from pathlib import Path

import numpy as np
import sklearn
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import f1_score, multilabel_confusion_matrix, precision_recall_fscore_support
from sklearn.multiclass import OneVsRestClassifier
from sklearn.preprocessing import MultiLabelBinarizer
from sklearn.svm import LinearSVC

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from mood_service.mapping import COORDINATES, MAPPING_VERSION  # noqa: E402

DATA = ROOT / "data" / "processed" / "goemotions" / "model_splits"
ARTIFACTS = ROOT / "models" / "mood-v1"
LABELS = tuple(COORDINATES)
MODEL_VERSION = "tfidf-logreg-ovr-v1"


def load_split(name: str) -> tuple[list[str], np.ndarray]:
    path = DATA / f"{name}.jsonl"
    rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]
    if not rows or any(not row["text"].strip() for row in rows):
        raise ValueError(f"Empty or malformed {name} split")
    if any(not set(row["labels"]).issubset(LABELS) for row in rows):
        raise ValueError(f"Unknown label in {name} split")
    mlb = MultiLabelBinarizer(classes=LABELS)
    mlb.fit([LABELS])
    return [row["text"] for row in rows], mlb.transform([row["labels"] for row in rows])


def metrics(y_true: np.ndarray, y_pred: np.ndarray) -> dict:
    precision, recall, f1, support = precision_recall_fscore_support(
        y_true, y_pred, average=None, zero_division=0
    )
    confusion = multilabel_confusion_matrix(y_true, y_pred)
    return {
        "macro_f1": round(float(f1_score(y_true, y_pred, average="macro", zero_division=0)), 4),
        "micro_f1": round(float(f1_score(y_true, y_pred, average="micro", zero_division=0)), 4),
        "per_label": {
            label: {"precision": round(float(precision[i]), 4),
                    "recall": round(float(recall[i]), 4),
                    "f1": round(float(f1[i]), 4), "support": int(support[i]),
                    "false_positive": int(confusion[i, 0, 1]),
                    "false_negative": int(confusion[i, 1, 0])}
            for i, label in enumerate(LABELS)
        },
    }


def score_analysis(y_true: np.ndarray, scores: np.ndarray) -> dict:
    top = scores.argmax(axis=1)
    best = scores.max(axis=1)
    correct = y_true[np.arange(len(y_true)), top]
    return {
        "mean_multilabel_brier": round(float(np.mean((scores - y_true) ** 2)), 4),
        "top_label_precision_by_score": {
            f"at_least_{cutoff:.1f}": {
                "count": int((best >= cutoff).sum()),
                "precision": round(float(correct[best >= cutoff].mean()), 4)
                if (best >= cutoff).any() else None,
            }
            for cutoff in (0.5, 0.7, 0.9)
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ARTIFACTS)
    args = parser.parse_args()
    train_text, train_y = load_split("train")
    dev_text, dev_y = load_split("dev")
    test_text, test_y = load_split("test")
    vectorizer = TfidfVectorizer(ngram_range=(1, 2), min_df=2, max_features=60000,
                                  sublinear_tf=True, strip_accents="unicode")
    train_x = vectorizer.fit_transform(train_text)
    dev_x = vectorizer.transform(dev_text)
    test_x = vectorizer.transform(test_text)
    comparison = {}
    chosen = None
    for name, estimator, thresholds in (
        ("logistic_regression", LogisticRegression(solver="liblinear", max_iter=250, random_state=42,
                                                    class_weight="balanced"),
         (0.30, 0.40, 0.50, 0.60)),
        ("linear_svm", LinearSVC(random_state=42), (-0.4, -0.2, 0.0)),
    ):
        model = OneVsRestClassifier(estimator, n_jobs=1)
        model.fit(train_x, train_y)
        dev_scores = model.predict_proba(dev_x) if name == "logistic_regression" else model.decision_function(dev_x)
        options = [(metrics(dev_y, dev_scores >= threshold)["macro_f1"], threshold)
                   for threshold in thresholds]
        best_f1, threshold = max(options, key=lambda item: (item[0], -abs(item[1])))
        test_scores = model.predict_proba(test_x) if name == "logistic_regression" else model.decision_function(test_x)
        comparison[name] = {
            "dev_macro_f1": best_f1, "selected_threshold": threshold,
            "dev": metrics(dev_y, dev_scores >= threshold),
            "test": metrics(test_y, test_scores >= threshold),
        }
        if name == "logistic_regression":
            comparison[name]["dev_score_analysis"] = score_analysis(dev_y, dev_scores)
            comparison[name]["test_score_analysis"] = score_analysis(test_y, test_scores)
        if name == "logistic_regression":
            chosen = model
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".mood-stage-", dir=args.output.parent) as temporary:
        stage = Path(temporary)
        model_path = stage / "model.npz"
        vocabulary_path = stage / "vocabulary.json"
        np.savez_compressed(
            model_path,
            idf=vectorizer.idf_,
            coef=np.stack([estimator.coef_[0] for estimator in chosen.estimators_]),
            intercept=np.array([estimator.intercept_[0] for estimator in chosen.estimators_]),
        )
        vocabulary_path.write_text(
            json.dumps({term: int(index) for term, index in vectorizer.vocabulary_.items()}, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        dev_bins = comparison["logistic_regression"]["dev_score_analysis"]["top_label_precision_by_score"]
        eligible = [cutoff for cutoff in (0.5, 0.7, 0.9)
                    if dev_bins[f"at_least_{cutoff:.1f}"]["count"] >= len(dev_text) * 0.2
                    and (dev_bins[f"at_least_{cutoff:.1f}"]["precision"] or 0) >= 0.70]
        manual_threshold = min(eligible) if eligible else 1.0
        report = {
            "model_version": MODEL_VERSION, "mapping_version": MAPPING_VERSION,
            "selection": "Logistic regression served for probability output; SVM is an offline benchmark.",
            "threshold_selection": "Per-model global threshold chosen by dev macro F1.",
            "training_rows": len(train_text), "dev_rows": len(dev_text), "test_rows": len(test_text),
            "feature_count": len(vectorizer.vocabulary_), "sklearn_version": sklearn.__version__,
            "labels": LABELS,
            "manual_score_threshold": manual_threshold,
            "manual_threshold_basis": "Smallest tested dev cutoff with >=0.70 top-label precision and >=20% coverage; otherwise always prompt manual selection.",
            "source_sha256": {name: hashlib.sha256((DATA / f"{name}.jsonl").read_bytes()).hexdigest()
                              for name in ("train", "dev", "test")},
            "models": comparison,
            "artifact_sha256": {name: hashlib.sha256((stage / name).read_bytes()).hexdigest()
                                for name in ("model.npz", "vocabulary.json")},
            "limitations": ["GoEmotions comments are not validated listener check-ins.",
                            "Emotion-to-coordinate mapping is provisional.",
                            "Probabilities are not calibrated as personal-mood certainty.",
                            "The test split was inspected during prototype development; treat its metrics as descriptive, not a blind final estimate."],
        }
        (stage / "evaluation.json").write_text(
            json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8"
        )
        args.output.mkdir(parents=True, exist_ok=True)
        for name in ("model.npz", "vocabulary.json", "evaluation.json"):
            (stage / name).replace(args.output / name)
    print(json.dumps({name: {"dev_macro_f1": result["dev_macro_f1"],
                             "test_macro_f1": result["test"]["macro_f1"]}
                      for name, result in comparison.items()}, indent=2))


if __name__ == "__main__":
    main()

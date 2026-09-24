"""Stateless local mood suggestion and confirmation API; no check-in storage."""

from __future__ import annotations

import hashlib
import json
import math
import os
import zipfile
from pathlib import Path
from typing import Literal

import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator
from scipy.special import expit
from sklearn.feature_extraction.text import TfidfVectorizer

from .mapping import COORDINATES, MAPPING_VERSION, weighted_coordinates

DEFAULT_MODEL_DIR = Path(__file__).resolve().parents[1] / "models" / "mood-v1"


class PredictRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str = Field(max_length=1000)


class ConfirmRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    valence: float = Field(ge=0, le=1)
    arousal: float = Field(ge=0, le=1)
    source: Literal["manual", "text-model", "user-corrected"]
    confidence: float | None = Field(default=None, ge=0, le=1)

    @field_validator("valence", "arousal", "confidence", mode="before")
    @classmethod
    def finite(cls, value: object) -> object:
        if value is not None and (isinstance(value, bool) or not isinstance(value, (int, float))):
            raise ValueError("Coordinate must be a JSON number")
        if value is not None and not math.isfinite(value):
            raise ValueError("Coordinate must be finite")
        return value


def load_bundle(directory: Path) -> tuple[dict, dict]:
    model_path = directory / "model.npz"
    vocabulary_path = directory / "vocabulary.json"
    report = json.loads((directory / "evaluation.json").read_text(encoding="utf-8"))
    for path, limit in ((model_path, 100_000_000), (vocabulary_path, 10_000_000)):
        if path.stat().st_size > limit:
            raise ValueError(f"Oversized model artifact: {path.name}")
        if hashlib.sha256(path.read_bytes()).hexdigest() != report["artifact_sha256"][path.name]:
            raise ValueError(f"Model artifact hash mismatch: {path.name}")
    if tuple(report["labels"]) != tuple(COORDINATES) or report["mapping_version"] != MAPPING_VERSION:
        raise ValueError("Model labels or mapping version mismatch")
    with zipfile.ZipFile(model_path) as archive:
        if any(info.file_size > 30_000_000 for info in archive.infolist()):
            raise ValueError("Oversized model array")
    vocabulary = json.loads(vocabulary_path.read_text(encoding="utf-8"))
    if (len(vocabulary) != report["feature_count"] or
            sorted(vocabulary.values()) != list(range(len(vocabulary)))):
        raise ValueError("Invalid model vocabulary")
    with np.load(model_path, allow_pickle=False) as arrays:
        if set(arrays.files) != {"idf", "coef", "intercept"}:
            raise ValueError("Unexpected model arrays")
        idf, coef, intercept = (arrays[name].copy() for name in ("idf", "coef", "intercept"))
    if (idf.shape != (len(vocabulary),) or coef.shape != (len(COORDINATES), len(vocabulary)) or
            intercept.shape != (len(COORDINATES),) or
            not all(np.isfinite(array).all() for array in (idf, coef, intercept))):
        raise ValueError("Invalid model array shape or value")
    vectorizer = TfidfVectorizer(vocabulary=vocabulary, ngram_range=(1, 2),
                                  sublinear_tf=True, strip_accents="unicode")
    vectorizer.vocabulary_ = vocabulary
    vectorizer.fixed_vocabulary_ = True
    vectorizer.idf_ = idf
    bundle = {"vectorizer": vectorizer, "coef": coef, "intercept": intercept,
              "labels": tuple(report["labels"]), "model_version": report["model_version"]}
    return bundle, report


def create_app(model_dir: Path | None = None) -> FastAPI:
    directory = model_dir or Path(os.environ.get("MOOD_MODEL_DIR", DEFAULT_MODEL_DIR))
    bundle, report = load_bundle(directory)
    app = FastAPI(title="Mood Drift Phase 2", version="1.0.0")
    labels = list(bundle["labels"])
    threshold = report["models"]["logistic_regression"]["selected_threshold"]
    manual_threshold = report["manual_score_threshold"]

    @app.get("/health")
    def health() -> dict:
        return {"status": "ok", "modelVersion": bundle["model_version"]}

    @app.post("/v1/mood/predict")
    def predict(request: PredictRequest) -> dict:
        text = request.text.strip()
        if not text:
            return {"labels": [], "suggestedMood": None, "confidence": None,
                    "modelVersion": bundle["model_version"], "mappingVersion": MAPPING_VERSION,
                    "requiresConfirmation": True, "needsManualSelection": True,
                    "reason": "empty_text"}
        features = bundle["vectorizer"].transform([text])
        if features.nnz == 0:
            return {"labels": [], "suggestedMood": None, "confidence": None,
                    "modelVersion": bundle["model_version"], "mappingVersion": MAPPING_VERSION,
                    "requiresConfirmation": True, "needsManualSelection": True,
                    "reason": "out_of_vocabulary"}
        scores = expit(np.asarray(features @ bundle["coef"].T).ravel() + bundle["intercept"])
        ranked = sorted(range(len(labels)), key=lambda i: float(scores[i]), reverse=True)
        selected = [i for i in ranked if scores[i] >= threshold][:3]
        if len(selected) > 1:
            selected = [i for i in selected if labels[i] != "neutral"] or selected
        chosen = selected or ranked[:1]
        confidence = round(float(scores[ranked[0]]), 4)
        manual = not selected or confidence < manual_threshold
        return {
            "labels": [{"label": labels[i], "score": round(float(scores[i]), 4)} for i in chosen],
            "suggestedMood": weighted_coordinates([labels[i] for i in chosen], [float(scores[i]) for i in chosen]),
            "confidence": confidence, "modelVersion": bundle["model_version"],
            "mappingVersion": MAPPING_VERSION, "requiresConfirmation": True,
            "needsManualSelection": manual,
            "reason": "low_confidence" if manual else None,
        }

    @app.post("/v1/mood/confirm")
    def confirm(request: ConfirmRequest) -> dict:
        if request.source == "text-model" and request.confidence is None:
            raise HTTPException(status_code=400, detail="text-model confirmation requires confidence")
        return {"startMood": request.model_dump(), "confirmed": True}

    return app


app = create_app()

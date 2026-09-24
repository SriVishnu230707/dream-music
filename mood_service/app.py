"""Stateless local mood suggestion and confirmation API; no check-in storage."""

from __future__ import annotations

import hashlib
import json
import math
import os
from pathlib import Path
from typing import Literal

import joblib
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator

from .mapping import COORDINATES, MAPPING_VERSION, weighted_coordinates

DEFAULT_MODEL_DIR = Path(__file__).resolve().parents[1] / "models" / "mood-v1"
MANUAL_THRESHOLD = 0.90  # About 73% top-label precision above this score on held-out GoEmotions.


class PredictRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str = Field(max_length=1000)


class ConfirmRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    valence: float = Field(ge=0, le=1)
    arousal: float = Field(ge=0, le=1)
    source: Literal["manual", "text-model", "user-corrected"]
    confidence: float | None = Field(default=None, ge=0, le=1)

    @field_validator("valence", "arousal", "confidence")
    @classmethod
    def finite(cls, value: float | None) -> float | None:
        if value is not None and not math.isfinite(value):
            raise ValueError("Coordinate must be finite")
        return value


def load_bundle(directory: Path) -> tuple[dict, dict]:
    model_path = directory / "model.joblib"
    report = json.loads((directory / "evaluation.json").read_text(encoding="utf-8"))
    actual = hashlib.sha256(model_path.read_bytes()).hexdigest()
    if actual != report["served_model_sha256"]:
        raise ValueError("Model artifact hash does not match evaluation report")
    # joblib uses pickle: load only a locally trained, trusted model artifact.
    bundle = joblib.load(model_path)
    if tuple(bundle["labels"]) != tuple(COORDINATES) or bundle["mapping_version"] != MAPPING_VERSION:
        raise ValueError("Model labels or mapping version mismatch")
    return bundle, report


def create_app(model_dir: Path | None = None) -> FastAPI:
    directory = model_dir or Path(os.environ.get("MOOD_MODEL_DIR", DEFAULT_MODEL_DIR))
    bundle, report = load_bundle(directory)
    app = FastAPI(title="Mood Drift Phase 2", version="1.0.0")
    labels = list(bundle["labels"])
    threshold = report["models"]["logistic_regression"]["selected_threshold"]

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
        scores = bundle["classifier"].predict_proba(features)[0]
        ranked = sorted(range(len(labels)), key=lambda i: float(scores[i]), reverse=True)
        selected = [i for i in ranked if scores[i] >= threshold][:3]
        if len(selected) > 1:
            selected = [i for i in selected if labels[i] != "neutral"] or selected
        chosen = selected or ranked[:1]
        confidence = round(float(scores[ranked[0]]), 4)
        manual = not selected or confidence < MANUAL_THRESHOLD
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

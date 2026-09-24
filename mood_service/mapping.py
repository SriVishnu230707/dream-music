"""Versioned, provisional GoEmotions label to valence/arousal mapping."""

MAPPING_VERSION = "goemotions-va-v1"

# Editorial hypotheses for a music check-in, not clinical or measured coordinates.
COORDINATES = {
    "admiration": (0.80, 0.55), "amusement": (0.84, 0.68),
    "anger": (0.12, 0.88), "annoyance": (0.25, 0.68),
    "approval": (0.72, 0.43), "caring": (0.76, 0.40),
    "confusion": (0.42, 0.55), "curiosity": (0.62, 0.60),
    "desire": (0.68, 0.70), "disappointment": (0.24, 0.35),
    "disapproval": (0.30, 0.54), "disgust": (0.16, 0.68),
    "embarrassment": (0.28, 0.58), "excitement": (0.89, 0.90),
    "fear": (0.16, 0.85), "gratitude": (0.84, 0.42),
    "grief": (0.10, 0.26), "joy": (0.91, 0.73),
    "love": (0.90, 0.55), "nervousness": (0.28, 0.78),
    "optimism": (0.78, 0.60), "pride": (0.80, 0.66),
    "realization": (0.56, 0.55), "relief": (0.73, 0.27),
    "remorse": (0.20, 0.35), "sadness": (0.14, 0.23),
    "surprise": (0.58, 0.78), "neutral": (0.50, 0.50),
}


def weighted_coordinates(labels: list[str], scores: list[float]) -> dict[str, float]:
    if len(labels) != len(scores) or not labels:
        raise ValueError("Matching nonempty labels and scores required")
    if any(label not in COORDINATES for label in labels):
        raise ValueError("Unknown emotion label")
    weights = [max(0.0, float(score)) for score in scores]
    total = sum(weights)
    if total <= 0:
        raise ValueError("Positive score required")
    return {
        "valence": round(sum(COORDINATES[label][0] * weight for label, weight in zip(labels, weights)) / total, 4),
        "arousal": round(sum(COORDINATES[label][1] * weight for label, weight in zip(labels, weights)) / total, 4),
    }

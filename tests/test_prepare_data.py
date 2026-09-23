import importlib.util
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).resolve().parents[1] / "scripts" / "prepare_data.py"
SPEC = importlib.util.spec_from_file_location("prepare_data", MODULE_PATH)
prepare_data = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(prepare_data)


class DataPipelineTests(unittest.TestCase):
    def test_normalization_boundaries_and_rejection(self):
        self.assertEqual(prepare_data.unit_interval(1, 1, 9), 0)
        self.assertEqual(prepare_data.unit_interval(5, 1, 9), 0.5)
        self.assertEqual(prepare_data.unit_interval(9, 1, 9), 1)
        with self.assertRaises(ValueError):
            prepare_data.unit_interval(0.9, 1, 9)
        with self.assertRaises(ValueError):
            prepare_data.unit_interval(9.1, 1, 9)

    def test_seed_database_rejects_orphan_interaction(self):
        with tempfile.TemporaryDirectory() as temp:
            original = prepare_data.PROCESSED
            prepare_data.PROCESSED = Path(temp)
            try:
                track = {
                    "id": "one", "title": "One", "artist": "Demo", "genre": "ambient",
                    "bpm": 60, "valence": 0.5, "arousal": 0.5,
                    "audio_path": "audio/generated/one.wav", "mood_provenance": "design-proxy",
                    "rights": "project-original-demo",
                }
                event = {
                    "event_id": "orphan", "user_id": "demo", "track_id": "missing",
                    "event_type": "like", "partition": "development_only",
                }
                with self.assertRaises(sqlite3.IntegrityError):
                    prepare_data.build_seed_db([track], [event])
                self.assertFalse((Path(temp) / "seed.sqlite").exists())
            finally:
                prepare_data.PROCESSED = original

    def test_report_is_deterministic_and_synthetic_labels_explicit(self):
        report = json.loads((prepare_data.PROCESSED / "validation_report.json").read_text(encoding="utf-8"))
        seed = report["datasets"]["seed"]
        self.assertEqual(seed["tracks"], 12)
        self.assertEqual(seed["synthetic_interactions"], 12)
        self.assertEqual(seed["evaluation_eligible_interactions"], 0)
        self.assertEqual(set(seed["quadrants"]), {"high-high", "high-low", "low-high", "low-low"})
        model = report["datasets"]["goemotions"]
        self.assertEqual(model["model_split_counts"], {"train": 43189, "dev": 5375, "test": 5379})
        self.assertEqual(sum(model["duplicate_text_cross_split"].values()), 97)

    def test_model_splits_have_no_repeated_text(self):
        folder = prepare_data.PROCESSED / "goemotions" / "model_splits"
        seen = set()
        for split in ("train", "dev", "test"):
            for line in (folder / f"{split}.jsonl").read_text(encoding="utf-8").splitlines():
                record = json.loads(line)
                normalized = " ".join(record["text"].casefold().split())
                self.assertNotIn(normalized, seen)
                seen.add(normalized)

    def test_bad_cached_checksum_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            original = prepare_data.RAW
            prepare_data.RAW = Path(temp)
            try:
                path = prepare_data.RAW / "goemotions" / "emotions.txt"
                path.parent.mkdir(parents=True)
                path.write_text("changed", encoding="utf-8")
                with self.assertRaisesRegex(ValueError, "Checksum mismatch"):
                    prepare_data.source_file("goemotions/emotions.txt", offline=True)
            finally:
                prepare_data.RAW = original


if __name__ == "__main__":
    unittest.main()

import importlib.util
import unittest
from pathlib import Path

from mood_service.mapping import COORDINATES, weighted_coordinates


class MappingTests(unittest.TestCase):
    def test_mapping_covers_all_labels_and_stays_in_range(self):
        self.assertEqual(len(COORDINATES), 28)
        self.assertTrue(all(0 <= value <= 1 for pair in COORDINATES.values() for value in pair))

    def test_multi_label_weighting(self):
        result = weighted_coordinates(["sadness", "joy"], [1, 1])
        self.assertEqual(result["valence"], 0.525)

    def test_unknown_label_rejected(self):
        with self.assertRaises(ValueError):
            weighted_coordinates(["unknown"], [1])


class ApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not importlib.util.find_spec("fastapi"):
            raise unittest.SkipTest("Install requirements-phase2.txt for API tests")
        from fastapi.testclient import TestClient
        from mood_service.app import app
        cls.client = TestClient(app)

    def test_empty_and_out_of_vocabulary_fallback(self):
        for text in ("  ", "🪐🪐🪐"):
            response = self.client.post("/v1/mood/predict", json={"text": text})
            self.assertEqual(response.status_code, 200)
            self.assertTrue(response.json()["needsManualSelection"])
            self.assertIsNone(response.json()["suggestedMood"])

    def test_prediction_contract(self):
        response = self.client.post("/v1/mood/predict", json={"text": "I feel happy and grateful today"})
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertTrue(body["requiresConfirmation"])
        self.assertGreater(len(body["labels"]), 0)
        self.assertTrue(0 <= body["suggestedMood"]["valence"] <= 1)

    def test_ambiguous_text_requests_manual_selection(self):
        response = self.client.post("/v1/mood/predict", json={"text": "I have mixed feelings about today"})
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["needsManualSelection"])
        self.assertTrue(response.json()["requiresConfirmation"])

    def test_validation_and_confirmed_start(self):
        self.assertEqual(self.client.post("/v1/mood/predict", json={"text": "a" * 1001}).status_code, 422)
        self.assertEqual(self.client.post("/v1/mood/confirm", json={"valence": 2, "arousal": .5, "source": "manual"}).status_code, 422)
        body = self.client.post("/v1/mood/confirm", json={"valence": .2, "arousal": .4,
                                                            "source": "user-corrected"}).json()
        self.assertEqual(body["startMood"], {"valence": .2, "arousal": .4,
                                                "source": "user-corrected", "confidence": None})

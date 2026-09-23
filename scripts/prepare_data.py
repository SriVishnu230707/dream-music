"""Build reproducible Phase 1 datasets using only the Python standard library."""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import sqlite3
import urllib.request
import wave
import zipfile
from collections import Counter
from contextlib import closing
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
PROCESSED = ROOT / "data" / "processed"

SOURCES = {
    "goemotions/emotions.txt": (
        "https://raw.githubusercontent.com/google-research/google-research/master/goemotions/data/emotions.txt",
        "45c3ef86782d2a4d7fedcd6d8c111aa0d0e94720689bd164fac94fefb4495a89",
    ),
    "goemotions/train.tsv": (
        "https://raw.githubusercontent.com/google-research/google-research/master/goemotions/data/train.tsv",
        "1c254a142be5c00e80d819b9ae1bbd36d94b2eeb8f4b1271846508d57e57d9c5",
    ),
    "goemotions/dev.tsv": (
        "https://raw.githubusercontent.com/google-research/google-research/master/goemotions/data/dev.tsv",
        "575489c079c9de1097062a01738f998590d6b7ead66dd1c9fd1d2ba01fd8bc62",
    ),
    "goemotions/test.tsv": (
        "https://raw.githubusercontent.com/google-research/google-research/master/goemotions/data/test.tsv",
        "0587b2dd8b27b97352adbfc3fb083d46005c8946657fdc2b1ca8b1cc7f1f8be4",
    ),
    "deam/annotations.zip": (
        "https://cvml.unige.ch/databases/DEAM/DEAM_Annotations.zip",
        "809b0feb4ba6196c1eda9b2b7b33b892b11fa71457cfceb0d47e832ed1a5f15f",
    ),
    "deam/metadata.zip": (
        "https://cvml.unige.ch/databases/DEAM/metadata.zip",
        "3d1d5ab42e852803a770f2cfbd685c6b464e1ebe76f26b0e10954597902b90f8",
    ),
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def source_file(name: str, offline: bool) -> Path:
    url, expected = SOURCES[name]
    path = RAW / name
    if path.exists():
        actual = sha256(path)
        if actual != expected:
            raise ValueError(f"Checksum mismatch for {path}: {actual}")
        return path
    if offline:
        raise FileNotFoundError(f"Missing {path}; rerun without --offline to fetch it")
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".download")
    try:
        with urllib.request.urlopen(url, timeout=45) as response, temporary.open("wb") as output:
            while chunk := response.read(1024 * 1024):
                output.write(chunk)
        actual = sha256(temporary)
        if actual != expected:
            raise ValueError(f"Downloaded checksum mismatch for {name}: {actual}")
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)
    return path


def jsonl_write(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as output:
        for row in rows:
            output.write(json.dumps(row, sort_keys=True, ensure_ascii=False) + "\n")


def unit_interval(value: float, low: float, high: float) -> float:
    if not low <= value <= high:
        raise ValueError(f"Mood value {value} outside source scale [{low}, {high}]")
    return round((value - low) / (high - low), 6)


def prepare_seed() -> dict:
    manifest = json.loads((ROOT / "data/catalog/demo-tracks.json").read_text(encoding="utf-8"))
    if manifest["schemaVersion"] != "1.0.0":
        raise ValueError("Unsupported catalog schema version")
    tracks = []
    ids = set()
    quadrants = Counter()
    for track in manifest["tracks"]:
        track_id = track["id"]
        if track_id in ids:
            raise ValueError(f"Duplicate track ID: {track_id}")
        ids.add(track_id)
        audio = (ROOT / "data/catalog" / track["audio"]["path"]).resolve()
        expected_dir = (ROOT / "data/catalog/audio/generated").resolve()
        if audio.parent != expected_dir or audio.name != f"{track_id}.wav":
            raise ValueError(f"Unsafe or mismatched audio path: {track_id}")
        if not audio.is_file():
            raise FileNotFoundError(f"Missing demo audio {audio}; run npm run generate:demo")
        with wave.open(str(audio), "rb") as clip:
            if clip.getframerate() != 22050 or clip.getnchannels() != 1 or clip.getsampwidth() != 2:
                raise ValueError(f"Unexpected audio format: {track_id}")
            if clip.getnframes() != 22050 * track["audio"]["durationSeconds"]:
                raise ValueError(f"Audio duration mismatch: {track_id}")
        valence = unit_interval(float(track["mood"]["valence"]), 0, 1)
        arousal = unit_interval(float(track["mood"]["arousal"]), 0, 1)
        quadrants[f"{'low' if valence < .5 else 'high'}-{'low' if arousal < .5 else 'high'}"] += 1
        tracks.append({
            "id": track_id,
            "title": track["title"],
            "artist": track["artist"],
            "genre": track["genre"],
            "bpm": track["bpm"],
            "valence": valence,
            "arousal": arousal,
            "original_mood_scale": "0..1",
            "mood_provenance": track["mood"]["provenance"],
            "audio_path": track["audio"]["path"],
            "playable": True,
            "rights": track["audio"]["rights"],
            "attribution": track["attribution"],
        })
    tracks.sort(key=lambda row: row["id"])
    jsonl_write(PROCESSED / "seed_tracks.jsonl", tracks)

    # Deliberately synthetic development preferences; never use these as evaluation labels.
    preferences = {
        "demo-ambient-low": ["night-rain", "soft-shadow", "dusk-window", "clear-water"],
        "demo-ambient-bright": ["clear-water", "morning-light", "open-sky", "bright-motion"],
        "demo-pulse": ["restless-city", "crossing-lines", "bright-motion", "sunrise-run"],
    }
    interactions = []
    for user_id, liked in sorted(preferences.items()):
        for track_id in liked:
            if track_id not in ids:
                raise ValueError(f"Unknown seed track: {track_id}")
            interactions.append({
                "event_id": f"seed-{user_id}-{track_id}",
                "user_id": user_id,
                "track_id": track_id,
                "event_type": "like",
                "is_synthetic": True,
                "partition": "development_only",
            })
    jsonl_write(PROCESSED / "seed_interactions.jsonl", interactions)
    build_seed_db(tracks, interactions)
    return {
        "catalog_id": manifest["catalogId"],
        "tracks": len(tracks),
        "playable_tracks": len(tracks),
        "quadrants": dict(sorted(quadrants.items())),
        "synthetic_users": len(preferences),
        "synthetic_interactions": len(interactions),
        "evaluation_eligible_interactions": 0,
    }


def build_seed_db(tracks: list[dict], interactions: list[dict]) -> None:
    PROCESSED.mkdir(parents=True, exist_ok=True)
    output = PROCESSED / "seed.sqlite"
    temporary = PROCESSED / "seed.sqlite.tmp"
    temporary.unlink(missing_ok=True)
    try:
        with closing(sqlite3.connect(temporary)) as db:
            db.execute("PRAGMA foreign_keys = ON")
            db.executescript("""
                CREATE TABLE tracks (
                    id TEXT PRIMARY KEY, title TEXT NOT NULL, artist TEXT NOT NULL,
                    genre TEXT NOT NULL, bpm INTEGER NOT NULL,
                    valence REAL NOT NULL CHECK (valence BETWEEN 0 AND 1),
                    arousal REAL NOT NULL CHECK (arousal BETWEEN 0 AND 1),
                    audio_path TEXT NOT NULL UNIQUE, mood_provenance TEXT NOT NULL,
                    rights TEXT NOT NULL
                );
                CREATE TABLE interactions (
                    event_id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
                    track_id TEXT NOT NULL REFERENCES tracks(id), event_type TEXT NOT NULL,
                    is_synthetic INTEGER NOT NULL CHECK (is_synthetic = 1),
                    partition TEXT NOT NULL CHECK (partition = 'development_only')
                );
            """)
            db.executemany(
                "INSERT INTO tracks VALUES (?,?,?,?,?,?,?,?,?,?)",
                [(t["id"], t["title"], t["artist"], t["genre"], t["bpm"],
                  t["valence"], t["arousal"], t["audio_path"], t["mood_provenance"], t["rights"])
                 for t in tracks],
            )
            db.executemany(
                "INSERT INTO interactions VALUES (?,?,?,?,?,?)",
                [(e["event_id"], e["user_id"], e["track_id"], e["event_type"], 1, e["partition"])
                 for e in interactions],
            )
            if db.execute("PRAGMA foreign_key_check").fetchall():
                raise ValueError("Seed database has broken track references")
            db.commit()
        temporary.replace(output)
    finally:
        temporary.unlink(missing_ok=True)


def prepare_goemotions(offline: bool) -> dict:
    names = ["emotions.txt", "train.tsv", "dev.tsv", "test.tsv"]
    paths = {name: source_file(f"goemotions/{name}", offline) for name in names}
    labels = paths["emotions.txt"].read_text(encoding="utf-8").splitlines()
    if len(labels) != 28 or len(set(labels)) != len(labels):
        raise ValueError("Unexpected GoEmotions label list")
    seen_ids = set()
    seen_text = {}
    counts = {}
    model_counts = {}
    duplicate_text_removed = Counter()
    duplicate_text_cross_split = Counter()
    label_counts = Counter()
    for split in ("train", "dev", "test"):
        rows = []
        model_rows = []
        with paths[f"{split}.tsv"].open(encoding="utf-8", newline="") as source:
            for line_number, row in enumerate(csv.reader(source, delimiter="\t"), start=1):
                if len(row) != 3 or not row[0].strip() or not row[2].strip():
                    raise ValueError(f"Malformed GoEmotions {split}:{line_number}")
                text, indexes, example_id = row
                if example_id in seen_ids:
                    raise ValueError(f"Duplicate GoEmotions ID across splits: {example_id}")
                seen_ids.add(example_id)
                try:
                    label_ids = [int(value) for value in indexes.split(",")]
                except ValueError as error:
                    raise ValueError(f"Invalid labels at {split}:{line_number}") from error
                if not label_ids or len(set(label_ids)) != len(label_ids) or any(i < 0 or i >= len(labels) for i in label_ids):
                    raise ValueError(f"Invalid label IDs at {split}:{line_number}")
                resolved = [labels[i] for i in label_ids]
                label_counts.update(resolved)
                record = {"id": example_id, "text": text, "labels": resolved, "split": split}
                rows.append(record)
                normalized_text = " ".join(text.casefold().split())
                if normalized_text in seen_text:
                    duplicate_text_removed[split] += 1
                    if seen_text[normalized_text] != split:
                        duplicate_text_cross_split[f"{seen_text[normalized_text]}->{split}"] += 1
                else:
                    seen_text[normalized_text] = split
                    model_rows.append(record)
        jsonl_write(PROCESSED / "goemotions" / f"{split}.jsonl", rows)
        jsonl_write(PROCESSED / "goemotions" / "model_splits" / f"{split}.jsonl", model_rows)
        counts[split] = len(rows)
        model_counts[split] = len(model_rows)
    return {
        "source": "Google Research GoEmotions simplified split",
        "license": "CC-BY-4.0 per Google Research repository",
        "labels": labels,
        "split_counts": counts,
        "model_split_counts": model_counts,
        "duplicate_text_removed": dict(sorted(duplicate_text_removed.items())),
        "duplicate_text_cross_split": dict(sorted(duplicate_text_cross_split.items())),
        "total_examples": len(seen_ids),
        "label_frequency": dict(sorted(label_counts.items())),
        "source_sha256": {name: sha256(path) for name, path in sorted(paths.items())},
        "mapping_to_valence_arousal": "not_defined_in_phase_1",
    }


def zip_csv(archive: zipfile.ZipFile, name: str) -> list[list[str]]:
    with archive.open(name) as source:
        return list(csv.reader(io.TextIOWrapper(source, encoding="utf-8-sig", errors="replace", newline="")))


def prepare_deam(offline: bool) -> dict:
    annotations_path = source_file("deam/annotations.zip", offline)
    metadata_path = source_file("deam/metadata.zip", offline)
    metadata = {}
    with zipfile.ZipFile(metadata_path) as archive:
        for year in (2013, 2014, 2015):
            rows = zip_csv(archive, f"metadata/metadata_{year}.csv")
            for row in rows[1:]:
                if not row or not row[0].strip().isdigit():
                    continue
                song_id = int(row[0].strip())
                if song_id in metadata:
                    raise ValueError(f"Duplicate DEAM metadata ID: {song_id}")
                if year == 2013:
                    artist, title, genre = row[2].strip(), row[3].strip(), row[6].strip()
                elif year == 2014:
                    artist, title, genre = row[1].strip(), row[3].strip(), row[4].strip()
                else:
                    artist, title, genre = row[3].strip(), row[2].strip(), row[5].strip()
                metadata[song_id] = {"artist": artist, "title": title, "genre": genre, "metadata_year": year}

    records = []
    seen_ids = set()
    missing_metadata = []
    quadrants = Counter()
    with zipfile.ZipFile(annotations_path) as archive:
        names = [
            "annotations/annotations averaged per song/song_level/static_annotations_averaged_songs_1_2000.csv",
            "annotations/annotations averaged per song/song_level/static_annotations_averaged_songs_2000_2058.csv",
        ]
        for name in names:
            rows = zip_csv(archive, name)
            columns = [column.strip() for column in rows[0]]
            for row in rows[1:]:
                if not row or not row[0].strip().isdigit():
                    continue
                values = dict(zip(columns, row))
                song_id = int(values["song_id"].strip())
                if song_id in seen_ids:
                    raise ValueError(f"Duplicate DEAM annotation ID: {song_id}")
                seen_ids.add(song_id)
                if song_id not in metadata:
                    missing_metadata.append(song_id)
                    continue
                original_valence = float(values["valence_mean"].strip())
                original_arousal = float(values["arousal_mean"].strip())
                valence = unit_interval(original_valence, 1, 9)
                arousal = unit_interval(original_arousal, 1, 9)
                quadrants[f"{'low' if valence < .5 else 'high'}-{'low' if arousal < .5 else 'high'}"] += 1
                records.append({
                    "id": f"deam-{song_id}",
                    "source_song_id": song_id,
                    **metadata[song_id],
                    "valence": valence,
                    "arousal": arousal,
                    "original_valence": original_valence,
                    "original_arousal": original_arousal,
                    "original_mood_scale": "1..9",
                    "mood_provenance": "DEAM song-level human annotation",
                    "playable": False,
                    "audio_path": None,
                })
    records.sort(key=lambda row: row["source_song_id"])
    jsonl_write(PROCESSED / "deam_tracks.jsonl", records)
    return {
        "source": "DEAM song-level static annotations and metadata",
        "license": "CC-BY-NC per DEAM manual; non-commercial research use",
        "annotation_count": len(seen_ids),
        "metadata_count": len(metadata),
        "usable_records": len(records),
        "missing_metadata_ids": missing_metadata,
        "playable_records": 0,
        "quadrants": dict(sorted(quadrants.items())),
        "normalization": "(source_value - 1) / 8",
        "source_sha256": {"annotations.zip": sha256(annotations_path), "metadata.zip": sha256(metadata_path)},
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", choices=["seed", "goemotions", "deam", "all"], default="all")
    parser.add_argument("--offline", action="store_true", help="Use only checksum-verified local source files")
    args = parser.parse_args()
    report = {"report_version": "1.0.0", "datasets": {}}
    if args.dataset in ("seed", "all"):
        report["datasets"]["seed"] = prepare_seed()
    if args.dataset in ("goemotions", "all"):
        report["datasets"]["goemotions"] = prepare_goemotions(args.offline)
    if args.dataset in ("deam", "all"):
        report["datasets"]["deam"] = prepare_deam(args.offline)
    PROCESSED.mkdir(parents=True, exist_ok=True)
    (PROCESSED / "validation_report.json").write_text(
        json.dumps(report, indent=2, sort_keys=True, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(json.dumps({name: {key: value for key, value in data.items() if key in (
        "tracks", "synthetic_interactions", "total_examples", "split_counts", "usable_records", "missing_metadata_ids"
    )} for name, data in report["datasets"].items()}, indent=2))


if __name__ == "__main__":
    main()

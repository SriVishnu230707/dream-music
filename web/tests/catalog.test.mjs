import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { selectLongTrackCandidates, MIN_FULL_SONG_SECONDS } from '../src/data/plan.ts';

const catalog = JSON.parse(readFileSync(new URL('../src/data/archiveCatalog.json', import.meta.url), 'utf8'));

test('the catalog uses one licensed source with unique full-length audio', () => {
  assert.ok(catalog.length >= 20);
  assert.equal(new Set(catalog.map((track) => track.id)).size, catalog.length);
  assert.equal(new Set(catalog.map((track) => track.audioUrl)).size, catalog.length);
  assert.equal(selectLongTrackCandidates(catalog).length, catalog.length);
  for (const track of catalog) {
    assert.match(track.id, /^[a-z0-9-]+$/);
    assert.equal(new URL(track.audioUrl).hostname, 'archive.org');
    assert.ok(new URL(track.audioUrl).pathname.startsWith('/download/'));
    assert.equal(track.licenseUrl, 'https://creativecommons.org/licenses/by/4.0/');
    assert.ok(track.durationSeconds >= MIN_FULL_SONG_SECONDS);
    assert.ok(track.attribution.includes(track.artist));
    assert.ok(track.mood.valence >= 0 && track.mood.valence <= 1);
    assert.ok(track.mood.arousal >= 0 && track.mood.arousal <= 1);
  }
});

test('preview hosts and repeated audio URLs cannot enter the playable catalog', () => {
  const valid = catalog[0];
  assert.deepEqual(selectLongTrackCandidates([
    valid,
    { ...valid, id: 'duplicate' },
    { ...valid, id: 'preview', audioUrl: 'https://audio-ssl.itunes.apple.com/preview.m4a' },
    { ...valid, id: 'short', audioUrl: 'https://archive.org/download/test/short.mp3', durationSeconds: 30 },
  ]).map((track) => track.id), [valid.id]);
});

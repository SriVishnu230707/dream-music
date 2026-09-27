import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { selectLongTrackCandidates, MIN_FULL_SONG_SECONDS } from '../src/data/plan.ts';

const catalog = JSON.parse(readFileSync(new URL('../src/data/catalog.json', import.meta.url), 'utf8'));

test('catalog track identities and provider URLs are safe and distinct', () => {
  assert.equal(catalog.length, 1000);
  assert.equal(new Set(catalog.map((track) => track.id)).size, catalog.length);
  for (const track of catalog) {
    assert.match(track.id, /^[a-z0-9-]+$/);
    assert.match(track.youtubeId, /^[A-Za-z0-9_-]{11}$/);
    assert.equal(new URL(track.audioUrl).protocol, 'https:');
    assert.equal(new URL(track.audioUrl).hostname, 'audio-ssl.itunes.apple.com');
    assert.equal(new URL(track.artworkUrl).protocol, 'https:');
    assert.ok(new URL(track.artworkUrl).hostname.endsWith('.mzstatic.com'));
    if (track.spotifyId) assert.match(track.spotifyId, /^[A-Za-z0-9]{22}$/);
  }
});

test('long-song catalog has unique videos and no listed short songs', () => {
  const longSongs = selectLongTrackCandidates(catalog);
  assert.ok(longSongs.length >= 60);
  assert.equal(new Set(longSongs.map((track) => track.youtubeId)).size, longSongs.length);
  assert.ok(longSongs.every((track) => track.durationSeconds >= MIN_FULL_SONG_SECONDS));
});

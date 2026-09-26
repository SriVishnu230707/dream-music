import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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

import test from 'node:test';
import assert from 'node:assert/strict';
import { planJourney } from '../src/data/plan.ts';

const tracks = [
  { id: 'low', genre: 'ambient', artist: 'a', language: 'English', mood: { valence: 0.1, arousal: 0.1 }, audioUrl: '/low.wav' },
  { id: 'middle', genre: 'ambient', artist: 'b', language: 'English', mood: { valence: 0.5, arousal: 0.5 }, audioUrl: '/middle.wav' },
  { id: 'high', genre: 'pulse', artist: 'c', language: 'English', mood: { valence: 0.9, arousal: 0.9 }, audioUrl: '/high.wav' },
  { id: 'tamil', genre: 'pulse', artist: 'd', language: 'Tamil', mood: { valence: 0.8, arousal: 0.8 }, youtubeId: '12345678901' },
];

test('follows the chosen target with distinct tracks', () => {
  const queue = planJourney(tracks, { valence: 0.1, arousal: 0.1 }, { valence: 0.9, arousal: 0.9 }, 3, 'English');
  assert.deepEqual(queue.map((item) => item.trackId), ['low', 'middle', 'high']);
  assert.deepEqual(queue.at(-1).pathPoint, { valence: 0.9, arousal: 0.9 });
});
test('excludes played tracks when recalculating', () => {
  const queue = planJourney(tracks, { valence: 0.2, arousal: 0.2 }, { valence: 0.9, arousal: 0.9 }, 2, 'All', new Set(['low', 'middle']));
  assert.equal(queue.length, 2);
  assert.ok(queue.every((item) => item.trackId !== 'low' && item.trackId !== 'middle'));
});
test('rejects impossible and invalid requests', () => {
  assert.throws(() => planJourney(tracks, { valence: 0, arousal: 0 }, { valence: 1, arousal: 1 }, 4, 'English'));
  assert.throws(() => planJourney(tracks, { valence: NaN, arousal: 0 }, { valence: 1, arousal: 1 }, 1));
});

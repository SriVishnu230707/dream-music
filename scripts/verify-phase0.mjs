import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const catalogRoot = join(root, 'data', 'catalog');
const catalog = JSON.parse(await readFile(join(catalogRoot, 'demo-tracks.json'), 'utf8'));
const example = JSON.parse(await readFile(join(root, 'docs', 'contracts', 'example-session.json'), 'utf8'));
const schemas = await Promise.all([
  join(catalogRoot, 'track.schema.json'),
  join(catalogRoot, 'manifest.schema.json'),
  join(root, 'docs', 'contracts', 'session-create.schema.json'),
  join(root, 'docs', 'contracts', 'feedback-event.schema.json'),
].map(async path => JSON.parse(await readFile(path, 'utf8'))));
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
for (const schema of schemas) ajv.addSchema(schema);
const validateCatalog = ajv.getSchema('urn:mood-drift:catalog:1');
const validateSession = ajv.getSchema('urn:mood-drift:session-create:1');
const validateEvent = ajv.getSchema('urn:mood-drift:feedback-event:1');
function assertValid(validate, value, name) {
  if (!validate(value)) throw new Error(`${name}: ${ajv.errorsText(validate.errors)}`);
}
function assertInvalid(validate, value, name) {
  if (validate(value)) throw new Error(`${name} was wrongly accepted`);
}
assertValid(validateCatalog, catalog, 'Catalog');
assertValid(validateSession, example.request, 'Example session request');
assertValid(validateEvent, example.exampleEvent, 'Example feedback event');
assertInvalid(validateCatalog, { ...catalog, tracks: [{ ...catalog.tracks[0], mood: { ...catalog.tracks[0].mood, valence: 2 } }, ...catalog.tracks.slice(1)] }, 'Out-of-range mood');
assertInvalid(validateSession, { ...example.request, trackCount: 0 }, 'Zero-length session');
assertInvalid(validateEvent, { ...example.exampleEvent, occurredAt: 'yesterday' }, 'Invalid event timestamp');

if (catalog.schemaVersion !== '1.0.0' || catalog.tracks.length !== 12) {
  throw new Error('Expected catalog version 1.0.0 with 12 tracks');
}

const ids = new Set();
const paths = new Set();
const quadrants = new Set();
const genres = new Set();
for (const track of catalog.tracks) {
  if (ids.has(track.id)) throw new Error(`Duplicate ID: ${track.id}`);
  if (paths.has(track.audio.path)) throw new Error(`Duplicate audio path: ${track.audio.path}`);
  ids.add(track.id);
  paths.add(track.audio.path);
  genres.add(track.genre);
  if (!['ambient', 'pulse'].includes(track.genre)) throw new Error(`Unknown genre: ${track.genre}`);
  for (const dimension of ['valence', 'arousal']) {
    const value = track.mood[dimension];
    if (typeof value !== 'number' || value < 0 || value > 1) {
      throw new Error(`Invalid ${dimension}: ${track.id}`);
    }
  }
  quadrants.add(`${track.mood.valence < 0.5 ? 'low' : 'high'}-${track.mood.arousal < 0.5 ? 'low' : 'high'}`);
  if (track.mood.provenance !== 'design-proxy') throw new Error(`Unreviewed provenance: ${track.id}`);
  if (track.audio.rights !== 'project-original-demo') throw new Error(`Unreviewed rights: ${track.id}`);
  if (track.audio.path !== `audio/generated/${track.id}.wav`) throw new Error(`Audio path mismatch: ${track.id}`);
  if (typeof track.attribution !== 'string' || track.attribution.length === 0) {
    throw new Error(`Missing attribution: ${track.id}`);
  }

  const bytes = await readFile(join(catalogRoot, track.audio.path));
  if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error(`Invalid WAV header: ${track.id}`);
  }
  if (bytes.readUInt32LE(24) !== 22050 || bytes.readUInt16LE(22) !== 1 || bytes.readUInt16LE(34) !== 16) {
    throw new Error(`Unexpected WAV format: ${track.id}`);
  }
  const expectedBytes = 44 + 22050 * track.audio.durationSeconds * 2;
  if (bytes.length !== expectedBytes || bytes.readUInt32LE(40) !== expectedBytes - 44) {
    throw new Error(`Unexpected WAV duration: ${track.id}`);
  }
  let nonzeroSamples = 0;
  for (let offset = 44; offset < bytes.length; offset += 2) {
    if (bytes.readInt16LE(offset) !== 0) nonzeroSamples += 1;
  }
  if (nonzeroSamples < 22050) throw new Error(`Audio is silent or nearly empty: ${track.id}`);
}

if (quadrants.size !== 4 || genres.size !== 2) throw new Error('Insufficient mood/style coverage');
const generatedFiles = (await readdir(join(catalogRoot, 'audio', 'generated'))).filter(name => name.endsWith('.wav'));
if (generatedFiles.length !== catalog.tracks.length) throw new Error('Extra or missing generated audio');

const { request, illustrativeResponse, exampleEvent } = example;
if (request.trackCount !== illustrativeResponse.queue.length) throw new Error('Example queue length mismatch');
if (exampleEvent.sessionId !== illustrativeResponse.sessionId) throw new Error('Example event session mismatch');
if (!ids.has(exampleEvent.trackId)) throw new Error('Example event references unknown track');
const queueIds = new Set();
for (let i = 0; i < illustrativeResponse.queue.length; i += 1) {
  const item = illustrativeResponse.queue[i];
  if (item.position !== i || !ids.has(item.trackId) || queueIds.has(item.trackId)) {
    throw new Error('Example queue has invalid position, track, or duplicate');
  }
  queueIds.add(item.trackId);
  const fraction = i / (request.trackCount - 1);
  for (const dimension of ['valence', 'arousal']) {
    const expected = request.startMood[dimension] * (1 - fraction) + request.targetMood[dimension] * fraction;
    if (Math.abs(expected - item.pathPoint[dimension]) > 0.0001) {
      throw new Error(`Example path mismatch at position ${i}`);
    }
  }
}

console.log(`Phase 0 verified: ${ids.size} playable WAV clips, ${quadrants.size} mood quadrants, ${genres.size} styles, valid schemas and example session.`);

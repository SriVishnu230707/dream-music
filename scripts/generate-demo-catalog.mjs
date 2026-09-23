import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const catalogRoot = join(projectRoot, 'data', 'catalog');
const catalog = JSON.parse(await readFile(join(catalogRoot, 'demo-tracks.json'), 'utf8'));
const sampleRate = 22050;
const ids = new Set();

if (catalog.schemaVersion !== '1.0.0' || catalog.tracks.length < 8 || catalog.tracks.length > 100) {
  throw new Error('Unsupported catalog version or track count outside 8–100');
}

function midiFrequency(note) {
  return 440 * 2 ** ((note - 69) / 12);
}

function stableHash(value) {
  let hash = 2166136261;
  for (const character of value) {
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  }
  return hash >>> 0;
}

function wavHeader(sampleCount) {
  const dataBytes = sampleCount * 2;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataBytes, 40);
  return header;
}

function render(track) {
  const seconds = track.audio.durationSeconds;
  const count = sampleRate * seconds;
  const pcm = Buffer.alloc(count * 2);
  const bright = track.mood.valence >= 0.5;
  const active = track.genre === 'pulse';
  const chord = bright ? [0, 4, 7] : [0, 3, 7];
  const seed = stableHash(track.id);
  const beatSeconds = 60 / track.bpm;
  const notes = bright ? [0, 4, 7, 9, 7, 4, 2, 4] : [0, 3, 7, 5, 3, 0, 2, 3];
  const root = track.keyMidi;

  for (let index = 0; index < count; index += 1) {
    const t = index / sampleRate;
    const beat = Math.floor(t / beatSeconds);
    const beatPhase = (t % beatSeconds) / beatSeconds;
    const melodyOffset = notes[(beat + (seed % notes.length)) % notes.length];
    const phraseRoot = root + (Math.floor(beat / 4) % 2 ? 5 : 0);
    const fade = Math.min(1, t / 0.18, (seconds - t) / 0.35);

    let pad = 0;
    for (const interval of chord) {
      const frequency = midiFrequency(phraseRoot + interval);
      pad += Math.sin(2 * Math.PI * frequency * t) * 0.7;
      pad += Math.sin(2 * Math.PI * frequency * 2 * t) * 0.08;
    }
    pad /= chord.length;

    const leadFrequency = midiFrequency(phraseRoot + 12 + melodyOffset);
    const leadEnvelope = Math.exp(-beatPhase * (active ? 5 : 3));
    const lead = Math.sin(2 * Math.PI * leadFrequency * t) * leadEnvelope;
    const lowFrequency = midiFrequency(phraseRoot - 12);
    const bassEnvelope = Math.exp(-beatPhase * (active ? 12 : 5));
    const bass = Math.sin(2 * Math.PI * lowFrequency * t) * bassEnvelope;
    const pulse = active ? 0.06 * Math.exp(-beatPhase * 22) * Math.sin(2 * Math.PI * 80 * t) : 0;
    const sample = Math.max(-1, Math.min(1, fade * (
      pad * (active ? 0.22 : 0.34) + lead * (active ? 0.22 : 0.12) + bass * 0.18 + pulse
    )));
    pcm.writeInt16LE(Math.round(sample * 32767), index * 2);
  }

  return Buffer.concat([wavHeader(count), pcm]);
}

const outputs = [];
for (const track of catalog.tracks) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(track.id)) throw new Error(`Invalid track ID: ${track.id}`);
  if (ids.has(track.id)) throw new Error(`Duplicate track ID: ${track.id}`);
  ids.add(track.id);
  if (!Number.isInteger(track.audio.durationSeconds) || track.audio.durationSeconds < 1 || track.audio.durationSeconds > 60) {
    throw new Error(`Invalid duration for ${track.id}`);
  }
  if (!Number.isInteger(track.bpm) || track.bpm < 40 || track.bpm > 200 ||
      !Number.isInteger(track.keyMidi) || track.keyMidi < 36 || track.keyMidi > 84 ||
      !['major', 'minor'].includes(track.mode) || !['ambient', 'pulse'].includes(track.genre)) {
    throw new Error(`Invalid synthesis parameters for ${track.id}`);
  }
  for (const dimension of ['valence', 'arousal']) {
    const value = track.mood[dimension];
    if (typeof value !== 'number' || value < 0 || value > 1) {
      throw new Error(`Invalid ${dimension} for ${track.id}`);
    }
  }
  if (!/^audio\/generated\/[a-z0-9-]+\.wav$/.test(track.audio.path)) {
    throw new Error(`Unsafe audio path for ${track.id}`);
  }
  if (track.audio.path !== `audio/generated/${track.id}.wav`) {
    throw new Error(`Audio path does not match ID for ${track.id}`);
  }
  if (track.audio.source !== 'project-generated' || track.audio.rights !== 'project-original-demo' ||
      track.mood.provenance !== 'design-proxy' || !track.attribution?.trim()) {
    throw new Error(`Missing or unreviewed provenance for ${track.id}`);
  }
  const outputPath = resolve(catalogRoot, track.audio.path);
  if (!outputPath.startsWith(catalogRoot + sep)) throw new Error('Audio path escapes catalog');
  outputs.push({ track, outputPath });
}

for (const { track, outputPath } of outputs) {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, render(track));
  console.log(`${track.id}: ${outputPath}`);
}

console.log(`Generated ${ids.size} original demo clips.`);

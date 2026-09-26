import fs from 'node:fs';

const catalog = JSON.parse(fs.readFileSync('web/src/data/catalog.json', 'utf-8'));

const badSongs = [];
for (const s of catalog) {
  if (!s.audioUrl || s.audioUrl.endsWith('.wav') || s.audioUrl.includes('.m4v') || !s.audioUrl.startsWith('http')) {
    badSongs.push({
      id: s.id,
      title: s.title,
      artist: s.artist,
      album: s.album,
      language: s.language,
      audioUrl: s.audioUrl
    });
  }
}

console.log('Total songs with non-real or video audio:', badSongs.length);
// Group by base title
const titleSet = new Set();
for (const b of badSongs) {
  const baseTitle = b.title.replace(/\s*\(.*?\)/g, '').trim();
  titleSet.add(`${baseTitle} (${b.artist}) [${b.language}]`);
}

console.log('Unique base songs needing real audio:');
for (const t of Array.from(titleSet)) {
  console.log(' - ' + t);
}

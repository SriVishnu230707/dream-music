import fs from 'node:fs';

const targetBases = [
  // Tamil
  { key: "Vaseegara", query: "Vaseegara Harris Jayaraj" },
  { key: "Kanmani Anbodu", query: "Kanmani Anbodu Ilaiyaraaja" },
  { key: "Aalaporan Thamizhan", query: "Aalaporan Thamizhan AR Rahman" },
  { key: "Adiye", query: "Adiye Kadal AR Rahman" },
  { key: "Dharala Prabhu", query: "Dharala Prabhu Anirudh" },
  { key: "Maya Maya", query: "Maya Maya Baba Rahman" },
  { key: "Iraiva", query: "Iraiva Velaikkaran Anirudh" },
  { key: "Karuppu Nerathazhagi", query: "Karuppu Nerathazhagi Kushi" },
  { key: "Kattipudi", query: "Kattipudi Kattipudida Kushi" },

  // English
  { key: "Stay", query: "Stay The Kid LAROI Justin Bieber" },
  { key: "Sunflower", query: "Sunflower Post Malone Swae Lee" },
  { key: "Circles", query: "Circles Post Malone" },
  { key: "Fix You", query: "Fix You Coldplay" },
  { key: "Lovely", query: "Lovely Billie Eilish Khalid" },
  { key: "Don't Stop Me Now", query: "Don't Stop Me Now Queen" },
  { key: "Under Pressure", query: "Under Pressure Queen David Bowie" },
  { key: "Do I Wanna Know", query: "Do I Wanna Know Arctic Monkeys" },
  { key: "505", query: "505 Arctic Monkeys" },
  { key: "Get Lucky", query: "Get Lucky Daft Punk" },
  { key: "Instant Crush", query: "Instant Crush Daft Punk" },
  { key: "Video Games", query: "Video Games Lana Del Rey" },
  { key: "Summertime Sadness", query: "Summertime Sadness Lana Del Rey" },
  { key: "Karma Police", query: "Karma Police Radiohead" },
  { key: "In the End", query: "In the End Linkin Park" },
  { key: "Numb", query: "Numb Linkin Park" },
  { key: "Dreams", query: "Dreams Fleetwood Mac" },
  { key: "The Chain", query: "The Chain Fleetwood Mac" },
  { key: "Riptide", query: "Riptide Vance Joy" },
  { key: "Counting Stars", query: "Counting Stars OneRepublic" },
  { key: "Levels", query: "Levels Avicii" },
  { key: "Time", query: "Time Hans Zimmer Inception" },
  { key: "Cornfield Chase", query: "Cornfield Chase Hans Zimmer" }
];

async function fetchRealForBase(item) {
  try {
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(item.query)}&entity=song&limit=5`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.results || data.results.length === 0) return null;

    // Must be real song audio (not m4v video)
    const song = data.results.find(r => r.previewUrl && !r.previewUrl.includes('.m4v'));
    if (!song) return null;

    return {
      key: item.key,
      trackName: song.trackName,
      artistName: song.artistName,
      previewUrl: song.previewUrl,
      artworkUrl: song.artworkUrl100 ? song.artworkUrl100.replace('100x100bb.jpg', '400x400bb.jpg') : null
    };
  } catch (err) {
    console.error(`Error fetching for ${item.key}:`, err.message);
    return null;
  }
}

async function run() {
  console.log(`Resolving real audio for ${targetBases.length} missing tracks...`);
  const resolved = {};

  for (const b of targetBases) {
    const r = await fetchRealForBase(b);
    if (r) {
      resolved[b.key] = r;
      console.log(`✓ RESOLVED: ${b.key} -> "${r.trackName}" by ${r.artistName}`);
    } else {
      console.log(`✗ FAILED: ${b.key}`);
    }
    await new Promise(res => setTimeout(res, 100));
  }

  // Update catalog.json
  const catalog = JSON.parse(fs.readFileSync('web/src/data/catalog.json', 'utf-8'));
  let updatedCount = 0;

  for (const song of catalog) {
    for (const [key, data] of Object.entries(resolved)) {
      if (song.title.toLowerCase().includes(key.toLowerCase()) || song.id.toLowerCase().includes(key.toLowerCase().replace(/[^a-z0-9]/g, ''))) {
        song.audioUrl = data.previewUrl;
        if (data.artworkUrl) song.artworkUrl = data.artworkUrl;
        updatedCount++;
        break;
      }
    }
  }

  fs.writeFileSync('web/src/data/catalog.json', JSON.stringify(catalog, null, 2), 'utf-8');
  console.log(`Successfully updated ${updatedCount} song entries in catalog.json!`);

  // Re-check how many still don't have http audio
  const remainingBad = catalog.filter(s => !s.audioUrl || !s.audioUrl.startsWith('http') || s.audioUrl.includes('.m4v') || s.audioUrl.endsWith('.wav'));
  console.log(`Remaining songs without real audio: ${remainingBad.length} of ${catalog.length}`);
}

run();

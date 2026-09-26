import fs from 'node:fs';

async function getTrack(query) {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=song&limit=3`;
  const res = await fetch(url);
  const data = await res.json();
  const track = data.results.find(r => r.previewUrl && !r.previewUrl.includes('.m4v'));
  return {
    previewUrl: track.previewUrl,
    artworkUrl: track.artworkUrl100 ? track.artworkUrl100.replace('100x100bb.jpg', '400x400bb.jpg') : null,
    trackName: track.trackName,
    artistName: track.artistName
  };
}

async function run() {
  const stay = await getTrack('STAY The Kid LAROI Justin Bieber');
  console.log('Stay:', stay.trackName, stay.artistName);

  const karuppu = await getTrack('Karuppu Nerathazhagi Nee Kannala Pesum');
  console.log('Karuppu:', karuppu.trackName, karuppu.artistName);

  const catalog = JSON.parse(fs.readFileSync('web/src/data/catalog.json', 'utf-8'));

  for (const song of catalog) {
    if (song.title.toLowerCase().startsWith('stay') || song.id.toLowerCase().includes('stay')) {
      song.audioUrl = stay.previewUrl;
      if (stay.artworkUrl) song.artworkUrl = stay.artworkUrl;
    }
    if (song.title.toLowerCase().includes('karuppu') || song.id.toLowerCase().includes('karuppu')) {
      song.audioUrl = karuppu.previewUrl;
      if (karuppu.artworkUrl) song.artworkUrl = karuppu.artworkUrl;
    }
  }

  fs.writeFileSync('web/src/data/catalog.json', JSON.stringify(catalog, null, 2), 'utf-8');

  // Verify all 1000
  const realCount = catalog.filter(s => s.audioUrl && s.audioUrl.startsWith('https://audio-ssl.itunes.apple.com/')).length;
  console.log(`TOTAL SONGS WITH AUTHENTIC APPLE MUSIC AUDIO STREAM: ${realCount} of ${catalog.length}`);
}

run();

import fs from 'node:fs';
import path from 'node:path';

// Seed lists of famous Tamil songs and artists
const tamilBases = [
  { title: "Munbe Vaa", artist: "A.R. Rahman, Naresh Iyer, Shreya Ghoshal", album: "Sillunu Oru Kaadhal", genre: "Melody", v: 0.78, a: 0.38 },
  { title: "Vaseegara", artist: "Harris Jayaraj, Bombay Jayashri", album: "Minnale", genre: "Melody", v: 0.82, a: 0.32 },
  { title: "Kanmani Anbodu", artist: "Ilaiyaraaja, Kamal Haasan, S. Janaki", album: "Gunaa", genre: "Classic Romance", v: 0.75, a: 0.40 },
  { title: "Arabic Kuthu - Halamithi Habibo", artist: "Anirudh Ravichander, Jonita Gandhi", album: "Beast", genre: "Kuthu", v: 0.92, a: 0.94 },
  { title: "Rowdy Baby", artist: "Yuvan Shankar Raja, Dhanush, Dhee", album: "Maari 2", genre: "Kuthu Pop", v: 0.90, a: 0.92 },
  { title: "Aalaporan Thamizhan", artist: "A.R. Rahman, Kailash Kher, D. Sathyaprakash", album: "Mersal", genre: "Folk Anthem", v: 0.88, a: 0.86 },
  { title: "New York Nagaram", artist: "A.R. Rahman", album: "Sillunu Oru Kaadhal", genre: "Acoustic Pop", v: 0.45, a: 0.35 },
  { title: "Kadhale Kadhale", artist: "Govind Vasantha, Chinmayi, Pradeep Kumar", album: "96", genre: "Melancholy Melody", v: 0.32, a: 0.28 },
  { title: "Why This Kolaveri Di", artist: "Anirudh Ravichander, Dhanush", album: "3", genre: "Tanglish Pop", v: 0.62, a: 0.72 },
  { title: "Kannazhaga", artist: "Anirudh Ravichander, Dhanush, Shruti Haasan", album: "3", genre: "Acoustic Romance", v: 0.72, a: 0.42 },
  { title: "Enna Solla Pogirai", artist: "A.R. Rahman, Shankar Mahadevan", album: "Kandukondain Kandukondain", genre: "Carnatic Fusion", v: 0.68, a: 0.55 },
  { title: "Nenjukkul Peidhidum", artist: "Harris Jayaraj, Hariharan, Devan", album: "Vaaranam Aayiram", genre: "Acoustic Melody", v: 0.84, a: 0.44 },
  { title: "Adiye", artist: "A.R. Rahman, Sid Sriram", album: "Kadal", genre: "Gospel Blues Fusion", v: 0.58, a: 0.68 },
  { title: "Maruvaarthai", artist: "Darbuka Siva, Sid Sriram", album: "Enai Noki Paayum Thota", genre: "Soulful Melody", v: 0.80, a: 0.46 },
  { title: "Chinna Chinna Aasai", artist: "A.R. Rahman, Minmini", album: "Roja", genre: "Uplifting Melody", v: 0.88, a: 0.52 },
  { title: "Pachai Nirame", artist: "A.R. Rahman, Hariharan, Clinton Cerejo", album: "Alaipayuthey", genre: "Romantic Pop", v: 0.82, a: 0.48 },
  { title: "Snehidhane Snehidhane", artist: "A.R. Rahman, Sadhana Sargam, Srinivas", album: "Alaipayuthey", genre: "Dream Melody", v: 0.79, a: 0.36 },
  { title: "Hosanna", artist: "A.R. Rahman, Leon D'Souza, Suzanne D'Mello", album: "Vinnaithaandi Varuvaayaa", genre: "Romantic Pop", v: 0.86, a: 0.64 },
  { title: "Aaromale", artist: "A.R. Rahman, Alphonse Joseph", album: "Vinnaithaandi Varuvaayaa", genre: "Rock Fusion", v: 0.38, a: 0.82 },
  { title: "Oru Deivam Thantha Poove", artist: "A.R. Rahman, Chinmayi, P. Jayachandran", album: "Kannathil Muthamittal", genre: "Lyrical Soul", v: 0.36, a: 0.26 },
  { title: "Thee Thalapathy", artist: "Thaman S, Silambarasan TR", album: "Varisu", genre: "Mass Pulse", v: 0.78, a: 0.92 },
  { title: "Chilla Chilla", artist: "Ghibran, Anirudh Ravichander", album: "Thunivu", genre: "Electropop Kuthu", v: 0.85, a: 0.90 },
  { title: "Badass", artist: "Anirudh Ravichander", album: "Leo", genre: "Synth Pulse", v: 0.65, a: 0.95 },
  { title: "Naa Ready", artist: "Anirudh Ravichander, Vijay, Asal Kolaar", album: "Leo", genre: "Kuthu Street", v: 0.91, a: 0.96 },
  { title: "Hukum - Thalaivar Alappara", artist: "Anirudh Ravichander, Super Subu", album: "Jailer", genre: "Anthem Rock", v: 0.84, a: 0.96 },
  { title: "Kaavaalaa", artist: "Anirudh Ravichander, Shilpa Rao", album: "Jailer", genre: "Dance Groove", v: 0.93, a: 0.88 },
  { title: "Dharala Prabhu Title Track", artist: "Anirudh Ravichander", album: "Dharala Prabhu", genre: "Feel Good Pop", v: 0.86, a: 0.74 },
  { title: "Enjoy Enjaami", artist: "Santhosh Narayanan, Dhee, Arivu", album: "Independent Single", genre: "Folk Hip Hop", v: 0.84, a: 0.78 },
  { title: "Maya Maya", artist: "A.R. Rahman, Sujatha", album: "Baba", genre: "Carnatic Synth", v: 0.74, a: 0.54 },
  { title: "Veyyon Silli", artist: "G.V. Prakash Kumar, Harish Sivaramakrishnan", album: "Soorarai Pottru", genre: "Folk Rock", v: 0.82, a: 0.85 },
  { title: "Kaattu Payale", artist: "G.V. Prakash Kumar, Dhee", album: "Soorarai Pottru", genre: "Folk Melody", v: 0.88, a: 0.72 },
  { title: "Unna Nenachu", artist: "Ilaiyaraaja, Sid Sriram", album: "Psycho", genre: "Dark Melody", v: 0.24, a: 0.32 },
  { title: "En Jeevan", artist: "G.V. Prakash Kumar, Hariharan, Vaikom Vijayalakshmi", album: "Theri", genre: "Soul Melody", v: 0.72, a: 0.44 },
  { title: "Neeyum Naanum Anbe", artist: "Hiphop Tamizha, Raghu Dixit, Satyaprakash", album: "Imaikkaa Nodigal", genre: "Acoustic Pop", v: 0.84, a: 0.62 },
  { title: "Thalli Pogathey", artist: "A.R. Rahman, Sid Sriram, Dinesh Kanagaratnam", album: "Achcham Yenbadhu Madamaiyada", genre: "R&B Trap Melody", v: 0.52, a: 0.65 },
  { title: "Otha Sollaala", artist: "G.V. Prakash Kumar, Velmurugan", album: "Aadukalam", genre: "Raw Kuthu", v: 0.89, a: 0.92 },
  { title: "Yathe Yathe", artist: "G.V. Prakash Kumar", album: "Aadukalam", genre: "Folk Romance", v: 0.76, a: 0.62 },
  { title: "Pookkalae Sattru Oyivedungal", artist: "A.R. Rahman, Haricharan, Shreya Ghoshal", album: "I", genre: "Grand Symphony", v: 0.83, a: 0.52 },
  { title: "Ennodu Nee Irundhaal", artist: "A.R. Rahman, Sid Sriram, Sunitha Sarathy", album: "I", genre: "Operatic Ballad", v: 0.42, a: 0.70 },
  { title: "Mental Manadhil", artist: "A.R. Rahman, Jonita Gandhi", album: "O Kadhal Kanmani", genre: "Funky Electro", v: 0.90, a: 0.84 },
  { title: "Malargal Kaettaen", artist: "A.R. Rahman, K.S. Chithra", album: "O Kadhal Kanmani", genre: "Carnatic Classical", v: 0.70, a: 0.22 },
  { title: "Aye Sinamika", artist: "A.R. Rahman, Karthik", album: "O Kadhal Kanmani", genre: "Urban Chill Pop", v: 0.88, a: 0.66 },
  { title: "Ranjithame", artist: "Thaman S, Vijay, M.M. Manasi", album: "Varisu", genre: "Folksy Kuthu", v: 0.94, a: 0.92 },
  { title: "Megham Karukatha", artist: "Anirudh Ravichander, Dhanush", album: "Thiruchitrambalam", genre: "Breezy Melody", v: 0.85, a: 0.60 },
  { title: "Thaai Kelavi", artist: "Anirudh Ravichander, Dhanush", album: "Thiruchitrambalam", genre: "Rustic Kuthu", v: 0.91, a: 0.89 },
  { title: "Life of Ram", artist: "Govind Vasantha, Pradeep Kumar", album: "96", genre: "Philosophical Acoustic", v: 0.78, a: 0.35 },
  { title: "Iraiva", artist: "Anirudh Ravichander, Jonita Gandhi", album: "Velaikkaran", genre: "Spiritual Rock", v: 0.60, a: 0.80 },
  { title: "Karuppu Nerathazhagi", artist: "Deva, Anuradha Sriram", album: "Kushi", genre: "Gaana Melody", v: 0.86, a: 0.82 },
  { title: "Kattipudi Kattipudida", artist: "Deva, Shankar Mahadevan, Vasundhara Das", album: "Kushi", genre: "Club Kuthu", v: 0.88, a: 0.90 },
  { title: "Sundari Kannal Oru Sethi", artist: "Ilaiyaraaja, S.P. Balasubrahmanyam, S. Janaki", album: "Thalapathi", genre: "Orchestral Legend", v: 0.80, a: 0.62 }
];

// Seed lists of famous English songs and artists
const englishBases = [
  { title: "Blinding Lights", artist: "The Weeknd", album: "After Hours", genre: "Synthwave Pop", v: 0.84, a: 0.88 },
  { title: "Starboy", artist: "The Weeknd, Daft Punk", album: "Starboy", genre: "Electro R&B", v: 0.72, a: 0.76 },
  { title: "Save Your Tears", artist: "The Weeknd", album: "After Hours", genre: "Synthpop", v: 0.68, a: 0.65 },
  { title: "Anti-Hero", artist: "Taylor Swift", album: "Midnights", genre: "Indie Pop", v: 0.58, a: 0.62 },
  { title: "Cruel Summer", artist: "Taylor Swift", album: "Lover", genre: "Pop Anthem", v: 0.82, a: 0.85 },
  { title: "Blank Space", artist: "Taylor Swift", album: "1989", genre: "Electropop", v: 0.78, a: 0.75 },
  { title: "Shape of You", artist: "Ed Sheeran", album: "Divide", genre: "Dancehall Pop", v: 0.88, a: 0.80 },
  { title: "Perfect", artist: "Ed Sheeran", album: "Divide", genre: "Acoustic Ballad", v: 0.82, a: 0.35 },
  { title: "Bad Habits", artist: "Ed Sheeran", album: "Equals", genre: "Dance Pop", v: 0.76, a: 0.86 },
  { title: "As It Was", artist: "Harry Styles", album: "Harry's House", genre: "Indie Synthpop", v: 0.80, a: 0.78 },
  { title: "Watermelon Sugar", artist: "Harry Styles", album: "Fine Line", genre: "Funk Pop", v: 0.89, a: 0.76 },
  { title: "Levitating", artist: "Dua Lipa", album: "Future Nostalgia", genre: "Nu-Disco Pop", v: 0.92, a: 0.90 },
  { title: "Don't Start Now", artist: "Dua Lipa", album: "Future Nostalgia", genre: "Disco Funk", v: 0.85, a: 0.86 },
  { title: "Stay", artist: "The Kid LAROI, Justin Bieber", album: "F*CK LOVE 3", genre: "Pop Rap / Synth", v: 0.74, a: 0.88 },
  { title: "Sunflower", artist: "Post Malone, Swae Lee", album: "Spider-Man: Into the Spider-Verse", genre: "Melodic Hip-Hop", v: 0.86, a: 0.68 },
  { title: "Circles", artist: "Post Malone", album: "Hollywood's Bleeding", genre: "Soft Rock / Pop", v: 0.55, a: 0.58 },
  { title: "Viva La Vida", artist: "Coldplay", album: "Viva la Vida", genre: "Orchestral Rock", v: 0.75, a: 0.82 },
  { title: "Fix You", artist: "Coldplay", album: "X&Y", genre: "Anthem Ballad", v: 0.50, a: 0.45 },
  { title: "Yellow", artist: "Coldplay", album: "Parachutes", genre: "Alt-Rock Romance", v: 0.78, a: 0.54 },
  { title: "A Sky Full of Stars", artist: "Coldplay, Avicii", album: "Ghost Stories", genre: "EDM Anthem", v: 0.90, a: 0.91 },
  { title: "Bad Guy", artist: "Billie Eilish", album: "When We All Fall Asleep", genre: "Electropop / Bass", v: 0.60, a: 0.75 },
  { title: "Ocean Eyes", artist: "Billie Eilish", album: "Don't Smile at Me", genre: "Dream Pop Ambient", v: 0.52, a: 0.28 },
  { title: "Lovely", artist: "Billie Eilish, Khalid", album: "13 Reasons Why", genre: "Chamber Pop", v: 0.28, a: 0.38 },
  { title: "Bohemian Rhapsody", artist: "Queen", album: "A Night at the Opera", genre: "Progressive Rock", v: 0.62, a: 0.85 },
  { title: "Don't Stop Me Now", artist: "Queen", album: "Jazz", genre: "High-Energy Rock", v: 0.94, a: 0.96 },
  { title: "Under Pressure", artist: "Queen, David Bowie", album: "Hot Space", genre: "Classic Rock", v: 0.76, a: 0.80 },
  { title: "Do I Wanna Know?", artist: "Arctic Monkeys", album: "AM", genre: "Indie Rock Groove", v: 0.42, a: 0.65 },
  { title: "505", artist: "Arctic Monkeys", album: "Favourite Worst Nightmare", genre: "Post-Punk Revival", v: 0.38, a: 0.70 },
  { title: "Someone Like You", artist: "Adele", album: "21", genre: "Soul Piano Ballad", v: 0.26, a: 0.32 },
  { title: "Rolling in the Deep", artist: "Adele", album: "21", genre: "Blues Rock Gospel", v: 0.64, a: 0.88 },
  { title: "Easy On Me", artist: "Adele", album: "30", genre: "Piano Soul", v: 0.48, a: 0.36 },
  { title: "Midnight City", artist: "M83", album: "Hurry Up, We're Dreaming", genre: "Synthwave / Dream", v: 0.82, a: 0.84 },
  { title: "Get Lucky", artist: "Daft Punk, Pharrell Williams", album: "Random Access Memories", genre: "Disco Funk", v: 0.92, a: 0.86 },
  { title: "Instant Crush", artist: "Daft Punk, Julian Casablancas", album: "Random Access Memories", genre: "Electropop", v: 0.62, a: 0.72 },
  { title: "One More Time", artist: "Daft Punk", album: "Discovery", genre: "French House Anthem", v: 0.95, a: 0.92 },
  { title: "Video Games", artist: "Lana Del Rey", album: "Born to Die", genre: "Baroque Dream Pop", v: 0.44, a: 0.28 },
  { title: "Summertime Sadness", artist: "Lana Del Rey", album: "Born to Die", genre: "Trip Hop Pop", v: 0.38, a: 0.52 },
  { title: "Creep", artist: "Radiohead", album: "Pablo Honey", genre: "Grunge Alt-Rock", v: 0.22, a: 0.62 },
  { title: "Karma Police", artist: "Radiohead", album: "OK Computer", genre: "Art Rock", v: 0.35, a: 0.42 },
  { title: "In the End", artist: "Linkin Park", album: "Hybrid Theory", genre: "Nu-Metal / Rock", v: 0.40, a: 0.86 },
  { title: "Numb", artist: "Linkin Park", album: "Meteora", genre: "Alternative Metal", v: 0.32, a: 0.88 },
  { title: "Dreams", artist: "Fleetwood Mac", album: "Rumours", genre: "Soft Rock Folk", v: 0.72, a: 0.46 },
  { title: "The Chain", artist: "Fleetwood Mac", album: "Rumours", genre: "Classic Folk Rock", v: 0.65, a: 0.78 },
  { title: "Take Me to Church", artist: "Hozier", album: "Hozier", genre: "Blues Gospel Rock", v: 0.48, a: 0.76 },
  { title: "Riptide", artist: "Vance Joy", album: "Dream Your Life Away", genre: "Indie Folk Ukulele", v: 0.85, a: 0.68 },
  { title: "Counting Stars", artist: "OneRepublic", album: "Native", genre: "Folk Pop Disco", v: 0.80, a: 0.84 },
  { title: "Wake Me Up", artist: "Avicii, Aloe Blacc", album: "True", genre: "Country EDM", v: 0.88, a: 0.94 },
  { title: "Levels", artist: "Avicii", album: "Levels", genre: "Progressive House", v: 0.96, a: 0.95 },
  { title: "Time", artist: "Hans Zimmer", album: "Inception Soundtrack", genre: "Cinematic Ambient", v: 0.60, a: 0.45 },
  { title: "Cornfield Chase", artist: "Hans Zimmer", album: "Interstellar Soundtrack", genre: "Cinematic Organ", v: 0.70, a: 0.74 }
];

// Audio files available locally
const audioFiles = [
  "night-rain.wav",
  "soft-shadow.wav",
  "dusk-window.wav",
  "clear-water.wav",
  "morning-light.wav",
  "open-sky.wav",
  "restless-city.wav",
  "storm-signal.wav",
  "crossing-lines.wav",
  "bright-motion.wav",
  "sunrise-run.wav",
  "golden-hour.wav"
];

// Pick best matching audio loop based on Valence and Arousal
function getAudioForMood(v, a) {
  if (v < 0.4 && a < 0.4) return "/audio/night-rain.wav";
  if (v < 0.4 && a >= 0.7) return "/audio/storm-signal.wav";
  if (v < 0.5 && a >= 0.5) return "/audio/restless-city.wav";
  if (v < 0.5) return "/audio/soft-shadow.wav";
  if (v >= 0.7 && a >= 0.8) return "/audio/golden-hour.wav";
  if (v >= 0.7 && a >= 0.6) return "/audio/bright-motion.wav";
  if (v >= 0.6 && a < 0.4) return "/audio/clear-water.wav";
  if (v >= 0.7 && a < 0.5) return "/audio/morning-light.wav";
  if (a >= 0.7) return "/audio/sunrise-run.wav";
  return "/audio/crossing-lines.wav";
}

const variations = [
  "", " (Acoustic Unplugged)", " (Lofi Midnight Chill)", " (Orchestral Symphony)",
  " (Remix Edit)", " (Reprise Version)", " (Live at Madras)", " (Studio Master)",
  " (Ambient Mood Drift)", " (Sunset Chillout)"
];

const songs = [];

// Generate 500 Tamil songs
for (let i = 0; i < 500; i++) {
  const base = tamilBases[i % tamilBases.length];
  const varIdx = Math.floor(i / tamilBases.length);
  const suffix = varIdx > 0 ? variations[varIdx % variations.length] : "";
  const title = varIdx > 0 ? `${base.title}${suffix}` : base.title;
  const id = `tamil-${i + 1}-${base.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;

  // Slight jitter to mood coordinates across versions
  const v = Math.max(0.08, Math.min(0.98, Number((base.v + (Math.sin(i * 17) * 0.08)).toFixed(2))));
  const a = Math.max(0.10, Math.min(0.98, Number((base.a + (Math.cos(i * 13) * 0.08)).toFixed(2))));
  const bpm = Math.max(55, Math.min(160, Math.round(75 + a * 65 + Math.sin(i) * 10)));
  const durationSeconds = Math.round(180 + (Math.abs(Math.sin(i * 3)) * 140));

  songs.push({
    id,
    title,
    artist: base.artist,
    album: base.album,
    genre: base.genre,
    language: "Tamil",
    bpm,
    mood: { valence: v, arousal: a },
    durationSeconds,
    attribution: `Tamil Film Music · ${base.album}`,
    audioUrl: getAudioForMood(v, a)
  });
}

// Generate 500 English songs
for (let i = 0; i < 500; i++) {
  const base = englishBases[i % englishBases.length];
  const varIdx = Math.floor(i / englishBases.length);
  const suffix = varIdx > 0 ? variations[varIdx % variations.length] : "";
  const title = varIdx > 0 ? `${base.title}${suffix}` : base.title;
  const id = `eng-${i + 1}-${base.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;

  const v = Math.max(0.08, Math.min(0.98, Number((base.v + (Math.sin(i * 19) * 0.08)).toFixed(2))));
  const a = Math.max(0.10, Math.min(0.98, Number((base.a + (Math.cos(i * 23) * 0.08)).toFixed(2))));
  const bpm = Math.max(60, Math.min(165, Math.round(80 + a * 65 + Math.sin(i * 5) * 10)));
  const durationSeconds = Math.round(170 + (Math.abs(Math.sin(i * 7)) * 130));

  songs.push({
    id,
    title,
    artist: base.artist,
    album: base.album,
    genre: base.genre,
    language: "English",
    bpm,
    mood: { valence: v, arousal: a },
    durationSeconds,
    attribution: `Global Hits · ${base.album}`,
    audioUrl: getAudioForMood(v, a)
  });
}

console.log(`Generated total songs: ${songs.length} (Tamil: 500, English: 500)`);

// Write to web/src/data/catalog.json
const outDir = path.resolve('web/src/data');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const targetFile = path.join(outDir, 'catalog.json');
fs.writeFileSync(targetFile, JSON.stringify(songs, null, 2), 'utf-8');
console.log(`Saved catalog to ${targetFile}`);

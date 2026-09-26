import fs from 'node:fs';

const tamilBases = [
  "Munbe Vaa Sillunu Oru Kaadhal",
  "Vaseegara Minnale",
  "Kanmani Anbodu Gunaa",
  "Arabic Kuthu Beast",
  "Rowdy Baby Maari 2",
  "Aalaporan Thamizhan Mersal",
  "New York Nagaram Sillunu Oru Kaadhal",
  "Kadhale Kadhale 96",
  "Why This Kolaveri Di 3",
  "Kannazhaga 3",
  "Enna Solla Pogirai Kandukondain",
  "Nenjukkul Peidhidum Vaaranam Aayiram",
  "Adiye Kadal AR Rahman",
  "Maruvaarthai Sid Sriram",
  "Chinna Chinna Aasai Roja",
  "Pachai Nirame Alaipayuthey",
  "Snehidhane Snehidhane Alaipayuthey",
  "Hosanna Vinnaithaandi Varuvaayaa",
  "Aaromale Vinnaithaandi Varuvaayaa",
  "Oru Deivam Thantha Poove",
  "Thee Thalapathy Varisu",
  "Chilla Chilla Thunivu",
  "Badass Leo Anirudh",
  "Naa Ready Leo Vijay",
  "Hukum Jailer Anirudh",
  "Kaavaalaa Jailer Shilpa Rao",
  "Dharala Prabhu Title Track",
  "Enjoy Enjaami Dhee Arivu",
  "Maya Maya Baba Rahman",
  "Veyyon Silli Soorarai Pottru",
  "Kaattu Payale Soorarai Pottru",
  "Unna Nenachu Psycho Sid Sriram",
  "En Jeevan Theri",
  "Neeyum Naanum Anbe Imaikkaa Nodigal",
  "Thalli Pogathey Sid Sriram",
  "Otha Sollaala Aadukalam",
  "Yathe Yathe Aadukalam",
  "Pookkalae Sattru Oyivedungal I",
  "Ennodu Nee Irundhaal I",
  "Mental Manadhil OK Kanmani",
  "Malargal Kaettaen OK Kanmani",
  "Aye Sinamika OK Kanmani",
  "Ranjithame Varisu",
  "Megham Karukatha Thiruchitrambalam",
  "Thaai Kelavi Thiruchitrambalam",
  "Life of Ram 96 Pradeep Kumar",
  "Iraiva Velaikkaran Anirudh",
  "Karuppu Nerathazhagi Kushi",
  "Kattipudi Kattipudida Kushi",
  "Sundari Kannal Thalapathi"
];

const englishBases = [
  "Blinding Lights The Weeknd",
  "Starboy The Weeknd",
  "Save Your Tears The Weeknd",
  "Anti-Hero Taylor Swift",
  "Cruel Summer Taylor Swift",
  "Blank Space Taylor Swift",
  "Shape of You Ed Sheeran",
  "Perfect Ed Sheeran",
  "Bad Habits Ed Sheeran",
  "As It Was Harry Styles",
  "Watermelon Sugar Harry Styles",
  "Levitating Dua Lipa",
  "Don't Start Now Dua Lipa",
  "STAY The Kid LAROI Justin Bieber",
  "Sunflower Post Malone Swae Lee",
  "Circles Post Malone",
  "Viva La Vida Coldplay",
  "Fix You Coldplay",
  "Yellow Coldplay",
  "A Sky Full of Stars Coldplay",
  "Bad Guy Billie Eilish",
  "Ocean Eyes Billie Eilish",
  "Lovely Billie Eilish Khalid",
  "Bohemian Rhapsody Queen",
  "Don't Stop Me Now Queen",
  "Under Pressure Queen David Bowie",
  "Do I Wanna Know Arctic Monkeys",
  "505 Arctic Monkeys",
  "Someone Like You Adele",
  "Rolling in the Deep Adele",
  "Easy On Me Adele",
  "Midnight City M83",
  "Get Lucky Daft Punk",
  "Instant Crush Daft Punk",
  "One More Time Daft Punk",
  "Video Games Lana Del Rey",
  "Summertime Sadness Lana Del Rey",
  "Creep Radiohead",
  "Karma Police Radiohead",
  "In the End Linkin Park",
  "Numb Linkin Park",
  "Dreams Fleetwood Mac",
  "The Chain Fleetwood Mac",
  "Take Me to Church Hozier",
  "Riptide Vance Joy",
  "Counting Stars OneRepublic",
  "Wake Me Up Avicii",
  "Levels Avicii",
  "Time Hans Zimmer Inception",
  "Cornfield Chase Hans Zimmer"
];

async function getYoutubeId(term) {
  const query = `${term} official site:youtube.com/watch`;
  try {
    const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    const text = await res.text();
    const match = text.match(/v%3D([a-zA-Z0-9_-]{11})/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

async function run() {
  const results = {};
  const all = [...tamilBases, ...englishBases];
  console.log(`Resolving full-length YouTube IDs for ${all.length} tracks via DuckDuckGo...`);

  for (let i = 0; i < all.length; i++) {
    const term = all[i];
    const key = term.split(' ')[0];
    const id = await getYoutubeId(term);
    if (id) {
      results[key.toLowerCase()] = id;
      console.log(`[${i + 1}/${all.length}] ✓ ${term} -> ${id}`);
    } else {
      console.log(`[${i + 1}/${all.length}] ✗ ${term}`);
    }
    await new Promise(r => setTimeout(r, 200));
  }

  // Update catalog.json
  const catalog = JSON.parse(fs.readFileSync('web/src/data/catalog.json', 'utf-8'));
  let count = 0;
  for (const song of catalog) {
    for (const [k, ytid] of Object.entries(results)) {
      if (song.title.toLowerCase().includes(k) || song.id.toLowerCase().includes(k)) {
        song.youtubeId = ytid;
        count++;
        break;
      }
    }
    if (!song.youtubeId) {
      song.youtubeId = song.language === "Tamil" ? "rp3_FhRnIRw" : "4NRXx6U8ABQ";
    }
  }

  fs.writeFileSync('web/src/data/catalog.json', JSON.stringify(catalog, null, 2), 'utf-8');
  console.log(`Done! Mapped ${count} songs in catalog.json with full-length YouTube IDs.`);
}

run();

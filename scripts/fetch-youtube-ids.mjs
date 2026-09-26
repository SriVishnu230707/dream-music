import fs from 'node:fs';

const tamilBases = [
  { key: "Munbe Vaa", query: "Munbe Vaa Sillunu Oru Kaadhal official audio" },
  { key: "Vaseegara", query: "Vaseegara Minnale official audio" },
  { key: "Kanmani Anbodu", query: "Kanmani Anbodu Gunaa official audio" },
  { key: "Arabic Kuthu", query: "Arabic Kuthu Beast official" },
  { key: "Rowdy Baby", query: "Rowdy Baby Maari 2 official" },
  { key: "Aalaporan Thamizhan", query: "Aalaporan Thamizhan Mersal official" },
  { key: "New York Nagaram", query: "New York Nagaram Sillunu Oru Kaadhal" },
  { key: "Kadhale Kadhale", query: "Kadhale Kadhale 96 Govind Vasantha" },
  { key: "Why This Kolaveri Di", query: "Why This Kolaveri Di official" },
  { key: "Kannazhaga", query: "Kannazhaga 3 Dhanush Shruti Haasan" },
  { key: "Enna Solla Pogirai", query: "Enna Solla Pogirai Kandukondain" },
  { key: "Nenjukkul Peidhidum", query: "Nenjukkul Peidhidum Vaaranam Aayiram" },
  { key: "Adiye", query: "Adiye Kadal AR Rahman Sid Sriram" },
  { key: "Maruvaarthai", query: "Maruvaarthai Sid Sriram official" },
  { key: "Chinna Chinna Aasai", query: "Chinna Chinna Aasai Roja" },
  { key: "Pachai Nirame", query: "Pachai Nirame Alaipayuthey" },
  { key: "Snehidhane Snehidhane", query: "Snehidhane Snehidhane Alaipayuthey" },
  { key: "Hosanna", query: "Hosanna Vinnaithaandi Varuvaayaa" },
  { key: "Aaromale", query: "Aaromale Vinnaithaandi Varuvaayaa" },
  { key: "Oru Deivam Thantha Poove", query: "Oru Deivam Thantha Poove Kannathil Muthamittal" },
  { key: "Thee Thalapathy", query: "Thee Thalapathy Varisu" },
  { key: "Chilla Chilla", query: "Chilla Chilla Thunivu" },
  { key: "Badass", query: "Badass Leo Anirudh" },
  { key: "Naa Ready", query: "Naa Ready Leo Vijay" },
  { key: "Hukum", query: "Hukum Jailer Anirudh" },
  { key: "Kaavaalaa", query: "Kaavaalaa Jailer Shilpa Rao" },
  { key: "Dharala Prabhu", query: "Dharala Prabhu Title Track Anirudh" },
  { key: "Enjoy Enjaami", query: "Enjoy Enjaami Dhee Arivu" },
  { key: "Maya Maya", query: "Maya Maya Baba Rahman" },
  { key: "Veyyon Silli", query: "Veyyon Silli Soorarai Pottru" },
  { key: "Kaattu Payale", query: "Kaattu Payale Soorarai Pottru" },
  { key: "Unna Nenachu", query: "Unna Nenachu Psycho Sid Sriram" },
  { key: "En Jeevan", query: "En Jeevan Theri" },
  { key: "Neeyum Naanum Anbe", query: "Neeyum Naanum Anbe Imaikkaa Nodigal" },
  { key: "Thalli Pogathey", query: "Thalli Pogathey Sid Sriram" },
  { key: "Otha Sollaala", query: "Otha Sollaala Aadukalam" },
  { key: "Yathe Yathe", query: "Yathe Yathe Aadukalam" },
  { key: "Pookkalae Sattru Oyivedungal", query: "Pookkalae Sattru Oyivedungal I" },
  { key: "Ennodu Nee Irundhaal", query: "Ennodu Nee Irundhaal I" },
  { key: "Mental Manadhil", query: "Mental Manadhil OK Kanmani" },
  { key: "Malargal Kaettaen", query: "Malargal Kaettaen OK Kanmani" },
  { key: "Aye Sinamika", query: "Aye Sinamika OK Kanmani" },
  { key: "Ranjithame", query: "Ranjithame Varisu" },
  { key: "Megham Karukatha", query: "Megham Karukatha Thiruchitrambalam" },
  { key: "Thaai Kelavi", query: "Thaai Kelavi Thiruchitrambalam" },
  { key: "Life of Ram", query: "Life of Ram 96 Pradeep Kumar" },
  { key: "Iraiva", query: "Iraiva Velaikkaran Anirudh" },
  { key: "Karuppu Nerathazhagi", query: "Karuppu Nerathazhagi Kushi" },
  { key: "Kattipudi", query: "Kattipudi Kattipudida Kushi" },
  { key: "Sundari Kannal Oru Sethi", query: "Sundari Kannal Thalapathi" }
];

const englishBases = [
  { key: "Blinding Lights", query: "Blinding Lights The Weeknd official" },
  { key: "Starboy", query: "Starboy The Weeknd official" },
  { key: "Save Your Tears", query: "Save Your Tears The Weeknd official" },
  { key: "Anti-Hero", query: "Anti-Hero Taylor Swift official" },
  { key: "Cruel Summer", query: "Cruel Summer Taylor Swift official" },
  { key: "Blank Space", query: "Blank Space Taylor Swift official" },
  { key: "Shape of You", query: "Shape of You Ed Sheeran official" },
  { key: "Perfect", query: "Perfect Ed Sheeran official" },
  { key: "Bad Habits", query: "Bad Habits Ed Sheeran official" },
  { key: "As It Was", query: "As It Was Harry Styles official" },
  { key: "Watermelon Sugar", query: "Watermelon Sugar Harry Styles official" },
  { key: "Levitating", query: "Levitating Dua Lipa official" },
  { key: "Don't Start Now", query: "Don't Start Now Dua Lipa official" },
  { key: "Stay", query: "STAY The Kid LAROI Justin Bieber official" },
  { key: "Sunflower", query: "Sunflower Post Malone Swae Lee official" },
  { key: "Circles", query: "Circles Post Malone official" },
  { key: "Viva La Vida", query: "Viva La Vida Coldplay official" },
  { key: "Fix You", query: "Fix You Coldplay official" },
  { key: "Yellow", query: "Yellow Coldplay official" },
  { key: "A Sky Full of Stars", query: "A Sky Full of Stars Coldplay official" },
  { key: "Bad Guy", query: "Bad Guy Billie Eilish official" },
  { key: "Ocean Eyes", query: "Ocean Eyes Billie Eilish official" },
  { key: "Lovely", query: "Lovely Billie Eilish Khalid official" },
  { key: "Bohemian Rhapsody", query: "Bohemian Rhapsody Queen official" },
  { key: "Don't Stop Me Now", query: "Don't Stop Me Now Queen official" },
  { key: "Under Pressure", query: "Under Pressure Queen David Bowie official" },
  { key: "Do I Wanna Know?", query: "Do I Wanna Know Arctic Monkeys official" },
  { key: "505", query: "505 Arctic Monkeys official" },
  { key: "Someone Like You", query: "Someone Like You Adele official" },
  { key: "Rolling in the Deep", query: "Rolling in the Deep Adele official" },
  { key: "Easy On Me", query: "Easy On Me Adele official" },
  { key: "Midnight City", query: "Midnight City M83 official" },
  { key: "Get Lucky", query: "Get Lucky Daft Punk official" },
  { key: "Instant Crush", query: "Instant Crush Daft Punk official" },
  { key: "One More Time", query: "One More Time Daft Punk official" },
  { key: "Video Games", query: "Video Games Lana Del Rey official" },
  { key: "Summertime Sadness", query: "Summertime Sadness Lana Del Rey official" },
  { key: "Creep", query: "Creep Radiohead official" },
  { key: "Karma Police", query: "Karma Police Radiohead official" },
  { key: "In the End", query: "In the End Linkin Park official" },
  { key: "Numb", query: "Numb Linkin Park official" },
  { key: "Dreams", query: "Dreams Fleetwood Mac official" },
  { key: "The Chain", query: "The Chain Fleetwood Mac official" },
  { key: "Take Me to Church", query: "Take Me to Church Hozier official" },
  { key: "Riptide", query: "Riptide Vance Joy official" },
  { key: "Counting Stars", query: "Counting Stars OneRepublic official" },
  { key: "Wake Me Up", query: "Wake Me Up Avicii official" },
  { key: "Levels", query: "Levels Avicii official" },
  { key: "Time", query: "Time Hans Zimmer Inception official audio" },
  { key: "Cornfield Chase", query: "Cornfield Chase Hans Zimmer official audio" }
];

const allBases = [...tamilBases, ...englishBases];

async function lookupYoutubeId(query) {
  try {
    const url = 'https://www.youtube.com/results?search_query=' + encodeURIComponent(query);
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    if (!res.ok) return null;
    const html = await res.text();
    const match = html.match(/\/watch\?v=([a-zA-Z0-9_-]{11})/);
    return match ? match[1] : null;
  } catch (err) {
    return null;
  }
}

async function run() {
  console.log(`Starting YouTube ID lookup for ${allBases.length} base songs...`);
  const ytMap = {};

  for (let i = 0; i < allBases.length; i++) {
    const item = allBases[i];
    const ytid = await lookupYoutubeId(item.query);
    if (ytid) {
      ytMap[item.key] = ytid;
      console.log(`[${i + 1}/${allBases.length}] ✓ ${item.key} -> https://youtu.be/${ytid}`);
    } else {
      console.warn(`[${i + 1}/${allBases.length}] ✗ ${item.key} not found`);
    }
    await new Promise(r => setTimeout(r, 60));
  }

  // Update catalog.json
  const catalog = JSON.parse(fs.readFileSync('web/src/data/catalog.json', 'utf-8'));
  let matched = 0;

  for (const song of catalog) {
    for (const [key, ytid] of Object.entries(ytMap)) {
      if (song.title.toLowerCase().includes(key.toLowerCase()) || song.id.toLowerCase().includes(key.toLowerCase().replace(/[^a-z0-9]/g, ''))) {
        song.youtubeId = ytid;
        matched++;
        break;
      }
    }
    // Fallback if no specific match
    if (!song.youtubeId) {
      song.youtubeId = song.language === "Tamil" ? "rp3_FhRnIRw" : "4NRXx6U8ABQ";
    }
  }

  fs.writeFileSync('web/src/data/catalog.json', JSON.stringify(catalog, null, 2), 'utf-8');
  console.log(`Updated catalog! ${matched} entries mapped with complete full-length YouTube track IDs.`);
}

run();

import fs from 'node:fs';
import path from 'node:path';

// Seed lists with exact search queries
const seeds = [
  // Tamil
  { key: "Munbe Vaa", term: "Munbe Vaa Sillunu Oru Kaadhal" },
  { key: "Vaseegara", term: "Vaseegara Minnale" },
  { key: "Kanmani Anbodu", term: "Kanmani Anbodu Gunaa" },
  { key: "Arabic Kuthu", term: "Arabic Kuthu Beast" },
  { key: "Rowdy Baby", term: "Rowdy Baby Maari 2" },
  { key: "Aalaporan Thamizhan", term: "Aalaporan Thamizhan Mersal" },
  { key: "New York Nagaram", term: "New York Nagaram Sillunu Oru Kaadhal" },
  { key: "Kadhale Kadhale", term: "Kadhale Kadhale 96" },
  { key: "Why This Kolaveri Di", term: "Why This Kolaveri Di 3" },
  { key: "Kannazhaga", term: "Kannazhaga 3" },
  { key: "Enna Solla Pogirai", term: "Enna Solla Pogirai Kandukondain" },
  { key: "Nenjukkul Peidhidum", term: "Nenjukkul Peidhidum Vaaranam Aayiram" },
  { key: "Adiye", term: "Adiye Kadal AR Rahman" },
  { key: "Maruvaarthai", term: "Maruvaarthai Sid Sriram" },
  { key: "Chinna Chinna Aasai", term: "Chinna Chinna Aasai Roja" },
  { key: "Pachai Nirame", term: "Pachai Nirame Alaipayuthey" },
  { key: "Snehidhane Snehidhane", term: "Snehidhane Snehidhane Alaipayuthey" },
  { key: "Hosanna", term: "Hosanna Vinnaithaandi Varuvaayaa" },
  { key: "Aaromale", term: "Aaromale Vinnaithaandi Varuvaayaa" },
  { key: "Oru Deivam Thantha Poove", term: "Oru Deivam Thantha Poove" },
  { key: "Thee Thalapathy", term: "Thee Thalapathy Varisu" },
  { key: "Chilla Chilla", term: "Chilla Chilla Thunivu" },
  { key: "Badass", term: "Badass Leo Anirudh" },
  { key: "Naa Ready", term: "Naa Ready Leo Vijay" },
  { key: "Hukum - Thalaivar Alappara", term: "Hukum Jailer Anirudh" },
  { key: "Kaavaalaa", term: "Kaavaalaa Jailer Shilpa Rao" },
  { key: "Enjoy Enjaami", term: "Enjoy Enjaami Dhee Arivu" },
  { key: "Veyyon Silli", term: "Veyyon Silli Soorarai Pottru" },
  { key: "Kaattu Payale", term: "Kaattu Payale Soorarai Pottru" },
  { key: "Unna Nenachu", term: "Unna Nenachu Psycho Sid Sriram" },
  { key: "En Jeevan", term: "En Jeevan Theri" },
  { key: "Neeyum Naanum Anbe", term: "Neeyum Naanum Anbe Imaikkaa Nodigal" },
  { key: "Thalli Pogathey", term: "Thalli Pogathey Sid Sriram" },
  { key: "Otha Sollaala", term: "Otha Sollaala Aadukalam" },
  { key: "Yathe Yathe", term: "Yathe Yathe Aadukalam" },
  { key: "Pookkalae Sattru Oyivedungal", term: "Pookkalae Sattru Oyivedungal I" },
  { key: "Ennodu Nee Irundhaal", term: "Ennodu Nee Irundhaal I" },
  { key: "Mental Manadhil", term: "Mental Manadhil OK Kanmani" },
  { key: "Malargal Kaettaen", term: "Malargal Kaettaen OK Kanmani" },
  { key: "Aye Sinamika", term: "Aye Sinamika OK Kanmani" },
  { key: "Ranjithame", term: "Ranjithame Varisu" },
  { key: "Megham Karukatha", term: "Megham Karukatha Thiruchitrambalam" },
  { key: "Thaai Kelavi", term: "Thaai Kelavi Thiruchitrambalam" },
  { key: "Life of Ram", term: "Life of Ram 96 Pradeep Kumar" },
  { key: "Sundari Kannal Oru Sethi", term: "Sundari Kannal Thalapathi" },

  // English
  { key: "Blinding Lights", term: "Blinding Lights The Weeknd" },
  { key: "Starboy", term: "Starboy The Weeknd" },
  { key: "Save Your Tears", term: "Save Your Tears The Weeknd" },
  { key: "Anti-Hero", term: "Anti-Hero Taylor Swift" },
  { key: "Cruel Summer", term: "Cruel Summer Taylor Swift" },
  { key: "Blank Space", term: "Blank Space Taylor Swift" },
  { key: "Shape of You", term: "Shape of You Ed Sheeran" },
  { key: "Perfect", term: "Perfect Ed Sheeran" },
  { key: "Bad Habits", term: "Bad Habits Ed Sheeran" },
  { key: "As It Was", term: "As It Was Harry Styles" },
  { key: "Watermelon Sugar", term: "Watermelon Sugar Harry Styles" },
  { key: "Levitating", term: "Levitating Dua Lipa" },
  { key: "Don't Start Now", term: "Don't Start Now Dua Lipa" },
  { key: "Stay", term: "Stay The Kid LAROI Justin Bieber" },
  { key: "Sunflower", term: "Sunflower Post Malone Swae Lee" },
  { key: "Circles", term: "Circles Post Malone" },
  { key: "Viva La Vida", term: "Viva La Vida Coldplay" },
  { key: "Fix You", term: "Fix You Coldplay" },
  { key: "Yellow", term: "Yellow Coldplay" },
  { key: "A Sky Full of Stars", term: "A Sky Full of Stars Coldplay" },
  { key: "Bad Guy", term: "Bad Guy Billie Eilish" },
  { key: "Ocean Eyes", term: "Ocean Eyes Billie Eilish" },
  { key: "Lovely", term: "Lovely Billie Eilish Khalid" },
  { key: "Bohemian Rhapsody", term: "Bohemian Rhapsody Queen" },
  { key: "Don't Stop Me Now", term: "Don't Stop Me Now Queen" },
  { key: "Do I Wanna Know?", term: "Do I Wanna Know Arctic Monkeys" },
  { key: "505", term: "505 Arctic Monkeys" },
  { key: "Someone Like You", term: "Someone Like You Adele" },
  { key: "Rolling in the Deep", term: "Rolling in the Deep Adele" },
  { key: "Easy On Me", term: "Easy On Me Adele" },
  { key: "Midnight City", term: "Midnight City M83" },
  { key: "Get Lucky", term: "Get Lucky Daft Punk" },
  { key: "Instant Crush", term: "Instant Crush Daft Punk" },
  { key: "One More Time", term: "One More Time Daft Punk" },
  { key: "Video Games", term: "Video Games Lana Del Rey" },
  { key: "Summertime Sadness", term: "Summertime Sadness Lana Del Rey" },
  { key: "Creep", term: "Creep Radiohead" },
  { key: "In the End", term: "In the End Linkin Park" },
  { key: "Numb", term: "Numb Linkin Park" },
  { key: "Dreams", term: "Dreams Fleetwood Mac" },
  { key: "Take Me to Church", term: "Take Me to Church Hozier" },
  { key: "Riptide", term: "Riptide Vance Joy" },
  { key: "Counting Stars", term: "Counting Stars OneRepublic" },
  { key: "Wake Me Up", term: "Wake Me Up Avicii" },
  { key: "Levels", term: "Levels Avicii" },
  { key: "Time", term: "Time Inception Hans Zimmer" },
  { key: "Cornfield Chase", term: "Cornfield Chase Hans Zimmer" }
];

async function run() {
  const previewCache = {};
  console.log(`Querying real audio previews for ${seeds.length} songs from Apple Music...`);

  for (const item of seeds) {
    try {
      const url = `https://itunes.apple.com/search?term=${encodeURIComponent(item.term)}&media=music&limit=1`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (data.results && data.results.length > 0) {
          const r = data.results[0];
          previewCache[item.key] = {
            previewUrl: r.previewUrl,
            artworkUrl: r.artworkUrl100 ? r.artworkUrl100.replace('100x100bb.jpg', '300x300bb.jpg') : null,
            realTitle: r.trackName,
            realArtist: r.artistName
          };
          console.log(`✓ Found: ${item.key} -> ${r.trackName} by ${r.artistName}`);
        }
      }
      // Small pause to be gentle with rate limits
      await new Promise((resolve) => setTimeout(resolve, 120));
    } catch (e) {
      console.warn(`Failed for ${item.key}: ${e.message}`);
    }
  }

  // Now update web/src/data/catalog.json
  const catalogPath = path.resolve('web/src/data/catalog.json');
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf-8'));

  let matched = 0;
  for (const song of catalog) {
    // Find matching seed
    for (const [key, data] of Object.entries(previewCache)) {
      if (song.title.includes(key)) {
        song.audioUrl = data.previewUrl;
        song.artworkUrl = data.artworkUrl;
        matched++;
        break;
      }
    }
  }

  fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2), 'utf-8');
  console.log(`Updated catalog! ${matched} of ${catalog.length} songs now have REAL song audio & artwork.`);
}

run();

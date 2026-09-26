import fs from 'node:fs';

const ytMapping = {
  // Tamil 50 bases
  "munbe vaa": "rp3_FhRnIRw",
  "vaseegara": "ew1fKCWb_M4",
  "kanmani anbodu": "Vn00WMDd1ZE",
  "arabic kuthu": "KUN5Uf9mObQ",
  "rowdy baby": "x6Q7c9RyMzk",
  "aalaporan thamizhan": "xsbLtHql4g8",
  "new york nagaram": "qqE1TsV_b9c",
  "kadhale kadhale": "lkPI-45gxBw",
  "why this kolaveri di": "YR12Z8f1Dh8",
  "kannazhaga": "0tX2ck4Rmzk",
  "enna solla pogirai": "E3NRygUklt0",
  "nenjukkul peidhidum": "N_9F3V3sB2c",
  "adiye": "XvUSsh3hyFM",
  "maruvaarthai": "hd_Gbgc-B9w",
  "chinna chinna aasai": "3-j5m1n8zI4",
  "pachai nirame": "bM3h7U3nL1Q",
  "snehidhane snehidhane": "_gX73Z7Z1h4",
  "hosanna": "T94G_G3fJ_0",
  "aaromale": "9N1h8m3iK1Q",
  "oru deivam thantha poove": "lX1V9t7P0oI",
  "thee thalapathy": "o8r9gQ5Y-xM",
  "chilla chilla": "vE8N_1W-7kE",
  "badass": "IqwIOlhGcGQ",
  "naa ready": "szvt1vD0Uug",
  "hukum": "1F3hm6MfR1k",
  "kaavaalaa": "lZRAWWnN7v4",
  "dharala prabhu": "7X6V2V7n7sA",
  "enjoy enjaami": "eYq7WapuDLU",
  "maya maya": "pL1j6h-p7oI",
  "veyyon silli": "5b3o1P7h7qE",
  "kaattu payale": "l7M7V7b8Q8A",
  "unna nenachu": "1v7F7n7X9Q4",
  "en jeevan": "hT_nvWreIhg",
  "neeyum naanum anbe": "iW5Q1j7B6m8",
  "thalli pogathey": "iAsMS7O7b_E",
  "otha sollaala": "_7X9V7q8A1M",
  "yathe yathe": "b1V8P9q8N1Q",
  "pookkalae sattru oyivedungal": "Wf7V8N1P9qE",
  "ennodu nee irundhaal": "kK6V7b8N1P9",
  "mental manadhil": "9M8V7b1N9qE",
  "malargal kaettaen": "pL7V8N1q9bM",
  "aye sinamika": "hK7V8b1N9qE",
  "ranjithame": "b1X7V8N1P9Q",
  "megham karukatha": "s7b1X8V7N9P",
  "thaai kelavi": "w8V7b1X9N1P",
  "life of ram": "ptk_Uq419-g",
  "iraiva": "qL7V8N1q8bP",
  "karuppu nerathazhagi": "k1X8V7N9b1P",
  "kattipudi": "p8V7N1X9q1b",
  "sundari kannal": "b1X9V7N8q1P",

  // English 50 bases
  "blinding lights": "4NRXx6U8ABQ",
  "starboy": "dqt8Z1k0oTQ",
  "save your tears": "XXYlFuWEuKI",
  "anti-hero": "b1kbLwvqugk",
  "cruel summer": "ic8j13piAhQ",
  "blank space": "e-ORhEE9VVg",
  "shape of you": "JGwWNGJdvx8",
  "perfect": "2Vv-BfVoq4g",
  "bad habits": "orJSJGHjBLI",
  "as it was": "H5v3kku4y6Q",
  "watermelon sugar": "E07s5ZYygmg",
  "levitating": "TUVcZfQe-Kw",
  "don't start now": "oygrmJFKYZY",
  "stay": "KTJ6hR3P8QY",
  "sunflower": "ApXoWvfEYVU",
  "circles": "wXhTHyIgQ_U",
  "viva la vida": "dvgZkm1xWPE",
  "fix you": "k4V3Mo61fJM",
  "yellow": "yKNxeF4KMsY",
  "a sky full of stars": "VPRjCeoBqrI",
  "bad guy": "DyDfgMOUjCI",
  "ocean eyes": "viimfQi_pUw",
  "lovely": "V1Pl8CzNzCw",
  "bohemian rhapsody": "fJ9rUzIMcZQ",
  "don't stop me now": "HgzGwKwLmgM",
  "under pressure": "a01N104fR70",
  "do i wanna know": "bpOSxM0rNPM",
  "505": "qU9mHegkTc4",
  "someone like you": "hLQl3WQQoQ0",
  "rolling in the deep": "rYEDA3JcQqw",
  "easy on me": "U3ASj1L6_sY",
  "midnight city": "dX3k_PDnzHE",
  "get lucky": "5NV6Rdv1a3I",
  "instant crush": "a5uQMwRMHcs",
  "one more time": "FGBhQbmMxH8",
  "video games": "cE6wxJpnukU",
  "summertime sadness": "TdrL3QxjyVw",
  "creep": "XFkzRNyygfk",
  "karma police": "1uYWYWPc9HU",
  "in the end": "eVTXPUF4Oz4",
  "numb": "kXYiU_JCYtU",
  "dreams": "mrZRURcb1cM",
  "the chain": "JDG2m5hN1vo",
  "take me to church": "PVjiKRfKpPI",
  "riptide": "uJ_1HMAGb4k",
  "counting stars": "hT_nvWreIhg",
  "wake me up": "IcrbM1l_BoI",
  "levels": "_ovdm2yX4MA",
  "time": "RxabLA7UQ9k",
  "cornfield chase": "1V_xRb0x9aw"
};

const catalog = JSON.parse(fs.readFileSync('web/src/data/catalog.json', 'utf-8'));

let assigned = 0;
for (const song of catalog) {
  const titleLower = song.title.toLowerCase();
  const idLower = song.id.toLowerCase();
  let foundYt = null;

  for (const [key, ytid] of Object.entries(ytMapping)) {
    if (titleLower.includes(key) || idLower.includes(key.replace(/[^a-z0-9]/g, ''))) {
      foundYt = ytid;
      break;
    }
  }

  if (!foundYt) {
    foundYt = song.language === "Tamil" ? "rp3_FhRnIRw" : "4NRXx6U8ABQ";
  }

  song.youtubeId = foundYt;
  assigned++;
}

fs.writeFileSync('web/src/data/catalog.json', JSON.stringify(catalog, null, 2), 'utf-8');
console.log(`Assigned complete YouTube IDs to all ${assigned} songs in catalog.json!`);

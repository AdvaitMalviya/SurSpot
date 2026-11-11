// English songs: node --env-file=.env scripts/english.mjs [--plan] [--offline] [--limit N] [--years 1990-2026] [--add] [--cached]
//   1. Candidates: Billboard's Year-End Hot 100 for each year (Wikipedia), plus the Last.fm top tracks of ARTISTS,
//      the singers and bands Indian listeners know well, many of whom US charts undercount; the top tracks of everyone
//      else who leads two or more English chart songs; and Last.fm's India chart, for songs by any of those artists.
//   2. iTunes: "<title> <artist>", then the artist's 200 top songs, then the title alone. A track counts when the title
//      matches, the credit names the artist, it has a preview, it is not filed under an Indian or non-English genre,
//      and it is the studio recording: radio edits, single versions and remasters are fine; live, remixed, acoustic,
//      extended and re-recorded versions are not. Of several copies the original release wins: not a compilation,
//      not a clean edit, then the earliest date.
//   3. Year: the earliest date among the artist's copies of the song, or the chart year when that is earlier (remasters
//      and compilations carry later dates; a song that charted years after it came out keeps its release year).
//      Songs outside --years are left for a later run.
//   4. Tiers: Last.fm listeners, calibrated per decade on the hand-tagged songs in data/english-tiers.json (which keep
//      their own tier), then made easier for songs high on Last.fm's India chart, since US and global counts miss what
//      Indian listeners play.
// Drops anything already in the Hindi or Punjabi catalogs. Writes data/english.json and data/english-report.md.
// --plan stops after step 1 and prints the candidates. --limit N matches only N candidates and writes nothing.
// --add keeps data/english.json as it is and adds only songs not already in it (report in data/english-add-report.md).
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DATA, net, readJson, writeJsonRows, itunesJson, searchUrl, slugify, skeleton, basicNorm, stripDecorations, decorations,
  creditHits, lev, artwork600, decadeOf, throttleInterval, splitArtists, isCached,
} from './lib.mjs';
import { lastfm, lastfmStats, listenersFor } from './lastfm.mjs';
import { cutsByDecade, tierFor } from './tiers.mjs';
import { wiki } from './wiki.mjs';

const args = process.argv.slice(2);
const opt = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const offline = args.includes('--offline'), plan = args.includes('--plan'), add = args.includes('--add');
const limit = Number(opt('--limit')) || Infinity;
const [FROM, TO] = (opt('--years') ?? '1990-2026').split('-').map(Number);
if (!process.env.LASTFM_API_KEY && !offline) {
  console.error('No Last.fm key. Put LASTFM_API_KEY=... in .env and run: node --env-file=.env scripts/english.mjs');
  process.exit(1);
}

const LAST_CHART = 2025;       // Billboard's Year-End list for a year comes out in December
const PER_ARTIST = Number(opt('--per-artist')) || 30;
const MIN_LISTENERS = 20000;   // an artist's own Last.fm track page...
const SHARE_OF_TOP = 0.2;      // ...and at least a fifth of the listeners of their best-known song
const PER_CHARTED = 10;        // songs from the page of an artist not on ARTISTS who leads two or more chart songs...
const MIN_CHARTED = 50000;     // ...each with at least this many listeners
const PER_INDIA = 30;          // songs per artist from Last.fm's India chart

// ---------------------------------------------------------------- artists
// English-language singers and bands Indian listeners know. Many were bigger in India than on the US charts
// (Westlife, Boyzone, Bryan Adams; before them Boney M., Jim Reeves, Cliff Richard), or are what Indian listeners
// play now (Last.fm's India chart).
const ARTISTS = [
  'Westlife', 'Backstreet Boys', 'Boyzone', 'Spice Girls', '*NSYNC', 'Hanson', 'Aqua', 'Vengaboys', 'Savage Garden', 'Roxette',
  'Ace of Base', 'Bryan Adams', 'Celine Dion', 'Mariah Carey', 'Whitney Houston', 'Michael Jackson', 'Madonna', 'George Michael',
  'Britney Spears', 'Christina Aguilera', 'Jennifer Lopez', 'Ricky Martin', 'Enrique Iglesias', 'Shakira', 'Blue', 'S Club 7',
  'Robbie Williams', 'Ronan Keating', 'Shaggy', 'Eiffel 65', 'Bon Jovi', 'Akon', 'Sean Paul', 'Eminem', '50 Cent', 'Usher',
  'The Black Eyed Peas', 'Nelly Furtado', 'Timbaland', 'The Pussycat Dolls', 'Avril Lavigne', 'Kelly Clarkson', 'Rihanna',
  'Beyoncé', "Destiny's Child", 'Alicia Keys', 'Linkin Park', 'Evanescence', 'Green Day', 'Nickelback', 'The Killers', 'Coldplay',
  'Oasis', 'Red Hot Chili Peppers', 'Nirvana', 'Metallica', 'Daft Punk', 'Lady Gaga', 'Katy Perry', 'Taylor Swift', 'Bruno Mars',
  'Maroon 5', 'OneRepublic', 'Pitbull', 'Flo Rida', 'LMFAO', 'Jason Derulo', 'Owl City', 'Adele', 'Ed Sheeran', 'Justin Bieber',
  'One Direction', 'ZAYN', 'Harry Styles', 'Shawn Mendes', 'Charlie Puth', 'Selena Gomez', 'Ariana Grande', 'Sia',
  'Imagine Dragons', 'The Chainsmokers', 'Alan Walker', 'Marshmello', 'Avicii', 'David Guetta', 'Calvin Harris', 'Martin Garrix',
  'Kygo', 'Major Lazer', 'DJ Snake', 'Clean Bandit', 'Twenty One Pilots', 'Post Malone', 'The Weeknd', 'Drake', 'Dua Lipa',
  'Billie Eilish', 'Lewis Capaldi', 'Sam Smith', 'James Arthur', 'Halsey', 'Camila Cabello', 'Lana Del Rey', 'Arctic Monkeys',
  'The Neighbourhood', 'Tame Impala', 'Cigarettes After Sex', 'Radiohead', 'The 1975', 'Frank Ocean', 'Joji', 'Glass Animals',
  'Lord Huron', 'Keane', 'The Script', 'Snow Patrol', 'Passenger', 'Hozier', 'Olivia Rodrigo', 'Sabrina Carpenter', 'Doja Cat',
  'Jason Mraz', 'James Blunt', 'Daniel Powter', 'Lifehouse', 'Train', 'Goo Goo Dolls', 'Lukas Graham', 'Mike Posner', 'Gotye',
  'fun.', 'Foster the People', 'MGMT', 'Kings of Leon', 'Muse', 'The Fray', 'The Lumineers', 'Vance Joy', 'Bastille', 'Lorde',
  'Florence + the Machine', 'Ellie Goulding', 'Rita Ora', 'Jessie J', 'Bebe Rexha', 'Zara Larsson', 'Tones and I', 'Lauv',
  'Benson Boone', 'Teddy Swims', 'Tate McRae', 'Chappell Roan', 'Gracie Abrams', 'Djo', 'Steve Lacy', 'SZA', 'Kendrick Lamar',
  'Kanye West', 'JAY-Z', 'Lil Nas X', 'Juice WRLD', 'XXXTENTACION', 'Mac DeMarco', 'TV Girl', 'Laufey',
  'Stephen Sanchez', 'Khalid', 'Miley Cyrus', 'Demi Lovato', 'Nick Jonas', 'Jonas Brothers', 'Fall Out Boy', 'Panic! At The Disco',
  'Paramore', 'My Chemical Romance', 'Simple Plan', 'Good Charlotte', 'Sum 41', 'blink-182', 'The Cranberries', 'U2',
  'Lenny Kravitz', 'Seal', 'Dido', 'Natasha Bedingfield', 'Jordin Sparks', 'Leona Lewis', 'Chris Brown', 'Ne-Yo', 'Pharrell Williams',
  'Mark Ronson', 'Wiz Khalifa', 'Macklemore', 'Gym Class Heroes', 'Cobra Starship', 'Far East Movement', 'Iyaz', 'Sean Kingston',
  'Taio Cruz', 'Jay Sean',
  // before 1990
  'ABBA', 'Queen', 'The Beatles', 'Elvis Presley', 'Boney M.', 'Bee Gees', 'Eagles', 'Simon & Garfunkel', 'Led Zeppelin',
  'Pink Floyd', 'The Rolling Stones', 'Lionel Richie', 'Stevie Wonder', 'Phil Collins', 'Cyndi Lauper', 'Modern Talking', 'Europe',
  'a-ha', 'Dire Straits', "Guns N' Roses", 'AC/DC', 'Def Leppard', 'Scorpions', 'Toto', 'Journey', 'Kenny Rogers', 'John Denver',
  'Cliff Richard', 'Carpenters', 'Bob Marley & The Wailers', 'Bob Dylan', 'Elton John', 'Billy Joel', 'Rod Stewart', 'Wham!',
  'Duran Duran', 'Tears for Fears', 'The Police', 'Survivor', 'Kool & The Gang', 'Chicago', 'Air Supply', 'Lobo', 'Don McLean',
  'Engelbert Humperdinck', 'Tom Jones', 'Neil Diamond', 'Harry Belafonte', 'Jim Reeves', 'Pat Boone', 'Paul Anka',
  'Nat King Cole', 'Frank Sinatra', 'Dean Martin', 'Louis Armstrong', 'The Beach Boys', 'The Doors', 'Creedence Clearwater Revival',
  'Deep Purple', 'Fleetwood Mac', 'Bonnie Tyler', 'Olivia Newton-John', 'Donna Summer', 'Gloria Gaynor', 'Village People',
  'Chris de Burgh', 'Rick Astley', 'Foreigner', 'Bobby McFerrin', 'UB40', 'Tracy Chapman', 'Eurythmics', 'Bruce Springsteen',
  'Van Halen', 'Pet Shop Boys', 'Depeche Mode', 'The Cure', 'John Lennon', 'Cat Stevens', 'The Monkees',
];
// Last.fm tracks of an artist that are someone else's (a namesake on the same page) or not in English
const NOT_THEIRS = {};
// Artists whose Last.fm pages and India-chart songs are mostly in another language, or whose page mixes in a namesake
// (the Rascals with a 2008 UK band, the Highwaymen folk group with the country supergroup, the R&B group Divine with
// the Indian rapper DIVINE): their hits come in through the charts only
const OTHER_TONGUE = ['BTS', 'Jimin', 'Marc Anthony'];
const SHARED_PAGE = ['The Rascals', 'The Highwaymen', 'Divine'];
// Songs left out by hand (title|first artist), where nothing else catches them. With --add, a song already in
// data/english.json that matches (by its first singer) comes out of it.
const SKIP = new Map([
  ['Al di là|Emilio Pericoli', 'sung in Italian'],
  ['Banana Boat (Day-O)|Harry Belafonte', 'the same song as his "Day-O (The Banana Boat Song)"'],
  ["It's in the Book|Johnny Standley", 'a spoken comedy routine, not a song'],
  ['St. George and the Dragonet|Stan Freberg', 'a spoken comedy routine, not a song'],
  ['Mi Tierra|Gloria Estefan', 'sung in Spanish'],
  ['Corazón Espinado|Santana', 'sung in Spanish'],
  ['Oye Como Va|Santana', 'sung in Spanish'],
  ['Loba|Shakira', 'the Spanish version of "She Wolf"'],
  ['Cuando Me Enamoro|Enrique Iglesias', 'sung in Spanish'],
  ['Bailando|Enrique Iglesias', 'iTunes India has only Descemer Bueno\'s Spanish recording, not the English version that charted'],
  ['Bailando|Descemer Bueno', 'his Spanish recording, not the English version by Enrique Iglesias that charted'],
  ['Sun Is Shining|Bob Marley & The Wailers', 'only the 2020 Robin Schulz remix is on iTunes India'],
]);
const skipOf = (title, artist) => [...SKIP].find(([k]) => { const [t, a] = k.split('|'); return titleKey(t) === titleKey(title) && credited([a], artist); })?.[1] ?? null;

// ---------------------------------------------------------------- Billboard Year-End Hot 100 (Wikipedia)
// Links become placeholders first, so a linked name like [[Hootie & the Blowfish]] stays one artist.
function parseCell(s) {
  const links = [];
  let x = String(s).replace(/<ref[^>]*\/>/gi, '').replace(/<ref[\s\S]*?<\/ref>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
  x = x.replace(/\[\[([^\]|]*)(?:\|([^\]]*))?\]\]/g, (_, target, text) => {
    links.push({ target: target.split('#')[0].trim(), text: (text ?? target).trim() });
    return `\u0001${links.length - 1}\u0002`;
  });
  for (let i = 0; i < 3; i++) {
    x = x.replace(/\{\{([^{}]*)\}\}/g, (_, inner) => {
      const [name, ...rest] = inner.split('|').map((t) => t.trim());
      const pos = rest.filter((t) => !/^[a-z-]+\s*=/i.test(t));
      if (/^sortname$/i.test(name)) return pos.slice(0, 2).join(' ');
      if (/^(nowrap|center|small|nobr|abbr|sort)$/i.test(name)) return pos[/^sort$/i.test(name) ? 1 : 0] ?? pos[0] ?? '';
      return '';
    });
  }
  x = x.replace(/<[^>]+>/g, '').replace(/'''?/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
  return { x, links };
}
const shown = ({ x, links }, part = x) =>
  part.replace(/\u0001(\d+)\u0002/g, (_, i) => links[i].text).replace(/\s+/g, ' ').trim();

// A wikitable's data rows as arrays of cells, rowspans filled in (an artist with two songs in a row is written once).
function tableRows(text, columns = 3) {
  const start = text.indexOf('{|');
  if (start < 0) return [];
  const end = text.indexOf('\n|}', start);
  const body = text.slice(start, end < 0 ? undefined : end);
  const rows = [], carry = [];
  for (const raw of body.split(/\n\|-[^\n]*/).slice(1)) {
    if (/^!.*\bTitle\b/m.test(raw)) continue; // the header row
    const cells = [];
    for (const line of raw.split('\n')) {
      if (!/^[|!]/.test(line) || /^\|[+}]/.test(line)) continue;
      cells.push(...line.slice(1).split(/\|\||!!/));
    }
    const parsed = cells.map((c) => {
      // attributes before a single pipe ("rowspan="2" | ..."), never the pipe inside a [[link|text]]
      const m = c.match(/^\s*((?:[a-z-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s|"']+)\s*)+)\|(?!\|)([\s\S]*)$/i);
      const rs = m?.[1].match(/rowspan\s*=\s*"?(\d+)/i);
      return { text: (m ? m[2] : c).trim(), rowspan: rs ? Number(rs[1]) : 1 };
    });
    const full = [];
    let k = 0;
    for (let col = 0; col < columns; col++) {
      if (carry[col]?.left > 0) { full.push(carry[col].text); carry[col].left--; continue; }
      const c = parsed[k++];
      if (!c) break;
      full.push(c.text);
      if (c.rowspan > 1) carry[col] = { text: c.text, left: c.rowspan - 1 };
    }
    rows.push(full);
  }
  return rows;
}

// "[[Coolio]] featuring [[L.V. (singer)|L.V.]]" -> ["Coolio", "L.V."]
const SEP = /\s*(?:,|\bfeaturing\b|\bfeat\.?|\bft\.?|\bwith\b|\band\b|&|\s\+\s|\sx\s|\svs\.?\s)\s*/i;
function artistsOf(cellText) {
  const c = parseCell(cellText);
  return c.x.split(SEP).map((p) => shown(c, p)).filter((a) => /[a-z0-9]/i.test(a));
}
// '"[[Boombastic (song)|Boombastic]]" / "[[In the Summertime]]"' -> two songs, each with its Wikipedia article
function titlesOf(cellText) {
  const c = parseCell(cellText);
  const quoted = [...c.x.matchAll(/["“]([^"”]+)["”]/g)].map((m) => m[1]);
  return (quoted.length ? quoted : [c.x]).map((part) => {
    const link = part.match(/\u0001(\d+)\u0002/);
    return { title: shown(c, part).replace(/^["“]|["”]$/g, ''), wiki: link ? c.links[link[1]].target : null };
  }).filter((t) => t.title);
}

async function billboard(year) {
  const b = await wiki({ action: 'query', prop: 'revisions', rvprop: 'content', rvslots: 'main', redirects: '1',
    titles: `Billboard Year-End Hot 100 singles of ${year}` }, { offline });
  const text = b?.query?.pages?.[0]?.revisions?.[0]?.slots?.main?.content ?? '';
  const out = [];
  for (const [no, titleCell, artistCell] of tableRows(text)) {
    const rank = Number(parseCell(no ?? '').x.replace(/\D+/g, ''));
    if (!rank || !titleCell || !artistCell) continue;
    const artists = artistsOf(artistCell);
    for (const t of titlesOf(titleCell)) out.push({ ...t, artists, year, rank });
  }
  return out;
}

// Wikipedia files songs by language ("Spanish-language songs"); a charted song filed only under other languages is left
// out ("Despacito", "El Perdón"). Songs in both English and another language stay, as do songs with no language filed.
// Sung in English, though Wikipedia files them under another language (for a version in it) or iTunes under K-Pop
const SUNG_IN_ENGLISH = new Set(['End of the Road|Boyz II Men', 'Do You Believe in Us|Jon Secada', 'Angel|Jon Secada',
  'Hero|Mariah Carey', 'Sukiyaki|4 P.M.', 'I Want You|Thalía', 'Cupid|Fifty Fifty', 'Dynamite|BTS', 'Butter|BTS',
  'Permission to Dance|BTS', 'Waterloo|ABBA', 'Major Tom (Coming Home)|Peter Schilling', 'Sukiyaki|A Taste of Honey',
  'Vaya con Dios|Les Paul and Mary Ford', 'Rose, Rose, I Love You|Frankie Laine', 'Tzena, Tzena, Tzena|Gordon Jenkins',
  'This Girl Is a Woman Now|Gary Puckett & The Union Gap', 'The Girl from Ipanema|Stan Getz']);
const LANGUAGES = ['English', 'Spanish', 'Portuguese', 'Korean', 'Japanese', 'French', 'Italian', 'German', 'Hindi', 'Punjabi',
  'Arabic', 'Swedish', 'Dutch', 'Russian', 'Turkish', 'Hebrew', 'Greek', 'Tagalog', 'Mandarin', 'Cantonese', 'Yoruba'];
async function languagesOf(pages) {
  const cats = [...LANGUAGES.map((l) => `Category:${l}-language songs`), 'Category:Spanglish songs'];
  const out = new Map(); // article as linked -> Set of languages
  const unique = [...new Set(pages)];
  for (let i = 0; i < unique.length; i += 50) {
    const batch = unique.slice(i, i + 50);
    const b = await wiki({ action: 'query', prop: 'categories', redirects: '1', cllimit: 'max', clcategories: cats.join('|'), titles: batch.join('|') }, { offline });
    const q = b?.query ?? {};
    const to = new Map([...(q.normalized ?? []), ...(q.redirects ?? [])].map((n) => [n.from, n.to]));
    const final = (t) => { let x = t; for (let k = 0; k < 3 && to.has(x); k++) x = to.get(x); return x; };
    const langs = new Map((q.pages ?? []).map((p) => [p.title, new Set((p.categories ?? []).map((c) => c.title.replace(/^Category:|(-language)? songs$/g, '')))]));
    for (const t of batch) out.set(t, langs.get(final(t)) ?? new Set());
  }
  return out;
}

// ---------------------------------------------------------------- Last.fm candidates
// A leading "The" doesn't make another song: "The House of the Rising Sun" is "House of the Rising Sun"
const titleKey = (t) => skeleton(stripDecorations(t) || t).join(' ').replace(/^the (?=.)/, '');
// Carols and Christmas standards everyone has recorded: only the exact recording counts as right, so naming the song
// isn't enough to get it. Christmas hits that are a singer's own song ("All I Want for Christmas Is You") stay, and
// a charted recording of a standard comes in through the charts regardless.
const STANDARD = /^(jingle bells|silent night|sleigh ride|silver bells|white christmas|winter wonderland|o holy night|have yourself a merry little christmas|the christmas song|let it snow|deck the halls?|the first noel|o come all ye faithful|hark the herald|(the )?little drummer boy|frosty the snowman|rudolph the red nosed reindeer|santa claus is coming? to town|its beginning to look a lot like christmas|ill be home for christmas|marys boy child|away in a manger|ave maria|amazing grace|o little town of bethlehem|we wish you a merry christmas|god rest ye merry gentlemen|joy to the world|the twelve days of christmas|o christmas tree)\b/;
async function topTracks(artist, per = PER_ARTIST, min = MIN_LISTENERS) {
  // Last.fm reads a '+' in a name as a space, so it is sent encoded twice (Florence + the Machine)
  const b = await lastfm({ method: 'artist.gettoptracks', artist: artist.replace(/\+/g, '%2B'), limit: '50', autocorrect: '1' }, { offline });
  const merged = new Map();
  for (const t of b?.toptracks?.track ?? []) {
    const title = (stripDecorations(t.name) || t.name).replace(/\s+/g, ' ').trim();
    if (!/[a-z0-9]/i.test(title) || /^(intro|outro|interlude|skit|untitled)$/i.test(title) || STANDARD.test(basicNorm(title))) continue;
    if (NOT_THEIRS[artist]?.some((n) => titleKey(n) === titleKey(title))) continue;
    const k = titleKey(title);
    if (!k) continue;
    const listeners = Number(t.listeners) || 0;
    const m = merged.get(k);
    if (!m) merged.set(k, { title, artists: [artist], listeners });
    else if (listeners > m.listeners) m.listeners = listeners;
  }
  const all = [...merged.values()].sort((a, b) => b.listeners - a.listeners);
  const floor = Math.max(min, (all[0]?.listeners ?? 0) * SHARE_OF_TOP);
  return all.filter((c) => c.listeners >= floor).slice(0, per).map((c, i) => ({ ...c, artistRank: i + 1 }));
}

// ---------------------------------------------------------------- matching
// Credit spellings that the shared artist matcher can't link on its own
const ALIAS = {
  'pink': ['p nk'], 'kesha': ['ke ha'], 'puff daddy': ['p diddy', 'diddy'], 'p diddy': ['puff daddy', 'diddy'],
  'diddy': ['puff daddy', 'p diddy'], 'lady antebellum': ['lady a'], 'lady a': ['lady antebellum'], 'mc hammer': ['hammer'],
  'kanye west': ['ye'], 'the notorious b i g': ['notorious b i g'], 'jawsh 685': ['jawsh685'], 'nsync': ['n sync'],
};
const names = (artists) => artists.flatMap((a) => [a, ...(ALIAS[basicNorm(a)] ?? [])]);
const credited = (artists, credit) => creditHits(names(artists), credit).length > 0;
// The credit, whole or split into its names ("Prince & The Revolution" -> Prince), is one of the artists exactly
const exactCredit = (artists, credit) => {
  const want = new Set([...names(artists), ...artists.flatMap(splitArtists)].map(nameKey));
  return [credit, ...splitArtists(credit)].some((n) => want.has(nameKey(n)));
};

function sameTitle(a, b) {
  const A = skeleton(stripDecorations(a) || a), B = skeleton(stripDecorations(b) || b);
  if (!A.length || !B.length) return false;
  const aj = A.join(''), bj = B.join('');
  if (aj === bj) return true;
  if (A.length === B.length && A.every((t, i) => t === B[i] || (Math.min(t.length, B[i].length) >= 6 && lev(t, B[i]) <= 1))) return true;
  return Math.min(aj.length, bj.length) >= 12 && lev(aj, bj) <= (aj.length >= 18 ? 2 : 1);
}

// A decoration that is still the record: featured artists, a soundtrack it came from, a remaster, a radio edit.
const FINE = /^(feat|featuring|ft|with|prod|produced)\b|^from\b|\bsoundtrack\b|\bmotion picture\b|^(\d{4} )?(digital(ly)? )?remaster(ed)?( \d{4})?( version| edition)?$|^(radio|single|album|original|main|clean|explicit|dirty|censored|uncensored|amended|stereo|mono|lp|short|us|uk|7|7 inch|45|original single|radio single|single radio)( (version|edit|mix))+$|^(clean|explicit|dirty|stereo|mono|bonus track|radio edit|edit|single|original|original mix)$/;
const VERSION = /\b(live|remix(es|ed)?|re ?mix|rem ?x|sing ?along|mix|acoustic|unplugged|karaoke|instrumental|cover|tribute|sped up|speed up|slowed|reverb|lo ?fi|a ?cappella|acapella|demo|extended|club|dub|reprise|re ?recorded|taylors version|orchestral|symphonic|stripped|sessions?|commentary|8d|nightcore|chopped|screwed|medley|mash ?up|rehearsal|alternate|alt|rework(ed)?|re ?edit|piano|video|interlude|skit|spanish|espanol|portuguese|french|italian|german|japanese|korean|mandarin|version|edit)\b/gi;
const versionWords = (d, own) => (FINE.test(basicNorm(d)) ? [] : (basicNorm(d).match(VERSION) || []).filter((w) => !own.has(w.toLowerCase())));
const ALBUM_VERSION = /\b(live (at|in|from|on)|in concert|unplugged|karaoke|tribute|instrumentals?|lullab\w*|in the style of|made famous|sing ?along|acoustic|remixes|remixed|covers|piano|orchestra|symphon\w*|workout|fitness|kidz bop|sped up|slowed|lo ?fi|8d|a cappella)\b|^live\b|\blive$/;
const COVER_ARTIST = /\b(tribute|tributo|for babies|for kids|karaoke|made famous|in the style|originally performed|cover|covers|sing ?along|string quartet|lullaby|piano|orchestra|ensemble|all ?stars|hit crew|chartbusters?|backing tracks?|soundalike|workout|kidz bop|twinkle|vitamin|8 ?bit|nightcore)\b/;
const COMPILATION = /\b(greatest hits|best of|the best|hits|highlights|essential|essentials|collection|anthology|gold|platinum|number ones|1s|the singles|singles|now thats what i call|now \d+|classics|love songs|ballads|legend|ultimate|definitive|very best|decade|years|chart|party|workout|top \d+|\d+ (hits|songs)|playlist|throwback|forever|icons?|20th century masters|super hits|smash hits|grammy nominees|pure|vol|volume)\b/;
// A later edition of the same record: the original release comes first when both are there
const REISSUE = /\b(anniversary|remix(es)?|extended|deluxe|expanded|edition|remaster(ed)?|reissue|live|version|revisited|re ?recorded)\b/;
// Indian genres (those songs are in the Hindi and Punjabi catalogs) and genres sung in another language
const INDIAN = /^(bollywood|indian|indian pop|indian classical|indian folk|punjabi|punjabi pop|regional indian|tamil|telugu|kannada|malayalam|bengali|marathi|gujarati|sufi & ghazals|devotional & spiritual)$/i;
const OTHER_LANGUAGE = /^(.* in spanish|latin|latino|pop latino|latin pop|latin urban|urbano latino|latin rap|reggaeton|música mexicana|musica mexicana|regional mexican|mexicano|música tropical|tropical|salsa|salsa and tropical|bachata|cumbia|k-pop|j-pop|cantopop|mandopop|c-pop|brazilian|mpb|sertanejo|axé|pagode|funk brasileiro|french pop|variété française|chanson|german pop|schlager|deutschpop|italian pop|arabic|turkish)$/i;

const albumCore = (r) => (r.collectionName ?? '').replace(/\s*-\s*(single|ep)\s*$/i, '').trim();
const isCompilation = (r) => /various artists/i.test(r.collectionArtistName ?? '') || COMPILATION.test(basicNorm(albumCore(r)));
const isReissue = (r) => REISSUE.test(basicNorm(r.collectionName ?? ''));
const yearOf = (r) => { const y = Number(String(r.releaseDate ?? '').slice(0, 4)); return y >= 1950 && !/^2000-01-01/.test(r.releaseDate ?? '') ? y : null; };

// One iTunes result for a candidate: null when the title differs, else the reasons it is not usable (none = ok).
function judge(c, r) {
  if (r.wrapperType !== 'track' || r.kind !== 'song' || !sameTitle(c.title, r.trackName ?? '')) return null;
  const why = [];
  const own = new Set(basicNorm([c.title, ...c.artists].join(' ')).split(' '));
  if (!credited(c.artists, r.artistName ?? '')) why.push(`credited to ${r.artistName}`);
  else if ((basicNorm(r.artistName).match(COVER_ARTIST) || []).some((w) => !own.has(w))) why.push(`credited to ${r.artistName}`);
  // A song from a Last.fm page or the India chart has only that artist's name to go on, so the credit has to name
  // them exactly: not "Nirvana Tributo Brasil", "Drake DeVille" or "Paul McCartney Experience"
  else if (!c.charts.length && !exactCredit(c.artists, r.artistName ?? '')) why.push(`credited to ${r.artistName}`);
  if (!r.previewUrl) why.push('no preview');
  const genre = r.primaryGenreName ?? '';
  if (INDIAN.test(genre) || (OTHER_LANGUAGE.test(genre) && !c.english)) why.push(`filed as ${genre}`);
  if ((r.trackTimeMillis ?? 0) < 60000) why.push('under a minute');
  for (const d of decorations(r.trackName)) if (versionWords(d, own).length) why.push(`version (${d})`);
  const av = (basicNorm(albumCore(r)).match(ALBUM_VERSION) || []).filter((w) => w && !own.has(w));
  if (av.length && !why.some((w) => w.startsWith('version'))) why.push(`album "${r.collectionName}"`);
  return { r, why };
}

// iTunes title without the parts that don't name the song: "Uptown Funk (feat. Bruno Mars)" -> "Uptown Funk",
// but "(Everything I Do) I Do It for You" keeps its brackets. Square brackets never name the song on iTunes
// ("[feat. X]", "[The Official 2010 FIFA World Cup (TM) Song]").
function cleanTitle(t) {
  const noise = (d) => FINE.test(basicNorm(d)) || versionWords(d, new Set()).length > 0;
  return String(t).replace(/\s*\[(?:[^\][]|\[[^\]]*\])*\]/g, '').replace(/\s+[-–—]\s+(.+)$/, (m, d) => (noise(d) ? '' : m))
    .replace(/\s*[([]([^)\]]*)[)\]]/g, (m, d) => (noise(d) ? '' : m)).replace(/\s+/g, ' ').trim();
}
const EDITION = /\s*[([][^)\]]*\b(deluxe|expanded|remaster(ed)?|anniversary|special|bonus|edition|reissue|explicit|clean|version)\b[^)\]]*[)\]]/gi;

// Credit -> singers. Separators split it, except inside a name some list knows whole ("Hootie & the Blowfish").
const nameKey = (s) => basicNorm(s).replace(/\b(and|the)\b/g, '').replace(/\s+/g, '');
let knownNames = new Set();
function singersOf(credit) {
  const parts = String(credit).split(/(\s*,\s*|\s+(?:feat\.?|ft\.?|featuring|with|x|&|and|\+|vs\.?)\s+)/i);
  const out = [];
  for (let i = 0; i < parts.length; i += 2) {
    let name = parts[i];
    for (let j = i + 2; j < parts.length; j += 2) {
      const longer = parts.slice(i, j + 1).join('');
      if (knownNames.has(nameKey(longer))) { name = longer; i = j; }
    }
    name = name.trim();
    if (name) out.push(name);
  }
  return out;
}

// ---------------------------------------------------------------- run
const t0 = Date.now();
const charts = [];
for (let y = FROM; y <= Math.min(TO, LAST_CHART); y++) {
  const rows = await billboard(y);
  if (rows.length < 95) console.log(`  [warn] ${y}: ${rows.length} Billboard rows`);
  charts.push(...rows);
}
console.log(`Billboard ${FROM}-${Math.min(TO, LAST_CHART)}: ${charts.length} chart entries`);

// One candidate per song: the same title by the same artist across chart years, or on an artist's Last.fm page.
const cands = [];
const byKey = new Map();
const findCand = (title, artists) => (byKey.get(titleKey(title)) ?? []).find((c) => artists.some((a) => credited(c.artists, a)) || c.artists.some((a) => credited(artists, a)));
for (const e of charts) {
  const c = findCand(e.title, e.artists);
  if (c) { c.charts.push(e.year); c.rank = Math.min(c.rank, e.rank); continue; }
  const n = { title: e.title, artists: e.artists, year: e.year, rank: e.rank, wiki: e.wiki, charts: [e.year], listeners: 0, source: 'billboard' };
  cands.push(n);
  byKey.set(titleKey(e.title), [...(byKey.get(titleKey(e.title)) ?? []), n]);
}
const fromCharts = cands.length;
const langs = await languagesOf(cands.filter((c) => c.wiki).map((c) => c.wiki));
const sungIn = (c) => SUNG_IN_ENGLISH.has(`${c.title}|${c.artists[0]}`);
const languageOf = (c) => {
  const l = c.wiki ? langs.get(c.wiki) : null;
  return l?.size && !l.has('English') && !l.has('Spanglish') && !sungIn(c) ? [...l].join(', ') : null;
};

// Songs from Last.fm: artist pages, then the India chart. A song already a candidate gains the page's listeners, its
// rank on the page (pageRank, for offChartTier below) and, from a listed artist's page, artistRank (knownTier below).
const added = { listed: 0, charted: 0, india: 0 };
function addCand(t, via, artist) {
  const c = findCand(t.title, t.artists);
  if (c) {
    Object.assign(c, { listeners: Math.max(c.listeners, t.listeners ?? 0), artistOf: c.artistOf ?? artist });
    if (t.artistRank) c.pageRank = Math.min(c.pageRank ?? Infinity, t.artistRank);
    if (via === 'listed') c.artistRank = Math.min(c.artistRank ?? Infinity, t.artistRank);
    if (via !== 'india' && c.source === 'billboard') c.source = 'both';
    return;
  }
  const n = { title: t.title, artists: t.artists, year: null, rank: null, wiki: null, charts: [], listeners: t.listeners ?? 0,
    source: via === 'india' ? 'india' : 'lastfm', artistRank: via === 'listed' ? t.artistRank : undefined, pageRank: t.artistRank, artistOf: artist };
  cands.push(n);
  byKey.set(titleKey(t.title), [...(byKey.get(titleKey(t.title)) ?? []), n]);
  added[via]++;
}
const elsewhere = new Set([...OTHER_TONGUE, ...SHARED_PAGE].map(nameKey));
for (const a of ARTISTS) for (const t of await topTracks(a)) addCand(t, 'listed', a);
// Everyone else who leads two or more English chart songs, as Billboard names them
const listedKeys = new Set(ARTISTS.map(nameKey));
const leads = Map.groupBy(cands.filter((c) => c.charts.length && !languageOf(c)), (c) => c.artists[0]);
const charted = [...leads].filter(([a, cs]) => a && cs.length >= 2 && !listedKeys.has(nameKey(a)) && !elsewhere.has(nameKey(a))).map(([a]) => a);
for (const a of charted) for (const t of await topTracks(a, PER_CHARTED, MIN_CHARTED)) addCand(t, 'charted', a);
// Last.fm's India chart: the 10,000 tracks people in India played most last week. It mixes Hindi, Punjabi, Korean and
// English, so only songs by an artist above (listed, or leading an English chart song) count, PER_INDIA each at most.
const indiaChart = [];
for (let page = 1, rank = 0; page <= 200; page++) {
  const b = await lastfm({ method: 'geo.gettoptracks', country: 'India', limit: '50', page: String(page) }, { offline });
  const tracks = b?.tracks?.track ?? [];
  if (!tracks.length) break;
  for (const t of tracks) indiaChart.push({ name: t.name, artist: t.artist?.name ?? '', rank: ++rank });
}
const englishArtists = new Map([...ARTISTS, ...leads.keys()].filter(Boolean).map((a) => [nameKey(a), a]));
const perIndia = new Map();
for (const t of indiaChart) {
  const artist = englishArtists.get(nameKey(t.artist));
  if (!artist || elsewhere.has(nameKey(artist)) || (perIndia.get(artist) ?? 0) >= PER_INDIA) continue;
  const title = cleanTitle(stripDecorations(t.name) || t.name);
  if (!/[a-z0-9]/i.test(title) || /^(intro|outro|interlude|skit|untitled)$/i.test(title) || STANDARD.test(basicNorm(title))) continue;
  perIndia.set(artist, (perIndia.get(artist) ?? 0) + 1);
  addCand({ title, artists: [artist] }, 'india', artist);
}
knownNames = new Set([...ARTISTS, ...cands.flatMap((c) => c.artists)].map(nameKey));
for (const c of cands) {
  const l = c.wiki ? langs.get(c.wiki) : null;
  c.language = languageOf(c);
  c.english = sungIn(c) || !!l?.has('English'); // then a K-Pop or Latin genre on iTunes doesn't count against it
  c.skip = skipOf(c.title, c.artists[0]);
}
const foreign = cands.filter((c) => c.language);
const skipped = cands.filter((c) => c.skip && !c.language);
console.log(`  ${foreign.length} charted songs are sung in another language (Wikipedia)`);
if (plan) for (const c of foreign) console.log(`    ${c.title} | ${c.artists.join(', ')} | ${c.year} | ${c.language}`);

const ENGLISH = join(DATA, 'english.json');
const removed = []; // songs already in the file that SKIP now leaves out
const prev = (add ? readJson(ENGLISH) : []).filter((s) => { const why = skipOf(s.title, s.singers[0]); if (why) removed.push({ s, why }); return !why; });
let todo = cands.filter((c) => !c.language && !c.skip);
const prevByTitle = Map.groupBy(prev, (s) => titleKey(s.title));
if (add) todo = cands.filter((c) => !c.language && !c.skip && !(prevByTitle.get(titleKey(c.title)) ?? []).some((s) => credited(s.singers, c.artists[0])));
console.log(`  ${cands.length} candidate songs: ${fromCharts} from the charts, then ${added.listed} from ${ARTISTS.length} listed artists' `
  + `Last.fm pages, ${added.charted} from ${charted.length} more charted artists' pages, ${added.india} from the India chart`
  + `${add ? `; ${todo.length} not already in data/english.json` : ''}`);
if (plan) {
  const perYear = Map.groupBy(charts, (e) => e.year);
  console.log(`  per chart year: ${[...perYear].map(([y, es]) => `${y} ${es.length}`).join(', ')}`);
  for (const a of ARTISTS) {
    const mine = cands.filter((c) => c.source !== 'billboard' && c.artists.includes(a));
    console.log(`  ${a}: ${mine.length} (${mine.slice(0, 6).map((c) => `${c.title} ${c.listeners}${c.source === 'both' ? '*' : ''}`).join(' | ')})`);
  }
  process.exit(0);
}
// --debug "<title>": match only candidates with that title and print every iTunes copy considered
const debug = opt('--debug');
if (debug) todo = todo.filter((c) => titleKey(c.title) === titleKey(debug));
todo = todo.slice(0, limit);
const partial = limit < Infinity || !!debug;

const artistUrl = (artist) => `https://itunes.apple.com/search?${new URLSearchParams({ term: artist, country: 'in', media: 'music', entity: 'song', limit: '200' })}`;
// A lookup that still fails after itunesJson's retries (the connection dropped) would make its song look missing
// from iTunes, so the run then writes nothing: replies so far are cached, and running again picks up where it failed.
// --cached: iTunes replies from the cache only, for when Apple is refusing requests. A song whose answer needs a lookup
// not cached yet waits for a later run (with --add it is still missing from data/english.json, so it comes up again);
// every other song gets the answer it would get online, since lookups stop at the first good copy.
const cachedOnly = args.includes('--cached');
const accepted = [], rejected = [], unreachable = [], waiting = [];
for (const [i, c] of todo.entries()) {
  const seen = new Map(); // trackId -> judged
  let wait = false;
  const look = async (url) => {
    if (wait || (cachedOnly && !isCached(url) && (wait = true))) return;
    let body = null;
    try { body = await itunesJson(url, { offline }); } catch (e) { console.log(`  [skip] ${e.message}`); if (!offline) unreachable.push(url); }
    for (const [rank, r] of (body?.results ?? []).entries()) {
      const j = judge(c, r);
      if (j && !seen.has(r.trackId)) seen.set(r.trackId, { ...j, rank: seen.size + rank });
    }
  };
  const ok = () => [...seen.values()].filter((j) => !j.why.length);
  const bare = stripDecorations(c.title) || c.title;
  await look(searchUrl(`${bare} ${c.artists[0]}`));
  if (!ok().length) await look(artistUrl(c.artists[0]));
  if (!ok().length) await look(searchUrl(bare));
  const judged = [...seen.values()];
  const good = ok();
  if (debug) for (const j of judged) console.log(`    ${j.why.length ? 'x' : 'ok'} ${j.r.releaseDate?.slice(0, 10)} ${j.r.trackName} | ${j.r.artistName} | ${j.r.collectionName} | ${j.r.trackExplicitness} | ${j.r.primaryGenreName}${j.why.length ? ` :: ${j.why.join('; ')}` : ''}`);
  if (wait) waiting.push(c);
  else if (!good.length) {
    const near = judged.filter((j) => !j.why.some((w) => w.startsWith('credited')));
    const pick = (near.length ? near : judged)[0];
    rejected.push({ c, why: pick ? pick.why.join('; ') : 'no iTunes track with this title', near: pick?.r ?? null });
  } else {
    // A chart title that names a remix ("Cheerleader (Felix Jaehn Remix)") wants that remix, the one that charted.
    const named = decorations(c.title).filter((d) => versionWords(d, new Set()).length).map(basicNorm);
    const asCharted = (r) => named.every((d) => basicNorm(r.trackName).includes(d));
    const date = (r) => (yearOf(r) ? String(r.releaseDate).slice(0, 10) : '9999');
    const cleanEdit = (r) => r.trackExplicitness === 'cleaned';
    // A credit naming someone the chart doesn't is a later remake: Tony Bennett's 1953 "Rags to Riches" against his
    // 2006 duet with Elton John, which is not a compilation and so would otherwise win.
    const remake = (r) => splitArtists(r.artistName).some((n) => !credited(c.artists, n));
    good.sort((a, b) => asCharted(b.r) - asCharted(a.r) || remake(a.r) - remake(b.r) || isCompilation(a.r) - isCompilation(b.r) || isReissue(a.r) - isReissue(b.r)
      || cleanEdit(a.r) - cleanEdit(b.r) || date(a.r).localeCompare(date(b.r)) || a.rank - b.rank);
    // the year: the earliest copy of the recording itself (versions carry their own dates, some of them wrong)
    const years = good.map((j) => yearOf(j.r)).filter(Boolean);
    const firstCopy = years.length ? Math.min(...years) : null;
    accepted.push({ c, r: good[0].r, firstCopy, copies: good.length });
  }
  if ((i + 1) % 25 === 0 || i === todo.length - 1) {
    const rate = (Date.now() - t0) / (i + 1);
    console.log(`  ${i + 1}/${todo.length}  matched ${accepted.length}  rejected ${rejected.length} | iTunes calls ${net.calls} cached ${net.cacheHits} 429s ${net.throttled} | ${throttleInterval()} ms/call | eta ${Math.round((rate * (todo.length - i - 1)) / 60000)} min`);
  }
}

// ---------------------------------------------------------------- release years (Wikipedia)
// iTunes dates are often wrong: every copy of Teddy Swims's "Lose Control" says 2005, J-Kwon's "Tipsy" says 1 January
// 1990, and a song only on a compilation carries the compilation's date. A song's Wikipedia infobox says when it came
// out. Charted songs link their article; for the others it is looked up by name ("<title> (<artist> song)", then
// "<title> (song)", then "<title>"). An infobox counts only when it names the artist: a charted cover links the
// original's article (Rascal Flatts's "Life Is a Highway" -> Tom Cochrane's, 1991). A song's name can redirect to its
// album ("Lovers Rock (TV Girl song)" -> "French Exit"), whose release year then stands in.
async function infoboxes(titles) {
  const out = new Map(); // title as asked -> { page, boxes: [{ kind, released, artist }] }
  const unique = [...new Set(titles)];
  for (let i = 0; i < unique.length; i += 50) {
    const batch = unique.slice(i, i + 50);
    const b = await wiki({ action: 'query', prop: 'revisions', rvprop: 'content', rvslots: 'main', rvsection: '0', redirects: '1',
      titles: batch.join('|') }, { offline });
    const q = b?.query ?? {};
    const to = new Map([...(q.normalized ?? []), ...(q.redirects ?? [])].map((n) => [n.from, n.to]));
    const final = (t) => { let x = t; for (let k = 0; k < 3 && to.has(x); k++) x = to.get(x); return x; };
    const pages = new Map((q.pages ?? []).filter((p) => !p.missing).map((p) => [p.title, p.revisions?.[0]?.slots?.main?.content ?? '']));
    for (const t of batch) {
      const page = final(t), text = pages.get(page) ?? '';
      const boxes = text.split(/\{\{\s*Infobox (?=song|single|album)/i).slice(1).map((block) => {
        const field = (name) => block.match(new RegExp(`\\|\\s*${name}\\s*=([\\s\\S]*?)\\n\\s*(\\||\\}\\})`, 'i'))?.[1] ?? '';
        const released = Number(field('released').match(/\b(19[5-9]\d|20[0-2]\d)\b/)?.[1]) || null;
        return { kind: block.match(/^\w+/)[0].toLowerCase(), released, artist: shown(parseCell(field('artist'))) };
      });
      if (boxes.length) out.set(t, { page, boxes });
    }
  }
  return out;
}
const articlesFor = (c) => {
  const bare = stripDecorations(c.title) || c.title;
  return c.wiki ? [c.wiki] : [`${bare} (${c.artists[0]} song)`, `${bare} (song)`, bare];
};
console.log(`\nReading release years from Wikipedia for ${accepted.length} songs...`);
const boxes = await infoboxes(accepted.flatMap(({ c }) => articlesFor(c)));
for (const a of accepted) {
  const found = articlesFor(a.c).map((t) => boxes.get(t)).filter(Boolean)
    .map((p) => ({ page: p.page, box: p.boxes.find((b) => credited(a.c.artists, b.artist)) })).find((p) => p.box);
  a.wikiYear = found?.box.released ?? null;
  if (!a.c.wiki && found && found.box.kind !== 'album') a.c.wiki = found.page;
}

// The year: Wikipedia's, when it is no later than the chart year. Without it, a charted song takes the earliest
// copy on iTunes if that is at most two years before the chart (released late, charted the next year), else the chart
// year; any other song takes its earliest iTunes copy.
function releaseYear({ c, r, firstCopy, wikiYear }) {
  if (wikiYear && (!c.year || wikiYear <= c.year)) return { year: wikiYear, from: 'wikipedia' };
  if (c.year) return firstCopy && firstCopy >= c.year - 2 && firstCopy <= c.year ? { year: firstCopy, from: 'itunes' } : { year: c.year, from: 'chart' };
  const y = firstCopy ?? yearOf(r);
  return y ? { year: y, from: 'itunes' } : { year: null, from: null };
}

// ---------------------------------------------------------------- records
const indian = ['catalog.json', 'expanded.json', 'punjabi.json'].flatMap((f) => (existsSync(join(DATA, f)) ? readJson(join(DATA, f)) : []));
const indianTracks = new Set(indian.map((s) => s.trackId));
const ids = new Set([...indian, ...prev].map((s) => s.id));
const songs = [], dupes = [], later = [];
for (const a of accepted) {
  const { c, r, copies } = a;
  const drop = (why) => dupes.push({ c, r, why });
  if (indianTracks.has(r.trackId)) { drop('same iTunes track in the Hindi or Punjabi catalog'); continue; }
  const title = c.charts.length ? c.title : cleanTitle(r.trackName);
  const singers = singersOf(r.artistName);
  const { year, from: yearFrom } = releaseYear(a);
  if (!year) { drop('no release date anywhere'); continue; }
  if (year < FROM || year > TO) { later.push({ c, r, year }); continue; }
  const twin = [...prev, ...songs].find((s) => s.trackId === r.trackId || (titleKey(s.title) === titleKey(title) && credited(s.singers, r.artistName)));
  if (twin) { drop(`same song as ${twin.id}`); continue; }
  let id = `en-${slugify(title)}-${slugify(singers[0] ?? c.artists[0])}`;
  if (ids.has(id)) id += `-${year}`;
  if (ids.has(id)) { drop(`id ${id} taken`); continue; }
  ids.add(id);
  // A song found only on a compilation ("Hits of 2009") names no album of its own: the album is left blank.
  const album = isCompilation(r) ? '' : albumCore(r).replace(EDITION, '').trim();
  const single = /-\s*single\s*$/i.test(r.collectionName ?? '') || sameTitle(album, title);
  const alt = [...new Set([stripDecorations(title), cleanTitle(r.trackName)])].filter((t) => t && basicNorm(t) !== basicNorm(title));
  songs.push({
    id, title, alt_titles: alt, movie: single ? '' : album, year, singers, composers: [], tags: ['english', 'non-film'], tier: 4,
    trackId: r.trackId, preview: r.previewUrl, artwork: artwork600(r.artworkUrl100),
    appleUrl: r.trackViewUrl?.replace(/[?&]uo=\d+/, '') ?? null, durationMs: r.trackTimeMillis ?? null, confidence: 'auto',
    genre: r.primaryGenreName ?? null, wiki: c.wiki,
    _: { c, r, album: r.collectionName, itunesYear: yearOf(r), wikiYear: a.wikiYear, yearFrom, comp: isCompilation(r), copies,
      fuzzy: titleKey(r.trackName) !== titleKey(c.title) },
  });
}

// Listeners: track.search summed over the credited artists (scripts/lastfm.mjs), or the artist's own track page when higher.
// Four lookups at a time, as in scripts/popularity.mjs: scripts/lastfm.mjs still spaces their starts 250 ms apart.
console.log(`\nLooking up listeners for ${songs.length} songs...`);
let looked = 0;
const queue = [...songs];
await Promise.all(Array.from({ length: 4 }, async () => {
  for (let s; (s = queue.shift());) {
    const found = await listenersFor({ title: s.title, alt_titles: s.alt_titles, singers: [...s.singers, ...s._.c.artists], composers: [] }, { offline });
    s._.listeners = Math.max(found ?? 0, s._.c.listeners);
    if (++looked % 250 === 0) console.log(`  ${looked}/${songs.length} | Last.fm calls ${lastfmStats.calls} cached ${lastfmStats.cached}`);
  }
}));

// Each song's best rank on Last.fm's India chart (read with the candidates)
const india = new Map(); // titleKey -> [{ artist, rank }]
for (const t of indiaChart) {
  const k = titleKey(t.name);
  india.set(k, [...(india.get(k) ?? []), { artist: t.artist, rank: t.rank }]);
}
for (const s of songs) {
  const hits = [s.title, ...s.alt_titles].flatMap((t) => india.get(titleKey(t)) ?? []).filter((h) => credited([...s.singers, ...s._.c.artists], h.artist));
  s._.india = hits.length ? Math.min(...hits.map((h) => h.rank)) : null;
}

// Tiers: hand-tagged songs set each decade's cut points and keep their own tier. With --add, the hand-tagged songs
// already in data/english.json count too (their listeners looked up again, from the cache), so a new song from any
// decade is measured on the same scale as the songs already there.
const anchors = readJson(join(DATA, 'english-tiers.json'));
const anchored = [], unanchored = [], calibration = [];
for (const a of anchors) {
  const s = [...songs, ...prev].find((x) => [x.title, ...x.alt_titles].some((t) => titleKey(t) === titleKey(a.title)) && credited([a.artist], x.singers.join(', ')));
  if (!s) { unanchored.push(a); continue; }
  anchored.push(s);
  if (s._) { s._.anchor = a.tier; calibration.push({ year: s.year, tier: a.tier, listeners: s._.listeners }); continue; }
  const listeners = await listenersFor({ title: s.title, alt_titles: s.alt_titles, singers: s.singers, composers: [] }, { offline });
  calibration.push({ year: s.year, tier: a.tier, listeners: listeners ?? 0 });
  s.tier = a.tier; // a song already in the file takes a hand tag added or changed since
}
const cuts = cutsByDecade(calibration);
// Easy is "everyone knows it". A decade whose hand-tagged songs include none (the 1950s: even Elvis's hits are Medium
// for players in India) gets no Easy songs, rather than the cut point tiers.mjs would borrow from other decades.
const easyDecades = new Set(calibration.filter((x) => x.tier === 1).map((x) => decadeOf(x.year)));
// Last.fm's India chart makes a song easier: in its top 1,000, one level easier and at most Medium; in the next 2,000,
// one level easier but never Easy. Further down (a few hundred plays a week) it says too little.
const indiaTier = (tier, rank) => (rank == null || rank > 3000 ? tier : rank <= 1000 ? Math.min(Math.max(1, tier - 1), 2) : tier > 2 ? tier - 1 : tier);
// ARTISTS are singers and bands Indian listeners know well, so their best-known songs are no deep cuts even when few
// Last.fm listeners (mostly Western, and mostly young in India) play them, as with Westlife or Ronan Keating: an artist's
// top three on Last.fm are at most Medium, the next five at most Hard.
const knownTier = (tier, rank) => (rank <= 3 ? Math.min(tier, 2) : rank <= 8 ? Math.min(tier, 3) : tier);
// Last.fm counts album tracks of bands its own listeners love (Radiohead, Nirvana, the Beatles) far above what players
// in India know. A song on neither Billboard's year-end chart nor India's top 1,000 keeps its tier by listeners only as
// one of the top three on its artist's page ("Purple Rain", "Don't Speak"); down to tenth it is at best Medium, and
// further down at best Hard.
const offChartTier = (tier, c, india) => (c.charts.length || (india != null && india <= 1000) ? tier
  : (c.pageRank ?? Infinity) <= 3 ? tier : (c.pageRank ?? Infinity) <= 10 ? Math.max(tier, 2) : Math.max(tier, 3));
for (const s of songs) {
  s._.byListeners = cuts.size ? tierFor(cuts, s.year, s._.listeners) : 4; // a partial run may hold no hand-tagged song
  s.tier = s._.anchor ?? knownTier(offChartTier(indiaTier(s._.byListeners, s._.india), s._.c, s._.india), s._.c.artistRank ?? Infinity);
  if (!s._.anchor && s.tier === 1 && !easyDecades.has(decadeOf(s.year))) s.tier = 2;
}
// Christmas album tracks that never charted ("Mele Kalikimaka", "Here We Come a-Caroling") stay out unless they are
// among the best known; Christmas hits come in through the charts.
for (let i = songs.length - 1; i >= 0; i--) {
  const s = songs[i];
  if (s._.anchor || s._.c.charts.length || !/^christmas/i.test(s.genre ?? '') || s.tier <= 2) continue;
  dupes.push({ c: s._.c, r: s._.r, why: 'a Christmas album track that never charted' });
  ids.delete(s.id);
  songs.splice(i, 1);
}

// ---------------------------------------------------------------- report
songs.sort((a, b) => a.year - b.year || a.id.localeCompare(b.id));
const count = (xs, f) => Object.fromEntries([...Map.groupBy(xs, f)].sort(([a], [b]) => String(a).localeCompare(String(b))).map(([k, v]) => [k, v.length]));
const perDecade = count(songs, (s) => decadeOf(s.year)), perTier = count(songs, (s) => s.tier);
const perSource = count(songs, (s) => s._.c.source);
const genres = Object.entries(count(songs, (s) => s.genre)).sort((a, b) => b[1] - a[1]);
const byListeners = [...songs].sort((a, b) => b._.listeners - a._.listeners);
const esc = (s) => String(s ?? '').replace(/\|/g, '\\|');
const tierCell = (s) => `${s.tier}${s._.anchor ? ' (hand)' : s.tier !== s._.byListeners ? ` (${s._.byListeners} by listeners)` : ''}`;
const row = (s) => `| ${esc(s.title)} | ${esc(s.singers.join(', '))} | ${esc(s.movie || '(single)')} | ${s.year} | ${tierCell(s)} | ${s._.listeners} | ${s._.india ?? ''} | ${esc(s.genre)} |`;
const dubious = songs.filter((s) => s._.fuzzy || (s._.comp && s._.yearFrom === 'itunes') || (s._.c.year && s._.c.year - s.year > 2));
const yearsFrom = count(songs, (s) => s._.yearFrom);
const cross = [1, 2, 3, 4].map((t) => `| ${t} | ${[1, 2, 3, 4].map((u) => songs.filter((s) => !s._.anchor && s._.byListeners === t && s.tier === u).length).join(' | ')} |`);

if (partial) {
  for (const s of byListeners) console.log(`  + ${s.title} | ${s.singers.join(', ')} | ${s.movie || '(single)'} | ${s.year} | tier ${tierCell(s)} | ${s._.listeners} | india ${s._.india ?? '-'} | ${s.genre} | ${s._.album}`);
  for (const { c, r, year } of later) console.log(`  > ${c.title} | ${c.artists[0]} -> ${year} (${r.collectionName})`);
  for (const { c, r, why } of dupes) console.log(`  = ${c.title} | ${c.artists[0]} -> ${r.trackName} (${r.collectionName}): ${why}`);
  for (const { c, why, near } of rejected) console.log(`  - ${c.title} | ${c.artists.join(', ')} | ${c.year ?? c.listeners}: ${why}${near ? ` [${near.trackName} / ${near.artistName} / ${near.collectionName} / ${near.primaryGenreName}]` : ''}`);
  console.log('\nPartial run: data/english.json not written.');
}
else if (unreachable.length) {
  console.log(`\n${unreachable.length} iTunes lookups failed (no connection?), so nothing was written. Run the same command again:`
    + ' everything that worked is cached.');
  process.exitCode = 1;
}
else {
  writeJsonRows(ENGLISH, [...prev, ...songs.map(({ _, ...s }) => s)].sort((a, b) => a.year - b.year || a.id.localeCompare(b.id)));
  const md = [
    '# English songs report', '',
    `Generated by \`node --env-file=.env scripts/english.mjs ${args.join(' ')}\`.${add ? ` Added to the ${prev.length} songs already in data/english.json.` : ''} `
      + `${cands.length} candidates (${fromCharts} from Billboard's Year-End Hot 100, ${added.listed} from ${ARTISTS.length} listed artists' Last.fm pages, `
      + `${added.charted} from ${charted.length} more charted artists' pages, ${added.india} from Last.fm's India chart), `
      + `${accepted.length} matched on iTunes, ${songs.length} songs kept. ${later.length} matched songs fall outside ${FROM}–${TO} and are left for a later run, `
      + `${dupes.length} were duplicates, ${rejected.length} not matched${waiting.length ? `, ${waiting.length} waiting for iTunes lookups not cached yet (--cached)` : ''}.`, '',
    `Songs per decade: ${Object.entries(perDecade).map(([d, n]) => `${d} ${n}`).join(', ')}.`,
    `Songs per tier: ${Object.entries(perTier).map(([t, n]) => `tier ${t} ${n}`).join(', ')}.`,
    `Where they came from: ${Object.entries(perSource).map(([k, n]) => `${{ billboard: 'Billboard only', lastfm: 'artist pages only', both: 'both', india: 'India chart only' }[k]} ${n}`).join(', ')}.`,
    `Release years from: ${Object.entries(yearsFrom).map(([k, n]) => `${{ wikipedia: 'Wikipedia', chart: 'the chart year', itunes: 'iTunes' }[k]} ${n}`).join(', ')}.`,
    `On Last.fm's India chart: ${songs.filter((s) => s._.india).length} (top 1,000: ${songs.filter((s) => s._.india && s._.india <= 1000).length}).`,
    `iTunes genres: ${genres.map(([g, n]) => `${g} ${n}`).join(', ')}.`, '',
    `## Difficulty`, '',
    `${anchored.length} of the ${anchors.length} hand-tagged songs in data/english-tiers.json were found and set the cut points per decade `
      + `(listeners, log scale): ${[...cuts].sort(([a], [b]) => a.localeCompare(b)).map(([d, c]) => `${d} ${c.map((x) => Math.round(Math.expm1(x))).join(' / ')}`).join('; ')}.`, '',
    unanchored.length ? `Not found: ${unanchored.map((a) => `${a.title} (${a.artist})`).join(', ')}.` : 'All of them were found.', '',
    'Tier by listeners (rows) against the tier after the India chart (columns), hand-tagged songs left out:', '',
    '| by listeners | 1 | 2 | 3 | 4 |', '|---|---|---|---|---|', ...cross, '',
    '## Best-known songs', '', '| title | singers | album | year | tier | listeners | India rank | genre |', '|---|---|---|---|---|---|---|---|',
    ...byListeners.slice(0, 80).map(row), '',
    '## Made easier by the India chart or a listed artist', '',
    'Easier than listeners alone make them: high on Last.fm\'s India chart, or among the best-known songs of an artist on the list.', '',
    '| title | singers | album | year | tier | listeners | India rank | genre | artist rank |', '|---|---|---|---|---|---|---|---|---|',
    ...songs.filter((s) => !s._.anchor && s.tier < s._.byListeners).sort((a, b) => (a._.india ?? 1e9) - (b._.india ?? 1e9) || a._.c.artistRank - b._.c.artistRank)
      .map((s) => `${row(s)} ${s._.c.artistRank <= 8 ? `${s._.c.artistRank} for ${esc(s._.c.artistOf)}` : ''} |`), '',
    `## Worth a look (${dubious.length})`, '',
    'Fuzzy title matches, years that only a compilation on iTunes gives, and songs that came out well before they charted.', '',
    '| title | singers | iTunes album | year | year from | chart year | why |', '|---|---|---|---|---|---|---|',
    ...dubious.map((s) => `| ${esc(s.title)} | ${esc(s.singers.join(', '))} | ${esc(s._.album)} | ${s.year} | ${s._.yearFrom} | ${s._.c.year ?? ''} | ${[
      s._.fuzzy && `candidate title "${esc(s._.c.title)}"`, s._.comp && s._.yearFrom === 'itunes' && 'compilation', s._.c.year && s._.c.year - s.year > 2 && 'charted later'].filter(Boolean).join('; ')} |`), '',
    `## Left for a later run (${later.length})`, '',
    `Per decade: ${Object.entries(count(later, (l) => decadeOf(l.year))).map(([d, n]) => `${d} ${n}`).join(', ')}.`, '',
    `## Sung in another language (${foreign.length})`, '',
    'Left out before matching: Wikipedia files these charted songs under other languages\' songs, not English.', '',
    '| title | artists | chart year | language |', '|---|---|---|---|',
    ...foreign.map((c) => `| ${esc(c.title)} | ${esc(c.artists.join(', '))} | ${c.year} | ${esc(c.language)} |`), '',
    `## Left out by hand (${skipped.length})`, '', 'The SKIP list in scripts/english.mjs.', '',
    ...skipped.map((c) => `- ${esc(c.title)} (${esc(c.artists[0])}): ${c.skip}`), '',
    ...(removed.length ? ['Taken out of data/english.json:', '', ...removed.map(({ s, why }) => `- ${esc(s.title)} (${esc(s.singers[0])}, ${s.id}): ${why}`), ''] : []),
    `## Dropped after matching (${dupes.length})`, '', '| candidate | artist | iTunes track | why |', '|---|---|---|---|',
    ...dupes.map(({ c, r, why }) => `| ${esc(c.title)} | ${esc(c.artists[0])} | ${esc(r.trackName)} (${esc(r.collectionName)}) | ${esc(why)} |`), '',
    `## Not matched (${rejected.length})`, '', '| candidate | artists | chart year or listeners | why | nearest iTunes track |', '|---|---|---|---|---|',
    ...rejected.map(({ c, why, near }) => `| ${esc(c.title)} | ${esc(c.artists.join(', '))} | ${c.year ?? c.listeners} | ${esc(why)} | ${near ? `${esc(near.trackName)} / ${esc(near.artistName)} / ${esc(near.collectionName)} / ${esc(near.primaryGenreName)}` : ''} |`), '',
  ].join('\n');
  writeFileSync(join(DATA, add ? 'english-add-report.md' : 'english-report.md'), md);
}
console.log(`\nDone in ${Math.round((Date.now() - t0) / 1000)}s: ${todo.length} candidates, ${accepted.length} matched, ${songs.length} kept `
  + `(${later.length} outside ${FROM}-${TO}, ${dupes.length} duplicates, ${rejected.length} not matched, ${waiting.length} waiting for iTunes). Decades ${JSON.stringify(perDecade)}, `
  + `tiers ${JSON.stringify(perTier)}. iTunes ${net.calls} calls, ${net.cacheHits} cached, ${net.throttled} throttled; `
  + `Last.fm ${lastfmStats.calls} calls, ${lastfmStats.cached} cached.`);

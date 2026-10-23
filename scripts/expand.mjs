// Grow the catalog past the curated seed: node scripts/expand.mjs [--plan] [--offline] [--fresh] [--years 1990-1999] [--films N]
//   1. Wikipedia "List of Hindi films of <year>" pages give each year's films and their article titles.
//   2. Wikipedia pageviews (last 60 days) rank them; the most-read films of each year are kept.
//   3. Each film's soundtrack album is found on iTunes: same name, closest release year, never a dialogue,
//      jhankar, remix or dubbed edition. Album tracks come back eight albums per lookup.
//   4. Versions, interludes and dialogue tracks are dropped, as is anything already in data/catalog.json.
// Writes data/expanded.json and data/expand-report.md. Run scripts/resolve.mjs first so its songs win.
// Tiers follow the film's pageviews within its decade: top 15% of films -> 2, next 35% -> 3, the rest -> 4.
// --plan stops after choosing the films (Wikipedia only, no iTunes calls) and prints them per decade.
import { createHash } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DATA, net, sleep, readJson, writeJson, writeJsonRows, itunesJson, slugify, skeleton, basicNorm, stripDecorations, decorations,
  splitArtists, artwork600, decadeOf, throttleInterval,
} from './lib.mjs';

const args = process.argv.slice(2);
const opt = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const offline = args.includes('--offline'), fresh = args.includes('--fresh'), plan = args.includes('--plan');
const [fromYear, toYear] = (opt('--years') ?? `1950-${new Date().getFullYear()}`).split('-').map(Number);
const filmLimit = Number(opt('--films')) || Infinity;
const quota = (y) => (y < 1980 ? 12 : y < 2000 ? 15 : 18); // films kept per year, about 6,000 songs in all
const partial = opt('--years') || filmLimit < Infinity;

// ---------------------------------------------------------------- Wikipedia (cached on disk like the iTunes calls)
// Wikimedia allows 200 requests a minute to clients whose User-Agent carries contact details (10 without).
const UA = 'SurSpotCatalog/1.0 (https://github.com/Siddharth-Y26; Bollywood song game catalog builder) node-fetch';
const WIKI_CACHE = join(DATA, '.cache', 'wiki');
// One request at a time, at least 350 ms apart (about 170 a minute); a 429 waits out its Retry-After.
let lastWiki = 0;
async function wiki(params) {
  const url = 'https://en.wikipedia.org/w/api.php?' + new URLSearchParams({ format: 'json', formatversion: '2', ...params });
  const file = join(WIKI_CACHE, createHash('sha1').update(url).digest('hex').slice(0, 20) + '.json');
  if (!fresh && existsSync(file)) return readJson(file);
  if (offline) return null;
  let status = '';
  for (let attempt = 1; attempt <= 6; attempt++) {
    const wait = lastWiki + 350 - Date.now();
    if (wait > 0) await sleep(wait);
    lastWiki = Date.now();
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, 'Api-User-Agent': UA }, signal: AbortSignal.timeout(30000) });
      if (res.ok) { const body = await res.json(); writeJson(file, body); return body; }
      status = `HTTP ${res.status}`;
      await sleep(Math.max((Number(res.headers.get('retry-after')) || 0) * 1000, 2000 * attempt));
    } catch (e) {
      status = String(e.message ?? e);
      await sleep(2000 * attempt);
    }
  }
  throw new Error(`Wikipedia request failed (${status}): ${url}`);
}

// Film titles in the year lists are italic links: ''[[Target|Shown]]'' or [[Target|''Shown'']]
const NOT_FILM = /^(list of|file:|image:|category:|wikipedia:|template:)/i;
const filmName = (target) => target.replace(/\s*\((?:\d{4} )?(?:hindi |indian |bollywood )?film\)$/i, '').trim();
function filmsOnPage(text, year) {
  const out = [];
  for (const m of text.matchAll(/''\[\[([^\]|#]+)(?:\|([^\]]+))?\]\]''|\[\[([^\]|#]+)\|''([^'\]]+)''\]\]/g)) {
    const target = (m[1] ?? m[3]).trim(), shown = (m[2] ?? m[4] ?? '').replace(/''/g, '').trim();
    if (NOT_FILM.test(target)) continue;
    out.push({ target: target[0].toUpperCase() + target.slice(1), name: shown || filmName(target), year });
  }
  return out;
}

async function yearFilms() {
  const years = Array.from({ length: toYear - fromYear + 1 }, (_, i) => fromYear + i);
  const films = new Map();
  for (let i = 0; i < years.length; i += 20) {
    const batch = years.slice(i, i + 20);
    const res = await wiki({ action: 'query', prop: 'revisions', rvprop: 'content', rvslots: 'main', redirects: '1',
      titles: batch.map((y) => `List of Hindi films of ${y}`).join('|') });
    for (const p of res?.query?.pages ?? []) {
      const year = Number(p.title.match(/(\d{4})$/)?.[1]);
      const text = p.revisions?.[0]?.slots?.main?.content;
      if (!text) { console.log(`  no list page for ${year}`); continue; }
      for (const f of filmsOnPage(text, year)) if (!films.has(f.target)) films.set(f.target, f);
    }
  }
  return [...films.values()];
}

// prop=pageviews returns the last 60 days per page, a few pages per reply: follow `continue` until done.
// A film without its own article redirects into the year's list page and gets no views of its own.
async function addPageviews(films) {
  for (let i = 0; i < films.length; i += 50) {
    const batch = films.slice(i, i + 50);
    const alias = new Map(), views = new Map();
    let cont = {};
    for (let page = 0; page < 20; page++) {
      const res = await wiki({ action: 'query', prop: 'pageviews', redirects: '1', titles: batch.map((f) => f.target).join('|'), ...cont });
      for (const n of res?.query?.normalized ?? []) alias.set(n.from, n.to);
      for (const r of res?.query?.redirects ?? []) alias.set(r.from, r.to);
      for (const p of res?.query?.pages ?? []) if (p.pageviews) views.set(p.title, Object.values(p.pageviews).reduce((a, b) => a + (b ?? 0), 0));
      if (!res?.continue) break;
      cont = res.continue;
    }
    for (const f of batch) {
      let t = f.target;
      for (let k = 0; k < 3 && alias.has(t); k++) t = alias.get(t);
      f.page = t;
      f.views = /^list of /i.test(t) ? 0 : views.get(t) ?? 0;
    }
    if ((i / 50) % 20 === 19) console.log(`  pageviews ${Math.min(i + 50, films.length)}/${films.length}`);
  }
}

// Short descriptions ("2013 Indian film", "Capital of the Czech Republic") for the pages that have views.
async function addDescriptions(films) {
  const pages = [...new Set(films.filter((f) => f.views > 0).map((f) => f.page))];
  const desc = new Map();
  for (let i = 0; i < pages.length; i += 50) {
    let cont = {};
    for (let page = 0; page < 20; page++) {
      const res = await wiki({ action: 'query', prop: 'description', titles: pages.slice(i, i + 50).join('|'), ...cont });
      for (const p of res?.query?.pages ?? []) if (p.description) desc.set(p.title, p.description);
      if (!res?.continue) break;
      cont = res.continue;
    }
  }
  for (const f of films) f.desc = desc.get(f.page) ?? '';
}

// Year lists sometimes link a title to the city, deity or franchise it is named after; those pages are
// popular for reasons that have nothing to do with the film, so only film articles from the right year count.
function isFilmPage(f) {
  if (!f.desc) return /\bfilm\)$/i.test(f.page);
  if (!/\bfilm\b/i.test(f.desc) || /\b(series|show|franchise|soundtrack|album)\b/i.test(f.desc)) return false;
  const y = Number(f.desc.match(/\b(19[3-9]\d|20[0-3]\d)\b/)?.[1]);
  return !y || Math.abs(y - f.year) <= 1;
}

// ---------------------------------------------------------------- iTunes soundtrack albums
const BAD_EDITION = /\b(dialogues?|jhankar|remix(es|ed)?|karaoke|instrumentals?|lo ?fi|unplugged|reprise|covers?|tribute|slowed|reverb|mashups?|8d|sinhalese|tamil|telugu|malayalam|kannada|bengali|marathi|punjabi|bhojpuri|gujarati|dubbed|version|piano|flute|lullab\w*|score|background)\b/i;
const OST = /original motion picture soundtrack|motion picture soundtrack|original soundtrack|\bost\b|soundtrack/i;
// iTunes files Hindi film albums under these genres; anything else (a country album that shares the film's
// name, a Telugu dub) must at least call itself the film's soundtrack, and other-language genres never count.
const HINDI_GENRE = /^(bollywood|soundtrack|regional indian|indian pop|indian|devotional & spiritual)$/i;
const OTHER_LANGUAGE = /^(telugu|tamil|kannada|malayalam|bengali|gujarati|marathi|punjabi|punjabi pop|bhojpuri|haryanvi)$/i;
const albumSearchUrl = (term) =>
  `https://itunes.apple.com/search?${new URLSearchParams({ term, country: 'in', media: 'music', entity: 'album', limit: '25' })}`;
const albumTracksUrl = (ids) => `https://itunes.apple.com/lookup?id=${ids.join(',')}&entity=song&country=in&limit=200`;
const key = (s) => skeleton(s).join(' ');
const bracketless = (s) => String(s).replace(/\s*[(\[{][^)\]}]*[)\]}]/g, ' ').replace(/\s*-\s*(single|ep)\s*$/i, '').replace(/\s+/g, ' ').trim();

// Same name, not a special edition, released no earlier than the film. When two films share a name,
// the album must also be within two years of this one.
function pickAlbum(film, results, ambiguous) {
  const want = key(film.name);
  const cands = [];
  for (const r of results) {
    if (r.wrapperType !== 'collection' || !r.collectionId || (r.trackCount ?? 0) < 2) continue;
    const name = r.collectionName ?? '';
    if (key(bracketless(name)) !== want && key(stripDecorations(name)) !== want) continue;
    if (BAD_EDITION.test(decorations(name).join(' ')) || BAD_EDITION.test(name.replace(OST, ''))) continue;
    const genre = r.primaryGenreName ?? '';
    if (OTHER_LANGUAGE.test(genre) || (!HINDI_GENRE.test(genre) && !OST.test(name))) continue;
    const y = Number(String(r.releaseDate ?? '').slice(0, 4)) || null;
    const delta = y ? y - film.year : 0;
    if (y && delta < -1) continue;
    if (ambiguous && (!y || Math.abs(delta) > 2)) continue;
    const score = -Math.min(Math.abs(delta), 10) + (OST.test(name) ? 2 : 0) + Math.min(r.trackCount, 15) * 0.05
      - (/\s-\s*(single|ep)\s*$/i.test(name) ? 2 : 0) - (/various artists/i.test(r.artistName ?? '') ? 0.5 : 0);
    cands.push({ r, score });
  }
  cands.sort((a, b) => b.score - a.score);
  return cands[0]?.r ?? null;
}

// ---------------------------------------------------------------- tracks -> songs
const SKIP_ANYWHERE = /\b(dialogues?|theme|instrumental|interlude|score|bgm|promo|teaser|medley|karaoke|jhankar|mashup|ringtone|title music|mix|remix|reprise|soliloq\w*|version)\b/i;
const LATER_PART = /\b(pt\.?|part)\s*[2-9]\b/i; // "Yaadon Ki Baaraat, Pt. 2" continues part 1
const SKIP_DECOR = /\b(remix(ed)?|reprise|unplugged|lo ?fi|female|male|sad|happy|version|reloaded|club|dub|edit|extended|acoustic|live|slowed|reverb|mix|duet|solo)\b/i;
const OK_DECOR = /^(from\b|feat\b|featuring\b|ft\b|original|film version|title (track|song))/i;
const LYRICISTS = new Set(['anand bakshi', 'sameer', 'sameer anjaan', 'gulzar', 'javed akhtar', 'majrooh sultanpuri', 'sahir ludhianvi',
  'shailendra', 'hasrat jaipuri', 'indeevar', 'amitabh bhattacharya', 'irshad kamil', 'kumaar', 'manoj muntashir', 'prasoon joshi',
  'kausar munir', 'rashmi virag', 'neelesh misra', 'swanand kirkire', 'shakeel badayuni', 'rajendra krishan', 'kaifi azmi',
  'gulshan bawra', 'anjaan', 'rani malik', 'dev kohli', 'faaiz anwar', 'nida fazli', 'prem dhawan', 'bharat vyas', 'gopaldas neeraj',
  'neeraj', 'yogesh', 'qamar jalalabadi', 'jaideep sahni', 'mehboob', 'anwar sagar', 'shabbir ahmed', 'sayeed quadri', 'rahat indori',
  'vijay akela', 'junaid wasi', 'priya saraiya', 'raqueeb alam', 'shellee', 'kunaal vermaa', 'rashmi singh', 'varun grover',
  'shakeel azmi', 'a m turaz', 'siddharth garima', 'abhendra kumar upadhyay', 'rajesh johri', 's h bihari', 'raja mehdi ali khan',
  'jan nisar akhtar', 'verma malik', 'naqsh lyallpuri', 'santosh anand', 'maya govind', 'sudhakar sharma', 'nitin raikwar',
  'kumar', 'sahir', 'majrooh', 'hasrat', 'shakeel', 'kafeel azar', 'asad ajmeri', 'aziz qaisi', 'ravi basnet', 'arafat mehmood']);
const person = (n) => basicNorm(n).replace(/\b(mohd|md|mohammad|muhammad)\b/g, 'mohammed');

// The album credit names every composer (and on newer albums lyricists too); a song gets the ones its own
// credit names, else the album's when there are at most three, else none rather than a wrong list.
function songsFromAlbum(film, album, tracks) {
  const albumPeople = splitArtists(album.artistName).filter((a) => !/various artists/i.test(a) && !LYRICISTS.has(person(a)));
  const seen = new Set(), out = [];
  for (const t of tracks.sort((a, b) => (a.discNumber ?? 1) - (b.discNumber ?? 1) || (a.trackNumber ?? 0) - (b.trackNumber ?? 0))) {
    const raw = t.trackName ?? '';
    if (!t.previewUrl || (t.trackTimeMillis ?? 0) < 75000 || SKIP_ANYWHERE.test(raw) || LATER_PART.test(raw)) continue;
    if (decorations(raw).some((d) => !OK_DECOR.test(d) && SKIP_DECOR.test(d))) continue;
    const title = (stripDecorations(raw) || raw).replace(/,?\s*(pt\.?|part)\s*1$/i, '');
    const k = key(title);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    const credit = splitArtists(t.artistName).filter((a) => !LYRICISTS.has(person(a)));
    const onTrack = albumPeople.filter((c) => credit.some((a) => person(a) === person(c)));
    const composers = onTrack.length ? onTrack : albumPeople.length <= 3 ? albumPeople : [];
    // A credit naming only the composer means "sung by the composer" on newer albums, but on old reissues it
    // usually means the singers were never credited; those stay unknown rather than wrong.
    const singers = credit.filter((a) => !onTrack.some((c) => person(c) === person(a)));
    out.push({
      title, alt_titles: [], movie: film.name, year: film.year,
      singers: singers.length ? singers : film.year < 1980 ? [] : credit,
      composers, tags: [], tier: film.tier,
      trackId: t.trackId, preview: t.previewUrl, artwork: artwork600(t.artworkUrl100),
      appleUrl: t.trackViewUrl?.replace(/[?&]uo=\d+/, '') ?? null, durationMs: t.trackTimeMillis ?? null, confidence: 'auto',
    });
  }
  return out;
}

// ---------------------------------------------------------------- run
const t0 = Date.now();
console.log(`Reading Wikipedia film lists ${fromYear}-${toYear}...`);
const all = await yearFilms();
console.log(`  ${all.length} films listed; fetching pageviews...`);
await addPageviews(all);
await addDescriptions(all);

const nameCount = new Map();
for (const f of all) nameCount.set(key(f.name), (nameCount.get(key(f.name)) ?? 0) + 1);
const byYear = Map.groupBy(all.filter((f) => f.views > 0 && isFilmPage(f)), (f) => f.year);
let films = [...byYear].flatMap(([y, fs]) => fs.sort((a, b) => b.views - a.views).slice(0, quota(y)));

// film tier by pageviews rank within its decade
for (const fs of Map.groupBy(films, (f) => decadeOf(f.year)).values()) {
  fs.sort((a, b) => b.views - a.views).forEach((f, i) => { const q = i / fs.length; f.tier = q < 0.15 ? 2 : q < 0.5 ? 3 : 4; });
}
films.sort((a, b) => a.tier - b.tier || b.views - a.views);
films = films.slice(0, filmLimit);
console.log(`  keeping ${films.length} films`);
if (plan) {
  for (const [d, fs] of Map.groupBy(films, (f) => decadeOf(f.year))) console.log(`  ${d}: ${fs.length} films, e.g. ${fs.slice(0, 6).map((f) => `${f.name} (${f.year})`).join(', ')}`);
  process.exit(0);
}
console.log('  finding soundtracks on iTunes...');

const found = [], missing = [];
for (const [i, film] of films.entries()) {
  let body = null;
  try { body = await itunesJson(albumSearchUrl(film.name), { offline, fresh }); } catch (e) { missing.push({ film, why: e.message }); continue; }
  const album = pickAlbum(film, body?.results ?? [], (nameCount.get(key(film.name)) ?? 0) > 1);
  if (album) found.push({ film, album }); else missing.push({ film, why: body ? 'no matching soundtrack album' : 'not cached' });
  if ((i + 1) % 50 === 0 || i === films.length - 1) {
    const rate = (Date.now() - t0) / (i + 1);
    console.log(`  ${i + 1}/${films.length}  albums ${found.length}  missing ${missing.length}  | calls ${net.calls} cached ${net.cacheHits} 429s ${net.throttled} | ${throttleInterval()} ms/call | eta ${Math.round((rate * (films.length - i - 1)) / 60000)} min`);
  }
}

const seed = existsSync(join(DATA, 'catalog.json')) ? readJson(join(DATA, 'catalog.json')) : [];
const taken = new Set(seed.map((s) => s.trackId));
const takenKey = new Set(seed.map((s) => `${key(s.title)}|${key(s.movie)}`));
const ids = new Set(seed.map((s) => s.id));
const songs = [];
let dupes = 0;
for (let i = 0; i < found.length; i += 8) {
  const batch = found.slice(i, i + 8);
  const body = await itunesJson(albumTracksUrl(batch.map((b) => b.album.collectionId)), { offline, fresh }).catch(() => null);
  const tracks = Map.groupBy((body?.results ?? []).filter((r) => r.wrapperType === 'track' && r.kind === 'song'), (r) => r.collectionId);
  for (const { film, album } of batch) {
    for (const s of songsFromAlbum(film, album, tracks.get(album.collectionId) ?? [])) {
      if (taken.has(s.trackId) || takenKey.has(`${key(s.title)}|${key(s.movie)}`)) { dupes++; continue; }
      let id = `${slugify(s.title)}-${slugify(s.movie)}`;
      if (ids.has(id)) id += `-${s.year}`;
      if (ids.has(id)) { dupes++; continue; }
      ids.add(id); taken.add(s.trackId);
      songs.push({ id, ...s });
    }
  }
}

songs.sort((a, b) => a.year - b.year || a.id.localeCompare(b.id));
const perDecade = Object.fromEntries([...Map.groupBy(songs, (s) => decadeOf(s.year))].map(([d, xs]) => [d, xs.length]));
const perTier = Object.fromEntries([...Map.groupBy(songs, (s) => s.tier)].map(([t, xs]) => [t, xs.length]));
if (partial) console.log('\nPartial run: data/expanded.json not written.');
else {
  writeJsonRows(join(DATA, 'expanded.json'), songs);
  writeFileSync(join(DATA, 'expand-report.md'), [
    '# Catalog expansion report', '',
    `Generated by \`node scripts/expand.mjs\`. ${films.length} films kept from ${all.length} listed, ${found.length} soundtracks found, `
      + `${songs.length} new songs (${dupes} already in the catalog).`, '',
    `Songs per decade: ${Object.entries(perDecade).map(([d, n]) => `${d} ${n}`).join(', ')}.`,
    `Songs per tier: ${Object.entries(perTier).map(([t, n]) => `tier ${t} ${n}`).join(', ')}.`, '',
    `## Films without a soundtrack match (${missing.length})`, '', '| film | year | views (60 days) | why |', '|---|---|---|---|',
    ...missing.map(({ film, why }) => `| ${film.name} | ${film.year} | ${film.views} | ${why} |`), '',
  ].join('\n'));
}
console.log(`\nDone in ${Math.round((Date.now() - t0) / 1000)}s: ${found.length}/${films.length} soundtracks, ${songs.length} new songs `
  + `(${dupes} duplicates skipped). Decades ${JSON.stringify(perDecade)}, tiers ${JSON.stringify(perTier)}. `
  + `${net.calls} iTunes calls, ${net.cacheHits} cached, ${net.throttled} throttled.`);

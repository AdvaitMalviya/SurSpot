// Punjabi songs: node --env-file=.env scripts/punjabi.mjs [--plan] [--offline] [--limit N]
//   1. Artists: Last.fm's top artists for the "punjabi" tag (two pages) plus the current stars missing from it,
//      minus artists who mostly sing in Hindi or Urdu, or whose Last.fm page mixes in someone else.
//   2. Songs: each artist's Last.fm top tracks; the well-known ones (MIN_LISTENERS, at most PER_ARTIST each).
//   3. iTunes: "<title> <artist>" (then the artist's 200 top songs for titles spelled differently). A track counts
//      when the title matches (romanization-tolerant), the credit names the artist, it has a preview, it is not
//      filed as Bollywood (Hindi film songs are in the main catalog) and it is no remix, lofi, live or other version.
//      Of several copies the original release wins: not a compilation, then the earliest date.
//   4. Tiers: Last.fm listeners (track.search, the same count scripts/popularity.mjs uses) on the curated songs' scale.
// Drops anything already in data/catalog.json or data/expanded.json. Writes data/punjabi.json and data/punjabi-report.md.
// --plan stops after step 2 (Last.fm only) and prints the artists and candidates. --limit N looks up only the
// N best-known candidates and writes nothing.
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DATA, net, readJson, writeJsonRows, itunesJson, searchUrl, slugify, skeleton, basicNorm, stripDecorations, decorations,
  splitArtists, creditHits, fromTag, isCompilationName, lev, artwork600, decadeOf, throttleInterval,
} from './lib.mjs';
import { lastfm, lastfmStats, listenersFor } from './lastfm.mjs';
import { cutsByDecade, tierFor } from './tiers.mjs';

const args = process.argv.slice(2);
const opt = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const offline = args.includes('--offline'), plan = args.includes('--plan');
const limit = Number(opt('--limit')) || Infinity;
if (!process.env.LASTFM_API_KEY && !offline) {
  console.error('No Last.fm key. Put LASTFM_API_KEY=... in .env and run: node --env-file=.env scripts/punjabi.mjs');
  process.exit(1);
}

const MIN_LISTENERS = 1000; // Last.fm listeners of the artist's own track page
const PER_ARTIST = 20;
const SIGNATURE = { n: 2, min: 400 }; // an artist's two best-known songs count from 400 listeners (folk legends scrobble little)

// ---------------------------------------------------------------- artists
const STARS = [
  'Sidhu Moose Wala', 'Karan Aujla', 'AP Dhillon', 'Shubh', 'Diljit Dosanjh', 'Guru Randhawa', 'Ammy Virk', 'Harrdy Sandhu', 'B Praak',
  'Jassie Gill', 'Gurnam Bhullar', 'Babbu Maan', 'Gurdas Maan', 'Amrinder Gill', 'Satinder Sartaaj', 'Sharry Mann', 'Mankirt Aulakh',
  'Parmish Verma', 'Jass Manak', 'Garry Sandhu', 'Nimrat Khaira', 'Sunanda Sharma', 'Afsana Khan', 'Gippy Grewal', 'Jazzy B', 'Miss Pooja',
  'Surjit Bindrakhia', 'Kuldeep Manak', 'Amar Singh Chamkila', 'Hans Raj Hans', 'Malkit Singh', 'Daler Mehndi', 'Mika Singh', 'Panjabi MC',
  'Bohemia', 'Imran Khan', 'Jaz Dhami', 'Arjan Dhillon', 'Tegi Pannu', 'R Nait', 'Jordan Sandhu', 'Kaka', 'Rajvir Jawanda', 'Ninja',
  'Kulwinder Billa', 'Khan Saab', 'Yo Yo Honey Singh', 'Jasmine Sandlas', 'Nooran Sisters', 'Gurlez Akhtar', 'Prem Dhillon', 'Navaan Sandhu',
  'Cheema Y', 'Gulab Sidhu', 'Navv Inder', 'Elly Mangat', 'Gurinder Gill', 'Shinda Kahlon', 'Jyotica Tangri', 'Baani Sandhu', 'Kanwar Grewal',
  'Sippy Gill', 'Kamal Heer', 'Inderjit Nikku', 'Dilpreet Dhillon', 'Jenny Johal', 'Kambi', 'Hunar Sidhu', 'Kaur B', 'Gurmeet Bawa',
  'Narinder Biba', 'Wadali Brothers', 'Sukhbir', 'Juggy D',
];
// On the tag list, but mostly Hindi film or Urdu songs (or someone else entirely on the same Last.fm page)
const NOT_PUNJABI = new Set([
  'Ayushmann Khurrana', 'Sukhwinder Singh', 'Badshah', 'The Yellow Diary', 'Tochi Raina', 'Shamshad Begum', 'Rishabh', 'Kamal Khan',
  'Ali Sethi', 'Farhan Saeed', 'Aashir Wajahat', 'Humera Channa', 'Jawad Ahmad', 'Zeeshan Ali', 'Adnan Dhool', 'Zubaida Khanum',
  'Sajjad Ali', 'Shehzad Roy', 'Sahir Ali Bagga', 'Asad Abbas', 'Ahmed Jehanzeb', 'Meesha Shafi', 'Javed Bashir', 'Nirmal Roy',
  'Nasrat Parsa', 'Sehar Gul Khan', 'Naeem Hazarvi', 'Atta Ullah khan', 'Ustad Hussain Baksh Gullo', 'Gunjan', 'Aish', 'Snappy', 'Goldboy',
]);
// Last.fm pages that mix a Punjabi singer with a namesake: those other tracks (iTunes genres say nothing useful,
// Punjabi releases are filed under Pop, Hip-Hop, New Age, Dance and more).
const NAMESAKE_TRACKS = { Kaka: ['En Sidste Sang', 'Bang Bang'] };

async function artistList() {
  const names = new Map(); // normalized -> display
  const add = (n) => { const k = basicNorm(n); if (!names.has(k) && ![...NOT_PUNJABI].some((x) => basicNorm(x) === k)) names.set(k, n); };
  for (const page of ['1', '2']) {
    const b = await lastfm({ method: 'tag.gettopartists', tag: 'punjabi', limit: '100', page }, { offline });
    for (const a of b?.topartists?.artist ?? []) add(a.name);
  }
  for (const n of STARS) add(n);
  return [...names.values()];
}

// ---------------------------------------------------------------- Last.fm candidates
const titleKey = (t) => skeleton(stripDecorations(t) || t).join(' ');
async function candidatesFor(artist) {
  const b = await lastfm({ method: 'artist.gettoptracks', artist, limit: '50', autocorrect: '1' }, { offline });
  const merged = new Map();
  for (const t of b?.toptracks?.track ?? []) {
    const title = (stripDecorations(t.name) || t.name).replace(/\s+/g, ' ').trim();
    if (!/[a-z]/i.test(title) || /^(intro|outro|music intro|interlude|skit)$/i.test(title)) continue;
    if (NAMESAKE_TRACKS[artist]?.some((n) => titleKey(n) === titleKey(title))) continue;
    const k = titleKey(title);
    if (!k) continue;
    const listeners = Number(t.listeners) || 0;
    const m = merged.get(k);
    if (!m) merged.set(k, { title, artist, listeners, lfmNames: [t.name] });
    else { m.lfmNames.push(t.name); if (listeners > m.listeners) m.listeners = listeners; }
  }
  const all = [...merged.values()].sort((a, b) => b.listeners - a.listeners);
  return all.filter((c, i) => (c.listeners >= MIN_LISTENERS || (i < SIGNATURE.n && c.listeners >= SIGNATURE.min))).slice(0, PER_ARTIST);
}

// ---------------------------------------------------------------- matching
function sameTitle(a, b) {
  const A = skeleton(stripDecorations(a) || a), B = skeleton(stripDecorations(b) || b);
  if (!A.length || !B.length) return false;
  const aj = A.join(''), bj = B.join('');
  if (aj === bj) return true;
  // one letter off in a word of five or more ("Lehanga" / "Lehenga"), never in short words ("Jogi" / "Jodi")
  if (A.length === B.length && A.every((t, i) => t === B[i] || (Math.min(t.length, B[i].length) >= 5 && lev(t, B[i]) <= 1))) return true;
  return Math.min(aj.length, bj.length) >= 10 && lev(aj, bj) <= (aj.length >= 16 ? 2 : 1);
}
const VERSION = /\b(remix(es|ed)?|re ?mix|lo ?fi|slowed|reverb(ed)?|sped up|speed up|live|unplugged|instrumentals?|karaoke|mash ?ups?|8d|covers?|version|edit|acoustic|reprise|bass boosted|jhankar|refix|rework|remake|recreated|reloaded|revisited|rendition|tribute|extended|nightcore|female|male|flip|drill mix|trap mix|club mix|dhol mix|bhangra mix|mix|chill|cinematic|dj)\b/i;
const OK_DECOR = /^(from\b|feat\b|featuring\b|ft\b|with\b|prod\b|produced\b|original( version| mix)?$|title (track|song)$|from the (film|movie)\b|music from\b|.*\bsoundtrack$)/i;
const COMPILATION = /\b(best of|blockbusters?|birthday|special|jukebox|non ?stop|top \d+|hits|superhits|greatest|collection|essentials?|vol(ume)?\.? ?\d|playlist|anthems|bangers|mixtape \d|\d{4} hits|nonstop|chartbusters?|evergreen|golden|forever|legends?)\b/i;
const OST = /\s*[([]?\s*(original motion picture soundtrack|motion picture soundtrack|original soundtrack|ost)\s*[)\]]?\s*$/i;

// One iTunes result for a candidate: null when the title differs, else the reasons it is not usable (none = ok).
function judge(c, r) {
  if (r.wrapperType !== 'track' || r.kind !== 'song' || !sameTitle(c.title, r.trackName ?? '')) return null;
  const why = [];
  const own = new Set(skeleton(c.title));
  const versionIn = (s) => (basicNorm(s).match(new RegExp(VERSION.source, 'gi')) || []).filter((w) => !own.has(skeleton(w).join('')));
  if (!creditHits([c.artist], r.artistName ?? '').length) why.push(`credited to ${r.artistName}`);
  if (!r.previewUrl) why.push('no preview');
  if (r.primaryGenreName === 'Bollywood') why.push('filed as Bollywood');
  if ((r.trackTimeMillis ?? 0) < 60000) why.push('under a minute');
  for (const d of decorations(r.trackName)) {
    const clean = d.replace(/["“”‘’']/g, '').trim();
    if (OK_DECOR.test(clean) && !/\b(remix|lo ?fi|slowed|reverb|live|unplugged|version|mix)\b/i.test(clean.replace(/original (version|mix)/i, ''))) continue;
    const vw = versionIn(clean);
    if (vw.length) why.push(`version (${d})`);
  }
  const album = r.collectionName ?? '';
  const albumCore = album.replace(/\s*-\s*(single|ep)\s*$/i, '');
  const av = versionIn(albumCore.replace(/original (version|mix)/i, ''));
  if (av.length && !why.some((w) => w.startsWith('version'))) why.push(`album "${album}"`);
  return { r, why };
}

function productOf(r) {
  const album = r.collectionName ?? '';
  const albumCore = album.replace(/\s*-\s*(single|ep)\s*$/i, '').trim();
  const comp = /various artists/i.test(r.collectionArtistName ?? '') || COMPILATION.test(basicNorm(albumCore)) || isCompilationName(stripDecorations(albumCore) || albumCore);
  return { album, albumCore, comp, single: /-\s*single\s*$/i.test(album) };
}

// Fields for the catalog record
function filmOf(r, title) {
  const tag = fromTag(r.trackName) || fromTag(r.collectionName);
  if (tag) return { movie: tag.replace(/\s+soundtrack$/i, '').trim(), film: true };
  const { album, albumCore, single } = productOf(r);
  if (OST.test(albumCore)) return { movie: albumCore.replace(OST, '').trim(), film: true };
  if (single || sameTitle(albumCore, title)) return { movie: '', film: false };
  return { movie: albumCore || album, film: false };
}

// ---------------------------------------------------------------- run
const t0 = Date.now();
const artists = await artistList();
console.log(`${artists.length} artists; reading their Last.fm top tracks...`);
let cands = [];
for (const a of artists) cands.push(...await candidatesFor(a));
cands.sort((a, b) => b.listeners - a.listeners || a.title.localeCompare(b.title));
console.log(`  ${cands.length} candidate songs (>= ${MIN_LISTENERS} listeners, at most ${PER_ARTIST} per artist)`);
if (plan) {
  const per = Map.groupBy(cands, (c) => c.artist);
  for (const a of artists) {
    const cs = per.get(a) ?? [];
    console.log(`  ${a}: ${cs.length}${cs.length ? ` (${cs.slice(0, 5).map((c) => `${c.title} ${c.listeners}`).join(' | ')})` : ''}`);
  }
  process.exit(0);
}
cands = cands.slice(0, limit);
const partial = limit < Infinity;

// Hindi catalog: same iTunes track, or the same title credited to the same singer
const hindi = [...readJson(join(DATA, 'catalog.json')), ...(existsSync(join(DATA, 'expanded.json')) ? readJson(join(DATA, 'expanded.json')) : [])];
const hindiTracks = new Set(hindi.map((s) => s.trackId));
const hindiByTitle = Map.groupBy(hindi, (s) => titleKey(s.title));
const hindiFilms = new Set(hindi.filter((s) => !s.tags.includes('non-film')).map((s) => skeleton(s.movie).join(' ')));
const inHindi = (title, credit) => (hindiByTitle.get(titleKey(title)) ?? []).find((s) => creditHits(s.singers, credit).length);

const artistUrl = (artist) => `https://itunes.apple.com/search?${new URLSearchParams({ term: artist, country: 'in', media: 'music', entity: 'song', limit: '200' })}`;
const accepted = [], rejected = [];
for (const [i, c] of cands.entries()) {
  let judged = [];
  const look = async (url) => {
    let body = null;
    try { body = await itunesJson(url, { offline }); } catch (e) { console.log(`  [skip] ${e.message}`); }
    return (body?.results ?? []).map((r, rank) => ({ ...judge(c, r), rank })).filter((j) => j.r);
  };
  judged = await look(searchUrl(`${c.title} ${c.artist}`));
  if (!judged.some((j) => !j.why.length)) judged.push(...await look(artistUrl(c.artist)));
  const ok = judged.filter((j) => !j.why.length);
  if (!ok.length) {
    const near = judged.filter((j) => !j.why.some((w) => w.startsWith('credited')));
    const why = !judged.length ? 'no iTunes track with this title' : (near.length ? near : judged)[0].why.join('; ');
    rejected.push({ c, why, near: (near.length ? near : judged)[0]?.r ?? null });
  } else {
    // the original release: not a compilation, then the earliest date, then iTunes' own ranking.
    // 1 January 2000 is iTunes' placeholder for "date unknown" (Honey Singh's 2011 debut album carries it).
    const date = (r) => (/^2000-01-01/.test(r.releaseDate ?? '') ? '9999' : String(r.releaseDate));
    ok.sort((a, b) => productOf(a.r).comp - productOf(b.r).comp || date(a.r).localeCompare(date(b.r)) || a.rank - b.rank);
    accepted.push({ c, r: ok[0].r, copies: new Set(ok.map((j) => j.r.trackId)).size });
  }
  if ((i + 1) % 25 === 0 || i === cands.length - 1) {
    const rate = (Date.now() - t0) / (i + 1);
    console.log(`  ${i + 1}/${cands.length}  matched ${accepted.length}  rejected ${rejected.length} | iTunes calls ${net.calls} cached ${net.cacheHits} 429s ${net.throttled} | ${throttleInterval()} ms/call | eta ${Math.round((rate * (cands.length - i - 1)) / 60000)} min`);
  }
}

// ---------------------------------------------------------------- records
const curated = readJson(join(DATA, 'catalog.json'));
const pop = readJson(join(DATA, 'popularity.json'));
const cuts = cutsByDecade(curated.filter((s) => pop[s.id]).map((s) => ({ year: s.year, tier: s.tier, listeners: pop[s.id].listeners })));
const ids = new Set(hindi.map((s) => s.id));
const songs = [], dupes = [];
for (const { c, r, copies } of accepted) {
  const title = (stripDecorations(r.trackName) || r.trackName).replace(/\s+/g, ' ').trim();
  const singers = splitArtists(r.artistName);
  const year = Number(String(r.releaseDate).slice(0, 4));
  const { movie, film } = filmOf(r, title);
  const drop = (why) => dupes.push({ c, r, why });
  if (hindiTracks.has(r.trackId)) { drop('same iTunes track in the Hindi catalog'); continue; }
  const h = inHindi(title, r.artistName);
  if (h) { drop(`in the Hindi catalog as ${h.id}`); continue; }
  if (film && hindiFilms.has(skeleton(movie).join(' '))) { drop(`from the Hindi film "${movie}"`); continue; }
  const twin = songs.find((s) => s.trackId === r.trackId || (titleKey(s.title) === titleKey(title) && creditHits(s.singers, r.artistName).length));
  if (twin) { drop(`same song as ${twin.id}`); continue; }
  let id = `pb-${slugify(title)}-${slugify(singers[0] ?? c.artist)}`;
  if (ids.has(id)) id += `-${year}`;
  if (ids.has(id)) { drop(`id ${id} taken`); continue; }
  ids.add(id);
  songs.push({
    id, title, alt_titles: [], movie, year, singers, composers: [], tags: film ? ['punjabi'] : ['punjabi', 'non-film'], tier: 4,
    trackId: r.trackId, preview: r.previewUrl, artwork: artwork600(r.artworkUrl100),
    appleUrl: r.trackViewUrl?.replace(/[?&]uo=\d+/, '') ?? null, durationMs: r.trackTimeMillis ?? null, confidence: 'auto',
    _: { lfm: c, genre: r.primaryGenreName, album: r.collectionName, comp: productOf(r).comp, copies, fuzzy: titleKey(title) !== titleKey(c.title) },
  });
}

// Listeners on the same scale as the Hindi songs: track.search summed over credits (scripts/popularity.mjs), or the
// artist's own track page when that is higher.
console.log(`\nLooking up listeners for ${songs.length} songs...`);
for (const s of songs) {
  const found = await listenersFor({ title: s.title, alt_titles: [s._.lfm.title], singers: [...s.singers, s._.lfm.artist], composers: [] }, { offline });
  s._.listeners = Math.max(found ?? 0, s._.lfm.listeners);
  s.tier = tierFor(cuts, s.year, s._.listeners);
}

songs.sort((a, b) => a.year - b.year || a.id.localeCompare(b.id));
const count = (xs, f) => Object.fromEntries([...Map.groupBy(xs, f)].sort(([a], [b]) => String(a).localeCompare(String(b))).map(([k, v]) => [k, v.length]));
const perDecade = count(songs, (s) => decadeOf(s.year)), perTier = count(songs, (s) => s.tier);
const films = songs.filter((s) => !s.tags.includes('non-film')).length;
const genres = Object.entries(count(songs, (s) => s._.genre)).sort((a, b) => b[1] - a[1]);
const byListeners = [...songs].sort((a, b) => b._.listeners - a._.listeners);
const esc = (s) => String(s ?? '').replace(/\|/g, '\\|');
const row = (s) => `| ${esc(s.title)} | ${esc(s.singers.join(', '))} | ${esc(s.movie || '(single)')} | ${s.year} | ${s.tier} | ${s._.listeners} | ${esc(s._.genre)} |`;
const dubious = songs.filter((s) => s._.fuzzy || s._.comp || s.year < 1970 || (s.year < 2000 && s._.lfm.listeners >= 20000));

if (partial) {
  for (const s of byListeners) console.log(`  + ${s.title} | ${s.singers.join(', ')} | ${s.movie || '(single)'} | ${s.year} | tier ${s.tier} | ${s._.listeners} | ${s._.genre} | ${s._.album}`);
  for (const { c, r, why } of dupes) console.log(`  = ${c.title} | ${c.artist} -> ${r.trackName} (${r.collectionName}): ${why}`);
  for (const { c, why, near } of rejected) console.log(`  - ${c.title} | ${c.artist} | ${c.listeners}: ${why}${near ? ` [${near.trackName} / ${near.artistName} / ${near.collectionName} / ${near.primaryGenreName}]` : ''}`);
  console.log('\nPartial run: data/punjabi.json not written.');
}
else {
  writeJsonRows(join(DATA, 'punjabi.json'), songs.map(({ _, ...s }) => s));
  const md = [
    '# Punjabi songs report', '',
    `Generated by \`node --env-file=.env scripts/punjabi.mjs\`. ${artists.length} artists, ${cands.length} Last.fm candidates, `
      + `${accepted.length} matched on iTunes, ${songs.length} songs kept (${dupes.length} dropped as duplicates or Hindi catalog songs, `
      + `${rejected.length} not matched).`, '',
    `Songs per decade: ${Object.entries(perDecade).map(([d, n]) => `${d} ${n}`).join(', ')}.`,
    `Songs per tier: ${Object.entries(perTier).map(([t, n]) => `tier ${t} ${n}`).join(', ')}.`,
    `Film songs ${films}, non-film ${songs.length - films} (${songs.filter((s) => !s.movie).length} singles).`,
    `iTunes genres: ${genres.map(([g, n]) => `${g} ${n}`).join(', ')}.`, '',
    '## Best-known songs', '', '| title | singers | film or album | year | tier | listeners | genre |', '|---|---|---|---|---|---|---|',
    ...byListeners.slice(0, 60).map(row), '',
    `## Worth a look (${dubious.length})`, '',
    'Fuzzy title matches, compilation copies (the original single may be missing from iTunes India), and old dates.', '',
    '| title | singers | album | year | listeners | why |', '|---|---|---|---|---|---|',
    ...dubious.map((s) => `| ${esc(s.title)} | ${esc(s.singers.join(', '))} | ${esc(s._.album)} | ${s.year} | ${s._.listeners} | ${[
      s._.fuzzy && `Last.fm title "${esc(s._.lfm.title)}"`, s._.comp && 'compilation', s.year < 1970 && 'very old date',
      s.year < 2000 && s._.lfm.listeners >= 20000 && 'old date for a big hit'].filter(Boolean).join('; ')} |`), '',
    `## Dropped after matching (${dupes.length})`, '', '| Last.fm title | artist | iTunes track | why |', '|---|---|---|---|',
    ...dupes.map(({ c, r, why }) => `| ${esc(c.title)} | ${esc(c.artist)} | ${esc(r.trackName)} (${esc(r.collectionName)}) | ${esc(why)} |`), '',
    `## Not matched (${rejected.length})`, '', '| Last.fm title | artist | listeners | why | nearest iTunes track |', '|---|---|---|---|---|',
    ...rejected.map(({ c, why, near }) => `| ${esc(c.title)} | ${esc(c.artist)} | ${c.listeners} | ${esc(why)} | ${near ? `${esc(near.trackName)} / ${esc(near.artistName)} / ${esc(near.collectionName)} / ${esc(near.primaryGenreName)}` : ''} |`), '',
  ].join('\n');
  writeFileSync(join(DATA, 'punjabi-report.md'), md);
}
console.log(`\nDone in ${Math.round((Date.now() - t0) / 1000)}s: ${cands.length} candidates, ${accepted.length} matched, ${songs.length} kept `
  + `(${dupes.length} duplicates, ${rejected.length} not matched). Decades ${JSON.stringify(perDecade)}, tiers ${JSON.stringify(perTier)}, `
  + `film ${films}. iTunes ${net.calls} calls, ${net.cacheHits} cached, ${net.throttled} throttled; Last.fm ${lastfmStats.calls} calls, ${lastfmStats.cached} cached.`);

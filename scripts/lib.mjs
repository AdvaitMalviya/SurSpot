// Shared helpers for the SongPot catalog pipeline (adapted from the R2 research scripts, §11 of
// research/02-audio-sources.md). No dependencies: Node >= 22 ESM with native fetch.
//   - itunesJson: on-disk cache keyed by URL hash + adaptive throttle (honours 429 / Retry-After)
//   - slugs, romanization skeleton, title / artist / film matching, version classifier, candidate scorer
import { createHash } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const DATA = join(ROOT, 'data');
export const CACHE_DIR = join(DATA, '.cache', 'itunes');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
export const writeJson = (p, data) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, JSON.stringify(data, null, 2) + '\n'); };

// ---------------------------------------------------------------- iTunes API: cache + throttle
// Research §7: ~20/min documented; a burst of 44 back-to-back calls passed, the 45th got 429 + Retry-After 5.
// Start at ~30/min and adapt (AIMD): speed up 10% after a clean streak, slow down 1.6x on every 429.
export const net = { calls: 0, cacheHits: 0, throttled: 0, errors: 0, t0: Date.now() };
const throttle = { interval: 2000, min: 1200, max: 30000, last: 0, streak: 0 };
export const throttleInterval = () => throttle.interval;

const cacheFile = (url) => join(CACHE_DIR, createHash('sha1').update(url).digest('hex').slice(0, 20) + '.json');
export const isCached = (url) => existsSync(cacheFile(url));
export function readCache(url) {
  const f = cacheFile(url);
  if (!existsSync(f)) return null;
  try { return readJson(f); } catch { return null; }
}

export const searchUrl = (term) =>
  `https://itunes.apple.com/search?${new URLSearchParams({ term, country: 'in', media: 'music', entity: 'song', limit: '50' })}`;
export const lookupUrl = (ids) => `https://itunes.apple.com/lookup?id=${ids.join(',')}&country=in`;

// Returns the parsed body. `offline` -> null when not cached. `fresh` -> skip the cache read (still writes it).
export async function itunesJson(url, { offline = false, fresh = false, log = console.log } = {}) {
  if (!fresh) {
    const c = readCache(url);
    if (c) { net.cacheHits++; return c.body; }
  }
  if (offline) return null;
  for (let attempt = 1; ; attempt++) {
    const wait = throttle.last + throttle.interval - Date.now();
    if (wait > 0) await sleep(wait);
    throttle.last = Date.now();
    let res = null, text = '';
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      text = await res.text();
    } catch (e) { text = String(e); }
    net.calls++;
    if (res?.status === 200) {
      let body = null;
      try { body = JSON.parse(text); } catch { /* fall through to retry */ }
      if (body && Array.isArray(body.results)) {
        mkdirSync(CACHE_DIR, { recursive: true });
        writeFileSync(cacheFile(url), JSON.stringify({ url, fetchedAt: new Date().toISOString(), status: 200,
          headers: Object.fromEntries(res.headers), body }));
        if (++throttle.streak >= 30) { throttle.interval = Math.max(throttle.min, Math.round(throttle.interval * 0.9)); throttle.streak = 0; }
        return body;
      }
    }
    const status = res?.status ?? 'network-error';
    if (status === 429 || status === 403) {
      net.throttled++;
      throttle.streak = 0;
      throttle.interval = Math.min(throttle.max, Math.round(throttle.interval * 1.6));
      const retryAfter = Number(res.headers.get('retry-after')) || 5;
      const pause = (retryAfter + 2) * 1000 * Math.min(attempt, 4);
      log(`  [throttle] HTTP ${status} (Retry-After ${retryAfter}s) -> pausing ${pause / 1000}s, interval now ${throttle.interval} ms`);
      if (attempt >= 10) throw new Error(`still throttled after ${attempt} attempts: ${url}`);
      await sleep(pause);
      continue;
    }
    net.errors++;
    log(`  [error] ${status} ${text.slice(0, 120).replace(/\s+/g, ' ')} (attempt ${attempt})`);
    if (attempt >= 4) throw new Error(`HTTP ${status} for ${url}`);
    await sleep(3000 * 2 ** attempt);
  }
}

// ---------------------------------------------------------------- ids
export function slugify(s) {
  return String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/['’`´]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
export const baseSongId = (s) => `${slugify(s.title)}-${slugify(s.movie)}`;
export const decadeOf = (year) => `${Math.floor(year / 10) * 10}s`;

// ---------------------------------------------------------------- normalization
export const stripDiacritics = (s) => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '');
export function basicNorm(s) {
  return stripDiacritics(s).toLowerCase()
    .replace(/[’'`´]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
export const hasLatin = (s) => /[A-Za-z]/.test(String(s ?? ''));
// "Kesariya (From \"Brahmastra\")" -> "Kesariya"; "Tum Hi Ho - Lofi Flip" -> "Tum Hi Ho"
export const stripDecorations = (t) =>
  String(t ?? '').replace(/\s*[(\[{][^)\]}]*[)\]}]/g, ' ').replace(/\s+[-–—]\s+.*$/, ' ').replace(/\s+/g, ' ').trim();
export function decorations(t) {
  const s = String(t ?? '');
  const parts = [...s.matchAll(/[(\[{]([^)\]}]*)[)\]}]/g)].map((m) => m[1].trim());
  const dash = s.replace(/\s*[(\[{][^)\]}]*[)\]}]/g, '').match(/\s+[-–—]\s+(.+)$/);
  if (dash) parts.push(dash[1].trim());
  return parts.filter(Boolean);
}

// Phonetic-ish skeleton that collapses common Hindi romanization variants:
//   Toh/To, Woh/Wo/Voh, Naa/Na, Jaa/Ja, Sapnon/Sapno, Chaiyya/Chhaiya, Deewana/Diwana, Zindagi/Jindagi
const WORD_ALIAS = { mein: 'me', main: 'me', men: 'me', mai: 'me', hain: 'hai', he: 'hai', hae: 'hai', ae: 'e', aye: 'e', ai: 'e', ay: 'e' };
export function wordSkeleton(w) {
  if (WORD_ALIAS[w]) return WORD_ALIAS[w];
  let x = w;
  x = x.replace(/w/g, 'v').replace(/z/g, 'j').replace(/q/g, 'k').replace(/ph/g, 'f').replace(/x/g, 'ks');
  x = x.replace(/chh/g, 'ch').replace(/ey$/, 'e');
  x = x.replace(/ee/g, 'i').replace(/oo/g, 'u').replace(/aa+/g, 'a').replace(/ii/g, 'i').replace(/uu/g, 'u');
  x = x.replace(/([aeiou])h$/, '$1');            // toh -> to, yeh -> ye, woh -> vo
  x = x.replace(/([aeiou])n$/, '$1');            // sapnon -> sapno, hain -> hai (nasal endings)
  x = x.replace(/([b-df-hj-np-tv-z])\1+/g, '$1'); // chaiyya -> chaiya, dilli -> dili
  return WORD_ALIAS[x] ?? x;
}
export const skeleton = (s) => basicNorm(s).split(' ').filter(Boolean).map(wordSkeleton);

export function lev(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
const tokEq = (a, b, minLen = 4) => a === b || (Math.min(a.length, b.length) >= minLen && lev(a, b) <= 1);
const seqEq = (A, B, minLen) => A.length === B.length && A.every((t, i) => tokEq(t, B[i], minLen));
const seqPrefix = (P, S, minLen) => P.length <= S.length && P.every((t, i) => tokEq(t, S[i], minLen));
function seqContains(S, P, minLen) {
  for (let i = 0; i + P.length <= S.length; i++) if (P.every((t, j) => tokEq(t, S[i + j], minLen))) return true;
  return false;
}

// Compare one catalog title skeleton E to a store title skeleton C (decorations already stripped).
// Returns { sim, extra } where extra = store tokens beyond the matched catalog prefix.
function titleCompare(E, C) {
  if (!E.length || !C.length) return { sim: 0, extra: [] };
  if (E.join('') === C.join('') || seqEq(E, C)) return { sim: 1, extra: [] };
  if (seqPrefix(E, C)) return { sim: 0.92, extra: C.slice(E.length) };                     // "Lag Ja Gale" ⊂ "Lag Ja Gale Se Phir"
  const ej = E.join(''), cj = C.join('');
  if (cj.startsWith(ej)) return { sim: 0.9, extra: [] };                                    // "tumsehi" vs "tum se hi"
  if (C.length >= 2 && C.length * 2 >= E.length && seqPrefix(C, E)) return { sim: 0.86, extra: [] }; // store title shorter
  let hit = 0; const used = new Set();
  for (const t of E) { const j = C.findIndex((c, k) => !used.has(k) && tokEq(t, c)); if (j >= 0) { used.add(j); hit++; } }
  return { sim: +((2 * hit) / (E.length + C.length)).toFixed(2), extra: [] };
}

// ---------------------------------------------------------------- artists
export function splitArtists(s) {
  return String(s ?? '').split(/\s*(?:,|&|\+|\band\b|\bfeat\.?|\bft\.?|\bfeaturing\b|\bwith\b|\bx\b|\/)\s*/i).map((a) => a.trim()).filter(Boolean);
}
// Seed name -> extra credit spellings seen on iTunes
const ARTIST_ALIAS = {
  'kk': ['k k', 'krishnakumar kunnath'],
  'yo yo honey singh': ['honey singh'],
  'abhijeet bhattacharya': ['abhijeet', 'abhijit'],
  'hemant kumar': ['hemanta mukherjee', 'hemanta kumar', 'hemant kumar mukherjee'],
  'geeta dutt': ['geeta roy', 'geeta roy dutt'],
  'asha bhosle': ['asha bhonsle'],
  'mohammed rafi': ['rafi'],
  'mohammed aziz': ['aziz'],
  'a r rahman': ['ar rahman', 'rahman'],
  'shaan': ['shantanu mukherjee'],
  'alisha chinai': ['alisha chinoy', 'alisha'],
  'nusrat fateh ali khan': ['ustad nusrat fateh ali khan'],
  'rahat fateh ali khan': ['ustad rahat fateh ali khan'],
  'sukhwinder singh': ['sukhvinder singh'],
  'badshah': ['badsha'],
  'mika singh': ['mika'],
  'b praak': ['bpraak'],
};
const nameNorm = (n) => basicNorm(n).replace(/\b(mohd|md|mohammad|muhammad|mohamed|mohamad)\b/g, 'mohammed').replace(/\bustad\b/g, '').trim();
const nameSkel = (n) => skeleton(nameNorm(n)).join('');
export function nameVariants(n) {
  const k = nameNorm(n);
  return [k, ...(ARTIST_ALIAS[k] || [])].map((v) => skeleton(v).join(''));
}
function nameEq(e, c) {
  if (e === c) return true;
  const m = Math.min(e.length, c.length);
  if (m >= 5 && (c.includes(e) || e.includes(c))) return true;
  if (m >= 5 && lev(e, c) <= 1) return true;
  if (m >= 9 && lev(e, c) <= 2) return true;
  return false;
}
// names (seed singers/composers) found in an iTunes artist credit
export function creditHits(names, credit) {
  const cand = splitArtists(credit).map(nameSkel).filter(Boolean);
  return names.filter((n) => nameVariants(n).some((e) => cand.some((c) => nameEq(e, c))));
}

// ---------------------------------------------------------------- versions
// Strong version words: rejected when they appear in a decoration, after the matched title, or in the album name
const VERSION_WORDS = ['cover', 'covered', 'karaoke', 'instrumental', 'instrumentals', 'lofi', 'lo fi', 'slowed', 'reverb', 'sped up',
  'remix', 'remixed', 'remixes', 'mix', 'mashup', 'reprise', 'unplugged', 'acoustic', 'live', 'recreated', 'recreation', 'revisited',
  'rendition', 'tribute', 'jhankar', 'female', 'male', 'sad', 'happy', 'dj', '8d', 'bass boosted', 'medley', 'non stop', 'nonstop',
  'chill', 'flip', 'edit', 'piano', 'guitar', 'flute', 'violin', 'sitar', 'saxophone', 'sax', 'bgm', 'ringtone', 'cinematic',
  'orchestral', 'lullaby', 'version', 'duet', 'solo', 'reloaded', 'refix', 'retro', 'fusion', 'dance', 'club', 'trap', 'drill',
  'dialogue', 'dialogues', 'teaser', 'vocals only', 'vocal', 'a cappella', 'acapella', 'synthwave', 'unwind', 'bolly', 'afro',
  'afrobeat', 'afrobeats', 'phonk', 'house', 'lounge', 'remake', 'rework', 'reply', 'stripped', 'lyrical', 'theme', 'extended',
  'radio', 'promo', 'demo', 'alternate', 'bonus', 'concert', 'session', 'sessions', 'jam', 'dubstep', 'reggae',
  'punjabi', 'arabic', 'tamil', 'telugu', 'english', 'marathi', 'bengali', 'gujarati', 'kannada', 'malayalam', 'bhojpuri'];
const VERSION_RE = new RegExp(`\\b(${VERSION_WORDS.map((w) => w.replace(/ /g, '\\s?')).join('|')})\\b`, 'i');
const ALBUM_VERSION_RE = /\b(karaoke|instrumentals?|lo ?fi|slowed|reverb|covers?|covered|tribute|unplugged|reprise|remix(es)?|remixed|mashups?|jhankar|acoustic|piano|flute|guitar|violin|sitar|saxophone|orchestra|lullab\w*|sing along|recreated|revisited|rendition|lounge|chill\w*|relax\w*|meditation|8d|bgm|ringtone|nursery|rhymes)\b/i;
const ARTIST_VERSION_RE = /\b(karaoke|tribute|orchestra|instrumental|cover|covers|lofi|lo fi|band|jhankar|piano|flute|guitar|sax|dj)\b/i;
// Decorations that do NOT indicate a different version
const OK_DECOR = /^(from\b|feat\b|featuring\b|ft\b|with\b|title (track|song)$|theme from\b|original motion picture soundtrack$|(original )?soundtrack( version)?$|(\d{4} )?remaster(ed)?( \d{4})?( version)?$|original( version| mix| film version)?$|film version$|hindi( version)?$|from the (film|movie)\b|mono$|stereo$|full (song|version)$|album version$)/i;
const DIALOGUE_RE = /\bdialogues?\b/i;

// Does the album name or a (From "X") tag point at the film?
export function fromTag(s) {
  const m = String(s ?? '').match(/\(\s*from\s+(?:the\s+(?:film|movie)\s+)?["“'‘]?([^"”'’)]+)["”'’]?\s*\)/i)
    || String(s ?? '').match(/\s[-–]\s+from\s+["“'‘]?([^"”'’)]+)["”'’]?\s*$/i);
  return m ? m[1].trim() : null;
}
const OST_RE = /original motion picture soundtrack|motion picture soundtrack|original soundtrack|\bost\b|soundtrack|\bomps\b/i;
const COMPILATION_RE = /\b(best of|hits|greatest|collection|essential|essentials|golden|evergreen|romantic|love songs|vol|volume|super ?hits?|top \d+|classics?|memories|legends?|forever|all time|jukebox|unforgettable|melodies|magic|queen|king|era|decade|anthology|years of|celebrating|remembering|hits of|songs of|\d0s|nostalgia|playlist|moods?|sad songs|party|wedding|monsoon|rain|sufi|dance|bollywood|blockbusters?|diamonds|masterworks|gems|rewind|retro|best|treasures?|duets|singles|sings|special|tribute|evergreens|chartbusters?|chart|kings?|queens?|icons?|remembers|journey|vintage|records?)\b/i;
export const isCompilationName = (album) => COMPILATION_RE.test(basicNorm(album));

// ---------------------------------------------------------------- per-song context
export function songContext(song) {
  const baseTitle = stripDecorations(song.title) || song.title;
  const titleVariants = [baseTitle, ...song.alt_titles.filter(hasLatin).map((t) => stripDecorations(t) || t)];
  const titleSkels = titleVariants.map(skeleton).filter((s) => s.length);
  const filmSkel = skeleton(song.movie);
  const filmMain = /[:–—]/.test(song.movie) ? skeleton(song.movie.split(/[:–—]/)[0]) : null;
  const seedWords = new Set([song.title, ...song.alt_titles, song.movie].flatMap(skeleton));
  const nameWords = new Set([...song.singers, ...song.composers].flatMap((n) => skeleton(nameNorm(n))));
  // version words the seed itself declares, e.g. "Phir Le Aya Dil (Reprise)" -> must appear in the store title
  const required = [...new Set((basicNorm(song.title).match(new RegExp(VERSION_RE.source, 'gi')) || []).map((w) => w.toLowerCase()))];
  const nonFilm = song.tags.includes('non-film');
  return { song, baseTitle, titleSkels, filmSkel, filmMain, seedWords, nameWords, required, nonFilm };
}

// film evidence of an album name / From-tag against the seed movie
function filmRelation(ctx, name) {
  const S = skeleton(name);
  if (!S.length || !ctx.filmSkel.length) return 'none';
  const F = ctx.filmSkel, M = ctx.filmMain;
  if (seqEq(S, F, 3) || S.join('') === F.join('') || (M && M.length && seqEq(S, M, 3))) return 'exact';
  const strongEnough = (T) => T.length >= 2 || (T[0] || '').length >= 5;
  if (seqPrefix(S, F, 3) && strongEnough(S)) return 'partial';                     // "Brahmastra" vs "Brahmastra Part One: Shiva"
  if (seqPrefix(F, S, 3) && strongEnough(F) && !/^\d|^(ii|iii|iv|2|3|returns|again|part)$/.test(S[F.length] || '')) return 'partial';
  if (seqContains(S, F, 3) && strongEnough(F)) return 'mentions';
  return 'none';
}

const yearOf = (d) => (d ? Number(String(d).slice(0, 4)) : null);

// Assess one raw iTunes result against the seed song.
export function assess(ctx, r) {
  const { song } = ctx;
  const title = r.trackName ?? '', album = r.collectionName ?? '', artist = r.artistName ?? '';
  const hard = [], soft = [];

  // title
  const C = skeleton(stripDecorations(title));
  let best = { sim: 0, extra: [] };
  for (const E of ctx.titleSkels) { const t = titleCompare(E, C); if (t.sim > best.sim) best = t; }
  const sim = best.sim;
  if (sim < 0.75) hard.push(`title ${sim}`);

  // singers (composers only as a diagnostic)
  const singerHits = creditHits(song.singers, artist);
  if (!singerHits.length) {
    const comp = creditHits(song.composers, artist);
    hard.push(comp.length ? `no expected singer (credit: composer ${comp.join('/')})` : `no expected singer (credit: ${artist})`);
  }

  // versions
  const exempt = (w) => ctx.seedWords.has(wordSkeleton(w.toLowerCase().replace(/\s+/g, ''))) || ctx.required.includes(w.toLowerCase());
  const versionWordsIn = (text) => (basicNorm(text).match(new RegExp(VERSION_RE.source, 'gi')) || []).filter((w) => !exempt(w));
  const tag = fromTag(title) || fromTag(album);
  for (const d of decorations(title)) {
    const clean = d.replace(/["“”‘’']/g, '').trim();
    const vw = versionWordsIn(clean);
    if (vw.length && !(OK_DECOR.test(clean) && !DIALOGUE_RE.test(clean) && vw.every((w) => /^(version|mix|soundtrack)$/i.test(w)))) {
      hard.push(`version: (${d})`); continue;
    }
    if (OK_DECOR.test(clean)) continue;
    const toks = skeleton(clean);
    if (toks.length && toks.every((t) => ctx.seedWords.has(t) || ctx.nameWords.has(t))) continue; // part of the seed title / film / credits
    hard.push(`decoration: (${d})`);
  }
  const extraVw = best.extra.filter((t) => VERSION_RE.test(t) && !exempt(t));
  if (extraVw.length) hard.push(`version: "${extraVw.join(' ')}" in title`);
  for (const req of ctx.required) if (!new RegExp(`\\b${req}\\b`, 'i').test(basicNorm(title))) hard.push(`not the ${req} the seed asks for`);
  const av = basicNorm(album).match(ALBUM_VERSION_RE);
  if (av && !exempt(av[1])) hard.push(`album: ${av[1]}`);
  const arv = basicNorm(artist).match(ARTIST_VERSION_RE);
  if (arv && !singerHits.length) hard.push(`artist: ${arv[1]}`);
  if (DIALOGUE_RE.test(title) && !exempt('dialogues')) hard.push('track has dialogues');
  if (!r.previewUrl) soft.push('no preview');

  // film evidence / same-title guard
  const albumCore = stripDecorations(album.replace(/\s*-\s*(single|ep)\s*$/i, '')) || album;
  const albumRel = filmRelation(ctx, albumCore);
  const tagRel = tag ? filmRelation(ctx, tag) : 'none';
  const ost = OST_RE.test(album);
  const single = /-\s*(single|ep)\s*$/i.test(album.trim());
  const comp = albumRel === 'none' && isCompilationName(albumCore);
  const dialogueEdition = DIALOGUE_RE.test(album);
  let otherFilm = null;
  if (tag && tagRel === 'none') otherFilm = `From "${tag}"`;
  else if (!tag && ost && albumRel === 'none') otherFilm = `album "${album}"`;
  if (otherFilm && ctx.nonFilm && !tag) otherFilm = null; // non-film seeds: an unrelated OST is just "no evidence"
  if (otherFilm) hard.push(`other film: ${otherFilm}`);

  const filmEv = albumRel === 'exact' || tagRel === 'exact' ? 'strong' : albumRel === 'partial' || tagRel === 'partial' ? 'partial'
    : albumRel === 'mentions' || tagRel === 'mentions' ? 'weak' : 'none';
  // non-film single whose album is "<title> - Single" when the seed movie is the title
  const y = yearOf(r.releaseDate);
  if (y && y >= 1960 && y < song.year - 2) soft.push(`released ${y}, before the film (${song.year})`);
  if (y && song.year >= 1995 && y > song.year + 3 && filmEv === 'none') soft.push(`released ${y}, ${y - song.year} years after`);

  const score = 3 * sim + 1.5 * Math.min(singerHits.length, 2)
    + ({ strong: 3, partial: 2, weak: 1, none: 0 })[filmEv] + (ost && filmEv !== 'none' ? 0.5 : 0)
    - (comp ? 1 : 0) - (single && tagRel !== 'exact' ? 0.25 : 0) - (dialogueEdition ? 0.5 : 0)
    + (decorations(title).length === 0 ? 0.25 : 0) - (soft.some((s) => s.startsWith('released')) ? 1.5 : 0)
    - (hard.length ? 10 : 0);
  return {
    trackId: r.trackId, title, artist, album, durationMs: r.trackTimeMillis ?? null, releaseDate: r.releaseDate?.slice(0, 10) ?? null,
    trackNumber: r.trackNumber ?? null, hasPreview: !!r.previewUrl, sim, singerHits, filmEv, ost, comp, single, dialogueEdition,
    hard, soft, score: +score.toFixed(2),
  };
}

// ---------------------------------------------------------------- pick the original master
// pool: Map trackId -> { r: raw result, rank: best rank across queries }
export function decide(ctx, pool) {
  const all = [...pool.values()].map(({ r, rank }) => ({ ...assess(ctx, r), rank }));
  all.sort((a, b) => b.score - a.score || a.rank - b.rank || a.trackId - b.trackId);
  const ok = all.filter((c) => !c.hard.length);
  if (!ok.length) {
    const near = all.filter((c) => c.sim >= 0.75);
    const best = (near.length ? near : all)[0] ?? null;
    return { status: 'unresolved', reason: best ? best.hard.join('; ') : 'no results', best, candidates: all };
  }
  // group copies of one master by duration (±2.5 s)
  const groups = [];
  for (const c of [...ok].sort((a, b) => (a.durationMs ?? 0) - (b.durationMs ?? 0))) {
    const g = groups.find((g) => c.durationMs && Math.abs(g.anchor - c.durationMs) <= 2500);
    if (g) g.members.push(c); else groups.push({ anchor: c.durationMs ?? 0, members: [c] });
  }
  const evRank = { strong: 3, partial: 2, weak: 1, none: 0 };
  for (const g of groups) {
    g.members.sort((a, b) => b.score - a.score || a.rank - b.rank || a.trackId - b.trackId);
    g.ev = Math.max(...g.members.map((m) => evRank[m.filmEv]));
    g.albums = new Set(g.members.map((m) => basicNorm(m.album))).size;
    g.bestSim = Math.max(...g.members.map((m) => m.sim));
    g.minRank = Math.min(...g.members.map((m) => m.rank));
    g.score = g.members[0].score + Math.max(0, g.ev - evRank[g.members[0].filmEv]) + 0.25 * Math.min(g.albums - 1, 4);
  }
  groups.sort((a, b) => b.score - a.score || a.minRank - b.minRank);
  const withPreview = groups.filter((g) => g.members.some((m) => m.hasPreview));
  if (!withPreview.length) {
    return { status: 'unresolved', reason: 'original found but no preview available', best: groups[0].members[0], candidates: all };
  }
  const g = withPreview[0];
  // product: film OST album > (From "film") single > other non-compilation > compilation; then score/rank
  const productKey = (m) => (m.filmEv === 'strong' ? 3 : m.filmEv === 'partial' ? 2.5 : 0) + (m.ost ? 0.5 : 0) + (m.comp ? -1 : 0) + (m.single ? -0.3 : 0) + (m.dialogueEdition ? -0.4 : 0);
  const pick = g.members.filter((m) => m.hasPreview).sort((a, b) => productKey(b) - productKey(a) || b.score - a.score || (a.trackNumber ?? 99) - (b.trackNumber ?? 99) || a.rank - b.rank || a.trackId - b.trackId)[0];

  const why = [];
  if (pick.sim < 0.9) why.push(`fuzzy title (${pick.sim}: "${pick.title}")`);
  if (g.ev < 2) why.push(ctx.nonFilm ? `album "${pick.album}" is not "${ctx.song.movie}"` : 'no film-soundtrack evidence for this master');
  else if (g.ev === 2) why.push('partial film-name match');
  for (const s of pick.soft) why.push(s);
  if (withPreview[0] !== groups[0]) why.push('best-scoring master has no preview');
  const rival = withPreview.slice(1).find((o) => o.ev >= Math.min(g.ev, 2) && o.bestSim >= pick.sim && o.score >= g.score - 1.5);
  if (rival) {
    const rm = rival.members[0];
    why.push(`ambiguous: another master ${fmtDur(rm.durationMs)} "${rm.title}" | ${rm.artist} | ${rm.album} (${rm.trackId}) vs ${fmtDur(pick.durationMs)}`);
  }
  return { status: why.length ? 'low' : 'high', why, pick, group: g.members.map((m) => m.trackId), candidates: all, groups };
}

export const fmtDur = (ms) => (ms ? `${Math.floor(ms / 60000)}:${String(Math.round((ms % 60000) / 1000)).padStart(2, '0')}` : '?');
export const artwork600 = (u) => (u ? u.replace(/\/\d+x\d+bb\.(jpg|png|webp)$/, '/600x600bb.jpg') : null);

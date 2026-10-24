// Per-song popularity from Last.fm: node --env-file=.env scripts/popularity.mjs [--offline] [--limit N]
// For every song in data/catalog.json and data/expanded.json, track.search finds Last.fm tracks with the same title
// (romanization-tolerant) credited to one of its singers or composers. Their listener counts are summed, because
// Bollywood songs are scrobbled under several artist spellings ("Arijit Singh", "Mithoon & Arijit Singh").
// Old songs have far fewer Last.fm listeners than new ones, so the curated tiers calibrate listeners decade by
// decade, and each song found gets a suggested tier. Writes data/popularity.json: { id: { listeners, tier } }.
// scripts/expand.mjs uses those tiers for the songs it adds; curated songs keep their hand-set tiers.
import { createHash } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA, sleep, readJson, writeJson, skeleton, stripDecorations, creditHits, decadeOf } from './lib.mjs';
import { cutsByDecade, tierFor } from './tiers.mjs';

const args = process.argv.slice(2);
const opt = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const offline = args.includes('--offline');
const limit = Number(opt('--limit')) || Infinity;
const KEY = process.env.LASTFM_API_KEY;
if (!KEY && !offline) {
  console.error('No Last.fm key. Put LASTFM_API_KEY=... in .env and run: node --env-file=.env scripts/popularity.mjs');
  process.exit(1);
}

// ---------------------------------------------------------------- Last.fm (cached on disk; the key is not part of the cache name)
const CACHE = join(DATA, '.cache', 'lastfm');
const UA = 'SurSpotCatalog/1.0 (https://github.com/Siddharth-Y26)';
const stats = { calls: 0, cached: 0, retries: 0 };
let next = 0;
// Last.fm allows about five calls a second; error 29 means slow down, 11 and 16 are temporary.
// Calls overlap (a response takes about a second), so each one books its start slot 250 ms after the last.
async function lastfm(params) {
  const query = new URLSearchParams({ ...params, format: 'json' }).toString();
  const file = join(CACHE, createHash('sha1').update(query).digest('hex').slice(0, 20) + '.json');
  if (existsSync(file)) { stats.cached++; return readJson(file); }
  if (offline) return null;
  for (let attempt = 1; attempt <= 6; attempt++) {
    const at = Math.max(Date.now(), next);
    next = at + 250;
    await sleep(at - Date.now());
    let body = null;
    try {
      const res = await fetch(`https://ws.audioscrobbler.com/2.0/?${query}&api_key=${KEY}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
      body = await res.json().catch(() => null);
      stats.calls++;
      if (res.ok && body && !body.error) { writeJson(file, body); return body; }
      if (body?.error === 10 || body?.error === 26) throw new Error(`Last.fm rejected the API key: ${body.message}`);
    } catch (e) {
      if (/API key/.test(e.message)) throw e;
    }
    stats.retries++;
    await sleep(2000 * attempt * (body?.error === 29 ? 3 : 1));
  }
  throw new Error(`Last.fm request failed: ${query}`);
}

// ---------------------------------------------------------------- matching
const titleKey = (t) => skeleton(stripDecorations(t) || t).join(' ');
function addMatches(song, body, found) {
  const want = new Set([song.title, ...song.alt_titles.filter((t) => /[a-z]/i.test(t))].map(titleKey));
  const people = [...song.singers, ...song.composers];
  for (const t of body?.results?.trackmatches?.track ?? []) {
    if (found.has(t.url) || !want.has(titleKey(t.name))) continue;
    if (people.length && !creditHits(people, t.artist).length) continue;
    found.set(t.url, Number(t.listeners) || 0);
  }
}
// Title alone first (Last.fm ranks by listeners, so every artist spelling of a hit shows up); if nothing
// matches, the same title narrowed to the first singer, for titles shared by many unrelated songs.
async function listenersFor(song) {
  const found = new Map();
  addMatches(song, await lastfm({ method: 'track.search', track: song.title, limit: '50' }), found);
  const lead = song.singers[0] ?? song.composers[0];
  if (!found.size && lead) addMatches(song, await lastfm({ method: 'track.search', track: song.title, artist: lead, limit: '30' }), found);
  return found.size ? [...found.values()].reduce((a, b) => a + b, 0) : null;
}

// ---------------------------------------------------------------- run
const curatedSongs = readJson(join(DATA, 'catalog.json'));
const addedSongs = existsSync(join(DATA, 'expanded.json')) ? readJson(join(DATA, 'expanded.json')) : [];
const songs = [...curatedSongs.map((s) => ({ ...s, curated: true })), ...addedSongs].slice(0, limit);
console.log(`Looking up ${songs.length} songs on Last.fm${offline ? ' (offline)' : ''}...`);
const t0 = Date.now();
let found = 0, done = 0;
const queue = [...songs];
async function worker() {
  for (let s; (s = queue.shift()); ) {
    s.listeners = await listenersFor(s);
    if (s.listeners !== null) found++;
    if (++done % 250 === 0 || done === songs.length) {
      const rate = (Date.now() - t0) / done;
      console.log(`  ${done}/${songs.length}  found ${found} | calls ${stats.calls} cached ${stats.cached} retries ${stats.retries} | eta ${Math.round((rate * (songs.length - done)) / 60000)} min`);
    }
  }
}
await Promise.all(Array.from({ length: 4 }, worker));

const cuts = cutsByDecade(songs.filter((s) => s.curated && s.listeners));
const out = {};
for (const s of songs) {
  if (!s.listeners) continue;
  out[s.id] = { listeners: s.listeners, tier: tierFor(cuts, s.year, s.listeners) };
}

const partial = limit < Infinity || offline && found < songs.length / 2;
if (partial) console.log('\nPartial run: data/popularity.json not written.');
else writeFileSync(join(DATA, 'popularity.json'), '{\n' + Object.entries(out).map(([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v)}`).join(',\n') + '\n}\n');

const curatedFound = songs.filter((s) => s.curated && s.listeners);
const agree = curatedFound.filter((s) => Math.abs(out[s.id].tier - s.tier) <= 1).length;
const addedTiers = Object.fromEntries([...Map.groupBy(songs.filter((s) => !s.curated && s.listeners), (s) => out[s.id].tier)].map(([t, xs]) => [t, xs.length]));
console.log(`\nDone in ${Math.round((Date.now() - t0) / 1000)}s: ${found}/${songs.length} songs found on Last.fm. `
  + `Curated tiers within one step of the listener tier: ${agree}/${curatedFound.length}. Added songs by tier: ${JSON.stringify(addedTiers)}. `
  + `${stats.calls} calls, ${stats.cached} cached.`);
for (const [d, c] of [...cuts].sort()) console.log(`  ${d}: tier cut points at ${c.map((x) => Math.round(Math.expm1(x))).join(' / ')} listeners`);

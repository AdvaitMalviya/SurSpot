// Per-song popularity from Last.fm: node --env-file=.env scripts/popularity.mjs [--offline] [--limit N]
// For every song in data/catalog.json and data/expanded.json, track.search finds Last.fm tracks with the same title
// (romanization-tolerant) credited to one of its singers or composers. Their listener counts are summed, because
// Bollywood songs are scrobbled under several artist spellings ("Arijit Singh", "Mithoon & Arijit Singh").
// Old songs have far fewer Last.fm listeners than new ones, so the curated tiers calibrate listeners decade by
// decade, and each song found gets a suggested tier. Writes data/popularity.json: { id: { listeners, tier } }.
// scripts/expand.mjs uses those tiers for the songs it adds; curated songs keep their hand-set tiers.
// The Last.fm client and the matching live in scripts/lastfm.mjs (shared with scripts/punjabi.mjs).
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA, readJson } from './lib.mjs';
import { lastfmStats as stats, listenersFor } from './lastfm.mjs';
import { cutsByDecade, tierFor } from './tiers.mjs';

const args = process.argv.slice(2);
const opt = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const offline = args.includes('--offline');
const limit = Number(opt('--limit')) || Infinity;
if (!process.env.LASTFM_API_KEY && !offline) {
  console.error('No Last.fm key. Put LASTFM_API_KEY=... in .env and run: node --env-file=.env scripts/popularity.mjs');
  process.exit(1);
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
    s.listeners = await listenersFor(s, { offline });
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

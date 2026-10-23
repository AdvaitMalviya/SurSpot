// Resolve the seed catalog to iTunes masters: node scripts/resolve.mjs [--offline] [--fresh] [--only 1990s] [--limit N]
// Each seed song is searched on iTunes (country=in) with up to three queries, stopping early once decide() is confident.
// Results are pooled across queries (best rank wins) so a master found by any query can be picked. Writes:
//   data/catalog.json       playable songs (high + low confidence) for the game
//   data/resolve-report.md  low-confidence and unresolved songs, for manual review
// data/overrides.json pins a master ({ "<song id>": { "trackId": 123 } }) or drops a song ({ "<song id>": { "skip": true } }).
import { readdirSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DATA, net, readJson, writeJson, writeJsonRows, itunesJson, searchUrl, lookupUrl, baseSongId, decadeOf, songContext, decide,
  hasLatin, stripDecorations, fmtDur, artwork600, throttleInterval,
} from './lib.mjs';

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const opt = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const offline = flag('--offline'), fresh = flag('--fresh');
const only = opt('--only'), limit = Number(opt('--limit')) || Infinity;

const SEED = join(DATA, 'seed');
const OVERRIDES = join(DATA, 'overrides.json');
const overrides = existsSync(OVERRIDES) ? readJson(OVERRIDES) : {};

let songs = readdirSync(SEED).filter((f) => f.endsWith('.json')).sort().flatMap((f) => readJson(join(SEED, f)));
const ids = new Map();
for (const s of songs) {
  let id = baseSongId(s);
  if (ids.has(id)) id += `-${s.year}`;
  ids.set(id, s);
  s.id = id;
}
if (only) songs = songs.filter((s) => decadeOf(s.year) === only);
// Best-known songs first, decades interleaved, so an interrupted run (or --offline on a partial cache)
// still yields a catalog that spans every era.
const byDecade = Map.groupBy(songs.sort((a, b) => a.tier - b.tier), (s) => `${s.tier}|${decadeOf(s.year)}`);
const ordered = [];
for (const tier of [1, 2, 3, 4]) {
  const queues = [...byDecade].filter(([k]) => k.startsWith(`${tier}|`)).map(([, v]) => [...v]);
  while (queues.some((q) => q.length)) for (const q of queues) if (q.length) ordered.push(q.shift());
}
songs = ordered.slice(0, limit);

// "Brahmastra Part One: Shiva" -> "Brahmastra"; long film names make iTunes return nothing
const shortFilm = (m) => m.split(/[:–—(]/)[0].trim();
function queries(s) {
  const t = stripDecorations(s.title) || s.title, film = shortFilm(s.movie);
  const alt = s.alt_titles.filter(hasLatin).map((a) => stripDecorations(a) || a).find((a) => a.toLowerCase() !== t.toLowerCase());
  const q = [`${t} ${film}`, `${t} ${s.singers[0]}`];
  if (alt) q.push(`${alt} ${film}`);
  return [...new Set(q)];
}

async function resolve(s) {
  const ctx = songContext(s);
  const pool = new Map(), raw = new Map();
  let result = null, used = 0;
  for (const term of queries(s)) {
    const body = await itunesJson(searchUrl(term), { offline, fresh });
    used++;
    (body?.results ?? []).forEach((r, rank) => {
      if (r.kind !== 'song' || !r.trackId) return;
      raw.set(r.trackId, r);
      const prev = pool.get(r.trackId);
      if (!prev || rank < prev.rank) pool.set(r.trackId, { r, rank });
    });
    result = decide(ctx, pool);
    if (result.status === 'high') break;
  }
  return { ...result, raw, queries: used };
}

async function pinned(trackIds) {
  const out = new Map();
  for (let i = 0; i < trackIds.length; i += 100) {
    const body = await itunesJson(lookupUrl(trackIds.slice(i, i + 100)), { offline, fresh });
    for (const r of body?.results ?? []) out.set(r.trackId, r);
  }
  return out;
}

const entry = (s, r, confidence) => ({
  id: s.id, title: s.title, alt_titles: s.alt_titles, movie: s.movie, year: s.year, singers: s.singers,
  composers: s.composers, tags: s.tags, tier: s.tier, trackId: r.trackId, preview: r.previewUrl,
  artwork: artwork600(r.artworkUrl100), appleUrl: r.trackViewUrl?.replace(/[?&]uo=\d+/, '') ?? null,
  durationMs: r.trackTimeMillis ?? null, confidence,
});

const catalog = [], low = [], unresolved = [], skipped = [];
const pins = await pinned(Object.values(overrides).map((o) => o.trackId).filter(Boolean));
const t0 = Date.now();
console.log(`Resolving ${songs.length} songs${offline ? ' (offline)' : ''}...`);

for (const [i, s] of songs.entries()) {
  const o = overrides[s.id];
  if (o?.skip) { skipped.push(s); continue; }
  if (o?.trackId) {
    const r = pins.get(o.trackId);
    if (r?.previewUrl) catalog.push(entry(s, r, 'pinned'));
    else unresolved.push({ s, reason: `pinned track ${o.trackId} has no preview`, best: null });
    continue;
  }
  let res;
  try { res = await resolve(s); } catch (e) { unresolved.push({ s, reason: String(e.message ?? e), best: null }); continue; }
  if (res.status === 'unresolved') unresolved.push({ s, reason: res.reason, best: res.best });
  else {
    catalog.push(entry(s, res.raw.get(res.pick.trackId), res.status));
    if (res.status === 'low') low.push({ s, why: res.why, pick: res.pick });
  }
  if ((i + 1) % 25 === 0 || i === songs.length - 1) {
    const done = i + 1, rate = (Date.now() - t0) / done;
    console.log(`  ${done}/${songs.length}  ok ${catalog.length}  low ${low.length}  unresolved ${unresolved.length}  `
      + `| calls ${net.calls} cached ${net.cacheHits} 429s ${net.throttled} | ${throttleInterval()} ms/call | eta ${Math.round(rate * (songs.length - done) / 60000)} min`);
  }
}

// two seed songs on one master is almost always a wrong pick for one of them
const byTrack = new Map();
for (const c of catalog) byTrack.set(c.trackId, [...(byTrack.get(c.trackId) ?? []), c.id]);
const dupes = [...byTrack.values()].filter((v) => v.length > 1);

if (only || limit < Infinity) console.log('\nPartial run: data/catalog.json not written.');
else {
  catalog.sort((a, b) => a.year - b.year || a.id.localeCompare(b.id));
  writeJsonRows(join(DATA, 'catalog.json'), catalog);
}

const md = (x) => String(x ?? '').replace(/\|/g, '\\|');
const line = (s) => `${md(s.title)} — *${md(s.movie)}* (${s.year})`;
const pickStr = (p) => (p ? `${md(p.title)} \\| ${md(p.artist)} \\| ${md(p.album)} \\| ${fmtDur(p.durationMs)} \\| ${p.trackId}` : '—');
const report = [
  '# Catalog resolution report', '',
  `Generated by \`node scripts/resolve.mjs\`. ${catalog.length} playable (${catalog.length - low.length} high/pinned, ${low.length} low), `
    + `${unresolved.length} unresolved, ${skipped.length} skipped by overrides.`, '',
  'Fix a wrong pick by pinning the right track in `data/overrides.json`, or drop the song with `{ "skip": true }`.', '',
  dupes.length ? `## Shared masters (${dupes.length})\n\n${dupes.map((d) => `- ${d.join(', ')}`).join('\n')}\n` : '',
  `## Unresolved (${unresolved.length})`, '', '| id | song | reason | closest |', '|---|---|---|---|',
  ...unresolved.map(({ s, reason, best }) => `| ${s.id} | ${line(s)} | ${md(reason)} | ${pickStr(best)} |`), '',
  `## Low confidence (${low.length})`, '', '| id | song | pick | why |', '|---|---|---|---|',
  ...low.map(({ s, pick, why }) => `| ${s.id} | ${line(s)} | ${pickStr(pick)} | ${md(why.join('; '))} |`), '',
].join('\n');
if (!only && limit === Infinity) writeFileSync(join(DATA, 'resolve-report.md'), report);
else console.log('\n' + report);

console.log(`\nDone in ${Math.round((Date.now() - t0) / 1000)}s: ${catalog.length} playable (${low.length} low), `
  + `${unresolved.length} unresolved, ${skipped.length} skipped, ${dupes.length} shared masters. `
  + `${net.calls} API calls, ${net.cacheHits} cache hits, ${net.throttled} throttled.`);

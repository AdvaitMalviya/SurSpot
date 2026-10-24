// Last.fm client shared by scripts/popularity.mjs and scripts/punjabi.mjs. Needs LASTFM_API_KEY in the environment
// (node --env-file=.env ...) unless every call is already cached.
// Replies are cached on disk in data/.cache/lastfm, named by a hash of the query without the key.
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DATA, sleep, readJson, writeJson, skeleton, stripDecorations, creditHits } from './lib.mjs';

const CACHE = join(DATA, '.cache', 'lastfm');
const UA = 'SurSpotCatalog/1.0 (https://github.com/Siddharth-Y26)';
export const lastfmStats = { calls: 0, cached: 0, retries: 0 };
let next = 0;

// Last.fm allows about five calls a second; error 29 means slow down, 11 and 16 are temporary.
// Calls overlap (a response takes about a second), so each one books its start slot 250 ms after the last.
// `offline` -> null for anything not cached.
export async function lastfm(params, { offline = false } = {}) {
  const query = new URLSearchParams({ ...params, format: 'json' }).toString();
  const file = join(CACHE, createHash('sha1').update(query).digest('hex').slice(0, 20) + '.json');
  if (existsSync(file)) { lastfmStats.cached++; return readJson(file); }
  if (offline) return null;
  const key = process.env.LASTFM_API_KEY;
  if (!key) throw new Error('No Last.fm key. Put LASTFM_API_KEY=... in .env and run the script with node --env-file=.env');
  for (let attempt = 1; attempt <= 6; attempt++) {
    const at = Math.max(Date.now(), next);
    next = at + 250;
    await sleep(at - Date.now());
    let body = null;
    try {
      const res = await fetch(`https://ws.audioscrobbler.com/2.0/?${query}&api_key=${key}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
      body = await res.json().catch(() => null);
      lastfmStats.calls++;
      if (res.ok && body && !body.error) { writeJson(file, body); return body; }
      if (body?.error === 10 || body?.error === 26) throw new Error(`Last.fm rejected the API key: ${body.message}`);
    } catch (e) {
      if (/API key/.test(e.message)) throw e;
    }
    lastfmStats.retries++;
    await sleep(2000 * attempt * (body?.error === 29 ? 3 : 1));
  }
  throw new Error(`Last.fm request failed: ${query}`);
}

// ---------------------------------------------------------------- listeners for one song
// track.search finds Last.fm tracks with the same title (romanization-tolerant) credited to one of the song's
// singers or composers. Their listener counts are summed, because Indian songs are scrobbled under several artist
// spellings ("Arijit Singh", "Mithoon & Arijit Singh").
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
// Returns the summed listeners, or null when Last.fm has no such track.
export async function listenersFor(song, opts = {}) {
  const found = new Map();
  addMatches(song, await lastfm({ method: 'track.search', track: song.title, limit: '50' }, opts), found);
  const lead = song.singers[0] ?? song.composers[0];
  if (!found.size && lead) addMatches(song, await lastfm({ method: 'track.search', track: song.title, artist: lead, limit: '30' }, opts), found);
  return found.size ? [...found.values()].reduce((a, b) => a + b, 0) : null;
}

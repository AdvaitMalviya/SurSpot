// Wikipedia's action API, cached on disk like the iTunes calls. Used by scripts/expand.mjs and scripts/english.mjs.
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DATA, sleep, readJson, writeJson } from './lib.mjs';

// Wikimedia allows 200 requests a minute to clients whose User-Agent carries contact details (10 without).
const UA = 'SurSpotCatalog/1.0 (https://github.com/Siddharth-Y26; song game catalog builder) node-fetch';
const WIKI_CACHE = join(DATA, '.cache', 'wiki');
// One request at a time, at least 350 ms apart (about 170 a minute); a 429 waits out its Retry-After.
// `offline` -> null for anything not cached; `fresh` -> skip the cache read (still writes it).
let lastWiki = 0;
export async function wiki(params, { offline = false, fresh = false } = {}) {
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

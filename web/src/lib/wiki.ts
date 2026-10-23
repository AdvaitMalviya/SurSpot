import type { Song } from './catalog';
import { load, save } from './storage';

// Film card for the reveal, from Wikipedia's free REST summary API (CORS-enabled, no key).
export interface Film { title: string; extract: string; thumb: string | null; url: string }

const HEADERS = { 'Api-User-Agent': 'SurSpot/1.0 (Bollywood song guessing game)' };
const memo = new Map<string, Promise<Film | null>>();

// A page counts when it is about a film from the song's year (±1, release dates vary).
async function summary(page: string, year: number) {
  const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(page.replace(/ /g, '_'))}`, { headers: HEADERS });
  if (!res.ok) return null;
  const d = await res.json();
  const text = `${d.description ?? ''} ${d.extract ?? ''}`;
  if (d.type !== 'standard' || !/\bfilm\b/i.test(text) || ![year - 1, year, year + 1].some((y) => text.includes(String(y)))) return null;
  return {
    title: d.title as string,
    extract: (d.extract as string).split(/(?<=\.)\s+/).slice(0, 2).join(' '),
    thumb: d.thumbnail?.source ?? null,
    url: d.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(d.title)}`,
  } satisfies Film;
}

export function filmInfo(song: Song): Promise<Film | null> {
  if (song.tags.includes('non-film')) return Promise.resolve(null);
  const key = `${song.movie}|${song.year}`;
  const cached = load<Record<string, Film | null>>('wiki', {})[key];
  if (cached !== undefined) return Promise.resolve(cached);
  let p = memo.get(key);
  if (!p) {
    p = (async () => {
      for (const page of [`${song.movie} (${song.year} film)`, `${song.movie} (film)`, song.movie]) {
        const f = await summary(page, song.year).catch(() => null);
        if (f) return f;
      }
      return null;
    })();
    p.then((f) => f && save('wiki', { ...load<Record<string, Film | null>>('wiki', {}), [key]: f }));
    memo.set(key, p);
  }
  return p;
}

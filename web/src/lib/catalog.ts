import catalogUrl from '../../../data/catalog.json?url';
import expandedUrl from '../../../data/expanded.json?url';
import punjabiUrl from '../../../data/punjabi.json?url';

// One playable song: a curated seed entry with the iTunes master picked by scripts/resolve.mjs, or ('auto')
// a soundtrack track added by scripts/expand.mjs, or a Punjabi song added by scripts/punjabi.mjs (tagged 'punjabi').
export interface Song {
  id: string;
  title: string;
  alt_titles: string[];
  movie: string;
  year: number;
  singers: string[];
  composers: string[];
  tags: string[];
  tier: 1 | 2 | 3 | 4;
  trackId: number;
  preview: string;
  artwork: string | null;
  appleUrl: string | null;
  durationMs: number | null;
  confidence: 'high' | 'low' | 'pinned' | 'auto';
}

// Curated songs first, then the expanded and the Punjabi ones; a song that shares an earlier list's iTunes track is dropped.
export async function loadCatalog(): Promise<Song[]> {
  const lists = await Promise.all([catalogUrl, expandedUrl, punjabiUrl].map(async (url) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`catalog ${res.status}`);
    return (await res.json()) as Song[];
  }));
  const tracks = new Set<number>();
  const out: Song[] = [];
  for (const list of lists) {
    const fresh = list.filter((s) => !tracks.has(s.trackId));
    for (const s of fresh) tracks.add(s.trackId);
    out.push(...fresh);
  }
  return out;
}

export const decadeOf = (year: number) => Math.floor(year / 10) * 10;
export const decadeLabel = (d: number) => (d < 2000 ? `${d % 100}s` : `${d}s`);
export const isFilm = (s: Song) => !s.tags.includes('non-film');
export const isPunjabi = (s: Song) => s.tags.includes('punjabi');
// "Brown Munde" is a single: no film or album to name.
export const sourceLabel = (s: Song) => `${s.movie || 'Single'}, ${s.year}`;
export const devanagariTitle = (s: Song) => s.alt_titles.find((t) => /[ऀ-ॿ]/.test(t)) ?? null;

// One difficulty per popularity tier: tier 1 is the songs everyone knows, tier 4 the deep cuts.
// A pool can mix several; none picked means any.
export const LEVELS = {
  easy: { label: 'Easy', tier: 1 },
  medium: { label: 'Medium', tier: 2 },
  hard: { label: 'Hard', tier: 3 },
  expert: { label: 'Expert', tier: 4 },
} as const;
export type Level = keyof typeof LEVELS;

export const LANGUAGES = { all: 'Hindi and Punjabi', hindi: 'Hindi', punjabi: 'Punjabi' } as const;
export type Language = keyof typeof LANGUAGES;

export interface Pool {
  decades: number[];
  tags: string[];
  levels: Level[];
  artist: string | null;
  language: Language;
}
export const DEFAULT_POOL: Pool = { decades: [], tags: [], levels: ['easy', 'medium'], artist: null, language: 'all' };

export const inLanguage = (s: Song, l: Language) => l === 'all' || (l === 'punjabi') === isPunjabi(s);
export function inPool(s: Song, p: Pool) {
  if (!inLanguage(s, p.language)) return false;
  if (p.decades.length && !p.decades.includes(decadeOf(s.year))) return false;
  if (p.tags.length && !s.tags.some((t) => p.tags.includes(t))) return false;
  if (p.levels.length && !p.levels.some((l) => LEVELS[l]?.tier === s.tier)) return false;
  if (p.artist && !s.singers.includes(p.artist) && !s.composers.includes(p.artist)) return false;
  return true;
}

// Singers and composers with enough songs to make a playable artist pool.
export function artists(songs: Song[], min = 12) {
  const n = new Map<string, number>();
  for (const s of songs) for (const a of new Set([...s.singers, ...s.composers])) n.set(a, (n.get(a) ?? 0) + 1);
  return [...n].filter(([, c]) => c >= min).sort((a, b) => a[0].localeCompare(b[0]));
}

export function tagCounts(songs: Song[]) {
  const n = new Map<string, number>();
  for (const s of songs) for (const t of s.tags) if (t !== 'punjabi') n.set(t, (n.get(t) ?? 0) + 1); // a language, not a mood
  return [...n].sort((a, b) => b[1] - a[1]);
}

// ------------------------------------------------------------------ randomness
export function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function shuffle<T>(xs: T[], rand: () => number = Math.random) {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ------------------------------------------------------------------ daily
// The daily song changes at midnight IST and is the same for everyone. Days walk a fixed shuffle of
// the well-known, confidently matched curated songs, so nothing repeats until the whole list has been used.
const DAY_ONE = Date.UTC(2026, 9, 24);
export function istDate(now = Date.now()) {
  return new Date(now + 5.5 * 3600e3).toISOString().slice(0, 10);
}
export function dayNumber(date: string) {
  const [y, m, d] = date.split('-').map(Number);
  return Math.floor((Date.UTC(y, m - 1, d) - DAY_ONE) / 864e5) + 1;
}
export function dailySong(songs: Song[], date: string) {
  const pool = songs.filter((s) => s.tier <= 2 && (s.confidence === 'high' || s.confidence === 'pinned')).sort((a, b) => a.id.localeCompare(b.id));
  const order = shuffle(pool, mulberry32(0x5e12));
  const n = dayNumber(date);
  return { song: order[(((n - 1) % order.length) + order.length) % order.length], number: n };
}
export function msToNextDay(now = Date.now()) {
  const ist = now + 5.5 * 3600e3;
  return 864e5 - (ist % 864e5);
}

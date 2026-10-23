import catalogUrl from '../../../data/catalog.json?url';
import expandedUrl from '../../../data/expanded.json?url';

// One playable song: a curated seed entry with the iTunes master picked by scripts/resolve.mjs, or ('auto')
// a soundtrack track added by scripts/expand.mjs.
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

// Curated songs first; an expanded song that shares their iTunes track is dropped.
export async function loadCatalog(): Promise<Song[]> {
  const [seed, extra] = await Promise.all([catalogUrl, expandedUrl].map(async (url) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`catalog ${res.status}`);
    return (await res.json()) as Song[];
  }));
  const tracks = new Set(seed.map((s) => s.trackId));
  return [...seed, ...extra.filter((s) => !tracks.has(s.trackId))];
}

export const decadeOf = (year: number) => Math.floor(year / 10) * 10;
export const decadeLabel = (d: number) => (d < 2000 ? `${d % 100}s` : `${d}s`);
export const isFilm = (s: Song) => !s.tags.includes('non-film');
export const devanagariTitle = (s: Song) => s.alt_titles.find((t) => /[ऀ-ॿ]/.test(t)) ?? null;

// Tier 1 is the songs everyone knows; tier 4 the deep cuts.
export const LEVELS = {
  easy: { label: 'Easy', tiers: [1] },
  medium: { label: 'Medium', tiers: [1, 2] },
  hard: { label: 'Hard', tiers: [2, 3] },
  expert: { label: 'Expert', tiers: [3, 4] },
  any: { label: 'Any', tiers: [1, 2, 3, 4] },
} as const;
export type Level = keyof typeof LEVELS;

export interface Pool {
  decades: number[];
  tags: string[];
  level: Level;
  artist: string | null;
}
export const DEFAULT_POOL: Pool = { decades: [], tags: [], level: 'medium', artist: null };

export function inPool(s: Song, p: Pool) {
  if (p.decades.length && !p.decades.includes(decadeOf(s.year))) return false;
  if (p.tags.length && !s.tags.some((t) => p.tags.includes(t))) return false;
  if (!(LEVELS[p.level].tiers as readonly number[]).includes(s.tier)) return false;
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
  for (const s of songs) for (const t of s.tags) n.set(t, (n.get(t) ?? 0) + 1);
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

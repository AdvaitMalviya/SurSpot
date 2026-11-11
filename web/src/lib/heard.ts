import { shuffle, type Song } from './catalog';
import { load, save } from './storage';

// The songs this browser has played, oldest first, so a song doesn't come round again before the rest of the pool
// has: Play, Quick pick and a host's room draw from the songs not heard yet, and once a pool has none left, from the
// older half of the ones heard, in no set order. The list outlasts a reload, a switch of mode and the next visit,
// and keeps the last CAP songs.
const CAP = 5000;
const stored = load('heard', { ids: [] as string[] }).ids;
let heard: string[] = Array.isArray(stored) ? stored.filter((x) => typeof x === 'string') : [];
let order: Map<string, number> | null = null;
const rank = () => (order ??= new Map(heard.map((id, i) => [id, i])));

export function markHeard(id: string) {
  heard = [...heard.filter((x) => x !== id), id].slice(-CAP);
  order = null;
  save('heard', { ids: heard });
}

export const heardCount = (songs: Song[]) => { const r = rank(); return songs.reduce((n, s) => n + (r.has(s.id) ? 1 : 0), 0); };

// Songs in the order to play them: the unheard in random order, then the older half of the heard, then the newer half.
export function freshFirst(songs: Song[]): Song[] {
  const r = rank();
  const old = songs.filter((s) => r.has(s.id)).sort((a, b) => r.get(a.id)! - r.get(b.id)!);
  const half = Math.ceil(old.length / 2);
  return [...shuffle(songs.filter((s) => !r.has(s.id))), ...shuffle(old.slice(0, half)), ...shuffle(old.slice(half))];
}

// The next song for Play; never `avoid`, the song on screen, unless it is the only one.
export function pickFresh(songs: Song[], avoid?: string): Song | null {
  const r = rank();
  const fresh = songs.filter((s) => !r.has(s.id) && s.id !== avoid);
  if (fresh.length) return fresh[Math.floor(Math.random() * fresh.length)];
  const old = songs.filter((s) => s.id !== avoid).sort((a, b) => r.get(a.id)! - r.get(b.id)!);
  const from = old.slice(0, Math.ceil(old.length / 2));
  return from.length ? from[Math.floor(Math.random() * from.length)] : songs[0] ?? null;
}

import type { Song } from './catalog';

// Song search that forgives Hindi romanization: "pehla nasha", "pahla nashaa" and "पहला नशा" all find the same song.
// The skeleton rules mirror scripts/lib.mjs so the game and the catalog pipeline agree on what counts as a match.
const WORD_ALIAS: Record<string, string> = {
  mein: 'me', main: 'me', men: 'me', mai: 'me', hain: 'hai', he: 'hai', hae: 'hai', ae: 'e', aye: 'e', ai: 'e', ay: 'e',
};
function wordSkeleton(w: string) {
  if (WORD_ALIAS[w]) return WORD_ALIAS[w];
  if (/[ऀ-ॿ]/.test(w)) return w;
  let x = w;
  x = x.replace(/w/g, 'v').replace(/z/g, 'j').replace(/q/g, 'k').replace(/ph/g, 'f').replace(/x/g, 'ks');
  x = x.replace(/chh/g, 'ch').replace(/ey$/, 'e');
  x = x.replace(/ee/g, 'i').replace(/oo/g, 'u').replace(/aa+/g, 'a').replace(/ii/g, 'i').replace(/uu/g, 'u');
  x = x.replace(/([aeiou])h$/, '$1');
  x = x.replace(/([aeiou])n$/, '$1');
  x = x.replace(/([b-df-hj-np-tv-z])\1+/g, '$1');
  return WORD_ALIAS[x] ?? x;
}
export function norm(s: string) {
  return s.normalize('NFKD').replace(/[̀-़ͯ]/g, '').toLowerCase()
    .replace(/['’`´]/g, '').replace(/&/g, ' and ')
    .replace(/[^a-z0-9ऀ-ॿ]+/g, ' ').trim();
}
interface Tok { raw: string; skel: string }
const tokens = (s: string): Tok[] => norm(s).split(' ').filter(Boolean).map((raw) => ({ raw, skel: wordSkeleton(raw) }));
const tokHit = (q: Tok, t: Tok, last: boolean) =>
  last ? t.raw.startsWith(q.raw) || t.skel.startsWith(q.skel) : t.raw === q.raw || t.skel === q.skel;

interface Entry { song: Song; titles: Tok[][]; movie: Tok[] }
export function buildIndex(songs: Song[]): Entry[] {
  return songs.map((song) => ({ song, titles: [song.title, ...song.alt_titles].map(tokens), movie: tokens(song.movie) }));
}

// Every query word must appear (the last one may be half-typed); titles beat films, famous songs break ties.
export function search(index: Entry[], query: string, limit = 8): Song[] {
  const q = tokens(query);
  if (!q.length) return [];
  const scored: { song: Song; score: number }[] = [];
  for (const e of index) {
    const all = [...e.titles.flat(), ...e.movie];
    if (!q.every((qt, i) => all.some((t) => tokHit(qt, t, i === q.length - 1)))) continue;
    let score = 0;
    for (const title of e.titles) {
      const inTitle = q.filter((qt, i) => title.some((t) => tokHit(qt, t, i === q.length - 1))).length;
      const prefix = q.every((qt, i) => title[i] && tokHit(qt, title[i], i === q.length - 1));
      score = Math.max(score, inTitle * 2 + (prefix ? 4 : 0) + (inTitle === q.length ? 2 : 0));
    }
    if (q.every((qt, i) => e.movie.some((t) => tokHit(qt, t, i === q.length - 1)))) score += 1;
    scored.push({ song: e.song, score: score - e.song.tier * 0.3 });
  }
  return scored.sort((a, b) => b.score - a.score || a.song.year - b.song.year).slice(0, limit).map((x) => x.song);
}

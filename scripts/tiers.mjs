// Popularity tiers from Last.fm listener counts, calibrated against the hand-set tiers of the curated songs.
// Used by scripts/popularity.mjs (the Hindi catalog) and scripts/punjabi.mjs.
import { decadeOf } from './lib.mjs';

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };

// Cut points between tiers per decade, in log-listeners: halfway between neighbouring curated tier medians.
// A tier with fewer than six curated songs in a decade borrows the overall median, shifted to that decade's level.
// `curated` is [{ year, tier, listeners }].
export function cutsByDecade(curated) {
  const log = (s) => Math.log1p(s.listeners);
  const overall = median(curated.map(log));
  const globalTier = [1, 2, 3, 4].map((t) => median(curated.filter((s) => s.tier === t).map(log)));
  const cuts = new Map();
  for (const [d, ss] of Map.groupBy(curated, (s) => decadeOf(s.year))) {
    const shift = median(ss.map(log)) - overall;
    const m = [1, 2, 3, 4].map((t, i) => {
      const xs = ss.filter((s) => s.tier === t).map(log);
      return xs.length >= 6 ? median(xs) : globalTier[i] + shift;
    });
    for (let i = 1; i < 4; i++) m[i] = Math.min(m[i], m[i - 1]);
    cuts.set(d, [0, 1, 2].map((i) => (m[i] + m[i + 1]) / 2));
  }
  return cuts;
}

// The tier for a listener count, using its decade's cut points (or the nearest decade that has some).
export function tierFor(cuts, year, listeners) {
  const decades = [...cuts.keys()].sort();
  const d = decadeOf(year);
  const c = cuts.get(d) ?? cuts.get(decades.findLast((k) => k <= d) ?? decades[0]);
  const x = Math.log1p(listeners);
  return x >= c[0] ? 1 : x >= c[1] ? 2 : x >= c[2] ? 3 : 4;
}

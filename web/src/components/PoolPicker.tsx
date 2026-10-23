import { useEffect, useMemo, useRef } from 'react';
import { LEVELS, artists, decadeLabel, inPool, tagCounts, type Level, type Pool, type Song } from '../lib/catalog';

const DECADES = [1950, 1960, 1970, 1980, 1990, 2000, 2010, 2020];
const TAG_NAMES: Record<string, string> = {
  'non-film': 'Non-film', item: 'Item numbers', indipop: 'Indipop', rap: 'Rap', qawwali: 'Qawwali',
};
const tagName = (t: string) => TAG_NAMES[t] ?? t[0].toUpperCase() + t.slice(1);
const toggle = <T,>(xs: T[], x: T) => (xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x]);

export function describePool(p: Pool) {
  return [
    p.decades.length ? p.decades.slice().sort().map(decadeLabel).join(', ') : 'All eras',
    ...(p.tags.length ? [p.tags.map(tagName).join(', ').toLowerCase()] : []),
    ...(p.artist ? [p.artist] : []),
    `${LEVELS[p.level].label.toLowerCase()} difficulty`,
  ].join('; ');
}

// Narrow the songs a game draws from: by decade, mood, how well known they are, and singer or composer.
export function PoolPicker({ songs, pool, onChange }: { songs: Song[]; pool: Pool; onChange: (p: Pool) => void }) {
  const count = useMemo(() => songs.filter((s) => inPool(s, pool)).length, [songs, pool]);
  const tags = useMemo(() => tagCounts(songs).filter(([t]) => t !== 'non-film'), [songs]);
  const people = useMemo(() => artists(songs), [songs]);

  // Opens as a dropdown over the game; a click outside or Escape closes it.
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (e: Event) => {
      const d = ref.current;
      if (d?.open && (e instanceof KeyboardEvent ? e.key === 'Escape' : !d.contains(e.target as Node))) d.open = false;
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', close); };
  }, []);

  return (
    <details className="pool" ref={ref}>
      <summary>
        <span className="pool-count">{count} songs</span>
        <span className="pool-desc">{describePool(pool)}</span>
        <span className="pool-edit">Change songs</span>
      </summary>
      <div className="pool-body">
        <fieldset>
          <legend>Era</legend>
          <div className="chips">
            <button type="button" className="chip" aria-pressed={!pool.decades.length} onClick={() => onChange({ ...pool, decades: [] })}>All</button>
            {DECADES.map((d) => (
              <button key={d} type="button" className="chip" aria-pressed={pool.decades.includes(d)}
                onClick={() => onChange({ ...pool, decades: toggle(pool.decades, d) })}>{decadeLabel(d)}</button>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>Mood</legend>
          <div className="chips">
            <button type="button" className="chip" aria-pressed={!pool.tags.length} onClick={() => onChange({ ...pool, tags: [] })}>Any</button>
            {tags.map(([t]) => (
              <button key={t} type="button" className="chip" aria-pressed={pool.tags.includes(t)}
                onClick={() => onChange({ ...pool, tags: toggle(pool.tags, t) })}>{tagName(t)}</button>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>How well known</legend>
          <div className="segmented">
            {(Object.keys(LEVELS) as Level[]).map((l) => (
              <label key={l}>
                <input type="radio" name="level" checked={pool.level === l} onChange={() => onChange({ ...pool, level: l })} />
                <span>{LEVELS[l].label}</span>
              </label>
            ))}
          </div>
          <p className="pool-note">Easy sticks to the songs everyone knows. Expert digs into deep cuts.</p>
        </fieldset>
        <label className="pool-artist">
          <span>Singer or composer</span>
          <select value={pool.artist ?? ''} onChange={(e) => onChange({ ...pool, artist: e.target.value || null })}>
            <option value="">Anyone</option>
            {people.map(([name, n]) => <option key={name} value={name}>{name} ({n})</option>)}
          </select>
        </label>
        <button type="button" className="btn btn-primary pool-done" onClick={() => { if (ref.current) ref.current.open = false; }}>
          Play {count} songs
        </button>
        {count < 10 && (
          <p className="pool-warn" role="status">
            {count ? `Only ${count} songs match, so they will repeat soon.` : 'No songs match.'} Add an era or mood, or pick an easier level.
          </p>
        )}
      </div>
    </details>
  );
}

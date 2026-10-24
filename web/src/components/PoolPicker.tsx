import { useEffect, useMemo, useRef } from 'react';
import { LANGUAGES, LEVELS, artists, decadeLabel, inLanguage, inPool, tagCounts, type Language, type Level, type Pool, type Song } from '../lib/catalog';

const DECADES = [1950, 1960, 1970, 1980, 1990, 2000, 2010, 2020];
const TAG_NAMES: Record<string, string> = {
  'non-film': 'Non-film', item: 'Item numbers', indipop: 'Indipop', rap: 'Rap', qawwali: 'Qawwali',
};
const tagName = (t: string) => TAG_NAMES[t] ?? t[0].toUpperCase() + t.slice(1);
const toggle = <T,>(xs: T[], x: T) => (xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x]);

export function describePool(p: Pool) {
  return [
    p.decades.length ? p.decades.slice().sort().map(decadeLabel).join(', ') : 'All eras',
    ...(p.tags.length ? [p.tags.map(tagName).join(' or ').toLowerCase()] : []),
    ...(p.artist ? [p.artist] : []),
    ...(p.language !== 'all' ? [`${LANGUAGES[p.language]} only`] : []),
    p.levels.length && p.levels.length < 4
      ? `${(Object.keys(LEVELS) as Level[]).filter((l) => p.levels.includes(l)).map((l) => LEVELS[l].label.toLowerCase()).join(' and ')} songs`
      : 'any difficulty',
  ].join(' · ');
}

// Narrow the songs a game draws from: by decade, mood, how well known they are, language, and singer or composer.
// Moods and artists follow the language (Punjabi songs carry no moods), keeping whatever is already picked.
export function PoolPicker({ songs, pool, onChange }: { songs: Song[]; pool: Pool; onChange: (p: Pool) => void }) {
  const count = useMemo(() => songs.filter((s) => inPool(s, pool)).length, [songs, pool]);
  const spoken = useMemo(() => songs.filter((s) => inLanguage(s, pool.language)), [songs, pool.language]);
  const tags = useMemo(() => {
    const all = tagCounts(spoken).filter(([t]) => t !== 'non-film');
    return [...all, ...pool.tags.filter((t) => !all.some(([u]) => u === t)).map((t) => [t, 0] as [string, number])];
  }, [spoken, pool.tags]);
  const people = useMemo(() => {
    const all = artists(spoken);
    return pool.artist && !all.some(([a]) => a === pool.artist) ? [...all, [pool.artist, 0] as [string, number]] : all;
  }, [spoken, pool.artist]);

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
        {tags.length > 0 && <fieldset>
          <legend>Mood</legend>
          <div className="chips">
            <button type="button" className="chip" aria-pressed={!pool.tags.length} onClick={() => onChange({ ...pool, tags: [] })}>Any</button>
            {tags.map(([t]) => (
              <button key={t} type="button" className="chip" aria-pressed={pool.tags.includes(t)}
                onClick={() => onChange({ ...pool, tags: toggle(pool.tags, t) })}>{tagName(t)}</button>
            ))}
          </div>
        </fieldset>}
        <fieldset>
          <legend>How well known</legend>
          <div className="chips">
            <button type="button" className="chip" aria-pressed={!pool.levels.length} onClick={() => onChange({ ...pool, levels: [] })}>Any</button>
            {(Object.keys(LEVELS) as Level[]).map((l) => (
              <button key={l} type="button" className="chip" aria-pressed={pool.levels.includes(l)}
                onClick={() => onChange({ ...pool, levels: toggle(pool.levels, l) })}>{LEVELS[l].label}</button>
            ))}
          </div>
          <p className="pool-note">Pick one or more. Easy sticks to the songs everyone knows; Expert digs into deep cuts.</p>
        </fieldset>
        <fieldset>
          <legend>Language</legend>
          <div className="segmented">
            {(Object.keys(LANGUAGES) as Language[]).map((l) => (
              <label key={l}>
                <input type="radio" name="language" checked={pool.language === l} onChange={() => onChange({ ...pool, language: l })} />
                <span>{LANGUAGES[l]}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <label className="pool-artist">
          <span>Singer or composer</span>
          <select value={pool.artist ?? ''} onChange={(e) => onChange({ ...pool, artist: e.target.value || null })}>
            <option value="">Anyone</option>
            {people.map(([name]) => <option key={name} value={name}>{name}</option>)}
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

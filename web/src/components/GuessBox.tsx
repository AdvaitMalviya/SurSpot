import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { artworkAt, sourceLabel, type Song } from '../lib/catalog';
import { search, type buildIndex } from '../lib/search';

interface Props {
  index: ReturnType<typeof buildIndex>;
  exclude: string[];
  disabled?: boolean;
  onGuess: (song: Song) => void;
  children?: ReactNode; // extra actions beside the Guess button (Skip)
}

// Combobox over the whole catalog, so the suggestions never narrow down to the current pool.
// The guess box sits at the bottom of the round, so suggestions open upward over the tries, best match
// nearest the input; the up arrow moves away from it, to the next match.
// Guessing takes two steps so a stray Enter can't spend a try: Enter (or a click) picks a suggestion, which
// shows its cover in the field, and only then does Guess (or Enter again) send it.
export function GuessBox({ index, exclude, disabled, onGuess, children }: Props) {
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Song | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();

  const results = useMemo(
    () => (picked ? [] : search(index, query, 8).filter((s) => !exclude.includes(s.id))),
    [index, query, picked, exclude],
  );
  const showList = open && !picked && query.trim().length > 0;

  const choose = (s: Song) => {
    setPicked(s);
    setQuery(`${s.title} (${s.movie || s.singers[0] || 'Single'})`);
    setOpen(false);
  };
  const submit = () => {
    if (!picked) return;
    onGuess(picked);
    setPicked(null); setQuery('');
    input.current?.focus();
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !picked) { e.preventDefault(); if (results[active]) choose(results[active]); }
    else if (e.key === 'ArrowUp' && results.length) { e.preventDefault(); setOpen(true); setActive((a) => (a + 1) % results.length); }
    else if (e.key === 'ArrowDown' && results.length) { e.preventDefault(); setActive((a) => (a - 1 + results.length) % results.length); }
    else if (e.key === 'Escape') setOpen(false);
  };
  useEffect(() => {
    if (showList) document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active, showList, listId]);

  return (
    <form className="guess" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <div className="guess-field">
        <span className="guess-lead" aria-hidden="true">
          {picked?.artwork ? <img src={artworkAt(picked, 96)!} alt="" />
            : <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></svg>}
        </span>
        <input
          ref={input}
          type="text"
          role="combobox"
          aria-label="Song or film"
          aria-expanded={showList && results.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && results[active] ? `${listId}-${active}` : undefined}
          placeholder="Type a song or film"
          autoComplete="off"
          spellCheck={false}
          value={query}
          disabled={disabled}
          onChange={(e) => { setQuery(e.target.value); setPicked(null); setOpen(true); setActive(0); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKey}
        />
        {showList && (
          <ul id={listId} role="listbox" className="suggest">
            {results.map((s, i) => (
              <li key={s.id} id={`${listId}-${i}`} role="option" aria-selected={i === active}
                onMouseDown={(e) => { e.preventDefault(); choose(s); }} onMouseEnter={() => setActive(i)}>
                <span className="suggest-art">{s.artwork && <img src={artworkAt(s, 96)!} alt="" decoding="async" />}</span>
                <span className="suggest-text">
                  <span className="suggest-title">{s.title}</span>
                  <span className="suggest-film">{s.movie ? sourceLabel(s) : `${s.singers[0] ?? 'Single'}, ${s.year}`}</span>
                </span>
              </li>
            ))}
            {!results.length && <li className="suggest-empty">Nothing matches “{query.trim()}”. Try the film’s name or another spelling.</li>}
          </ul>
        )}
      </div>
      <div className="guess-actions">
        {children}
        <button type="submit" className="btn btn-primary" disabled={disabled || !picked}>Guess</button>
      </div>
    </form>
  );
}

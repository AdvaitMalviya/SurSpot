import { useCallback, useEffect, useMemo, useState } from 'react';
import { ClipRound } from '../components/ClipRound';
import { PoolPicker } from '../components/PoolPicker';
import { Reveal } from '../components/Reveal';
import { loadClip } from '../lib/audio';
import { inPool, type Pool, type Song } from '../lib/catalog';
import { POINTS, gaveUp, outcome, type Attempt } from '../lib/game';
import { markHeard, pickFresh } from '../lib/heard';
import type { buildIndex } from '../lib/search';
import { recordEndless } from '../lib/stats';
import { trackSong } from '../lib/track';

interface Props {
  songs: Song[];
  index: ReturnType<typeof buildIndex>;
  pool: Pool;
  onPool: (p: Pool) => void;
  pending?: boolean; // the pool asks for English songs that are still loading; they join the draw when they arrive
}

// Unlimited songs from the chosen pool, with a running score and a run of consecutive solves.
export function Endless({ songs, index, pool, onPool, pending }: Props) {
  const candidates = useMemo(() => songs.filter((s) => inPool(s, pool)), [songs, pool]);
  // Songs already heard, here or in another mode, wait until the rest of the pool has played (lib/heard.ts).
  const pick = useCallback((avoid?: string) => pickFresh(candidates, avoid), [candidates]);

  const [song, setSong] = useState<Song | null>(() => pick());
  const [next, setNext] = useState<Song | null>(null);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [run, setRun] = useState({ score: 0, streak: 0, played: 0, solved: 0 });

  // A pool change only replaces the current song when it no longer fits.
  useEffect(() => {
    if (!song || !candidates.some((s) => s.id === song.id)) { setSong(pick()); setAttempts([]); }
  }, [candidates]);

  // Previews take a few seconds to download, so the next song starts loading as soon as a round begins.
  useEffect(() => {
    const n = song ? pick(song.id) : null;
    setNext(n);
    if (n) loadClip(n).catch(() => {});
  }, [song, pick]);

  const onAttempt = (...a: Attempt[]) => {
    if (!song) return;
    const all = [...attempts, ...a];
    setAttempts(all);
    const o = outcome(all);
    if (o === 'playing') return;
    const won = o === 'won';
    const r = { score: run.score + (won ? POINTS[all.length - 1] : 0), streak: won ? run.streak + 1 : 0, played: run.played + 1, solved: run.solved + (won ? 1 : 0) };
    setRun(r);
    recordEndless(won, r.streak, r.score);
    trackSong({ mode: 'play', song: song.id, won, tries: all.length });
    markHeard(song.id);
  };
  const goNext = () => { setSong(next ?? pick(song?.id)); setAttempts([]); };
  // A song whose preview won't load counts as heard too, so it doesn't come straight back.
  const skip = () => { if (song) markHeard(song.id); goNext(); };

  const o = outcome(attempts);
  const tries = attempts.length;
  return (
    <div className="mode">
      <div className="toolbar">
        <PoolPicker songs={songs} pool={pool} onChange={onPool} pending={pending} />
        {run.played > 0 && (
          <div className="scoreline" aria-live="polite">
            <span><b>{run.score}</b> points</span>
            <span><b>{run.solved}</b> of {run.played} solved</span>
            <span>Run of <b>{run.streak}</b></span>
          </div>
        )}
      </div>
      {song ? (
        <ClipRound key={song.id} song={song} index={index} attempts={attempts} onAttempt={onAttempt} onSkipSong={skip} prefer={pool.languages}
          reveal={
            <Reveal song={song}
              headline={o === 'won' ? (tries === 1 ? 'First try!' : `Got it on try ${tries}`)
                : `${gaveUp(attempts) ? 'You gave up.' : 'Out of tries.'} It was this one.`}
              detail={o === 'won' ? `+${POINTS[tries - 1]} points` : undefined}>
              <button type="button" className="btn btn-primary" onClick={goNext} autoFocus>Next song</button>
            </Reveal>
          } />
      ) : (
        <p className="empty">{pending ? 'Loading the English songs…' : 'No songs match this pool. Open the pool above and add an era or mood.'}</p>
      )}
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ClipRound } from '../components/ClipRound';
import { PoolPicker } from '../components/PoolPicker';
import { Reveal } from '../components/Reveal';
import { loadClip } from '../lib/audio';
import { inPool, type Pool, type Song } from '../lib/catalog';
import { POINTS, outcome, type Attempt } from '../lib/game';
import type { buildIndex } from '../lib/search';
import { recordEndless } from '../lib/stats';

interface Props {
  songs: Song[];
  index: ReturnType<typeof buildIndex>;
  pool: Pool;
  onPool: (p: Pool) => void;
}

// Unlimited songs from the chosen pool, with a running score and a run of consecutive solves.
export function Endless({ songs, index, pool, onPool }: Props) {
  const candidates = useMemo(() => songs.filter((s) => inPool(s, pool)), [songs, pool]);
  const recent = useRef<string[]>([]);
  const pick = useCallback((avoid?: string): Song | null => {
    const fresh = candidates.filter((s) => !recent.current.includes(s.id) && s.id !== avoid);
    const from = fresh.length ? fresh : candidates.filter((s) => s.id !== avoid);
    return from.length ? from[Math.floor(Math.random() * from.length)] : candidates[0] ?? null;
  }, [candidates]);

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

  const onAttempt = (a: Attempt) => {
    if (!song) return;
    const all = [...attempts, a];
    setAttempts(all);
    const o = outcome(all);
    if (o === 'playing') return;
    const won = o === 'won';
    const r = { score: run.score + (won ? POINTS[all.length - 1] : 0), streak: won ? run.streak + 1 : 0, played: run.played + 1, solved: run.solved + (won ? 1 : 0) };
    setRun(r);
    recordEndless(won, r.streak, r.score);
    recent.current = [song.id, ...recent.current].slice(0, Math.floor(candidates.length / 2));
  };
  const goNext = () => { setSong(next ?? pick(song?.id)); setAttempts([]); };

  const o = outcome(attempts);
  const tries = attempts.length;
  return (
    <div className="mode">
      <div className="toolbar">
        <PoolPicker songs={songs} pool={pool} onChange={onPool} />
        {run.played > 0 && (
          <div className="scoreline" aria-live="polite">
            <span><b>{run.score}</b> points</span>
            <span><b>{run.solved}</b> of {run.played} solved</span>
            <span>Run of <b>{run.streak}</b></span>
          </div>
        )}
      </div>
      {song ? (
        <ClipRound key={song.id} song={song} index={index} attempts={attempts} onAttempt={onAttempt} onSkipSong={goNext}
          reveal={
            <Reveal song={song}
              headline={o === 'won' ? (tries === 1 ? 'First try!' : `Got it on try ${tries}`) : 'Out of tries. It was this one.'}
              detail={o === 'won' ? `+${POINTS[tries - 1]} points` : undefined}>
              <button type="button" className="btn btn-primary" onClick={goNext} autoFocus>Next song</button>
            </Reveal>
          } />
      ) : (
        <p className="empty">No songs match this pool. Open the pool above and add an era or mood.</p>
      )}
    </div>
  );
}

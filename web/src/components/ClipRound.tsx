import { useEffect, useRef, type ReactNode } from 'react';
import type { Song } from '../lib/catalog';
import { audioRunning } from '../lib/audio';
import { POINTS, STAGES, clues, fmtSeconds, judge, outcome, type Attempt } from '../lib/game';
import type { buildIndex } from '../lib/search';
import { GuessBox } from './GuessBox';
import { Record } from './Record';
import { useClip } from './useClip';

interface Props {
  song: Song;
  index: ReturnType<typeof buildIndex>;
  attempts: Attempt[];
  onAttempt: (a: Attempt) => void;
  onSkipSong?: () => void; // offered when the preview can't be loaded
  reveal?: ReactNode;      // replaces the tries and guess box once the round is over
  head?: ReactNode;        // optional heading above the record
  ended?: boolean;         // the round was closed from outside (time ran out in a room)
  hold?: ReactNode;        // shown instead of the answer while other players are still guessing
  autoplay?: boolean;      // play the first clip as soon as it loads
}

// One song, six tries: the record, the clues earned so far, the tries list and the guess box.
export function ClipRound({ song, index, attempts, onAttempt, onSkipSong, reveal, head, ended, hold, autoplay }: Props) {
  const { status, error, elapsed, span, playing, play, playHook, stop, clip } = useClip(song);
  const done = outcome(attempts) !== 'playing' || !!ended;
  const shown = done && !hold; // the answer is on screen
  const stage = Math.min(attempts.length, STAGES.length - 1);
  const full = shown && clip ? Math.floor(clip.duration - clip.onset) : undefined;

  // A miss unlocks a longer clip and plays it straight away if sound is already on.
  // When the answer appears, the song plays from its main line, as soon as the preview has downloaded.
  // A round that was already over when it mounted (a finished daily, reloaded) stays quiet.
  const seen = useRef(attempts.length);
  const wasShown = useRef(shown);
  const hookDue = useRef(false);
  const started = useRef(false);
  useEffect(() => {
    const grew = attempts.length > seen.current;
    seen.current = attempts.length;
    if (shown && !wasShown.current) hookDue.current = true;
    wasShown.current = shown;
    if (status !== 'ready') return;
    if (hookDue.current) { hookDue.current = false; playHook(); }
    else if (grew && !done && audioRunning()) play(STAGES[stage]);
    else if (autoplay && !started.current && !attempts.length && audioRunning()) play(STAGES[0]);
    started.current = true;
  }, [attempts.length, shown, done, stage, status, autoplay, play, playHook]);

  const toggle = () => (playing ? stop() : play(full ?? STAGES[stage], full ? clip!.onset : undefined));
  const skipLabel = stage === STAGES.length - 1 ? 'Give up' : `Skip, hear ${fmtSeconds(STAGES[stage + 1])}`;

  const songClues = clues(song);
  const kindOf = (i: number) => {
    const a = attempts[i];
    return !a ? (i === attempts.length && !done ? 'now' : 'empty') : a.kind === 'skip' ? 'skip' : a.verdict;
  };
  const MARK = { right: 'Correct', film: 'Right film', wrong: 'Not it', skip: 'Skipped', now: '', empty: '' } as const;

  // Two columns on wide screens: the record and clues on one side, the tries and guess box (or the answer) on the other.
  return (
    <div className="round">
      <div className="round-side">
        {head}
        <div className="stage">
          <Record stages={STAGES} unlocked={stage} elapsed={elapsed} full={full} span={span} status={status} onToggle={toggle} />
          <p className="stage-hint" aria-live="polite">
            {status === 'loading' && 'Fetching the song…'}
            {status === 'error' && <>{error} {onSkipSong && <button type="button" className="link" onClick={onSkipSong}>Play another song</button>}</>}
            {status === 'ready' && !done && (playing ? 'Listening…' : `Tap the record to hear ${fmtSeconds(STAGES[stage])}`)}
            {status === 'ready' && done && !shown && 'Waiting for everyone to finish'}
            {status === 'ready' && shown && (playing ? 'Now playing' : 'Tap the record to hear it again')}
          </p>
        </div>
        {!done && (
          <dl className="clues">
            {songClues.map((c) => {
              const open = attempts.length >= c.after && !!c.text;
              return (
                <div key={c.label} className={`clue ${open ? 'is-open' : ''}`}>
                  <dt>{c.label}</dt>
                  <dd>{open ? c.text : c.text ? `Unlocks on try ${c.after + 1}` : 'Not known'}</dd>
                </div>
              );
            })}
          </dl>
        )}
        {done && (
          <ol className="strip" aria-label="Your tries">
            {STAGES.map((len, i) => {
              const k = kindOf(i), a = attempts[i];
              return (
                <li key={i} className={`strip-${k}`} title={a?.kind === 'guess' ? `${a.title} (${a.movie}): ${MARK[k]}` : MARK[k] || 'Not needed'}>
                  {fmtSeconds(len)}<span className="sr-only"> {MARK[k] || 'not needed'}</span>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      <div className="round-main">
        {done ? (shown ? reveal : hold) : (
          <>
            <ol className="tries" aria-label="Your tries">
              {STAGES.map((len, i) => {
                const a = attempts[i], k = kindOf(i);
                const adds = i > 0 && !a ? songClues.find((c) => c.after === i && c.text) : undefined;
                return (
                  <li key={i} className={`try try-${k}`}>
                    <span className="try-len">{fmtSeconds(len)}</span>
                    <span className="try-text">
                      {a?.kind === 'skip' && 'Skipped'}
                      {a?.kind === 'guess' && <><b>{a.title}</b> <span className="try-movie">{a.movie}</span></>}
                      {adds && <span className="try-adds">adds the {adds.label.toLowerCase()} clue</span>}
                    </span>
                    {a ? <span className="try-mark">{k !== 'skip' && MARK[k]}</span>
                      : <span className="try-pts">{POINTS[i]}<small> pts</small></span>}
                  </li>
                );
              })}
            </ol>
            <GuessBox index={index} disabled={status === 'error'}
              exclude={attempts.flatMap((a) => (a.kind === 'guess' ? [a.id] : []))}
              onGuess={(g) => onAttempt({ kind: 'guess', id: g.id, title: g.title, movie: g.movie, verdict: judge(g, song) })}>
              <button type="button" className="btn btn-quiet" onClick={() => onAttempt({ kind: 'skip' })}>{skipLabel}</button>
            </GuessBox>
          </>
        )}
      </div>
    </div>
  );
}

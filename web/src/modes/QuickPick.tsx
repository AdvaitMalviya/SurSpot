import { useEffect, useMemo, useState } from 'react';
import { PoolPicker } from '../components/PoolPicker';
import { Record } from '../components/Record';
import { useClip } from '../components/useClip';
import { loadClip } from '../lib/audio';
import { decadeOf, inPool, isEnglish, languageOf, shuffle, sourceLabel, type Pool, type Song } from '../lib/catalog';
import { freshFirst, markHeard } from '../lib/heard';
import { quickStats, recordQuick } from '../lib/stats';
import { trackSong } from '../lib/track';

const ROUNDS = 10, LIMIT = 15, CLIP = 5;

interface Round { song: Song; options: Song[] }
interface Answer { id: string | null; points: number }

// The songs to name are ones not heard yet where the pool has enough (lib/heard.ts). Wrong options come from the same
// language and decade so neither gives the answer away (three Hindi titles beside one English one would), and from
// another film, or for an English song another artist.
function buildRounds(candidates: Song[], all: Song[]): Round[] {
  return freshFirst(candidates).slice(0, ROUNDS).map((song) => {
    const titles = new Set([song.title.toLowerCase()]);
    const options = [song];
    const same = all.filter((s) => languageOf(s) === languageOf(song));
    const apart = (s: Song) => (isEnglish(song) ? s.singers[0] !== song.singers[0] : s.movie !== song.movie);
    const near = shuffle(same.filter((s) => decadeOf(s.year) === decadeOf(song.year) && apart(s)));
    for (const s of [...near, ...shuffle(same), ...shuffle(all)]) {
      if (options.length === 4) break;
      if (titles.has(s.title.toLowerCase())) continue;
      titles.add(s.title.toLowerCase());
      options.push(s);
    }
    return { song, options: shuffle(options) };
  });
}

const pointsFor = (msLeft: number) => Math.round(40 + (60 * msLeft) / (LIMIT * 1000));

export function QuickPick({ songs, pool, onPool, pending }: { songs: Song[]; pool: Pool; onPool: (p: Pool) => void; pending?: boolean }) {
  const candidates = useMemo(() => songs.filter((s) => inPool(s, pool)), [songs, pool]);
  const [rounds, setRounds] = useState<Round[] | null>(null);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const i = answers.length;
  const round = rounds?.[i] ?? null;
  const [shown, setShown] = useState<number | null>(null); // round whose answer is on screen
  const current = rounds && shown !== null ? rounds[shown] : round;
  const { status, elapsed, play, playHook, stop } = useClip(current?.song ?? null);
  const over = rounds !== null && answers.length === rounds.length && shown === null;
  const total = answers.reduce((n, a) => n + a.points, 0);

  const start = () => {
    const r = buildRounds(candidates, songs);
    r.slice(0, 2).forEach((x) => loadClip(x.song).catch(() => {}));
    setRounds(r); setAnswers([]); setShown(null); setStartedAt(null);
  };

  const answer = (id: string | null) => {
    if (!round || shown !== null) return;
    playHook(12);
    const left = startedAt ? LIMIT * 1000 - (Date.now() - startedAt) : LIMIT * 1000;
    const points = id === round.song.id ? pointsFor(Math.max(left, 0)) : 0;
    const next = [...answers, { id, points }];
    setAnswers(next);
    setShown(i);
    trackSong({ mode: 'quick', song: round.song.id, won: id === round.song.id, tries: 1 });
    markHeard(round.song.id);
    if (next.length === rounds!.length) recordQuick(next.reduce((n, a) => n + a.points, 0));
    const after = rounds![i + 1];
    if (after) loadClip(after.song).catch(() => {});
  };
  // After the first song, each next one plays as soon as its preview is ready.
  const [autoplay, setAutoplay] = useState(false);
  const advance = () => { setShown(null); setStartedAt(null); setAutoplay(answers.length < rounds!.length); };
  useEffect(() => {
    if (!autoplay || status !== 'ready' || shown !== null) return;
    setAutoplay(false);
    setStartedAt(Date.now());
    play(CLIP);
  }, [autoplay, status, shown, play]);

  // The clock starts with the first listen and runs out after LIMIT seconds.
  useEffect(() => {
    if (!startedAt || shown !== null) return;
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, [startedAt, shown]);
  const msLeft = startedAt ? Math.max(LIMIT * 1000 - (now - startedAt), 0) : LIMIT * 1000;
  useEffect(() => { if (startedAt && msLeft === 0 && shown === null) answer(null); });

  if (!rounds || over) {
    const best = quickStats().best;
    return (
      <div className="mode">
        <div className="toolbar"><PoolPicker songs={songs} pool={pool} onChange={onPool} pending={pending} /></div>
        {over ? (
          <section className="quick-summary">
            <p className="quick-total"><b>{total}</b> points</p>
            <p>{answers.filter((a) => a.points).length} of {ROUNDS} right. Your best is {best}.</p>
            <ol className="quick-list">
              {rounds!.map((r, k) => (
                <li key={r.song.id} className={answers[k].points ? 'is-right' : 'is-wrong'}>
                  <span><b>{r.song.title}</b> {sourceLabel(r.song)}</span>
                  <span>{answers[k].points ? `+${answers[k].points}` : answers[k].id ? 'Wrong' : 'Time up'}</span>
                </li>
              ))}
            </ol>
            <button type="button" className="btn btn-primary" onClick={start}>Play again</button>
          </section>
        ) : (
          <section className="quick-intro">
            <h1>Quick pick</h1>
            <p>Ten songs. Hear five seconds, pick the song from four, and beat the {LIMIT}-second clock. The faster you answer, the more you score.</p>
            <button type="button" className="btn btn-primary" onClick={start} disabled={pending || candidates.length < ROUNDS}>Start</button>
            {pending ? <p className="pool-warn" role="status">Loading the English songs…</p>
              : candidates.length < ROUNDS && <p className="pool-warn">Quick pick needs at least {ROUNDS} songs. Widen the pool above.</p>}
          </section>
        )}
      </div>
    );
  }

  const r = current!;
  const picked = shown !== null ? answers[shown] : null;
  const hint = status === 'loading' ? 'Fetching the song…' : status === 'error' ? 'This preview would not load.'
    : !startedAt ? 'Tap the record. The clock starts when the music does.' : picked ? '' : `${Math.ceil(msLeft / 1000)} seconds left`;
  return (
    <div className="mode">
      <div className="round">
        <div className="round-side">
          <div className="quick-head">
            <span>Song {(shown ?? i) + 1} of {ROUNDS}</span>
            <span><b>{total}</b> points</span>
          </div>
          <div className="stage">
            <Record stages={[CLIP]} unlocked={0} elapsed={elapsed} status={status}
              onToggle={() => { if (elapsed !== null) return stop(); if (!startedAt) setStartedAt(Date.now()); play(CLIP); }} />
            <div className="timer" role="timer" aria-label={`${Math.ceil(msLeft / 1000)} seconds left`}>
              <span style={{ transform: `scaleX(${msLeft / (LIMIT * 1000)})` }} />
            </div>
            <p className="stage-hint" aria-live="polite">{hint}</p>
          </div>
        </div>
        <div className="round-main">
          <div className="options">
            {r.options.map((s) => {
              const state = !picked ? '' : s.id === r.song.id ? 'is-right' : s.id === picked.id ? 'is-wrong' : 'is-dim';
              return (
                <button key={s.id} type="button" className={`option ${state}`} disabled={!!picked || (!startedAt && status !== 'error')} onClick={() => answer(s.id)}>
                  <b>{s.title}</b>
                  <span>{sourceLabel(s)}</span>
                </button>
              );
            })}
          </div>
          {picked && (
            <div className="quick-after" aria-live="polite">
              <p>{picked.points ? `Right, +${picked.points}` : picked.id ? `It was ${r.song.title}` : `Time up. It was ${r.song.title}`}</p>
              <button type="button" className="btn btn-primary" onClick={advance} autoFocus>{answers.length === ROUNDS ? 'See your score' : 'Next song'}</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

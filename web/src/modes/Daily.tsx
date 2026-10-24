import { useEffect, useMemo, useState } from 'react';
import { ClipRound } from '../components/ClipRound';
import { Reveal } from '../components/Reveal';
import { dailySong, istDate, msToNextDay, type Song } from '../lib/catalog';
import { STAGES, outcome, shareGrid, type Attempt } from '../lib/game';
import type { buildIndex } from '../lib/search';
import { dailyGame, recordDaily, saveDailyGame } from '../lib/stats';

const clock = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((n) => String(n).padStart(2, '0')).join(':');
};
const longDate = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

// One song a day for everyone. Progress survives reloads; stats count each day once.
export function Daily({ songs, index, onStats }: { songs: Song[]; index: ReturnType<typeof buildIndex>; onStats: (today: number) => void }) {
  const [date, setDate] = useState(istDate);
  const { song, number } = useMemo(() => dailySong(songs, date), [songs, date]);
  const [attempts, setAttempts] = useState<Attempt[]>(() => dailyGame(date).attempts);
  const [left, setLeft] = useState(msToNextDay);
  const [shared, setShared] = useState<string | null>(null);

  useEffect(() => { setAttempts(dailyGame(date).attempts); }, [date]);
  useEffect(() => {
    const t = setInterval(() => { setLeft(msToNextDay()); if (istDate() !== date) setDate(istDate()); }, 1000);
    return () => clearInterval(t);
  }, [date]);

  const o = outcome(attempts);
  const onAttempt = (a: Attempt) => {
    const all = [...attempts, a];
    setAttempts(all);
    saveDailyGame(date, { attempts: all });
    const r = outcome(all);
    if (r !== 'playing') {
      recordDaily(number, r === 'won', all.length);
      setTimeout(() => onStats(r === 'won' ? all.length : 0), 1800);
    }
  };

  const share = async () => {
    const text = `SurSpot #${number}  ${o === 'won' ? attempts.length : 'X'}/${STAGES.length}\n${shareGrid(attempts)}\n${location.href.split('#')[0]}#/daily`;
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) { await navigator.share({ text }); return; }
      await navigator.clipboard.writeText(text);
      setShared('Result copied. Paste it anywhere.');
    } catch {
      setShared(text);
    }
  };

  return (
    <div className="mode">
      <div className="daily-head"><h1>Daily song #{number}</h1><p>{longDate(date)}</p></div>
      <ClipRound key={date} song={song} index={index} attempts={attempts} onAttempt={onAttempt}
        reveal={
          <Reveal song={song}
            headline={o === 'won' ? `Solved on try ${attempts.length} of ${STAGES.length}` : 'Not today. Here is the song.'}
            detail={`The next daily song arrives in ${clock(left)}.`}>
            <button type="button" className="btn btn-primary" onClick={share}>Share result</button>
            <span className="share-grid" aria-label="Your tries as colours">{shareGrid(attempts)}</span>
            {shared && <p className="share-note" role="status">{shared}</p>}
          </Reveal>
        } />
    </div>
  );
}

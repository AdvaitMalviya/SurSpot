import { useEffect, useRef, type ReactNode } from 'react';
import { POINTS, STAGES, fmtSeconds } from '../lib/game';
import { dailyStats, endlessStats, quickStats } from '../lib/stats';

function Dialog({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="dialog" onClose={onClose} onClick={(e) => e.target === ref.current && onClose()} aria-label={title}>
      <div className="dialog-body">
        <header className="dialog-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </header>
        {children}
      </div>
    </dialog>
  );
}

export function HelpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} title="How to play" onClose={onClose}>
      <p>Tap the record to hear a sliver of a Bollywood song, then type the song or its film and pick it from the list.</p>
      <p>You get six tries. A wrong guess or a skip unlocks a longer clip:</p>
      <ol className="help-ladder">
        {STAGES.map((s, i) => <li key={s}><span>{fmtSeconds(s)}</span><span>{POINTS[i]} points</span></li>)}
      </ol>
      <p>From the third try you also get clues: the era, then the music director, the singers, and finally the film.</p>
      <p>Guess another song from the same film and the try is marked <b className="tag-film">Right film</b>, so you know you are close.</p>
      <h3>Modes</h3>
      <dl className="help-modes">
        <dt>Play</dt><dd>Endless songs from the pool you choose: any mix of decades, moods, difficulty and artists.</dd>
        <dt>Daily</dt><dd>One song a day, the same for everyone. A new one arrives at midnight India time.</dd>
        <dt>Quick pick</dt><dd>Ten songs, four choices each, fifteen seconds to answer. Faster answers score more.</dd>
        <dt>With friends</dt><dd>Make a room, send the link, and race your friends through the same songs, a minute each.</dd>
      </dl>
      <p className="help-credit">Clips are 30-second previews from Apple Music. Film notes come from Wikipedia.</p>
    </Dialog>
  );
}

export function StatsDialog({ open, onClose, today }: { open: boolean; onClose: () => void; today?: number }) {
  if (!open) return <Dialog open={false} title="Your stats" onClose={onClose}>{null}</Dialog>;
  const d = dailyStats(), e = endlessStats(), q = quickStats();
  const max = Math.max(1, ...d.dist);
  const tiles = [
    ['Daily played', d.played], ['Won', d.played ? `${Math.round((100 * d.won) / d.played)}%` : '–'],
    ['Streak', d.streak], ['Best streak', d.best],
  ] as const;
  return (
    <Dialog open title="Your stats" onClose={onClose}>
      <div className="tiles">
        {tiles.map(([label, value]) => <div key={label} className="tile"><span className="tile-value">{value}</span><span className="tile-label">{label}</span></div>)}
      </div>
      <h3>Daily wins by try</h3>
      <figure className="dist" aria-label="Daily songs solved on each try">
        {d.dist.map((n, i) => (
          <div key={i} className="dist-row" title={`Solved on try ${i + 1} (${fmtSeconds(STAGES[i])}): ${n} ${n === 1 ? 'day' : 'days'}`}>
            <span className="dist-try">{i + 1}</span>
            <span className="dist-track">
              <span className={`dist-bar ${today === i + 1 ? 'is-today' : ''}`} style={{ width: `${(n / max) * 100}%` }} />
              <span className="dist-n">{n}</span>
            </span>
          </div>
        ))}
      </figure>
      <h3>Play and Quick pick</h3>
      <div className="tiles">
        <div className="tile"><span className="tile-value">{e.solved}/{e.played}</span><span className="tile-label">Songs solved</span></div>
        <div className="tile"><span className="tile-value">{e.bestStreak}</span><span className="tile-label">Longest run</span></div>
        <div className="tile"><span className="tile-value">{q.best}</span><span className="tile-label">Best Quick pick</span></div>
      </div>
      <p className="help-credit">Stats live in this browser only.</p>
    </Dialog>
  );
}

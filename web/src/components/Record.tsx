import { fmtSeconds } from '../lib/game';

// The player: a 45 with the clip length on its label, ringed by one arc per try.
// Unlocked arcs are lit; while a clip plays, the fill sweeps through them in step with the audio.
const C = 120, R = 112, GAP = 3;
const point = (deg: number): [number, number] => {
  const a = (deg * Math.PI) / 180;
  return [C + R * Math.sin(a), C - R * Math.cos(a)];
};
function arc(a0: number, a1: number) {
  const [x0, y0] = point(a0), [x1, y1] = point(a1);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${R} ${R} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

interface Props {
  stages: number[];          // clip length per try
  unlocked: number;          // index of the longest unlocked stage
  elapsed: number | null;    // seconds into the playing clip, null when silent
  full?: number;             // when set, the record plays the song (this many seconds) and the ring tracks it linearly
  span?: number;             // length of what is playing now, when it differs from `full`
  status: 'loading' | 'ready' | 'error';
  onToggle: () => void;
}

export function Record({ stages, unlocked, elapsed, full, span, status, onToggle }: Props) {
  const n = stages.length, deg = 360 / n;
  const playing = elapsed !== null;
  const fill = (i: number) => {
    if (elapsed === null) return 0;
    if (full) return Math.min(Math.max((elapsed / (span || full)) * n - i, 0), 1);
    const lo = i ? stages[i - 1] : 0;
    return Math.min(Math.max((elapsed - lo) / (stages[i] - lo), 0), 1);
  };
  const len = full ?? stages[unlocked];
  const label = status === 'loading' ? 'Loading the song' : status === 'error' ? 'Song unavailable'
    : playing ? 'Stop the clip' : full ? `Play ${Math.round(full)} seconds of the song` : `Play a ${fmtSeconds(len)} clip`;

  return (
    <button type="button" className={`record ${playing ? 'is-playing' : ''} is-${status}`} onClick={onToggle}
      disabled={status !== 'ready'} aria-label={label}>
      <svg className="record-ring" viewBox="0 0 240 240" aria-hidden="true">
        {stages.map((_, i) => {
          const a0 = i * deg + GAP, a1 = (i + 1) * deg - GAP, f = fill(i);
          const lit = full || i <= unlocked;
          // The arc for this try is rani like its row in the ladder, so the ring and the list read as one.
          const now = !full && i === unlocked;
          return (
            <g key={i}>
              <path d={arc(a0, a1)} className={now ? 'arc arc-now' : lit ? 'arc arc-lit' : 'arc'} />
              {f > 0 && <path d={arc(a0, a0 + (a1 - a0) * f)} className="arc arc-play" />}
            </g>
          );
        })}
      </svg>
      <span className="disc" aria-hidden="true">
        <span className="disc-label">
          <span className="disc-sur" lang="hi">सुर</span>
          <span className="disc-len">
            {status === 'loading' ? 'loading' : status === 'error' ? 'no audio' : playing ? '■' : fmtSeconds(Math.round(len * 10) / 10)}
          </span>
        </span>
      </span>
    </button>
  );
}

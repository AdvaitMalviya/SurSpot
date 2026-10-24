import { decadeOf, isFilm, type Song } from './catalog';
import { POINTS, STAGES } from './rules';

// Six tries. Each miss or skip unlocks a longer clip; from the third try on, a clue about the song appears too.
export { POINTS, STAGES };

export type Verdict = 'right' | 'film' | 'wrong';
export type Attempt = { kind: 'skip' } | { kind: 'guess'; id: string; title: string; movie: string; verdict: Verdict };
export type Outcome = 'playing' | 'won' | 'lost';

export function judge(guess: Song, answer: Song): Verdict {
  if (guess.id === answer.id || guess.trackId === answer.trackId) return 'right';
  if (isFilm(answer) && guess.movie === answer.movie && guess.year === answer.year) return 'film';
  return 'wrong';
}

export function outcome(attempts: Attempt[]): Outcome {
  if (attempts.some((a) => a.kind === 'guess' && a.verdict === 'right')) return 'won';
  return attempts.length >= STAGES.length ? 'lost' : 'playing';
}

export const fmtSeconds = (s: number) => (s < 1 ? `${s.toFixed(1).replace(/^0/, '')} s` : `${s} s`);

export function clues(song: Song) {
  return [
    { after: 2, label: 'Era', text: `${decadeOf(song.year)}s, released ${song.year}` },
    { after: 3, label: 'Music', text: song.composers.join(' and ') },
    { after: 4, label: 'Voices', text: song.singers.join(', ') },
    { after: 5, label: isFilm(song) ? 'Film' : 'Album', text: song.movie },
  ];
}

const EMOJI = { right: '🟩', film: '🟨', wrong: '🟥', skip: '⬛' } as const;
export function shareGrid(attempts: Attempt[]) {
  const cells = attempts.map((a) => EMOJI[a.kind === 'skip' ? 'skip' : a.verdict]);
  return [...cells, ...Array(STAGES.length - cells.length).fill('⬜')].join('');
}

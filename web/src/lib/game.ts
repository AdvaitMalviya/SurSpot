import { decadeOf, isEnglish, isFilm, type Song } from './catalog';
import { POINTS, STAGES } from './rules';

// Six tries. Each miss or skip unlocks a longer clip; from the third try on, a clue about the song appears too.
export { POINTS, STAGES };

export type Verdict = 'right' | 'film' | 'wrong';
// A guess keeps what it showed beside its title: the film, or for an English song the artist.
export type Attempt = { kind: 'skip'; gaveUp?: true } | { kind: 'guess'; id: string; title: string; movie: string; verdict: Verdict };
export type Outcome = 'playing' | 'won' | 'lost';

// A near miss ('film', the letter 'f' in a room) is another song from the same film, or for an English song, another
// song by the same artist: English songs are known by who sings them, as Hindi film songs are by their film.
export function judge(guess: Song, answer: Song): Verdict {
  if (guess.id === answer.id || guess.trackId === answer.trackId) return 'right';
  if (isEnglish(answer)) return isEnglish(guess) && guess.singers.some((a) => answer.singers.includes(a)) ? 'film' : 'wrong';
  if (isFilm(answer) && guess.movie === answer.movie && guess.year === answer.year) return 'film';
  return 'wrong';
}
export const nearMiss = (answer: Song) => (isEnglish(answer) ? 'Right artist' : 'Right film');

export function outcome(attempts: Attempt[]): Outcome {
  if (attempts.some((a) => a.kind === 'guess' && a.verdict === 'right')) return 'won';
  return attempts.length >= STAGES.length ? 'lost' : 'playing';
}

// Giving up skips every try that's left at once, so the round ends (and scores, and reaches a room's server)
// exactly as running out of tries does. The flag only changes what the answer card says.
export const giveUp = (attempts: Attempt[]): Attempt[] =>
  Array.from({ length: STAGES.length - attempts.length }, () => ({ kind: 'skip', gaveUp: true }));
export const gaveUp = (attempts: Attempt[]) => attempts.some((a) => a.kind === 'skip' && a.gaveUp);

export const fmtSeconds = (s: number) => (s < 1 ? `${s.toFixed(1).replace(/^0/, '')} s` : `${s} s`);

// English songs have no music director on record, so their second clue is the genre.
export function clues(song: Song) {
  if (isEnglish(song)) {
    return [
      { after: 2, label: 'Era', text: `${decadeOf(song.year)}s, released ${song.year}` },
      { after: 3, label: 'Genre', text: song.genre ?? '' },
      { after: 4, label: 'Artist', text: song.singers.join(', ') },
      { after: 5, label: 'Album', text: song.movie },
    ];
  }
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

import { STAGES, type Attempt } from './game';
import { load, save } from './storage';

export interface DailyStats { played: number; won: number; streak: number; best: number; dist: number[]; lastDay: number; lastWonDay: number }
export interface DailyGame { attempts: Attempt[] }
export interface EndlessStats { played: number; solved: number; bestStreak: number; bestScore: number }
export interface QuickStats { games: number; best: number }

export const dailyStats = () => load<DailyStats>('daily-stats', { played: 0, won: 0, streak: 0, best: 0, dist: Array(STAGES.length).fill(0), lastDay: 0, lastWonDay: 0 });
export const endlessStats = () => load<EndlessStats>('endless-stats', { played: 0, solved: 0, bestStreak: 0, bestScore: 0 });
export const quickStats = () => load<QuickStats>('quick-stats', { games: 0, best: 0 });

export const dailyGame = (date: string) => load<DailyGame>(`daily-${date}`, { attempts: [] });
export const saveDailyGame = (date: string, g: DailyGame) => save(`daily-${date}`, g);

// Counts a finished daily once, however many times the page is reloaded.
export function recordDaily(day: number, won: boolean, tries: number) {
  const s = dailyStats();
  if (s.lastDay === day) return s;
  const streak = won ? (s.lastWonDay === day - 1 ? s.streak + 1 : 1) : 0;
  const dist = [...s.dist];
  if (won) dist[tries - 1]++;
  const next: DailyStats = {
    played: s.played + 1, won: s.won + (won ? 1 : 0), streak, best: Math.max(s.best, streak), dist,
    lastDay: day, lastWonDay: won ? day : s.lastWonDay,
  };
  save('daily-stats', next);
  return next;
}

export function recordEndless(won: boolean, streak: number, score: number) {
  const s = endlessStats();
  save('endless-stats', {
    played: s.played + 1, solved: s.solved + (won ? 1 : 0),
    bestStreak: Math.max(s.bestStreak, streak), bestScore: Math.max(s.bestScore, score),
  });
}

export function recordQuick(score: number) {
  const s = quickStats();
  save('quick-stats', { games: s.games + 1, best: Math.max(s.best, score) });
}

// Anonymous play counts: what the game sends the room server (server/src/index.ts) and what the stats page
// (web/stats.html) gets back. The server imports this file too, so it imports nothing.

export const MODES = ['play', 'daily', 'quick', 'friends'] as const;
export type Mode = (typeof MODES)[number];

// One song heard to the end of its round. tries counts every try, the winning one included; in Quick pick it is 1.
export interface Played { mode: Mode; song: string; won: boolean; tries: number }
// uid is the random id this browser keeps for rooms (lib/track.ts); a beacon with no rounds says the page opened.
export interface Beacon { uid: string; rounds: Played[] }

// Days are India time, like the daily song.
export interface Report {
  today: string;
  from: string;
  playingNow: number; // players with a song in the last 30 minutes
  allTime: { players: number; rounds: number; solved: number };
  range: { players: number; newPlayers: number; rounds: number; solved: number };
  days: { day: string; players: number; newPlayers: number; rounds: number; solved: number }[];
  modes: { mode: Mode; rounds: number; solved: number; players: number; tries: number | null }[];
  // Each daily song's results: how many solved it on each try (dist[0] is the first), and how many didn't.
  daily: { song: string; day: string; players: number; dist: number[]; missed: number }[];
  topSongs: { song: string; plays: number; solved: number }[];
  hardSongs: { song: string; plays: number; solved: number }[];
  hours: number[];    // songs played in each hour of the day, India time
  countries: { country: string; players: number }[];
}

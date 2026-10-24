// Play with friends: what the browsers and the room server (server/src/index.ts) send each other.
// The server imports this file too, so it imports only rules.ts.
import { POINTS, STAGES } from './rules';

export const ROUND_SECONDS = 60;
export const COUNTDOWN_MS = 3000;
export const FIRST_COUNTDOWN_MS = 5000; // the first preview has had no time to download yet
export const MAX_PLAYERS = 12;
export const MAX_SONGS = 20;
export const NAME_LENGTH = 20;

// One letter per try: skipped, wrong, right film, right song.
export type Mark = 's' | 'w' | 'f' | 'r';
// A player's tries in one round, and how long after the round started they made the last one.
export interface Result { marks: string; ms: number }

export interface Player { pid: string; name: string; online: boolean }
export interface RoomState {
  code: string;
  host: string;
  players: Player[];
  phase: 'lobby' | 'playing' | 'reveal' | 'over';
  label: string;          // the host's pool, described for everyone else
  songs: string[];        // song ids, one per round
  round: number;
  startsAt: number;       // server clock, ms
  endsAt: number;
  results: Record<string, Result>[]; // per round, by player id
  now: number;            // server clock when this state was sent
}

export type ToServer =
  | { type: 'hello'; pid: string; name: string; create: boolean }
  | { type: 'start'; songs: string[]; label: string }
  | { type: 'try'; round: number; n: number; mark: Mark }
  | { type: 'time'; round: number }   // this round's time has run out
  | { type: 'next' }
  | { type: 'lobby' }
  | { type: 'leave' };

export type Problem = 'taken' | 'missing' | 'full' | 'name' | 'replaced';
export type ToClient = { type: 'state'; room: RoomState } | { type: 'error'; problem: Problem; message: string };

export const isDone = (r?: Result) => !!r && (r.marks.endsWith('r') || r.marks.length >= STAGES.length);
export const pointsFor = (r?: Result) => (r?.marks.endsWith('r') ? POINTS[r.marks.length - 1] : 0);
export const totalFor = (room: RoomState, pid: string) => room.results.reduce((t, round) => t + pointsFor(round[pid]), 0);
// Time spent on solved songs breaks ties: the quicker ear wins.
const solveTime = (room: RoomState, pid: string) =>
  room.results.reduce((t, round) => t + (round[pid]?.marks.endsWith('r') ? round[pid].ms : 0), 0);
export const standings = (room: RoomState) =>
  room.players
    .map((p, i) => ({ ...p, total: totalFor(room, p.pid), time: solveTime(room, p.pid), order: i }))
    .sort((a, b) => b.total - a.total || a.time - b.time || a.order - b.order);

// Four letters without look-alikes (no I, L, O), easy to read out across a room.
const LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ';
export const newRoomCode = () => Array.from({ length: 4 }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join('');
export const ROOM_CODE = /^[A-HJKMNP-Z]{4}$/;

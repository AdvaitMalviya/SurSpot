// Anonymous play counts for the stats page: a note to the room server when the page opens and when a song ends.
// The only id is the random one this browser already keeps for rooms; no names, guesses or anything else. Notes go
// out in the background and are never retried, so a blocked or failed one just goes uncounted.
// They are plain fetches to /played, not navigator.sendBeacon to /events: blockers stop both of those on sight as
// analytics, even for a game counting its own plays. keepalive lets one finish after the page closes, as a beacon would.
import { ROOMS_URL, loadMe } from '../components/useRoom';
import type { Played } from './beacon';
import { load, save } from './storage';

export const STATS_URL = ROOMS_URL.replace(/^ws/, 'http');

function send(rounds: Played[]) {
  if (!ROOMS_URL) return;
  try {
    // A string body goes as text/plain, so the browser sends it without asking the server first (no preflight).
    const body = JSON.stringify({ uid: loadMe().pid, rounds });
    fetch(`${STATS_URL}/played`, { method: 'POST', body, keepalive: true }).catch(() => {});
  } catch { /* nothing to count with */ }
}

export const trackVisit = () => send([]);
export const trackSong = (played: Played) => send([played]);

// For a song the page can show again after a reload (the daily song, a song in a room): counted once per `key`.
export function trackSongOnce(key: string, played: Played) {
  if (load('tracked', { key: '' }).key === key) return;
  save('tracked', { key });
  send([played]);
}

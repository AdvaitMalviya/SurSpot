// Rooms for Play with friends. Each room is a Durable Object holding the players, the songs the host picked and
// everyone's tries; after every change it sends the whole room to every player. Browsers judge guesses themselves
// (they all load the same song list), so the server only ever sees one letter per try, never a title.
// Sockets use the hibernation API: an idle room costs nothing, and its state lives in storage rather than memory.
// The browsers also keep the round clock: when a round's time runs out they say so, and the server checks it.
// Each player's tries on the current song ride on their own socket (its attachment survives hibernation), so a try
// costs no storage write; the room is saved when players come and go and when a song starts or ends. The free plan
// allows 100,000 row writes a day, so this is what lets it carry thousands of games a day rather than hundreds.
import { DurableObject } from 'cloudflare:workers';
import {
  COUNTDOWN_MS, FIRST_COUNTDOWN_MS, MAX_PLAYERS, MAX_SONGS, NAME_LENGTH, ROOM_CODE, ROUND_SECONDS, isDone,
  type Problem, type RoomState, type ToClient, type ToServer,
} from '../../web/src/lib/room';
import { MODES, type Beacon, type Report } from '../../web/src/lib/beacon';
import { STAGES } from '../../web/src/lib/rules';

interface Env {
  ROOMS: DurableObjectNamespace<Room>;
  STATS: DurableObjectNamespace<Stats>;
  STATS_KEY?: string; // the password for /stats: `node scripts/wrangler.mjs secret put STATS_KEY`
}
// Who a socket belongs to (pid stays null until the player says hello), and their tries on the current song.
interface Seat { code: string; pid: string | null; game: number; round: number; marks: string; ms: number }
type Stored = Omit<RoomState, 'players' | 'now'> & {
  players: { pid: string; name: string; left?: number }[]; // left: when their last socket closed
  lastSeen: number;
  game: number;
};
const emptySeat = (code: string): Seat => ({ code, pid: null, game: -1, round: -1, marks: '', ms: 0 });

const IDLE_MS = 6 * 60 * 60 * 1000; // a room nobody is in is deleted after six hours
const GRACE_MS = 20_000;            // how long a song waits for a player who dropped out
const MARKS = ['s', 'w', 'f', 'r'];

export default {
  async fetch(req, env, ctx) {
    const { pathname } = new URL(req.url);
    if (pathname === '/played' || pathname === '/events' || pathname === '/stats') return stats(req, env, ctx, pathname);
    const code = pathname.match(/^\/rooms\/([A-Z]{4})$/)?.[1];
    if (!code || !ROOM_CODE.test(code)) return new Response('Not found', { status: 404 });
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('Connect with a WebSocket', { status: 426 });
    return env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(req);
  },
} satisfies ExportedHandler<Env>;

export class Room extends DurableObject<Env> {
  room: Stored | undefined;
  graceCheck = 0; // the timer for the next grace check

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => { this.room = await ctx.storage.get<Stored>('room'); });
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async fetch(req: Request) {
    const code = new URL(req.url).pathname.slice(-4);
    const { 0: client, 1: socket } = new WebSocketPair();
    this.ctx.acceptWebSocket(socket);
    socket.serializeAttachment(emptySeat(code));
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer) {
    if (typeof data !== 'string' || data.length > 8000) return;
    let msg: ToServer;
    try { msg = JSON.parse(data); } catch { return; }
    const seat = ws.deserializeAttachment() as Seat;
    if (msg.type === 'hello') return this.hello(ws, seat, msg);
    const room = this.room, pid = seat.pid;
    if (!room || !pid) return;
    const now = Date.now(), isHost = room.host === pid;
    let save = true;
    switch (msg.type) {
      case 'start': {
        if (!isHost || (room.phase !== 'lobby' && room.phase !== 'over')) return;
        const songs = Array.isArray(msg.songs) ? msg.songs.filter((s) => typeof s === 'string' && s.length <= 120).slice(0, MAX_SONGS) : [];
        if (!songs.length) return;
        // Whoever closed the page before the start isn't playing: no waiting for them, no 0 on the scoreboard.
        const online = this.online();
        room.players = room.players.filter((p) => online.has(p.pid));
        Object.assign(room, { songs, label: String(msg.label ?? '').slice(0, 200), results: [], game: (room.game ?? 0) + 1 });
        this.startRound(0, now);
        break;
      }
      case 'try': {
        if (room.phase !== 'playing' || msg.round !== room.round || now < room.startsAt - 1000 || !MARKS.includes(msg.mark)) return;
        const r = this.roundResults(room)[pid] ?? { marks: '', ms: 0 };
        if (isDone(r) || msg.n !== r.marks.length) return; // a resend, or out of order
        ws.serializeAttachment({ ...seat, game: room.game, round: room.round, marks: r.marks + msg.mark, ms: Math.max(0, now - room.startsAt) } satisfies Seat);
        save = false;
        break;
      }
      case 'time':
        if (room.phase !== 'playing' || msg.round !== room.round || now < room.endsAt - 1500) return;
        room.phase = 'reveal';
        break;
      case 'next':
        if (!isHost || room.phase !== 'reveal') return;
        if (room.round + 1 < room.songs.length) this.startRound(room.round + 1, now);
        else room.phase = 'over';
        break;
      case 'lobby':
        if (!isHost || room.phase !== 'over') return;
        Object.assign(room, { phase: 'lobby', songs: [], results: [], round: 0 });
        break;
      case 'leave':
        this.fold(room);
        room.players = room.players.filter((p) => p.pid !== pid);
        ws.serializeAttachment(emptySeat(seat.code));
        ws.close(1000, 'Left the room');
        break;
      default:
        return;
    }
    await this.commit(undefined, save);
  }

  // The runtime answers the close handshake itself (compatibility dates from April 2026 on).
  async webSocketClose(ws: WebSocket) {
    if (this.room) await this.commit(ws);
  }

  async webSocketError(ws: WebSocket) {
    if (this.room) await this.commit(ws);
  }

  // Set when the last player leaves: clear the room out if nobody has come back since.
  async alarm() {
    const room = this.room;
    if (!room || this.online().size) return;
    if (Date.now() - room.lastSeen < IDLE_MS) return this.ctx.storage.setAlarm(room.lastSeen + IDLE_MS);
    await this.ctx.storage.deleteAll();
    this.room = undefined;
  }

  private async hello(ws: WebSocket, seat: Seat, msg: Extract<ToServer, { type: 'hello' }>) {
    const name = String(msg.name ?? '').replace(/\p{C}/gu, '').trim().slice(0, NAME_LENGTH);
    const pid = String(msg.pid ?? '').slice(0, 64);
    if (!name || !pid) return this.refuse(ws, 'name', 'Pick a name to join.');
    let room = this.room;
    const known = room?.players.find((p) => p.pid === pid);
    if (!room) {
      if (!msg.create) return this.refuse(ws, 'missing', `There's no room ${seat.code}. Check the code with whoever made it.`);
      room = this.room = {
        code: seat.code, host: pid, players: [], phase: 'lobby', label: '', songs: [], round: 0,
        startsAt: 0, endsAt: 0, results: [], lastSeen: Date.now(), game: 0,
      };
    } else if (msg.create && !known) return this.refuse(ws, 'taken', 'That room code is already in use.');
    if (known) known.name = name;
    else {
      // Between games, a seat held by someone who has gone can go to a newcomer.
      const gone = room.phase === 'lobby' || room.phase === 'over' ? room.players.find((p) => p.left) : undefined;
      if (room.players.length >= MAX_PLAYERS && gone) room.players = room.players.filter((p) => p !== gone);
      if (room.players.length >= MAX_PLAYERS) return this.refuse(ws, 'full', `Room ${seat.code} is full: it takes ${MAX_PLAYERS} players.`);
      room.players.push({ pid, name });
    }
    // The same player opening the room in a second tab takes the seat over, tries and all.
    this.fold(room);
    for (const other of this.ctx.getWebSockets()) {
      if (other === ws || (other.deserializeAttachment() as Seat).pid !== pid) continue;
      other.serializeAttachment(emptySeat(seat.code));
      this.send(other, { type: 'error', problem: 'replaced', message: 'This room is open in another tab.' });
      other.close(4000, 'replaced');
    }
    ws.serializeAttachment({ ...emptySeat(seat.code), pid });
    await this.commit();
  }

  private startRound(round: number, now: number) {
    const room = this.room!;
    room.round = round;
    room.startsAt = now + (round ? COUNTDOWN_MS : FIRST_COUNTDOWN_MS);
    room.endsAt = room.startsAt + ROUND_SECONDS * 1000;
    room.results[round] = {};
    room.phase = 'playing';
  }

  private refuse(ws: WebSocket, problem: Problem, message: string) {
    this.send(ws, { type: 'error', problem, message });
    ws.close(4000, problem);
  }

  // The current song's results: what was saved, updated with the tries held on each socket (including one closing).
  private roundResults(room: Stored, closing?: WebSocket) {
    const results = { ...(room.results[room.round] ?? {}) };
    const sockets = this.ctx.getWebSockets();
    for (const ws of closing && !sockets.includes(closing) ? [...sockets, closing] : sockets) {
      const s = ws.deserializeAttachment() as Seat;
      if (!s.pid || s.game !== room.game || s.round !== room.round) continue;
      if (s.marks.length >= (results[s.pid]?.marks.length ?? 0)) results[s.pid] = { marks: s.marks, ms: s.ms };
    }
    return results;
  }

  // Moves the tries held on sockets into the room, ready to save.
  private fold(room: Stored, closing?: WebSocket) {
    if (room.phase === 'playing' || room.phase === 'reveal') room.results[room.round] = this.roundResults(room, closing);
  }

  // Players with an open socket, leaving out one that is closing.
  private online(closing?: WebSocket) {
    const ids = new Set<string>();
    for (const ws of this.ctx.getWebSockets()) {
      const pid = (ws.deserializeAttachment() as Seat).pid;
      if (ws !== closing && pid) ids.add(pid);
    }
    return ids;
  }

  // After every change: hand the host role on if the host left, end the round once everyone here is done, save
  // (unless only a try changed), and send everyone the new state. When the last player leaves, an alarm is set to
  // clear the room out later (only then: an alarm write holds back every message sent after it until it is stored).
  // A player who drops out (a reload, a train tunnel) is still waited for during GRACE_MS; after that the round
  // goes on without them, and the clock ends it at the latest. (The timer for that keeps the room awake for those
  // few seconds; if the room is evicted anyway, the clock still ends the round.)
  private async commit(closing?: WebSocket, save = true) {
    const room = this.room!;
    const online = this.online(closing);
    const now = Date.now();
    if (online.size) room.lastSeen = now;
    for (const p of room.players) {
      if (online.has(p.pid)) delete p.left;
      else p.left ??= now;
    }
    if (!online.has(room.host)) room.host = room.players.find((p) => online.has(p.pid))?.pid ?? room.host;
    const current = this.roundResults(room, closing);
    const waitingFor = room.players.filter((p) => online.has(p.pid) || now - (p.left ?? 0) < GRACE_MS);
    if (room.phase === 'playing' && online.size && waitingFor.every((p) => isDone(current[p.pid]))) { room.phase = 'reveal'; save = true; }
    // Look again when the grace of someone who dropped out runs out, in case they were the last one not done.
    clearTimeout(this.graceCheck);
    const graceEnds = waitingFor.filter((p) => p.left && !isDone(current[p.pid])).map((p) => p.left! + GRACE_MS);
    if (room.phase === 'playing' && online.size && graceEnds.length) {
      this.graceCheck = setTimeout(() => this.room && this.commit(undefined, false), Math.min(...graceEnds) - now + 50);
    }
    if (save) {
      this.fold(room, closing);
      // Messages go out without waiting for the save to be confirmed: a lost save only costs a game in progress.
      await this.ctx.storage.put('room', room, { allowUnconfirmed: true });
      if (!online.size) await this.ctx.storage.setAlarm(now + IDLE_MS);
    }

    const { lastSeen: _, game: __, ...shared } = room;
    const live = room.phase === 'playing' || room.phase === 'reveal';
    const results = live ? room.results.map((r, i) => (i === room.round ? current : r)) : room.results;
    const state: RoomState = { ...shared, results, players: room.players.map(({ pid, name }) => ({ pid, name, online: online.has(pid) })), now };
    for (const ws of this.ctx.getWebSockets()) {
      if (ws !== closing && (ws.deserializeAttachment() as Seat).pid) this.send(ws, { type: 'state', room: state });
    }
  }

  private send(ws: WebSocket, msg: ToClient) {
    try { ws.send(JSON.stringify(msg)); } catch { /* the socket closed meanwhile */ }
  }
}

// ---------------------------------------------------------------- play counts
// Browsers post a note to /played when the page opens and when a song ends (web/src/lib/track.ts); the stats page
// (web/stats.html) reads the totals back with the STATS_KEY password. Anyone could post a made-up note, so the
// numbers are as honest as the people sending them: each one is checked for shape and size, nothing more.
// /events is the first version's address, still taken from pages opened before it changed.
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization' };
const DAY_MS = 864e5, IST_MS = 5.5 * 3600e3;
const dayOf = (ms: number) => new Date(ms + IST_MS).toISOString().slice(0, 10);

async function stats(req: Request, env: Env, ctx: ExecutionContext, path: string) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...CORS, 'Access-Control-Max-Age': '86400' } });
  const tally = env.STATS.get(env.STATS.idFromName('all'));
  if (path !== '/stats') {
    if (req.method !== 'POST') return new Response('Post a note', { status: 405, headers: CORS });
    const text = await req.text();
    const beacon = text.length <= 8000 ? parseBeacon(text) : null;
    if (beacon) ctx.waitUntil(tally.record(beacon, String(req.cf?.country ?? 'XX')));
    return new Response(null, { status: 204, headers: CORS });
  }
  if (!env.STATS_KEY) return new Response('Set STATS_KEY on the room server first.', { status: 503, headers: CORS });
  if (req.headers.get('Authorization') !== `Bearer ${env.STATS_KEY}`) return new Response('Wrong key', { status: 401, headers: CORS });
  const days = Math.min(Math.max(Math.floor(Number(new URL(req.url).searchParams.get('days'))) || 30, 1), 365);
  return Response.json(await tally.report(days), { headers: { ...CORS, 'Cache-Control': 'no-store' } });
}

function parseBeacon(text: string): Beacon | null {
  let b: { uid?: unknown; rounds?: unknown };
  try { b = JSON.parse(text); } catch { return null; }
  const uid = typeof b?.uid === 'string' ? b.uid.slice(0, 64) : '';
  if (!uid) return null;
  const rounds = (Array.isArray(b.rounds) ? b.rounds : []).slice(0, 20).filter((r) =>
    MODES.includes(r?.mode) && typeof r.song === 'string' && r.song.length <= 120 &&
    Number.isInteger(r.tries) && r.tries >= 0 && r.tries <= STAGES.length);
  return { uid, rounds: rounds.map((r) => ({ mode: r.mode, song: r.song, won: !!r.won, tries: r.tries })) };
}

// Every count in one Durable Object's SQLite. A beacon writes one row per song, and on a player's first beacon of
// the day one row for the visit (and one more the first time ever); repeats change nothing. The free plan's
// 100,000 row writes a day are shared with the rooms, so that is a few tens of thousands of songs a day.
export class Stats extends DurableObject<Env> {
  sql = this.ctx.storage.sql;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS players (uid TEXT PRIMARY KEY, first TEXT NOT NULL) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS visits (day TEXT, uid TEXT, country TEXT, PRIMARY KEY (day, uid)) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS rounds (ts INTEGER, day TEXT, uid TEXT, mode TEXT, song TEXT, won INTEGER, tries INTEGER);
      CREATE INDEX IF NOT EXISTS rounds_day ON rounds (day);
    `);
  }

  record(b: Beacon, country: string) {
    const now = Date.now(), day = dayOf(now);
    this.sql.exec('INSERT OR IGNORE INTO players VALUES (?, ?)', b.uid, day);
    this.sql.exec('INSERT OR IGNORE INTO visits VALUES (?, ?, ?)', day, b.uid, country);
    for (const r of b.rounds) {
      this.sql.exec('INSERT INTO rounds VALUES (?, ?, ?, ?, ?, ?, ?)', now, day, b.uid, r.mode, r.song, r.won ? 1 : 0, r.tries);
    }
  }

  report(days: number): Report {
    const now = Date.now(), today = dayOf(now), from = dayOf(now - (days - 1) * DAY_MS);
    const all = <T extends Record<string, SqlStorageValue>>(q: string, ...args: SqlStorageValue[]) => this.sql.exec<T>(q, ...args).toArray();
    const one = <T extends Record<string, SqlStorageValue>>(q: string, ...args: SqlStorageValue[]) => all<T>(q, ...args)[0];
    type Totals = { players: number; rounds: number; solved: number };

    const byDay = new Map<string, Report['days'][number]>();
    const dayRow = (day: string) => byDay.get(day) ?? byDay.set(day, { day, players: 0, newPlayers: 0, rounds: 0, solved: 0 }).get(day)!;
    for (const r of all<{ day: string; n: number }>('SELECT day, count(*) AS n FROM visits WHERE day >= ? GROUP BY day', from)) dayRow(r.day).players = r.n;
    for (const r of all<{ day: string; n: number }>('SELECT first AS day, count(*) AS n FROM players WHERE first >= ? GROUP BY first', from)) dayRow(r.day).newPlayers = r.n;
    for (const r of all<{ day: string; n: number; solved: number }>('SELECT day, count(*) AS n, sum(won) AS solved FROM rounds WHERE day >= ? GROUP BY day', from)) {
      Object.assign(dayRow(r.day), { rounds: r.n, solved: r.solved });
    }

    // The daily song counts each player once, by their first finish.
    const daily = new Map<string, Report['daily'][number]>();
    for (const r of all<{ song: string; day: string; won: number; tries: number; n: number }>(
      `SELECT song, min(day) AS day, won, tries, count(*) AS n FROM
         (SELECT song, uid, min(day) AS day, won, tries FROM rounds WHERE mode = 'daily' AND day >= ? GROUP BY song, uid)
       GROUP BY song, won, tries`, from)) {
      const d = daily.get(r.song) ?? daily.set(r.song, { song: r.song, day: r.day, players: 0, dist: STAGES.map(() => 0), missed: 0 }).get(r.song)!;
      d.players += r.n;
      d.day = r.day < d.day ? r.day : d.day;
      if (r.won) d.dist[r.tries - 1] += r.n; else d.missed += r.n;
    }

    const hours = Array<number>(24).fill(0);
    for (const r of all<{ hour: number; n: number }>('SELECT (ts / 1000 + 19800) % 86400 / 3600 AS hour, count(*) AS n FROM rounds WHERE day >= ? GROUP BY hour', from)) hours[r.hour] = r.n;

    return {
      today,
      from,
      playingNow: one<{ n: number }>('SELECT count(DISTINCT uid) AS n FROM rounds WHERE ts >= ?', now - 30 * 60e3).n,
      allTime: one<Totals>('SELECT (SELECT count(*) FROM players) AS players, count(*) AS rounds, coalesce(sum(won), 0) AS solved FROM rounds'),
      range: one<Totals & { newPlayers: number }>(
        `SELECT (SELECT count(DISTINCT uid) FROM visits WHERE day >= ?) AS players, (SELECT count(*) FROM players WHERE first >= ?) AS newPlayers,
           count(*) AS rounds, coalesce(sum(won), 0) AS solved FROM rounds WHERE day >= ?`, from, from, from),
      days: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)),
      modes: all<Report['modes'][number]>(
        `SELECT mode, count(*) AS rounds, sum(won) AS solved, count(DISTINCT uid) AS players, avg(CASE WHEN won = 1 THEN tries END) AS tries
         FROM rounds WHERE day >= ? GROUP BY mode`, from),
      daily: [...daily.values()].sort((a, b) => b.day.localeCompare(a.day)),
      // Everyone gets the same daily song, so it would top every list: these are the songs people picked pools for.
      topSongs: all<Report['topSongs'][number]>(
        `SELECT song, count(*) AS plays, sum(won) AS solved FROM rounds WHERE day >= ? AND mode != 'daily'
         GROUP BY song ORDER BY plays DESC, solved DESC LIMIT 10`, from),
      // Quick pick's four choices make any song easier, so only the clip modes count here.
      hardSongs: all<Report['hardSongs'][number]>(
        `SELECT song, count(*) AS plays, sum(won) AS solved FROM rounds WHERE day >= ? AND mode IN ('play', 'friends')
         GROUP BY song HAVING plays >= 3 ORDER BY 1.0 * solved / plays, plays DESC LIMIT 10`, from),
      hours,
      countries: all<Report['countries'][number]>(
        'SELECT country, count(DISTINCT uid) AS players FROM visits WHERE day >= ? GROUP BY country ORDER BY players DESC LIMIT 10', from),
    };
  }
}

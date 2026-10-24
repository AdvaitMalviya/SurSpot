import { useEffect, useMemo, useState } from 'react';
import { ClipRound } from '../components/ClipRound';
import { PoolPicker, describePool } from '../components/PoolPicker';
import { Reveal } from '../components/Reveal';
import { ROOMS_URL, loadMe, useRoom, type Me } from '../components/useRoom';
import { loadClip, unlockAudio } from '../lib/audio';
import { inPool, shuffle, type Pool, type Song } from '../lib/catalog';
import { POINTS, outcome, type Attempt } from '../lib/game';
import {
  NAME_LENGTH, ROOM_CODE, isDone, newRoomCode, pointsFor, standings, type Mark, type Result, type RoomState,
} from '../lib/room';
import type { buildIndex } from '../lib/search';
import { load, save } from '../lib/storage';

interface Props {
  songs: Song[];
  index: ReturnType<typeof buildIndex>;
  pool: Pool;
  onPool: (p: Pool) => void;
  code: string | null; // from the address: #/friends/ABCD
}

const ROUND_CHOICES = [5, 10, 15];
const go = (code: string | null) => { location.hash = code ? `#/friends/${code}` : '#/friends'; };
// The room this browser just made, so its first hello creates the room instead of looking for it.
let creating: string | null = null;

// Play with friends: everyone joins a room from their own device, hears the same songs and sees each other's
// progress live. The rooms run on a small server (server/src/index.ts); this file is everything players see.
export function Friends({ songs, index, pool, onPool, code }: Props) {
  const [me, setMe] = useState(loadMe);
  const rename = (name: string) => { const next = { ...me, name }; setMe(next); save('me', next); };

  if (!ROOMS_URL) {
    return (
      <div className="mode">
        <section className="door-panel">
          <h1 className="door-title">Play with friends</h1>
          <p>Rooms aren’t switched on for this copy of SurSpot. Whoever hosts it needs to deploy the room server; the README explains how.</p>
        </section>
      </div>
    );
  }
  if (!code || !me.name) return <Door code={code} me={me} onName={rename} />;
  return <InRoom key={code} code={code} me={me} songs={songs} index={index} pool={pool} onPool={onPool} />;
}

// ---------------------------------------------------------------- making or joining a room
function Door({ code, me, onName }: { code: string | null; me: Me; onName: (n: string) => void }) {
  const [name, setName] = useState(me.name);
  const [typed, setTyped] = useState(code ?? '');
  const ok = name.trim().length > 0;
  const enter = (room: string, create: boolean) => {
    unlockAudio();
    onName(name.trim());
    creating = create ? room : null;
    go(room);
  };

  return (
    <div className="mode">
      <div className="door">
        <div className="door-intro">
          <h1 className="door-title">Play with friends</h1>
          <p>Everyone plays on their own phone or laptop. The host picks the songs, you all hear the same ones, and
            the scoreboard moves as people guess. Up to twelve players, no sign-up.</p>
          <p className="door-steps">Make a room, send your friends the link, and start when everyone’s in.</p>
        </div>
        <form className="door-panel" onSubmit={(e) => { e.preventDefault(); if (ok) enter(code ?? newRoomCode(), !code); }}>
          <label className="field">
            <span>Your name</span>
            <input value={name} maxLength={NAME_LENGTH} autoComplete="nickname" placeholder="What friends call you"
              onChange={(e) => setName(e.target.value)} autoFocus />
          </label>
          {code ? (
            <>
              <button type="submit" className="btn btn-primary" disabled={!ok}>Join room {code}</button>
              <button type="button" className="link" onClick={() => go(null)}>Make your own room instead</button>
            </>
          ) : (
            <>
              <button type="submit" className="btn btn-primary" disabled={!ok}>Make a room</button>
              <p className="door-or">or join a friend’s room</p>
              <div className="door-join">
                <label className="field">
                  <span>Room code</span>
                  <input value={typed} maxLength={4} placeholder="ABCD" autoCapitalize="characters" spellCheck={false}
                    onChange={(e) => setTyped(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))} />
                </label>
                <button type="button" className="btn btn-quiet" disabled={!ok || !ROOM_CODE.test(typed)} onClick={() => enter(typed, false)}>Join</button>
              </div>
            </>
          )}
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- inside a room
const markOf = (a: Attempt): Mark => (a.kind === 'skip' ? 's' : a.verdict === 'right' ? 'r' : a.verdict === 'film' ? 'f' : 'w');
// After a reload the titles of earlier guesses are gone; the server still knows how each try went.
const fromMarks = (r?: Result): Attempt[] => [...(r?.marks ?? '')].map((m) => (m === 's'
  ? { kind: 'skip' }
  : { kind: 'guess', id: '', title: 'Your guess', movie: '', verdict: m === 'r' ? 'right' : m === 'f' ? 'film' : 'wrong' }));

function useClock(on: boolean) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => tick((n) => n + 1), 200);
    return () => clearInterval(t);
  }, [on]);
}

function InRoom({ code, me, songs, index, pool, onPool }: Omit<Props, 'code'> & { code: string; me: Me }) {
  const { room, status, problem, send, serverNow } = useRoom(code, me, creating === code);
  const byId = useMemo(() => new Map(songs.map((s) => [s.id, s])), [songs]);

  // Someone already has this code: pick another one.
  useEffect(() => {
    if (problem?.problem !== 'taken') return;
    creating = newRoomCode();
    go(creating);
  }, [problem]);

  // The current song and the next one download while the countdown runs.
  const round = room?.round ?? 0;
  useEffect(() => {
    if (!room || room.phase === 'lobby') return;
    for (const id of room.songs.slice(round, round + 2)) {
      const s = byId.get(id);
      if (s) loadClip(s).catch(() => {});
    }
  }, [room?.songs, round, room?.phase, byId]);

  const leave = () => { send({ type: 'leave' }); go(null); };

  if (problem && problem.problem !== 'taken') {
    return (
      <div className="mode">
        <section className="door-panel door-problem" role="alert">
          <h1 className="door-title">Room {code}</h1>
          <p>{problem.message}</p>
          <div className="door-actions">
            {problem.problem === 'replaced'
              ? <button type="button" className="btn btn-primary" onClick={() => location.reload()}>Play in this tab</button>
              : <button type="button" className="btn btn-primary" onClick={() => go(null)}>Make or join another room</button>}
          </div>
        </section>
      </div>
    );
  }
  if (!room) {
    return (
      <p className="empty">
        {status === 'reconnecting' ? 'Can’t reach the room server. Trying again…' : `Joining room ${code}…`}
      </p>
    );
  }

  const isHost = room.host === me.pid;
  const host = room.players.find((p) => p.pid === room.host);
  return (
    <div className="mode">
      {status === 'reconnecting' && <p className="room-banner" role="status">Connection lost. Reconnecting…</p>}
      {room.phase === 'lobby' && (
        <Lobby room={room} me={me} isHost={isHost} hostName={host?.name ?? 'The host'} songs={songs} pool={pool} onPool={onPool}
          onStart={(ids, label) => { unlockAudio(); send({ type: 'start', songs: ids, label }); }} onLeave={leave} />
      )}
      {(room.phase === 'playing' || room.phase === 'reveal') && (
        <Game key={`${room.songs.join()}-${round}`} room={room} me={me} isHost={isHost} hostName={host?.name ?? 'the host'}
          song={byId.get(room.songs[round]) ?? null} index={index} send={send} serverNow={serverNow} />
      )}
      {room.phase === 'over' && (
        <Final room={room} me={me} isHost={isHost} songs={byId} onAgain={() => send({ type: 'lobby' })} onLeave={leave} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- lobby
function Lobby({ room, me, isHost, hostName, songs, pool, onPool, onStart, onLeave }: {
  room: RoomState; me: Me; isHost: boolean; hostName: string; songs: Song[]; pool: Pool; onPool: (p: Pool) => void;
  onStart: (ids: string[], label: string) => void; onLeave: () => void;
}) {
  const [prefs, setPrefs] = useState(() => load('friends', { rounds: 10 }));
  const candidates = useMemo(() => songs.filter((s) => inPool(s, pool)), [songs, pool]);
  const [copied, setCopied] = useState(false);
  const link = `${location.origin}${location.pathname}#/friends/${room.code}`;
  const copy = async () => {
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) await navigator.share({ text: 'Guess Bollywood songs with me on SurSpot', url: link });
      else { await navigator.clipboard.writeText(link); setCopied(true); }
    } catch { /* share sheet closed */ }
  };
  const start = () => onStart(shuffle(candidates).slice(0, prefs.rounds).map((s) => s.id), describePool(pool));

  return (
    <>
      <div className="toolbar">
        {isHost ? <PoolPicker songs={songs} pool={pool} onChange={onPool} />
          : <p className="toolbar-note">{hostName} is choosing the songs.</p>}
      </div>
      <div className="round lobby">
        <div className="round-side room-card">
          <p className="room-label">Room code</p>
          <p className="room-code" aria-label={`Room ${room.code.split('').join(' ')}`}>{room.code}</p>
          <button type="button" className="btn btn-quiet" onClick={copy}>{copied ? 'Link copied' : 'Copy invite link'}</button>
          <p className="room-hint">Friends can open the link, or choose With friends and type the code.</p>
        </div>
        <div className="round-main">
          <div className="roster-head">
            <h2>Players</h2>
            <span>{room.players.length} of 12</span>
          </div>
          <ul className="roster">
            {room.players.map((p) => (
              <li key={p.pid} className={p.online ? '' : 'is-away'}>
                <span className="roster-name">{p.name}</span>
                {p.pid === room.host && <span className="tag">Host</span>}
                {p.pid === me.pid && <span className="tag tag-you">You</span>}
                {!p.online && <span className="roster-away">away</span>}
              </li>
            ))}
          </ul>
          {isHost ? (
            <div className="lobby-start">
              <div className="segmented" role="radiogroup" aria-label="Songs in the game">
                {ROUND_CHOICES.map((n) => (
                  <label key={n}>
                    <input type="radio" name="rounds" checked={prefs.rounds === n}
                      onChange={() => { const p = { rounds: n }; setPrefs(p); save('friends', p); }} />
                    <span>{n} songs</span>
                  </label>
                ))}
              </div>
              <button type="button" className="btn btn-primary" disabled={!candidates.length} onClick={start}>Start the game</button>
            </div>
          ) : (
            <p className="lobby-wait">Waiting for {hostName} to start the game.</p>
          )}
          <button type="button" className="link lobby-leave" onClick={onLeave}>Leave room</button>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- one song
function Game({ room, me, isHost, hostName, song, index, send, serverNow }: {
  room: RoomState; me: Me; isHost: boolean; hostName: string; song: Song | null; index: ReturnType<typeof buildIndex>;
  send: ReturnType<typeof useRoom>['send']; serverNow: () => number;
}) {
  const { round, phase } = room;
  const key = `room-${room.code}`;
  const server = room.results[round]?.[me.pid];
  // Kept in this browser so a reload still shows the titles you tried. startsAt tells one song from another,
  // even the same song coming up again in a later game.
  const [local, setLocal] = useState(() => load(key, { startsAt: 0, attempts: [] as Attempt[] }));
  const attempts = local.startsAt === room.startsAt && local.attempts.length >= (server?.marks.length ?? 0)
    ? local.attempts : fromMarks(server);
  const onAttempt = (a: Attempt) => {
    const next = { startsAt: room.startsAt, attempts: [...attempts, a] };
    setLocal(next); save(key, next);
  };
  // Tries the server hasn't recorded yet (just made, or made while the connection was down) go out again;
  // it ignores any it already has.
  useEffect(() => {
    if (phase !== 'playing') return;
    const known = server?.marks.length ?? 0;
    attempts.slice(known).forEach((a, i) => send({ type: 'try', round, n: known + i, mark: markOf(a) }));
  }, [attempts, server, phase, round, send]);

  const now = serverNow();
  const counting = phase === 'playing' && now < room.startsAt;
  useClock(phase === 'playing');
  const left = Math.max(0, room.endsAt - now);
  // Time's up: say so, and keep saying so until the server agrees (it checks against its own clock).
  const timeUp = phase === 'playing' && !counting && left === 0;
  useEffect(() => {
    if (!timeUp) return;
    send({ type: 'time', round });
    const t = setInterval(() => send({ type: 'time', round }), 2000);
    return () => clearInterval(t);
  }, [timeUp, round, send]);

  const notDone = room.players.filter((p) => p.pid !== me.pid && !isDone(room.results[round]?.[p.pid]));
  const others = notDone.filter((p) => p.online), dropped = notDone.filter((p) => !p.online);
  const o = outcome(attempts);
  const n = attempts.length;
  const headline = o === 'won' ? (n === 1 ? 'First try!' : `Got it on try ${n}`) : o === 'lost' ? 'Out of tries.' : 'Time’s up.';
  const total = room.songs.length;

  return (
    <>
      <div className="toolbar room-bar">
        <div className="room-round">
          <b>Song {round + 1} of {total}</b>
          {phase === 'playing' && !counting && (
            <>
              <div className="timer" aria-hidden="true"><span style={{ transform: `scaleX(${left / (room.endsAt - room.startsAt)})` }} /></div>
              <span className="room-clock">{Math.ceil(left / 1000)} s left</span>
            </>
          )}
        </div>
        <PlayerStrip room={room} me={me} />
      </div>
      {counting ? (
        <section className="countdown" aria-live="polite">
          <p className="countdown-n">{Math.ceil((room.startsAt - now) / 1000)}</p>
          <p className="countdown-hint">{round ? 'Next song coming up' : 'Get ready. The first clip plays as the count ends.'}</p>
        </section>
      ) : !song ? (
        <p className="empty">This song isn’t in your copy of SurSpot. Reload the page to get the latest song list.</p>
      ) : (
        <ClipRound song={song} index={index} attempts={attempts} onAttempt={onAttempt} autoplay ended={phase === 'reveal'}
          hold={phase === 'playing' ? (
            <section className="waiting" aria-live="polite">
              <p className="reveal-headline">{headline}</p>
              {o === 'won' && <p className="reveal-detail">+{POINTS[n - 1]} points</p>}
              <p className="waiting-note">
                {others.length ? `Waiting for ${listNames(others.map((p) => p.name))}. The answer shows when everyone’s done or the time runs out.`
                  : dropped.length ? `${listNames(dropped.map((p) => p.name))} lost the connection. Giving them a few seconds to come back…`
                  : 'Showing the answer…'}
              </p>
              <RoundTable room={room} me={me} />
            </section>
          ) : undefined}
          reveal={
            <Reveal song={song} headline={o === 'playing' ? 'Time’s up. It was this one.' : o === 'won' ? headline : 'Out of tries. It was this one.'}
              detail={o === 'won' ? `+${POINTS[n - 1]} points` : undefined}>
              {isHost
                ? <button type="button" className="btn btn-primary" autoFocus onClick={() => { unlockAudio(); send({ type: 'next' }); }}>
                    {round + 1 < total ? 'Next song' : 'See the final scores'}
                  </button>
                : <p className="room-note">Waiting for {hostName} to {round + 1 < total ? 'play the next song' : 'show the final scores'}.</p>}
            </Reveal>
          } />
      )}
    </>
  );
}

const listNames = (names: string[]) => (names.length < 3 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);

// Each player's tries on this song, as dots in the result colours.
function Dots({ result, live }: { result?: Result; live: boolean }) {
  const marks = [...(result?.marks ?? '')];
  return (
    <span className="dots" aria-hidden="true">
      {marks.map((m, i) => <i key={i} className={`dot dot-${m}`} />)}
      {live && !isDone(result) && <i className="dot dot-next" />}
    </span>
  );
}
const roundStatus = (r?: Result) =>
  !r?.marks ? 'Listening' : r.marks.endsWith('r') ? `Got it on try ${r.marks.length}` : isDone(r) ? 'Out of tries' : `On try ${r.marks.length + 1}`;

// The scoreboard above the round: everyone's total, and how they're doing on this song.
function PlayerStrip({ room, me }: { room: RoomState; me: Me }) {
  const live = room.phase === 'playing';
  return (
    <ol className="players" aria-label="Scores">
      {standings(room).map((p) => {
        const r = room.results[room.round]?.[p.pid];
        return (
          <li key={p.pid} className={`player ${p.pid === me.pid ? 'is-me' : ''} ${p.online ? '' : 'is-away'}`}
            title={`${p.name}: ${roundStatus(r)}`}>
            <span className="player-name">{p.name}</span>
            <b className="player-score">{p.total}</b>
            <Dots result={r} live={live && p.online} />
            {pointsFor(r) > 0 && <span className="player-gain">+{pointsFor(r)}</span>}
            <span className="sr-only">{roundStatus(r)}</span>
          </li>
        );
      })}
    </ol>
  );
}

// Shown while you wait for the others: where everyone is on this song.
function RoundTable({ room, me }: { room: RoomState; me: Me }) {
  return (
    <ul className="round-table">
      {room.players.filter((p) => p.online || room.results[room.round]?.[p.pid]).map((p) => {
        const r = room.results[room.round]?.[p.pid];
        return (
          <li key={p.pid} className={p.pid === me.pid ? 'is-me' : ''}>
            <span className="round-table-name">{p.name}</span>
            <Dots result={r} live />
            <span className="round-table-status">{roundStatus(r)}</span>
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------- final scores
function Final({ room, me, isHost, songs, onAgain, onLeave }: {
  room: RoomState; me: Me; isHost: boolean; songs: Map<string, Song>; onAgain: () => void; onLeave: () => void;
}) {
  const ranked = standings(room);
  const top = ranked[0];
  const winners = ranked.filter((p) => p.total === top.total && p.time === top.time);
  const solvedBy = (pid: string) => room.results.filter((r) => r[pid]?.marks.endsWith('r')).length;
  const title = winners.length > 1 ? `${listNames(winners.map((p) => p.name))} tie` : `${top.name} wins`;

  return (
    <div className="round final">
      <div className="round-side final-side">
        <p className="room-label">After {room.songs.length} songs</p>
        <h1 className="final-title">{title}</h1>
        <p className="final-score"><b>{top.total}</b> points, {solvedBy(top.pid)} of {room.songs.length} songs named</p>
        {winners.length === 1 && ranked[1]?.total === top.total && (
          <p className="final-score">Level on points with {ranked[1].name}, but quicker to the answers.</p>
        )}
        <ol className="final-songs" aria-label="Songs in this game">
          {room.songs.map((id, i) => {
            const s = songs.get(id);
            return <li key={id + i}><b>{s?.title ?? 'Unknown song'}</b> {s && <span>{s.movie}, {s.year}</span>}</li>;
          })}
        </ol>
      </div>
      <div className="round-main">
        <ol className="standings">
          {ranked.map((p, rank) => (
            <li key={p.pid} className={p.pid === me.pid ? 'is-me' : ''}>
              <span className="standings-rank">{rank + 1}</span>
              <span className="standings-name">{p.name}</span>
              <span className="standings-rounds" aria-label={`${solvedBy(p.pid)} of ${room.songs.length} named`}>
                {room.results.map((r, i) => {
                  const res = r[p.pid];
                  const won = res?.marks.endsWith('r');
                  return <i key={i} className={won ? 'is-won' : ''} title={`Song ${i + 1}: ${roundStatus(res)}`}>{won ? res!.marks.length : ''}</i>;
                })}
              </span>
              <b className="standings-total">{p.total}</b>
            </li>
          ))}
        </ol>
        <p className="standings-key">Each square is a song; the number is the try that named it.</p>
        <div className="reveal-actions">
          {isHost ? <button type="button" className="btn btn-primary" onClick={onAgain}>Play again</button>
            : <p className="room-note">Waiting for the host to start another game.</p>}
          <button type="button" className="link" onClick={onLeave}>Leave room</button>
        </div>
      </div>
    </div>
  );
}


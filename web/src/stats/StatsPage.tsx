import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Mode, Report } from '../lib/beacon';
import { artworkAt, dayNumber, loadCatalog, sourceLabel, type Song } from '../lib/catalog';
import { STAGES } from '../lib/game';
import { load, save } from '../lib/storage';
import { STATS_URL } from '../lib/track';
import { Bars, Columns, TableView, fmt, pct, type Datum } from './charts';

// How many people play SurSpot and what they play, from the counts the room server keeps (server/src/index.ts).
// Behind the STATS_KEY password, kept in this browser once it works. It loads on open and on Refresh only: every
// load reads the counts again, and the free plan's daily reads are better spent on that than on a timer.

const RANGES = [7, 30, 90];
const MODE_NAMES: Record<Mode, string> = { play: 'Play', daily: 'Daily', quick: 'Quick pick', friends: 'With friends' };
const DAY_MS = 864e5;

const shortDate = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const longDate = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'long', timeZone: 'UTC' });
const daysFrom = (from: string, to: string) => {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += DAY_MS) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
};
const hourLabel = (h: number) => (h % 12 || 12) + (h < 12 ? 'a' : 'p');
const regions = new Intl.DisplayNames(['en'], { type: 'region' });
const countryName = (code: string) => {
  if (code === 'T1') return 'Over Tor';
  try { return code === 'XX' ? 'Unknown' : regions.of(code) ?? code; } catch { return code; }
};

type State = { status: 'locked'; problem?: string } | { status: 'loading' } | { status: 'ready'; report: Report; at: number } | { status: 'failed'; problem: string };

export function StatsPage() {
  const [key, setKey] = useState(() => load('stats', { key: '' }).key);
  const [days, setDays] = useState(() => load('stats-range', { days: 30 }).days);
  const [state, setState] = useState<State>(key ? { status: 'loading' } : { status: 'locked' });
  const [songs, setSongs] = useState<Map<string, Song>>(new Map());

  useEffect(() => { loadCatalog().then((all) => setSongs(new Map(all.map((s) => [s.id, s]))), () => {}); }, []);

  const refresh = useCallback(async () => {
    if (!key) return setState({ status: 'locked' });
    setState((s) => (s.status === 'ready' ? s : { status: 'loading' }));
    try {
      const res = await fetch(`${STATS_URL}/stats?days=${days}`, { headers: { Authorization: `Bearer ${key}` } });
      if (res.status === 401) { save('stats', { key: '' }); return setState({ status: 'locked', problem: 'That password didn’t work.' }); }
      if (!res.ok) return setState({ status: 'failed', problem: (await res.text()) || `The room server answered ${res.status}.` });
      save('stats', { key });
      setState({ status: 'ready', report: await res.json(), at: Date.now() });
    } catch {
      setState({ status: 'failed', problem: 'The room server didn’t answer. Check your connection, then refresh.' });
    }
  }, [key, days]);
  useEffect(() => { refresh(); }, [refresh]);

  const pickRange = (d: number) => { setDays(d); save('stats-range', { days: d }); };
  const signOut = () => { save('stats', { key: '' }); setKey(''); setState({ status: 'locked' }); };

  return (
    <>
      <div className="backdrop" aria-hidden="true" />
      <div className="stats">
        <header className="stats-head">
          <a className="wordmark" href="./" aria-label="SurSpot, back to the game"><span lang="hi">सुर</span>Spot</a>
          <h1>Stats</h1>
          {state.status !== 'locked' && (
            <div className="stats-controls">
              <div className="segmented" role="radiogroup" aria-label="Period">
                {RANGES.map((d) => (
                  <label key={d}>
                    <input type="radio" name="range" checked={days === d} onChange={() => pickRange(d)} />
                    <span>{d} days</span>
                  </label>
                ))}
              </div>
              <button type="button" className="btn btn-quiet" onClick={refresh}>Refresh</button>
            </div>
          )}
        </header>

        {state.status === 'locked' && <KeyForm problem={state.problem} onKey={(k) => { setKey(k); setState({ status: 'loading' }); }} />}
        {state.status === 'loading' && <p className="empty">Counting…</p>}
        {state.status === 'failed' && <p className="empty" role="alert">{state.problem}</p>}
        {state.status === 'ready' && <Dashboard report={state.report} songs={songs} />}

        {state.status === 'ready' && (
          <footer className="stats-foot">
            <p>
              Updated {new Date(state.at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}. Days run on India time.
              A player is one browser: the same person on a phone and a laptop counts twice, and a cleared browser counts again.
              Songs count when their round ends; ad blockers can stop a few from being counted.
            </p>
            <button type="button" className="link" onClick={signOut}>Forget the password on this browser</button>
          </footer>
        )}
      </div>
    </>
  );
}

function KeyForm({ problem, onKey }: { problem?: string; onKey: (key: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <form className="panel key-form" onSubmit={(e) => { e.preventDefault(); if (value.trim()) onKey(value.trim()); }}>
      <h2>Who’s playing SurSpot</h2>
      <p>Enter the stats password: the STATS_KEY secret on the room server{import.meta.env.DEV ? ' (“dev” while running npm run dev)' : ''}.</p>
      <div className="key-row">
        <label className="sr-only" htmlFor="stats-key">Password</label>
        <input id="stats-key" type="password" autoComplete="current-password" placeholder="Password" value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
        <button type="submit" className="btn btn-primary">Show stats</button>
      </div>
      {problem && <p className="key-problem" role="alert">{problem}</p>}
    </form>
  );
}

function Dashboard({ report: r, songs }: { report: Report; songs: Map<string, Song> }) {
  const dayList = useMemo(() => daysFrom(r.from, r.today), [r.from, r.today]);
  const byDay = useMemo(() => new Map(r.days.map((d) => [d.day, d])), [r.days]);
  const perDay = (pick: (d: Report['days'][number]) => number, detail?: (d: Report['days'][number]) => string): Datum[] =>
    dayList.map((day) => {
      const d = byDay.get(day) ?? { day, players: 0, newPlayers: 0, rounds: 0, solved: 0 };
      return { key: day, label: shortDate(day), value: pick(d), detail: `${longDate(day)}${detail ? ` · ${detail(d)}` : ''}` };
    });
  const today = byDay.get(r.today), yesterday = byDay.get(dayList[dayList.length - 2] ?? '');
  const span = dayList.length === 1 ? 'today' : `in ${dayList.length} days`;
  const nothing = r.allTime.players === 0;

  return (
    <main className="stats-grid">
      {nothing && (
        <p className="panel notice span-12">
          Nothing counted yet. Counting starts once this version of the game and the room server are deployed; open the
          game and finish a song to see the first numbers.
        </p>
      )}

      <section className="panel hero span-5" aria-label="Today">
        <h2>Players today</h2>
        <p className="hero-value">{fmt(today?.players ?? 0)}</p>
        <p className="hero-sub">
          {fmt(today?.rounds ?? 0)} songs played · yesterday {fmt(yesterday?.players ?? 0)} players
        </p>
        <p className={`live ${r.playingNow ? 'is-on' : ''}`}><span aria-hidden="true" />{fmt(r.playingNow)} playing in the last 30 minutes</p>
      </section>

      <section className="tiles span-7" aria-label={`The last ${dayList.length} days`}>
        <Tile label={`Players ${span}`} value={fmt(r.range.players)} sub={`${fmt(r.range.newPlayers)} new`} />
        <Tile label={`Songs played ${span}`} value={fmt(r.range.rounds)} sub={`${r.range.players ? (r.range.rounds / r.range.players).toFixed(1) : '0'} per player`} />
        <Tile label="Songs solved" value={pct(r.range.solved, r.range.rounds)} sub={`${fmt(r.range.solved)} of ${fmt(r.range.rounds)}`} />
        <Tile label="All time" value={fmt(r.allTime.players)} sub={`players · ${fmt(r.allTime.rounds)} songs`} />
      </section>

      <section className="panel span-6">
        <h2>Players each day</h2>
        <p className="panel-sub">Different browsers that opened the game</p>
        <Columns data={perDay((d) => d.players, (d) => `${fmt(d.newPlayers)} new`)} color="var(--c-players)" unit="players" />
        <TableView head={['Day', 'Players', 'New']} rows={dayList.map((day) => [longDate(day), fmt(byDay.get(day)?.players ?? 0), fmt(byDay.get(day)?.newPlayers ?? 0)])} />
      </section>

      <section className="panel span-6">
        <h2>Songs played each day</h2>
        <p className="panel-sub">Every round that ended, in every mode</p>
        <Columns data={perDay((d) => d.rounds, (d) => `${pct(d.solved, d.rounds)} solved`)} color="var(--c-songs)" unit="songs" />
        <TableView head={['Day', 'Songs', 'Solved']} rows={dayList.map((day) => [longDate(day), fmt(byDay.get(day)?.rounds ?? 0), fmt(byDay.get(day)?.solved ?? 0)])} />
      </section>

      <Modes report={r} />
      <DailySongs report={r} songs={songs} />

      <SongList title="Most played" sub="Play, Quick pick and With friends; the daily song is left out" rows={r.topSongs} songs={songs} />
      <SongList title="Hardest" sub="Lowest share solved in Play and With friends, from songs heard at least 3 times" rows={r.hardSongs} songs={songs} />

      <section className="panel span-6">
        <h2>When people play</h2>
        <p className="panel-sub">Songs played by hour, India time</p>
        <Columns data={r.hours.map((n, h) => ({ key: String(h), label: hourLabel(h), value: n, detail: `${hourLabel(h)}m to ${hourLabel((h + 1) % 24)}m` }))}
          color="var(--c-songs)" unit="songs" everyLabel={3} />
        <TableView head={['Hour', 'Songs']} rows={r.hours.map((n, h) => [`${hourLabel(h)}m`, fmt(n)])} />
      </section>

      <section className="panel span-6">
        <h2>Where players are</h2>
        <p className="panel-sub">Players by country {span}</p>
        {r.countries.length
          ? <Bars color="var(--c-players)" rows={r.countries.map((c) => ({ key: c.country, label: countryName(c.country), value: c.players }))} />
          : <p className="none">No players yet.</p>}
      </section>
    </main>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="panel tile">
      <h2>{label}</h2>
      <p className="tile-value">{value}</p>
      <p className="tile-sub">{sub}</p>
    </div>
  );
}

function Modes({ report: r }: { report: Report }) {
  const rows = (Object.keys(MODE_NAMES) as Mode[]).map((mode) => {
    const m = r.modes.find((x) => x.mode === mode) ?? { mode, rounds: 0, solved: 0, players: 0, tries: null };
    const tries = m.tries && mode !== 'quick' ? ` · solved on try ${m.tries.toFixed(1)} on average` : '';
    return { key: mode, label: MODE_NAMES[mode], value: m.rounds, detail: `${fmt(m.players)} players · ${pct(m.solved, m.rounds)} solved${tries}` };
  });
  return (
    <section className="panel span-6">
      <h2>Songs played by mode</h2>
      <p className="panel-sub">In the same period</p>
      <Bars color="var(--c-songs)" rows={rows} />
    </section>
  );
}

function DailySongs({ report: r, songs }: { report: Report; songs: Map<string, Song> }) {
  const [picked, setPicked] = useState(0);
  const d = r.daily[Math.min(picked, r.daily.length - 1)];
  const song = d && songs.get(d.song);
  const solved = d ? d.players - d.missed : 0;
  return (
    <section className="panel span-6">
      <h2>The daily song</h2>
      {!d ? <p className="none">Nobody has finished a daily song in this period yet.</p> : (
        <>
          <p className="panel-sub">
            #{dayNumber(d.day)}, {longDate(d.day)}: {song ? <b>{song.title}</b> : d.song} · {fmt(d.players)} played, {pct(solved, d.players)} solved
          </p>
          <Bars color="var(--right)" rows={[
            ...d.dist.map((n, i) => ({ key: String(i), label: `Try ${i + 1} · ${STAGES[i]} s`, value: n })),
            { key: 'x', label: 'Missed', value: d.missed, color: 'var(--wrong)' },
          ]} />
          {r.daily.length > 1 && (
            <div className="daily-days" role="group" aria-label="Pick a day">
              {r.daily.slice(0, 14).map((x, i) => (
                <button key={x.song} type="button" className={`chip-day ${i === picked ? 'is-on' : ''}`} aria-pressed={i === picked} onClick={() => setPicked(i)}>
                  {shortDate(x.day)} <span>{fmt(x.players)}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function SongList({ title, sub, rows, songs }: { title: string; sub: string; rows: Report['topSongs']; songs: Map<string, Song> }) {
  return (
    <section className="panel span-6">
      <h2>{title}</h2>
      <p className="panel-sub">{sub}</p>
      {!rows.length ? <p className="none">Not enough songs played yet.</p> : (
        <ol className="song-list">
          {rows.map((row) => {
            const s = songs.get(row.song);
            const art = s && artworkAt(s, 96);
            return (
              <li key={row.song}>
                {art ? <img src={art} alt="" width={40} height={40} loading="lazy" /> : <span className="no-art" />}
                <span className="song-name">
                  <b>{s?.title ?? row.song}</b>
                  <span>{s ? sourceLabel(s) : 'Not in the song list any more'}</span>
                </span>
                <span className="song-num"><b>{fmt(row.plays)}</b> plays</span>
                <span className="song-num"><b>{pct(row.solved, row.plays)}</b> solved</span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

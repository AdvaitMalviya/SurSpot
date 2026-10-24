import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { HelpDialog, StatsDialog } from './components/Dialogs';
import { setVolume } from './lib/audio';
import { DEFAULT_POOL, loadCatalog, shuffle, type Pool, type Song } from './lib/catalog';
import { buildIndex } from './lib/search';
import { load, save } from './lib/storage';
import { Daily } from './modes/Daily';
import { Endless } from './modes/Endless';
import { Friends } from './modes/Friends';
import { QuickPick } from './modes/QuickPick';

type Route = 'play' | 'daily' | 'quick' | 'friends';
const routeOf = (): Route => {
  const h = location.hash.replace(/^#\/?/, '').split('/')[0];
  return h === 'daily' || h === 'quick' || h === 'friends' ? h : 'play';
};
// #/friends/ABCD is room ABCD
const roomOf = () => location.hash.match(/^#\/?friends\/([a-z]{4})$/i)?.[1].toUpperCase() ?? null;
const MODES: [Route, string, string][] = [
  ['play', 'Play', '#/'], ['daily', 'Daily', '#/daily'], ['quick', 'Quick pick', '#/quick'], ['friends', 'With friends', '#/friends'],
];

export default function App() {
  const [route, setRoute] = useState<Route>(routeOf);
  const [room, setRoom] = useState(roomOf);
  const [songs, setSongs] = useState<Song[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [pool, setPool] = useState<Pool>(() => load('pool', DEFAULT_POOL));
  const [prefs, setPrefs] = useState(() => load('prefs', { volume: 0.8, seenHelp: false }));
  const [dialog, setDialog] = useState<'help' | 'stats' | null>(prefs.seenHelp ? null : 'help');
  const [today, setToday] = useState<number>();

  useEffect(() => {
    const onHash = () => { setRoute(routeOf()); setRoom(roomOf()); };
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  }, []);
  useEffect(() => { loadCatalog().then(setSongs, () => setFailed(true)); }, []);
  useEffect(() => { setVolume(prefs.volume); save('prefs', prefs); }, [prefs]);
  const index = useMemo(() => (songs ? buildIndex(songs) : []), [songs]);
  // The backdrop is a wall of 40 random covers, repeated to fill the screen. Small thumbnails: it sits behind a veil.
  const covers = useMemo(() => (songs ? shuffle(songs.filter((s) => s.artwork)).slice(0, 40)
    .map((s) => s.artwork!.replace(/\/\d+x\d+bb\./, '/120x120bb.')) : []), [songs]);

  const changePool = (p: Pool) => { setPool(p); save('pool', p); };
  const closeDialog = () => {
    if (dialog === 'help' && !prefs.seenHelp) setPrefs({ ...prefs, seenHelp: true });
    setDialog(null);
  };

  return (
    <>
      <div className="backdrop" aria-hidden="true">
        <div className="wall">
          {covers.length > 0 && Array.from({ length: 240 }, (_, i) => <img key={i} src={covers[(i * 7) % covers.length]} alt="" />)}
        </div>
        <div className="backdrop-art" />
      </div>
      <div className="app">
        <header className="masthead">
          <div className="brand">
            <a className="wordmark" href="#/">SurSpot</a>
            <p className="tagline">Name the Bollywood song from a split second of it</p>
          </div>
          <nav className="modes" aria-label="Game modes" style={{ '--i': MODES.findIndex(([r]) => r === route) } as CSSProperties}>
            {MODES.map(([r, label, href]) => <a key={r} href={href} aria-current={route === r ? 'page' : undefined}>{label}</a>)}
          </nav>
          <div className="tools">
            <label className="volume">
              <span className="sr-only">Volume</span>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" /><path d="M16.5 8.5a5 5 0 0 1 0 7" fill="none" /></svg>
              <input type="range" min={0} max={1} step={0.05} value={prefs.volume} onChange={(e) => setPrefs({ ...prefs, volume: Number(e.target.value) })} />
            </label>
            <button type="button" className="icon-btn" aria-label="How to play" onClick={() => setDialog('help')}>?</button>
            <button type="button" className="icon-btn" aria-label="Your stats" onClick={() => { setToday(undefined); setDialog('stats'); }}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 20V11M12 20V5M19 20v-6" /></svg>
            </button>
          </div>
        </header>

        <main>
          {failed && <p className="empty">The song list didn’t load. Check your connection and reload the page.</p>}
          {!songs && !failed && <p className="empty">Loading songs…</p>}
          {songs && route === 'play' && <Endless songs={songs} index={index} pool={pool} onPool={changePool} />}
          {songs && route === 'daily' && <Daily songs={songs} index={index} onStats={(t) => { setToday(t || undefined); setDialog('stats'); }} />}
          {songs && route === 'quick' && <QuickPick songs={songs} pool={pool} onPool={changePool} />}
          {songs && route === 'friends' && <Friends songs={songs} index={index} pool={pool} onPool={changePool} code={room} />}
        </main>


        <HelpDialog open={dialog === 'help'} onClose={closeDialog} />
        <StatsDialog open={dialog === 'stats'} onClose={closeDialog} today={today} />
      </div>
    </>
  );
}

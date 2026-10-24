import { useEffect, useState, type ReactNode } from 'react';
import { setAmbient } from '../lib/ambient';
import { devanagariTitle, isFilm, sourceLabel, type Song } from '../lib/catalog';
import { filmInfo, type Film } from '../lib/wiki';

interface Props {
  song: Song;
  headline: string;
  detail?: string;
  children?: ReactNode; // next-step actions
}

const searchTerm = (s: Song) => encodeURIComponent(`${s.title} ${s.movie} ${s.singers[0] ?? ''}`.trim());

// Brand marks from Simple Icons (CC0), in the brand colours set in styles.css.
const ICONS = {
  apple: 'M23.994 6.124a9.23 9.23 0 00-.24-2.19c-.317-1.31-1.062-2.31-2.18-3.043a5.022 5.022 0 00-1.877-.726 10.496 10.496 0 00-1.564-.15c-.04-.003-.083-.01-.124-.013H5.986c-.152.01-.303.017-.455.026-.747.043-1.49.123-2.193.4-1.336.53-2.3 1.452-2.865 2.78-.192.448-.292.925-.363 1.408-.056.392-.088.785-.1 1.18 0 .032-.007.062-.01.093v12.223c.01.14.017.283.027.424.05.815.154 1.624.497 2.373.65 1.42 1.738 2.353 3.234 2.801.42.127.856.187 1.293.228.555.053 1.11.06 1.667.06h11.03a12.5 12.5 0 001.57-.1c.822-.106 1.596-.35 2.295-.81a5.046 5.046 0 001.88-2.207c.186-.42.293-.87.37-1.324.113-.675.138-1.358.137-2.04-.002-3.8 0-7.595-.003-11.393zm-6.423 3.99v5.712c0 .417-.058.827-.244 1.206-.29.59-.76.962-1.388 1.14-.35.1-.706.157-1.07.173-.95.045-1.773-.6-1.943-1.536a1.88 1.88 0 011.038-2.022c.323-.16.67-.25 1.018-.324.378-.082.758-.153 1.134-.24.274-.063.457-.23.51-.516a.904.904 0 00.02-.193c0-1.815 0-3.63-.002-5.443a.725.725 0 00-.026-.185c-.04-.15-.15-.243-.304-.234-.16.01-.318.035-.475.066-.76.15-1.52.303-2.28.456l-2.325.47-1.374.278c-.016.003-.032.01-.048.013-.277.077-.377.203-.39.49-.002.042 0 .086 0 .13-.002 2.602 0 5.204-.003 7.805 0 .42-.047.836-.215 1.227-.278.64-.77 1.04-1.434 1.233-.35.1-.71.16-1.075.172-.96.036-1.755-.6-1.92-1.544-.14-.812.23-1.685 1.154-2.075.357-.15.73-.232 1.108-.31.287-.06.575-.116.86-.177.383-.083.583-.323.6-.714v-.15c0-2.96 0-5.922.002-8.882 0-.123.013-.25.042-.37.07-.285.273-.448.546-.518.255-.066.515-.112.774-.165.733-.15 1.466-.296 2.2-.444l2.27-.46c.67-.134 1.34-.27 2.01-.403.22-.043.442-.088.663-.106.31-.025.523.17.554.482.008.073.012.148.012.223.002 1.91.002 3.822 0 5.732z',
  spotify: 'M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z',
  youtube: 'M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z',
};
const Icon = ({ name }: { name: keyof typeof ICONS }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className={`listen-icon listen-${name}`}><path d={ICONS[name]} /></svg>
);

// The answer card: the song, who made it, where to hear all of it, and a note on the film from Wikipedia.
export function Reveal({ song, headline, detail, children }: Props) {
  const [film, setFilm] = useState<Film | null>(null);
  useEffect(() => {
    let live = true;
    setFilm(null);
    filmInfo(song).then((f) => live && setFilm(f));
    setAmbient(song.artwork);
    return () => { live = false; setAmbient(null); };
  }, [song]);
  const deva = devanagariTitle(song);

  return (
    <section className="reveal" aria-live="polite">
      <p className="reveal-headline">{headline}</p>
      {detail && <p className="reveal-detail">{detail}</p>}
      <div className="reveal-song">
        {song.artwork && <img className="reveal-art" src={song.artwork} alt={`Cover of ${song.movie || song.title}`} width={600} height={600} />}
        <div className="reveal-names">
          <h2 className="reveal-title">{song.title}</h2>
          {deva && <p className="reveal-deva" lang="hi">{deva}</p>}
          <p className="reveal-film">{isFilm(song) || !song.movie ? sourceLabel(song) : `${song.movie} (non-film), ${song.year}`}</p>
        </div>
      </div>
      <dl className="credits">
        {song.singers.length > 0 && <div><dt>Sung by</dt><dd title={song.singers.join(', ')}>{song.singers.join(', ')}</dd></div>}
        {song.composers.length > 0 && <div><dt>Music by</dt><dd title={song.composers.join(', ')}>{song.composers.join(', ')}</dd></div>}
      </dl>
      <div className="listen">
        <span className="listen-label">Hear the full song on</span>
        {song.appleUrl && <a href={song.appleUrl} target="_blank" rel="noreferrer"><Icon name="apple" />Apple Music</a>}
        <a href={`https://open.spotify.com/search/${searchTerm(song)}`} target="_blank" rel="noreferrer"><Icon name="spotify" />Spotify</a>
        <a href={`https://www.youtube.com/results?search_query=${searchTerm(song)}`} target="_blank" rel="noreferrer"><Icon name="youtube" />YouTube</a>
      </div>
      {film && (
        <aside className="film-note">
          {film.thumb && <img src={film.thumb} alt={`Poster of ${film.title}`} loading="lazy" />}
          <div>
            <p>{film.extract}</p>
            <a href={film.url} target="_blank" rel="noreferrer">More about {film.title} on Wikipedia</a>
          </div>
        </aside>
      )}
      {children && <div className="reveal-actions">{children}</div>}
    </section>
  );
}

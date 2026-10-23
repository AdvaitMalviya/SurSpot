import { useEffect, useState, type ReactNode } from 'react';
import { setAmbient } from '../lib/ambient';
import { devanagariTitle, isFilm, type Song } from '../lib/catalog';
import { filmInfo, type Film } from '../lib/wiki';

interface Props {
  song: Song;
  headline: string;
  detail?: string;
  children?: ReactNode; // next-step actions
}

const searchTerm = (s: Song) => encodeURIComponent(`${s.title} ${s.movie} ${s.singers[0] ?? ''}`.trim());

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
        {song.artwork && <img className="reveal-art" src={song.artwork} alt={`Cover of ${song.movie}`} width={600} height={600} />}
        <div className="reveal-names">
          <h2 className="reveal-title">{song.title}</h2>
          {deva && <p className="reveal-deva" lang="hi">{deva}</p>}
          <p className="reveal-film">{isFilm(song) ? song.movie : `${song.movie} (non-film)`}, {song.year}</p>
        </div>
      </div>
      <dl className="credits">
        <div><dt>Sung by</dt><dd>{song.singers.join(', ')}</dd></div>
        <div><dt>Music by</dt><dd>{song.composers.join(', ')}</dd></div>
      </dl>
      <div className="listen">
        <span className="listen-label">Hear the full song on</span>
        {song.appleUrl && <a href={song.appleUrl} target="_blank" rel="noreferrer">Apple Music</a>}
        <a href={`https://open.spotify.com/search/${searchTerm(song)}`} target="_blank" rel="noreferrer">Spotify</a>
        <a href={`https://www.youtube.com/results?search_query=${searchTerm(song)}`} target="_blank" rel="noreferrer">YouTube</a>
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

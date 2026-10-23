import { useCallback, useEffect, useRef, useState } from 'react';
import { loadClip, type Clip } from '../lib/audio';
import type { Song } from '../lib/catalog';

// Loads a song's preview and exposes play/stop plus the playhead, updated every animation frame.
// The loaded clip is tagged with its song id, so a render right after the song changes never reports
// the previous song's clip as ready.
export function useClip(song: Song | null) {
  const [loaded, setLoaded] = useState<{ id: string; clip: Clip } | null>(null);
  const [failed, setFailed] = useState<{ id: string; message: string } | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [span, setSpan] = useState(0); // length of the clip currently playing
  const run = useRef(0);

  useEffect(() => {
    if (!song) return;
    let live = true;
    setElapsed(null);
    loadClip(song).then(
      (clip) => live && setLoaded({ id: song.id, clip }),
      (e: Error) => live && setFailed({ id: song.id, message: e.message || 'The preview could not be loaded.' }),
    );
    return () => { live = false; };
  }, [song]);

  const clip = loaded && loaded.id === song?.id ? loaded.clip : null;
  const error = failed && failed.id === song?.id ? failed.message : null;
  useEffect(() => () => clip?.stop(), [clip]);

  const play = useCallback(async (seconds: number, from?: number) => {
    if (!clip) return;
    const id = ++run.current;
    setSpan(Math.min(seconds, clip.duration - (from ?? clip.onset)));
    let frame = 0;
    const tick = () => {
      if (run.current !== id) return;
      setElapsed(clip.elapsed() ?? 0);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    await clip.play(seconds, from);
    cancelAnimationFrame(frame);
    if (run.current === id) setElapsed(null);
  }, [clip]);

  const stop = useCallback(() => { run.current++; clip?.stop(); setElapsed(null); }, [clip]);

  const status: 'loading' | 'ready' | 'error' = error ? 'error' : clip ? 'ready' : 'loading';
  // The main line, played when a round ends.
  const playHook = useCallback((seconds = Infinity) => {
    if (clip) play(Math.min(seconds, clip.duration - clip.hook), clip.hook);
  }, [clip, play]);

  return { clip, error, status, elapsed, span, playing: elapsed !== null, play, playHook, stop };
}

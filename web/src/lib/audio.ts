import type { Song } from './catalog';

// Clips are cut from the iTunes 30-second preview with Web Audio, so a 0.2 s stage is exactly 0.2 s.
// Previews fade in, so every clip starts at the first moment the music is at full level, not at 0:00.
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let volume = 0.8;

function audio() {
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = volume;
    master.connect(ctx.destination);
  }
  return { ctx, master: master! };
}
export const audioRunning = () => ctx?.state === 'running';
export function setVolume(v: number) {
  volume = v;
  if (master && ctx) master.gain.setTargetAtTime(v, ctx.currentTime, 0.02);
}

// iTunes preview URLs occasionally rotate; the lookup API hands back the current one.
async function freshPreview(trackId: number) {
  const res = await fetch(`https://itunes.apple.com/lookup?id=${trackId}&country=in`);
  const body = await res.json();
  return (body.results?.[0]?.previewUrl as string | undefined) ?? null;
}
async function fetchPreview(song: Song, signal?: AbortSignal) {
  let res = await fetch(song.preview, { signal }).catch(() => null);
  if (!res?.ok) {
    const url = await freshPreview(song.trackId);
    if (!url) throw new Error('This song has no preview on iTunes right now.');
    res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`Preview returned HTTP ${res.status}.`);
  }
  return res.arrayBuffer();
}

function loudness(buf: AudioBuffer, hop: number) {
  const data = buf.getChannelData(0), win = Math.round(buf.sampleRate * hop);
  const rms: number[] = [];
  for (let i = 0; i + win <= data.length; i += win) {
    let sum = 0;
    for (let j = i; j < i + win; j++) sum += data[j] * data[j];
    rms.push(Math.sqrt(sum / win));
  }
  return rms;
}

// First 50 ms window whose loudness reaches 40% of the preview's typical loudness.
function findOnset(buf: AudioBuffer) {
  const rms = loudness(buf, 0.05);
  const median = [...rms].sort((a, b) => a - b)[Math.floor(rms.length / 2)] ?? 0;
  const k = rms.findIndex((r) => r >= median * 0.4);
  return Math.min(Math.max(k, 0) * 0.05, 6);
}

// Where the main line (mukhda or chorus) most likely starts: the fullest, loudest 12 s of the preview,
// pulled back to the quietest moment in the 1.5 s before it so playback begins at the start of a phrase.
function findHook(buf: AudioBuffer, onset: number) {
  const hop = 0.25, span = Math.round(12 / hop);
  const e = loudness(buf, hop), first = Math.ceil(onset / hop);
  if (e.length - first <= span) return onset;
  let sum = 0;
  for (let k = first; k < first + span; k++) sum += e[k];
  let best = first, bestSum = sum;
  for (let k = first + 1; k + span <= e.length; k++) {
    sum += e[k + span - 1] - e[k - 1];
    if (sum > bestSum * 1.02) { best = k; bestSum = sum; } // favour the earlier stretch on near ties
  }
  let start = best;
  for (let k = best; k >= Math.max(first, best - 6); k--) if (e[k] < e[start]) start = k;
  return start * hop;
}

export class Clip {
  private source: AudioBufferSourceNode | null = null;
  private startedAt = 0;
  private length = 0;
  private constructor(private buffer: AudioBuffer, readonly onset: number, readonly hook: number) {}

  static async load(song: Song, signal?: AbortSignal) {
    const bytes = await fetchPreview(song, signal);
    const buffer = await audio().ctx.decodeAudioData(bytes);
    const onset = findOnset(buffer);
    return new Clip(buffer, onset, findHook(buffer, onset));
  }

  get duration() { return this.buffer.duration; }

  // Plays `seconds` from the onset (or from `from`), with 5 ms ramps so short clips don't click.
  // Outside a click the browser may refuse to start audio; then nothing plays and the promise resolves.
  async play(seconds: number, from = this.onset): Promise<void> {
    this.stop();
    const { ctx, master } = audio();
    if (ctx.state !== 'running') await Promise.race([ctx.resume(), new Promise((r) => setTimeout(r, 400))]);
    if (ctx.state !== 'running') return;
    const len = Math.min(seconds, this.buffer.duration - from);
    const src = ctx.createBufferSource(), env = ctx.createGain();
    src.buffer = this.buffer;
    src.connect(env).connect(master);
    const t = ctx.currentTime + 0.02, ramp = Math.min(0.005, len / 4);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(1, t + ramp);
    env.gain.setValueAtTime(1, t + len - ramp);
    env.gain.linearRampToValueAtTime(0, t + len);
    src.start(t, from, len);
    this.source = src; this.startedAt = t; this.length = len;
    return new Promise((done) => { src.onended = () => { if (this.source === src) this.source = null; done(); }; });
  }

  // Seconds of the current clip already heard, or null when nothing is playing.
  elapsed() {
    if (!this.source || !ctx) return null;
    return Math.min(Math.max(ctx.currentTime - this.startedAt, 0), this.length);
  }

  stop() {
    const src = this.source;
    this.source = null;
    if (src) { try { src.stop(); } catch { /* already stopped */ } src.onended?.(new Event('ended')); }
  }
}

// Small cache so the next song can download while the current one is being revealed.
const cache = new Map<string, Promise<Clip>>();
export function loadClip(song: Song) {
  let p = cache.get(song.id);
  if (!p) {
    p = Clip.load(song);
    p.catch(() => cache.delete(song.id));
    cache.set(song.id, p);
    if (cache.size > 6) cache.delete(cache.keys().next().value!);
  }
  return p;
}

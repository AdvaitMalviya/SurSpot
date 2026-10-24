// The page backdrop picks up a blurred glow from the revealed song's cover; cleared for the next song.
// The cover's average colour (Apple serves the artwork at 1×1, and allows CORS) also tints the solid popovers,
// so they sit in the same colour as the glow instead of the default ink.
let seq = 0;
export function setAmbient(url: string | null) {
  const mine = ++seq;
  const root = document.documentElement;
  if (url) root.style.setProperty('--ambient', `url("${url.replace(/"/g, '%22')}")`);
  root.classList.toggle('has-ambient', !!url);
  root.classList.remove('has-tint');
  if (!url) return;
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    try {
      const c = document.createElement('canvas');
      c.width = c.height = 1;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0, 1, 1);
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
      if (mine !== seq) return; // the song moved on while this loaded
      root.style.setProperty('--tint', `rgb(${r} ${g} ${b})`);
      root.classList.add('has-tint');
    } catch { /* a tainted canvas keeps the default popover colour */ }
  };
  img.src = url.replace(/\/\d+x\d+bb\./, '/1x1bb.');
}

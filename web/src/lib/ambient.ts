// The page backdrop picks up a blurred glow from the revealed song's cover; cleared for the next song.
export function setAmbient(url: string | null) {
  const root = document.documentElement;
  if (url) root.style.setProperty('--ambient', `url("${url.replace(/"/g, '%22')}")`);
  root.classList.toggle('has-ambient', !!url);
}

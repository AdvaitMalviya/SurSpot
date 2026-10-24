# SurSpot

Name the Bollywood song from a split second of it. A guess-the-song game for Hindi film music, from the
1950s to now, playable in the browser with no backend.

## Play locally

Needs Node 22 or newer.

```
npm install
npm run dev
```

Then open http://127.0.0.1:5173. On Windows PowerShell with script execution disabled, use `npm.cmd` in
place of `npm`.

`npm run build` writes a static site to `dist/` that can be hosted anywhere (GitHub Pages, Cloudflare Pages).

## How the game works

- **Play**: endless songs from a pool you choose by era, mood, difficulty, and singer or composer.
- **Daily**: one song a day for everyone, changing at midnight India time, with a shareable result.
- **Quick pick**: ten songs, four choices each, fifteen seconds per answer.

Each round has six tries. Clips grow from 0.2 s to 15 s, and clues (era, music director, singers, film) unlock
from the third try. When the round ends, the song plays from its main line.

Audio comes from the 30-second iTunes previews, cut to exact lengths with the Web Audio API. Film notes on the
answer card come from Wikipedia's REST API. Both are free and need no key.

## The song catalog

| File | What it is |
|---|---|
| `data/seed/*.json` | The curated list: titles, Hindi-script titles, film, year, singers, composers, moods, and a popularity tier from 1 (everyone knows it) to 4 (deep cut). |
| `data/catalog.json` | The seed songs matched to their original iTunes recordings. |
| `data/expanded.json` | Extra songs from the soundtracks of the most-read Hindi films on Wikipedia. |
| `data/overrides.json` | Optional manual fixes: pin a song to an iTunes track, or drop it. |

Rebuild them with:

```
node data/seed/check.mjs      # validate the seed files
node scripts/resolve.mjs      # seed -> data/catalog.json and data/resolve-report.md
node scripts/expand.mjs       # Wikipedia + iTunes -> data/expanded.json and data/expand-report.md
node --env-file=.env scripts/popularity.mjs   # Last.fm listeners -> data/popularity.json
node scripts/expand.mjs --offline             # re-tier the added songs from data/popularity.json
```

The popularity step needs a free Last.fm API key (https://www.last.fm/api/account/create) in a `.env` file
at the project root, which git ignores:

```
LASTFM_API_KEY=your-key-here
```

Both scripts cache every API response under `data/.cache/`, so an interrupted run picks up where it stopped,
and `--offline` rebuilds from the cache alone. iTunes allows roughly 20 to 50 requests a minute, so a full run
from an empty cache takes about an hour.

To fix a wrong match, look the song up in `data/resolve-report.md` and add it to `data/overrides.json`:

```json
{
  "tum-hi-ho-aashiqui-2": { "trackId": 1073359419 },
  "some-song-some-film": { "skip": true }
}
```

# सुरSpot

Name the song from a split second of it. SurSpot is a guess-the-song game for Hindi film music and Punjabi
music, from the 1950s to now. It runs in the browser: no app, no sign-up.

**Play it at [surspot.pages.dev](https://surspot.pages.dev)**

![Guessing a song: the record on the left, suggestions with album covers on the right](screenshots/play-search-dark.jpg)

## How to play

Tap the record to hear the first 0.2 seconds of a song, then type the song or its film. Each round has six
tries, and every miss or skip plays a longer clip:

| Try | 1 | 2 | 3 | 4 | 5 | 6 |
|---|---|---|---|---|---|---|
| Clip | 0.2 s | 0.5 s | 1 s | 3 s | 7 s | 15 s |
| Points | 100 | 80 | 60 | 40 | 25 | 10 |

From the third try, clues open up: the era, the music director, the singers and the film. Naming the right
film with the wrong song is marked as the right film, so you know you're close, but it still uses a try. When the round ends, the answer card shows the song, its
cover, who sang and composed it, a note on the film from Wikipedia, and links to the full song on Apple Music,
Spotify and YouTube.

There are four ways to play:

- **Play**: endless songs from a pool you choose by era, mood, how well known the songs are, language
  (Hindi, Punjabi or both), and singer or composer.
- **Daily**: one song a day, the same for everyone, changing at midnight India time. Share your result as a
  row of coloured squares.
- **Quick pick**: ten songs, four choices each, fifteen seconds per answer.
- **With friends**: make a room and send the link. Everyone plays on their own phone or laptop, hears the same
  songs, and watches the scoreboard move. Up to twelve players, no accounts.

## Screens

| | |
|---|---|
| <img src="screenshots/play-light.jpg" alt="A new round in the light theme"> | <img src="screenshots/play-search-light.jpg" alt="Search suggestions with album covers in the light theme"> |
| <img src="screenshots/daily-light.jpg" alt="The answer card for a solved daily song"> | <img src="screenshots/daily-dark.jpg" alt="The same answer card in the dark theme"> |
| <img src="screenshots/friends-light.jpg" alt="Making or joining a room to play with friends"> | <img src="screenshots/phone-dark.jpg" alt="A round on a phone in the dark theme" width="49%"> <img src="screenshots/phone-light.jpg" alt="A song loading on a phone in the light theme" width="49%"> |

The game follows your system's light or dark setting. After each round, the backdrop and menus take on the
colours of the song's cover.

## The songs

About 10,500 songs: 9,400 Hindi, mostly from films, and 1,150 Punjabi. Every song has a difficulty from Easy
(everyone knows it) to Expert (a deep cut), and a pool can mix any of them. About 1,200 songs were picked and
tagged by hand with moods and difficulty. The rest come from the soundtracks of the most-read Hindi films on
Wikipedia and the best-known tracks of Punjabi artists on Last.fm. Their difficulty is set by how many
Last.fm listeners they have, compared decade by decade with the hand-tagged songs, since a hit from 1965 has
far fewer listeners than one from 2015.

The audio is the 30-second preview that Apple's iTunes API provides for each track, played straight from Apple
and cut to exact lengths in the browser. SurSpot doesn't store or host any audio. The songs belong to their
rights holders.

## Run it locally

Needs Node 22 or newer.

```
npm install
npm run dev
```

Then open http://127.0.0.1:5173. This also starts the room server for With friends on port 8787. On Windows
PowerShell with script execution disabled, use `npm.cmd` in place of `npm`.

The game itself is a static site (Vite and React). It loads the song lists as JSON, plays previews through the
Web Audio API, and reads film notes from Wikipedia's REST API, none of which needs a key. The only server is
the one for rooms: a Cloudflare Worker with one Durable Object per room, in `server/`.

## Host it

`npm run build` writes the site to `dist/`, which any static host can serve. On Cloudflare Pages, use build
command `npm run build`, output directory `dist`, and set `NODE_VERSION` to 22.

Builds connect to the deployed room server unless `VITE_ROOMS_URL` points elsewhere. To run your own:

```
node scripts/wrangler.mjs login
npm run rooms:deploy
```

then build with `VITE_ROOMS_URL=wss://<your worker>.workers.dev`.

## Rebuild the song catalog

| File | What it is |
|---|---|
| `data/seed/*.json` | The hand-picked list: titles, Hindi-script titles, film, year, singers, composers, moods and difficulty (tier 1 to 4). |
| `data/catalog.json` | The hand-picked songs matched to their original iTunes recordings. |
| `data/expanded.json` | Songs from the soundtracks of the most-read Hindi films on Wikipedia. |
| `data/punjabi.json` | Punjabi songs from Last.fm's best-known tracks, matched on iTunes. |
| `data/popularity.json` | Last.fm listeners and the difficulty they suggest, per song. |
| `data/overrides.json` | Optional manual fixes: pin a song to an iTunes track, or drop it. |

The Last.fm steps need a free API key (https://www.last.fm/api/account/create) in a `.env` file at the project
root, which git ignores:

```
LASTFM_API_KEY=your-key-here
```

From scratch:

```
node data/seed/check.mjs                         # validate the seed files
node scripts/resolve.mjs                         # seed -> data/catalog.json
node scripts/expand.mjs                          # Wikipedia + iTunes -> data/expanded.json
node --env-file=.env scripts/popularity.mjs      # Last.fm listeners -> data/popularity.json
node scripts/expand.mjs --offline                # re-tier the added songs from data/popularity.json
node --env-file=.env scripts/punjabi.mjs         # Last.fm + iTunes -> data/punjabi.json
```

To add songs without touching the ones already there, use `--add`. It fetches only what's new and gives the
new songs a difficulty the same way:

```
node --env-file=.env scripts/expand.mjs --add --years 2000-2026 --quota 40   # 40 films a year
node --env-file=.env scripts/punjabi.mjs --add --per-artist 40               # 40 tracks an artist
```

Every script writes a report next to its output (`data/*-report.md`) and caches each API response under
`data/.cache/`, so an interrupted run picks up where it stopped and `--offline` rebuilds from the cache alone.
iTunes allows roughly 20 to 50 requests a minute, so a full run from an empty cache takes about an hour.

To fix a wrong match, find the song in `data/resolve-report.md` and add it to `data/overrides.json`:

```json
{
  "tum-hi-ho-aashiqui-2": { "trackId": 1073359419 },
  "some-song-some-film": { "skip": true }
}
```

// The room server for local play (npm run dev starts it): the code in server/src, run by Miniflare on
// ws://127.0.0.1:8787 with rooms kept in memory. `wrangler dev` saves every room change to .wrangler/state, and on
// a hard disk each save can hold a room up for most of a second. Rebuilds when the server code changes.
// The play counts need SQLite, which in-memory Durable Objects don't have, so the same code runs a second time as
// a worker of its own that keeps them on disk, in Miniflare's folder in .wrangler/tmp; the first one reaches them
// there. That folder is new on every start, so the counts begin at nothing each time.
import { context } from 'esbuild';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { ROOT, WRANGLER_ENV } from './wrangler-env.mjs';

Object.assign(process.env, WRANGLER_ENV); // Miniflare's temporary files go in .wrangler/tmp
const config = readFileSync(join(ROOT, 'server/wrangler.jsonc'), 'utf8');
const compatibilityDate = config.match(/"compatibility_date":\s*"([^"]+)"/)[1];
const outfile = join(ROOT, '.wrangler', 'rooms-dev', 'index.js');
const worker = { modules: true, scriptPath: outfile, compatibilityDate };
// Miniflare 5 takes a new options shape; this one is the classic one, converted the way Wrangler does it.
const options = () => convertV4MiniflareOptions({
  host: '127.0.0.1',
  port: 8787,
  workers: [{
    ...worker,
    name: 'surspot-rooms',
    durableObjects: {
      ROOMS: { className: 'Room', useSQLite: true },
      STATS: { className: 'Stats', scriptName: 'surspot-stats', useSQLite: true },
    },
    bindings: { STATS_KEY: 'dev' }, // the stats page's password locally (web/stats.html)
    unsafeEphemeralDurableObjects: true,
  }, {
    ...worker,
    name: 'surspot-stats',
    durableObjects: { STATS: { className: 'Stats', useSQLite: true } },
  }],
});

let mf = null;
const build = await context({
  entryPoints: [join(ROOT, 'server/src/index.ts')],
  outfile,
  bundle: true,
  format: 'esm',
  target: 'es2022',
  external: ['cloudflare:workers'],
  logLevel: 'warning',
  plugins: [{
    name: 'reload',
    setup: (b) => b.onEnd(async (result) => {
      if (!mf || result.errors.length) return;
      await mf.setOptions(options());
      console.log('rooms: reloaded');
    }),
  }],
});
await build.rebuild();
mf = new Miniflare(options());
await mf.ready;
console.log(`rooms: ${String(await mf.ready).replace('http', 'ws')} (in memory)`);
await build.watch();

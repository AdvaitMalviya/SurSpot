// npm run dev: the game (Vite, http://127.0.0.1:5173) and the room server for Play with friends
// (scripts/rooms-dev.mjs, ws://127.0.0.1:8787) side by side. Ctrl+C stops both.
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { ROOT, WRANGLER_ENV } from './wrangler-env.mjs';

const children = [
  ['game', join(ROOT, 'node_modules/vite/bin/vite.js'), ...process.argv.slice(2)],
  ['rooms', join(ROOT, 'scripts/rooms-dev.mjs')],
].map(([name, ...args]) => {
  const child = spawn(process.execPath, args, { cwd: ROOT, env: WRANGLER_ENV, stdio: 'inherit' });
  child.on('exit', (code) => {
    console.log(`\n${name} stopped${code ? ` (exit ${code})` : ''}`);
    for (const c of children) if (c !== child) c.kill();
    process.exitCode = code ?? 0;
  });
  return child;
});
process.on('SIGINT', () => children.forEach((c) => c.kill()));

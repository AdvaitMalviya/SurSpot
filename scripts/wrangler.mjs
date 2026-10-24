// Runs Wrangler on the room server with the project's environment: node scripts/wrangler.mjs <command> [args]
// for example `deploy`, `types server/worker-configuration.d.ts` or `login`.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { ROOT, WRANGLER_ENV } from './wrangler-env.mjs';

const [command = 'dev', ...rest] = process.argv.slice(2);
const { status } = spawnSync(process.execPath, [join(ROOT, 'node_modules/wrangler/bin/wrangler.js'), command, '--config', 'server/wrangler.jsonc', ...rest], {
  cwd: ROOT, env: WRANGLER_ENV, stdio: 'inherit',
});
process.exit(status ?? 1);

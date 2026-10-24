// Environment for running Wrangler and Miniflare from this project: no usage metrics, and their logs, settings and
// temporary files in .wrangler/ instead of the home folder. Used by scripts/dev.mjs and scripts/wrangler.mjs.
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const WRANGLER_ENV = {
  ...process.env,
  WRANGLER_SEND_METRICS: 'false',
  WRANGLER_LOG_PATH: join(ROOT, '.wrangler', 'logs'),
  XDG_CONFIG_HOME: join(ROOT, '.wrangler', 'config'),
  TMP: join(ROOT, '.wrangler', 'tmp'),
  TEMP: join(ROOT, '.wrangler', 'tmp'),
};
mkdirSync(WRANGLER_ENV.TMP, { recursive: true });

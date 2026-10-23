// Validates the seed catalog: node data/seed/check.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const TAGS = new Set(['romantic', 'sad', 'party', 'dance', 'sufi', 'qawwali', 'ghazal', 'devotional', 'patriotic',
  'wedding', 'item', 'rap', 'indipop', 'classical', 'rain', 'friendship', 'festive', 'non-film']);
const FIELDS = ['title', 'alt_titles', 'movie', 'year', 'singers', 'composers', 'tags', 'tier'];
const isStr = v => typeof v === 'string' && v.trim().length > 0;
const isStrArr = (v, min) => Array.isArray(v) && v.length >= min && v.every(isStr);

const errors = [];
const seen = new Map();
const tierCount = { 1: 0, 2: 0, 3: 0, 4: 0 };
const tagCount = {};
const singerCount = {};
const composerCount = {};
let total = 0;

const files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort();
for (const file of files) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
  } catch (e) {
    errors.push(`${file}: invalid JSON (${e.message})`);
    continue;
  }
  if (!Array.isArray(data)) { errors.push(`${file}: top level is not an array`); continue; }
  const m = file.match(/(\d{3})0s/);
  const lo = m ? Number(m[1]) * 10 : null;
  data.forEach((s, i) => {
    const where = `${file}[${i}] "${s && s.title}"`;
    if (!s || typeof s !== 'object' || Array.isArray(s)) { errors.push(`${where}: not an object`); return; }
    const keys = Object.keys(s);
    const missing = FIELDS.filter(k => !keys.includes(k));
    const extra = keys.filter(k => !FIELDS.includes(k));
    if (missing.length) errors.push(`${where}: missing ${missing.join(', ')}`);
    if (extra.length) errors.push(`${where}: unexpected ${extra.join(', ')}`);
    if (!isStr(s.title)) errors.push(`${where}: title must be a non-empty string`);
    if (!isStrArr(s.alt_titles, 0)) errors.push(`${where}: alt_titles must be an array of strings`);
    if (!isStr(s.movie)) errors.push(`${where}: movie must be a non-empty string`);
    if (!Number.isInteger(s.year)) errors.push(`${where}: year must be an integer`);
    else if (lo !== null && (s.year < lo || s.year > lo + 9)) errors.push(`${where}: year ${s.year} outside ${lo}s`);
    if (!isStrArr(s.singers, 1)) errors.push(`${where}: singers must be a non-empty array of strings`);
    if (!isStrArr(s.composers, 1)) errors.push(`${where}: composers must be a non-empty array of strings`);
    if (!isStrArr(s.tags, 1) || s.tags.length > 3) errors.push(`${where}: tags must be 1-3 strings`);
    else for (const t of s.tags) if (!TAGS.has(t)) errors.push(`${where}: unknown tag "${t}"`);
    if (![1, 2, 3, 4].includes(s.tier)) errors.push(`${where}: tier must be 1-4`);
    if (isStr(s.title) && isStr(s.movie)) {
      const key = `${s.title.toLowerCase()}||${s.movie.toLowerCase()}`;
      if (seen.has(key)) errors.push(`${where}: duplicate of ${seen.get(key)}`);
      else seen.set(key, `${file}[${i}]`);
    }
    total++;
    if (tierCount[s.tier] !== undefined) tierCount[s.tier]++;
    for (const t of s.tags || []) tagCount[t] = (tagCount[t] || 0) + 1;
    for (const p of new Set(s.singers || [])) singerCount[p] = (singerCount[p] || 0) + 1;
    for (const p of new Set(s.composers || [])) composerCount[p] = (composerCount[p] || 0) + 1;
  });
  console.log(`${file}: ${data.length} songs`);
}

const top = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n)
  .map(([k, v]) => `  ${String(v).padStart(4)}  ${k}`).join('\n');
console.log(`\nTotal: ${total}`);
console.log('Tiers: ' + Object.entries(tierCount).map(([k, v]) => `${k}: ${v} (${total ? Math.round(100 * v / total) : 0}%)`).join('  '));
console.log('Tags: ' + Object.entries(tagCount).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}: ${v}`).join(', '));
console.log('\nTop 30 singers:\n' + top(singerCount, 30));
console.log('\nTop 30 composers:\n' + top(composerCount, 30));

if (errors.length) {
  console.log(`\n${errors.length} problem(s):`);
  for (const e of errors) console.log('  - ' + e);
  process.exit(1);
}
console.log('\nAll checks passed.');

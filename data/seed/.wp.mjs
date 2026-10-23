// Temporary research helper (deleted when the catalog is done).
// node .wp.mjs "Page title" ...        -> track listings (title | singers | music)
// node .wp.mjs "?search terms"         -> top Wikipedia search hits
// node .wp.mjs "Page title::regex"     -> table rows / lines on the page matching regex
const UA = 'SongPotCatalog/1.0 (personal research script)';

async function api(params) {
  const url = 'https://en.wikipedia.org/w/api.php?' +
    new URLSearchParams({ format: 'json', formatversion: '2', ...params });
  await new Promise(res => setTimeout(res, 250));
  for (let i = 0; i < 6; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, 'Api-User-Agent': UA } });
      if (r.ok) return await r.json();
    } catch (e) { /* retry */ }
    await new Promise(res => setTimeout(res, 2000 * (i + 1)));
  }
  throw new Error('fetch failed ' + url);
}

function clean(s) {
  return s
    .replace(/<ref[^>]*\/>/g, '')
    .replace(/<ref[\s\S]*?<\/ref>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\{\{(?:efn|sfn|r|refn)[^{}]*\}\}/gi, '')
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/\{\{(?:nowrap|nobr|small|nbsp)\|?([^{}]*)\}\}/gi, '$1')
    .replace(/\{\{(?:ubl|unbulleted list|hlist|plainlist|flatlist)\|([^{}]*)\}\}/gi, (m, a) => a.split('|').join(', '))
    .replace(/'''?/g, '')
    .replace(/<br\s*\/?>/gi, ', ')
    .replace(/<\/?(?:small|span|div|sup)[^>]*>/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function blocks(text, startRe) {
  const out = [];
  let m;
  const re = new RegExp(startRe, 'gi');
  while ((m = re.exec(text))) {
    let depth = 0, i = m.index;
    for (; i < text.length - 1; i++) {
      if (text[i] === '{' && text[i + 1] === '{') { depth++; i++; }
      else if (text[i] === '}' && text[i + 1] === '}') { depth--; i++; if (depth === 0) break; }
    }
    out.push(text.slice(m.index, i + 1));
    re.lastIndex = i + 1;
  }
  return out;
}

function splitParams(block) {
  const inner = block.slice(2, -2);
  const parts = [];
  let depth = 0, cur = '';
  for (let i = 0; i < inner.length; i++) {
    const two = inner.slice(i, i + 2);
    if (two === '{{' || two === '[[') { depth++; cur += two; i++; continue; }
    if (two === '}}' || two === ']]') { depth--; cur += two; i++; continue; }
    if (inner[i] === '|' && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += inner[i];
  }
  parts.push(cur);
  const params = {};
  for (const p of parts.slice(1)) {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).trim().toLowerCase()] = p.slice(eq + 1).trim();
  }
  return params;
}

async function getPages(titles) {
  const res = await api({ action: 'query', prop: 'revisions', rvprop: 'content', rvslots: 'main', redirects: '1', titles: titles.join('|') });
  const pages = {};
  for (const p of res.query.pages) {
    pages[p.title] = (p.missing || !p.revisions) ? null : p.revisions[0].slots.main.content;
  }
  const map = {};
  for (const t of titles) map[t] = t;
  for (const n of res.query.normalized || []) for (const t of titles) if (map[t] === n.from) map[t] = n.to;
  for (const r of res.query.redirects || []) for (const t of titles) if (map[t] === r.from) map[t] = r.to;
  return titles.map(t => [t, map[t], pages[map[t]]]);
}

function trackListings(text) {
  const lines = [];
  for (const b of blocks(text, '\\{\\{\\s*track[ _]?list(?:ing)?\\b')) {
    const p = splitParams(b);
    lines.push(`  == ${clean(p.headline || '')} [extra=${clean(p.extra_column || '')}]`);
    for (let n = 1; n < 60; n++) {
      if (!p['title' + n]) continue;
      const bits = [clean(p['title' + n])];
      if (p['note' + n]) bits[0] += ` (${clean(p['note' + n])})`;
      bits.push(clean(p['extra' + n] || ''));
      bits.push('music: ' + clean(p['music' + n] || ''));
      lines.push(`  ${n}. ${bits.join(' | ')}`);
    }
  }
  return lines;
}

function tableRows(text, re) {
  const rows = text.split(/\n\|-/);
  const hits = [];
  for (const r of rows) if (!/Infobox|Short description/.test(r) && re.test(r)) hits.push('  ' + clean(r.replace(/\n[|!]/g, ' ‖ ')).slice(0, 400));
  return hits;
}

const args = process.argv.slice(2);
const plain = [];
for (const a of args) {
  if (a.startsWith('?')) {
    const res = await api({ action: 'query', list: 'search', srsearch: a.slice(1), srlimit: '6' });
    console.log(`# search "${a.slice(1)}": ` + res.query.search.map(s => s.title).join(' ; '));
  } else if (a.includes('::')) {
    const [t, rx] = a.split('::');
    const [[, real, text]] = await getPages([t]);
    console.log(`# ${t} -> ${real}${text ? '' : ' (MISSING)'}`);
    if (text) console.log(tableRows(text, new RegExp(rx, 'i')).join('\n') || '  (no match)');
  } else plain.push(a);
}
const filt = {};
for (let i = 0; i < plain.length; i++) {
  const k = plain[i].indexOf('##');
  if (k >= 0) { const t = plain[i].slice(0, k); filt[t] = plain[i].slice(k + 2); plain[i] = t; }
}
for (let i = 0; i < plain.length; i += 40) {
  for (const [t, real, text] of await getPages(plain.slice(i, i + 40))) {
    if (!text) { console.log(`# ${t} (MISSING)`); continue; }
    let tl = trackListings(text);
    if (!tl.length) {
      const mm = text.match(/\{\{\s*(?:Main|Further|See also)\s*\|\s*([^|}]*soundtrack[^|}]*)/i);
      if (mm) {
        const [[, real2, text2]] = await getPages([mm[1].trim()]);
        if (text2) { tl = trackListings(text2); if (tl.length) tl.unshift('  (from ' + real2 + ')'); }
      }
    }
    if (!tl.length) {
      const fr0 = new RegExp(filt[t] || 'singer|vocal|music|\\d:\\d\\d', 'i');
      const rows = tableRows(text, fr0).slice(0, 25);
      if (rows.length) tl = ['  (table rows)', ...rows];
    }
    if (filt[t] && !tl[0]?.startsWith('  (table')) { const fr = new RegExp(filt[t], 'i'); tl = tl.filter(l => l.startsWith('  ==') ? false : l.startsWith('  (from') || fr.test(l.split('|')[0])); if (!tl.length) tl = ['  (no rows matched filter; ' + trackListings(text).length + ' rows total)']; }
    const yr = (text.match(/released\s*=\s*[^\n]*?((?:19|20)\d\d)/i) || [])[1] || '?';
    console.log(`# ${t}${real !== t ? ' -> ' + real : ''} [released ${yr}]`);
    if (tl.length) console.log(tl.join('\n'));
    else {
      const sec = text.match(/==\s*(?:Soundtrack|Music|Track ?listing)[^=]*==([\s\S]{0,2500})/i);
      console.log('  (no track listing) ' + (sec ? clean(sec[1]).slice(0, 1200) : ''));
    }
  }
}

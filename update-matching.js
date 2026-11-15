// Looks for a new server-matching post on the purple lounge and rewrites matching.json when one is found.
// It only touches what lounge.plaync.com/robots.txt allows: sitemap.xml and /feed/<id> pages, one request per second.
// Usage:  node tools/update-matching.js            (scan new posts listed in the sitemap)
//         FEED_ID=84791 node tools/update-matching.js   (read one specific post)
const fs = require('fs');
const path = require('path');
const { parse, isMatchingTitle, pageTitle } = require('./parse-matching');

const BASE = 'https://lounge.plaync.com';
const UA = 'aion2bosscheck-matching-bot (+https://github.com/pinlog/aion2bosscheck)';
const MATCH_FILE = path.join(__dirname, '..', 'matching.json');
const STATE_FILE = path.join(__dirname, 'state.json');
const MAX_FETCH = 150;   // pages per run
const DELAY_MS = 1100;   // robots.txt asks for a 1 second crawl delay
const RECENT_DAYS = 3;   // only posts the sitemap lists as touched in the last days

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; } };

async function get(fetchFn, url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20000);
  try {
    const res = await fetchFn(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'ko-KR' }, signal: ctl.signal });
    if (!res.ok) throw new Error(url + ' → HTTP ' + res.status);
    return await res.text();
  } finally { clearTimeout(timer); }
}

// Korean feed pages only: <loc>…/feed/123?country=KR&amp;locale=ko-KR</loc> with an optional <lastmod>
function sitemapEntries(xml) {
  const out = [];
  const re = /<url>\s*<loc>([^<]*)<\/loc>(?:\s*<lastmod>([^<]*)<\/lastmod>)?/g;
  let m;
  while ((m = re.exec(xml))) {
    const loc = m[1].replace(/&amp;/g, '&');
    const id = /\/feed\/(\d+)/.exec(loc);
    if (!id || !/country=KR/.test(loc)) continue;
    out.push({ id: +id[1], lastmod: m[2] ? Date.parse(m[2]) : NaN });
  }
  return out;
}

async function run(opt = {}) {
  const { fetchFn = fetch, now = Date.now(), pause = sleep, feedId = process.env.FEED_ID, log = console.log, matchFile = MATCH_FILE, stateFile = STATE_FILE } = opt;
  const state = readJson(stateFile, { lastScannedId: 0 });
  const current = readJson(matchFile, null);
  let ids;
  if (feedId) {
    ids = [+feedId];
    log('지정한 글 번호만 확인합니다: ' + feedId);
  } else {
    const entries = sitemapEntries(await get(fetchFn, BASE + '/sitemap.xml'));
    const since = now - RECENT_DAYS * 86400000;
    ids = [...new Set(entries.filter(e => e.id > state.lastScannedId && (isNaN(e.lastmod) || e.lastmod >= since)).map(e => e.id))].sort((a, b) => a - b).slice(0, MAX_FETCH);
    log('사이트맵에서 새 글 후보 ' + ids.length + '개');
  }

  let best = null, lastDone = state.lastScannedId, failure = null;
  for (const id of ids) {
    await pause(DELAY_MS);
    let html;
    try { html = await get(fetchFn, BASE + '/feed/' + id); } catch (e) { log('건너뜀: ' + e.message); lastDone = id; continue; }
    const title = pageTitle(html);
    if (isMatchingTitle(title)) {
      const r = parse(html);
      if (!r.ok) { failure = '글 ' + id + ' (' + title + '): ' + r.error; log('읽기 실패: ' + failure); break; } // keep it for the next run
      best = Object.assign(r, { feed: id });
      log('매칭 글 확인: ' + id + ' ' + (r.chapter || title));
    }
    lastDone = id;
  }

  let changed = false;
  if (best) {
    const out = { chapter: best.chapter, feed: best.feed, title: best.title.replace(/^퍼플 라운지 - | - NC$/g, ''), servers: {} };
    best.rows.forEach(r => { out.servers[r.west] = best.servers[r.west]; });
    best.rows.forEach(r => { out.servers[r.east] = best.servers[r.east]; });
    const same = current && current.feed === out.feed && JSON.stringify(current.servers) === JSON.stringify(out.servers);
    if (!same) { fs.writeFileSync(matchFile, JSON.stringify(out, null, 2) + '\n'); changed = true; log('matching.json 갱신: ' + out.chapter); }
    else log('이미 같은 내용입니다.');
  } else if (!failure) log('새 매칭 글이 없습니다.');

  if (!feedId || lastDone > state.lastScannedId) fs.writeFileSync(stateFile, JSON.stringify({ lastScannedId: lastDone }, null, 2) + '\n');
  if (failure) throw new Error(failure);
  return { changed, scanned: ids.length };
}

module.exports = { run, sitemapEntries };
if (require.main === module) run().catch((e) => { console.error('실패: ' + e.message); process.exit(1); });

// Reads the "혼돈의 어비스" server matching out of a lounge post (HTML or plain copied text).
// The same file runs in Node (GitHub Action) and in the browser (converter.html).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MatchingParser = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const KNOWN = ['시엘', '네자칸', '바이젤', '트리니엘', '카이시넬', '유스티엘', '아리엘', '에레슈키갈', '프레기온', '히타니에', '나니아', '하달', '타하바타',
    '페르노스', '다미누', '카사카', '젠카카', '챈가룽', '이슈타르', '티아마트', '포에타', '이스라펠', '루드라', '아스펠', '네몬', '바바룽', '바카르마',
    '마르쿠탄', '루미엘', '이스할겐', '루터스', '무닌', '파프니르', '코치룽', '메스람타에다', '오다르', '브리트라', '울고른', '인드나흐', '지켈', '크로메데', '콰이링'];
  const KNOWN_SET = new Set(KNOWN);

  function toText(input) {
    return String(input)
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<\/(td|th|tr|p|div|li|table|h\d)>/gi, ' ')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;|&#160;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
      .replace(/[|*_`~]/g, ' ');
  }

  function pageTitle(html) {
    const m = String(html).match(/<title>([^<]*)<\/title>/i) || String(html).match(/property="og:title"\s+content="([^"]*)"/i);
    return m ? m[1].trim() : '';
  }

  const isMatchingTitle = (title) => /서버\s*매칭/.test(title) && /(AION2|아이온2)/i.test(title);

  // "챕터1 9차", "챕터1 두 번째 이야기 1차" ...
  function detectChapter(s) {
    const m = String(s).match(/챕터\s*(\d+)\s*([가-힣 ]*?이야기)?\s*(\d+)\s*차/);
    return m ? '챕터' + m[1] + (m[2] ? ' ' + m[2].trim() : '') + ' ' + m[3] + '차' : '';
  }

  // Newer posts: "A그룹 / B그룹 / C그룹" lists with a 서부|동부 table each and no matching-group numbers.
  // The numbers follow the known order: A = 1, 4, 7 …  B = 2, 5, 8 …  C = 3, 6, 9 …  from the top of each list.
  function readGroupLists(tokens) {
    const rows = [];
    let lists = 0;
    for (let i = 0; i < tokens.length - 1; i++) {
      const m = /^([ABC])그룹$/.exec(tokens[i]);
      if (!m || !tokens.slice(i + 1, i + 4).some(t => t.startsWith('서부'))) continue;
      lists++;
      let j = i + 1;
      while (j < tokens.length && !KNOWN_SET.has(tokens[j]) && !/^[ABC]그룹$/.test(tokens[j]) && !tokens[j].startsWith('천족')) j++;
      for (let r = 0; KNOWN_SET.has(tokens[j]) && KNOWN_SET.has(tokens[j + 1]); r++, j += 2) {
        rows.push({ mg: 'ABC'.indexOf(m[1]) + 1 + 3 * r, west: tokens[j], east: tokens[j + 1] });
      }
    }
    return { lists, rows };
  }

  // Older posts: one table "번호 | 서부 | 동부" with 21 numbered rows.
  function readNumberedTable(tokens) {
    let head = -1;
    for (let i = 0; i < tokens.length - 1; i++) {
      if (tokens[i].startsWith('서부') && tokens.slice(i + 1, i + 4).some(t => t.startsWith('동부'))) { head = i; break; }
    }
    if (head < 0) return null;
    const rows = [];
    for (let j = head + 1; j < tokens.length - 2 && rows.length < 21; j++) {
      if (tokens[j].startsWith('천족')) break; // the rift table starts here
      if (/^\d{1,2}$/.test(tokens[j]) && KNOWN_SET.has(tokens[j + 1]) && KNOWN_SET.has(tokens[j + 2])) {
        rows.push({ mg: +tokens[j], west: tokens[j + 1], east: tokens[j + 2] });
        j += 2;
      }
    }
    return rows;
  }

  function finish(raw, rows, format) {
    const nums = new Set(rows.map(r => r.mg));
    for (let n = 1; n <= 21; n++) if (!nums.has(n)) return { ok: false, error: '매칭 그룹 ' + n + '번을 찾지 못했습니다.' };
    const servers = {};
    for (const r of rows) {
      if (servers[r.west] || servers[r.east]) return { ok: false, error: '같은 서버가 두 번 나왔습니다: ' + (servers[r.west] ? r.west : r.east) };
      servers[r.west] = { mg: r.mg, region: '서부' };
      servers[r.east] = { mg: r.mg, region: '동부' };
    }
    const missing = KNOWN.filter(n => !servers[n]);
    if (missing.length) return { ok: false, error: '앱의 서버 목록에 있는데 표에 없는 서버: ' + missing.join(', ') };
    const title = pageTitle(raw);
    rows.sort((a, b) => a.mg - b.mg);
    return { ok: true, format, chapter: detectChapter(title) || detectChapter(toText(raw)), title, servers, rows };
  }

  function parse(input) {
    const raw = String(input || '');
    const tokens = toText(raw).split(/\s+/).filter(Boolean);

    const g = readGroupLists(tokens);
    if (g.lists) {
      if (g.lists !== 3 || g.rows.length !== 21) {
        return { ok: false, error: 'A·B·C 그룹 목록 ' + g.lists + '개, 서버 줄 ' + g.rows.length + '개를 읽었습니다 (그룹 3개, 7줄씩 21줄 필요). 표 형식이 바뀌었을 수 있습니다.' };
      }
      return finish(raw, g.rows, 'groups');
    }

    const rows = readNumberedTable(tokens);
    if (!rows) return { ok: false, error: "'서부 / 동부' 표 머리글을 찾지 못했습니다." };
    if (rows.length !== 21) return { ok: false, error: '표에서 "번호 서부서버 동부서버" 줄을 ' + rows.length + '개만 읽었습니다 (21개 필요). 표 형식이 바뀌었을 수 있습니다.' };
    return finish(raw, rows, 'table');
  }

  return { KNOWN, parse, pageTitle, isMatchingTitle, detectChapter };
});

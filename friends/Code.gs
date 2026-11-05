// Our Trip Board 저장소 (구글 시트 + Apps Script)
const SHEET_NAME = 'data';
const COLS = ['trips', 'items', 'members'];

function sheet_() {
  const ss = SpreadsheetApp.getActive();
  return ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
}
function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
function readAll_() {
  const s = sheet_(), n = s.getLastRow();
  const out = { trips: {}, items: {}, members: {} };
  if (n < 1) return out;
  s.getRange(1, 1, n, 3).getValues().forEach(function (r) {
    if (!out[r[0]] || !r[1]) return;
    try { out[r[0]][r[1]] = JSON.parse(r[2]); } catch (err) { /* 손으로 고친 줄이 깨져도 나머지는 보여요 */ }
  });
  return out;
}
function isO_(x) { return x && typeof x === 'object' && !Array.isArray(x); }
function merge_(a, b) {
  const o = {}; Object.keys(a).forEach(function (k) { o[k] = a[k]; });
  Object.keys(b).forEach(function (k) { o[k] = (isO_(b[k]) && isO_(o[k])) ? merge_(o[k], b[k]) : b[k]; });
  return o;
}
function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.action === 'place') return json_(placeInfo_(p.url, p.debug));
  if (p.action === 'nsearch') return json_(naverSearch_(p.q));
  return json_({ ok: true, data: readAll_() });
}

// 네이버 지역 검색 (공식 API). 키는 코드에 쓰지 말고
// Apps Script 왼쪽 ⚙ 프로젝트 설정 → 스크립트 속성에 NAVER_ID, NAVER_SECRET 으로 넣어 주세요.
function naverSearch_(q) {
  try {
    q = String(q || '').trim();
    if (!q) return { ok: false, error: 'empty' };
    const pr = PropertiesService.getScriptProperties();
    const id = pr.getProperty('NAVER_ID'), sec = pr.getProperty('NAVER_SECRET');
    if (!id || !sec) return { ok: false, error: 'no key' };
    const r = UrlFetchApp.fetch('https://openapi.naver.com/v1/search/local.json?display=5&query=' + encodeURIComponent(q), {
      muteHttpExceptions: true, headers: { 'X-Naver-Client-Id': id, 'X-Naver-Client-Secret': sec }
    });
    if (r.getResponseCode() !== 200) return { ok: false, error: 'naver ' + r.getResponseCode(), body: r.getContentText().slice(0, 200) };
    const items = (JSON.parse(r.getContentText()).items || []).map(function (x) {
      const mx = Number(x.mapx), my = Number(x.mapy);
      return {
        name: String(x.title || '').replace(/<[^>]+>/g, ''), cat: x.category || '',
        addr: x.address || '', road: x.roadAddress || '',
        x: mx > 1e6 ? mx / 1e7 : mx, y: my > 1e6 ? my / 1e7 : my
      };
    }).filter(function (x) { return x.x > 100 && x.x < 140 && x.y > 30 && x.y < 45; });
    return { ok: true, items: items };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// 네이버 지도 링크 → 장소 페이지에서 휴무 요일 찾기 (공식 API가 아니라 페이지를 읽는 방식이라 네이버가 바꾸면 안 될 수 있어요)
const UA_ = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
function placeInfo_(url, debug) {
  try {
    url = String(url || '');
    if (!/^https?:\/\/([\w-]+\.)*(naver\.me|naver\.com)\//i.test(url)) return { ok: false, error: 'not naver' };
    let u = url, id = null;
    for (let i = 0; i < 6 && !id; i++) {
      const m = u.match(/place\/(\d+)/) || u.match(/[?&](?:id|pinId)=(\d+)/);
      if (m) { id = m[1]; break; }
      const r = UrlFetchApp.fetch(u, { followRedirects: false, muteHttpExceptions: true, headers: { 'User-Agent': UA_ } });
      const h = r.getHeaders(), loc = h['Location'] || h['location'];
      if (!loc) { const mm = r.getContentText().match(/place\/(\d+)/); if (mm) id = mm[1]; break; }
      u = loc;
    }
    if (!id) return { ok: false, error: 'no place id', url: u };
    const tries = [
      'https://m.place.naver.com/place/' + id + '/home',
      'https://pcmap.place.naver.com/place/' + id + '/home',
      'https://m.place.naver.com/restaurant/' + id + '/home'
    ];
    let html = '', info = [];
    for (let i = 0; i < tries.length; i++) {
      const res = UrlFetchApp.fetch(tries[i], { muteHttpExceptions: true, headers: { 'User-Agent': UA_, 'Referer': 'https://m.place.naver.com/', 'Accept-Language': 'ko-KR,ko;q=0.9' } });
      const t = res.getContentText();
      info.push({ url: tries[i], code: res.getResponseCode(), len: t.length, hours: t.indexOf('businessHours') > -1, head: debug ? t.replace(/\s+/g, ' ').slice(0, 400) : undefined });
      if (t.length > html.length) html = t;
      if (t.indexOf('businessHours') > -1) { html = t; break; }
    }
    const r = closedFrom_(html);
    const out = { ok: true, id: id, closed: r.days };
    if (debug) { out.tries = info; out.snips = r.snips; }
    return out;
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
function closedFrom_(html) {
  const D = '일월화수목금토', EN = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'], days = [], snips = [];
  function add(c) { let i = D.indexOf(c); if (i < 0) i = EN.indexOf(String(c).toUpperCase()); if (i > -1 && days.indexOf(i) < 0) days.push(i); }
  // 요일별 영업시간 목록에서 '휴무'로 표시된 요일
  const re1 = /"day":"([^"]{1,3})"((?:(?!"day":)[\s\S]){0,400}?)휴무/g;
  let m;
  while ((m = re1.exec(html))) { add(m[1]); if (snips.length < 8) snips.push(m[0].slice(0, 120)); }
  // "매주 월요일 정기휴무" 같은 문장
  let k = html.indexOf('휴무');
  while (k > -1) {
    const w = html.slice(Math.max(0, k - 25), k + 25).split(/["<>]/).filter(function (x) { return x.indexOf('휴무') > -1; })[0] || '';
    const r2 = /([일월화수목금토])요일/g; let x;
    while ((x = r2.exec(w))) add(x[1]);
    if (snips.length < 16 && /요일/.test(w)) snips.push(w);
    k = html.indexOf('휴무', k + 2);
  }
  return { days: days.sort(), snips: snips };
}
function doPost(e) {
  const b = JSON.parse(e.postData.contents);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const s = sheet_();
    b.ops.forEach(function (op) {
      if (COLS.indexOf(op.col) < 0) return;
      const n = s.getLastRow();
      const keys = n ? s.getRange(1, 1, n, 3).getValues() : [];
      let row = 0, cur = {};
      for (let i = 0; i < keys.length; i++) {
        if (keys[i][0] === op.col && keys[i][1] === op.id) { row = i + 1; try { cur = JSON.parse(keys[i][2]); } catch (err) { cur = {}; } break; }
      }
      if (op.op === 'delete') { if (row) s.deleteRow(row); return; }
      const val = JSON.stringify(op.op === 'update' ? merge_(cur, op.data) : op.data);
      if (row) s.getRange(row, 3).setValue(val);
      else s.appendRow([op.col, op.id, val]);
    });
    return json_({ ok: true });
  } finally { lock.releaseLock(); }
}


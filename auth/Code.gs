// Our Trip Board 로그인 확인 서버
// 카카오 로그인 코드 → 카카오에서 사용자 확인 → Firebase 로그인 토큰을 만들어 돌려줘요.
// 스크립트 속성(⚙ 프로젝트 설정 → 스크립트 속성)에 넣어 주세요:
//   SA_JSON      = 서비스 계정 키 json 파일 내용 전체
//   KAKAO_SECRET = 카카오 REST API 키의 '카카오 로그인' 클라이언트 시크릿 코드
const KAKAO_REST = '8e508454604955727df211d5569dfa80';
const ALLOWED = ['https://our-trip-board.web.app/', 'https://our-trip-board.firebaseapp.com/'];

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.action === 'diag') return out_(diag_());
  try {
    if (ALLOWED.indexOf(p.ru) < 0) return out_({ ok: false, error: 'redirect' });
    if (!p.code) return out_({ ok: false, error: 'no code' });
    const t = UrlFetchApp.fetch('https://kauth.kakao.com/oauth/token', {
      method: 'post', muteHttpExceptions: true,
      payload: { grant_type: 'authorization_code', client_id: KAKAO_REST, redirect_uri: p.ru, code: p.code,
                 client_secret: PropertiesService.getScriptProperties().getProperty('KAKAO_SECRET') || '' }
    });
    const tj = JSON.parse(t.getContentText());
    if (!tj.access_token) return out_({ ok: false, error: 'kakao token: ' + (tj.error_description || tj.error || t.getResponseCode()) });
    const u = JSON.parse(UrlFetchApp.fetch('https://kapi.kakao.com/v2/user/me', {
      muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + tj.access_token }
    }).getContentText());
    if (!u.id) return out_({ ok: false, error: 'kakao user' });
    const prof = (u.kakao_account && u.kakao_account.profile) || {};
    const name = prof.nickname || (u.properties && u.properties.nickname) || '';
    const uid = 'k' + u.id;
    return out_({ ok: true, uid: uid, name: name, token: mint_(uid) });
  } catch (err) {
    return out_({ ok: false, error: String(err) });
  }
}

function mint_(uid) {
  const raw = PropertiesService.getScriptProperties().getProperty('SA_JSON');
  if (!raw) throw new Error('SA_JSON 스크립트 속성이 없어요');
  const sa = JSON.parse(raw);
  const now = Math.floor(Date.now() / 1000);
  const head = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: sa.client_email, sub: sa.client_email,
    aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
    iat: now, exp: now + 3600, uid: uid
  };
  const b64 = function (x) { return Utilities.base64EncodeWebSafe(x).replace(/=+$/, ''); };
  const input = b64(Utilities.newBlob(JSON.stringify(head)).getBytes()) + '.' + b64(Utilities.newBlob(JSON.stringify(claim)).getBytes());
  return input + '.' + b64(Utilities.computeRsaSha256Signature(input, sa.private_key));
}

function out_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}


/* ───────────── 알림 (Firebase Cloud Messaging) ─────────────
   앱이 POST로 {action, idt(Firebase 로그인 토큰), b(보드), kind, item}을 보내면
   같은 보드의 다른 멤버들 기기(members/{uid}.push 에 저장된 토큰)로 알림을 보내요.
   일정 리마인더는 remind()가 10분마다 돌아요. 처음 한 번 setupReminders()를 실행해 주세요. */
const PROJECT = 'our-trip-board';
const WEB_KEY = 'AIzaSyBDhfwIua7W4lsi4dSoW45fSAOrOo4FsSk';
const SITE = 'https://our-trip-board.web.app/';
const SEC_NAME = { food: '맛집', cafe: '카페·디저트', play: '전시·체험', spot: '가볼만한 곳', shop: '편집샵/쇼핑', must: '해야 할 일', transport: '교통', stay: '숙소' };

function doPost(e) {
  try {
    const p = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (p.action === 'notify') return out_(notify_(p));
    if (p.action === 'test') return out_(test_(p));
    return out_({ ok: false, error: 'action' });
  } catch (err) {
    return out_({ ok: false, error: String(err) });
  }
}

function gtoken_() {
  const c = CacheService.getScriptCache(), hit = c.get('gat');
  if (hit) return hit;
  const sa = JSON.parse(PropertiesService.getScriptProperties().getProperty('SA_JSON'));
  const now = Math.floor(Date.now() / 1000);
  const b64 = function (x) { return Utilities.base64EncodeWebSafe(x).replace(/=+$/, ''); };
  const input = b64(Utilities.newBlob(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).getBytes()) + '.' +
    b64(Utilities.newBlob(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })).getBytes());
  const jwt = input + '.' + b64(Utilities.computeRsaSha256Signature(input, sa.private_key));
  const r = JSON.parse(UrlFetchApp.fetch('https://oauth2.googleapis.com/token', { method: 'post', muteHttpExceptions: true,
    payload: { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt } }).getContentText());
  if (!r.access_token) throw new Error('google token: ' + (r.error_description || r.error));
  c.put('gat', r.access_token, 3000);
  return r.access_token;
}

const FS = 'https://firestore.googleapis.com/v1/projects/' + PROJECT + '/databases/(default)/documents/';
function fsReq_(method, path, body) {
  const o = { method: method, muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + gtoken_() }, contentType: 'application/json' };
  if (body) o.payload = JSON.stringify(body);
  const r = UrlFetchApp.fetch(FS + path, o), code = r.getResponseCode();
  if (code === 404) return null;
  const j = JSON.parse(r.getContentText() || '{}');
  if (code >= 300) throw new Error('firestore ' + code + ': ' + ((j.error && j.error.message) || ''));
  return j;
}
function fv_(v) {
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('mapValue' in v) { const o = {}, f = v.mapValue.fields || {}; Object.keys(f).forEach(function (k) { o[k] = fv_(f[k]); }); return o; }
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fv_);
  return null;
}
function doc_(d) { if (!d) return null; const o = fv_({ mapValue: { fields: d.fields || {} } }); o._id = d.name.split('/').pop(); return o; }
function fsGet_(path) { return doc_(fsReq_('get', path)); }
function fsList_(path) {
  let out = [], tok = '';
  do {
    const j = fsReq_('get', path + '?pageSize=300' + (tok ? '&pageToken=' + encodeURIComponent(tok) : ''));
    if (!j) break;
    (j.documents || []).forEach(function (d) { out.push(doc_(d)); });
    tok = j.nextPageToken || '';
  } while (tok);
  return out;
}

function verify_(idt) {
  if (!idt) throw new Error('login');
  const r = JSON.parse(UrlFetchApp.fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + WEB_KEY, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true, payload: JSON.stringify({ idToken: idt }) }).getContentText());
  const u = r.users && r.users[0];
  if (!u || !u.localId) throw new Error('login');
  return u.localId;
}

/* 보드 멤버들 토큰으로 알림 보내기. skipUid는 빼고. 없어진 토큰은 지워요. */
function sendBoard_(b, skipUid, title, body, onlyUid) {
  const ms = fsList_('boards/' + b + '/members');
  let sent = 0;
  ms.forEach(function (m) {
    if (m._id === skipUid) return;
    if (onlyUid && m._id !== onlyUid) return;
    const push = m.push || {}, bad = [];
    Object.keys(push).forEach(function (tok) {
      const r = UrlFetchApp.fetch('https://fcm.googleapis.com/v1/projects/' + PROJECT + '/messages:send', {
        method: 'post', contentType: 'application/json', muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + gtoken_() },
        payload: JSON.stringify({ message: { token: tok, webpush: {
          notification: { title: title, body: body, icon: SITE + 'icon-192.png', badge: SITE + 'icon-192.png' },
          fcm_options: { link: SITE + '?b=' + b } } } }) });
      const c = r.getResponseCode();
      if (c === 200) sent++;
      else if (c === 404 || /UNREGISTERED|registration-token-not-registered|INVALID_ARGUMENT/.test(r.getContentText())) bad.push(tok);
    });
    if (bad.length) {
      const keep = {};
      Object.keys(push).forEach(function (t) { if (bad.indexOf(t) < 0) keep[t] = { integerValue: String(push[t] || 0) }; });
      try { fsReq_('patch', 'boards/' + b + '/members/' + m._id + '?updateMask.fieldPaths=push', { fields: { push: { mapValue: { fields: keep } } } }); } catch (e) {}
    }
  });
  return sent;
}

function notify_(p) {
  const uid = verify_(p.idt), b = String(p.b || ''), id = String(p.item || ''), kind = p.kind;
  if (!/^[a-z0-9]{6,24}$/.test(b) || !/^[A-Za-z0-9]{6,40}$/.test(id)) return { ok: false, error: 'args' };
  const me = fsGet_('boards/' + b + '/members/' + uid);
  if (!me) return { ok: false, error: 'member' };
  const c = CacheService.getScriptCache(), key = 'n:' + uid + ':' + kind + ':' + id;
  if (c.get(key)) return { ok: true, sent: 0, dup: true };
  c.put(key, '1', 900);
  const it = fsGet_('boards/' + b + '/items/' + id);
  if (!it || it.section === 'passport') return { ok: true, sent: 0 };
  const tr = it.tripId ? fsGet_('boards/' + b + '/trips/' + it.tripId) : null;
  const who = me.name || '친구', name = String(it.title || '').slice(0, 40);
  let body = '';
  if (kind === 'add') body = who + '님이 ' + (SEC_NAME[it.section] || '보드') + '에 ‘' + name + '’을(를) 올렸어요';
  else if (kind === 'like') body = who + '님이 ‘' + name + '’에 좋아요를 눌렀어요';
  else if (kind === 'conf') body = who + '님이 ‘' + name + '’을(를) 일정에 넣었어요';
  else return { ok: false, error: 'kind' };
  return { ok: true, sent: sendBoard_(b, uid, (tr && tr.name) || 'Our Trip Board', body) };
}

function test_(p) {
  const uid = verify_(p.idt), b = String(p.b || '');
  if (!fsGet_('boards/' + b + '/members/' + uid)) return { ok: false, error: 'member' };
  return { ok: true, sent: sendBoard_(b, '', 'Our Trip Board', '알림이 켜졌어요. 이렇게 알려 드릴게요 ✈️', uid) };
}

/* ───────────── 일정 리마인더 ─────────────
   10분마다: 출발 전날 저녁 8시, 비행기 출발 3시간 전(기차·버스·배는 1시간 전). 시간은 한국 시간 기준. */
function setupReminders() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'remind') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('remind').timeBased().everyMinutes(10).create();
  return '리마인더를 켰어요 (10분마다 확인)';
}
function kst_(date, time) { return new Date(date + 'T' + (time || '00:00') + ':00+09:00').getTime(); }
function remind() {
  const now = Date.now(), props = PropertiesService.getScriptProperties(), done = props.getProperties(), WIN = 40 * 60000;
  const due = function (k, at) { return now >= at && now < at + WIN && !done[k]; };
  fsList_('boards').forEach(function (bd) {
    const b = bd._id;
    let trips, items;
    try { trips = fsList_('boards/' + b + '/trips'); items = fsList_('boards/' + b + '/items'); } catch (e) { return; }
    trips.forEach(function (t) {
      if (t.archived || !/^\d{4}-\d\d-\d\d$/.test(t.startDate || '')) return;
      const at = kst_(t.startDate, '20:00') - 86400000, k = 'rm:' + b + ':' + t._id + ':eve:' + t.startDate;
      if (due(k, at)) { sendBoard_(b, '', t.name || 'Our Trip Board', '내일 출발이에요! 짐이랑 여권, 교통편 시간 한 번 더 확인해요 ✈️'); props.setProperty(k, String(now)); }
    });
    items.forEach(function (it) {
      if (it.section !== 'transport' || it.mode === 'rent' || !/^\d{4}-\d\d-\d\d$/.test(it.date || '') || !/^\d\d:\d\d$/.test(it.time || '')) return;
      const t = trips.filter(function (x) { return x._id === it.tripId; })[0];
      if (t && t.archived) return;
      const before = it.mode === 'plane' ? 3 : 1, at = kst_(it.date, it.time) - before * 3600000;
      const k = 'rm:' + b + ':' + it._id + ':dep:' + it.date + it.time;
      if (!due(k, at)) return;
      const what = (it.name ? it.name + ' ' : '') + (it.from && it.to ? it.from + ' → ' + it.to : it.title || '');
      sendBoard_(b, '', (t && t.name) || 'Our Trip Board', it.time + ' ' + what.trim() + ' 출발 ' + before + '시간 전이에요');
      props.setProperty(k, String(now));
    });
  });
  /* 오래된 기록 정리 (10일 지난 것) */
  Object.keys(done).forEach(function (k) { if (k.indexOf('rm:') === 0 && now - Number(done[k]) > 10 * 86400000) props.deleteProperty(k); });
}

/* 확인용: …/exec?action=diag */
function diag_() {
  const o = { ok: true };
  try { o.sa = JSON.parse(PropertiesService.getScriptProperties().getProperty('SA_JSON')).client_email; } catch (e) { o.sa = 'none'; }
  try { gtoken_(); o.token = 'ok'; } catch (e) { o.token = String(e); }
  try { o.boards = fsList_('boards').length; } catch (e) { o.firestore = String(e); }
  try {
    const r = UrlFetchApp.fetch('https://fcm.googleapis.com/v1/projects/' + PROJECT + '/messages:send', { method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { Authorization: 'Bearer ' + gtoken_() }, payload: JSON.stringify({ validate_only: true, message: { topic: 'diag', notification: { title: 't', body: 'b' } } }) });
    o.fcm = r.getResponseCode() + ' ' + r.getContentText().slice(0, 160);
  } catch (e) { o.fcm = String(e); }
  o.triggers = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); });
  return o;
}

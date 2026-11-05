// Our Trip Board 로그인 확인 서버
// 카카오 로그인 코드 → 카카오에서 사용자 확인 → Firebase 로그인 토큰을 만들어 돌려줘요.
// 스크립트 속성(⚙ 프로젝트 설정 → 스크립트 속성)에 넣어 주세요:
//   SA_JSON      = 서비스 계정 키 json 파일 내용 전체
//   KAKAO_SECRET = 카카오 REST API 키의 '카카오 로그인' 클라이언트 시크릿 코드
const KAKAO_REST = '8e508454604955727df211c5569dfa80';
const ALLOWED = ['https://our-trip-board.web.app/', 'https://our-trip-board.firebaseapp.com/'];

function doGet(e) {
  const p = (e && e.parameter) || {};
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

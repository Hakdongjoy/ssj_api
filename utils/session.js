// 로그인 세션 관리
// 1) 미사용 만료 (sjj_session): 재발급할 때마다 last_used_at 갱신 → 사용할 때마다 14일씩 연장, 14일간 안 쓰면 재로그인
// 2) 리프레시 토큰 재사용 탐지 (sjj_refresh_token): 발급한 refresh_token의 해시를 기록하고,
//    이미 사용한 토큰이 다시 오면 탈취로 보고 그 계정의 모든 세션을 끊음
const crypto = require('crypto');
const { supabaseAdmin } = require('../supabase');

const SESSION_IDLE_DAYS = 14;

// access_token payload의 session_id (Supabase가 세션마다 발급, 재발급해도 유지됨)
function sessionIdOf(accessToken) {
  try {
    return JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64url').toString()).session_id || null;
  } catch {
    return null;
  }
}

const hashToken = token => crypto.createHash('sha256').update(token).digest('hex');

// 로그인/회원가입/재발급으로 새 세션 토큰을 내줄 때 호출: 사용 시각 갱신 + 새 refresh_token 해시 기록
async function recordIssued(session, user_id) {
  const session_id = sessionIdOf(session.access_token);
  if (!session_id) return;
  const now = new Date().toISOString();
  const [s, t] = await Promise.all([
    supabaseAdmin.from('sjj_session').upsert({ session_id, user_id, last_used_at: now }),
    supabaseAdmin.from('sjj_refresh_token').insert({ token_hash: hashToken(session.refresh_token), session_id, user_id }),
  ]);
  if (s.error) console.error('[session] 세션 기록 실패:', s.error.message);
  if (t.error) console.error('[session] 토큰 기록 실패:', t.error.message);
}

// 재발급 요청으로 들어온 refresh_token을 '사용됨'으로 표시.
// status: 이미 사용된 토큰 'reused' / 처음 쓰는 토큰 'ok' / 기록 없는 토큰(기능 도입 전 발급, SNS 로그인) 'unknown'
async function consumeRefreshToken(refresh_token) {
  const token_hash = hashToken(refresh_token);
  // used_at이 비어 있을 때만 갱신 → 동시에 같은 토큰이 두 번 와도 한쪽만 성공
  const { data: consumed } = await supabaseAdmin
    .from('sjj_refresh_token')
    .update({ used_at: new Date().toISOString() })
    .eq('token_hash', token_hash)
    .is('used_at', null)
    .select('user_id');
  if (consumed && consumed.length > 0) return { status: 'ok', user_id: consumed[0].user_id };

  const { data: existing } = await supabaseAdmin.from('sjj_refresh_token').select('user_id').eq('token_hash', token_hash).maybeSingle();
  return existing ? { status: 'reused', user_id: existing.user_id } : { status: 'unknown', user_id: null };
}

// 마지막 사용 후 14일이 지났으면 true. 기록이 없는 세션은 만료로 보지 않음
async function isIdleExpired(accessToken) {
  const session_id = sessionIdOf(accessToken);
  if (!session_id) return false;
  const { data } = await supabaseAdmin.from('sjj_session').select('last_used_at').eq('session_id', session_id).maybeSingle();
  if (!data) return false;
  return Date.now() - new Date(data.last_used_at).getTime() > SESSION_IDLE_DAYS * 24 * 60 * 60 * 1000;
}

async function removeSession(accessToken) {
  const session_id = sessionIdOf(accessToken);
  if (!session_id) return;
  await Promise.all([
    supabaseAdmin.from('sjj_session').delete().eq('session_id', session_id),
    supabaseAdmin.from('sjj_refresh_token').delete().eq('session_id', session_id),
  ]);
}

// 계정의 모든 세션 기록 삭제 (재사용 탐지 시)
async function removeAllSessions(user_id) {
  await Promise.all([
    supabaseAdmin.from('sjj_session').delete().eq('user_id', user_id),
    supabaseAdmin.from('sjj_refresh_token').delete().eq('user_id', user_id),
  ]);
}

module.exports = { recordIssued, consumeRefreshToken, isIdleExpired, removeSession, removeAllSessions, SESSION_IDLE_DAYS };

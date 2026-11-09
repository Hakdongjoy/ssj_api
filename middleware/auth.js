const { supabase, supabaseAdmin } = require('../supabase');

async function verifyToken(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ code: 'MISSING_TOKEN', error: '인증 토큰이 없습니다' });
  }

  const token = auth.replace('Bearer ', '');
  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    // 만료(재발급 가능)와 위조/형식 오류(재로그인 필요)를 구분해서 프론트가 TOKEN_EXPIRED일 때만 refresh 하도록
    if (isExpired(token)) {
      return res.status(401).json({ code: 'TOKEN_EXPIRED', error: '로그인 시간이 만료됐습니다' });
    }
    return res.status(401).json({ code: 'INVALID_TOKEN', error: '유효하지 않은 토큰입니다' });
  }

  req.user = user;
  next();
}

// JWT payload의 exp만 확인 (서명 검증은 위 getUser가 이미 실패시킨 상태라 에러 코드 구분 용도로만 사용)
function isExpired(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    return typeof payload.exp === 'number' && payload.exp * 1000 < Date.now();
  } catch {
    return false;
  }
}

// 토큰이 있으면 검증해서 req.user에 채우고, 없거나 유효하지 않아도 막지 않고 통과시킴
async function optionalAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    req.user = null;
    return next();
  }

  const token = auth.replace('Bearer ', '');
  const { data: { user }, error } = await supabase.auth.getUser(token);
  req.user = (!error && user) ? user : null;
  next();
}

// verifyToken 통과 후 req.user.id가 관리자인지 확인
async function verifyAdmin(req, res, next) {
  const { data: user, error } = await supabaseAdmin
    .from('sjj_user')
    .select('is_admin')
    .eq('id', req.user.id)
    .single();

  if (error || !user?.is_admin) {
    return res.status(403).json({ code: 'FORBIDDEN', error: '관리자만 접근할 수 있습니다' });
  }

  next();
}

module.exports = verifyToken;
module.exports.verifyToken = verifyToken;
module.exports.optionalAuth = optionalAuth;
module.exports.verifyAdmin = verifyAdmin;

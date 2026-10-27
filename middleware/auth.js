const { supabase, supabaseAdmin } = require('../supabase');

async function verifyToken(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ code: 'MISSING_TOKEN', error: '인증 토큰이 없습니다' });
  }

  const token = auth.replace('Bearer ', '');
  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    return res.status(401).json({ code: 'INVALID_TOKEN', error: '유효하지 않은 토큰입니다' });
  }

  req.user = user;
  next();
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

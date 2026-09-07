const { supabase } = require('../supabase');

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

module.exports = verifyToken;

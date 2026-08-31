const express = require('express');
const router = express.Router();
const { supabase, supabaseAdmin } = require('../supabase');

// POST /api/auth/signup
router.post('/signup', async (req, res) => {
  const { email, password, nick, gender, birth } = req.body;
  console.log('[signup] 요청:', { email, nick, gender, birth });

  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) {
    console.error('[signup] Step1 실패:', error.message);
    const msg = error.message;
    if (msg.includes('already registered') || msg.includes('already been registered')) {
      return res.status(400).json({ code: 'EMAIL_ALREADY_EXISTS', error: '이미 가입된 이메일입니다' });
    }
    if (msg.includes('invalid') && msg.includes('email')) {
      return res.status(400).json({ code: 'INVALID_EMAIL', error: '이메일 형식이 올바르지 않습니다' });
    }
    if (msg.includes('Password')) {
      return res.status(400).json({ code: 'WEAK_PASSWORD', error: '비밀번호는 6자 이상이어야 합니다' });
    }
    return res.status(400).json({ code: 'SIGNUP_FAILED', error: msg });
  }

  const user_id = data.user.id;
  const access_token = data.session?.access_token;
  console.log('[signup] Step1 성공 user_id:', user_id);

  const { error: profileError } = await supabaseAdmin
    .from('sjj_user')
    .update({ nick, gender, birth })
    .eq('id', user_id);

  if (profileError) {
    console.error('[signup] Step2 실패:', profileError.message);
    await supabaseAdmin.auth.admin.deleteUser(user_id);
    return res.status(500).json({ code: 'PROFILE_SAVE_FAILED', error: '프로필 저장 실패' });
  }

  console.log('[signup] 완료');
  res.json({ user_id, access_token });
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  console.log('[login] 요청:', { email });

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    console.error('[login] 실패:', error.message);
    const msg = error.message;
    if (msg.includes('Invalid login credentials')) {
      return res.status(400).json({ code: 'INVALID_CREDENTIALS', error: '이메일 또는 비밀번호가 틀렸습니다' });
    }
    if (msg.includes('Email not confirmed')) {
      return res.status(400).json({ code: 'EMAIL_NOT_CONFIRMED', error: '이메일 인증이 필요합니다' });
    }
    return res.status(400).json({ code: 'LOGIN_FAILED', error: msg });
  }

  console.log('[login] 완료 user_id:', data.user.id);
  res.json({
    user_id: data.user.id,
    access_token: data.session.access_token,
  });
});

module.exports = router;

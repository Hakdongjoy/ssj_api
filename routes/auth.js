const express = require('express');
const router = express.Router();
const { supabase, supabaseAdmin } = require('../supabase');
const generateNick = require('../utils/nick');

// GET /api/auth/check-id?id=myid123 — 아이디 중복 확인
router.get('/check-id', async (req, res) => {
  const { id } = req.query;
  if (!id) {
    return res.status(400).json({ code: 'MISSING_ID', error: '아이디를 입력해주세요' });
  }

  const email = id + '@saljjak.com';
  // GoTrue admin API의 email 쿼리 파라미터는 실제로 필터링을 안 해서 전체 목록에서 직접 비교
  const resp = await fetch(
    `${process.env.SUPABASE_URL}/auth/v1/admin/users?per_page=1000`,
    {
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
    }
  );
  const data = await resp.json();

  if (!resp.ok) {
    console.error('[check-id] 조회 실패:', data);
    return res.status(500).json({ code: 'CHECK_ID_FAILED', error: '아이디 확인 중 오류가 발생했습니다' });
  }

  const exists = Array.isArray(data.users) && data.users.some(u => u.email === email);
  res.json({ available: !exists });
});

// POST /api/auth/signup
router.post('/signup', async (req, res) => {
  const { id, password, gender, birth, phone } = req.body;
  console.log('[signup] 요청:', { id, gender, birth, phone });

  const missingFields = [];
  if (!id) missingFields.push('id');
  if (!password) missingFields.push('password');
  if (!gender) missingFields.push('gender');
  if (!birth) missingFields.push('birth');
  if (!phone) missingFields.push('phone');

  if (missingFields.length > 0) {
    return res.status(400).json({ code: 'MISSING_REQUIRED_FIELD', error: `필수값이 누락되었습니다: ${missingFields.join(', ')}`, fields: missingFields });
  }

  if (password.length < 8) {
    return res.status(400).json({ code: 'WEAK_PASSWORD', error: '비밀번호는 8자 이상이어야 합니다' });
  }

  const email = id + '@saljjak.com';

  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) {
    console.error('[signup] Step1 실패:', error.message);
    const msg = error.message;
    if (msg.includes('already registered') || msg.includes('already been registered')) {
      return res.status(400).json({ code: 'EMAIL_ALREADY_EXISTS', error: '이미 가입된 아이디입니다' });
    }
    if (msg.includes('invalid') && msg.includes('email')) {
      return res.status(400).json({ code: 'INVALID_EMAIL', error: '아이디 형식이 올바르지 않습니다' });
    }
    if (msg.includes('Password')) {
      return res.status(400).json({ code: 'WEAK_PASSWORD', error: '비밀번호는 8자 이상이어야 합니다' });
    }
    return res.status(400).json({ code: 'SIGNUP_FAILED', error: msg });
  }

  const user_id = data.user.id;
  const access_token = data.session?.access_token;
  console.log('[signup] Step1 성공 user_id:', user_id);

  const nick = await generateNick();

  const { error: profileError } = await supabaseAdmin
    .from('sjj_user')
    .update({ nick, gender, birth, phone })
    .eq('id', user_id);

  if (profileError) {
    console.error('[signup] Step2 실패:', profileError.message);
    await supabaseAdmin.auth.admin.deleteUser(user_id);
    return res.status(500).json({ code: 'PROFILE_SAVE_FAILED', error: '프로필 저장 실패' });
  }

  console.log('[signup] 완료, nick:', nick);
  res.json({ user_id, access_token, nick });
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { id, password } = req.body;
  const email = id + '@saljjak.com';
  console.log('[login] 요청:', { id, email });

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    console.error('[login] 실패:', error.message);
    const msg = error.message;
    if (msg.includes('Invalid login credentials')) {
      return res.status(400).json({ code: 'INVALID_CREDENTIALS', error: '아이디 또는 비밀번호가 틀렸습니다' });
    }
    if (msg.includes('Email not confirmed')) {
      return res.status(400).json({ code: 'EMAIL_NOT_CONFIRMED', error: '계정 인증이 필요합니다' });
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

const express = require('express');
const router = express.Router();
const { supabase, supabaseAdmin } = require('../supabase');
const generateNick = require('../utils/nick');

// POST /api/auth/signup
router.post('/signup', async (req, res) => {
  const { id, password, gender, birth, phone } = req.body;
  console.log('[signup] 요청:', { id, gender, birth, phone });

  if (!id) {
    return res.status(400).json({ code: 'MISSING_ID', error: '아이디를 입력해주세요' });
  }
  if (!password || password.length < 8) {
    return res.status(400).json({ code: 'WEAK_PASSWORD', error: '비밀번호는 8자 이상이어야 합니다' });
  }
  if (!gender) {
    return res.status(400).json({ code: 'MISSING_GENDER', error: '성별을 선택해주세요' });
  }
  if (!birth) {
    return res.status(400).json({ code: 'MISSING_BIRTH', error: '생년월일을 입력해주세요' });
  }
  if (!phone) {
    return res.status(400).json({ code: 'MISSING_PHONE', error: '휴대폰 번호를 입력해주세요' });
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

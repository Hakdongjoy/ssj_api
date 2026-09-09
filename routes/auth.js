const express = require('express');
const router = express.Router();
const { supabase, supabaseAdmin } = require('../supabase');
const generateNick = require('../utils/nick');

const MISSING_FIELD_MESSAGE = '필요한 정보를 모두 입력했는지 다시 확인해주세요';

// GET /api/auth/check-id?id=myid123 — 아이디 중복 확인
router.get('/check-id', async (req, res) => {
  const { id } = req.query;
  if (!id) {
    return res.status(400).json({ code: 'MISSING_ID', error: MISSING_FIELD_MESSAGE });
  }

  const { data, error } = await supabaseAdmin
    .from('sjj_user')
    .select('id')
    .ilike('login_id', id)
    .maybeSingle();

  if (error) {
    console.error('[check-id] 조회 실패:', error.message);
    return res.status(500).json({ code: 'CHECK_ID_FAILED', error: '아이디 확인 중 오류가 발생했습니다' });
  }

  res.json({ available: !data });
});

// POST /api/auth/phone/request — 휴대폰 인증번호 발송 (SMS 미연동, 서버 로그에만 출력)
router.post('/phone/request', async (req, res) => {
  const { phone, carrier, birth6, gender_code } = req.body;

  const missingFields = [];
  if (!phone) missingFields.push('phone');
  if (!carrier) missingFields.push('carrier');
  if (!birth6) missingFields.push('birth6');
  if (!gender_code) missingFields.push('gender_code');
  if (missingFields.length > 0) {
    return res.status(400).json({ code: 'MISSING_REQUIRED_FIELD', error: MISSING_FIELD_MESSAGE, fields: missingFields });
  }

  if (!/^\d{6}$/.test(birth6) || !['1', '2', '3', '4'].includes(gender_code)) {
    return res.status(400).json({ code: 'INVALID_BIRTH_FORMAT', error: '생년월일·성별 형식이 올바르지 않습니다' });
  }

  const COOLDOWN_MS = 5 * 1000; // 개발단계 임시 5초 (TODO: 카톡 인증 등 실제 연동 시 재조정)
  const EXPIRES_MS = 3 * 60 * 1000;

  const { data: existing } = await supabaseAdmin
    .from('sjj_phone_verify')
    .select('created_at')
    .eq('phone', phone)
    .maybeSingle();

  if (existing) {
    const elapsed = Date.now() - new Date(existing.created_at).getTime();
    if (elapsed < COOLDOWN_MS) {
      const retry_after = Math.ceil((COOLDOWN_MS - elapsed) / 1000);
      return res.status(429).json({ code: 'TOO_MANY_REQUESTS', error: `잠시 후 다시 시도해주세요 (${retry_after}초 후 가능)`, retry_after });
    }
  }

  const century = ['1', '2'].includes(gender_code) ? '19' : '20';
  const gender = ['1', '3'].includes(gender_code) ? 'male' : 'female';
  const birth = `${century}${birth6.slice(0, 2)}-${birth6.slice(2, 4)}-${birth6.slice(4, 6)}`;

  const code = String(Math.floor(100000 + Math.random() * 900000));
  const now = new Date().toISOString();
  const expires_at = new Date(Date.now() + EXPIRES_MS).toISOString();

  const { error } = await supabaseAdmin
    .from('sjj_phone_verify')
    .upsert({ phone, code, carrier, birth, gender, verified: false, expires_at, created_at: now }, { onConflict: 'phone' });

  if (error) {
    console.error('[phone/request] 저장 실패:', error.message);
    return res.status(500).json({ code: 'PHONE_VERIFY_SAVE_FAILED', error: '인증번호 발송에 실패했습니다' });
  }

  console.log(`[phone/request] ${phone} 인증번호: ${code}`); // TODO: 실제 SMS 업체 연동 시 이 부분에서 발송, 아래 code 응답도 제거

  res.json({ success: true, code }); // SMS 미연동 임시 조치 - 실제 발송 붙으면 code는 응답에서 제거
});

// POST /api/auth/phone/confirm — 휴대폰 인증번호 확인
router.post('/phone/confirm', async (req, res) => {
  const { phone, code } = req.body;

  const missingFields = [];
  if (!phone) missingFields.push('phone');
  if (!code) missingFields.push('code');
  if (missingFields.length > 0) {
    return res.status(400).json({ code: 'MISSING_REQUIRED_FIELD', error: MISSING_FIELD_MESSAGE, fields: missingFields });
  }

  const { data, error } = await supabaseAdmin
    .from('sjj_phone_verify')
    .select('*')
    .eq('phone', phone)
    .maybeSingle();

  if (error || !data) {
    return res.status(400).json({ code: 'VERIFY_NOT_FOUND', error: '인증 요청 내역이 없습니다' });
  }

  if (new Date(data.expires_at) < new Date()) {
    return res.status(400).json({ code: 'VERIFY_EXPIRED', error: '인증번호가 만료되었습니다' });
  }

  if (data.code !== code) {
    return res.status(400).json({ code: 'VERIFY_CODE_MISMATCH', error: '인증번호가 일치하지 않습니다' });
  }

  await supabaseAdmin.from('sjj_phone_verify').update({ verified: true }).eq('phone', phone);

  res.json({ success: true });
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
    return res.status(400).json({ code: 'MISSING_REQUIRED_FIELD', error: MISSING_FIELD_MESSAGE, fields: missingFields });
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
    return res.status(400).json({ code: 'SIGNUP_FAILED', error: '회원가입에 실패했습니다. 잠시 후 다시 시도해주세요' });
  }

  const user_id = data.user.id;
  const access_token = data.session?.access_token;
  console.log('[signup] Step1 성공 user_id:', user_id);

  const nick = await generateNick();

  const { error: profileError } = await supabaseAdmin
    .from('sjj_user')
    .update({ login_id: id, nick, gender, birth, phone })
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
    return res.status(400).json({ code: 'LOGIN_FAILED', error: '로그인에 실패했습니다. 잠시 후 다시 시도해주세요' });
  }

  console.log('[login] 완료 user_id:', data.user.id);
  res.json({
    user_id: data.user.id,
    access_token: data.session.access_token,
  });
});

module.exports = router;

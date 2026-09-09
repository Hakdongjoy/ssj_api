const express = require('express');
const router = express.Router();
const { supabaseAdmin } = require('../supabase');
const verifyToken = require('../middleware/auth');
const generateNick = require('../utils/nick');

// GET /api/user/nick/random — 인증 불필요
router.get('/nick/random', async (req, res) => {
  const nick = await generateNick();
  res.json({ nick });
});

// PATCH /api/user/nick
router.patch('/nick', verifyToken, async (req, res) => {
  const user_id = req.user.id;
  const { nick } = req.body;

  if (!nick || nick.trim().length === 0) {
    return res.status(400).json({ code: 'INVALID_NICK', error: '필요한 정보를 모두 입력했는지 다시 확인해주세요' });
  }

  const { error } = await supabaseAdmin.from('sjj_user').update({ nick: nick.trim() }).eq('id', user_id);
  if (error) return res.status(500).json({ code: 'NICK_UPDATE_FAILED', error: error.message });

  res.json({ success: true, nick: nick.trim() });
});

// POST /api/user/pref — 방 없는 사람 희망조건
router.post('/pref', verifyToken, async (req, res) => {
  const user_id = req.user.id;
  const {
    // 희망 지역 + 한마디 + 동의 (sjj_room_pref)
    region, district, subway_stn,
    bio,
    profile_agree, location_agree, push_agree, marketing_agree,
    // 추가정보 (sjj_user_info)
    job, job_input, is_remote,
    sleep_hour, wake_hour,
    pers_type, home_time, clean_freq, drink_freq,
    smoking, pet, pet_type, pet_type_input, pet_name, pet_memo,
  } = req.body;
  console.log('[pref] 요청 user_id:', user_id);

  const { error: profError } = await supabaseAdmin
    .from('sjj_user_info')
    .upsert({
      user_id,
      job, job_input, is_remote,
      sleep_hour, wake_hour,
      pers_type, home_time, clean_freq, drink_freq,
      smoking, pet, pet_type, pet_type_input, pet_name, pet_memo,
    }, { onConflict: 'user_id' });

  if (profError) {
    console.error('[pref] prof 실패:', profError.message);
    return res.status(500).json({ code: 'PROF_SAVE_FAILED', error: profError.message });
  }

  const { error: prefError } = await supabaseAdmin
    .from('sjj_room_pref')
    .insert({
      user_id,
      region, district, subway_stn,
      bio,
      profile_agree, location_agree, push_agree, marketing_agree,
    });

  if (prefError) {
    console.error('[pref] pref 실패:', prefError.message);
    return res.status(500).json({ code: 'PREF_SAVE_FAILED', error: prefError.message });
  }

  console.log('[pref] 완료');
  res.json({ success: true });
});

module.exports = router;

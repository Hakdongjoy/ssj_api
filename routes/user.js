const express = require('express');
const router = express.Router();
const { supabaseAdmin } = require('../supabase');
const verifyToken = require('../middleware/auth');

const ADJ = ['향기로운','달콤한','귀여운','용감한','신비로운','행복한','졸린','배고픈','빠른','느긋한','차가운','따뜻한','반짝이는','조용한','시끄러운'];
const NOUN = ['반찬','고양이','강아지','토끼','감자','치킨','라면','두부','김치','사과','망고','오징어','햄버거','붕어빵','만두'];

// GET /api/user/nick/random — 인증 불필요
router.get('/nick/random', async (req, res) => {
  const adj = ADJ[Math.floor(Math.random() * ADJ.length)];
  const noun = NOUN[Math.floor(Math.random() * NOUN.length)];
  const base = `${adj}${noun}`;

  const { data } = await supabaseAdmin
    .from('sjj_user')
    .select('nick')
    .ilike('nick', `${base}%`);

  const existing = new Set((data || []).map(r => r.nick));
  if (!existing.has(base)) return res.json({ nick: base });

  let n = 2;
  while (existing.has(`${base}${n}`)) n++;
  res.json({ nick: `${base}${n}` });
});

// PATCH /api/user/nick
router.patch('/nick', verifyToken, async (req, res) => {
  const user_id = req.user.id;
  const { nick } = req.body;

  if (!nick || nick.trim().length === 0) {
    return res.status(400).json({ code: 'INVALID_NICK', error: '닉네임을 입력해주세요' });
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
    job, is_remote,
    sleep_hour, wake_hour,
    pers_type, home_time, clean_freq, drink_freq,
    smoking, pet, pet_type, pet_type_input, pet_name, pet_memo,
  } = req.body;
  console.log('[pref] 요청 user_id:', user_id);

  const { error: profError } = await supabaseAdmin
    .from('sjj_user_info')
    .upsert({
      user_id,
      job, is_remote,
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

const express = require('express');
const router = express.Router();
const { supabaseAdmin } = require('../supabase');

const ADJ = ['향기로운','달콤한','귀여운','용감한','신비로운','행복한','졸린','배고픈','빠른','느긋한','차가운','따뜻한','반짝이는','조용한','시끄러운'];
const NOUN = ['반찬','고양이','강아지','토끼','감자','치킨','라면','두부','김치','사과','망고','오징어','햄버거','붕어빵','만두'];

// GET /api/user/nick/random
router.get('/nick/random', (req, res) => {
  const adj = ADJ[Math.floor(Math.random() * ADJ.length)];
  const noun = NOUN[Math.floor(Math.random() * NOUN.length)];
  res.json({ nick: `${adj}${noun}` });
});

// PATCH /api/user/nick
router.patch('/nick', async (req, res) => {
  const { user_id, nick } = req.body;
  if (!nick || nick.trim().length === 0) {
    return res.status(400).json({ code: 'INVALID_NICK', error: '닉네임을 입력해주세요' });
  }
  const { error } = await supabaseAdmin.from('sjj_user').update({ nick: nick.trim() }).eq('id', user_id);
  if (error) return res.status(500).json({ code: 'NICK_UPDATE_FAILED', error: error.message });
  res.json({ success: true, nick: nick.trim() });
});

// POST /api/user/pref
router.post('/pref', async (req, res) => {
  const {
    user_id,
    sleep_hour, wake_hour,
    noise_lvl,
    home_time,
    clean_freq,
    drink_freq,
    smoking, pet,
    pref_gender,
    age_min, age_max,
    budget_min, budget_max,
    regions,
    no_smoker, no_pet, no_noise, no_drink, no_homebody, no_messy,
    cook, wfh,
    pet_type, pet_name, pet_memo,
    subway_stn,
    bio,
    location_at,
  } = req.body;
  console.log('[pref] 요청 user_id:', user_id);

  const { error } = await supabaseAdmin
    .from('sjj_pref')
    .upsert({
      user_id,
      sleep_hour, wake_hour,
      noise_lvl,
      home_time,
      clean_freq,
      drink_freq,
      smoking, pet,
      pref_gender,
      age_min, age_max,
      budget_min, budget_max,
      regions,
      no_smoker, no_pet, no_noise, no_drink, no_homebody, no_messy,
      cook, wfh,
      pet_type, pet_name, pet_memo,
      subway_stn,
    }, { onConflict: 'user_id' });

  if (error) {
    console.error('[pref] 실패:', error.message);
    return res.status(500).json({ code: 'PREF_SAVE_FAILED', error: error.message });
  }

  if (location_at) {
    await supabaseAdmin.from('sjj_user').update({ location_at }).eq('id', user_id);
  }

  if (bio) {
    await supabaseAdmin.from('sjj_user').update({ bio }).eq('id', user_id);
  }

  console.log('[pref] 완료');
  res.json({ success: true });
});

module.exports = router;

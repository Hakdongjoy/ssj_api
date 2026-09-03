const express = require('express');
const router = express.Router();
const { supabaseAdmin } = require('../supabase');

// POST /api/room/register
router.post('/register', async (req, res) => {
  const {
    user_id,
    // 지역/위치
    region, subway_stn, walk_min,
    // 비용
    rent, maint_fee,
    // 방 정보
    share_type, note,
    // 선호조건
    pref_gender, pref_age_min, pref_age_max,
    // 생활패턴
    sleep_hour, wake_hour,
    noise_lvl, home_time, clean_freq, drink_freq,
    smoking, pet, pet_type, pet_name, pet_memo,
    cook, wfh,
    no_smoker, no_pet, no_noise, no_drink, no_homebody, no_messy,
    // 동의
    location_at,
  } = req.body;
  console.log('[room/register] 요청 user_id:', user_id);

  // sjj_room INSERT
  const { error: roomError } = await supabaseAdmin
    .from('sjj_room')
    .insert({
      user_id,
      region, subway_stn, walk_min,
      rent, maint_fee,
      share_type, note,
      pref_gender,
      pref_age_min, pref_age_max,
      is_active: true,
    });

  if (roomError) {
    console.error('[room/register] room 실패:', roomError.message);
    return res.status(500).json({ code: 'ROOM_REGISTER_FAILED', error: roomError.message });
  }

  // sjj_pref UPSERT (생활패턴)
  const { error: prefError } = await supabaseAdmin
    .from('sjj_pref')
    .upsert({
      user_id,
      sleep_hour, wake_hour,
      noise_lvl, home_time, clean_freq, drink_freq,
      smoking, pet, pet_type, pet_name, pet_memo,
      cook, wfh,
      no_smoker, no_pet, no_noise, no_drink, no_homebody, no_messy,
    }, { onConflict: 'user_id' });

  if (prefError) {
    console.error('[room/register] pref 실패:', prefError.message);
    return res.status(500).json({ code: 'PREF_SAVE_FAILED', error: prefError.message });
  }

  // 위치기반 동의
  if (location_at) {
    await supabaseAdmin.from('sjj_user').update({ location_at }).eq('id', user_id);
  }

  console.log('[room/register] 완료');
  res.json({ success: true });
});

module.exports = router;

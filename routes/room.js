const express = require('express');
const router = express.Router();
const { supabaseAdmin } = require('../supabase');
const verifyToken = require('../middleware/auth');

// POST /api/room/register — 방 있는 사람 공고 등록
router.post('/register', verifyToken, async (req, res) => {
  const user_id = req.user.id;
  const {
    // 지역 + 비용 (sjj_room)
    region, district, subway_stn,
    rent, maint_fee,
    pref_gender, restrict_gender,
    share_rent_type, share_rent_amount,
    share_maint_type, share_maint_amount,
    avoid_smoke, avoid_drink, avoid_pet,
    bio,
    profile_agree, location_agree, push_agree, marketing_agree,
    // 추가정보 (sjj_user_info)
    job, job_input, is_remote,
    sleep_hour, wake_hour,
    pers_type, home_time, clean_freq, drink_freq,
    smoking, pet, pet_type, pet_type_input, pet_name, pet_memo,
  } = req.body;
  console.log('[room/register] 요청 user_id:', user_id);

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
    console.error('[room/register] prof 실패:', profError.message);
    return res.status(500).json({ code: 'PROF_SAVE_FAILED', error: profError.message });
  }

  const { error: roomError } = await supabaseAdmin
    .from('sjj_room')
    .insert({
      user_id,
      region, district, subway_stn,
      rent, maint_fee,
      pref_gender, restrict_gender,
      share_rent_type, share_rent_amount,
      share_maint_type, share_maint_amount,
      avoid_smoke, avoid_drink, avoid_pet,
      bio,
      profile_agree, location_agree, push_agree, marketing_agree,
      is_active: true,
    });

  if (roomError) {
    console.error('[room/register] room 실패:', roomError.message);
    return res.status(500).json({ code: 'ROOM_REGISTER_FAILED', error: roomError.message });
  }

  console.log('[room/register] 완료');
  res.json({ success: true });
});

module.exports = router;

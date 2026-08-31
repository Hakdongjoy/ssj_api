const express = require('express');
const router = express.Router();
const { supabaseAdmin } = require('../supabase');

// PATCH /api/user/profile
router.patch('/profile', async (req, res) => {
  const { user_id, job, bio, avatar_url, phone } = req.body;
  console.log('[profile] 요청:', { user_id, job });

  const { error } = await supabaseAdmin
    .from('sjj_user')
    .update({ job, bio, avatar_url, phone })
    .eq('id', user_id);

  if (error) {
    console.error('[profile] 실패:', error.message);
    return res.status(500).json({ code: 'PROFILE_UPDATE_FAILED', error: error.message });
  }

  console.log('[profile] 완료');
  res.json({ success: true });
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
    location_at,
  } = req.body;
  console.log('[pref] 요청 user_id:', user_id);

  const { error } = await supabaseAdmin
    .from('sjj_pref')
    .insert({
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
    });

  if (error) {
    console.error('[pref] 실패:', error.message);
    return res.status(500).json({ code: 'PREF_SAVE_FAILED', error: error.message });
  }

  if (location_at) {
    await supabaseAdmin.from('sjj_user').update({ location_at }).eq('id', user_id);
  }

  console.log('[pref] 완료');
  res.json({ success: true });
});

module.exports = router;

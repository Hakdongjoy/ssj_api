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

function calcAge(birth) {
  if (!birth) return null;
  return new Date().getFullYear() - new Date(birth).getFullYear() + 1;
}

// GET /api/room/list?region=서울&page=1&limit=20
router.get('/list', async (req, res) => {
  const { region, page = 1, limit = 20 } = req.query;
  const offset = (Number(page) - 1) * Number(limit);

  let query = supabaseAdmin
    .from('sjj_room')
    .select('id, user_id, region, subway_stn, rent, maint_fee, pref_gender, sjj_user!user_id(nick, gender, birth, job, avatar_url)')
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .range(offset, offset + Number(limit) - 1);

  if (region) query = query.ilike('region', `${region}%`);

  const { data, error } = await query;
  if (error) return res.status(500).json({ code: 'LIST_FETCH_FAILED', error: error.message });

  const userIds = data.map(r => r.user_id);
  const { data: prefs } = await supabaseAdmin
    .from('sjj_pref')
    .select('user_id, bio')
    .in('user_id', userIds);

  const prefMap = Object.fromEntries((prefs || []).map(p => [p.user_id, p]));

  const list = data.map(r => {
    const user = r.sjj_user;
    const pref = prefMap[r.user_id];
    return {
      id: r.id,
      nick: user?.nick,
      gender: user?.gender,
      age: calcAge(user?.birth),
      job: user?.job,
      avatar_url: user?.avatar_url,
      region: r.region,
      subway_stn: r.subway_stn,
      rent: r.rent,
      maint_fee: r.maint_fee,
      share_rent: r.rent ? Math.round(r.rent / 2) : null,
      share_maint: r.maint_fee ? Math.round(r.maint_fee / 2) : null,
      pref_gender: r.pref_gender,
      bio: pref?.bio,
    };
  });

  res.json({ total: data.length, page: Number(page), list });
});

// GET /api/room/:id
router.get('/:id', async (req, res) => {
  const { id } = req.params;

  const { data, error } = await supabaseAdmin
    .from('sjj_room')
    .select('*, sjj_user!user_id(nick, gender, birth, job, avatar_url)')
    .eq('id', id)
    .single();

  if (error) return res.status(404).json({ code: 'ROOM_NOT_FOUND', error: error.message });

  const { data: pref } = await supabaseAdmin
    .from('sjj_pref')
    .select('bio, noise_lvl, home_time, clean_freq, drink_freq, smoking, pet, pet_type, pet_name, pet_memo, cook, wfh, no_smoker, no_pet, no_noise, no_drink, no_homebody, no_messy')
    .eq('user_id', data.user_id)
    .single();

  const user = data.sjj_user;

  res.json({
    id: data.id,
    nick: user?.nick,
    gender: user?.gender,
    age: calcAge(user?.birth),
    job: user?.job,
    avatar_url: user?.avatar_url,
    region: data.region,
    subway_stn: data.subway_stn,
    walk_min: data.walk_min,
    rent: data.rent,
    maint_fee: data.maint_fee,
    share_rent: data.rent ? Math.round(data.rent / 2) : null,
    share_maint: data.maint_fee ? Math.round(data.maint_fee / 2) : null,
    pref_gender: data.pref_gender,
    pref_age_min: data.pref_age_min,
    pref_age_max: data.pref_age_max,
    note: data.note,
    bio: pref?.bio,
    noise_lvl: pref?.noise_lvl,
    home_time: pref?.home_time,
    clean_freq: pref?.clean_freq,
    drink_freq: pref?.drink_freq,
    smoking: pref?.smoking,
    pet: pref?.pet,
    pet_type: pref?.pet_type,
    pet_name: pref?.pet_name,
    pet_memo: pref?.pet_memo,
    cook: pref?.cook,
    wfh: pref?.wfh,
    no_smoker: pref?.no_smoker,
    no_pet: pref?.no_pet,
    no_noise: pref?.no_noise,
    no_drink: pref?.no_drink,
    no_homebody: pref?.no_homebody,
    no_messy: pref?.no_messy,
  });
});

module.exports = router;

const express = require('express');
const router = express.Router();
const { supabaseAdmin } = require('../supabase');
const verifyToken = require('../middleware/auth');

function calcAge(birth) {
  if (!birth) return null;
  return new Date().getFullYear() - new Date(birth).getFullYear() + 1;
}

function calcShare(fullAmt, type, customAmt) {
  if (type === 'half') return fullAmt ? Math.round(fullAmt / 2) : null;
  if (type === 'custom') return customAmt ?? null;
  return null; // negotiate → 직접조율, 고정값 없음
}

// POST /api/room/register — 방 있는 사람 추가정보
router.post('/register', verifyToken, async (req, res) => {
  const user_id = req.user.id;
  const {
    // 지역 + 비용 (sjj_room)
    region, district, subway_stn,
    rent, maint_fee,
    pref_gender,
    share_rent_type, share_rent_amount,
    share_maint_type, share_maint_amount,
    no_smoker, no_drink, no_pet,
    bio,
    profile_agree, location_agree, push_agree, marketing_agree,
    // 생활습관 (sjj_user_prof)
    job, wfh,
    sleep_hour, wake_hour,
    noise_lvl, home_time, clean_freq, drink_freq,
    smoking, pet, pet_type, pet_type_input, pet_name, pet_memo,
  } = req.body;
  console.log('[room/register] 요청 user_id:', user_id);

  const { error: profError } = await supabaseAdmin
    .from('sjj_user_prof')
    .upsert({
      user_id,
      job, wfh,
      sleep_hour, wake_hour,
      noise_lvl, home_time, clean_freq, drink_freq,
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
      situation: 'has_room',
      region, district, subway_stn,
      rent, maint_fee,
      pref_gender,
      share_rent_type, share_rent_amount,
      share_maint_type, share_maint_amount,
      no_smoker, no_drink, no_pet,
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

// GET /api/room/list?region=서울&page=1&limit=20
router.get('/list', async (req, res) => {
  const { region, page = 1, limit = 20 } = req.query;
  const offset = (Number(page) - 1) * Number(limit);

  let query = supabaseAdmin
    .from('sjj_room')
    .select('id, user_id, region, district, subway_stn, rent, maint_fee, pref_gender, share_rent_type, share_rent_amount, share_maint_type, share_maint_amount, bio, sjj_user!user_id(nick, gender, birth, avatar_url)')
    .eq('situation', 'has_room')
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .range(offset, offset + Number(limit) - 1);

  if (region) query = query.ilike('region', `${region}%`);

  const { data, error } = await query;
  if (error) return res.status(500).json({ code: 'LIST_FETCH_FAILED', error: error.message });

  const userIds = data.map(r => r.user_id);
  const { data: profs } = await supabaseAdmin
    .from('sjj_user_prof')
    .select('user_id, job')
    .in('user_id', userIds);

  const profMap = Object.fromEntries((profs || []).map(p => [p.user_id, p]));

  const list = data.map(r => {
    const user = r.sjj_user;
    const prof = profMap[r.user_id];
    const share_rent = calcShare(r.rent, r.share_rent_type, r.share_rent_amount);
    const share_maint = calcShare(r.maint_fee, r.share_maint_type, r.share_maint_amount);
    return {
      id: r.id,
      nick: user?.nick,
      gender: user?.gender,
      age: calcAge(user?.birth),
      job: prof?.job,
      avatar_url: user?.avatar_url,
      region: r.region,
      district: r.district,
      subway_stn: r.subway_stn,
      pref_gender: r.pref_gender,
      share_rent,
      share_maint,
      share_total: share_rent != null && share_maint != null ? share_rent + share_maint : null,
      bio: r.bio,
    };
  });

  res.json({ total: data.length, page: Number(page), list });
});

// GET /api/room/:id
router.get('/:id', async (req, res) => {
  const { id } = req.params;

  const { data, error } = await supabaseAdmin
    .from('sjj_room')
    .select('*, sjj_user!user_id(nick, gender, birth, avatar_url)')
    .eq('id', id)
    .single();

  if (error) return res.status(404).json({ code: 'ROOM_NOT_FOUND', error: error.message });

  const { data: prof } = await supabaseAdmin
    .from('sjj_user_prof')
    .select('job, wfh, sleep_hour, wake_hour, noise_lvl, home_time, clean_freq, drink_freq, smoking, pet, pet_type, pet_type_input, pet_name, pet_memo')
    .eq('user_id', data.user_id)
    .single();

  const user = data.sjj_user;
  const share_rent = calcShare(data.rent, data.share_rent_type, data.share_rent_amount);
  const share_maint = calcShare(data.maint_fee, data.share_maint_type, data.share_maint_amount);

  res.json({
    id: data.id,
    nick: user?.nick,
    gender: user?.gender,
    age: calcAge(user?.birth),
    avatar_url: user?.avatar_url,
    region: data.region,
    district: data.district,
    subway_stn: data.subway_stn,
    rent: data.rent,
    maint_fee: data.maint_fee,
    share_rent_type: data.share_rent_type,
    share_rent,
    share_maint_type: data.share_maint_type,
    share_maint,
    share_total: share_rent != null && share_maint != null ? share_rent + share_maint : null,
    pref_gender: data.pref_gender,
    no_smoker: data.no_smoker,
    no_drink: data.no_drink,
    no_pet: data.no_pet,
    bio: data.bio,
    job: prof?.job,
    wfh: prof?.wfh,
    sleep_hour: prof?.sleep_hour,
    wake_hour: prof?.wake_hour,
    noise_lvl: prof?.noise_lvl,
    home_time: prof?.home_time,
    clean_freq: prof?.clean_freq,
    drink_freq: prof?.drink_freq,
    smoking: prof?.smoking,
    pet: prof?.pet,
    pet_type: prof?.pet_type,
    pet_type_input: prof?.pet_type_input,
    pet_name: prof?.pet_name,
    pet_memo: prof?.pet_memo,
  });
});

module.exports = router;

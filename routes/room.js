const express = require('express');
const router = express.Router();
const { supabaseAdmin } = require('../supabase');
const verifyToken = require('../middleware/auth');
const { optionalAuth } = require('../middleware/auth');

function calcAge(birth) {
  if (!birth) return null;
  return new Date().getFullYear() - new Date(birth).getFullYear() + 1;
}

function calcShare(fullAmt, type, customAmt) {
  if (type === 'half') return fullAmt ? Math.round(fullAmt / 2) : null;
  if (type === 'custom') return customAmt ?? null;
  return null; // negotiate → 직접조율, 고정값 없음
}

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

  if (profile_agree !== true) {
    return res.status(400).json({ code: 'MISSING_REQUIRED_FIELD', error: '필요한 정보를 모두 입력했는지 다시 확인해주세요', fields: ['profile_agree'] });
  }

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
    return res.status(500).json({ code: 'PROF_SAVE_FAILED', error: '저장에 실패했습니다. 잠시 후 다시 시도해주세요' });
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
    return res.status(500).json({ code: 'ROOM_REGISTER_FAILED', error: '공고 등록에 실패했습니다. 잠시 후 다시 시도해주세요' });
  }

  console.log('[room/register] 완료');
  res.json({ success: true });
});

// GET /api/room/list?region=서울&district=성북구&page=1&limit=7 — 인증 선택 (있으면 조회자 성별로 제한 공고 필터링)
router.get('/list', optionalAuth, async (req, res) => {
  const { region, district, page = 1, limit = 7 } = req.query;
  const safeLimit = Math.min(Number(limit) || 7, 50);
  const offset = (Number(page) - 1) * safeLimit;

  let query = supabaseAdmin
    .from('sjj_room')
    .select('id, user_id, region, district, subway_stn, rent, maint_fee, pref_gender, restrict_gender, share_rent_type, share_rent_amount, share_maint_type, share_maint_amount, sjj_user!user_id(nick, gender, birth)', { count: 'exact' })
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .range(offset, offset + safeLimit - 1);

  if (region) query = query.ilike('region', `${region}%`);
  if (district) query = query.ilike('district', `${district}%`);

  const { data, error, count } = await query;
  if (error) return res.status(500).json({ code: 'LIST_FETCH_FAILED', error: '목록 조회에 실패했습니다. 잠시 후 다시 시도해주세요' });

  const userIds = data.map(r => r.user_id);
  const { data: profs } = await supabaseAdmin
    .from('sjj_user_info')
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
      region: r.region,
      district: r.district,
      subway_stn: r.subway_stn,
      pref_gender: r.pref_gender,
      share_total: share_rent != null && share_maint != null ? share_rent + share_maint : null,
    };
  });

  res.json({
    total: count ?? data.length,
    page: Number(page),
    has_more: offset + data.length < (count ?? 0),
    list,
  });
});

// GET /api/room/:id — 인증 선택 (있으면 조회자 성별로 제한 공고 필터링)
router.get('/:id', optionalAuth, async (req, res) => {
  const { id } = req.params;

  const { data, error } = await supabaseAdmin
    .from('sjj_room')
    .select('*, sjj_user!user_id(nick, gender, birth)')
    .eq('id', id)
    .single();

  if (error) return res.status(404).json({ code: 'ROOM_NOT_FOUND', error: '공고를 찾을 수 없습니다' });

  if (data.restrict_gender) {
    let viewerGender = null;
    if (req.user) {
      const { data: viewer } = await supabaseAdmin.from('sjj_user').select('gender').eq('id', req.user.id).single();
      viewerGender = viewer?.gender || null;
    }
    if (viewerGender !== data.pref_gender) {
      return res.json({ id: data.id, locked: true, message: '특정 성별에게만 공개된 공고입니다' });
    }
  }

  const { data: prof } = await supabaseAdmin
    .from('sjj_user_info')
    .select('job, sleep_hour, wake_hour, pers_type, home_time, clean_freq, drink_freq, smoking')
    .eq('user_id', data.user_id)
    .single();

  const user = data.sjj_user;
  const share_rent = calcShare(data.rent, data.share_rent_type, data.share_rent_amount);
  const share_maint = calcShare(data.maint_fee, data.share_maint_type, data.share_maint_amount);

  res.json({
    id: data.id,
    locked: false,
    nick: user?.nick,
    gender: user?.gender,
    age: calcAge(user?.birth),
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
    avoid_smoke: data.avoid_smoke,
    avoid_drink: data.avoid_drink,
    avoid_pet: data.avoid_pet,
    bio: data.bio,
    job: prof?.job,
    sleep_hour: prof?.sleep_hour,
    wake_hour: prof?.wake_hour,
    pers_type: prof?.pers_type,
    home_time: prof?.home_time,
    clean_freq: prof?.clean_freq,
    drink_freq: prof?.drink_freq,
    smoking: prof?.smoking,
  });
});

module.exports = router;

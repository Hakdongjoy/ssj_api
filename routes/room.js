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

// negotiate 타입은 금액 대신 '조율' 텍스트로 노출
function formatShare(amount, type) {
  if (type === 'negotiate') return '직접조율';
  return amount;
}

function calcShareTotal(rentShare, maintShare, rentType, maintType) {
  if (rentType === 'negotiate' || maintType === 'negotiate') return '직접조율';
  if (rentShare != null && maintShare != null) return rentShare + maintShare;
  return null;
}

// 공고의 region(서울/경기/인천 등) → sjj_subway_station.region_cd 매핑. 도시철도 없는 지역은 매핑 없음(null)
const REGION_TO_METRO = {
  '서울': '수도권', '경기': '수도권', '인천': '수도권',
  '부산': '부산', '대구': '대구', '광주': '광주', '대전': '대전',
};

// 마스터 데이터(sjj_subway_station)는 노선마다 역명 표기가 제각각 — "역" 접미사 유무, "역명(병기명)",
// "경성대·부경대" 같은 가운뎃점, 소스 엑셀 자체의 오타(따옴표 등)가 섞여 있어서 정규화 후 비교
function normalizeStationName(name) {
  return name
    .replace(/["']/g, '')
    .replace(/\(.*?\)/g, '')
    .replace(/[·.\s]/g, '')
    .replace(/역$/, '')
    .trim();
}

async function resolveSubwayLine(region, subway_stn) {
  if (!subway_stn) return null;
  const metro = REGION_TO_METRO[region];
  if (!metro) return null;

  const target = normalizeStationName(subway_stn);
  if (!target) return null;

  const { data } = await supabaseAdmin
    .from('sjj_subway_station')
    .select('line_nm, station_nm')
    .eq('region_cd', metro);

  if (!data) return null;
  const matched = data.filter(d => normalizeStationName(d.station_nm) === target);
  if (matched.length === 0) return null;

  const names = matched.map(d => d.line_nm.replace(/\s+/g, ' ').trim());
  return [...new Set(names)].join(', ');
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

  const subway_line = await resolveSubwayLine(region, subway_stn);

  const { error: roomError } = await supabaseAdmin
    .from('sjj_room')
    .insert({
      user_id,
      region, district, subway_stn, subway_line,
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

// GET /api/room/region_cnt — 광역/시군구별 활성 공고 개수 (지역선택 모달용)
router.get('/region_cnt', async (req, res) => {
  const { data: regions, error: regionError } = await supabaseAdmin
    .from('sjj_region')
    .select('id, name')
    .order('sort_order');

  const { data: districts, error: districtError } = await supabaseAdmin
    .from('sjj_district')
    .select('region_id, name')
    .order('sort_order');

  if (regionError || districtError) {
    return res.status(500).json({ code: 'REGION_CNT_FAILED', error: '지역 목록 조회에 실패했습니다. 잠시 후 다시 시도해주세요' });
  }

  const { data: rooms, error: roomError } = await supabaseAdmin
    .from('sjj_room')
    .select('region, district')
    .eq('is_active', true);

  if (roomError) {
    return res.status(500).json({ code: 'REGION_CNT_FAILED', error: '지역 목록 조회에 실패했습니다. 잠시 후 다시 시도해주세요' });
  }

  const countMap = {};
  for (const r of rooms) {
    countMap[r.region] = (countMap[r.region] || 0) + 1;
    const key = `${r.region}|${r.district}`;
    countMap[key] = (countMap[key] || 0) + 1;
  }

  const districtsByRegion = {};
  for (const d of districts) {
    if (!districtsByRegion[d.region_id]) districtsByRegion[d.region_id] = [];
    districtsByRegion[d.region_id].push(d.name);
  }

  const result = regions.map(r => ({
    region: r.name,
    count: countMap[r.name] || 0,
    districts: (districtsByRegion[r.id] || []).map(name => ({
      district: name,
      count: countMap[`${r.name}|${name}`] || 0,
    })),
  }));

  res.json({ regions: result });
});

// GET /api/room/list?region=서울&district=성북구&page=1&limit=7 — 인증 선택 (있으면 조회자 성별로 제한 공고 필터링)
router.get('/list', optionalAuth, async (req, res) => {
  const { region, district, page = 1, limit = 7 } = req.query;
  const safeLimit = Math.min(Number(limit) || 7, 50);
  const offset = (Number(page) - 1) * safeLimit;

  let query = supabaseAdmin
    .from('sjj_room')
    .select('id, user_id, region, district, subway_stn, subway_line, rent, maint_fee, pref_gender, restrict_gender, share_rent_type, share_rent_amount, share_maint_type, share_maint_amount, sjj_user!user_id(nick, gender, birth)', { count: 'exact' })
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
      subway_line: r.subway_line,
      pref_gender: r.pref_gender,
      share_total: calcShareTotal(share_rent, share_maint, r.share_rent_type, r.share_maint_type),
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
    subway_line: data.subway_line,
    rent: data.rent,
    maint_fee: data.maint_fee,
    share_rent_type: data.share_rent_type,
    share_rent: formatShare(share_rent, data.share_rent_type),
    share_maint_type: data.share_maint_type,
    share_maint: formatShare(share_maint, data.share_maint_type),
    share_total: calcShareTotal(share_rent, share_maint, data.share_rent_type, data.share_maint_type),
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

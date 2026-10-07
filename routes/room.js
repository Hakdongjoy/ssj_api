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

// DB엔 콤마로 이어붙인 slug 문자열로 저장, 응답에선 배열로 변환
function parseSubwayLine(subway_line) {
  return subway_line ? subway_line.split(',') : [];
}

// 공고의 region(서울/경기/인천 등) → sjj_subway_station.region_cd 매핑. 도시철도 없는 지역은 매핑 없음(null)
const REGION_TO_METRO = {
  '서울': '수도권', '경기': '수도권', '인천': '수도권',
  '부산': '부산', '대구': '대구', '광주': '광주', '대전': '대전',
};

// line_nm(한글) → 프론트 아이콘 키(slug). 수도권/KTX는 아이콘 확인 완료, 그 외 지역은 추정값(확인 필요)
const LINE_SLUG_MAP = {
  '공항철도': 'airport_railroad', '에버라인': 'everline', '김포골드라인': 'gimpo_goldline',
  'GTX-A': 'gtx_a', '경춘선': 'gyeongchun', '경강선': 'gyeonggang', '경의중앙선': 'gyeongui_jungang',
  '인천 1호선': 'incheon_1', '인천 2호선': 'incheon_2', '서해선': 'seohae',
  '신림선': 'sillim', '신분당선': 'sinbundang', '수인분당선': 'suin_bundang',
  '우이신설선': 'ui_sinseol', '의정부경전철': 'uijeongbu',
  // 아래는 아이콘 미확인 - 추정값
  '부산김해경전철': 'busan_gimhae', '동해선': 'donghae', '대경선': 'daegyeong', '자기부상철도': 'maglev',
};

// 1~9호선은 지역별로 접두어가 다름 (서울/부산/대구/광주/대전 각각 1호선이 있어서)
const NUMBERED_LINE_PREFIX = {
  '수도권': 'seoul', '부산': 'busan', '대구': 'daegu', '광주': 'gwangju', '대전': 'daejeon',
};

function toSlug(lineNm, metro) {
  const m = lineNm.match(/^([1-9])호선$/);
  if (m) {
    const prefix = NUMBERED_LINE_PREFIX[metro] || metro;
    return `${prefix}_${m[1]}`;
  }
  return LINE_SLUG_MAP[lineNm] || lineNm;
}

// 마스터 데이터(sjj_subway_station)는 노선마다 역명 표기가 제각각 — "역" 접미사 유무, "역명(병기명)",
// "경성대·부경대" 같은 가운뎃점/마침표, 소스 엑셀 자체의 오타(따옴표 등)가 섞여 있어서 정규화 후 비교
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
  const target = normalizeStationName(subway_stn);
  if (!target) return null;

  const slugs = new Set();

  const metro = REGION_TO_METRO[region];
  if (metro) {
    const { data } = await supabaseAdmin
      .from('sjj_subway_station')
      .select('line_nm, station_nm')
      .eq('region_cd', metro);
    (data || [])
      .filter(d => normalizeStationName(d.station_nm) === target)
      .forEach(d => slugs.add(toSlug(d.line_nm.replace(/\s+/g, ' ').trim(), metro)));
  }

  // 지하철에 없으면(혹은 지하철 없는 지역이면) KTX도 확인
  const { data: ktxData, error: ktxError } = await supabaseAdmin
    .from('sjj_ktx_station')
    .select('station_nm');
  if (!ktxError && ktxData?.some(d => normalizeStationName(d.station_nm) === target)) {
    slugs.add('ktx');
  }

  if (slugs.size === 0) return null;
  return [...slugs].join(',');
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

// GET /api/room/station-search?q=강남&limit=20 — 가까운 역 검색 자동완성 (지하철+KTX 통합)
router.get('/station-search', async (req, res) => {
  const { q, limit = 20 } = req.query;
  if (!q) return res.json({ stations: [] });

  const safeLimit = Math.min(Number(limit) || 20, 50);
  const pattern = `${q}%`;

  const [{ data: subwayRows }, { data: ktxRows }] = await Promise.all([
    supabaseAdmin.from('sjj_subway_station').select('region_cd, line_nm, station_nm').ilike('station_nm', pattern),
    supabaseAdmin.from('sjj_ktx_station').select('region_cd, line_nm, station_nm').ilike('station_nm', pattern),
  ]);

  const groups = {}; // key: region_cd + '|' + normalizeStationName(station_nm)
  const addRow = (row, isKtx) => {
    const norm = normalizeStationName(row.station_nm);
    if (!norm) return;
    const key = `${row.region_cd}|${norm}`;
    if (!groups[key]) {
      const displayName = row.station_nm.endsWith('역') ? row.station_nm : `${row.station_nm}역`;
      groups[key] = { name: displayName, region: row.region_cd, slugs: new Set() };
    }
    groups[key].slugs.add(isKtx ? 'ktx' : toSlug(row.line_nm.replace(/\s+/g, ' ').trim(), row.region_cd));
  };

  (subwayRows || []).forEach(r => addRow(r, false));
  (ktxRows || []).forEach(r => addRow(r, true));

  const stations = Object.values(groups)
    .map(g => ({ name: g.name, region: g.region, lines: [...g.slugs] }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'))
    .slice(0, safeLimit);

  res.json({ stations });
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
      subway_line: parseSubwayLine(r.subway_line),
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
    subway_line: parseSubwayLine(data.subway_line),
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

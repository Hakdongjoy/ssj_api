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

// 공고의 region(서울/경기/인천 등)으로 sjj_subway_station을 검색할 때 같이 묶어서 찾을 생활권 범위.
// 노선이 도 경계를 넘어가는 경우(대경선→경북, 부산김해경전철/2호선 연장→경남, 동해선→울산) 반영
const LIVING_AREA_GROUPS = [
  ['서울', '경기', '인천'],
  ['부산', '경남', '울산'],
  ['대구', '경북'],
];
const STATION_SEARCH_SCOPE = Object.fromEntries(
  LIVING_AREA_GROUPS.flatMap(group => group.map(region => [region, group]))
);

// line_nm(한글) → 프론트 아이콘 키(slug). 수도권은 아이콘 확인 완료, 그 외 지역은 추정값(확인 필요)
const LINE_SLUG_MAP = {
  '공항철도': 'airport_railroad', '에버라인': 'everline', '김포골드라인': 'gimpo_goldline',
  'GTX-A': 'gtx_a', '경춘선': 'gyeongchun', '경강선': 'gyeonggang', '경의중앙선': 'gyeongui_jungang',
  '인천 1호선': 'incheon_1', '인천 2호선': 'incheon_2', '서해선': 'seohae',
  '신림선': 'sillim', '신분당선': 'sinbundang', '수인분당선': 'suin_bundang',
  '우이신설선': 'ui_sinseol', '의정부경전철': 'uijeongbu',
  // 아래는 아이콘 미확인 - 추정값
  '부산김해경전철': 'busan_gimhae', '동해선': 'donghae', '대경선': 'daegyeong', '자기부상철도': 'maglev',
};

// 1~9호선은 지역별로 접두어가 다름 (서울/부산/대구/광주/대전 각각 1호선이 있어서).
// region_cd가 서울/경기/인천처럼 세분화돼있어도 수도권 노선은 전부 "seoul_" 접두어로 통일
const NUMBERED_LINE_PREFIX = {
  '서울': 'seoul', '경기': 'seoul', '인천': 'seoul',
  '부산': 'busan', '경남': 'busan', // 부산 2호선 양산(경남) 연장구간
  '대구': 'daegu', '경북': 'daegu', // 대구 2호선 경산(경북) 연장구간
  '광주': 'gwangju', '대전': 'daejeon',
};

function toSlug(lineNm, regionCd) {
  const m = lineNm.match(/^([1-9])호선$/);
  if (m) {
    const prefix = NUMBERED_LINE_PREFIX[regionCd] || regionCd;
    return `${prefix}_${m[1]}`;
  }
  return LINE_SLUG_MAP[lineNm] || lineNm;
}

// 서울 1~9호선(seoul_N) slug를 번호 순으로 맨 앞에, 나머지는 원래 순서 유지
function sortLineSlugs(slugs) {
  const seoulNum = (s) => {
    const m = s.match(/^seoul_([1-9])$/);
    return m ? Number(m[1]) : null;
  };
  return [...slugs].sort((a, b) => {
    const na = seoulNum(a), nb = seoulNum(b);
    if (na !== null && nb !== null) return na - nb;
    if (na !== null) return -1;
    if (nb !== null) return 1;
    return 0;
  });
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

// subway_stn 입력값을 마스터 테이블과 매칭해서 { line, canonicalName }을 반환.
// canonicalName은 역검색(station-search)이 보여주는 표시명과 동일하게 맞춰서 저장 —
// "교대역"처럼 사용자가 축약 입력해도 "교대(법원.검찰청)역"으로 정규화 저장해 동명이역 충돌 방지
async function resolveSubwayLine(region, subway_stn) {
  if (!subway_stn || !region) return { line: null, canonicalName: subway_stn || null };
  const target = normalizeStationName(subway_stn);
  if (!target) return { line: null, canonicalName: subway_stn };

  const scope = STATION_SEARCH_SCOPE[region] || [region];
  const { data } = await supabaseAdmin
    .from('sjj_subway_station')
    .select('line_nm, station_nm, region_cd')
    .in('region_cd', scope);

  const matched = (data || []).filter(d => normalizeStationName(d.station_nm) === target);
  if (matched.length === 0) return { line: null, canonicalName: subway_stn };

  const slugs = new Set();
  matched.forEach(d => slugs.add(toSlug(d.line_nm.replace(/\s+/g, ' ').trim(), d.region_cd)));

  const rawName = matched[0].station_nm;
  const canonicalName = rawName.endsWith('역') ? rawName : `${rawName}역`;

  return { line: sortLineSlugs(slugs).join(','), canonicalName };
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

  const { line: subway_line, canonicalName: canonicalSubwayStn } = await resolveSubwayLine(region, subway_stn);

  const { error: roomError } = await supabaseAdmin
    .from('sjj_room')
    .insert({
      user_id,
      region, district, subway_stn: canonicalSubwayStn, subway_line,
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

// GET /api/room/station-search?q=강남&region=서울&limit=20 — 가까운 역 검색 자동완성 (역명에 검색어가 포함되면 매칭). region 주면 정확히 그 지역 역만
router.get('/station-search', async (req, res) => {
  const { q, region, limit = 20 } = req.query;
  if (!q) return res.json({ stations: [] });

  const safeLimit = Math.min(Number(limit) || 20, 50);
  const pattern = `%${q}%`;

  let query = supabaseAdmin
    .from('sjj_subway_station')
    .select('region_cd, line_nm, station_nm')
    .ilike('station_nm', pattern);
  if (region) query = query.eq('region_cd', region);

  const { data: subwayRows } = await query;

  const groups = {}; // key: region_cd + '|' + normalizeStationName(station_nm)
  const addRow = (row) => {
    const norm = normalizeStationName(row.station_nm);
    if (!norm) return;
    const key = `${row.region_cd}|${norm}`;
    if (!groups[key]) {
      const displayName = row.station_nm.endsWith('역') ? row.station_nm : `${row.station_nm}역`;
      groups[key] = { name: displayName, region: row.region_cd, slugs: new Set() };
    }
    groups[key].slugs.add(toSlug(row.line_nm.replace(/\s+/g, ' ').trim(), row.region_cd));
  };

  (subwayRows || []).forEach(addRow);

  // 서울 1~9호선이 있는 역을 호선 번호 순으로 최우선 노출, 그 외는 가나다순
  const seoulLinePriority = (lines) => {
    const nums = lines
      .map(l => l.match(/^seoul_([1-9])$/))
      .filter(Boolean)
      .map(m => Number(m[1]));
    return nums.length ? Math.min(...nums) : 99;
  };

  const stations = Object.values(groups)
    .map(g => ({ name: g.name, region: g.region, lines: sortLineSlugs(g.slugs) }))
    .sort((a, b) => {
      const p = seoulLinePriority(a.lines) - seoulLinePriority(b.lines);
      return p !== 0 ? p : a.name.localeCompare(b.name, 'ko');
    })
    .slice(0, safeLimit);

  res.json({ stations });
});

// GET /api/room/list?region=서울&district=성북구&subway_stn=강남역&page=1&limit=7 — 인증 선택 (있으면 조회자 성별로 제한 공고 필터링)
router.get('/list', optionalAuth, async (req, res) => {
  const { region, district, subway_stn, page = 1, limit = 7 } = req.query;
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
  if (subway_stn) query = query.eq('subway_stn', subway_stn);

  const { data, error, count } = await query;

  // PGRST103: 요청한 page가 실제 데이터 범위를 벗어남(필터 결과가 적을 때 자주 발생) — 에러 아니라 빈 목록으로 처리
  if (error?.code === 'PGRST103') {
    return res.json({ total: 0, page: Number(page), has_more: false, list: [] });
  }
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

// GET /api/room/applications/received — 내가 받은 신청 목록 (내 공고들에 들어온 신청)
router.get('/applications/received', verifyToken, async (req, res) => {
  const user_id = req.user.id;

  const { data: myRooms } = await supabaseAdmin.from('sjj_room').select('id').eq('user_id', user_id);
  const roomIds = (myRooms || []).map(r => r.id);
  if (roomIds.length === 0) return res.json({ applications: [] });

  const { data, error } = await supabaseAdmin
    .from('sjj_room_apply')
    .select('id, status, message, created_at, responded_at, room_id, applicant_id, sjj_user!applicant_id(nick, gender, birth), sjj_room!room_id(district, subway_stn)')
    .in('room_id', roomIds)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ code: 'APPLY_LIST_FAILED', error: '신청 목록 조회에 실패했습니다. 잠시 후 다시 시도해주세요' });

  const applications = data.map(a => ({
    id: a.id,
    status: a.status,
    message: a.message,
    created_at: a.created_at,
    responded_at: a.responded_at,
    room_id: a.room_id,
    room_district: a.sjj_room?.district,
    room_subway_stn: a.sjj_room?.subway_stn,
    applicant_nick: a.sjj_user?.nick,
    applicant_gender: a.sjj_user?.gender,
    applicant_age: calcAge(a.sjj_user?.birth),
  }));

  res.json({ applications });
});

// GET /api/room/applications/sent — 내가 보낸 신청 목록
router.get('/applications/sent', verifyToken, async (req, res) => {
  const user_id = req.user.id;

  const { data, error } = await supabaseAdmin
    .from('sjj_room_apply')
    .select('id, status, message, created_at, responded_at, room_id, sjj_room!room_id(district, subway_stn, rent, maint_fee)')
    .eq('applicant_id', user_id)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ code: 'APPLY_LIST_FAILED', error: '신청 목록 조회에 실패했습니다. 잠시 후 다시 시도해주세요' });

  const applications = data.map(a => ({
    id: a.id,
    status: a.status,
    message: a.message,
    created_at: a.created_at,
    responded_at: a.responded_at,
    room_id: a.room_id,
    room_district: a.sjj_room?.district,
    room_subway_stn: a.sjj_room?.subway_stn,
  }));

  res.json({ applications });
});

// PATCH /api/room/applications/:applyId — 수락/거절 (집주인만)
router.patch('/applications/:applyId', verifyToken, async (req, res) => {
  const user_id = req.user.id;
  const { applyId } = req.params;
  const { status } = req.body;

  if (!['accepted', 'rejected'].includes(status)) {
    return res.status(400).json({ code: 'INVALID_STATUS', error: '필요한 정보를 모두 입력했는지 다시 확인해주세요' });
  }

  const { data: apply, error: fetchError } = await supabaseAdmin
    .from('sjj_room_apply')
    .select('id, room_id, applicant_id, status, sjj_room!room_id(id, user_id)')
    .eq('id', applyId)
    .single();

  if (fetchError || !apply) return res.status(404).json({ code: 'APPLY_NOT_FOUND', error: '신청 내역을 찾을 수 없습니다' });
  if (apply.sjj_room.user_id !== user_id) return res.status(403).json({ code: 'FORBIDDEN', error: '본인 공고의 신청만 처리할 수 있습니다' });
  if (apply.status !== 'pending') return res.status(400).json({ code: 'ALREADY_RESPONDED', error: '이미 처리된 신청입니다' });

  const { error: updateError } = await supabaseAdmin
    .from('sjj_room_apply')
    .update({ status, responded_at: new Date().toISOString() })
    .eq('id', applyId);

  if (updateError) return res.status(500).json({ code: 'APPLY_UPDATE_FAILED', error: '처리에 실패했습니다. 잠시 후 다시 시도해주세요' });

  if (status === 'rejected') {
    return res.json({ success: true, status: 'rejected' });
  }

  // 수락: 공고 비활성화 + 다른 대기중 신청 자동 거절 + 채팅방 생성
  await supabaseAdmin.from('sjj_room').update({ is_active: false }).eq('id', apply.room_id);
  await supabaseAdmin
    .from('sjj_room_apply')
    .update({ status: 'rejected', responded_at: new Date().toISOString() })
    .eq('room_id', apply.room_id)
    .eq('status', 'pending');

  const { data: chatRoom, error: chatError } = await supabaseAdmin
    .from('sjj_chat_room')
    .insert({ apply_id: apply.id, room_id: apply.room_id, owner_id: user_id, applicant_id: apply.applicant_id })
    .select('id')
    .single();

  if (chatError) {
    console.error('[applications/:applyId] 채팅방 생성 실패:', chatError.message);
    return res.status(500).json({ code: 'CHAT_ROOM_CREATE_FAILED', error: '처리에 실패했습니다. 잠시 후 다시 시도해주세요' });
  }

  res.json({ success: true, status: 'accepted', chat_room_id: chatRoom.id });
});

// POST /api/room/:id/apply — 살짝 신청하기
router.post('/:id/apply', verifyToken, async (req, res) => {
  const user_id = req.user.id;
  const { id: room_id } = req.params;
  const { message } = req.body;

  const { data: room, error: roomError } = await supabaseAdmin
    .from('sjj_room')
    .select('id, user_id, is_active')
    .eq('id', room_id)
    .single();

  if (roomError || !room) return res.status(404).json({ code: 'ROOM_NOT_FOUND', error: '공고를 찾을 수 없습니다' });
  if (!room.is_active) return res.status(400).json({ code: 'ROOM_NOT_ACTIVE', error: '이미 마감된 공고입니다' });
  if (room.user_id === user_id) return res.status(400).json({ code: 'SELF_APPLY_FORBIDDEN', error: '본인 공고에는 신청할 수 없습니다' });

  const { data: apply, error } = await supabaseAdmin
    .from('sjj_room_apply')
    .insert({ room_id, applicant_id: user_id, message })
    .select('id, status')
    .single();

  if (error) {
    if (error.code === '23505') {
      return res.status(400).json({ code: 'ALREADY_APPLIED', error: '이미 신청한 공고입니다' });
    }
    console.error('[room/apply] 실패:', error.message);
    return res.status(500).json({ code: 'APPLY_FAILED', error: '신청에 실패했습니다. 잠시 후 다시 시도해주세요' });
  }

  res.json({ success: true, apply_id: apply.id, status: apply.status });
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

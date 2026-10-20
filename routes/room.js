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

// 공고등록 리뉴얼(9_register_new_*) 이후: share_rent_type/share_maint_type 개별 방식 대신
// (월세+관리비) 합산에 단일 퍼센트(share_percent)를 적용하는 방식으로 교체됨
function calcShareTotalPercent(rent, maint_fee, share_percent) {
  if (share_percent == null) return null;
  const total = (rent || 0) + (maint_fee || 0);
  return Math.round(total * share_percent / 100);
}

// share_percent가 있으면 새 방식, 없으면(리뉴얼 이전 공고) 기존 share_rent_type/share_maint_type 방식으로 폴백
function resolveShareTotal(room) {
  if (room.share_percent != null) {
    return calcShareTotalPercent(room.rent, room.maint_fee, room.share_percent);
  }
  const share_rent = calcShare(room.rent, room.share_rent_type, room.share_rent_amount);
  const share_maint = calcShare(room.maint_fee, room.share_maint_type, room.share_maint_amount);
  return calcShareTotal(share_rent, share_maint, room.share_rent_type, room.share_maint_type);
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

// POST /api/room/register — 방 있는 사람 공고 등록 (9_register_new_* 리뉴얼 플로우 기준)
router.post('/register', verifyToken, async (req, res) => {
  const user_id = req.user.id;
  const {
    // 위치
    region, district, dong, road_address, detail_address, subway_stn, walk_min,
    // 공고 제목/소개
    title, bio,
    // 공간 정보
    house_type, house_type_input, shared_spaces,
    // 비용 정보
    rent, maint_fee, utility_separate, share_percent,
    recruit_count, move_in_type,
    private_room_count, furniture_included,
    // 생활 조건 (공고 단위)
    smoking_policy, drink_freq, pet_policy, activity_time, clean_importance, noise_lifestyle,
    // 원하는 동거인
    pref_gender, restrict_gender, pref_age_range, pref_job, pref_tags,
    // 동의
    profile_agree, location_agree, push_agree, marketing_agree,
    // 사진
    photo_public, photo_urls,
  } = req.body;
  console.log('[room/register] 요청 user_id:', user_id);

  if (profile_agree !== true) {
    return res.status(400).json({ code: 'MISSING_REQUIRED_FIELD', error: '필요한 정보를 모두 입력했는지 다시 확인해주세요', fields: ['profile_agree'] });
  }

  const { line: subway_line, canonicalName: canonicalSubwayStn } = await resolveSubwayLine(region, subway_stn);

  const { data: roomData, error: roomError } = await supabaseAdmin
    .from('sjj_room')
    .insert({
      user_id,
      region, district, dong, road_address, detail_address,
      subway_stn: canonicalSubwayStn, subway_line, walk_min,
      title, bio,
      house_type, house_type_input, shared_spaces,
      rent, maint_fee, utility_separate, share_percent,
      recruit_count, move_in_type,
      private_room_count, furniture_included,
      smoking_policy, drink_freq, pet_policy, activity_time, clean_importance, noise_lifestyle,
      pref_gender, restrict_gender, pref_age_range, pref_job, pref_tags,
      profile_agree, location_agree, push_agree, marketing_agree,
      photo_public,
      is_active: true,
    })
    .select('id')
    .single();

  if (roomError) {
    console.error('[room/register] room 실패:', roomError.message);
    return res.status(500).json({ code: 'ROOM_REGISTER_FAILED', error: '공고 등록에 실패했습니다. 잠시 후 다시 시도해주세요' });
  }

  if (Array.isArray(photo_urls) && photo_urls.length > 0) {
    const photoPrefix = `${process.env.SUPABASE_URL}/storage/v1/object/public/room-photos/`;
    const validUrls = photo_urls.filter(u => typeof u === 'string' && u.startsWith(photoPrefix));
    if (validUrls.length > 0) {
      const { error: photoError } = await supabaseAdmin
        .from('sjj_room_photo')
        .insert(validUrls.map((url, i) => ({ room_id: roomData.id, url, sort_order: i })));
      if (photoError) console.error('[room/register] 사진 저장 실패:', photoError.message);
    }
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

// 두 좌표 사이 직선거리 (미터, 하버사인 공식)
function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// 좌표를 가진 전체 역을 (지역+정규화명) 단위로 묶어서 반환 — 여러 호선 행을 역 하나로 합치는 용도
async function loadStationGroups() {
  const { data: stations, error } = await supabaseAdmin
    .from('sjj_subway_station')
    .select('region_cd, line_nm, station_nm, lat, lng')
    .not('lat', 'is', null);

  if (error) {
    console.error('[station groups] 조회 실패:', error.message);
    return null;
  }

  const groups = {};
  for (const s of stations) {
    const key = `${s.region_cd}|${normalizeStationName(s.station_nm)}`;
    if (!groups[key]) {
      groups[key] = {
        region: s.region_cd,
        name: s.station_nm.endsWith('역') ? s.station_nm : `${s.station_nm}역`,
        lat: s.lat, lng: s.lng,
        slugs: new Set(),
      };
    }
    groups[key].slugs.add(toSlug(s.line_nm.replace(/\s+/g, ' ').trim(), s.region_cd));
  }
  return groups;
}

// groups(loadStationGroups 결과) 중에서 좌표 기준 가장 가까운 역을 찾아 응답용 형태로 반환
function pickNearestStation(groups, lat, lng) {
  let nearest = null;
  for (const key in groups) {
    const g = groups[key];
    const dist = haversineMeters(lat, lng, g.lat, g.lng);
    if (!nearest || dist < nearest.distance_m) nearest = { ...g, distance_m: dist };
  }
  if (!nearest) return null;

  return {
    subway_stn: nearest.name,
    region: nearest.region,
    subway_line: sortLineSlugs(nearest.slugs),
    distance_m: Math.round(nearest.distance_m),
    walk_min: Math.max(1, Math.round(nearest.distance_m / 67)), // 분당 67m 평균 도보속도 가정 (직선거리 기준 추정치, 실제 경로와 다를 수 있음)
  };
}

// GET /api/room/address-search?q=테헤란로 123 — 주소를 입력받아 가까운 지하철역 + 도보시간을 자동계산 (주소 검색은 그 과정에서 거치는 수단, 가장 유력한 주소 1건만 사용)
router.get('/address-search', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ code: 'MISSING_REQUIRED_FIELD', error: '주소를 입력해주세요' });

  try {
    const kakaoRes = await fetch(
      `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(q)}&size=1`,
      { headers: { Authorization: `KakaoAK ${process.env.KAKAO_REST_API_KEY}` } }
    );
    const data = await kakaoRes.json();

    if (!kakaoRes.ok) {
      console.error('[room/address-search] 카카오 API 실패:', data);
      return res.status(500).json({ code: 'ADDRESS_SEARCH_FAILED', error: '주소 검색에 실패했습니다. 잠시 후 다시 시도해주세요' });
    }

    const best = (data.documents || [])[0];
    if (!best) return res.status(404).json({ code: 'ADDRESS_NOT_FOUND', error: '입력한 주소를 찾을 수 없어요' });

    const lat = Number(best.y);
    const lng = Number(best.x);
    const stationGroups = await loadStationGroups();
    const nearest = stationGroups ? pickNearestStation(stationGroups, lat, lng) : null;

    res.json({
      road_address: best.road_address?.address_name ?? null,
      subway_stn: nearest?.subway_stn ?? null,
      subway_line: nearest?.subway_line ?? [],
      distance_m: nearest?.distance_m ?? null,
      walk_min: nearest?.walk_min ?? null,
    });
  } catch (err) {
    console.error('[room/address-search] 실패:', err.message);
    res.status(500).json({ code: 'ADDRESS_SEARCH_FAILED', error: '주소 검색에 실패했습니다. 잠시 후 다시 시도해주세요' });
  }
});

// 조건필터(생활조건/동거인조건/비용) — 리뉴얼 이후 전부 sjj_room 컬럼이라 조인 없이 바로 필터링. list/count가 공유.
function applyRoomFilters(query, qp) {
  const {
    region, district, subway_stn, walk_min_max, house_type, pref_gender,
    smoking_policy, drink_freq, pet_policy, noise_lifestyle, clean_importance,
    pref_age_range, pref_job,
    rent_min, rent_max,
  } = qp;

  if (region) query = query.ilike('region', `${region}%`);
  if (district) query = query.ilike('district', `${district}%`);
  if (subway_stn) query = query.eq('subway_stn', subway_stn);
  // walk_min을 입력 안 한 공고(null)는 거리 필터를 걸면 항상 제외됨
  if (walk_min_max) query = query.lte('walk_min', Number(walk_min_max));
  if (house_type) query = query.eq('house_type', house_type);
  if (smoking_policy) query = query.eq('smoking_policy', smoking_policy);
  if (drink_freq) query = query.eq('drink_freq', drink_freq);
  if (pet_policy) query = query.eq('pet_policy', pet_policy);
  if (noise_lifestyle) query = query.eq('noise_lifestyle', noise_lifestyle);
  if (clean_importance) query = query.eq('clean_importance', clean_importance);
  // 성별 무관(any) 공고는 어떤 성별로 필터링해도 항상 포함
  if (pref_gender && pref_gender !== 'any') query = query.in('pref_gender', ['any', pref_gender]);
  // 등록자가 연령대/직업을 "상관없음"(null)으로 뒀으면 어떤 값으로 필터링해도 항상 포함
  if (pref_age_range) query = query.or(`pref_age_range.eq.${pref_age_range},pref_age_range.is.null`);
  if (pref_job) query = query.or(`pref_job.eq.${pref_job},pref_job.is.null`);
  if (rent_min) query = query.gte('rent', Number(rent_min));
  if (rent_max) query = query.lte('rent', Number(rent_max));

  return query;
}

// GET /api/room/list?region=서울&district=성북구&subway_stn=강남역&page=1&limit=7 — 인증 선택 (있으면 조회자 성별로 제한 공고 필터링)
router.get('/list', optionalAuth, async (req, res) => {
  const { page = 1, limit = 7 } = req.query;
  const safeLimit = Math.min(Number(limit) || 7, 50);
  const offset = (Number(page) - 1) * safeLimit;

  let query = supabaseAdmin
    .from('sjj_room')
    .select('id, user_id, region, district, dong, subway_stn, subway_line, walk_min, title, rent, maint_fee, utility_separate, share_percent, share_rent_type, share_rent_amount, share_maint_type, share_maint_amount, pref_gender, restrict_gender, house_type, recruit_count, move_in_type, smoking_policy, pet_policy, noise_lifestyle, clean_importance, pref_tags, photo_public, sjj_user!user_id(nick, gender, birth)', { count: 'exact' })
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .range(offset, offset + safeLimit - 1);

  query = applyRoomFilters(query, req.query);

  const { data, error, count } = await query;

  // PGRST103: 요청한 page가 실제 데이터 범위를 벗어남(필터 결과가 적을 때 자주 발생) — 에러 아니라 빈 목록으로 처리
  if (error?.code === 'PGRST103') {
    return res.json({ total: 0, page: Number(page), has_more: false, list: [] });
  }
  if (error) return res.status(500).json({ code: 'LIST_FETCH_FAILED', error: '목록 조회에 실패했습니다. 잠시 후 다시 시도해주세요' });

  const userIds = data.map(r => r.user_id);
  const roomIds = data.map(r => r.id);
  const { data: profs } = await supabaseAdmin
    .from('sjj_user_info')
    .select('user_id, job, pers_type')
    .in('user_id', userIds);

  const profMap = Object.fromEntries((profs || []).map(p => [p.user_id, p]));

  const { data: coverPhotos } = await supabaseAdmin
    .from('sjj_room_photo')
    .select('room_id, url, sort_order')
    .in('room_id', roomIds)
    .order('sort_order', { ascending: true });

  const coverMap = {};
  for (const p of coverPhotos || []) {
    if (!(p.room_id in coverMap)) coverMap[p.room_id] = p.url;
  }

  const list = data.map(r => {
    const user = r.sjj_user;
    const prof = profMap[r.user_id];
    return {
      id: r.id,
      nick: user?.nick,
      gender: user?.gender,
      age: calcAge(user?.birth),
      job: prof?.job,
      region: r.region,
      district: r.district,
      dong: r.dong,
      subway_stn: r.subway_stn,
      subway_line: parseSubwayLine(r.subway_line),
      walk_min: r.walk_min,
      title: r.title,
      pref_gender: r.pref_gender,
      share_total: resolveShareTotal(r),
      house_type: r.house_type,
      recruit_count: r.recruit_count,
      move_in_type: r.move_in_type,
      smoking_policy: r.smoking_policy,
      pet_policy: r.pet_policy,
      noise_lifestyle: r.noise_lifestyle,
      clean_importance: r.clean_importance,
      pref_tags: r.pref_tags || [],
      cover_photo: r.photo_public === false ? null : (coverMap[r.id] || null),
    };
  });

  res.json({
    total: count ?? data.length,
    page: Number(page),
    has_more: offset + data.length < (count ?? 0),
    list,
  });
});

// GET /api/room/count?region=서울&district=성북구&subway_stn=강남역 — 필터 적용 시 결과 개수만 조회 (필터 모달 미리보기용)
router.get('/count', async (req, res) => {
  let query = supabaseAdmin
    .from('sjj_room')
    .select('id', { count: 'exact', head: true })
    .eq('is_active', true);

  query = applyRoomFilters(query, req.query);

  const { count, error } = await query;
  if (error) return res.status(500).json({ code: 'COUNT_FAILED', error: '개수 조회에 실패했습니다. 잠시 후 다시 시도해주세요' });

  res.json({ total: count ?? 0 });
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

// 채팅 첫 진입 시 호스트 명의로 자동 삽입되는 고정 인사말
const CHAT_GREETING_TEMPLATE = '안녕하세요. 관심 주셔서 감사해요. 아직 함께 살 분을 찾고 있어요. 편하게 물어봐주세요 :)';

// 신청/수락/거절 시 채팅방에 남기는 말풍선 없는 시스템 로그 메시지
async function insertSystemMessage(chat_room_id, sender_id, content) {
  if (!chat_room_id) return;
  const { error } = await supabaseAdmin
    .from('sjj_chat_message')
    .insert({ chat_room_id, sender_id, content, type: 'system' });
  if (error) console.error('[system message] 삽입 실패:', error.message);
}

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

  const { data: thisChatRoom } = await supabaseAdmin
    .from('sjj_chat_room')
    .select('id')
    .eq('apply_id', apply.id)
    .maybeSingle();

  if (status === 'rejected') {
    await insertSystemMessage(thisChatRoom?.id, user_id, '아쉽지만 이번엔 함께하지 못하게 됐어요.');
    return res.json({ success: true, status: 'rejected' });
  }

  // 수락: 공고 비활성화 + 다른 대기중 신청 자동 거절 (채팅방은 이미 존재 — apply/inquire 시점에 생성·연결돼있음)
  await supabaseAdmin.from('sjj_room').update({ is_active: false }).eq('id', apply.room_id);

  // 자동 거절되는 다른 신청들 — update 전에 먼저 조회해서 각자의 채팅방에 거절 메시지를 남김
  const { data: otherPendingApplies } = await supabaseAdmin
    .from('sjj_room_apply')
    .select('id')
    .eq('room_id', apply.room_id)
    .eq('status', 'pending');

  if (otherPendingApplies && otherPendingApplies.length > 0) {
    const otherApplyIds = otherPendingApplies.map(a => a.id);
    const { data: otherChatRooms } = await supabaseAdmin
      .from('sjj_chat_room')
      .select('id, apply_id')
      .in('apply_id', otherApplyIds);

    await Promise.all(
      (otherChatRooms || []).map(cr => insertSystemMessage(cr.id, user_id, '아쉽지만 이번엔 함께하지 못하게 됐어요.'))
    );

    await supabaseAdmin
      .from('sjj_room_apply')
      .update({ status: 'rejected', responded_at: new Date().toISOString() })
      .in('id', otherApplyIds);
  }

  // 문의만 하고 신청은 안 한 사람들(apply_id가 null인 채팅방) — 이 사람들은 위 자동거절 대상이 아니라서 따로 안내
  const { data: inquireOnlyChatRooms } = await supabaseAdmin
    .from('sjj_chat_room')
    .select('id')
    .eq('room_id', apply.room_id)
    .is('apply_id', null);

  await Promise.all(
    (inquireOnlyChatRooms || []).map(cr => insertSystemMessage(cr.id, user_id, '이 공고는 다른 분과 매칭이 완료됐어요.'))
  );

  await insertSystemMessage(thisChatRoom?.id, user_id, '함께 살기로 매칭됐어요! 이제 상세 주소를 확인할 수 있어요.');

  res.json({ success: true, status: 'accepted', chat_room_id: thisChatRoom?.id ?? null });
});

// POST /api/room/:id/inquire — "문의하기". 신청 전에 먼저 채팅방을 열어줌 (이미 열려있으면 그 채팅방을 그대로 반환)
router.post('/:id/inquire', verifyToken, async (req, res) => {
  const user_id = req.user.id;
  const { id: room_id } = req.params;

  const { data: room, error: roomError } = await supabaseAdmin
    .from('sjj_room')
    .select('id, user_id, is_active')
    .eq('id', room_id)
    .single();

  if (roomError || !room) return res.status(404).json({ code: 'ROOM_NOT_FOUND', error: '공고를 찾을 수 없습니다' });
  if (!room.is_active) return res.status(400).json({ code: 'ROOM_NOT_ACTIVE', error: '이미 마감된 공고입니다' });
  if (room.user_id === user_id) return res.status(400).json({ code: 'SELF_INQUIRE_FORBIDDEN', error: '본인 공고에는 문의할 수 없습니다' });

  const { data: existing } = await supabaseAdmin
    .from('sjj_chat_room')
    .select('id')
    .eq('room_id', room_id)
    .eq('applicant_id', user_id)
    .maybeSingle();

  if (existing) {
    return res.json({ success: true, chat_room_id: existing.id });
  }

  const { data: chatRoom, error: chatError } = await supabaseAdmin
    .from('sjj_chat_room')
    .insert({ room_id, owner_id: room.user_id, applicant_id: user_id })
    .select('id')
    .single();

  if (chatError) {
    console.error('[room/inquire] 채팅방 생성 실패:', chatError.message);
    return res.status(500).json({ code: 'INQUIRE_FAILED', error: '문의에 실패했습니다. 잠시 후 다시 시도해주세요' });
  }

  await supabaseAdmin
    .from('sjj_chat_message')
    .insert({ chat_room_id: chatRoom.id, sender_id: room.user_id, content: CHAT_GREETING_TEMPLATE });

  res.json({ success: true, chat_room_id: chatRoom.id });
});

// POST /api/room/:id/apply — "함께 살기로 요청" (채팅방 안에서 호출). 채팅방이 없으면(문의 단계 건너뛴 경우) 방어적으로 새로 생성
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

  const { data: chatRoom } = await supabaseAdmin
    .from('sjj_chat_room')
    .select('id')
    .eq('room_id', room_id)
    .eq('applicant_id', user_id)
    .maybeSingle();

  let chat_room_id = chatRoom?.id ?? null;
  if (chatRoom) {
    await supabaseAdmin.from('sjj_chat_room').update({ apply_id: apply.id }).eq('id', chatRoom.id);
  } else {
    const { data: newChatRoom, error: chatError } = await supabaseAdmin
      .from('sjj_chat_room')
      .insert({ apply_id: apply.id, room_id, owner_id: room.user_id, applicant_id: user_id })
      .select('id')
      .single();
    if (chatError) console.error('[room/apply] 채팅방 연결 실패:', chatError.message);
    chat_room_id = newChatRoom?.id ?? null;
  }

  await insertSystemMessage(chat_room_id, user_id, '함께 살기를 요청했어요.');

  res.json({ success: true, apply_id: apply.id, status: apply.status, chat_room_id });
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

  const user = data.sjj_user;

  let photos = [];
  if (data.photo_public !== false) {
    const { data: photoRows } = await supabaseAdmin
      .from('sjj_room_photo')
      .select('url')
      .eq('room_id', data.id)
      .order('sort_order', { ascending: true });
    photos = (photoRows || []).map(p => p.url);
  }

  // 도로명주소/상세주소는 매칭 전까지 비공개 — 본인(호스트) 또는 수락된 신청자(sjj_chat_room)만 조회 가능
  let addressVisible = false;
  if (req.user) {
    if (req.user.id === data.user_id) {
      addressVisible = true;
    } else {
      const { data: chatRoom } = await supabaseAdmin
        .from('sjj_chat_room')
        .select('id')
        .eq('room_id', data.id)
        .eq('applicant_id', req.user.id)
        .maybeSingle();
      addressVisible = !!chatRoom;
    }
  }

  res.json({
    id: data.id,
    locked: false,
    nick: user?.nick,
    gender: user?.gender,
    age: calcAge(user?.birth),
    region: data.region,
    district: data.district,
    dong: data.dong,
    road_address: addressVisible ? data.road_address : null,
    detail_address: addressVisible ? data.detail_address : null,
    subway_stn: data.subway_stn,
    subway_line: parseSubwayLine(data.subway_line),
    walk_min: data.walk_min,
    title: data.title,
    bio: data.bio,
    rent: data.rent,
    maint_fee: data.maint_fee,
    utility_separate: data.utility_separate,
    share_percent: data.share_percent,
    share_total: resolveShareTotal(data),
    pref_gender: data.pref_gender,
    house_type: data.house_type,
    house_type_input: data.house_type_input,
    shared_spaces: data.shared_spaces || [],
    recruit_count: data.recruit_count,
    move_in_type: data.move_in_type,
    private_room_count: data.private_room_count,
    furniture_included: data.furniture_included,
    smoking_policy: data.smoking_policy,
    drink_freq: data.drink_freq,
    pet_policy: data.pet_policy,
    activity_time: data.activity_time,
    clean_importance: data.clean_importance,
    noise_lifestyle: data.noise_lifestyle,
    pref_age_range: data.pref_age_range,
    pref_job: data.pref_job,
    pref_tags: data.pref_tags || [],
    photo_public: data.photo_public,
    photos,
  });
});

// register에서 수정 가능한 필드 화이트리스트 (user_id/is_active/동의 필드 등은 수정 대상 아님)
const EDITABLE_ROOM_FIELDS = [
  'region', 'district', 'dong', 'road_address', 'detail_address', 'walk_min',
  'title', 'bio',
  'house_type', 'house_type_input', 'shared_spaces',
  'rent', 'maint_fee', 'utility_separate', 'share_percent',
  'recruit_count', 'move_in_type',
  'private_room_count', 'furniture_included',
  'smoking_policy', 'drink_freq', 'pet_policy', 'activity_time', 'clean_importance', 'noise_lifestyle',
  'pref_gender', 'restrict_gender', 'pref_age_range', 'pref_job', 'pref_tags',
  'photo_public',
];

// PATCH /api/room/:id — 공고 수정 (호스트 본인만, 매칭 완료 후엔 수정 불가)
router.patch('/:id', verifyToken, async (req, res) => {
  const user_id = req.user.id;
  const { id: room_id } = req.params;

  const { data: room, error: roomError } = await supabaseAdmin
    .from('sjj_room')
    .select('id, user_id, region, is_active')
    .eq('id', room_id)
    .single();

  if (roomError || !room) return res.status(404).json({ code: 'ROOM_NOT_FOUND', error: '공고를 찾을 수 없습니다' });
  if (room.user_id !== user_id) return res.status(403).json({ code: 'FORBIDDEN', error: '본인 공고만 수정할 수 있습니다' });
  if (!room.is_active) return res.status(400).json({ code: 'ROOM_EDIT_LOCKED', error: '이미 매칭이 완료된 공고는 수정할 수 없습니다' });

  const update = {};
  for (const field of EDITABLE_ROOM_FIELDS) {
    if (req.body[field] !== undefined) update[field] = req.body[field];
  }

  if (req.body.subway_stn !== undefined) {
    const region = update.region ?? room.region;
    const { line: subway_line, canonicalName: canonicalSubwayStn } = await resolveSubwayLine(region, req.body.subway_stn);
    update.subway_stn = canonicalSubwayStn;
    update.subway_line = subway_line;
  }

  if (Object.keys(update).length === 0) {
    return res.status(400).json({ code: 'MISSING_REQUIRED_FIELD', error: '수정할 내용이 없습니다' });
  }

  const { error: updateError } = await supabaseAdmin.from('sjj_room').update(update).eq('id', room_id);
  if (updateError) {
    console.error('[room/patch] 실패:', updateError.message);
    return res.status(500).json({ code: 'ROOM_UPDATE_FAILED', error: '공고 수정에 실패했습니다. 잠시 후 다시 시도해주세요' });
  }

  res.json({ success: true });
});

// POST /api/room/:id/photos — 사진 추가 (기존 사진 뒤에 이어붙임, 호스트 본인만)
router.post('/:id/photos', verifyToken, async (req, res) => {
  const user_id = req.user.id;
  const { id: room_id } = req.params;
  const { photo_urls } = req.body;

  if (!Array.isArray(photo_urls) || photo_urls.length === 0) {
    return res.status(400).json({ code: 'MISSING_REQUIRED_FIELD', error: '추가할 사진이 없습니다' });
  }

  const { data: room, error: roomError } = await supabaseAdmin
    .from('sjj_room')
    .select('id, user_id')
    .eq('id', room_id)
    .single();

  if (roomError || !room) return res.status(404).json({ code: 'ROOM_NOT_FOUND', error: '공고를 찾을 수 없습니다' });
  if (room.user_id !== user_id) return res.status(403).json({ code: 'FORBIDDEN', error: '본인 공고만 수정할 수 있습니다' });

  const photoPrefix = `${process.env.SUPABASE_URL}/storage/v1/object/public/room-photos/`;
  const validUrls = photo_urls.filter(u => typeof u === 'string' && u.startsWith(photoPrefix));
  if (validUrls.length === 0) {
    return res.status(400).json({ code: 'INVALID_PHOTO_URL', error: '올바른 사진 URL이 아닙니다' });
  }

  const { count: currentCount } = await supabaseAdmin
    .from('sjj_room_photo')
    .select('id', { count: 'exact', head: true })
    .eq('room_id', room_id);

  const { data: inserted, error: photoError } = await supabaseAdmin
    .from('sjj_room_photo')
    .insert(validUrls.map((url, i) => ({ room_id, url, sort_order: (currentCount || 0) + i })))
    .select('id, url, sort_order');

  if (photoError) {
    console.error('[room/photos] 추가 실패:', photoError.message);
    return res.status(500).json({ code: 'PHOTO_ADD_FAILED', error: '사진 추가에 실패했습니다. 잠시 후 다시 시도해주세요' });
  }

  res.json({ success: true, photos: inserted });
});

// DELETE /api/room/:id/photos/:photoId — 사진 1장 삭제 (호스트 본인만)
router.delete('/:id/photos/:photoId', verifyToken, async (req, res) => {
  const user_id = req.user.id;
  const { id: room_id, photoId } = req.params;

  const { data: room, error: roomError } = await supabaseAdmin
    .from('sjj_room')
    .select('id, user_id')
    .eq('id', room_id)
    .single();

  if (roomError || !room) return res.status(404).json({ code: 'ROOM_NOT_FOUND', error: '공고를 찾을 수 없습니다' });
  if (room.user_id !== user_id) return res.status(403).json({ code: 'FORBIDDEN', error: '본인 공고만 수정할 수 있습니다' });

  const { data: photo, error: photoFetchError } = await supabaseAdmin
    .from('sjj_room_photo')
    .select('id')
    .eq('id', photoId)
    .eq('room_id', room_id)
    .maybeSingle();

  if (photoFetchError || !photo) return res.status(404).json({ code: 'PHOTO_NOT_FOUND', error: '사진을 찾을 수 없습니다' });

  const { error: deleteError } = await supabaseAdmin.from('sjj_room_photo').delete().eq('id', photoId);
  if (deleteError) {
    console.error('[room/photos] 삭제 실패:', deleteError.message);
    return res.status(500).json({ code: 'PHOTO_DELETE_FAILED', error: '사진 삭제에 실패했습니다. 잠시 후 다시 시도해주세요' });
  }

  res.json({ success: true });
});

module.exports = router;

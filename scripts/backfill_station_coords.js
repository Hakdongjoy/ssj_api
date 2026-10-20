// 1회성 스크립트: sjj_subway_station의 (지역+역명) 고유 조합마다 카카오 키워드검색으로 좌표를 찾아서
// 같은 지역+역명을 가진 모든 행(여러 호선)에 동일 좌표를 채워넣는다.
// 실행: cd C:\claude\ssj && node scripts\backfill_station_coords.js
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 우리 region_cd(짧은 표기) -> 카카오가 돌려주는 region_1depth_name(공식 행정구역명) 매칭용
const REGION_MATCH = {
  '서울': ['서울'], '경기': ['경기'], '인천': ['인천'],
  '부산': ['부산'], '경남': ['경남', '경상남도'], '울산': ['울산'],
  '대구': ['대구'], '경북': ['경북', '경상북도'],
  '광주': ['광주'], '대전': ['대전'], '강원': ['강원'], '충남': ['충남', '충청남도'],
};

function normalizeStationName(name) {
  return name.replace(/["']/g, '').replace(/\(.*?\)/g, '').replace(/[·.\s]/g, '').replace(/역$/, '').trim();
}

async function searchStation(stationNm, regionCd) {
  const clean = normalizeStationName(stationNm); // "교대(법원.검찰청)" 같은 괄호 병기를 떼어내야 카카오 검색이 됨
  const query = `${clean}역`;
  const res = await fetch(`https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(query)}&size=15`, {
    headers: { Authorization: `KakaoAK ${process.env.KAKAO_REST_API_KEY}` },
  });
  const data = await res.json();
  if (!res.ok) {
    console.error(`  [${query}] 카카오 API 에러:`, data);
    return null;
  }

  const candidates = (data.documents || []).filter((d) => d.category_group_code === 'SW8');
  if (candidates.length === 0) return null;

  const regionTokens = REGION_MATCH[regionCd] || [regionCd];
  const matched = candidates.find((c) => regionTokens.some((t) => (c.address_name || '').includes(t)));
  const chosen = matched || candidates[0];

  return { lat: Number(chosen.y), lng: Number(chosen.x), matched: !!matched, place_name: chosen.place_name, address_name: chosen.address_name };
}

async function main() {
  const { data: rows, error } = await supabase.from('sjj_subway_station').select('id, station_nm, region_cd, lat');
  if (error) throw error;

  const groups = new Map(); // key: region_cd|normalizedName -> { station_nm, region_cd, ids: [], allFilled: bool }
  for (const r of rows) {
    const key = `${r.region_cd}|${normalizeStationName(r.station_nm)}`;
    if (!groups.has(key)) groups.set(key, { station_nm: r.station_nm, region_cd: r.region_cd, ids: [], filledCount: 0, total: 0 });
    const g = groups.get(key);
    g.ids.push(r.id);
    g.total++;
    if (r.lat != null) g.filledCount++;
  }
  // 이미 그룹 내 전체 행이 좌표를 가지고 있으면(이전 실행에서 처리됨) 건너뜀
  for (const [key, g] of [...groups]) {
    if (g.filledCount === g.total) groups.delete(key);
  }

  console.log(`고유 조합 ${groups.size}개, 전체 행 ${rows.length}개 업데이트 예정\n`);

  let success = 0, fallback = 0, failed = 0, i = 0;
  const failedList = [];

  for (const [key, g] of groups) {
    i++;
    const result = await searchStation(g.station_nm, g.region_cd);
    if (!result) {
      failed++;
      failedList.push(key);
      console.log(`[${i}/${groups.size}] ❌ ${key} — 검색결과 없음`);
    } else {
      const { error: updateError } = await supabase
        .from('sjj_subway_station')
        .update({ lat: result.lat, lng: result.lng })
        .in('id', g.ids);
      if (updateError) {
        failed++;
        failedList.push(key);
        console.log(`[${i}/${groups.size}] ❌ ${key} — DB 업데이트 실패: ${updateError.message}`);
      } else {
        if (result.matched) success++; else fallback++;
        const mark = result.matched ? '✅' : '⚠️ (지역불일치, fallback)';
        if (i % 50 === 0 || !result.matched) {
          console.log(`[${i}/${groups.size}] ${mark} ${key} -> ${result.place_name} (${result.lat}, ${result.lng})`);
        }
      }
    }
    await sleep(80); // 카카오 레이트리밋 여유
  }

  console.log(`\n완료: 지역일치 ${success} / fallback(지역불일치) ${fallback} / 실패 ${failed}`);
  if (failedList.length > 0) {
    console.log('실패 목록:', failedList.join(', '));
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

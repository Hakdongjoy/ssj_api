// 구글 클라우드 비전 세이프서치로 음란·폭력 사진 검사
// GOOGLE_VISION_API_KEY 미설정이거나 검사 호출이 실패하면 업로드를 막지 않고 통과시킴 (로그만 남김)
const VISION_URL = 'https://vision.googleapis.com/v1/images:annotate';
const LEVEL = { UNKNOWN: 0, VERY_UNLIKELY: 1, UNLIKELY: 2, POSSIBLE: 3, LIKELY: 4, VERY_LIKELY: 5 };

// 실내 사진(침실 등) 오탐을 줄이려고 선정성(racy)은 '매우 높음'일 때만 차단
function isInappropriate(s) {
  return LEVEL[s.adult] >= LEVEL.LIKELY
    || LEVEL[s.violence] >= LEVEL.LIKELY
    || LEVEL[s.racy] >= LEVEL.VERY_LIKELY;
}

// 부적절하면 true
async function isInappropriateImage(url) {
  const key = process.env.GOOGLE_VISION_API_KEY;
  if (!key) return false;

  try {
    const res = await fetch(`${VISION_URL}?key=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [{ image: { source: { imageUri: url } }, features: [{ type: 'SAFE_SEARCH_DETECTION' }] }],
      }),
    });
    const body = await res.json();
    const result = body.responses?.[0];
    if (!res.ok || result?.error || !result?.safeSearchAnnotation) {
      console.error('[moderation] 검사 실패:', res.status, JSON.stringify(result?.error || body.error || {}));
      return false;
    }
    return isInappropriate(result.safeSearchAnnotation);
  } catch (e) {
    console.error('[moderation] 검사 호출 오류:', e.message);
    return false;
  }
}

module.exports = { isInappropriateImage };

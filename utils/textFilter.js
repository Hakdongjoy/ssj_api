// 유저가 직접 입력하는 서술형 텍스트(닉네임/한마디/공고 제목·소개 등)에 공통으로 적용하는 금지어 필터

// 금지어: 운영진/서비스 사칭 + 욕설·비속어 + 성적 표현 + 사기/스팸성 단어 (일부만 예시로 등록, 필요시 추가)
const BANNED_WORDS = [
  // 운영진/공식 사칭
  '운영자', '운영진', '관리자', '매니저', '어드민', 'admin', 'administrator', 'moderator', '모더레이터',
  '시스템', '고객센터', '고객지원', '공식', 'official', '살짝', 'saljjak', '개발자', '개발팀', 'staff',
  // 욕설/비속어
  '시발', '씨발', '씨팔', '시팔', 'ㅅㅐㄱ', 'ㅅㅂ', 'ㅆㅂ', '개새끼', '개새', '새끼', '병신', 'ㅂㅅ',
  '지랄', '염병', '좆', '졷', '개같', '미친놈', '미친년', '싸가지', '씹', '존나', 'ㅈㄴ', '개년', '개놈',
  '걸레', '잡놈', '잡년', '썅', '씹년', '씹놈', '애미', '애비', '느금', '느검', '니미', '닥쳐',
  // 성적 표현
  '섹스', 'sex', 'fuck', 'shit', 'bitch', '포르노', 'porn', '19금', '성매매', '성인방송',
  // 기타 사기/스팸성
  '대출', '도박', '카지노', '토토', '보이스피싱',
];

// 채팅에서는 일상 대화에 자주 쓰여 오탐이 심한 서비스명은 제외
const CHAT_BANNED_WORDS = BANNED_WORDS.filter(w => w !== '살짝' && w !== 'saljjak');

// text 안에 금지어가 포함되어 있는지 검사 (대소문자 무시)
function containsBannedWord(text, words = BANNED_WORDS) {
  if (!text) return false;
  const lower = String(text).toLowerCase();
  return words.some(w => lower.includes(w.toLowerCase()));
}

// 채팅 메시지 전용 검사 (오탐 많은 단어 제외)
function containsBannedWordInChat(text) {
  return containsBannedWord(text, CHAT_BANNED_WORDS);
}

module.exports = { BANNED_WORDS, containsBannedWord, containsBannedWordInChat };

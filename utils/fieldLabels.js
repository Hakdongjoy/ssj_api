// 필드명 -> 사용자에게 보여줄 한글 라벨. MISSING_REQUIRED_FIELD 에러 메시지 조립에 사용
const FIELD_LABELS = {
  id: '아이디',
  password: '비밀번호',
  gender: '성별',
  birth: '생년월일',
  phone: '휴대폰 번호',
  carrier: '통신사',
  birth6: '생년월일',
  gender_code: '성별',
  code: '인증번호',
};

function missingFieldMessage(fields) {
  const labels = fields.map(f => FIELD_LABELS[f] || f);
  return `${labels.join(', ')}을(를) 입력해주세요`;
}

module.exports = missingFieldMessage;

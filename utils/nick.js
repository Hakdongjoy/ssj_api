const { supabaseAdmin } = require('../supabase');

const ADJ = ['향기로운','달콤한','귀여운','용감한','신비로운','행복한','졸린','배고픈','빠른','느긋한','차가운','따뜻한','반짝이는','조용한','시끄러운'];
const NOUN = ['반찬','고양이','강아지','토끼','감자','치킨','라면','두부','김치','사과','망고','오징어','햄버거','붕어빵','만두'];

// 형용사 + 명사 조합으로 유니크한 닉네임 생성 (예: "졸린감자", 중복 시 "졸린감자2")
async function generateNick() {
  const adj = ADJ[Math.floor(Math.random() * ADJ.length)];
  const noun = NOUN[Math.floor(Math.random() * NOUN.length)];
  const base = `${adj}${noun}`;

  const { data } = await supabaseAdmin
    .from('sjj_user')
    .select('nick')
    .ilike('nick', `${base}%`);

  const existing = new Set((data || []).map(r => r.nick));
  if (!existing.has(base)) return base;

  let n = 2;
  while (existing.has(`${base}${n}`)) n++;
  return `${base}${n}`;
}

// user_id에 유니크한 닉네임을 생성해서 저장 (충돌 시 최대 5회 재시도). extraFields는 nick과 함께 저장할 다른 컬럼
async function assignNick(user_id, extraFields = {}) {
  let nick, error;
  for (let attempt = 0; attempt < 5; attempt++) {
    nick = await generateNick();
    const { error: updateError } = await supabaseAdmin
      .from('sjj_user')
      .update({ nick, ...extraFields })
      .eq('id', user_id);
    error = updateError;
    if (!error || error.code !== '23505') break; // 닉네임 충돌(unique violation)이 아니면 재시도 불필요
    console.warn(`[assignNick] 닉네임 충돌, 재시도 (${attempt + 1}/5):`, nick);
  }
  return { nick, error };
}

module.exports = generateNick;
module.exports.generateNick = generateNick;
module.exports.assignNick = assignNick;

const { supabaseAdmin } = require('../supabase');

// 둘 중 누가 누구를 차단했든(양방향) 차단 관계가 있으면 true
async function isBlockedPair(idA, idB) {
  const { data } = await supabaseAdmin
    .from('sjj_block')
    .select('id')
    .or(`and(blocker_id.eq.${idA},blocked_id.eq.${idB}),and(blocker_id.eq.${idB},blocked_id.eq.${idA})`)
    .maybeSingle();
  return !!data;
}

// user_id와 양방향으로 차단 관계에 있는 상대방 id들 (목록/상세에서 숨기는 용도)
async function getBlockedUserIds(user_id) {
  const { data } = await supabaseAdmin
    .from('sjj_block')
    .select('blocker_id, blocked_id')
    .or(`blocker_id.eq.${user_id},blocked_id.eq.${user_id}`);
  if (!data) return [];
  return data.map(b => (b.blocker_id === user_id ? b.blocked_id : b.blocker_id));
}

module.exports = { isBlockedPair, getBlockedUserIds };

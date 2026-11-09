const express = require('express');
const router = express.Router();
const { supabaseAdmin } = require('../supabase');
const verifyToken = require('../middleware/auth');
const { isBlockedPair } = require('../utils/block');
const { containsBannedWordInChat } = require('../utils/textFilter');

const CHAT_ROOM_COLUMNS = 'id, owner_id, applicant_id, owner_last_read_at, applicant_last_read_at, owner_left_at, applicant_left_at';

// 요청자가 집주인/신청자 중 어느 쪽인지에 따라 읽음·나감 칼럼 이름
function sides(chatRoom, user_id) {
  const isOwner = chatRoom.owner_id === user_id;
  return {
    read: isOwner ? 'owner_last_read_at' : 'applicant_last_read_at',
    left: isOwner ? 'owner_left_at' : 'applicant_left_at',
    partnerRead: isOwner ? 'applicant_last_read_at' : 'owner_last_read_at',
    partnerLeft: isOwner ? 'applicant_left_at' : 'owner_left_at',
  };
}

async function markRead(chat_room_id, column) {
  const { error } = await supabaseAdmin.from('sjj_chat_room').update({ [column]: new Date().toISOString() }).eq('id', chat_room_id);
  if (error) console.error('[chat] 읽음 처리 실패:', error.message);
}

// GET /api/chat/rooms — 내 채팅방 목록 (집주인/신청자 양쪽 다)
router.get('/rooms', verifyToken, async (req, res) => {
  const user_id = req.user.id;

  const { data, error } = await supabaseAdmin
    .from('sjj_chat_room')
    .select('id, room_id, owner_id, applicant_id, apply_id, created_at, owner_last_read_at, applicant_last_read_at, owner_left_at, applicant_left_at, sjj_room!room_id(district, subway_stn), sjj_room_apply!apply_id(status)')
    .or(`and(owner_id.eq.${user_id},owner_left_at.is.null),and(applicant_id.eq.${user_id},applicant_left_at.is.null)`)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ code: 'CHAT_ROOM_LIST_FAILED', error: '채팅방 목록 조회에 실패했습니다. 잠시 후 다시 시도해주세요' });

  // 방마다 내가 마지막으로 읽은 시각 이후 상대가 보낸 메시지 수
  const unreadCounts = await Promise.all(data.map(r => {
    const myLastRead = r.owner_id === user_id ? r.owner_last_read_at : r.applicant_last_read_at;
    let q = supabaseAdmin
      .from('sjj_chat_message')
      .select('id', { count: 'exact', head: true })
      .eq('chat_room_id', r.id)
      .neq('sender_id', user_id);
    if (myLastRead) q = q.gt('created_at', myLastRead);
    return q.then(({ count }) => count || 0);
  }));

  const partnerIds = data.map(r => (r.owner_id === user_id ? r.applicant_id : r.owner_id));
  const { data: partners } = await supabaseAdmin.from('sjj_user').select('id, nick').in('id', partnerIds);
  const partnerMap = Object.fromEntries((partners || []).map(p => [p.id, p.nick]));

  const rooms = data.map((r, i) => ({
    chat_room_id: r.id,
    room_id: r.room_id,
    room_district: r.sjj_room?.district,
    room_subway_stn: r.sjj_room?.subway_stn,
    partner_nick: partnerMap[r.owner_id === user_id ? r.applicant_id : r.owner_id],
    is_owner: r.owner_id === user_id,
    apply_id: r.apply_id,
    apply_status: r.sjj_room_apply?.status ?? null, // null=아직 신청 전(문의만 함) / pending / accepted / rejected
    unread_count: unreadCounts[i],
    partner_left: !!(r.owner_id === user_id ? r.applicant_left_at : r.owner_left_at),
    created_at: r.created_at,
  }));

  res.json({ rooms });
});

// GET /api/chat/rooms/:chatRoomId/messages?after=ISO시각 — 메시지 조회 (폴링용)
router.get('/rooms/:chatRoomId/messages', verifyToken, async (req, res) => {
  const user_id = req.user.id;
  const { chatRoomId } = req.params;
  const { after } = req.query;

  const { data: chatRoom, error: roomError } = await supabaseAdmin
    .from('sjj_chat_room')
    .select(CHAT_ROOM_COLUMNS)
    .eq('id', chatRoomId)
    .single();

  if (roomError || !chatRoom) return res.status(404).json({ code: 'CHAT_ROOM_NOT_FOUND', error: '채팅방을 찾을 수 없습니다' });
  if (chatRoom.owner_id !== user_id && chatRoom.applicant_id !== user_id) {
    return res.status(403).json({ code: 'FORBIDDEN', error: '본인이 속한 채팅방만 조회할 수 있습니다' });
  }
  const me = sides(chatRoom, user_id);
  if (chatRoom[me.left]) return res.status(404).json({ code: 'CHAT_ROOM_NOT_FOUND', error: '채팅방을 찾을 수 없습니다' });

  let query = supabaseAdmin
    .from('sjj_chat_message')
    .select('id, sender_id, content, type, created_at')
    .eq('chat_room_id', chatRoomId)
    .order('created_at', { ascending: true });

  if (after) query = query.gt('created_at', after);

  const { data: messages, error } = await query;
  if (error) return res.status(500).json({ code: 'MESSAGE_LIST_FAILED', error: '메시지 조회에 실패했습니다. 잠시 후 다시 시도해주세요' });

  // 조회 = 읽음 처리 (채팅방 화면 폴링 중엔 계속 갱신됨)
  await markRead(chatRoom.id, me.read);

  res.json({
    messages,
    partner_last_read_at: chatRoom[me.partnerRead] ?? null, // 내가 보낸 메시지 중 이 시각보다 늦은 것 = 상대가 안 읽음("1")
    partner_left: !!chatRoom[me.partnerLeft],
  });
});

// POST /api/chat/rooms/:chatRoomId/messages — 메시지 전송
router.post('/rooms/:chatRoomId/messages', verifyToken, async (req, res) => {
  const user_id = req.user.id;
  const { chatRoomId } = req.params;
  const { content } = req.body;

  if (!content || !content.trim()) {
    return res.status(400).json({ code: 'MISSING_REQUIRED_FIELD', error: '필요한 정보를 모두 입력했는지 다시 확인해주세요' });
  }

  if (containsBannedWordInChat(content)) {
    return res.status(400).json({ code: 'INVALID_CONTENT', error: '사용할 수 없는 표현이 포함되어 있습니다' });
  }

  const { data: chatRoom, error: roomError } = await supabaseAdmin
    .from('sjj_chat_room')
    .select(CHAT_ROOM_COLUMNS)
    .eq('id', chatRoomId)
    .single();

  if (roomError || !chatRoom) return res.status(404).json({ code: 'CHAT_ROOM_NOT_FOUND', error: '채팅방을 찾을 수 없습니다' });
  if (chatRoom.owner_id !== user_id && chatRoom.applicant_id !== user_id) {
    return res.status(403).json({ code: 'FORBIDDEN', error: '본인이 속한 채팅방만 이용할 수 있습니다' });
  }
  const me = sides(chatRoom, user_id);
  if (chatRoom[me.left]) return res.status(404).json({ code: 'CHAT_ROOM_NOT_FOUND', error: '채팅방을 찾을 수 없습니다' });
  if (chatRoom[me.partnerLeft]) {
    return res.status(403).json({ code: 'CHAT_ROOM_CLOSED', error: '상대방이 나간 채팅방에는 메시지를 보낼 수 없습니다' });
  }

  const partnerId = chatRoom.owner_id === user_id ? chatRoom.applicant_id : chatRoom.owner_id;
  if (await isBlockedPair(user_id, partnerId)) {
    return res.status(403).json({ code: 'BLOCKED', error: '메시지를 보낼 수 없습니다' });
  }

  const { data: message, error } = await supabaseAdmin
    .from('sjj_chat_message')
    .insert({ chat_room_id: chatRoomId, sender_id: user_id, content: content.trim() })
    .select('id, sender_id, content, type, created_at')
    .single();

  if (error) {
    console.error('[chat/messages] 전송 실패:', error.message);
    return res.status(500).json({ code: 'MESSAGE_SEND_FAILED', error: '메시지 전송에 실패했습니다. 잠시 후 다시 시도해주세요' });
  }

  await markRead(chatRoom.id, me.read);

  res.json({ message });
});

// DELETE /api/chat/rooms/:chatRoomId — 채팅방 나가기 (내 목록에서만 사라짐)
// 상대 방엔 시스템 메시지가 남고 이후 전송 불가. 둘 다 나가면 실제 삭제. 대기중인 함께 살기 요청은 자동 취소
router.delete('/rooms/:chatRoomId', verifyToken, async (req, res) => {
  const user_id = req.user.id;
  const { chatRoomId } = req.params;

  const { data: chatRoom, error: roomError } = await supabaseAdmin
    .from('sjj_chat_room')
    .select(CHAT_ROOM_COLUMNS + ', apply_id')
    .eq('id', chatRoomId)
    .single();

  if (roomError || !chatRoom) return res.status(404).json({ code: 'CHAT_ROOM_NOT_FOUND', error: '채팅방을 찾을 수 없습니다' });
  if (chatRoom.owner_id !== user_id && chatRoom.applicant_id !== user_id) {
    return res.status(403).json({ code: 'FORBIDDEN', error: '본인이 속한 채팅방만 나갈 수 있습니다' });
  }
  const me = sides(chatRoom, user_id);
  if (chatRoom[me.left]) return res.status(404).json({ code: 'CHAT_ROOM_NOT_FOUND', error: '채팅방을 찾을 수 없습니다' });

  // 대기중 신청 자동 취소 (수락/거절된 신청은 기록으로 남김)
  if (chatRoom.apply_id) {
    const { data: apply } = await supabaseAdmin.from('sjj_room_apply').select('id, status').eq('id', chatRoom.apply_id).maybeSingle();
    if (apply?.status === 'pending') {
      await supabaseAdmin.from('sjj_chat_room').update({ apply_id: null }).eq('id', chatRoom.id);
      await supabaseAdmin.from('sjj_room_apply').delete().eq('id', apply.id).eq('status', 'pending');
    }
  }

  // 상대가 이미 나갔으면 실제 삭제
  if (chatRoom[me.partnerLeft]) {
    await supabaseAdmin.from('sjj_chat_message').delete().eq('chat_room_id', chatRoom.id);
    const { error } = await supabaseAdmin.from('sjj_chat_room').delete().eq('id', chatRoom.id);
    if (error) {
      console.error('[chat/leave] 삭제 실패:', error.message);
      return res.status(500).json({ code: 'CHAT_LEAVE_FAILED', error: '채팅방 나가기에 실패했습니다. 잠시 후 다시 시도해주세요' });
    }
    return res.json({ success: true });
  }

  const { error } = await supabaseAdmin.from('sjj_chat_room').update({ [me.left]: new Date().toISOString() }).eq('id', chatRoom.id);
  if (error) {
    console.error('[chat/leave] 실패:', error.message);
    return res.status(500).json({ code: 'CHAT_LEAVE_FAILED', error: '채팅방 나가기에 실패했습니다. 잠시 후 다시 시도해주세요' });
  }
  await supabaseAdmin
    .from('sjj_chat_message')
    .insert({ chat_room_id: chatRoom.id, sender_id: user_id, content: '상대방이 채팅방을 나갔어요.', type: 'system' });

  res.json({ success: true });
});

module.exports = router;

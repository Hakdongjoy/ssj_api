const express = require('express');
const router = express.Router();
const { supabaseAdmin } = require('../supabase');
const verifyToken = require('../middleware/auth');

// GET /api/chat/rooms — 내 채팅방 목록 (집주인/신청자 양쪽 다)
router.get('/rooms', verifyToken, async (req, res) => {
  const user_id = req.user.id;

  const { data, error } = await supabaseAdmin
    .from('sjj_chat_room')
    .select('id, room_id, owner_id, applicant_id, created_at, sjj_room!room_id(district, subway_stn)')
    .or(`owner_id.eq.${user_id},applicant_id.eq.${user_id}`)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ code: 'CHAT_ROOM_LIST_FAILED', error: '채팅방 목록 조회에 실패했습니다. 잠시 후 다시 시도해주세요' });

  const partnerIds = data.map(r => (r.owner_id === user_id ? r.applicant_id : r.owner_id));
  const { data: partners } = await supabaseAdmin.from('sjj_user').select('id, nick').in('id', partnerIds);
  const partnerMap = Object.fromEntries((partners || []).map(p => [p.id, p.nick]));

  const rooms = data.map(r => ({
    chat_room_id: r.id,
    room_id: r.room_id,
    room_district: r.sjj_room?.district,
    room_subway_stn: r.sjj_room?.subway_stn,
    partner_nick: partnerMap[r.owner_id === user_id ? r.applicant_id : r.owner_id],
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
    .select('id, owner_id, applicant_id')
    .eq('id', chatRoomId)
    .single();

  if (roomError || !chatRoom) return res.status(404).json({ code: 'CHAT_ROOM_NOT_FOUND', error: '채팅방을 찾을 수 없습니다' });
  if (chatRoom.owner_id !== user_id && chatRoom.applicant_id !== user_id) {
    return res.status(403).json({ code: 'FORBIDDEN', error: '본인이 속한 채팅방만 조회할 수 있습니다' });
  }

  let query = supabaseAdmin
    .from('sjj_chat_message')
    .select('id, sender_id, content, created_at')
    .eq('chat_room_id', chatRoomId)
    .order('created_at', { ascending: true });

  if (after) query = query.gt('created_at', after);

  const { data: messages, error } = await query;
  if (error) return res.status(500).json({ code: 'MESSAGE_LIST_FAILED', error: '메시지 조회에 실패했습니다. 잠시 후 다시 시도해주세요' });

  res.json({ messages });
});

// POST /api/chat/rooms/:chatRoomId/messages — 메시지 전송
router.post('/rooms/:chatRoomId/messages', verifyToken, async (req, res) => {
  const user_id = req.user.id;
  const { chatRoomId } = req.params;
  const { content } = req.body;

  if (!content || !content.trim()) {
    return res.status(400).json({ code: 'MISSING_REQUIRED_FIELD', error: '필요한 정보를 모두 입력했는지 다시 확인해주세요' });
  }

  const { data: chatRoom, error: roomError } = await supabaseAdmin
    .from('sjj_chat_room')
    .select('id, owner_id, applicant_id')
    .eq('id', chatRoomId)
    .single();

  if (roomError || !chatRoom) return res.status(404).json({ code: 'CHAT_ROOM_NOT_FOUND', error: '채팅방을 찾을 수 없습니다' });
  if (chatRoom.owner_id !== user_id && chatRoom.applicant_id !== user_id) {
    return res.status(403).json({ code: 'FORBIDDEN', error: '본인이 속한 채팅방만 이용할 수 있습니다' });
  }

  const { data: message, error } = await supabaseAdmin
    .from('sjj_chat_message')
    .insert({ chat_room_id: chatRoomId, sender_id: user_id, content: content.trim() })
    .select('id, sender_id, content, created_at')
    .single();

  if (error) {
    console.error('[chat/messages] 전송 실패:', error.message);
    return res.status(500).json({ code: 'MESSAGE_SEND_FAILED', error: '메시지 전송에 실패했습니다. 잠시 후 다시 시도해주세요' });
  }

  res.json({ message });
});

module.exports = router;

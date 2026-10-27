const express = require('express');
const router = express.Router();
const { supabaseAdmin } = require('../supabase');
const { verifyToken, verifyAdmin } = require('../middleware/auth');

router.use(verifyToken, verifyAdmin);

// GET /api/admin/users?q=&page=&limit= — 유저 검색/목록
router.get('/users', async (req, res) => {
  const { q, page = 1, limit = 20 } = req.query;
  const safeLimit = Math.min(Number(limit) || 20, 100);
  const offset = (Number(page) - 1) * safeLimit;

  let query = supabaseAdmin
    .from('sjj_user')
    .select('id, login_id, nick, gender, birth, phone, is_admin, deleted_at, created_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + safeLimit - 1);

  if (q) query = query.or(`login_id.ilike.%${q}%,nick.ilike.%${q}%,phone.ilike.%${q}%`);

  const { data, error, count } = await query;
  if (error) {
    console.error('[admin/users] 조회 실패:', error.message);
    return res.status(500).json({ code: 'ADMIN_USER_LIST_FAILED', error: '유저 목록 조회에 실패했습니다' });
  }

  res.json({ total: count ?? data.length, page: Number(page), users: data });
});

// PATCH /api/admin/users/:id/ban — 유저 영구 정지 (로그인 차단, 행은 유지)
router.patch('/users/:id/ban', async (req, res) => {
  const { id } = req.params;
  const { error } = await supabaseAdmin.auth.admin.updateUserById(id, { ban_duration: '876000h' });
  if (error) {
    console.error('[admin/users/ban] 실패:', error.message);
    return res.status(500).json({ code: 'ADMIN_BAN_FAILED', error: '유저 정지에 실패했습니다' });
  }
  res.json({ success: true });
});

// PATCH /api/admin/users/:id/unban — 정지 해제
router.patch('/users/:id/unban', async (req, res) => {
  const { id } = req.params;
  const { error } = await supabaseAdmin.auth.admin.updateUserById(id, { ban_duration: 'none' });
  if (error) {
    console.error('[admin/users/unban] 실패:', error.message);
    return res.status(500).json({ code: 'ADMIN_UNBAN_FAILED', error: '정지 해제에 실패했습니다' });
  }
  res.json({ success: true });
});

// GET /api/admin/rooms?q=&is_active=&page=&limit= — 공고 전체 조회 (비활성 포함)
router.get('/rooms', async (req, res) => {
  const { q, is_active, page = 1, limit = 20 } = req.query;
  const safeLimit = Math.min(Number(limit) || 20, 100);
  const offset = (Number(page) - 1) * safeLimit;

  let query = supabaseAdmin
    .from('sjj_room')
    .select('id, user_id, title, region, district, rent, is_active, created_at, sjj_user!user_id(nick)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + safeLimit - 1);

  if (q) query = query.ilike('title', `%${q}%`);
  if (is_active === 'true') query = query.eq('is_active', true);
  if (is_active === 'false') query = query.eq('is_active', false);

  const { data, error, count } = await query;
  if (error) {
    console.error('[admin/rooms] 조회 실패:', error.message);
    return res.status(500).json({ code: 'ADMIN_ROOM_LIST_FAILED', error: '공고 목록 조회에 실패했습니다' });
  }

  const rooms = data.map(r => ({
    id: r.id, user_id: r.user_id, host_nick: r.sjj_user?.nick,
    title: r.title, region: r.region, district: r.district, rent: r.rent,
    is_active: r.is_active, created_at: r.created_at,
  }));

  res.json({ total: count ?? rooms.length, page: Number(page), rooms });
});

// PATCH /api/admin/rooms/:id/deactivate — 공고 강제 비활성화
router.patch('/rooms/:id/deactivate', async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabaseAdmin.from('sjj_room').update({ is_active: false }).eq('id', id).select('id').maybeSingle();
  if (error) {
    console.error('[admin/rooms/deactivate] 실패:', error.message);
    return res.status(500).json({ code: 'ADMIN_ROOM_DEACTIVATE_FAILED', error: '공고 비활성화에 실패했습니다' });
  }
  if (!data) return res.status(404).json({ code: 'ROOM_NOT_FOUND', error: '공고를 찾을 수 없습니다' });
  res.json({ success: true });
});

// GET /api/admin/stats — 전체 현황 요약
router.get('/stats', async (req, res) => {
  const [users, activeUsers, rooms, activeRooms, applies, chatRooms] = await Promise.all([
    supabaseAdmin.from('sjj_user').select('id', { count: 'exact', head: true }),
    supabaseAdmin.from('sjj_user').select('id', { count: 'exact', head: true }).is('deleted_at', null),
    supabaseAdmin.from('sjj_room').select('id', { count: 'exact', head: true }),
    supabaseAdmin.from('sjj_room').select('id', { count: 'exact', head: true }).eq('is_active', true),
    supabaseAdmin.from('sjj_room_apply').select('id', { count: 'exact', head: true }),
    supabaseAdmin.from('sjj_chat_room').select('id', { count: 'exact', head: true }),
  ]);

  res.json({
    total_users: users.count ?? 0,
    active_users: activeUsers.count ?? 0,
    total_rooms: rooms.count ?? 0,
    active_rooms: activeRooms.count ?? 0,
    total_applies: applies.count ?? 0,
    total_chat_rooms: chatRooms.count ?? 0,
  });
});

// GET /api/admin/reports?page=&limit= — 신고 목록 (자동조치 없음, 수동 검토용)
router.get('/reports', async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const safeLimit = Math.min(Number(limit) || 20, 100);
  const offset = (Number(page) - 1) * safeLimit;

  const { data, error, count } = await supabaseAdmin
    .from('sjj_report')
    .select('id, reporter_id, target_user_id, room_id, chat_room_id, reason, detail, created_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + safeLimit - 1);

  if (error) {
    console.error('[admin/reports] 조회 실패:', error.message);
    return res.status(500).json({ code: 'ADMIN_REPORT_LIST_FAILED', error: '신고 목록 조회에 실패했습니다' });
  }

  const userIds = [...new Set(data.flatMap(r => [r.reporter_id, r.target_user_id]))];
  const { data: users } = await supabaseAdmin.from('sjj_user').select('id, nick').in('id', userIds);
  const nickMap = Object.fromEntries((users || []).map(u => [u.id, u.nick]));

  const reports = data.map(r => ({
    id: r.id,
    reporter_id: r.reporter_id, reporter_nick: nickMap[r.reporter_id],
    target_user_id: r.target_user_id, target_nick: nickMap[r.target_user_id],
    room_id: r.room_id, chat_room_id: r.chat_room_id,
    reason: r.reason, detail: r.detail, created_at: r.created_at,
  }));

  res.json({ total: count ?? reports.length, page: Number(page), reports });
});

module.exports = router;

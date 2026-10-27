const express = require('express');
const router = express.Router();
const { supabaseAdmin } = require('../supabase');
const verifyToken = require('../middleware/auth');
const generateNick = require('../utils/nick');

// GET /api/user/nick/random — 인증 불필요
router.get('/nick/random', async (req, res) => {
  const nick = await generateNick();
  res.json({ nick });
});

// PATCH /api/user/nick
router.patch('/nick', verifyToken, async (req, res) => {
  const user_id = req.user.id;
  const { nick } = req.body;

  if (!nick || nick.trim().length === 0) {
    return res.status(400).json({ code: 'INVALID_NICK', error: '필요한 정보를 모두 입력했는지 다시 확인해주세요' });
  }

  const { error } = await supabaseAdmin.from('sjj_user').update({ nick: nick.trim() }).eq('id', user_id);
  if (error) {
    console.error('[nick] 업데이트 실패:', error.message);
    return res.status(500).json({ code: 'NICK_UPDATE_FAILED', error: '닉네임 저장에 실패했습니다. 잠시 후 다시 시도해주세요' });
  }

  res.json({ success: true, nick: nick.trim() });
});

// POST /api/user/pref — 방 없는 사람 희망조건
router.post('/pref', verifyToken, async (req, res) => {
  const user_id = req.user.id;
  const {
    // 희망 지역 + 한마디 + 동의 (sjj_room_pref)
    region, district, subway_stn,
    bio,
    profile_agree, location_agree, push_agree, marketing_agree,
    // 추가정보 (sjj_user_info)
    job, job_input, is_remote,
    sleep_hour, wake_hour,
    pers_type, home_time, clean_freq, drink_freq,
    smoking, pet, pet_type, pet_type_input, pet_name, pet_memo,
  } = req.body;
  console.log('[pref] 요청 user_id:', user_id);

  if (profile_agree !== true) {
    return res.status(400).json({ code: 'MISSING_REQUIRED_FIELD', error: '필요한 정보를 모두 입력했는지 다시 확인해주세요', fields: ['profile_agree'] });
  }

  const { error: profError } = await supabaseAdmin
    .from('sjj_user_info')
    .upsert({
      user_id,
      job, job_input, is_remote,
      sleep_hour, wake_hour,
      pers_type, home_time, clean_freq, drink_freq,
      smoking, pet, pet_type, pet_type_input, pet_name, pet_memo,
    }, { onConflict: 'user_id' });

  if (profError) {
    console.error('[pref] prof 실패:', profError.message);
    return res.status(500).json({ code: 'PROF_SAVE_FAILED', error: '저장에 실패했습니다. 잠시 후 다시 시도해주세요' });
  }

  const { error: prefError } = await supabaseAdmin
    .from('sjj_room_pref')
    .upsert({
      user_id,
      region, district, subway_stn,
      bio,
      profile_agree, location_agree, push_agree, marketing_agree,
    }, { onConflict: 'user_id' });

  if (prefError) {
    console.error('[pref] pref 실패:', prefError.message);
    return res.status(500).json({ code: 'PREF_SAVE_FAILED', error: '저장에 실패했습니다. 잠시 후 다시 시도해주세요' });
  }

  console.log('[pref] 완료');
  res.json({ success: true });
});

// DELETE /api/user/me — 회원 탈퇴 (소프트 삭제/익명화)
// 주의: sjj_user.id가 auth.users를 FK로 참조하며 on delete cascade가 걸려있어서,
// auth 계정을 먼저 삭제(deleteUser)하면 sjj_user 행 자체가 같이 사라져 익명화가 무의미해짐.
// 그래서 auth 계정은 "삭제"가 아니라 "영구 정지(ban)"로 처리 — 로그인만 막고 행은 그대로 둠.
router.delete('/me', verifyToken, async (req, res) => {
  const user_id = req.user.id;

  // 1. sjj_user 익명화 (행은 유지) — auth 쪽보다 먼저 처리해서 혹시 모를 레이스 방지
  const { error: userError } = await supabaseAdmin
    .from('sjj_user')
    .update({ nick: '탈퇴한 사용자', phone: null, deleted_at: new Date().toISOString() })
    .eq('id', user_id);
  if (userError) {
    console.error('[withdraw] sjj_user 익명화 실패:', userError.message);
  }

  // 2. 이 유저가 올린 활성 공고 비활성화
  const { error: roomError } = await supabaseAdmin
    .from('sjj_room')
    .update({ is_active: false })
    .eq('user_id', user_id)
    .eq('is_active', true);
  if (roomError) {
    console.error('[withdraw] sjj_room 비활성화 실패:', roomError.message);
  }

  // 3. 개인 프로필 데이터 삭제
  const { error: infoError } = await supabaseAdmin.from('sjj_user_info').delete().eq('user_id', user_id);
  if (infoError) {
    console.error('[withdraw] sjj_user_info 삭제 실패:', infoError.message);
  }

  const { error: prefError } = await supabaseAdmin.from('sjj_room_pref').delete().eq('user_id', user_id);
  if (prefError) {
    console.error('[withdraw] sjj_room_pref 삭제 실패:', prefError.message);
  }

  // 4. sjj_room_apply, sjj_chat_room, sjj_chat_message는 그대로 유지 (상대방 기록 보존)

  // 5. Auth 계정은 삭제 대신 영구 정지 — 실패 시에만 500 (로그인 차단 자체가 안 되면 탈퇴 실패로 취급)
  const { error: banError } = await supabaseAdmin.auth.admin.updateUserById(user_id, { ban_duration: '876000h' });
  if (banError) {
    console.error('[withdraw] auth 계정 정지 실패:', banError.message);
    return res.status(500).json({ code: 'WITHDRAW_FAILED', error: '회원 탈퇴에 실패했습니다. 잠시 후 다시 시도해주세요' });
  }

  res.json({ success: true });
});

// POST /api/user/block/:userId — 유저 차단
router.post('/block/:userId', verifyToken, async (req, res) => {
  const blocker_id = req.user.id;
  const { userId: blocked_id } = req.params;

  if (blocker_id === blocked_id) {
    return res.status(400).json({ code: 'SELF_BLOCK_FORBIDDEN', error: '본인을 차단할 수 없습니다' });
  }

  const { error } = await supabaseAdmin
    .from('sjj_block')
    .upsert({ blocker_id, blocked_id }, { onConflict: 'blocker_id,blocked_id' });

  if (error) {
    console.error('[block] 실패:', error.message);
    return res.status(500).json({ code: 'BLOCK_FAILED', error: '차단에 실패했습니다. 잠시 후 다시 시도해주세요' });
  }

  res.json({ success: true });
});

// DELETE /api/user/block/:userId — 차단 해제
router.delete('/block/:userId', verifyToken, async (req, res) => {
  const blocker_id = req.user.id;
  const { userId: blocked_id } = req.params;

  const { error } = await supabaseAdmin
    .from('sjj_block')
    .delete()
    .eq('blocker_id', blocker_id)
    .eq('blocked_id', blocked_id);

  if (error) {
    console.error('[unblock] 실패:', error.message);
    return res.status(500).json({ code: 'UNBLOCK_FAILED', error: '차단 해제에 실패했습니다. 잠시 후 다시 시도해주세요' });
  }

  res.json({ success: true });
});

// GET /api/user/blocks — 내가 차단한 유저 목록
router.get('/blocks', verifyToken, async (req, res) => {
  const blocker_id = req.user.id;

  const { data, error } = await supabaseAdmin
    .from('sjj_block')
    .select('blocked_id, created_at')
    .eq('blocker_id', blocker_id)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[blocks] 조회 실패:', error.message);
    return res.status(500).json({ code: 'BLOCK_LIST_FAILED', error: '차단 목록 조회에 실패했습니다. 잠시 후 다시 시도해주세요' });
  }

  const { data: users } = await supabaseAdmin.from('sjj_user').select('id, nick').in('id', data.map(b => b.blocked_id));
  const nickMap = Object.fromEntries((users || []).map(u => [u.id, u.nick]));

  res.json({ blocks: data.map(b => ({ user_id: b.blocked_id, nick: nickMap[b.blocked_id], created_at: b.created_at })) });
});

module.exports = router;

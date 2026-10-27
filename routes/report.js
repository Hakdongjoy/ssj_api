const express = require('express');
const router = express.Router();
const { supabaseAdmin } = require('../supabase');
const verifyToken = require('../middleware/auth');

const REPORT_REASONS = ['사기의심', '욕설비방', '음란물', '스팸광고', '기타'];

// POST /api/report — 유저 신고 (자동 조치 없음, 관리자 검토용으로 적재만)
router.post('/', verifyToken, async (req, res) => {
  const reporter_id = req.user.id;
  const { target_user_id, reason, detail, room_id, chat_room_id } = req.body;

  if (!target_user_id || !reason) {
    return res.status(400).json({ code: 'MISSING_REQUIRED_FIELD', error: '필요한 정보를 모두 입력했는지 다시 확인해주세요', fields: ['target_user_id', 'reason'].filter(f => !req.body[f]) });
  }
  if (target_user_id === reporter_id) {
    return res.status(400).json({ code: 'SELF_REPORT_FORBIDDEN', error: '본인을 신고할 수 없습니다' });
  }
  if (!REPORT_REASONS.includes(reason)) {
    return res.status(400).json({ code: 'INVALID_REASON', error: '신고 사유가 올바르지 않습니다' });
  }

  const { data, error } = await supabaseAdmin
    .from('sjj_report')
    .insert({ reporter_id, target_user_id, reason, detail, room_id: room_id || null, chat_room_id: chat_room_id || null })
    .select('id')
    .single();

  if (error) {
    console.error('[report] 실패:', error.message);
    return res.status(500).json({ code: 'REPORT_FAILED', error: '신고 접수에 실패했습니다. 잠시 후 다시 시도해주세요' });
  }

  res.json({ success: true, report_id: data.id });
});

module.exports = router;

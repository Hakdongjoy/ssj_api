const express = require('express');
const router = express.Router();
const { supabaseAdmin } = require('../supabase');
const { removeStorageObjects } = require('../utils/storage');

const TMP_PHOTO_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// POST /api/cron/photos/cleanup-tmp — 7일 지난 임시 사진(파일+행) 정리
// 외부 무료 cron 서비스(cron-job.org 등)가 주기적으로 호출. 로그인 세션이 아니라 CRON_SECRET 헤더로만 인증.
router.post('/photos/cleanup-tmp', async (req, res) => {
  if (!process.env.CRON_SECRET || req.headers['x-cron-secret'] !== process.env.CRON_SECRET) {
    return res.status(403).json({ code: 'FORBIDDEN', error: '권한이 없습니다' });
  }

  const cutoff = new Date(Date.now() - TMP_PHOTO_TTL_MS).toISOString();
  const { data: stale, error } = await supabaseAdmin
    .from('sjj_room_photo_tmp')
    .select('id, url')
    .lt('created_at', cutoff);

  if (error) {
    console.error('[cron/cleanup-tmp] 조회 실패:', error.message);
    return res.status(500).json({ code: 'CLEANUP_FAILED', error: '정리에 실패했습니다' });
  }
  if (!stale || stale.length === 0) {
    return res.json({ success: true, deleted: 0 });
  }

  await removeStorageObjects(stale.map(s => s.url));

  const { error: deleteError } = await supabaseAdmin
    .from('sjj_room_photo_tmp')
    .delete()
    .in('id', stale.map(s => s.id));

  if (deleteError) {
    console.error('[cron/cleanup-tmp] 행 삭제 실패:', deleteError.message);
    return res.status(500).json({ code: 'CLEANUP_FAILED', error: '정리에 실패했습니다' });
  }

  console.log(`[cron/cleanup-tmp] ${stale.length}개 임시 사진 정리 완료`);
  res.json({ success: true, deleted: stale.length });
});

module.exports = router;

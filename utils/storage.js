const { supabaseAdmin } = require('../supabase');

const ROOM_PHOTO_BUCKET = 'room-photos';
const ROOM_PHOTO_PREFIX = `${process.env.SUPABASE_URL}/storage/v1/object/public/${ROOM_PHOTO_BUCKET}/`;

// public URL -> 버킷 내부 경로. room-photos 버킷 URL이 아니면 null
function storagePathFromUrl(url) {
  if (typeof url !== 'string' || !url.startsWith(ROOM_PHOTO_PREFIX)) return null;
  return url.slice(ROOM_PHOTO_PREFIX.length);
}

// url들에 해당하는 Storage 파일을 삭제 (존재하지 않아도 에러 아님)
async function removeStorageObjects(urls) {
  const paths = urls.map(storagePathFromUrl).filter(Boolean);
  if (paths.length === 0) return;
  const { error } = await supabaseAdmin.storage.from(ROOM_PHOTO_BUCKET).remove(paths);
  if (error) console.error('[storage] 파일 삭제 실패:', error.message);
}

// tmp/{user_id}/... 에 있는 파일을 {user_id}/... 운영 경로로 이동하고 새 public URL 반환. 실패 시 null
async function moveTmpPhotoToRoom(tmpUrl, user_id) {
  const fromPath = storagePathFromUrl(tmpUrl);
  if (!fromPath) return null;

  const filename = fromPath.split('/').pop();
  const toPath = `${user_id}/${Date.now()}-${filename}`;

  const { error } = await supabaseAdmin.storage.from(ROOM_PHOTO_BUCKET).move(fromPath, toPath);
  if (error) {
    console.error('[storage] 임시 사진 이동 실패:', error.message);
    return null;
  }
  return `${ROOM_PHOTO_PREFIX}${toPath}`;
}

module.exports = { ROOM_PHOTO_BUCKET, ROOM_PHOTO_PREFIX, storagePathFromUrl, removeStorageObjects, moveTmpPhotoToRoom };

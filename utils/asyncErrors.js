// Express 4는 async 라우트에서 난 예외를 잡지 못해 프로세스가 죽음.
// 모든 라우트 핸들러의 예외(동기/비동기)를 next(err)로 넘겨서 아래 에러 미들웨어가 500으로 응답하게 함.
// 라우트를 등록하기 전에 require 해야 함 (index.js 맨 위)
const Layer = require('express/lib/router/layer');

const originalHandle = Layer.prototype.handle_request;
Layer.prototype.handle_request = function (req, res, next) {
  const fn = this.handle;
  if (fn.length > 3) return originalHandle.call(this, req, res, next); // 에러 미들웨어는 원래대로
  try {
    const result = fn(req, res, next);
    if (result && typeof result.catch === 'function') result.catch(next);
  } catch (err) {
    next(err);
  }
};

// 공통 에러 응답 (원본 에러는 로그로만)
function errorHandler(err, req, res, next) {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ code: 'INVALID_JSON', error: '요청 형식이 올바르지 않습니다' });
  }
  console.error(`[error] ${req.method} ${req.originalUrl}:`, err);
  if (res.headersSent) return next(err);
  res.status(500).json({ code: 'INTERNAL_ERROR', error: '일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요' });
}

module.exports = { errorHandler };

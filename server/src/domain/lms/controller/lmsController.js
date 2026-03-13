const mq = require('../../../global/config/mq');
const session = require('../../../global/modules/session');
const logger = require('../../../global/modules/logger');

async function sync(req, res) {
  logger.info('[LMS sync] 요청 수신');
  const { session: sessionId, cookies } = req.body;

  if (!sessionId || !cookies) {
    return res.status(400).json({ error: '세션 또는 쿠키가 누락되었습니다.' });
  }

  // 세션 검증 (consumer는 별도 프로세스라 검증 불가 → 여기서만 수행)
  const user = session.get(sessionId);
  if (!user) {
    return res.status(401).json({ error: '유효하지 않은 세션입니다.' });
  }

  try {
    const messageId = await mq.publish('lms.sync', { session: sessionId, user, cookies });
    logger.info(`[LMS sync] MQ 전송 완료 | messageId: ${messageId}`);
    res.status(202).json({ success: true, messageId });
  } catch (e) {
    logger.error(`[LMS sync] MQ 전송 실패: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
}

module.exports = { sync };

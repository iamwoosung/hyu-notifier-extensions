const lmsService = require('../service/lmsService');

async function sync(req, res) {
  console.log('[LMS sync] 요청 수신');
  const { session, cookies } = req.body;
  console.log('[LMS sync] session:', session);
  console.log('[LMS sync] cookies:', cookies);

  if (!session || !cookies) {
    return res.status(400).json({ error: '세션 또는 쿠키가 누락되었습니다.' });
  }
  try {
    const data = await lmsService.syncLms(session, cookies);
    console.log('[LMS sync] 동기화 성공');
    res.json({ success: true, data });
  } catch (e) {
    if (e.message === 'INVALID_SESSION') {
      return res.status(401).json({ error: '유효하지 않은 세션입니다.' });
    }
    console.error('[LMS 동기화 오류]', e.message);
    res.status(500).json({ error: e.message });
  }
}

module.exports = { sync };

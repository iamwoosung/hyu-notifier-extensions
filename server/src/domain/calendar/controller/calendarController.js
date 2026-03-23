const session = require('../../../global/modules/session');
const db = require('../../../global/config/db');
const logger = require('../../../global/modules/logger');

async function getCalendar(req, res) {
  const { session: sessionId } = req.query;

  const user = session.get(sessionId);
  if (!user) return res.status(401).json({ error: '유효하지 않은 세션입니다.' });

  try {
    const rows = await db.query({ SP_NAME: 'CALENDAR_GET', p_UserNo: user.UserNo });
    const items = rows[0]?.CALENDAR_GET ?? [];

    const events = items.map(item => ({
      id: `${item.Type[0]}${item.ItemNo}`,
      title: `[${item.SubjectName}] ${item.Title}`,
      start: new Date(item.PeriodEnd).toISOString().slice(0, 10),
      color: item.IsComplete ? '#388e3c' : '#d32f2f',
      extendedProps: {
        type: item.Type,
        subjectName: item.SubjectName,
        isComplete: item.IsComplete,
      },
    }));

    res.json({ events });
  } catch (e) {
    logger.error(`[CALENDAR] 조회 실패: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
}

module.exports = { getCalendar };

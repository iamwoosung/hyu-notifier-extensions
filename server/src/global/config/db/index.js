const postgres = require('./postgres');
const logger = require('../../modules/logger');

// test/src/global/db/index.js 와 동일한 호출 방식
// 사용 예시:
//   await db.query({ SP_NAME: 'sp_get_user', p_user_id: 'abc' })
//   → CALL sp_get_user($1)  with params ['abc']
async function query(query) {
  if (typeof query !== 'object' || !query.SP_NAME) {
    throw new Error('프로시저 구문이 잘못되었습니다.');
  }

  const spName = query.SP_NAME;
  const params = { ...query };
  delete params.SP_NAME;

  const values = Object.values(params);
  const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
  const sql = `SELECT "${spName}"(${placeholders})`;

  logger.info(`[SP REQUEST] ${sql} | params: ${JSON.stringify(values)}`);
  const result = await postgres.query(sql, values);
  logger.info(`[SP RESULT ] ${spName} | rows: ${result.length}`);

  return result;
}

module.exports = {
  query,
  init: postgres.init,
};

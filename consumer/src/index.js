const env = process.argv[2] || 'dev';
require('dotenv').config({ path: `pkg.env.${env}` });

const logger = require('./modules/logger');
const db = require('./modules/db');
const mq = require('./config/mq');
const lmsSync = require('./handlers/lmsSync');

// 메시지 타입 → 핸들러 매핑
const handlers = {
  LMS_SYNC: lmsSync.handle,
};

(async () => {
  logger.info(`Consumer 시작 (env: ${env})`);

  // DB 초기화 (실패 시 자동 재시도)
  const dbReady = await db.init();
  if (!dbReady) {
    logger.error('DB 연결 실패');
    process.exit(1);
  }

  // MQ 연결 (실패 시 자동 재시도)
  await mq.connect(handlers);
})();

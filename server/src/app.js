const env = process.argv[2] || 'dev';
require('dotenv').config({ path: `pkg.env.${env}` });

const serverAppUse = require('./global/loaders/serverAppUse');
const logger = require('./global/modules/logger');
const mq = require('./global/config/mq');
const db = require('./global/config/db');

const PORT = process.env.PORT || 3000;
const KAKAO_REDIRECT_URI = process.env.KAKAO_REDIRECT_URI || `http://localhost:${PORT}/auth/kakao/callback`;

const app = serverAppUse();

(async () => {
  try {
    // DB 초기화 (실패 시 자동 재시도)
    await db.init();

    // MQ 초기화 (실패 시 자동 재시도)
    await mq.init();

    app.listen(PORT, function onListen() {
      logger.info(`서버 실행 중: http://localhost:${PORT}`);
      logger.info(`카카오 콜백 URI: ${KAKAO_REDIRECT_URI}`);
    });
  } catch (err) {
    logger.error(`초기화 중 오류: ${err.message}`);
    process.exit(1);
  }
})();

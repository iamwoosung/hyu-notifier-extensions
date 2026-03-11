const env = process.argv[2] || 'dev';
require('dotenv').config({ path: `pkg.env.${env}` });

const serverAppUse = require('./global/loaders/serverAppUse');
const logger = require('./global/modules/logger');

const PORT = process.env.PORT || 3000;
const KAKAO_REDIRECT_URI = process.env.KAKAO_REDIRECT_URI || `http://localhost:${PORT}/auth/kakao/callback`;

const app = serverAppUse();

app.listen(PORT, function onListen() {
  logger.info(`서버 실행 중: http://localhost:${PORT}`);
  logger.info(`카카오 콜백 URI: ${KAKAO_REDIRECT_URI}`);
});

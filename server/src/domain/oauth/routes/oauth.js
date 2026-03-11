const { Router } = require('express');
const oauthController = require('../controller/oauthController');

const router = Router();

// 카카오 OAuth
router.get('/auth/kakao', oauthController.redirectToKakao);
router.get('/auth/kakao/callback', oauthController.handleCallback);
router.get('/auth/success', oauthController.authSuccess);
router.get('/auth/needs-sync', oauthController.needsSync);

// 익스텐션 → 서버 세션/토큰 수신
router.post('/auth/session', oauthController.receiveSession);

module.exports = router;

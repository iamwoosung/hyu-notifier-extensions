const oauthService = require('../service/oauthService');
const session = require('../../../global/modules/session');
const logger = require('../../../global/modules/logger');

const PORT = process.env.PORT || 3000;
const KAKAO_CLIENT_ID = process.env.KAKAO_CLIENT_ID;
const KAKAO_REDIRECT_URI = process.env.KAKAO_REDIRECT_URI || `http://localhost:${PORT}/auth/kakao/callback`;

async function redirectToKakao(req, res) {
  if (!KAKAO_CLIENT_ID) {
    return res.status(500).send('KAKAO_CLIENT_ID 환경변수가 설정되지 않았습니다.');
  }

  const finalRedirect = req.query.final_redirect || '';

  const kakaoAuthUrl =
    `https://kauth.kakao.com/oauth/authorize` +
    `?client_id=${KAKAO_CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(KAKAO_REDIRECT_URI)}` +
    `&response_type=code` +
    `&scope=profile_nickname` +
    `&state=${encodeURIComponent(finalRedirect)}`;

  res.redirect(kakaoAuthUrl);
}

async function handleCallback(req, res) {
  const { code, state } = req.query;
  const finalRedirect = state ? decodeURIComponent(state) : '';

  if (!code) {
    return res.status(400).send('Authorization code가 없습니다.');
  }

  try {
    const user = await oauthService.kakaoLogin(code);
    const sessionId = session.create(user);

    logger.info(`[LOGIN] ${user.nickname} (id: ${user.id})`);

    const destination = finalRedirect
      ? `${finalRedirect}?session=${sessionId}`
      : `/auth/success?session=${sessionId}`;

    res.redirect(destination);
  } catch (err) {
    logger.error(`[Kakao OAuth Error] ${JSON.stringify(err.response?.data ?? err.message)}`);
    res.status(500).send('카카오 인증 중 오류가 발생했습니다.');
  }
}

function authSuccess(req, res) {
  res.send(`<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <title>로그인 성공</title>
  <style>
    body { display:flex; justify-content:center; align-items:center; height:100vh;
           font-family:sans-serif; background:#fffde7; margin:0; }
    .box { text-align:center; }
    .icon { font-size:48px; }
    h2 { margin:12px 0 8px; color:#333; }
    p  { color:#888; font-size:14px; }
  </style>
</head>
<body>
  <div class="box">
    <div class="icon">✅</div>
    <h2>카카오 로그인 성공!</h2>
    <p>익스텐션이 이 창을 자동으로 닫습니다.</p>
  </div>
</body>
</html>`);
}

module.exports = { redirectToKakao, handleCallback, authSuccess };

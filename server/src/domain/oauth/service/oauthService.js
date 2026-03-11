const axios = require('axios');
const db = require('../../../global/config/db');

const KAKAO_CLIENT_ID = process.env.KAKAO_CLIENT_ID;
const KAKAO_CLIENT_SECRET = process.env.KAKAO_CLIENT_SECRET;
const PORT = process.env.PORT || 3000;
const KAKAO_REDIRECT_URI = process.env.KAKAO_REDIRECT_URI || `http://localhost:${PORT}/auth/kakao/callback`;

async function kakaoLogin(code) {
  // 액세스 토큰 발급
  const tokenRes = await axios.post(
    'https://kauth.kakao.com/oauth/token',
    new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: KAKAO_CLIENT_ID,
      redirect_uri: KAKAO_REDIRECT_URI,
      code,
      ...(KAKAO_CLIENT_SECRET && { client_secret: KAKAO_CLIENT_SECRET }),
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );

  const { access_token } = tokenRes.data;

  // 유저 정보 조회
  const userRes = await axios.get('https://kapi.kakao.com/v2/user/me', {
    headers: { Authorization: `Bearer ${access_token}` },
  });

  const profile = userRes.data.kakao_account?.profile ?? {};

  const user = {
    id: String(userRes.data.id),
    nickname: profile.nickname ?? null,
  };

  // 기존 유저 여부 확인
  const existing = await db.query({ SP_NAME: 'USER_GET', p_UserKakaoID: user.id });
  const isNew = existing.length === 0;

  // 신규 유저면 등록
  if (isNew) {
    const [row] = await db.query({ SP_NAME: 'USER_SET', p_UserKakaoID: user.id, p_UserKakaoName: user.nickname });
    const result = row['USER_SET'] ?? row['user_set'];
    if (result !== 0) throw new Error(`USER_SET 실패 (code: ${result})`);
  }

  return { ...user, isNew };
}

module.exports = { kakaoLogin };

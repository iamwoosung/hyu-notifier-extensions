const SERVER_URL = 'http://localhost:3000';

// ─── View 전환 ────────────────────────────────────────────────────────────────

function showLogin() {
  document.getElementById('login-view').classList.remove('hidden');
  document.getElementById('needs-sync-view').classList.add('hidden');
  document.getElementById('main-view').classList.add('hidden');
}

function showNeedsSync() {
  document.getElementById('login-view').classList.add('hidden');
  document.getElementById('needs-sync-view').classList.remove('hidden');
  document.getElementById('main-view').classList.add('hidden');
}

function showMain() {
  document.getElementById('login-view').classList.add('hidden');
  document.getElementById('needs-sync-view').classList.add('hidden');
  document.getElementById('main-view').classList.remove('hidden');
}

// ─── 초기화: 저장된 세션 확인 ─────────────────────────────────────────────────

async function init() {
  const { session } = await chrome.storage.local.get('session');

  if (session) {
    try {
      const res = await fetch(`${SERVER_URL}/api/me?session=${session}`);
      if (res.ok) {
        showMain();
        return;
      }
    } catch (e) {
      // 서버 미응답 시 로그인 화면 유지
    }
    // 세션 만료 시 초기화
    await chrome.storage.local.remove(['session', 'user']);
  }

  showLogin();
}

// ─── 카카오 로그인 ────────────────────────────────────────────────────────────

document.getElementById('kakao-login-btn').addEventListener('click', async () => {
  const btn = document.getElementById('kakao-login-btn');
  btn.disabled = true;
  btn.innerHTML = `<span>로그인 중...</span>`;

  try {
    const redirectUrl = chrome.identity.getRedirectURL();
    const authUrl = `${SERVER_URL}/auth/kakao?final_redirect=${encodeURIComponent(redirectUrl)}`;

    // 팝업을 유지한 채로 OAuth 진행 (launchWebAuthFlow는 별도 창 사용)
    const responseUrl = await chrome.identity.launchWebAuthFlow({
      url: authUrl,
      interactive: true,
    });

    const url = new URL(responseUrl);
    const session = url.searchParams.get('session');
    const status = url.searchParams.get('status') ?? 'ok';
    if (!session) throw new Error('세션 없음');

    const res = await fetch(`${SERVER_URL}/api/me?session=${session}`);
    if (!res.ok) throw new Error('유저 정보 조회 실패');
    const { user } = await res.json();

    await chrome.storage.local.set({ session, user });

    // 서버에 세션 전달 (서버 로그 기록용)
    fetch(`${SERVER_URL}/auth/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: session }),
    }).catch(() => {});

    if (status === 'needs_sync') {
      await chrome.storage.local.set({ pendingLmsSync: true, pendingLmsSession: session });
      showNeedsSync();
    } else {
      showMain();
    }
  } catch (e) {
    console.error('[카카오 로그인 실패]', e.message);
    btn.disabled = false;
    btn.innerHTML = `
      <svg class="kakao-icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 3C6.477 3 2 6.477 2 10.8c0 2.7 1.636 5.07 4.13 6.47L5.1 20.4c-.1.3.23.55.5.37l4.22-2.81c.71.1 1.44.15 2.18.15 5.523 0 10-3.477 10-7.8C22 6.477 17.523 3 12 3z" fill="#3C1E1E"/>
      </svg>
      카카오 로그인`;
  }
});

// ─── LMS 동기화 안내 확인 버튼 ────────────────────────────────────────────────

document.getElementById('lms-confirm-btn').addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://learning.hanyang.ac.kr/login' });
  showMain();
});

// ─── LMS 동기화 ───────────────────────────────────────────────────────────────

document.getElementById('sync-btn').addEventListener('click', async () => {
  const btn = document.getElementById('sync-btn');
  btn.disabled = true;
  btn.textContent = '동기화 중...';

  const { session } = await chrome.storage.local.get('session');

  chrome.runtime.sendMessage({ action: 'SYNC_LMS', session }, async (response) => {
    // 팝업 컨텍스트 소멸로 응답 못 받는 경우 무시
    if (chrome.runtime.lastError) return;

    if (response?.success) {
      btn.textContent = '✓ 완료';
      setTimeout(() => {
        btn.textContent = '⟳ Sync';
        btn.disabled = false;
      }, 2000);
    } else if (response?.error === 'LMS_LOGIN_REQUIRED') {
      // 로그인 후 자동 동기화를 위해 플래그 저장
      await chrome.storage.local.set({ pendingLmsSync: true, pendingLmsSession: session });
      chrome.tabs.create({ url: 'https://learning.hanyang.ac.kr/login' });
      btn.textContent = 'LMS 로그인 필요';
      setTimeout(() => {
        btn.textContent = '⟳ Sync';
        btn.disabled = false;
      }, 3000);
    } else {
      console.error('[LMS 동기화 실패]', response?.error);
      btn.textContent = '⚠ 오류 발생';
      setTimeout(() => {
        btn.textContent = '⟳ Sync';
        btn.disabled = false;
      }, 2000);
    }
  });
});

// ─── 시작 ─────────────────────────────────────────────────────────────────────

init();

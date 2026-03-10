const SERVER_URL = 'http://localhost:3000';

// ─── Side Panel: 아이콘 클릭 시 사이드 패널 열기 ──────────────────────────────
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// ─── LMS 로그인 상태 확인 (ref/background.js 방식: 실제 API 호출 → 401 여부 판단) ───

async function checkLmsLogin() {
  // 브라우저 세션 쿠키가 자동 포함됨 (host_permissions 덕분)
  const res = await fetch('https://learning.hanyang.ac.kr/api/v1/dashboard/dashboard_cards', {
    credentials: 'include',  // 브라우저 세션 쿠키 포함 (MV3 서비스워커 필수)
    headers: { 'X-Requested-With': 'XMLHttpRequest' },
  });
  if (res.status === 401) return false;
  return true;
}

async function getLmsCookies() {
  return chrome.cookies.getAll({ domain: 'learning.hanyang.ac.kr' });
}

// ─── 메시지 핸들러 ────────────────────────────────────────────────────────────

// ─── LMS 로그인 완료 감지 → 자동 동기화 ─────────────────────────────────────

chrome.tabs.onUpdated.addListener(async (_tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  if (!tab.url || !tab.url.startsWith('https://learning.hanyang.ac.kr')) return;
  if (tab.url.includes('/login')) return; // 아직 로그인 페이지

  const { pendingLmsSync, pendingLmsSession } = await chrome.storage.local.get([
    'pendingLmsSync',
    'pendingLmsSession',
  ]);
  if (!pendingLmsSync) return;

  const loggedIn = await checkLmsLogin();
  if (!loggedIn) return;

  await chrome.storage.local.remove(['pendingLmsSync', 'pendingLmsSession']);

  try {
    const cookies = await getLmsCookies();
    const cookieMap = Object.fromEntries(cookies.map(c => [c.name, c.value]));
    const res = await fetch(`${SERVER_URL}/api/lms/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session: pendingLmsSession, cookies: cookieMap }),
    });
    if (!res.ok) throw new Error(`서버 오류: ${res.status}`);

    chrome.action.setBadgeText({ text: '✓' });
    chrome.action.setBadgeBackgroundColor({ color: '#22c55e' });
    setTimeout(() => chrome.action.setBadgeText({ text: '' }), 5000);
  } catch (e) {
    console.error('[자동 동기화 실패]', e.message);
    chrome.action.setBadgeText({ text: '!' });
    chrome.action.setBadgeBackgroundColor({ color: '#ef4444' });
    setTimeout(() => chrome.action.setBadgeText({ text: '' }), 5000);
  }
});

// ─── 메시지 핸들러 ────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {

  if (request.action === 'SYNC_LMS') {
    const trySend = (msg) => { try { sendResponse(msg); } catch (_) {} };

    (async () => {
      try {
        // 로그인 여부 확인 (401 → 미로그인)
        const loggedIn = await checkLmsLogin();
        if (!loggedIn) {
          trySend({ success: false, error: 'LMS_LOGIN_REQUIRED' });
          return;
        }

        // 쿠키를 서버에 전달 (서버가 LMS API 호출에 사용)
        const cookies = await getLmsCookies();
        const cookieMap = Object.fromEntries(cookies.map(c => [c.name, c.value]));

        const res = await fetch(`${SERVER_URL}/api/lms/sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session: request.session, cookies: cookieMap }),
        });

        if (!res.ok) throw new Error(`서버 오류: ${res.status}`);

        trySend({ success: true });
      } catch (error) {
        trySend({ success: false, error: error.message });
      }
    })();
    return true; // 비동기 응답 유지
  }

});

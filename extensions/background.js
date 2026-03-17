const SERVER_URL = 'http://localhost:3000';

// ─── Side Panel: 아이콘 클릭 시 사이드 패널 열기 ──────────────────────────────
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// ─── LMS 로그인 상태 확인 (ref/background.js 방식: 실제 API 호출 → 401 여부 판단) ───

async function checkLmsLogin() {
  // 현재 쿠키 이름 진단용 로그
  const cookies = await chrome.cookies.getAll({ domain: 'learning.hanyang.ac.kr' });
  const cookieNames = cookies.map(c => c.name);
  console.log('[LMS 쿠키 목록]', cookieNames);
  chrome.runtime.sendMessage({ action: 'DEBUG_LOG', msg: `[LMS 쿠키 목록] ${cookieNames.join(', ')}` }).catch(() => {});

  // API 응답으로 로그인 여부 판단 (401이면 미로그인)
  try {
    const res = await fetch('https://learning.hanyang.ac.kr/api/v1/dashboard/dashboard_cards', {
      credentials: 'include',
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    });
    console.log('[LMS 로그인 확인] status:', res.status);
    return res.status !== 401;
  } catch (e) {
    console.error('[LMS 로그인 확인 실패]', e.message);
    return false;
  }
}

async function getLmsCookies() {
  return chrome.cookies.getAll({ domain: 'learning.hanyang.ac.kr' });
}

// result 토큰 획득 - 배경탭에서 SSO URL 감시
// 반환값: true (취득 성공 or 이미 존재) | false (타임아웃)
// portal 세션 만료 시: 탭을 활성화하여 사용자가 포털 로그인 → 이후 SSO 자동 완료
async function getXnApiToken() {
  const cookies = await chrome.cookies.getAll({ domain: 'learning.hanyang.ac.kr' });
  if (cookies.find(c => c.name === 'xn_api_token')) {
    chrome.runtime.sendMessage({ action: 'DEBUG_LOG', msg: '[xn_api_token] 쿠키 존재 → SSO 생략' }).catch(() => {});
    return true; // 이미 있음
  }

  chrome.runtime.sendMessage({ action: 'DEBUG_LOG', msg: '[xn_api_token] 쿠키 없음 → 백그라운드 SSO 시작' }).catch(() => {});

  return new Promise((resolve) => {
    let backgroundTabId = null;
    let done = false;
    let tabActivated = false;
    let pollInterval = null;
    const timer = setTimeout(() => finish(false, '[xn_api_token] SSO 흐름 타임아웃 (60초)'), 60000);

    function finish(result, msg) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (pollInterval) clearInterval(pollInterval);
      chrome.tabs.onUpdated.removeListener(onTabUpdated);
      if (backgroundTabId) setTimeout(() => chrome.tabs.remove(backgroundTabId).catch(() => {}), 100);
      chrome.runtime.sendMessage({ action: 'DEBUG_LOG', msg }).catch(() => {});
      resolve(result);
    }

    // 배경탭 URL 변경 감시
    function onTabUpdated(tabId, _changeInfo, tab) {
      if (done) return;
      if (tabId !== backgroundTabId) return;
      if (!tab.url) return;

      // portal 로그인 페이지 감지 → 탭을 활성화하여 사용자가 로그인 후 SSO 자동 완료
      if (tab.url.includes('api.hanyang.ac.kr/oauth/login')) {
        if (!tabActivated) {
          tabActivated = true;
          chrome.tabs.update(backgroundTabId, { active: true }).catch(() => {});
          chrome.runtime.sendMessage({ action: 'DEBUG_LOG', msg: '[xn_api_token] portal 세션 만료 → 포털 로그인 탭 활성화 (로그인 후 자동 진행)' }).catch(() => {});
        }
        return; // 로그인 대기, 이후 SSO 완료되면 result 토큰 감지됨
      }

      try {
        // result 파라미터 포함 확인
        const url = new URL(tab.url);
        const resultToken = url.searchParams.get('result');

        if (resultToken) {
          done = true;
          clearTimeout(timer);
          if (pollInterval) clearInterval(pollInterval);
          chrome.tabs.onUpdated.removeListener(onTabUpdated);
          setTimeout(() => chrome.tabs.remove(backgroundTabId).catch(() => {}), 100);

          // result 토큰 저장
          chrome.storage.local.set({ resultToken }, () => {
            chrome.runtime.sendMessage({ action: 'DEBUG_LOG', msg: '[xn_api_token] 토큰 취득 성공' }).catch(() => {});
            resolve(true);
          });
          return;
        }
      } catch (e) {
        // URL 파싱 실패는 무시
      }
    }

    chrome.tabs.onUpdated.addListener(onTabUpdated);

    // 300ms마다 탭 URL 주기적으로 체크 (URL 업데이트 이벤트 누락 방지)
    pollInterval = setInterval(async () => {
      if (backgroundTabId) {
        try {
          const tab = await chrome.tabs.get(backgroundTabId);
          onTabUpdated(backgroundTabId, { status: 'complete' }, tab);
        } catch (e) {
          // 탭이 닫혔거나 접근 불가
          finish(false, '[xn_api_token] 배경탭 접근 불가');
        }
      }
    }, 300);

    // 백그라운드 탭에서 SSO 흐름 진행 (사용자에게 보이지 않음)
    chrome.tabs.create({
      url: 'https://hy-mooc.hanyang.ac.kr/login?type=sso',
      active: false,
    }).then(tab => {
      backgroundTabId = tab.id;
      chrome.runtime.sendMessage({ action: 'DEBUG_LOG', msg: '[xn_api_token] SSO 탭 생성 (백그라운드)' }).catch(() => {});
    }).catch(() => finish(false, '[xn_api_token] SSO 탭 생성 실패'));
  });
}

// ─── 메시지 핸들러 ────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {

  if (request.action === 'SYNC_LMS') {
    const trySend = (msg) => { try { sendResponse(msg); } catch (_) {} };

    (async () => {
      try {
        // portal SSO로 result 토큰 취득 (portal 세션 만료 시 탭 활성화하여 로그인 유도)
        chrome.runtime.sendMessage({ action: 'DEBUG_LOG', msg: '[SYNC_LMS] portal SSO 시작 (xn_api_token 취득)' }).catch(() => {});
        const tokenResult = await getXnApiToken();
        if (!tokenResult) {
          chrome.runtime.sendMessage({ action: 'DEBUG_LOG', msg: '[SYNC_LMS] xn_api_token 취득 실패 (타임아웃)' }).catch(() => {});
          trySend({ success: false, error: 'TOKEN_FAILED' });
          return;
        }

        const cookies = await getLmsCookies();
        const cookieMap = Object.fromEntries(cookies.map(c => [c.name, c.value]));

        // chrome.storage에서 resultToken 읽기
        const { resultToken } = await chrome.storage.local.get('resultToken');

        chrome.runtime.sendMessage({ action: 'DEBUG_LOG', msg: `[SYNC_LMS] 서버에 동기화 요청 전송 (resultToken: ${resultToken ? '있음' : '없음'})` }).catch(() => {});
        const res = await fetch(`${SERVER_URL}/api/lms/sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session: request.session, cookies: cookieMap, resultToken }),
        });

        if (!res.ok) throw new Error(`서버 오류: ${res.status}`);

        // 동기화 완료 후 resultToken 삭제
        await chrome.storage.local.remove('resultToken');

        chrome.runtime.sendMessage({ action: 'DEBUG_LOG', msg: '[SYNC_LMS] MQ 전송 완료 → Realtime 이벤트 대기 중' }).catch(() => {});
        trySend({ success: true });
      } catch (error) {
        chrome.runtime.sendMessage({ action: 'DEBUG_LOG', msg: `[SYNC_LMS] 오류: ${error.message}` }).catch(() => {});
        trySend({ success: false, error: error.message });
      }
    })();
    return true; // 비동기 응답 유지
  }

});

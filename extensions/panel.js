const { RealtimeClient } = supabaseRealtime; // realtime.js에서 로드됨
const SERVER_URL = 'http://localhost:3000';
const REALTIME_URL = 'http://localhost:4000/socket';
// docker/pkg.env.dev의 ANON_JWT 값 (JWT_SECRET으로 서명된 anon 토큰)
const REALTIME_JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzczNDYzMTE5LCJleHAiOjIwODg4MjMxMTl9.ZZ6JdonZ4odp906W3M1S8NwX4A_DoOJBcKKKWhuvaZY';

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
  loadCalendar();
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

    // UserUUID: Realtime 구독 시 본인 row 필터링에 사용
    await chrome.storage.local.set({ session, user, userUUID: user.UserUUID });

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

// ─── 디버그 로그 ───────────────────────────────────────────────────────────────

function dbg(msg) {
  const el = document.getElementById('debug-log');
  if (!el) return;
  const time = new Date().toTimeString().slice(0, 8);
  el.textContent += `[${time}] ${msg}\n`;
}

// ─── Toast ────────────────────────────────────────────────────────────────────

let toastTimer = null;

function showToast(message, type = 'success') {
  const el = document.getElementById('toast');
  if (!el) return;
  if (toastTimer) { clearTimeout(toastTimer); el.classList.remove('show'); }
  el.textContent = message;
  el.className = type; // 'success' | 'error' | 'info'
  // 한 프레임 뒤에 show 추가해야 transition 발동
  requestAnimationFrame(() => {
    requestAnimationFrame(() => el.classList.add('show'));
  });
  toastTimer = setTimeout(() => {
    el.classList.remove('show');
    toastTimer = null;
  }, 3000);
}

// ─── Realtime 구독 ─────────────────────────────────────────────────────────────

let realtimeChannel = null;

function subscribeToSyncStatus(userUUID, onComplete, onFail) {
  // 이전 구독이 남아 있으면 해제
  if (realtimeChannel) {
    realtimeChannel.unsubscribe();
    realtimeChannel = null;
  }

  dbg(`Realtime 연결 시작\nURL: ${REALTIME_URL}\nUUID: ${userUUID}`);

  const client = new RealtimeClient(REALTIME_URL, {
    params: { apikey: REALTIME_JWT },
  });

  realtimeChannel = client
    .channel('sync_status')
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'User',
        filter: `UserUUID=eq.${userUUID}`,
      },
      (payload) => {
        const status = payload.new.SyncStatus;
        dbg(`postgres_changes 수신: SyncStatus=${status}`);
        if (status === 3) {
          realtimeChannel.unsubscribe();
          realtimeChannel = null;
          onComplete();
        } else if (status === 4) {
          realtimeChannel.unsubscribe();
          realtimeChannel = null;
          onFail();
        }
      }
    )
    .subscribe((subStatus, err) => {
      dbg(`구독 상태: ${subStatus}${err ? ' | 오류: ' + JSON.stringify(err) : ''}`);
    });
}

// ─── LMS 동기화 ───────────────────────────────────────────────────────────────

document.getElementById('sync-btn').addEventListener('click', async () => {
  const btn = document.getElementById('sync-btn');
  btn.disabled = true;
  btn.textContent = '동기화 중...';

  const { session, userUUID } = await chrome.storage.local.get(['session', 'userUUID']);
  dbg(`Sync 시작 | userUUID: ${userUUID ?? '(없음)'}`);

  // Realtime 구독 먼저 시작 (서버 요청 전에 구독해야 이벤트 누락 없음)
  if (userUUID) {
    subscribeToSyncStatus(
      userUUID,
      () => {
        showToast('✓ LMS 동기화 완료!', 'success');
        btn.textContent = '동기화';
        btn.disabled = false;
        loadCalendar();
      },
      () => {
        showToast('✗ 동기화 실패. 다시 시도해주세요.', 'error');
        btn.textContent = '동기화';
        btn.disabled = false;
      }
    );
  }

  chrome.runtime.sendMessage({ action: 'SYNC_LMS', session }, async (response) => {
    // 팝업 컨텍스트 소멸로 응답 못 받는 경우 무시
    if (chrome.runtime.lastError) return;

    dbg(`서버 응답: ${JSON.stringify(response)}`);

    if (response?.success) {
      dbg('MQ 전송 완료. Realtime 이벤트 대기 중...');
    } else {
      // Realtime 구독 해제
      if (realtimeChannel) { realtimeChannel.unsubscribe(); realtimeChannel = null; }
      console.error('[LMS 동기화 실패]', response?.error);
      btn.textContent = '⚠ 오류 발생';
      setTimeout(() => { btn.textContent = '동기화'; btn.disabled = false; }, 2000);
    }
  });
});

// ─── 초기 자동 동기화 Realtime 구독 ──────────────────────────────────────────

chrome.runtime.onMessage.addListener((request) => {
  if (request.action === 'DEBUG_LOG') {
    dbg(request.msg);
    return;
  }
  if (request.action !== 'AUTO_SYNC_STARTED') return;
  chrome.storage.local.get('userUUID', ({ userUUID }) => {
    if (!userUUID) return;
    subscribeToSyncStatus(
      userUUID,
      () => showToast('✓ LMS 동기화 완료!', 'success'),
      () => showToast('✗ 동기화 실패. 다시 시도해주세요.', 'error'),
    );
  });
});

// ─── 모달 ─────────────────────────────────────────────────────────────────────

document.getElementById('info-btn').addEventListener('click', () => {
  document.getElementById('info-modal').classList.remove('hidden');
});

document.getElementById('debug-btn').addEventListener('click', () => {
  document.getElementById('debug-modal').classList.remove('hidden');
});

document.querySelectorAll('.modal-close').forEach(btn => {
  btn.addEventListener('click', () => {
    document.getElementById(btn.dataset.modal).classList.add('hidden');
  });
});

document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.classList.add('hidden');
  });
});

// ─── 캘린더 ───────────────────────────────────────────────────────────────────

let calendarInstance = null;

async function loadCalendar() {
  if (typeof FullCalendar === 'undefined') return;

  // TODO: 실제 API 연동 시 아래 mock 데이터를 교체
  // const { session } = await chrome.storage.local.get('session');
  // const res = await fetch(`${SERVER_URL}/api/calendar?session=${session}`);
  // const { events } = await res.json();
  const today = new Date();
  const y = today.getFullYear(), m = today.getMonth();
  const d = (offset) => new Date(y, m, today.getDate() + offset).toISOString().slice(0, 10);
  const events = [
    { id: 'a1', title: '[CS101] 운영체제 과제 1', start: d(2),  color: '#d32f2f', extendedProps: { type: 'assignment', subjectCode: 'CS101', isSubmitted: false } },
    { id: 'a2', title: '[CS102] 알고리즘 과제',   start: d(5),  color: '#388e3c', extendedProps: { type: 'assignment', subjectCode: 'CS102', isSubmitted: true  } },
    { id: 'a3', title: '[CS103] 데이터베이스 보고서', start: d(9), color: '#d32f2f', extendedProps: { type: 'assignment', subjectCode: 'CS103', isSubmitted: false } },
    { id: 'v1', title: '[CS101] 3주차 강의 영상', start: d(3),  color: '#9e9e9e', extendedProps: { type: 'video',      subjectCode: 'CS101', isWatched: true  } },
    { id: 'v2', title: '[CS102] 2주차 알고리즘',  start: d(7),  color: '#f57c00', extendedProps: { type: 'video',      subjectCode: 'CS102', isWatched: false } },
    { id: 'v3', title: '[CS103] DB 설계 기초',    start: d(-1), color: '#f57c00', extendedProps: { type: 'video',      subjectCode: 'CS103', isWatched: false } },
  ];

  if (calendarInstance) {
    calendarInstance.removeAllEvents();
    calendarInstance.addEventSource(events);
    return;
  }

  const el = document.getElementById('calendar');
  calendarInstance = new FullCalendar.Calendar(el, {
    initialView: 'dayGridMonth',
    locale: 'ko',
    headerToolbar: { left: 'prev', center: 'title', right: 'next' },
    height: 'auto',
    dayMaxEvents: 3,
    events,
    eventClick(info) {
      const p = info.event.extendedProps;
      const status = p.type === 'assignment'
        ? (p.isSubmitted ? '제출 완료' : '미제출')
        : (p.isWatched   ? '시청 완료' : '미시청');
      showToast(`[${p.subjectCode}] ${info.event.title} · ${status}`, 'info');
    },
  });
  calendarInstance.render();
}

// ─── 시작 ─────────────────────────────────────────────────────────────────────

init();

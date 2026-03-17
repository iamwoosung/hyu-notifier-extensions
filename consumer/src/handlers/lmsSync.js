const axios = require('axios');
const { wrapper } = require('axios-cookiejar-support');
const { CookieJar } = require('tough-cookie');
const NodeRSA = require('node-rsa');
const logger = require('../modules/logger');
const db = require('../modules/db');

const LMS_BASE = 'https://learning.hanyang.ac.kr';

function createLmsClient(cookieHeader, jar) {
  return wrapper(axios.create({
    jar,
    withCredentials: true,
    headers: {
      Cookie: cookieHeader,
      'X-Requested-With': 'XMLHttpRequest',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
    transformResponse: [(data) => {
      if (typeof data === 'string') {
        try { return JSON.parse(data.replace(/^while\(1\);/, '')); } catch (_) { return data; }
      }
      return data;
    }],
  }));
}

// resultToken으로 from_cc 처리 + Canvas 로그인 + xn_api_token 획득
async function processResultToken(resultToken, jar, cookieHeader) {
  try {
    const fromCcUrl = `${LMS_BASE}/learningx/login/from_cc?result=${encodeURIComponent(resultToken)}`;
    const client = createLmsClient(cookieHeader, jar);

    // from_cc 호출 → HTML에서 RSA 키와 암호화된 비밀번호 추출
    const fromCcRes = await client.get(fromCcUrl);
    const html = fromCcRes.data;

    // RSA Private 키 추출
    const privateKeyMatch = html.match(/-----BEGIN RSA PRIVATE KEY-----[\s\S]*?-----END RSA PRIVATE KEY-----/);
    if (!privateKeyMatch) {
      throw new Error('RSA private key not found in from_cc response');
    }

    // 암호화된 비밀번호 추출
    const encryptedDataMatch = html.match(/window\.loginCryption\("([^"]+)"/);
    if (!encryptedDataMatch) {
      throw new Error('Encrypted password not found in from_cc response');
    }

    // RSA 복호화
    const decryptor = new NodeRSA(privateKeyMatch[0]);
    decryptor.setOptions({ encryptionScheme: 'pkcs1' });
    const decryptedPassword = decryptor.decrypt(encryptedDataMatch[1], 'utf8');

    // form 값 추출
    const extract = (name) => {
      const reg = new RegExp(`name="${name}"[^>]*value="([^"]*)"`, 'i');
      const m = html.match(reg);
      return m ? m[1] : '';
    };

    // Canvas 로그인 POST
    const canvasParams = new URLSearchParams();
    canvasParams.set('utf8', '✓');
    canvasParams.set('redirect_to_ssl', '1');
    canvasParams.set('after_login_url', '');
    canvasParams.set('pseudonym_session[unique_id]', extract('pseudonym_session\\[unique_id\\]'));
    canvasParams.set('pseudonym_session[password]', decryptedPassword);
    canvasParams.set('pseudonym_session[remember_me]', '0');

    await client.post(`${LMS_BASE}/login/canvas`, canvasParams.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': fromCcUrl,
      },
    });

    // xn_api_token 확인
    const cookies = await jar.getCookies(LMS_BASE);
    const xnToken = cookies.find(c => c.key === 'xn_api_token');
    if (!xnToken) {
      throw new Error('xn_api_token not found after Canvas login');
    }

    return xnToken.value;
  } catch (e) {
    logger.error(`[xn_api_token] 처리 실패: ${e.message}`);
    throw e;
  }
}

async function handle(message) {
  const { user, cookies, resultToken } = message.payload;
  logger.info(`[LMS_SYNC] 처리 시작 | user: ${JSON.stringify(user)} | messageId: ${message.messageId} | resultToken: ${resultToken ? '있음' : '없음'} | xn_api_token(cookie): ${cookies['xn_api_token'] ? '있음' : '없음'}`);

  if (!user || !user.UserNo) {
    throw new Error('User information is missing in message payload');
  }

  // 처리 시작 상태 기록 (Realtime → Extension에 push됨)
  await db.query({ SP_NAME: 'USER_SYNC_STATUS_SET', p_UserNo: user.UserNo, p_SyncStatus: 2 });

  try {
    const cookieHeader = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
    const jar = new CookieJar();
    const client = createLmsClient(cookieHeader, jar);

    // resultToken이 있으면 from_cc 처리로 xn_api_token 획득
    let xnApiToken = cookies['xn_api_token'];
    if (resultToken && !xnApiToken) {
      try {
        xnApiToken = await processResultToken(resultToken, jar, cookieHeader);
        logger.info(`[LMS_SYNC] xn_api_token 취득 성공 (from_cc)`);
      } catch (e) {
        logger.warn(`[LMS_SYNC] resultToken 처리 실패: ${e.message} (쿠키의 xn_api_token으로 계속 진행)`);
      }
    }
    logger.info(`[LMS_SYNC] xn_api_token: ${xnApiToken ? '있음' : '없음 (동영상 동기화 불가)'}`);

    // 수강 과목 목록 + 사용자 프로필 병렬 조회
    const [dashRes, profileRes] = await Promise.all([
      client.get(`${LMS_BASE}/api/v1/dashboard/dashboard_cards`),
      client.get(`${LMS_BASE}/api/v1/users/self/profile`).catch(() => ({ data: null })),
    ]);
    const courses = dashRes.data;
    if (!Array.isArray(courses)) throw new Error('과목 목록 조회 실패');

    let userHYUID = null, userHYUName = null, userHYUEmail = null;
    if (profileRes.data) {
      userHYUID    = profileRes.data.login_id || null;
      const rawName = profileRes.data.name || '';
      userHYUName  = rawName.split('/')[0].trim() || null;
      userHYUEmail = profileRes.data.primary_email || null;
    }

    // 과목 리스트를 JSON 형식으로 변환 (LmsID 포함)
    const subjectsList = courses.map(course => {
      const courseName = course.courseName || course.originalName || course.course_code;
      const parts = courseName.split('_');
      const subjectCode = course.course_code || (parts.length > 1 ? parts[0] : courseName);
      const subjectName = parts.length > 1 ? parts.slice(1).join('_') : courseName;
      return {
        LmsID: course.id,
        SubjectCode: subjectCode,
        SubjectName: subjectName,
      };
    });

    // 각 과목의 과제 + 제출 현황 + LearningX 모듈 병렬 조회
    const courseDetails = await Promise.all(courses.map(async (course) => {
      const courseId = course.id;
      const courseName = course.courseName || course.originalName || course.course_code;

      try {
        const [assignRes, subRes] = await Promise.all([
          client.get(`${LMS_BASE}/api/v1/courses/${courseId}/assignment_groups?include[]=assignments&override_assignment_dates=true`),
          client.get(`${LMS_BASE}/api/v1/courses/${courseId}/students/submissions?per_page=50`),
        ]);

        const submissionMap = {};
        if (Array.isArray(subRes.data)) {
          subRes.data.forEach(s => { submissionMap[s.assignment_id] = s.workflow_state; });
        }

        let videosFlat = [];
        if (xnApiToken) {
          try {
            const modRes = await axios.get(
              `${LMS_BASE}/learningx/api/v1/courses/${courseId}/modules?include_detail=true`,
              {
                headers: {
                  Authorization: `Bearer ${xnApiToken}`,
                  Accept: 'application/json',
                  Cookie: cookieHeader,
                },
              }
            );
            if (Array.isArray(modRes.data)) {
              modRes.data.filter(m => m.module_items?.length > 0).forEach(module => {
                module.module_items.forEach(item => {
                  const c = item.content_data || {};
                  videosFlat.push({
                    LmsItemID:   item.module_item_id,
                    Title:       item.title,
                    IsWatched:   !!(item.completed || item.attendance_status === 'completed' || item.attendance_status === 'attended'),
                    DurationSec: c.item_content_data?.duration ? Math.round(c.item_content_data.duration) : null,
                    PeriodStart: c.unlock_at || null,
                    PeriodEnd:   c.due_at    || null,
                  });
                });
              });
            }
          } catch (_) {}
        }

        // 과제 평탄화 (그룹 → 과제 목록)
        const assignmentsFlat = [];
        if (Array.isArray(assignRes.data)) {
          assignRes.data.forEach(group => {
            (group.assignments || []).forEach(assign => {
              const workflowState = submissionMap[assign.id] || 'unsubmitted';
              assignmentsFlat.push({
                LmsAssignmentID: assign.id,
                Title:           assign.name,
                IsSubmitted:     workflowState === 'submitted' || workflowState === 'graded',
                WorkflowState:   workflowState,
                PeriodStart:     assign.unlock_at || null,
                PeriodEnd:       assign.due_at    || null,
              });
            });
          });
        }

        return { id: courseId, name: courseName, assignmentsFlat, videosFlat };
      } catch (e) {
        return { id: courseId, name: courseName, error: e.message };
      }
    }));

    // DB에 과목 정보 저장
    await db.query({
      SP_NAME: 'SUBJECT_SYNC',
      TABLE: false,
      p_UserNo: user.UserNo,
      p_SubjectsJson: JSON.stringify(subjectsList),
    });

    // 과목별 과제 / 동영상 동기화
    await Promise.all(courseDetails.map(async (detail) => {
      if (detail.error) return;
      if (detail.assignmentsFlat.length > 0) {
        const res = await db.query({ SP_NAME: 'ASSIGNMENT_SYNC', TABLE: false, p_UserNo: user.UserNo, p_LmsID: detail.id, p_Assignments: JSON.stringify(detail.assignmentsFlat) });
        if (res[0]?.ASSIGNMENT_SYNC !== 0) logger.warn(`[LMS_SYNC] ASSIGNMENT_SYNC 실패 (${res[0]?.ASSIGNMENT_SYNC}) | LmsID: ${detail.id} | name: ${detail.name}`);
      }
      if (detail.videosFlat.length > 0) {
        const res = await db.query({ SP_NAME: 'VIDEO_SYNC', TABLE: false, p_UserNo: user.UserNo, p_LmsID: detail.id, p_Videos: JSON.stringify(detail.videosFlat) });
        if (res[0]?.VIDEO_SYNC !== 0) logger.warn(`[LMS_SYNC] VIDEO_SYNC 실패 (${res[0]?.VIDEO_SYNC}) | LmsID: ${detail.id} | name: ${detail.name}`);
      }
    }));

    // 완료 상태 기록 + 학번/이름/이메일 저장 (Realtime → Extension에 push됨)
    await db.query({ SP_NAME: 'USER_SYNC_STATUS_SET', p_UserNo: user.UserNo, p_SyncStatus: 3, p_UserHYUID: userHYUID, p_UserHYUName: userHYUName, p_UserHYUEmail: userHYUEmail });
    logger.info(`[LMS_SYNC] 처리 완료 | messageId: ${message.messageId} | 과목 수: ${courseDetails.length}`);

    return courseDetails;
  } catch (err) {
    // 실패 상태 기록 (Realtime → Extension에 push됨)
    await db.query({ SP_NAME: 'USER_SYNC_STATUS_SET', p_UserNo: user.UserNo, p_SyncStatus: 4 }).catch(() => {});
    logger.error(`[LMS_SYNC] 처리 실패 | messageId: ${message.messageId} | ${err.message}`);
    throw err;
  }
}

module.exports = { handle };

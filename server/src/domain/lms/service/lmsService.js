const axios = require('axios');
const session = require('../../../global/modules/session');
const logger = require('../../../global/modules/logger');

const LMS_BASE = 'https://learning.hanyang.ac.kr';

// Canvas API는 JSON 앞에 while(1); 접두어를 붙이므로 제거 후 파싱
function createLmsClient(cookieHeader) {
  return axios.create({
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
  });
}

async function syncLms(sessionId, cookies) {
  // 서버 세션 검증
  const user = session.get(sessionId);
  if (!user) throw new Error('INVALID_SESSION');

  const cookieHeader = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
  const client = createLmsClient(cookieHeader);

  // 수강 과목 목록 조회
  const dashRes = await client.get(`${LMS_BASE}/api/v1/dashboard/dashboard_cards`);
  const courses = dashRes.data;
  if (!Array.isArray(courses)) throw new Error('과목 목록 조회 실패');

  logger.info(`수강 중인 과목 (총 ${courses.length}개): ${courses.map((c, i) => `${i + 1}.${c.courseName || c.originalName || c.course_code}(${c.id})`).join(', ')}`);

  // xn_api_token: LearningX Bearer 토큰
  const apiToken = cookies['xn_api_token'];

  // 각 과목의 과제 + 모듈 병렬 조회
  const courseDetails = await Promise.all(courses.map(async (course) => {
    const courseId = course.id;
    const courseName = course.courseName || course.originalName || course.course_code;

    try {
      const [assignRes, subRes] = await Promise.all([
        client.get(`${LMS_BASE}/api/v1/courses/${courseId}/assignment_groups?include[]=assignments&override_assignment_dates=true`),
        client.get(`${LMS_BASE}/api/v1/courses/${courseId}/students/submissions?per_page=50`),
      ]);

      const assignments = assignRes.data;
      const submissions = subRes.data;

      const submissionMap = {};
      if (Array.isArray(submissions)) {
        submissions.forEach(s => { submissionMap[s.assignment_id] = s.workflow_state; });
      }

      // LearningX 모듈 조회 (xn_api_token 있을 때만)
      let modules = [];
      if (apiToken) {
        try {
          const modRes = await axios.get(
            `${LMS_BASE}/learningx/api/v1/courses/${courseId}/modules?include_detail=true`,
            {
              headers: {
                Authorization: `Bearer ${apiToken}`,
                Accept: 'application/json',
                Cookie: cookieHeader,
              },
            }
          );
          modules = modRes.data;
        } catch (_) {}
      }

      return { id: courseId, name: courseName, assignments, submissionMap, modules };
    } catch (e) {
      return { id: courseId, name: courseName, error: e.message };
    }
  }));

  return { user, courses: courseDetails };
}

module.exports = { syncLms };

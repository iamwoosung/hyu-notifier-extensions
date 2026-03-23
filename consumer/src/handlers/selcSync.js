const axios = require('axios');
const cheerio = require('cheerio');
const logger = require('../modules/logger');
const db = require('../modules/db');

const BASE_URL = 'https://selc.or.kr';

function createSelcClient(cookieHeader) {
  return axios.create({
    headers: {
      Cookie: cookieHeader,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    },
    responseType: 'text',
    maxRedirects: 5,
  });
}

function parseCourseList(html) {
  const courses = [];
  const $ = cheerio.load(html);

  $('table.list tbody tr').each((i, el) => {
    const entryA = $(el).find('a.classin_new');
    if (entryA.length > 0) {
      const title =
        $(el).find('td').eq(3).text().replace(/\s+/g, ' ').trim() ||
        $(el).find('td.ag_l').text().replace(/\s+/g, ' ').trim();
      const course_id = entryA.attr('course_id');
      const class_no = entryA.attr('class_no');
      if (course_id) courses.push({ title, course_id, class_no });
    }
  });

  return courses;
}

function parseAssignments(json) {
  const results = [];
  if (!json?.rows) return results;

  json.rows.forEach((row, i) => {
    const title = row.report_nm
      ? row.report_nm.replace(/<[^>]*>?/gm, '')
      : `과제 ${i + 1}`;
    const isSubmitted = row.apply_yn === 'Y';
    results.push({ title, isSubmitted });
  });
  return results;
}

function parseVideos(html) {
  const results = [];
  const $ = cheerio.load(html);

  $('div.lec_cont').each((i, el) => {
    const titleFull = $(el).find('.learn_act_box .title').text();
    if (!titleFull) return;

    const titleText = titleFull.split('|')[0].replace(/\s+/g, ' ').trim();
    const progressText = $(el).find('.learn_act_box dl dd').last().text().replace(/\s+/g, ' ').trim();
    const isVideo = $(el).find('img[src*="movie"]').length > 0;
    const isQuiz = $(el).find('img[src*="quiz"]').length > 0;

    // 출석기간 끝 날짜 파싱 (예: "2026.03.03 14:00 ~ 2026.04.07 13:59")
    let periodEnd = null;
    const periodDd = $(el).find('.learn_act_box dt:contains("출석기간")').next('dd');
    if (periodDd.length > 0) {
      const m = periodDd.text().match(/~\s*(\d{4})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2})/);
      if (m) periodEnd = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00+09:00`;
    }

    results.push({ titleText, progressText, isVideo, isQuiz, periodEnd });
  });

  return results;
}

function collectDbItems(items, quizzes, videos) {
  // 기타 아이템(생각해보기 등)에서 주차 수강 마감일 추출
  let weekPeriodEnd = null;
  for (const { isVideo, isQuiz, progressText } of items) {
    if (!isVideo && !isQuiz) {
      const m = progressText.match(/~\s*(\d{4})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2})/);
      if (m) { weekPeriodEnd = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00+09:00`; break; }
    }
  }

  items.forEach(({ titleText, progressText, isVideo, isQuiz, periodEnd }) => {
    if (isVideo) {
      const isWatched = progressText.includes('100%') || progressText.includes('완료') || progressText.includes('O');
      videos.push({ Title: titleText, IsWatched: isWatched, PeriodEnd: periodEnd ?? weekPeriodEnd });
    } else if (isQuiz) {
      const isSubmitted = progressText.includes('응시');
      quizzes.push({ Title: titleText, IsSubmitted: isSubmitted });
    }
  });
}

async function fetchCourseDetails(client, course) {
  const { course_id, class_no, title } = course;
  const allQuizzes = [];
  const allVideos = [];

  logger.info(`=================================================`);
  logger.info(`📘 과목: ${title}`);
  logger.info(`=================================================`);

  // [0] 강의실 입장 (서버 세션 변수 초기화)
  try {
    const enterPayload = new URLSearchParams();
    enterPayload.append('mnid', '201008254671');
    enterPayload.append('course_id', course_id);
    enterPayload.append('class_no', class_no);
    enterPayload.append('term_year', course_id.substring(0, 4));
    enterPayload.append('term_cd', course_id.substring(4, 6));

    await client.post(
      `${BASE_URL}/lms/lms/class/classroom/doViewClassRoom.do`,
      enterPayload.toString()
    );
  } catch (_) { /* 입장 실패 무시 */ }

  // [1] 과제 조회
  try {
    const reportPayload = new URLSearchParams();
    reportPayload.append('q_course_id', course_id);
    reportPayload.append('q_class_no', class_no);
    reportPayload.append('page', '1');
    reportPayload.append('rows', '15');

    const reportRes = await client.post(
      `${BASE_URL}/lms/lms/class/report/stud/doListReport.do`,
      reportPayload.toString()
    );

    const reportJson = JSON.parse(reportRes.data);
    const assignments = parseAssignments(reportJson);

    if (assignments.length === 0) {
      logger.info(`  📌 [과제] 등록된 과제가 없습니다.`);
    } else {
      assignments.forEach(({ title: t, isSubmitted }) => {
        const icon = isSubmitted ? '✅' : '❌';
        logger.info(`  📌 [과제] ${icon} ${t} (상태: ${isSubmitted ? '제출 완료' : '미제출'})`);
      });
    }
  } catch (e) {
    logger.warn(`  [과제] 데이터 불러오기 실패: ${e.message}`);
  }

  // [2] 영상(강의) 조회 (1주차 먼저 → 주차 수 파악 → 나머지 병렬)
  try {
    const week1Payload = new URLSearchParams();
    week1Payload.append('mnid', '201008103161');
    week1Payload.append('course_id', course_id);
    week1Payload.append('class_no', class_no);
    week1Payload.append('week_no', '1');

    const week1Res = await client.post(
      `${BASE_URL}/lms/lms/class/courseSchedule/doListView.do`,
      week1Payload.toString()
    );

    const html1 = week1Res.data;
    const weekMatches = html1.match(/fncListFunction\('(\d+)'\)/g);
    const maxWeek = weekMatches ? weekMatches.length : 15;

    logger.info(`\n  --- 1주차 ---`);
    const week1Videos = parseVideos(html1);
    printVideos(week1Videos);
    collectDbItems(week1Videos, allQuizzes, allVideos);

    // 2주차 이후 병렬 조회
    const weekPromises = [];
    for (let w = 2; w <= maxWeek; w++) {
      const wPayload = new URLSearchParams();
      wPayload.append('mnid', '201008103161');
      wPayload.append('course_id', course_id);
      wPayload.append('class_no', class_no);
      wPayload.append('week_no', w.toString());

      weekPromises.push(
        client.post(
          `${BASE_URL}/lms/lms/class/courseSchedule/doListView.do`,
          wPayload.toString()
        ).then(r => r.data).catch(() => '')
      );
    }

    const htmlResults = await Promise.all(weekPromises);
    htmlResults.forEach((html, idx) => {
      logger.info(`\n  --- ${idx + 2}주차 ---`);
      const weekVideos = parseVideos(html);
      printVideos(weekVideos);
      collectDbItems(weekVideos, allQuizzes, allVideos);
    });
  } catch (e) {
    logger.warn(`  [영상] 데이터 불러오기 실패: ${e.message}`);
  }

  return { title, quizzes: allQuizzes, videos: allVideos };
}

function printVideos(videos) {
  if (videos.length === 0) {
    logger.info(`  🎬 [영상] 등록된 강의 영상이 없거나 아직 진행할 수 없습니다.`);
    return;
  }

  let videoCount = 0;
  videos.forEach(({ titleText, progressText, isVideo, isQuiz }) => {
    if (isVideo) {
      const isDone = progressText.includes('100%') || progressText.includes('완료') || progressText.includes('O');
      logger.info(`  🎬 [영상] ${isDone ? '✅' : '⏳'} ${titleText} (상태: ${progressText})`);
      videoCount++;
    } else {
      logger.info(`  📝 [${isQuiz ? '퀴즈' : '기타'}] ⏳ ${titleText} (상태: ${progressText})`);
    }
  });

  if (videoCount === 0) {
    logger.info(`  🎬 [영상] 등록된 강의 영상이 없거나 아직 진행할 수 없습니다.`);
  }
}

async function handle(message) {
  const { cookies, user } = message.payload;
  const sessionCookie = cookies?.RSN_JSESSIONID;

  logger.info(`[SELC_SYNC] 처리 시작 | messageId: ${message.messageId}`);

  if (!sessionCookie) {
    throw new Error('RSN_JSESSIONID 쿠키가 없습니다');
  }

  if (!user || !user.UserNo) {
    throw new Error('사용자 정보가 없습니다');
  }

  // 처리 시작 상태 기록 (Realtime → Extension에 push됨)
  await db.query({ SP_NAME: 'USER_SYNC_STATUS_SET', p_UserNo: user.UserNo, p_SyncStatus: 2 });

  try {
    const cookieHeader = `RSN_JSESSIONID=${sessionCookie}`;
    const client = createSelcClient(cookieHeader);

    // 수강 과목 목록 조회
    const listRes = await client.get(
      `${BASE_URL}/lms/lms/myLecture/doListView.do?mnid=201008840728`
    );

    const html = listRes.data;
    if (html.includes('lgin.do') || html.includes('잘못된 URL입니다')) {
      throw new Error('SELC 세션이 만료되었거나 로그인이 되어있지 않습니다');
    }

    const courses = parseCourseList(html);
    if (courses.length === 0) {
      logger.warn(`[SELC_SYNC] 수강 중인 과목을 찾을 수 없습니다.`);
      await db.query({ SP_NAME: 'USER_SYNC_STATUS_SET', p_UserNo: user.UserNo, p_SyncStatus: 3 });
      return;
    }

    logger.info(`[SELC_SYNC] 총 ${courses.length}개의 과목 발견. 과제 및 영상 조회 시작...\n`);

    for (const course of courses) {
      const { title, quizzes, videos } = await fetchCourseDetails(client, course);
      logger.info('');

      if (quizzes.length > 0) {
        const res = await db.query({
          SP_NAME: 'SELC_ASSIGNMENT_SYNC',
          TABLE: false,
          p_UserNo: user.UserNo,
          p_SubjectName: title,
          p_Assignments: JSON.stringify(quizzes),
        });
        if (res[0]?.SELC_ASSIGNMENT_SYNC !== 0) {
          logger.warn(`[SELC_SYNC] SELC_ASSIGNMENT_SYNC 실패 (${res[0]?.SELC_ASSIGNMENT_SYNC}) | 과목: ${title}`);
        } else {
          logger.info(`[SELC_SYNC] 퀴즈 ${quizzes.length}개 DB 저장 완료 | 과목: ${title}`);
        }
      }

      if (videos.length > 0) {
        const res = await db.query({
          SP_NAME: 'SELC_VIDEO_SYNC',
          TABLE: false,
          p_UserNo: user.UserNo,
          p_SubjectName: title,
          p_Videos: JSON.stringify(videos),
        });
        if (res[0]?.SELC_VIDEO_SYNC !== 0) {
          logger.warn(`[SELC_SYNC] SELC_VIDEO_SYNC 실패 (${res[0]?.SELC_VIDEO_SYNC}) | 과목: ${title}`);
        } else {
          logger.info(`[SELC_SYNC] 영상 ${videos.length}개 DB 저장 완료 | 과목: ${title}`);
        }
      }
    }

    // 완료 상태 기록 (Realtime → Extension에 push됨)
    await db.query({ SP_NAME: 'USER_SYNC_STATUS_SET', p_UserNo: user.UserNo, p_SyncStatus: 3 });
    logger.info(`[SELC_SYNC] 모든 데이터 조회 및 저장 완료 | messageId: ${message.messageId}`);
  } catch (err) {
    // 실패 상태 기록 (Realtime → Extension에 push됨)
    await db.query({ SP_NAME: 'USER_SYNC_STATUS_SET', p_UserNo: user.UserNo, p_SyncStatus: 4 }).catch(() => {});
    logger.error(`[SELC_SYNC] 처리 실패 | messageId: ${message.messageId} | ${err.message}`);
    throw err;
  }
}

module.exports = { handle };

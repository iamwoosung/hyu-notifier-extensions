-- =============================================
-- FN: USER_GET (카카오 ID로 유저 조회)
-- 반환: 유저 row (없으면 빈 결과)
-- =============================================
DROP FUNCTION IF EXISTS "USER_GET"(VARCHAR);

CREATE OR REPLACE FUNCTION "USER_GET"(
    p_UserKakaoID VARCHAR(255)
)
RETURNS TABLE(
    "UserNo"           INTEGER,
    "UserUUID"         UUID,
    "UserKakaoID"      VARCHAR(255),
    "UserKakaoName"    VARCHAR(255),
    "UserHYUID"        VARCHAR(255),
    "UserHYUName"      VARCHAR(255),
    "UserHYUEmail"     VARCHAR(255),
    "UserPrivateEmail" VARCHAR(255),
    "UserInsertDate"   TIMESTAMP,
    "UserUpdateDate"   TIMESTAMP
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        u."UserNo",
        u."UserUUID",
        u."UserKakaoID",
        u."UserKakaoName",
        u."UserHYUID",
        u."UserHYUName",
        u."UserHYUEmail",
        u."UserPrivateEmail",
        u."UserInsertDate",
        u."UserUpdateDate"
    FROM "User" u
    WHERE u."UserKakaoID" = p_UserKakaoID;
END;
$$;

-- =============================================
-- FN: USER_SET (카카오 최초 로그인 시 회원가입)
-- 반환: 0 = 성공, 9999 = 실패
-- =============================================
DROP FUNCTION IF EXISTS "USER_SET"(VARCHAR, VARCHAR);

CREATE OR REPLACE FUNCTION "USER_SET"(
    p_UserKakaoID   VARCHAR(255),
    p_UserKakaoName VARCHAR(255)
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO "User" (
        "UserKakaoID",
        "UserKakaoName",
        "UserInsertDate"
    ) VALUES (
        p_UserKakaoID,
        p_UserKakaoName,
        NOW()
    )
    ON CONFLICT ("UserKakaoID") DO NOTHING;

    RETURN 0;

EXCEPTION
    WHEN OTHERS THEN
        RETURN 9999;
END;
$$;

-- =============================================
-- FN: SUBJECT_SYNC (과목 전체 동기화)
-- 학기는 현재 월을 기반으로 자동 계산 (1~6월:1학기, 7~12월:2학기)
-- JSON 배열로 받은 과목 리스트를 기준으로:
--   1. 새로운 과목 → INSERT
--   2. 기존 과목 → UPDATE (DeleteFlag=0)
--   3. 받지 않은 기존 과목 → UPDATE (DeleteFlag=1)
-- 반환: 0 = 성공, 9999 = 실패
-- =============================================
DROP FUNCTION IF EXISTS "SUBJECT_SYNC"(INTEGER, JSONB);

CREATE OR REPLACE FUNCTION "SUBJECT_SYNC"(
    p_UserNo      INTEGER,
    p_SubjectsJson JSONB
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_Semester VARCHAR(255);
    v_SubjectCode VARCHAR(255);
    v_SubjectName VARCHAR(255);
    v_Item JSONB;
BEGIN
    -- 현재 월을 기반으로 학기 결정 (1~6월: 1학기, 7~12월: 2학기)
    v_Semester := TO_CHAR(NOW(), 'YYYY') || '-' || CASE
        WHEN EXTRACT(MONTH FROM NOW()) <= 6 THEN '1'
        ELSE '2'
    END;

    -- JSON 배열의 각 항목 처리 (INSERT or UPDATE)
    FOR v_Item IN SELECT jsonb_array_elements(p_SubjectsJson)
    LOOP
        v_SubjectCode := v_Item->>'SubjectCode';
        v_SubjectName := v_Item->>'SubjectName';

        INSERT INTO "Subject" (
            "UserNo",
            "SubjectCode",
            "SubjectName",
            "Semester",
            "DeleteFlag",
            "SubjectInsertDate",
            "SubjectUpdateDate"
        ) VALUES (
            p_UserNo,
            v_SubjectCode,
            v_SubjectName,
            v_Semester,
            0,
            NOW(),
            NOW()
        )
        ON CONFLICT ("UserNo", "SubjectCode", "Semester")
        DO UPDATE SET
            "SubjectName" = v_SubjectName,
            "DeleteFlag" = 0,
            "SubjectUpdateDate" = NOW();
    END LOOP;

    -- 기존에 있던 과목 중에 이번 동기화에 없는 것들을 DeleteFlag = 1로 처리
    UPDATE "Subject"
    SET "DeleteFlag" = 1, "SubjectUpdateDate" = NOW()
    WHERE "UserNo" = p_UserNo
      AND "Semester" = v_Semester
      AND "DeleteFlag" = 0
      AND ("SubjectCode", "SubjectName") NOT IN (
        SELECT
            json_item->>'SubjectCode',
            json_item->>'SubjectName'
        FROM jsonb_array_elements(p_SubjectsJson) json_item
      );

    RETURN 0;

EXCEPTION
    WHEN OTHERS THEN
        RAISE WARNING 'SUBJECT_SYNC Error - SQLSTATE: %, Message: %', SQLSTATE, SQLERRM;
        RETURN 9999;
END;
$$;

-- =============================================
-- FN: SUBJECT_LIST (사용자의 모든 과목 조회)
-- DeleteFlag = 0 (삭제되지 않은) 과목만 반환
-- 반환: 과목 목록
-- =============================================
DROP FUNCTION IF EXISTS "SUBJECT_LIST"(INTEGER);

CREATE OR REPLACE FUNCTION "SUBJECT_LIST"(
    p_UserNo INTEGER
)
RETURNS TABLE(
    "SubjectNo"       INTEGER,
    "SubjectCode"     VARCHAR(255),
    "SubjectName"     VARCHAR(255),
    "Semester"        VARCHAR(255),
    "DeleteFlag"      INTEGER,
    "SubjectInsertDate" TIMESTAMP,
    "SubjectUpdateDate" TIMESTAMP
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        s."SubjectNo",
        s."SubjectCode",
        s."SubjectName",
        s."Semester",
        s."DeleteFlag",
        s."SubjectInsertDate",
        s."SubjectUpdateDate"
    FROM "Subject" s
    WHERE s."UserNo" = p_UserNo AND s."DeleteFlag" = 0
    ORDER BY s."Semester" DESC, s."SubjectInsertDate" ASC;
END;
$$;

-- =============================================
-- FN: SUBJECT_LIST_ALL (사용자의 모든 과목 조회 - 삭제된 과목 포함)
-- 반환: 과목 목록
-- =============================================
DROP FUNCTION IF EXISTS "SUBJECT_LIST_ALL"(INTEGER);

CREATE OR REPLACE FUNCTION "SUBJECT_LIST_ALL"(
    p_UserNo INTEGER
)
RETURNS TABLE(
    "SubjectNo"       INTEGER,
    "SubjectCode"     VARCHAR(255),
    "SubjectName"     VARCHAR(255),
    "Semester"        VARCHAR(255),
    "DeleteFlag"      INTEGER,
    "SubjectInsertDate" TIMESTAMP,
    "SubjectUpdateDate" TIMESTAMP
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        s."SubjectNo",
        s."SubjectCode",
        s."SubjectName",
        s."Semester",
        s."DeleteFlag",
        s."SubjectInsertDate",
        s."SubjectUpdateDate"
    FROM "Subject" s
    WHERE s."UserNo" = p_UserNo
    ORDER BY s."Semester" DESC, s."SubjectInsertDate" ASC;
END;
$$;

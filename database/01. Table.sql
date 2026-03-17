-- =============================================
-- Table: User
-- =============================================
DROP TABLE IF EXISTS "User" CASCADE;

CREATE TABLE "User" (
    "UserNo"           SERIAL       PRIMARY KEY,
    "UserUUID"         UUID         NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    "UserKakaoID"      VARCHAR(255) NOT NULL UNIQUE,
    "UserKakaoName"    VARCHAR(255),
    "UserHYUID"        VARCHAR(255),
    "UserHYUName"      VARCHAR(255),
    "UserHYUEmail"     VARCHAR(255),
    "UserPrivateEmail" VARCHAR(255),
    "SyncStatus"       INTEGER      DEFAULT NULL,  -- 1:요청 / 2:처리중 / 3:완료 / 4:실패
    "SyncUpdateDate"   TIMESTAMP    DEFAULT NULL,
    "UserInsertDate"   TIMESTAMP    DEFAULT NULL,
    "UserUpdateDate"   TIMESTAMP    DEFAULT NULL
);

-- =============================================
-- Table: Subject (사용자 수강 과목)
-- =============================================
DROP TABLE IF EXISTS "Subject" CASCADE;

CREATE TABLE "Subject" (
    "SubjectNo"         SERIAL       PRIMARY KEY,
    "UserNo"            INTEGER      NOT NULL REFERENCES "User"("UserNo") ON DELETE CASCADE,
    "LmsID"             INTEGER      NOT NULL,           -- Canvas 내부 course ID (API 호출용)
    "SubjectCode"       VARCHAR(255) NOT NULL,
    "SubjectName"       VARCHAR(255) NOT NULL,
    "Semester"          VARCHAR(255) NOT NULL DEFAULT '',
    "DeleteFlag"        INTEGER      NOT NULL DEFAULT 0,
    "SubjectInsertDate" TIMESTAMP    DEFAULT NULL,
    "SubjectUpdateDate" TIMESTAMP    DEFAULT NULL,
    UNIQUE ("UserNo", "SubjectCode", "Semester")
);

-- =============================================
-- Table: Video (동영상 시청 현황)
-- =============================================
DROP TABLE IF EXISTS "Video" CASCADE;

CREATE TABLE "Video" (
    "VideoNo"         SERIAL        PRIMARY KEY,
    "SubjectNo"       INTEGER       NOT NULL REFERENCES "Subject"("SubjectNo") ON DELETE CASCADE,
    "LmsItemID"       BIGINT        NOT NULL,            -- LearningX module item ID
    "Title"           VARCHAR(500)  NOT NULL,
    "IsWatched"       BOOLEAN       NOT NULL DEFAULT false,
    "DurationSec"     INTEGER       DEFAULT NULL,        -- 영상 길이(초), 파일류는 NULL
    "PeriodStart"     TIMESTAMP     DEFAULT NULL,        -- unlock_at, NULL = 즉시
    "PeriodEnd"       TIMESTAMP     DEFAULT NULL,        -- due_at, NULL = 기한없음
    "VideoInsertDate" TIMESTAMP     DEFAULT NULL,
    "VideoUpdateDate" TIMESTAMP     DEFAULT NULL,
    UNIQUE ("SubjectNo", "LmsItemID")
);

-- =============================================
-- Table: Assignment (과제 제출 현황)
-- =============================================
DROP TABLE IF EXISTS "Assignment" CASCADE;

CREATE TABLE "Assignment" (
    "AssignmentNo"         SERIAL        PRIMARY KEY,
    "SubjectNo"            INTEGER       NOT NULL REFERENCES "Subject"("SubjectNo") ON DELETE CASCADE,
    "LmsAssignmentID"      INTEGER       NOT NULL,       -- Canvas assignment ID
    "Title"                VARCHAR(500)  NOT NULL,
    "IsSubmitted"          BOOLEAN       NOT NULL DEFAULT false,
    "WorkflowState"        VARCHAR(50)   DEFAULT NULL,   -- submitted / graded / unsubmitted
    "PeriodStart"          TIMESTAMP     DEFAULT NULL,   -- unlock_at, NULL = 즉시
    "PeriodEnd"            TIMESTAMP     DEFAULT NULL,   -- due_at
    "AssignmentInsertDate" TIMESTAMP     DEFAULT NULL,
    "AssignmentUpdateDate" TIMESTAMP     DEFAULT NULL,
    UNIQUE ("SubjectNo", "LmsAssignmentID")
);

-- =============================================
-- Supabase Realtime Publication 설정
-- User 테이블 변경사항(SyncStatus)을 WAL로 노출
-- Extension은 UserUUID 필터로 본인 row만 구독
-- =============================================
DROP PUBLICATION IF EXISTS supabase_realtime;
CREATE PUBLICATION supabase_realtime FOR TABLE "User";

-- Realtime postgres_cdc_rls 모드: JWT role:"anon" 권한 체크용
DO $$ BEGIN
    CREATE ROLE anon NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
GRANT SELECT ON "User" TO anon;

-- WAL에 전체 열 포함 (UserUUID 필터 및 SyncStatus 값 전달에 필요)
ALTER TABLE "User" REPLICA IDENTITY FULL;

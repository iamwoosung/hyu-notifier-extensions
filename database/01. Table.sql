-- =============================================
-- Table: User
-- =============================================
DROP TABLE IF EXISTS "User";

CREATE TABLE "User" (
    "UserNo"           SERIAL       PRIMARY KEY,
    "UserUUID"         UUID         NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    "UserKakaoID"      VARCHAR(255) NOT NULL UNIQUE,
    "UserKakaoName"    VARCHAR(255),
    "UserHYUID"        VARCHAR(255),
    "UserHYUName"      VARCHAR(255),
    "UserHYUEmail"     VARCHAR(255),
    "UserPrivateEmail" VARCHAR(255),
    "UserInsertDate"   TIMESTAMP    DEFAULT NULL,
    "UserUpdateDate"   TIMESTAMP    DEFAULT NULL
);

-- =============================================
-- Table: Subject (사용자 수강 과목)
-- =============================================
DROP TABLE IF EXISTS "Subject";

CREATE TABLE "Subject" (
    "SubjectNo"       SERIAL       PRIMARY KEY,
    "UserNo"          INTEGER      NOT NULL REFERENCES "User"("UserNo") ON DELETE CASCADE,
    "SubjectCode"     VARCHAR(255) NOT NULL,
    "SubjectName"     VARCHAR(255) NOT NULL,
    "Semester"        VARCHAR(255) NOT NULL DEFAULT '',
    "DeleteFlag"      INTEGER      NOT NULL DEFAULT 0,
    "SubjectInsertDate" TIMESTAMP  DEFAULT NULL,
    "SubjectUpdateDate" TIMESTAMP  DEFAULT NULL,
    UNIQUE ("UserNo", "SubjectCode", "Semester")
);

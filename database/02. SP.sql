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

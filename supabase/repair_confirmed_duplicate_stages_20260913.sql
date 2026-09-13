-- OfferPilot v3.5.3：修复 2026-09-13 已人工核对的 4 组重复求职环节。
--
-- 处理原则：
-- 1. 不删除邮件或环节，只将重复环节软标记为 ignored；
-- 2. 不推测用户是否参加活动，不改变保留环节的业务状态；
-- 3. 同一环节的后续邮件保留在 stage_notifications，并改记为 reminder；
-- 4. 修复后按仍有效的最新环节重算 applications.current_stage_name。
--
-- 请先执行 inspect_duplicate_stage_details.sql 核对数据，再在 Supabase SQL Editor
-- 中完整执行本文件。任一前置校验失败时，整个事务都会回滚。

BEGIN;

CREATE TEMP TABLE confirmed_duplicate_stage_repairs (
    group_name TEXT NOT NULL,
    application_id UUID NOT NULL,
    keep_stage_id UUID NOT NULL,
    duplicate_stage_id UUID NOT NULL,
    expected_stage_name TEXT NOT NULL,
    expected_schedule_time TEXT NOT NULL
) ON COMMIT DROP;

INSERT INTO confirmed_duplicate_stage_repairs (
    group_name,
    application_id,
    keep_stage_id,
    duplicate_stage_id,
    expected_stage_name,
    expected_schedule_time
)
VALUES
    (
        '上海光通信·宣讲会',
        'f5f1ffa2-2332-490c-800f-69bb2fe1080f',
        'f7e76e15-356f-41b7-aaf4-e08f42d57b12',
        '4321a1d8-72df-4a83-80c8-4f91ecf5c3c2',
        '宣讲会',
        '2026-09-08 14:00'
    ),
    (
        '工商银行·邮箱验证',
        '1ffec6c5-fb61-4b27-b177-4a3902c9bc52',
        '41701b7e-ac45-41b9-a586-74381413e5e7',
        '696c4d7e-a5f6-4939-be48-a1156f220372',
        '邮箱验证',
        '待定'
    ),
    (
        '京东·综合测评',
        '08c90ad3-9070-4ac5-8911-a454806e0886',
        '92e79073-6d75-4380-9cde-e7061cfd726d',
        '897278e7-a3f7-4383-9d6b-adff3ccd59e7',
        '综合测评',
        '待定'
    ),
    (
        '苏纳光电·宣讲会',
        '2656ea82-dcf3-47a7-8eb9-301e6e2af2fd',
        '9bcc9a7f-83a6-48e6-8d6c-32c8ba0bdede',
        'f87e4d2d-37ee-49a6-b6a9-cfcd39c15e37',
        '宣讲会',
        '2026-09-15 19:00'
    );

-- 防止数据已变化时误修其他记录。
DO $$
DECLARE
    invalid_group_count INTEGER;
BEGIN
    SELECT COUNT(*)
    INTO invalid_group_count
    FROM confirmed_duplicate_stage_repairs repair
    LEFT JOIN public.application_stages kept
        ON kept.id = repair.keep_stage_id
    LEFT JOIN public.application_stages duplicate
        ON duplicate.id = repair.duplicate_stage_id
    WHERE kept.id IS NULL
       OR duplicate.id IS NULL
       OR kept.application_id <> repair.application_id
       OR duplicate.application_id <> repair.application_id
       OR kept.stage_name <> repair.expected_stage_name
       OR duplicate.stage_name <> repair.expected_stage_name
       OR COALESCE(kept.schedule_time, '待定') <> repair.expected_schedule_time
       OR COALESCE(duplicate.schedule_time, '待定') <> repair.expected_schedule_time;

    IF invalid_group_count > 0 THEN
        RAISE EXCEPTION
            '重复环节修复已中止：% 组数据与 2026-09-13 核对结果不一致',
            invalid_group_count;
    END IF;
END $$;

-- 将重复记录中更完整但不冲突的信息合并到保留环节。
UPDATE public.application_stages
SET
    notes = '线下宣讲会，地点：东南大学九龙湖校区教三102；时间：9月8日14:00-16:00；需准备简历现场投递。',
    updated_at = NOW()
WHERE id = 'f7e76e15-356f-41b7-aaf4-e08f42d57b12';

UPDATE public.application_stages
SET
    meeting_info = 'https://job.icbc.com.cn',
    updated_at = NOW()
WHERE id = '41701b7e-ac45-41b9-a586-74381413e5e7';

UPDATE public.application_stages
SET
    meeting_info = 'https://campus.jd.com',
    updated_at = NOW()
WHERE id = '92e79073-6d75-4380-9cde-e7061cfd726d';

-- 后续提醒邮件挂回保留环节；同一 UID 重复建环节的两组没有待迁移通知。
UPDATE public.stage_notifications notification
SET
    stage_id = repair.keep_stage_id,
    event_type = CASE
        WHEN notification.event_type = 'new_stage' THEN 'reminder'
        ELSE notification.event_type
    END,
    updated_at = NOW()
FROM confirmed_duplicate_stage_repairs repair
WHERE notification.stage_id = repair.duplicate_stage_id;

-- 软忽略重复环节，保留完整审计信息，避免不可逆删除。
UPDATE public.application_stages duplicate
SET
    stage_status = 'ignored',
    updated_at = NOW()
FROM confirmed_duplicate_stage_repairs repair
WHERE duplicate.id = repair.duplicate_stage_id;

-- 修复被重复高 seq 环节覆盖的投递快照（尤其是京东 seq=5）。
UPDATE public.applications application
SET
    current_stage_name = (
        SELECT stage.stage_name
        FROM public.application_stages stage
        WHERE stage.application_id = application.id
          AND stage.stage_status <> 'ignored'
        ORDER BY stage.seq DESC, stage.created_at DESC
        LIMIT 1
    ),
    updated_at = NOW()
WHERE application.id IN (
    SELECT DISTINCT application_id
    FROM confirmed_duplicate_stage_repairs
)
AND EXISTS (
    SELECT 1
    FROM public.application_stages stage
    WHERE stage.application_id = application.id
      AND stage.stage_status <> 'ignored'
);

-- 执行结果：每组应显示 retained / ignored，以及迁移后的邮件事件数量。
SELECT
    repair.group_name,
    kept.id AS retained_stage_id,
    kept.seq AS retained_seq,
    kept.stage_status AS retained_status,
    duplicate.id AS ignored_stage_id,
    duplicate.seq AS ignored_seq,
    duplicate.stage_status AS duplicate_status,
    COUNT(notification.id) FILTER (
        WHERE notification.stage_id = kept.id
    ) AS retained_notification_count,
    application.current_stage_name
FROM confirmed_duplicate_stage_repairs repair
JOIN public.application_stages kept ON kept.id = repair.keep_stage_id
JOIN public.application_stages duplicate ON duplicate.id = repair.duplicate_stage_id
JOIN public.applications application ON application.id = repair.application_id
LEFT JOIN public.stage_notifications notification
    ON notification.stage_id IN (kept.id, duplicate.id)
GROUP BY
    repair.group_name,
    kept.id,
    kept.seq,
    kept.stage_status,
    duplicate.id,
    duplicate.seq,
    duplicate.stage_status,
    application.current_stage_name
ORDER BY repair.group_name;

COMMIT;

-- 仅用于回滚 repair_confirmed_duplicate_stages_20260913.sql。
-- 如果修复后又处理了新邮件，请勿直接执行本文件，应先重新核对最新数据。

BEGIN;

-- 恢复被软忽略的 4 条环节及修复前的更新时间。
UPDATE public.application_stages
SET stage_status = 'pending', updated_at = '2026-09-08 02:15:35.865722+00'
WHERE id = '4321a1d8-72df-4a83-80c8-4f91ecf5c3c2';

UPDATE public.application_stages
SET stage_status = 'passed', updated_at = '2026-09-11 09:16:09.289+00'
WHERE id = '696c4d7e-a5f6-4939-be48-a1156f220372';

UPDATE public.application_stages
SET stage_status = 'pending', updated_at = '2026-09-12 06:01:17.040881+00'
WHERE id = '897278e7-a3f7-4383-9d6b-adff3ccd59e7';

UPDATE public.application_stages
SET stage_status = 'pending', updated_at = '2026-09-12 02:50:10.731525+00'
WHERE id = 'f87e4d2d-37ee-49a6-b6a9-cfcd39c15e37';

-- 恢复被合并字段。
UPDATE public.application_stages
SET
    notes = '线下宣讲会，地点：东南大学九龙湖校区教三102；需准备简历现场投递。',
    updated_at = '2026-09-07 02:15:33.201237+00'
WHERE id = 'f7e76e15-356f-41b7-aaf4-e08f42d57b12';

UPDATE public.application_stages
SET meeting_info = '', updated_at = '2026-09-11 09:16:09.289+00'
WHERE id = '41701b7e-ac45-41b9-a586-74381413e5e7';

UPDATE public.application_stages
SET meeting_info = '', updated_at = '2026-09-03 11:16:24.466+00'
WHERE id = '92e79073-6d75-4380-9cde-e7061cfd726d';

-- 恢复两封后续邮件原来的环节关联和事件类型。
UPDATE public.stage_notifications
SET
    stage_id = '4321a1d8-72df-4a83-80c8-4f91ecf5c3c2',
    event_type = 'new_stage',
    updated_at = NOW()
WHERE raw_email_id = '1203';

UPDATE public.stage_notifications
SET
    stage_id = '696c4d7e-a5f6-4939-be48-a1156f220372',
    event_type = 'new_stage',
    updated_at = NOW()
WHERE raw_email_id = '1250';

-- 恢复核对时的投递快照。
UPDATE public.applications
SET current_stage_name = CASE id
    WHEN 'f5f1ffa2-2332-490c-800f-69bb2fe1080f' THEN '宣讲会'
    WHEN '1ffec6c5-fb61-4b27-b177-4a3902c9bc52' THEN '网申提交'
    WHEN '08c90ad3-9070-4ac5-8911-a454806e0886' THEN '综合测评'
    WHEN '2656ea82-dcf3-47a7-8eb9-301e6e2af2fd' THEN '宣讲会'
END,
updated_at = NOW()
WHERE id IN (
    'f5f1ffa2-2332-490c-800f-69bb2fe1080f',
    '1ffec6c5-fb61-4b27-b177-4a3902c9bc52',
    '08c90ad3-9070-4ac5-8911-a454806e0886',
    '2656ea82-dcf3-47a7-8eb9-301e6e2af2fd'
);

COMMIT;

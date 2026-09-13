-- v3.5.3 历史重复阶段修复前的只读明细检查。
-- 仅覆盖 2026-09-13 审计发现的 4 组、8 条记录，不修改任何数据。

WITH target_stages(group_name, application_id, stage_id) AS (
    VALUES
        ('上海光通信·宣讲会', 'f5f1ffa2-2332-490c-800f-69bb2fe1080f'::uuid, 'f7e76e15-356f-41b7-aaf4-e08f42d57b12'::uuid),
        ('上海光通信·宣讲会', 'f5f1ffa2-2332-490c-800f-69bb2fe1080f'::uuid, '4321a1d8-72df-4a83-80c8-4f91ecf5c3c2'::uuid),
        ('工商银行·邮箱验证', '1ffec6c5-fb61-4b27-b177-4a3902c9bc52'::uuid, '41701b7e-ac45-41b9-a586-74381413e5e7'::uuid),
        ('工商银行·邮箱验证', '1ffec6c5-fb61-4b27-b177-4a3902c9bc52'::uuid, '696c4d7e-a5f6-4939-be48-a1156f220372'::uuid),
        ('京东·综合测评', '08c90ad3-9070-4ac5-8911-a454806e0886'::uuid, '92e79073-6d75-4380-9cde-e7061cfd726d'::uuid),
        ('京东·综合测评', '08c90ad3-9070-4ac5-8911-a454806e0886'::uuid, '897278e7-a3f7-4383-9d6b-adff3ccd59e7'::uuid),
        ('苏纳光电·宣讲会', '2656ea82-dcf3-47a7-8eb9-301e6e2af2fd'::uuid, '9bcc9a7f-83a6-48e6-8d6c-32c8ba0bdede'::uuid),
        ('苏纳光电·宣讲会', '2656ea82-dcf3-47a7-8eb9-301e6e2af2fd'::uuid, 'f87e4d2d-37ee-49a6-b6a9-cfcd39c15e37'::uuid)
), notification_summary AS (
    SELECT
        stage_id,
        COUNT(*) AS linked_notification_count,
        ARRAY_AGG(event_type ORDER BY received_at) AS notification_event_types,
        ARRAY_AGG(raw_email_id ORDER BY received_at) AS notification_email_ids,
        ARRAY_AGG(raw_subject ORDER BY received_at) AS notification_subjects
    FROM public.stage_notifications
    WHERE stage_id IN (SELECT stage_id FROM target_stages)
    GROUP BY stage_id
)
SELECT
    target.group_name,
    app.company,
    app.position,
    app.current_stage_name AS application_current_stage,
    stage.id AS stage_id,
    stage.seq,
    stage.stage_name,
    stage.stage_status,
    stage.schedule_time,
    stage.schedule_type,
    stage.next_expectation,
    stage.meeting_info,
    stage.notes,
    stage.raw_email_id,
    stage.raw_subject,
    stage.created_at,
    stage.updated_at,
    COALESCE(summary.linked_notification_count, 0) AS linked_notification_count,
    COALESCE(summary.notification_event_types, ARRAY[]::text[]) AS notification_event_types,
    COALESCE(summary.notification_email_ids, ARRAY[]::text[]) AS notification_email_ids,
    COALESCE(summary.notification_subjects, ARRAY[]::text[]) AS notification_subjects
FROM target_stages target
JOIN public.application_stages stage ON stage.id = target.stage_id
JOIN public.applications app ON app.id = target.application_id
LEFT JOIN notification_summary summary ON summary.stage_id = stage.id
ORDER BY target.group_name, stage.seq, stage.created_at;

-- OfferPilot 历史阶段只读检查报告。
-- 本文件仅执行 SELECT，不会修改或删除任何数据。

-- 1. 查找可见轮次跳号的投递路线。
WITH visible_rounds AS (
    SELECT DISTINCT application_id, seq
    FROM public.application_stages
    WHERE stage_status <> 'ignored'
), ranked_rounds AS (
    SELECT
        application_id,
        seq,
        ROW_NUMBER() OVER (PARTITION BY application_id ORDER BY seq) AS visible_round
    FROM visible_rounds
)
SELECT
    a.company,
    a.position,
    r.application_id,
    r.seq AS stored_seq,
    r.visible_round
FROM ranked_rounds r
JOIN public.applications a ON a.id = r.application_id
WHERE r.seq <> r.visible_round
ORDER BY a.company, r.application_id, r.seq;

-- 2. 查找同一投递路线中名称和时间均相同的疑似重复阶段。
SELECT
    a.company,
    a.position,
    s.application_id,
    LOWER(TRIM(s.stage_name)) AS normalized_stage_name,
    COALESCE(NULLIF(TRIM(s.schedule_time), ''), '待定') AS normalized_schedule_time,
    COUNT(*) AS duplicate_count,
    ARRAY_AGG(s.id ORDER BY s.seq, s.created_at) AS stage_ids,
    ARRAY_AGG(s.seq ORDER BY s.seq, s.created_at) AS stored_sequences,
    ARRAY_AGG(s.raw_subject ORDER BY s.seq, s.created_at) AS email_subjects
FROM public.application_stages s
JOIN public.applications a ON a.id = s.application_id
WHERE s.stage_status <> 'ignored'
GROUP BY
    a.company,
    a.position,
    s.application_id,
    LOWER(TRIM(s.stage_name)),
    COALESCE(NULLIF(TRIM(s.schedule_time), ''), '待定')
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC, a.company;

-- 3. 查找同阶段的多封待审邮件，便于验证新归并逻辑。
SELECT
    a.company,
    a.position,
    n.application_id,
    n.proposed_stage_name,
    COUNT(*) AS pending_email_count,
    ARRAY_AGG(n.event_type ORDER BY n.received_at) AS event_types,
    ARRAY_AGG(n.raw_subject ORDER BY n.received_at) AS email_subjects
FROM public.stage_notifications n
JOIN public.applications a ON a.id = n.application_id
WHERE n.review_status = 'pending'
GROUP BY a.company, a.position, n.application_id, n.proposed_stage_name
HAVING COUNT(*) > 1
ORDER BY pending_email_count DESC, a.company;

-- OfferPilot v3.5.3：将“邮件事件”与“真实求职阶段”分离。
-- 先在 Supabase SQL Editor 执行本文件，再部署新版 cloud/worker.py。

CREATE TABLE IF NOT EXISTS public.stage_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id UUID NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
    stage_id UUID REFERENCES public.application_stages(id) ON DELETE SET NULL,
    raw_email_id TEXT NOT NULL,
    event_type TEXT NOT NULL DEFAULT 'new_stage'
        CHECK (event_type IN ('new_stage', 'reminder', 'reschedule', 'result', 'cancel')),
    review_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (review_status IN ('pending', 'approved', 'ignored')),
    proposed_stage_name TEXT NOT NULL DEFAULT '求职通知',
    proposed_stage_status TEXT NOT NULL DEFAULT 'scheduled',
    schedule_time TEXT DEFAULT '待定',
    schedule_type TEXT DEFAULT 'unknown'
        CHECK (schedule_type IN ('start', 'deadline', 'unknown')),
    meeting_info TEXT DEFAULT '',
    next_expectation TEXT DEFAULT '',
    raw_subject TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    received_at TIMESTAMPTZ DEFAULT NOW(),
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_stage_notifications_raw_email
    ON public.stage_notifications(raw_email_id);
CREATE INDEX IF NOT EXISTS idx_stage_notifications_review
    ON public.stage_notifications(review_status, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_stage_notifications_application_stage
    ON public.stage_notifications(application_id, stage_id, received_at DESC);

ALTER TABLE public.stage_notifications ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'stage_notifications'
          AND policyname = 'Allow public all stage notifications'
    ) THEN
        CREATE POLICY "Allow public all stage notifications"
            ON public.stage_notifications
            FOR ALL
            USING (true)
            WITH CHECK (true);
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
       AND NOT EXISTS (
           SELECT 1
           FROM pg_publication_tables
           WHERE pubname = 'supabase_realtime'
             AND schemaname = 'public'
             AND tablename = 'stage_notifications'
       ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.stage_notifications;
    END IF;
END $$;

-- 将既有带邮件 UID 的阶段登记为已处理通知，只做审计回填，不修改任何历史阶段。
INSERT INTO public.stage_notifications (
    application_id,
    stage_id,
    raw_email_id,
    event_type,
    review_status,
    proposed_stage_name,
    proposed_stage_status,
    schedule_time,
    schedule_type,
    meeting_info,
    next_expectation,
    raw_subject,
    notes,
    received_at,
    reviewed_at,
    created_at,
    updated_at
)
SELECT
    application_id,
    id,
    raw_email_id,
    'new_stage',
    CASE WHEN stage_status = 'ignored' THEN 'ignored' ELSE 'approved' END,
    stage_name,
    stage_status,
    schedule_time,
    schedule_type,
    meeting_info,
    next_expectation,
    raw_subject,
    notes,
    created_at,
    updated_at,
    created_at,
    updated_at
FROM public.application_stages
WHERE COALESCE(raw_email_id, '') <> ''
ON CONFLICT (raw_email_id) DO NOTHING;

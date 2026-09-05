-- 为现有求职企业与招聘会增加统一的“重点关心”标记。可重复执行。
BEGIN;

ALTER TABLE public.applications
    ADD COLUMN IF NOT EXISTS is_focused BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.recruitment_events
    ADD COLUMN IF NOT EXISTS is_focused BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_applications_focused
    ON public.applications(is_focused) WHERE is_focused = TRUE;

CREATE INDEX IF NOT EXISTS idx_recruitment_events_focused
    ON public.recruitment_events(is_focused) WHERE is_focused = TRUE;

COMMIT;

-- OfferPilot v3.5.0：为既有时间增加“开始/截止/待定”语义，不改动 schedule_time 原文。
ALTER TABLE public.application_stages
ADD COLUMN IF NOT EXISTS schedule_type TEXT DEFAULT 'unknown';

ALTER TABLE public.application_stages
DROP CONSTRAINT IF EXISTS application_stages_schedule_type_check;

ALTER TABLE public.application_stages
ADD CONSTRAINT application_stages_schedule_type_check
CHECK (schedule_type IN ('start', 'deadline', 'unknown'));

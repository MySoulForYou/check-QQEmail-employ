-- 手动执行一次。不改变现有 applications / application_stages。
-- 与项目现有个人版访问模式一致：anon key 可读写；请勿用于公开多用户部署。
BEGIN;
CREATE TABLE IF NOT EXISTS public.recruitment_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL CHECK (length(trim(title)) > 0),
    event_type TEXT NOT NULL DEFAULT '招聘会' CHECK (event_type IN ('招聘会', '双选会', '宣讲会')),
    organizer TEXT NOT NULL DEFAULT '',
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ,
    location TEXT NOT NULL DEFAULT '',
    url TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'attended', 'cancelled')),
    in_calendar BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (ends_at IS NULL OR ends_at >= starts_at)
);
CREATE INDEX IF NOT EXISTS idx_recruitment_events_start ON public.recruitment_events(starts_at);
ALTER TABLE public.recruitment_events ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'recruitment_events' AND policyname = 'Personal recruitment events') THEN
        CREATE POLICY "Personal recruitment events" ON public.recruitment_events FOR ALL USING (true) WITH CHECK (true);
    END IF;
END $$;
GRANT SELECT, INSERT, UPDATE ON public.recruitment_events TO anon, authenticated;
DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.recruitment_events;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
COMMIT;

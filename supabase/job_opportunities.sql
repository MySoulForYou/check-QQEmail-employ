-- OfferPilot 招聘需求收藏表
-- 在 Supabase SQL Editor 中执行一次；不会删除或修改现有投递数据。

CREATE TABLE IF NOT EXISTS job_opportunities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id UUID REFERENCES applications(id) ON DELETE SET NULL,
    company TEXT NOT NULL,
    department TEXT DEFAULT '',
    position TEXT NOT NULL,
    job_code TEXT DEFAULT '',
    location TEXT DEFAULT '',
    recruitment_type TEXT DEFAULT '',
    published_at TEXT DEFAULT '',
    deadline TEXT DEFAULT '',
    responsibilities TEXT DEFAULT '',
    requirements TEXT DEFAULT '',
    source_url TEXT DEFAULT '',
    content_hash TEXT DEFAULT '',
    status TEXT DEFAULT 'saved',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE job_opportunities ALTER COLUMN source_url DROP NOT NULL;
ALTER TABLE job_opportunities ALTER COLUMN source_url SET DEFAULT '';

DROP INDEX IF EXISTS idx_job_opportunities_source_url;
CREATE UNIQUE INDEX idx_job_opportunities_source_url
    ON job_opportunities(source_url) WHERE source_url <> '';
CREATE INDEX IF NOT EXISTS idx_job_opportunities_application ON job_opportunities(application_id);
CREATE INDEX IF NOT EXISTS idx_job_opportunities_company_position ON job_opportunities(company, position);

ALTER TABLE job_opportunities ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'job_opportunities'
          AND policyname = 'Allow public all job opportunities'
    ) THEN
        CREATE POLICY "Allow public all job opportunities"
            ON job_opportunities FOR ALL USING (true) WITH CHECK (true);
    END IF;
END $$;

DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE job_opportunities;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;


CREATE TABLE public.ad_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_url TEXT NOT NULL,
  brand JSONB NOT NULL DEFAULT '{}'::jsonb,
  script JSONB NOT NULL DEFAULT '{}'::jsonb,
  scenes JSONB NOT NULL DEFAULT '[]'::jsonb,
  qr_code_data_url TEXT,
  end_card JSONB NOT NULL DEFAULT '{}'::jsonb,
  duration_sec INT NOT NULL DEFAULT 21,
  voice_audio_url TEXT,
  music_genre TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.generation_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  step_logs JSONB NOT NULL DEFAULT '[]'::jsonb,
  project_id UUID REFERENCES public.ad_projects(id) ON DELETE SET NULL,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.ad_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.generation_jobs ENABLE ROW LEVEL SECURITY;

-- Demo: open access (no auth)
CREATE POLICY "public read ad_projects" ON public.ad_projects FOR SELECT USING (true);
CREATE POLICY "public insert ad_projects" ON public.ad_projects FOR INSERT WITH CHECK (true);
CREATE POLICY "public update ad_projects" ON public.ad_projects FOR UPDATE USING (true);

CREATE POLICY "public read jobs" ON public.generation_jobs FOR SELECT USING (true);
CREATE POLICY "public insert jobs" ON public.generation_jobs FOR INSERT WITH CHECK (true);
CREATE POLICY "public update jobs" ON public.generation_jobs FOR UPDATE USING (true);

CREATE INDEX idx_jobs_created ON public.generation_jobs(created_at DESC);
CREATE INDEX idx_projects_created ON public.ad_projects(created_at DESC);

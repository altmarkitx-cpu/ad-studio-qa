ALTER TABLE public.ad_projects
  ADD COLUMN IF NOT EXISTS music_bed_id TEXT,
  ADD COLUMN IF NOT EXISTS ad_category TEXT,
  ADD COLUMN IF NOT EXISTS ad_template TEXT,
  ADD COLUMN IF NOT EXISTS voiceover_audio_data_url TEXT,
  ADD COLUMN IF NOT EXISTS voiceover_audio_name TEXT;


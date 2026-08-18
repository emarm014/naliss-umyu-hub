-- ── 1. Enable Caching Extensions ──
CREATE EXTENSION IF NOT EXISTS "pg_prewarm" WITH SCHEMA "extensions";
CREATE EXTENSION IF NOT EXISTS "pg_trgm" WITH SCHEMA "extensions";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";

-- ── 2. B-Tree Indexes on created_at for Temporal Sorting ──
CREATE INDEX IF NOT EXISTS idx_announcements_created_at ON public.announcements(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_created_at ON public.news(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gallery_media_created_at ON public.gallery_media(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_resources_created_at ON public.resources(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_archives_created_at ON public.archives(created_at DESC);

-- ── 3. Trigram Indexes for Text Search (Title/Content) ──
-- Trigram indexes allow super-fast ILIKE '%search%' queries
CREATE INDEX IF NOT EXISTS idx_announcements_title_trgm ON public.announcements USING gin(title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_news_title_trgm ON public.news USING gin(title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_resources_title_trgm ON public.resources USING gin(title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_archives_title_trgm ON public.archives USING gin(title gin_trgm_ops);

-- ── 4. Prewarm Frequently Accessed Tables ──
-- This creates a function that the admin/cron can call to load the tables into memory.
CREATE OR REPLACE FUNCTION public.prewarm_critical_tables()
RETURNS void AS $$
BEGIN
  -- We use pg_prewarm to load blocks into the OS cache / Postgres shared buffers
  PERFORM extensions.pg_prewarm('public.users');
  PERFORM extensions.pg_prewarm('public.messages');
  PERFORM extensions.pg_prewarm('public.announcements');
  PERFORM extensions.pg_prewarm('public.news');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

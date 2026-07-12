-- Add JSONB 'files' column to 'news' and 'archives'
ALTER TABLE public.news ADD COLUMN IF NOT EXISTS files JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.archives ADD COLUMN IF NOT EXISTS files JSONB DEFAULT '[]'::jsonb;

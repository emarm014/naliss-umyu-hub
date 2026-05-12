-- Institutional Announcement Hardening: Real-time Read-Tracking
-- This migration ensures that we can track which announcements each student has seen
-- to provide accurate notification counts and persistent "Read" states.

-- 1. Create the user_announcement_reads table
CREATE TABLE IF NOT EXISTS public.user_announcement_reads (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  announcement_id uuid REFERENCES public.announcements(id) ON DELETE CASCADE,
  read_at timestamptz DEFAULT now(),
  UNIQUE(user_id, announcement_id)
);

-- 2. Add RLS Policies
ALTER TABLE public.user_announcement_reads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own read status"
  ON public.user_announcement_reads FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can mark announcements as read"
  ON public.user_announcement_reads FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- 3. Mark Announcement as Read RPC
CREATE OR REPLACE FUNCTION public.mark_announcement_as_read(a_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.user_announcement_reads (user_id, announcement_id)
  VALUES (auth.uid(), a_id)
  ON CONFLICT (user_id, announcement_id) DO NOTHING;
END;
$$;

-- 4. Mark All Announcements as Read RPC
CREATE OR REPLACE FUNCTION public.mark_all_announcements_as_read(u_level text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.user_announcement_reads (user_id, announcement_id)
  SELECT auth.uid(), a.id
  FROM public.announcements a
  WHERE a.is_published = true
  AND (u_level IS NULL OR a.target_level IS NULL OR a.target_level = u_level)
  ON CONFLICT (user_id, announcement_id) DO NOTHING;
END;
$$;

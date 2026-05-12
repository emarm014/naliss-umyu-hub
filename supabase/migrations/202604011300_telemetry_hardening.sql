-- Institutional Hardening: Telemetry RPCs
-- This migration ensures that the mobile application can securely increment 
-- engagement metrics (downloads and views) using dedicated RPC functions.

-- 1. Increment Material Download Count
CREATE OR REPLACE FUNCTION public.increment_material_download_count(material_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.materials
  SET download_count = COALESCE(download_count, 0) + 1
  WHERE id = material_id;
END;
$$;

-- 2. Increment Past Question Download Count
CREATE OR REPLACE FUNCTION public.increment_pq_download_count(pq_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.past_questions
  SET download_count = COALESCE(download_count, 0) + 1
  WHERE id = pq_id;
END;
$$;

-- 3. Increment Announcement View Count
CREATE OR REPLACE FUNCTION public.increment_announcement_view_count(announcement_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.announcements
  SET view_count = COALESCE(view_count, 0) + 1
  WHERE id = announcement_id;
END;
$$;

-- 4. Increment Event View Count
CREATE OR REPLACE FUNCTION public.increment_event_view_count(event_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.events
  SET view_count = COALESCE(view_count, 0) + 1
  WHERE id = event_id;
END;
$$;

-- 5. Increment Material View Count
CREATE OR REPLACE FUNCTION public.increment_material_view_count(material_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.materials
  SET view_count = COALESCE(view_count, 0) + 1
  WHERE id = material_id;
END;
$$;

-- 6. Increment Past Question View Count
CREATE OR REPLACE FUNCTION public.increment_pq_view_count(pq_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.past_questions
  SET view_count = COALESCE(view_count, 0) + 1
  WHERE id = pq_id;
END;
$$;

-- Grant permissions to authenticated users to execute these functions
GRANT EXECUTE ON FUNCTION public.increment_material_download_count(uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.increment_pq_download_count(uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.increment_announcement_view_count(uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.increment_event_view_count(uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.increment_material_view_count(uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.increment_pq_view_count(uuid) TO authenticated, anon;

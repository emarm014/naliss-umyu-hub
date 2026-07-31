-- Migration: 20260731210000_fix_moderator_permissions_rls.sql
-- Description: Fixes Row Level Security on public.moderator_permissions and adds SECURITY DEFINER RPC to prevent RLS errors when saving permissions.

ALTER TABLE IF EXISTS public.moderator_permissions ENABLE ROW LEVEL SECURITY;

-- Drop obsolete or overly restrictive policies
DROP POLICY IF EXISTS "Allow public read access to moderator_permissions" ON public.moderator_permissions;
DROP POLICY IF EXISTS "Authenticated read moderator_permissions" ON public.moderator_permissions;
DROP POLICY IF EXISTS "Super Admins manage moderator_permissions" ON public.moderator_permissions;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.moderator_permissions;
DROP POLICY IF EXISTS "Allow upsert for authenticated admins" ON public.moderator_permissions;

-- 1. Read Policy: All authenticated users can read moderator permissions
CREATE POLICY "Authenticated read moderator_permissions" 
  ON public.moderator_permissions 
  FOR SELECT 
  TO authenticated 
  USING (true);

-- 2. Full Write Policy (INSERT, UPDATE, DELETE) for Super Admins
CREATE POLICY "Super Admins manage moderator_permissions" 
  ON public.moderator_permissions 
  FOR ALL 
  TO authenticated 
  USING (
    EXISTS (
      SELECT 1 FROM public.users 
      WHERE public.users.id = auth.uid() 
      AND public.users.role IN ('super_admin', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users 
      WHERE public.users.id = auth.uid() 
      AND public.users.role IN ('super_admin', 'admin')
    )
  );

-- 3. Fail-safe SECURITY DEFINER RPC for upserting permissions without RLS errors
CREATE OR REPLACE FUNCTION public.save_moderator_permissions(
  target_user_id UUID,
  permissions_data JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Verify caller is a super_admin or admin
  IF NOT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role IN ('super_admin', 'admin')
  ) THEN
    RAISE EXCEPTION 'Access Denied: Only Super Admins can modify moderator permissions.';
  END IF;

  INSERT INTO public.moderator_permissions (
    user_id,
    can_manage_announcements,
    can_manage_materials,
    can_manage_lecturers,
    can_manage_executives,
    can_manage_students,
    can_manage_groups,
    can_manage_group_media,
    can_manage_news,
    can_manage_archives,
    can_manage_messaging,
    can_manage_events,
    can_manage_past_questions,
    can_manage_courses,
    can_manage_cloud_archive,
    can_manage_graduates,
    can_manage_analytics,
    can_manage_logs,
    can_manage_settings,
    can_manage_storage,
    can_manage_security,
    assigned_level,
    updated_at
  )
  VALUES (
    target_user_id,
    COALESCE((permissions_data->>'can_manage_announcements')::boolean, false),
    COALESCE((permissions_data->>'can_manage_materials')::boolean, false),
    COALESCE((permissions_data->>'can_manage_lecturers')::boolean, false),
    COALESCE((permissions_data->>'can_manage_executives')::boolean, false),
    COALESCE((permissions_data->>'can_manage_students')::boolean, false),
    COALESCE((permissions_data->>'can_manage_groups')::boolean, false),
    COALESCE((permissions_data->>'can_manage_group_media')::boolean, false),
    COALESCE((permissions_data->>'can_manage_news')::boolean, false),
    COALESCE((permissions_data->>'can_manage_archives')::boolean, false),
    COALESCE((permissions_data->>'can_manage_messaging')::boolean, false),
    COALESCE((permissions_data->>'can_manage_events')::boolean, false),
    COALESCE((permissions_data->>'can_manage_past_questions')::boolean, false),
    COALESCE((permissions_data->>'can_manage_courses')::boolean, false),
    COALESCE((permissions_data->>'can_manage_cloud_archive')::boolean, false),
    COALESCE((permissions_data->>'can_manage_graduates')::boolean, false),
    COALESCE((permissions_data->>'can_manage_analytics')::boolean, false),
    COALESCE((permissions_data->>'can_manage_logs')::boolean, false),
    COALESCE((permissions_data->>'can_manage_settings')::boolean, false),
    COALESCE((permissions_data->>'can_manage_storage')::boolean, false),
    COALESCE((permissions_data->>'can_manage_security')::boolean, false),
    (permissions_data->>'assigned_level'),
    NOW()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    can_manage_announcements = EXCLUDED.can_manage_announcements,
    can_manage_materials = EXCLUDED.can_manage_materials,
    can_manage_lecturers = EXCLUDED.can_manage_lecturers,
    can_manage_executives = EXCLUDED.can_manage_executives,
    can_manage_students = EXCLUDED.can_manage_students,
    can_manage_groups = EXCLUDED.can_manage_groups,
    can_manage_group_media = EXCLUDED.can_manage_group_media,
    can_manage_news = EXCLUDED.can_manage_news,
    can_manage_archives = EXCLUDED.can_manage_archives,
    can_manage_messaging = EXCLUDED.can_manage_messaging,
    can_manage_events = EXCLUDED.can_manage_events,
    can_manage_past_questions = EXCLUDED.can_manage_past_questions,
    can_manage_courses = EXCLUDED.can_manage_courses,
    can_manage_cloud_archive = EXCLUDED.can_manage_cloud_archive,
    can_manage_graduates = EXCLUDED.can_manage_graduates,
    can_manage_analytics = EXCLUDED.can_manage_analytics,
    can_manage_logs = EXCLUDED.can_manage_logs,
    can_manage_settings = EXCLUDED.can_manage_settings,
    can_manage_storage = EXCLUDED.can_manage_storage,
    can_manage_security = EXCLUDED.can_manage_security,
    assigned_level = EXCLUDED.assigned_level,
    updated_at = NOW();
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_moderator_permissions(UUID, JSONB) TO authenticated;

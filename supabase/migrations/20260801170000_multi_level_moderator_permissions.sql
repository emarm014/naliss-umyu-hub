-- Migration: 20260801170000_multi_level_moderator_permissions.sql
-- Description: Adds assigned_levels array and level_permissions JSONB columns to moderator_permissions for multi-level & level-scoped permission support.

ALTER TABLE IF EXISTS public.moderator_permissions 
  ADD COLUMN IF NOT EXISTS assigned_levels TEXT[] DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS level_permissions JSONB DEFAULT '{}'::jsonb;

-- Backfill assigned_levels array from legacy single assigned_level column
UPDATE public.moderator_permissions 
SET assigned_levels = ARRAY[assigned_level] 
WHERE assigned_level IS NOT NULL AND (assigned_levels IS NULL OR cardinality(assigned_levels) = 0);

-- Update save_moderator_permissions RPC to handle multi-level and level-specific permissions
CREATE OR REPLACE FUNCTION public.save_moderator_permissions(
  target_user_id UUID,
  permissions_data JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_assigned_levels TEXT[];
BEGIN
  -- Verify caller is a super_admin or admin
  IF NOT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role IN ('super_admin', 'admin')
  ) THEN
    RAISE EXCEPTION 'Access Denied: Only Super Admins can modify moderator permissions.';
  END IF;

  -- Convert JSONB array to TEXT[] array for assigned_levels
  IF permissions_data->'assigned_levels' IS NOT NULL AND jsonb_typeof(permissions_data->'assigned_levels') = 'array' THEN
    SELECT ARRAY(SELECT jsonb_array_elements_text(permissions_data->'assigned_levels')) INTO v_assigned_levels;
  ELSE
    v_assigned_levels := NULL;
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
    assigned_levels,
    level_permissions,
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
    v_assigned_levels,
    COALESCE(permissions_data->'level_permissions', '{}'::jsonb),
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
    assigned_levels = EXCLUDED.assigned_levels,
    level_permissions = EXCLUDED.level_permissions,
    updated_at = NOW();
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_moderator_permissions(UUID, JSONB) TO authenticated;

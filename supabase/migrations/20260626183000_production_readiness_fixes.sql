-- Migration: 20260626183000_production_readiness_fixes.sql
-- Description: Core Database Production readiness fixes for NALISS UMYU HUB

-- ============================================================
-- 1. SECURE RLS POLICIES (activity_logs)
-- ============================================================
-- Drop insecure student read policy and replace with least-privilege ownership policy
DROP POLICY IF EXISTS "Student Read Activity Logs" ON public.activity_logs;
CREATE POLICY "Student Read Activity Logs" ON public.activity_logs
    FOR SELECT TO authenticated
    USING (auth.uid() = user_id);

-- ============================================================
-- 2. DROP OBSOLETE CONVERSATIONS TABLE
-- ============================================================
-- Drop the table, its policies, and indexes cascade. Verified safe to remove.
DROP TABLE IF EXISTS public.conversations CASCADE;

-- ============================================================
-- 3. REDEFINE FETCH_ADMIN_ANALYTICS RPC
-- ============================================================
CREATE OR REPLACE FUNCTION public.fetch_admin_analytics()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result json;
  users_total int;
  users_active int;
  users_suspended int;
  users_banned int;
  users_graduated int;
  users_pending int;
  users_by_level json;
  users_by_role json;
  content_materials int;
  content_past_questions int;
  content_courses int;
  content_events int;
  content_announcements int;
  community_groups int;
  community_lecturers int;
  community_executives int;
  community_graduates int;
  community_messages int;
  community_conversations int;
  engagement_material_views int;
  engagement_material_downloads int;
  engagement_announcement_views int;
  storage_resources bigint;
  storage_materials bigint;
  storage_past_questions bigint;
  storage_total bigint;
BEGIN
  -- 1. User Census
  SELECT count(*) INTO users_total FROM public.users;
  SELECT count(*) INTO users_active FROM public.users WHERE status = 'active';
  SELECT count(*) INTO users_suspended FROM public.users WHERE status = 'suspended';
  SELECT count(*) INTO users_banned FROM public.users WHERE status = 'banned';
  SELECT count(*) INTO users_graduated FROM public.users WHERE status = 'graduated';
  SELECT count(*) INTO users_pending FROM public.users WHERE status = 'pending';
  
  SELECT json_object_agg(COALESCE(level, 'Unknown'), count) INTO users_by_level
  FROM (SELECT level, count(*) FROM public.users GROUP BY level) t;
  
  SELECT json_object_agg(role, count) INTO users_by_role
  FROM (SELECT role, count(*) FROM public.users GROUP BY role) t;

  -- 2. Content Metrics
  SELECT count(*) INTO content_materials FROM public.materials WHERE is_active = true;
  SELECT count(*) INTO content_past_questions FROM public.past_questions;
  SELECT count(*) INTO content_courses FROM public.courses WHERE is_active = true;
  SELECT count(*) INTO content_events FROM public.events;
  SELECT count(*) INTO content_announcements FROM public.announcements WHERE is_published = true;

  -- 3. Community Stats
  SELECT count(*) INTO community_groups FROM public.groups;
  SELECT count(*) INTO community_lecturers FROM public.lecturers;
  SELECT count(*) INTO community_executives FROM public.executives;
  SELECT count(*) INTO community_graduates FROM public.graduates;
  SELECT count(*) INTO community_messages FROM public.messages;
  
  -- Set conversations count to 0 (table dropped)
  community_conversations := 0;

  -- 4. Engagement Telemetry
  SELECT COALESCE(sum(view_count), 0) INTO engagement_material_views FROM public.materials;
  SELECT COALESCE(sum(view_count), 0) INTO engagement_material_downloads FROM public.materials;
  SELECT COALESCE(sum(view_count), 0) INTO engagement_announcement_views FROM public.announcements;

  -- 5. Storage Estimates bypassed due to missing columns
  storage_materials := 0;
  storage_past_questions := 0;
  storage_resources := 0; 
  storage_total := 0;

  result := json_build_object(
    'users', json_build_object(
      'total', users_total,
      'active', users_active,
      'suspended', users_suspended,
      'banned', users_banned,
      'graduated', users_graduated,
      'pending', users_pending,
      'by_level', users_by_level,
      'by_role', users_by_role
    ),
    'content', json_build_object(
      'materials', content_materials,
      'pastQuestions', content_past_questions,
      'courses', content_courses,
      'events', content_events,
      'announcements', content_announcements
    ),
    'community', json_build_object(
      'groups', community_groups,
      'lecturers', community_lecturers,
      'executives', community_executives,
      'graduates', community_graduates,
      'messages', community_messages,
      'conversations', community_conversations
    ),
    'engagement', json_build_object(
      'material_views', engagement_material_views,
      'material_downloads', engagement_material_downloads,
      'announcement_views', engagement_announcement_views
    ),
    'storage', json_build_object(
      'materials', storage_materials,
      'past_questions', storage_past_questions,
      'resources', storage_resources,
      'total', storage_total,
      'backups', 0
    )
  );

  RETURN result;
END;
$$;

-- ============================================================
-- 4. IMPLEMENT QUIZ ANSWER CHECKING RPC (check_quiz_answer)
-- ============================================================
CREATE OR REPLACE FUNCTION public.check_quiz_answer(p_question_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_correct_option TEXT;
    v_pool_id UUID;
    v_instant_feedback BOOLEAN;
    v_status TEXT;
BEGIN
    -- Get pool and correct option
    SELECT pool_id, correct_option INTO v_pool_id, v_correct_option
    FROM public.pool_quiz_questions
    WHERE id = p_question_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Question not found';
    END IF;

    -- Verify that the pool has instant feedback enabled
    SELECT status, COALESCE((target_constraints->>'instant_feedback')::boolean, false)
    INTO v_status, v_instant_feedback
    FROM public.event_pools
    WHERE id = v_pool_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Event pool not found';
    END IF;

    IF v_status != 'live' THEN
        RAISE EXCEPTION 'Event pool is not live';
    END IF;

    IF NOT v_instant_feedback THEN
        RAISE EXCEPTION 'Instant feedback is not enabled for this event';
    END IF;

    -- Verify user is an active user in the system
    IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND status = 'active') THEN
        RAISE EXCEPTION 'Not authorized';
    END IF;

    RETURN v_correct_option;
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_quiz_answer(UUID) TO authenticated;

-- ============================================================
-- 5. BIDIRECTIONAL PUSH TOKEN SYNC TRIGGERS
-- ============================================================

-- Function to sync from user_push_tokens to users table
CREATE OR REPLACE FUNCTION public.sync_push_token_to_users()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
        UPDATE public.users
        SET push_token = NEW.push_token,
            updated_at = NOW()
        WHERE id = NEW.user_id
          AND (push_token IS NULL OR push_token <> NEW.push_token);
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE public.users
        SET push_token = NULL,
            updated_at = NOW()
        WHERE id = OLD.user_id
          AND push_token IS NOT NULL;
        RETURN OLD;
    END IF;
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS tr_sync_push_token_to_users ON public.user_push_tokens;
CREATE TRIGGER tr_sync_push_token_to_users
AFTER INSERT OR UPDATE OR DELETE ON public.user_push_tokens
FOR EACH ROW EXECUTE FUNCTION public.sync_push_token_to_users();

-- Function to sync from users table to user_push_tokens table
CREATE OR REPLACE FUNCTION public.sync_push_token_from_users()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.push_token IS NULL THEN
        DELETE FROM public.user_push_tokens
        WHERE user_id = NEW.id;
    ELSE
        INSERT INTO public.user_push_tokens (user_id, push_token, updated_at)
        VALUES (NEW.id, NEW.push_token, NOW())
        ON CONFLICT (user_id) DO UPDATE
        SET push_token = EXCLUDED.push_token,
            updated_at = EXCLUDED.updated_at;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_sync_push_token_from_users ON public.users;
CREATE TRIGGER tr_sync_push_token_from_users
AFTER UPDATE OF push_token ON public.users
FOR EACH ROW
WHEN (OLD.push_token IS DISTINCT FROM NEW.push_token)
EXECUTE FUNCTION public.sync_push_token_from_users();

-- ============================================================
-- 6. PUSH TOKENS FOREIGN KEY AND CLEANUP
-- ============================================================
-- Clean up any orphan rows in user_push_tokens where the user does not exist in public.users
DELETE FROM public.user_push_tokens WHERE user_id NOT IN (SELECT id FROM public.users);

-- Add foreign key constraint to public.users for relational queries
ALTER TABLE public.user_push_tokens DROP CONSTRAINT IF EXISTS fk_user_push_tokens_public_users;
ALTER TABLE public.user_push_tokens
ADD CONSTRAINT fk_user_push_tokens_public_users
FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

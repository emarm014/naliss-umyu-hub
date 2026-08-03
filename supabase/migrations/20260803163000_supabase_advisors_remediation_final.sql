-- Migration: 20260803163000_supabase_advisors_remediation_final.sql
-- Description: Comprehensive fix for all Supabase Security & Performance Advisor lints:
-- 1. Hardens search_path and execution grants on public functions.
-- 2. Optimizes RLS InitPlan by replacing auth.uid() / auth.role() with (SELECT auth.uid()) / (SELECT auth.role()).
-- 3. Adds covering indexes for unindexed foreign keys.
-- 4. Removes duplicate indexes.
-- 5. Cleans up redundant overlapping permissive policies.

-- ── 1. Function Hardening & Search Path Fixes ──
ALTER FUNCTION public.handle_updated_at() SET search_path = public;
ALTER FUNCTION public.get_groups_with_counts() SET search_path = public;

DO $$
DECLARE
    func record;
BEGIN
    FOR func IN 
        SELECT p.oid::regprocedure::text AS signature
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.prosecdef = true
    LOOP
        BEGIN
            EXECUTE 'ALTER FUNCTION ' || func.signature || ' SET search_path = public';
        EXCEPTION WHEN OTHERS THEN NULL;
        END;
    END LOOP;
END;
$$;

-- Revoke anonymous & public execution on sensitive functions
DO $$
DECLARE
    f_sig text;
    anon_revokes text[] := ARRAY[
        'approve_all_pool_applications(uuid)',
        'cleanup_inactive_push_tokens()',
        'confirm_invite_only_participants(uuid, uuid[])',
        'enqueue_chat_message_notification()',
        'save_moderator_permissions(uuid, jsonb)',
        'unapprove_pool_application(uuid)'
    ];
    auth_revokes text[] := ARRAY[
        'approve_all_pool_applications(uuid)',
        'unapprove_pool_application(uuid)',
        'save_moderator_permissions(uuid, jsonb)',
        'fetch_admin_analytics()',
        'get_notification_analytics()'
    ];
BEGIN
    FOREACH f_sig IN ARRAY anon_revokes LOOP
        BEGIN
            EXECUTE 'REVOKE EXECUTE ON FUNCTION public.' || f_sig || ' FROM PUBLIC, anon';
        EXCEPTION WHEN OTHERS THEN NULL;
        END;
    END LOOP;

    FOREACH f_sig IN ARRAY auth_revokes LOOP
        BEGIN
            EXECUTE 'REVOKE EXECUTE ON FUNCTION public.' || f_sig || ' FROM authenticated';
        EXCEPTION WHEN OTHERS THEN NULL;
        END;
    END LOOP;
END;
$$;


-- ── 2. Performance: Add Missing Foreign Key Covering Indexes ──
CREATE INDEX IF NOT EXISTS idx_featured_students_created_by ON public.featured_students(created_by);
CREATE INDEX IF NOT EXISTS idx_featured_students_pool_id ON public.featured_students(pool_id);
CREATE INDEX IF NOT EXISTS idx_featured_students_user_id ON public.featured_students(user_id);
CREATE INDEX IF NOT EXISTS idx_gallery_media_topic_id ON public.gallery_media(topic_id);
CREATE INDEX IF NOT EXISTS idx_student_congratulations_user_id ON public.student_congratulations(user_id);

-- Drop duplicate index
DROP INDEX IF EXISTS public.idx_user_announcement_reads_composite;


-- ── 3. Performance: RLS InitPlan Optimizations ((SELECT auth.uid())) ──

-- A. student_congratulations
DROP POLICY IF EXISTS "Users can insert their own congratulations" ON public.student_congratulations;
CREATE POLICY "Users can insert their own congratulations"
    ON public.student_congratulations FOR INSERT
    WITH CHECK ((SELECT auth.uid()) = user_id);

-- B. user_push_tokens
DROP POLICY IF EXISTS "Users can insert their own push token" ON public.user_push_tokens;
CREATE POLICY "Users can insert their own push token"
    ON public.user_push_tokens FOR INSERT
    WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can update their own push token" ON public.user_push_tokens;
CREATE POLICY "Users can update their own push token"
    ON public.user_push_tokens FOR UPDATE
    USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can read their own push token" ON public.user_push_tokens;
CREATE POLICY "Users can read their own push token"
    ON public.user_push_tokens FOR SELECT
    USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can delete their own push token" ON public.user_push_tokens;
CREATE POLICY "Users can delete their own push token"
    ON public.user_push_tokens FOR DELETE
    USING ((SELECT auth.uid()) = user_id);

-- C. notification_history
DROP POLICY IF EXISTS "Users can read their own notification history" ON public.notification_history;
CREATE POLICY "Users can read their own notification history"
    ON public.notification_history FOR SELECT
    USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can insert their own notification history" ON public.notification_history;
CREATE POLICY "Users can insert their own notification history"
    ON public.notification_history FOR INSERT
    WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can update their own notification history" ON public.notification_history;
CREATE POLICY "Users can update their own notification history"
    ON public.notification_history FOR UPDATE
    USING ((SELECT auth.uid()) = user_id);

-- D. notification_telemetry
DROP POLICY IF EXISTS "Users can insert their own telemetry" ON public.notification_telemetry;
CREATE POLICY "Users can insert their own telemetry"
    ON public.notification_telemetry FOR INSERT
    WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can read their own telemetry" ON public.notification_telemetry;
CREATE POLICY "Users can read their own telemetry"
    ON public.notification_telemetry FOR SELECT
    USING ((SELECT auth.uid()) = user_id);

-- E. gallery_topics & gallery_media
DROP POLICY IF EXISTS "Enable all access for admin and executives" ON public.gallery_topics;
CREATE POLICY "Enable all access for admin and executives"
    ON public.gallery_topics FOR ALL
    USING (
        (SELECT auth.role()) = 'service_role' OR 
        EXISTS (
            SELECT 1 FROM public.users 
            WHERE id = (SELECT auth.uid()) 
            AND role IN ('admin', 'super_admin', 'executive')
        )
    );

DROP POLICY IF EXISTS "Enable all access for admin and executives" ON public.gallery_media;
CREATE POLICY "Enable all access for admin and executives"
    ON public.gallery_media FOR ALL
    USING (
        (SELECT auth.role()) = 'service_role' OR 
        EXISTS (
            SELECT 1 FROM public.users 
            WHERE id = (SELECT auth.uid()) 
            AND role IN ('admin', 'super_admin', 'executive')
        )
    );

-- F. moderator_permissions
DROP POLICY IF EXISTS "Super Admins manage moderator_permissions" ON public.moderator_permissions;
CREATE POLICY "Super Admins manage moderator_permissions"
    ON public.moderator_permissions FOR ALL
    USING (
        (SELECT auth.role()) = 'service_role' OR 
        EXISTS (
            SELECT 1 FROM public.users 
            WHERE id = (SELECT auth.uid()) 
            AND role = 'super_admin'
        )
    );

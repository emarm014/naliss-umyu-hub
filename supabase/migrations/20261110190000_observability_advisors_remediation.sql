-- =============================================================================
-- Migration: 20261110190000_observability_advisors_remediation.sql
-- Purpose:
--   Remediate all Supabase Observability Security & Performance Advisor findings:
--   1. Harden SECURITY DEFINER RPCs (role verification + immutable search_path)
--      and revoke public/authenticated execution on internal cron functions.
--   2. Fix all 12 `auth_rls_initplan` policies by wrapping `auth.uid()` in
--      `(SELECT auth.uid())` so PostgreSQL caches the UID once per query.
--   3. Resolve all `multiple_permissive_policies` warnings by dropping redundant
--      duplicate policies and consolidating overlapping policies.
--   4. Add covering indexes for the 3 unindexed foreign keys.
--   5. Drop the 3 duplicate indexes/constraints (`user_sessions`, `archives`,
--      `news`) and add an explicit RLS policy on `public.push_send_audit`.
-- =============================================================================

-- =============================================================================
-- 1. HARDEN SECURITY DEFINER RPCs & LOCK DOWN CRON FUNCTIONS
-- =============================================================================

-- 1a. certify_voting_winners: Add admin/moderator role check + SET search_path = public
CREATE OR REPLACE FUNCTION public.certify_voting_winners(p_pool_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
    pos RECORD;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.users
        WHERE id = auth.uid() AND role IN ('super_admin', 'admin', 'moderator')
    ) THEN
        RAISE EXCEPTION 'Access Denied: Only Admins or Moderators can certify voting winners.';
    END IF;

    -- Loop through each distinct position in the election
    FOR pos IN 
        SELECT DISTINCT position_title FROM public.pool_candidates WHERE pool_id = p_pool_id
    LOOP
        -- Update the candidate with the most votes in this category
        UPDATE public.pool_candidates
        SET is_winner = true, podium_rank = '1st'
        WHERE id = (
            SELECT id FROM public.pool_candidates
            WHERE pool_id = p_pool_id AND position_title = pos.position_title
            ORDER BY vote_count DESC, created_at ASC
            LIMIT 1
        );
    END LOOP;

    -- Update the pool status to archived instead of completed so it is ready for public exploration
    UPDATE public.event_pools
    SET status = 'archived'
    WHERE id = p_pool_id;

    RETURN jsonb_build_object('success', true);
END;
$function$;

-- 1b. cast_pool_vote(uuid, uuid): Pin SET search_path = public
CREATE OR REPLACE FUNCTION public.cast_pool_vote(p_pool_id uuid, p_candidate_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
    v_pool RECORD;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    SELECT * INTO v_pool FROM public.event_pools WHERE id = p_pool_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Event pool not found';
    END IF;

    -- Allow voting if status is live OR if status is scheduled and start_time has passed
    IF v_pool.status NOT IN ('live', 'scheduled') THEN
        RAISE EXCEPTION 'Voting is only allowed while the event is live.';
    END IF;

    IF v_pool.status = 'scheduled' AND (v_pool.start_time IS NULL OR NOW() < v_pool.start_time) THEN
        RAISE EXCEPTION 'Voting has not started yet.';
    END IF;
    
    IF v_pool.end_time IS NOT NULL AND NOW() > (v_pool.end_time + INTERVAL '30 seconds') THEN
        RAISE EXCEPTION 'Voting has concluded.';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.pool_candidates WHERE id = p_candidate_id AND pool_id = p_pool_id) THEN
        RAISE EXCEPTION 'Candidate not found in this election';
    END IF;

    -- 3. Insert vote (atomic unique constraint check)
    BEGIN
        INSERT INTO public.pool_votes (pool_id, voter_user_id, candidate_id)
        VALUES (p_pool_id, auth.uid(), p_candidate_id);
    EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION 'You have already voted in this event';
    END;

    -- 4. Increment candidate vote count atomically
    UPDATE public.pool_candidates
    SET vote_count = vote_count + 1
    WHERE id = p_candidate_id;

    -- 5. Mark participant record as completed
    INSERT INTO public.pool_participants (pool_id, user_id, completed_at)
    VALUES (p_pool_id, auth.uid(), NOW())
    ON CONFLICT (pool_id, user_id)
    DO UPDATE SET completed_at = NOW();

    RETURN jsonb_build_object('success', true, 'voted_at', NOW());
END;
$function$;

-- 1c. approve_pool_application: Add admin/moderator role check
CREATE OR REPLACE FUNCTION public.approve_pool_application(p_application_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    v_pool_id UUID;
    v_user_id UUID;
    v_target_constraints JSONB;
    v_selected_users JSONB;
    v_max_participants INT;
    v_current_count INT;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.users
        WHERE id = auth.uid() AND role IN ('super_admin', 'admin', 'moderator')
    ) THEN
        RAISE EXCEPTION 'Access Denied: Only Admins or Moderators can approve applications.';
    END IF;

    -- Get application details
    SELECT pool_id, user_id INTO v_pool_id, v_user_id
    FROM public.pool_applications
    WHERE id = p_application_id AND status = 'pending'
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Application not found or not pending.';
    END IF;

    -- Lock the event pool to prevent concurrent capacity breaches
    SELECT COALESCE(target_constraints, '{}'::jsonb) INTO v_target_constraints
    FROM public.event_pools
    WHERE id = v_pool_id
    FOR UPDATE;

    v_max_participants := (v_target_constraints->>'max_participants')::INT;
    
    IF v_target_constraints ? 'selected_users' THEN
        v_selected_users := v_target_constraints -> 'selected_users';
    ELSE
        v_selected_users := '[]'::jsonb;
    END IF;

    v_current_count := jsonb_array_length(v_selected_users);

    IF v_max_participants IS NOT NULL AND v_current_count >= v_max_participants THEN
        RAISE EXCEPTION 'Event pool capacity reached.';
    END IF;

    -- Update application status
    UPDATE public.pool_applications
    SET status = 'approved', updated_at = NOW()
    WHERE id = p_application_id;

    -- Append the new user_id safely (if not already exists)
    IF NOT (v_selected_users @> to_jsonb(v_user_id::text)) THEN
        v_selected_users := v_selected_users || to_jsonb(v_user_id::text);
    END IF;

    -- Update the target constraints
    v_target_constraints := jsonb_set(v_target_constraints, '{selected_users}', v_selected_users);

    UPDATE public.event_pools
    SET target_constraints = v_target_constraints
    WHERE id = v_pool_id;

    RETURN jsonb_build_object('success', true);
END;
$function$;

-- 1d. unapprove_pool_application: Add admin/moderator role check
CREATE OR REPLACE FUNCTION public.unapprove_pool_application(p_application_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    v_pool_id UUID;
    v_user_id UUID;
    v_target_constraints JSONB;
    v_selected_users JSONB;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.users
        WHERE id = auth.uid() AND role IN ('super_admin', 'admin', 'moderator')
    ) THEN
        RAISE EXCEPTION 'Access Denied: Only Admins or Moderators can reject applications.';
    END IF;

    -- Get application details
    SELECT pool_id, user_id INTO v_pool_id, v_user_id
    FROM public.pool_applications
    WHERE id = p_application_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Application not found.';
    END IF;

    -- Update application status
    UPDATE public.pool_applications
    SET status = 'rejected', updated_at = NOW()
    WHERE id = p_application_id;

    -- Lock the event pool to prevent concurrent modifications
    SELECT COALESCE(target_constraints, '{}'::jsonb) INTO v_target_constraints
    FROM public.event_pools
    WHERE id = v_pool_id
    FOR UPDATE;
    
    IF v_target_constraints ? 'selected_users' THEN
        v_selected_users := v_target_constraints -> 'selected_users';
    ELSE
        v_selected_users := '[]'::jsonb;
    END IF;

    -- Remove the user_id from the JSON array
    v_selected_users := (
        SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb)
        FROM jsonb_array_elements(v_selected_users) AS elem
        WHERE elem <> to_jsonb(v_user_id::text)
    );

    -- Update the target constraints
    v_target_constraints := jsonb_set(v_target_constraints, '{selected_users}', v_selected_users);

    UPDATE public.event_pools
    SET target_constraints = v_target_constraints
    WHERE id = v_pool_id;

    RETURN jsonb_build_object('success', true);
END;
$function$;

-- 1e. approve_all_pool_applications: Add admin/moderator role check
CREATE OR REPLACE FUNCTION public.approve_all_pool_applications(p_pool_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    v_target_constraints JSONB;
    v_selected_users JSONB;
    v_max_participants INT;
    v_current_count INT;
    v_apps_to_approve INT;
    v_app RECORD;
    v_approved_count INT := 0;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.users
        WHERE id = auth.uid() AND role IN ('super_admin', 'admin', 'moderator')
    ) THEN
        RAISE EXCEPTION 'Access Denied: Only Admins or Moderators can approve applications.';
    END IF;

    -- Lock the event pool
    SELECT COALESCE(target_constraints, '{}'::jsonb) INTO v_target_constraints
    FROM public.event_pools
    WHERE id = p_pool_id
    FOR UPDATE;

    v_max_participants := (v_target_constraints->>'max_participants')::INT;
    
    IF v_target_constraints ? 'selected_users' THEN
        v_selected_users := v_target_constraints -> 'selected_users';
    ELSE
        v_selected_users := '[]'::jsonb;
    END IF;

    v_current_count := jsonb_array_length(v_selected_users);

    IF v_max_participants IS NOT NULL THEN
        v_apps_to_approve := v_max_participants - v_current_count;
        IF v_apps_to_approve <= 0 THEN
            RETURN jsonb_build_object('success', true, 'approved_count', 0, 'message', 'Pool already at capacity');
        END IF;
    ELSE
        v_apps_to_approve := 1000000;
    END IF;

    FOR v_app IN 
        SELECT id, user_id FROM public.pool_applications 
        WHERE pool_id = p_pool_id AND status = 'pending' 
        ORDER BY created_at ASC 
        LIMIT v_apps_to_approve 
        FOR UPDATE
    LOOP
        UPDATE public.pool_applications SET status = 'approved', updated_at = NOW() WHERE id = v_app.id;
        
        IF NOT (v_selected_users @> to_jsonb(v_app.user_id::text)) THEN
            v_selected_users := v_selected_users || to_jsonb(v_app.user_id::text);
        END IF;
        
        v_approved_count := v_approved_count + 1;
    END LOOP;

    IF v_approved_count > 0 THEN
        v_target_constraints := jsonb_set(v_target_constraints, '{selected_users}', v_selected_users);
        UPDATE public.event_pools SET target_constraints = v_target_constraints WHERE id = p_pool_id;
    END IF;

    RETURN jsonb_build_object('success', true, 'approved_count', v_approved_count);
END;
$function$;

-- 1f. confirm_invite_only_participants: Add admin/moderator role check
CREATE OR REPLACE FUNCTION public.confirm_invite_only_participants(p_pool_id uuid, p_user_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    v_user_id UUID;
    v_target_constraints JSONB;
    v_selected_users JSONB;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.users
        WHERE id = auth.uid() AND role IN ('super_admin', 'admin', 'moderator')
    ) THEN
        RAISE EXCEPTION 'Access Denied: Only Admins or Moderators can confirm invite-only participants.';
    END IF;

    -- Upsert applications as approved
    FOREACH v_user_id IN ARRAY p_user_ids
    LOOP
        INSERT INTO public.pool_applications (pool_id, user_id, status)
        VALUES (p_pool_id, v_user_id, 'approved')
        ON CONFLICT (pool_id, user_id) 
        DO UPDATE SET status = 'approved', updated_at = NOW();
    END LOOP;

    -- Lock the event pool to prevent concurrent modifications
    SELECT COALESCE(target_constraints, '{}'::jsonb) INTO v_target_constraints
    FROM public.event_pools
    WHERE id = p_pool_id
    FOR UPDATE;

    IF v_target_constraints ? 'selected_users' THEN
        v_selected_users := v_target_constraints -> 'selected_users';
    ELSE
        v_selected_users := '[]'::jsonb;
    END IF;

    -- Add the user_ids to the JSON array if not present
    FOREACH v_user_id IN ARRAY p_user_ids
    LOOP
        IF NOT (v_selected_users @> to_jsonb(v_user_id::text)) THEN
            v_selected_users := v_selected_users || to_jsonb(v_user_id::text);
        END IF;
    END LOOP;

    -- Update the target constraints
    v_target_constraints := jsonb_set(v_target_constraints, '{selected_users}', v_selected_users);

    UPDATE public.event_pools
    SET target_constraints = v_target_constraints
    WHERE id = p_pool_id;

    RETURN jsonb_build_object('success', true);
END;
$function$;

-- 1g. Lock down internal cron/maintenance functions from public REST RPC execution
REVOKE EXECUTE ON FUNCTION public.cleanup_inactive_push_tokens() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_inactive_push_tokens() TO postgres, service_role;

REVOKE EXECUTE ON FUNCTION public.cleanup_stagnant_registrations() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_stagnant_registrations() TO postgres, service_role;

REVOKE EXECUTE ON FUNCTION public.prewarm_critical_tables() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prewarm_critical_tables() TO postgres, service_role;


-- =============================================================================
-- 2. FIX `auth_rls_initplan` & `multiple_permissive_policies` ACROSS TABLES
-- =============================================================================

-- 2a. public.deleted_accounts (auth_rls_initplan)
DROP POLICY IF EXISTS "Allow admins to read deleted accounts" ON public.deleted_accounts;
CREATE POLICY "Allow admins to read deleted accounts"
  ON public.deleted_accounts
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = (SELECT auth.uid())
        AND users.role IN ('admin', 'super_admin', 'moderator')
    )
  );

-- 2b. public.featured_student_dismissals (auth_rls_initplan)
DROP POLICY IF EXISTS "Users can insert their own dismissals" ON public.featured_student_dismissals;
CREATE POLICY "Users can insert their own dismissals"
  ON public.featured_student_dismissals
  FOR INSERT
  TO public
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can view their own dismissals" ON public.featured_student_dismissals;
CREATE POLICY "Users can view their own dismissals"
  ON public.featured_student_dismissals
  FOR SELECT
  TO public
  USING ((SELECT auth.uid()) = user_id);

-- 2c. public.pool_votes (auth_rls_initplan)
DROP POLICY IF EXISTS "Admins can view audit counts" ON public.pool_votes;
CREATE POLICY "Admins can view audit counts"
  ON public.pool_votes
  FOR SELECT
  TO public
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = (SELECT auth.uid())
        AND users.role = ANY (ARRAY['admin'::text, 'super_admin'::text])
    )
  );

DROP POLICY IF EXISTS "Users can insert their own vote" ON public.pool_votes;
CREATE POLICY "Users can insert their own vote"
  ON public.pool_votes
  FOR INSERT
  TO public
  WITH CHECK ((SELECT auth.uid()) = voter_user_id);

-- 2d. public.user_announcement_reads (auth_rls_initplan)
DROP POLICY IF EXISTS "Student Insert Announcement Reads" ON public.user_announcement_reads;
CREATE POLICY "Student Insert Announcement Reads"
  ON public.user_announcement_reads
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Student Select Announcement Reads" ON public.user_announcement_reads;
CREATE POLICY "Student Select Announcement Reads"
  ON public.user_announcement_reads
  FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- 2e. public.notification_history (auth_rls_initplan + multiple_permissive_policies)
DROP POLICY IF EXISTS "Users manage own notification_history" ON public.notification_history;
DROP POLICY IF EXISTS "Users can delete their own notification history" ON public.notification_history;
CREATE POLICY "Users can delete their own notification history"
  ON public.notification_history
  FOR DELETE
  TO public
  USING ((SELECT auth.uid()) = user_id);

-- 2f. public.user_push_tokens (auth_rls_initplan + multiple_permissive_policies)
DROP POLICY IF EXISTS "Authenticated users access user_push_tokens" ON public.user_push_tokens;

-- 2g. public.user_sessions (auth_rls_initplan + multiple_permissive_policies)
DROP POLICY IF EXISTS "Users can upsert own session" ON public.user_sessions;

-- 2h. public.pool_participants (multiple_permissive_policies)
DROP POLICY IF EXISTS "anyone_can_view_participants" ON public.pool_participants;

-- 2i. public.user_notes (auth_rls_initplan + multiple_permissive_policies)
DROP POLICY IF EXISTS "Admins can read all user_notes" ON public.user_notes;
DROP POLICY IF EXISTS "user_notes_select" ON public.user_notes;
CREATE POLICY "user_notes_select"
  ON public.user_notes
  FOR SELECT
  TO public
  USING (
    user_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = (SELECT auth.uid())
        AND users.role = ANY (ARRAY['super_admin'::text, 'admin'::text])
    )
  );

-- 2j. public.messages (auth_rls_initplan + multiple_permissive_policies)
DROP POLICY IF EXISTS "Admin Read All Messages" ON public.messages;
DROP POLICY IF EXISTS "Student Read Group Messages" ON public.messages;
CREATE POLICY "Student Read Group Messages"
  ON public.messages
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.group_members
      WHERE group_members.group_id = messages.group_id
        AND group_members.user_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = (SELECT auth.uid())
        AND users.role = ANY (ARRAY['admin'::text, 'super_admin'::text, 'moderator'::text])
    )
  );

DROP POLICY IF EXISTS "Admin Insert messages" ON public.messages;
DROP POLICY IF EXISTS "Student Insert Messages" ON public.messages;
CREATE POLICY "Student Insert Messages"
  ON public.messages
  FOR INSERT
  TO authenticated
  WITH CHECK (((SELECT auth.uid()) = sender_id) OR is_admin_or_moderator());

DROP POLICY IF EXISTS "Admin Update messages" ON public.messages;
DROP POLICY IF EXISTS "Student Update Own Messages" ON public.messages;
CREATE POLICY "Student Update Own Messages"
  ON public.messages
  FOR UPDATE
  TO authenticated
  USING (((SELECT auth.uid()) = sender_id) OR is_admin_or_moderator())
  WITH CHECK (((SELECT auth.uid()) = sender_id) OR is_admin_or_moderator());

DROP POLICY IF EXISTS "Admin Delete messages" ON public.messages;
DROP POLICY IF EXISTS "Student Delete Own Messages" ON public.messages;
CREATE POLICY "Student Delete Own Messages"
  ON public.messages
  FOR DELETE
  TO authenticated
  USING (((SELECT auth.uid()) = sender_id) OR is_admin_or_moderator());

-- 2k. public.group_members (multiple_permissive_policies on INSERT)
DROP POLICY IF EXISTS "Admin Insert group_members" ON public.group_members;
DROP POLICY IF EXISTS "Student Insert Group Member" ON public.group_members;
CREATE POLICY "Student Insert Group Member"
  ON public.group_members
  FOR INSERT
  TO authenticated
  WITH CHECK (((SELECT auth.uid()) = user_id) OR is_admin_or_moderator());

-- 2l. public.users (multiple_permissive_policies on INSERT and UPDATE)
DROP POLICY IF EXISTS "Admin Insert users" ON public.users;
DROP POLICY IF EXISTS "Student Insert Own Profile" ON public.users;
CREATE POLICY "Student Insert Own Profile"
  ON public.users
  FOR INSERT
  TO authenticated
  WITH CHECK (((SELECT auth.uid()) = id) OR is_admin_or_moderator());

DROP POLICY IF EXISTS "Admin Update users" ON public.users;
DROP POLICY IF EXISTS "Student Update Own Profile" ON public.users;
CREATE POLICY "Student Update Own Profile"
  ON public.users
  FOR UPDATE
  TO authenticated
  USING (((SELECT auth.uid()) = id) OR is_admin_or_moderator())
  WITH CHECK (((SELECT auth.uid()) = id) OR is_admin_or_moderator());

-- 2m. public.gallery_media (multiple_permissive_policies on SELECT)
DROP POLICY IF EXISTS "Enable all access for admin and executives" ON public.gallery_media;
DROP POLICY IF EXISTS "Admin and executives insert gallery_media" ON public.gallery_media;
DROP POLICY IF EXISTS "Admin and executives update gallery_media" ON public.gallery_media;
DROP POLICY IF EXISTS "Admin and executives delete gallery_media" ON public.gallery_media;

CREATE POLICY "Admin and executives insert gallery_media"
  ON public.gallery_media
  FOR INSERT
  TO public
  WITH CHECK (
    (SELECT auth.role()) = 'service_role'
    OR EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = (SELECT auth.uid())
        AND users.role = ANY (ARRAY['admin'::text, 'super_admin'::text, 'executive'::text])
    )
  );

CREATE POLICY "Admin and executives update gallery_media"
  ON public.gallery_media
  FOR UPDATE
  TO public
  USING (
    (SELECT auth.role()) = 'service_role'
    OR EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = (SELECT auth.uid())
        AND users.role = ANY (ARRAY['admin'::text, 'super_admin'::text, 'executive'::text])
    )
  );

CREATE POLICY "Admin and executives delete gallery_media"
  ON public.gallery_media
  FOR DELETE
  TO public
  USING (
    (SELECT auth.role()) = 'service_role'
    OR EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = (SELECT auth.uid())
        AND users.role = ANY (ARRAY['admin'::text, 'super_admin'::text, 'executive'::text])
    )
  );

-- 2n. public.gallery_topics (multiple_permissive_policies on SELECT)
DROP POLICY IF EXISTS "Enable all access for admin and executives" ON public.gallery_topics;
DROP POLICY IF EXISTS "Admin and executives insert gallery_topics" ON public.gallery_topics;
DROP POLICY IF EXISTS "Admin and executives update gallery_topics" ON public.gallery_topics;
DROP POLICY IF EXISTS "Admin and executives delete gallery_topics" ON public.gallery_topics;

CREATE POLICY "Admin and executives insert gallery_topics"
  ON public.gallery_topics
  FOR INSERT
  TO public
  WITH CHECK (
    (SELECT auth.role()) = 'service_role'
    OR EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = (SELECT auth.uid())
        AND users.role = ANY (ARRAY['admin'::text, 'super_admin'::text, 'executive'::text])
    )
  );

CREATE POLICY "Admin and executives update gallery_topics"
  ON public.gallery_topics
  FOR UPDATE
  TO public
  USING (
    (SELECT auth.role()) = 'service_role'
    OR EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = (SELECT auth.uid())
        AND users.role = ANY (ARRAY['admin'::text, 'super_admin'::text, 'executive'::text])
    )
  );

CREATE POLICY "Admin and executives delete gallery_topics"
  ON public.gallery_topics
  FOR DELETE
  TO public
  USING (
    (SELECT auth.role()) = 'service_role'
    OR EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = (SELECT auth.uid())
        AND users.role = ANY (ARRAY['admin'::text, 'super_admin'::text, 'executive'::text])
    )
  );

-- 2o. public.moderator_permissions (multiple_permissive_policies on SELECT)
DROP POLICY IF EXISTS "Super Admins manage moderator_permissions" ON public.moderator_permissions;
DROP POLICY IF EXISTS "Super Admins insert moderator_permissions" ON public.moderator_permissions;
DROP POLICY IF EXISTS "Super Admins update moderator_permissions" ON public.moderator_permissions;
DROP POLICY IF EXISTS "Super Admins delete moderator_permissions" ON public.moderator_permissions;

CREATE POLICY "Super Admins insert moderator_permissions"
  ON public.moderator_permissions
  FOR INSERT
  TO public
  WITH CHECK (
    (SELECT auth.role()) = 'service_role'
    OR EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = (SELECT auth.uid())
        AND users.role = 'super_admin'
    )
  );

CREATE POLICY "Super Admins update moderator_permissions"
  ON public.moderator_permissions
  FOR UPDATE
  TO public
  USING (
    (SELECT auth.role()) = 'service_role'
    OR EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = (SELECT auth.uid())
        AND users.role = 'super_admin'
    )
  );

CREATE POLICY "Super Admins delete moderator_permissions"
  ON public.moderator_permissions
  FOR DELETE
  TO public
  USING (
    (SELECT auth.role()) = 'service_role'
    OR EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = (SELECT auth.uid())
        AND users.role = 'super_admin'
    )
  );


-- =============================================================================
-- 3. ADD MISSING FOREIGN KEY INDEXES (`unindexed_foreign_keys`)
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_featured_student_dismissals_user_id
  ON public.featured_student_dismissals (user_id);

CREATE INDEX IF NOT EXISTS idx_pool_candidates_candidate_user_id
  ON public.pool_candidates (candidate_user_id);

CREATE INDEX IF NOT EXISTS idx_pool_votes_voter_user_id
  ON public.pool_votes (voter_user_id);


-- =============================================================================
-- 4. DROP DUPLICATE INDEXES/CONSTRAINTS & ADD `push_send_audit` POLICY
-- =============================================================================

ALTER TABLE public.user_sessions
  DROP CONSTRAINT IF EXISTS uq_user_sessions_user_device;

DROP INDEX IF EXISTS public.idx_archives_created_desc;
DROP INDEX IF EXISTS public.idx_news_created_desc;

DROP POLICY IF EXISTS "Admins can view push send audit" ON public.push_send_audit;
CREATE POLICY "Admins can view push send audit"
  ON public.push_send_audit
  FOR SELECT
  TO authenticated
  USING (is_admin_or_moderator());

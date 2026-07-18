-- Migration: Event Pool Approval Flow
-- Description: Updates the ticket engine to support manual admin approvals, capacity checks during approval, and unapproval.

-- 1. Update the apply RPC
CREATE OR REPLACE FUNCTION public.secure_event_ticket(p_pool_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_user_id UUID;
    v_pool RECORD;
    v_target_constraints JSONB;
    v_selected_users JSONB;
    v_max_participants INT;
    v_allowed_levels JSONB;
    v_allowed_departments JSONB;
    v_user_level TEXT;
    v_user_department_id UUID;
    v_current_count INT;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    -- Lock the event pool row for update to ensure atomic capacity checking
    SELECT * INTO v_pool
    FROM public.event_pools
    WHERE id = p_pool_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Event pool not found';
    END IF;

    -- Check if registration is enabled
    v_target_constraints := COALESCE(v_pool.target_constraints, '{}'::jsonb);
    IF NOT COALESCE((v_target_constraints->>'enable_registration')::boolean, true) THEN
        RAISE EXCEPTION 'Registration is closed for this event';
    END IF;

    -- Extract constraints
    v_max_participants := (v_target_constraints->>'max_participants')::INT;
    v_allowed_levels := v_target_constraints->'allowed_levels';
    v_allowed_departments := v_target_constraints->'allowed_departments';
    v_selected_users := COALESCE(v_target_constraints->'selected_users', '[]'::jsonb);
    
    -- Check Capacity of APPROVED users
    v_current_count := jsonb_array_length(v_selected_users);
    IF v_max_participants IS NOT NULL AND v_current_count >= v_max_participants THEN
        RAISE EXCEPTION 'Event is full. No tickets left.';
    END IF;

    -- Check if user already has a ticket
    IF v_selected_users @> to_jsonb(v_user_id::text) THEN
        RETURN jsonb_build_object('success', true, 'message', 'Ticket already secured');
    END IF;

    -- Fetch user profile for eligibility check
    SELECT level, department_id INTO v_user_level, v_user_department_id
    FROM public.users
    WHERE id = v_user_id;

    -- Eligibility: Level
    IF v_pool.participation_rule = 'level_based' THEN
        IF v_allowed_levels IS NOT NULL AND jsonb_array_length(v_allowed_levels) > 0 THEN
            IF NOT v_allowed_levels @> to_jsonb(v_user_level) THEN
                RAISE EXCEPTION 'You are not eligible for this event (Level restriction).';
            END IF;
        END IF;
    END IF;

    -- Eligibility: Department
    IF v_pool.participation_rule = 'department_based' THEN
        IF v_allowed_departments IS NOT NULL AND jsonb_array_length(v_allowed_departments) > 0 THEN
            IF NOT v_allowed_departments @> to_jsonb(v_user_department_id::text) THEN
                RAISE EXCEPTION 'You are not eligible for this event (Department restriction).';
            END IF;
        END IF;
    END IF;

    -- Eligibility: Invite Only
    IF v_pool.participation_rule = 'individual_selection' THEN
        RAISE EXCEPTION 'This event is invite-only. You cannot manually apply for a ticket.';
    END IF;

    -- Insert pending application
    INSERT INTO public.pool_applications (pool_id, user_id, status)
    VALUES (p_pool_id, v_user_id, 'pending')
    ON CONFLICT (pool_id, user_id) 
    DO UPDATE SET status = 'pending', updated_at = NOW();

    RETURN jsonb_build_object('success', true, 'message', 'Application submitted! Pending admin approval.');
END;
$$;


-- 2. Update approve_pool_application to check capacity
CREATE OR REPLACE FUNCTION public.approve_pool_application(p_application_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_pool_id UUID;
    v_user_id UUID;
    v_target_constraints JSONB;
    v_selected_users JSONB;
    v_max_participants INT;
    v_current_count INT;
BEGIN
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
$$;


-- 3. Create unapprove_pool_application
CREATE OR REPLACE FUNCTION public.unapprove_pool_application(p_application_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_pool_id UUID;
    v_user_id UUID;
    v_target_constraints JSONB;
    v_selected_users JSONB;
BEGIN
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
$$;


-- 4. Create approve_all_pool_applications
CREATE OR REPLACE FUNCTION public.approve_all_pool_applications(p_pool_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_target_constraints JSONB;
    v_selected_users JSONB;
    v_max_participants INT;
    v_current_count INT;
    v_apps_to_approve INT;
    v_app RECORD;
    v_approved_count INT := 0;
BEGIN
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
        v_apps_to_approve := 1000000; -- Arbitrary high number if no limit
    END IF;

    FOR v_app IN 
        SELECT id, user_id FROM public.pool_applications 
        WHERE pool_id = p_pool_id AND status = 'pending' 
        ORDER BY created_at ASC 
        LIMIT v_apps_to_approve 
        FOR UPDATE
    LOOP
        -- Update status
        UPDATE public.pool_applications SET status = 'approved', updated_at = NOW() WHERE id = v_app.id;
        
        -- Add to selected_users if not exists
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
$$;

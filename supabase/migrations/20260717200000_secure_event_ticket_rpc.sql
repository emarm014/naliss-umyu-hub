-- Migration: Event Pool Secure Ticket Engine
-- Description: RPC to atomically secure an event ticket (approve application) with capacity and eligibility checks.

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
    v_existing_app UUID;
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
    
    -- Check if user already has a ticket
    IF v_selected_users @> to_jsonb(v_user_id::text) THEN
        RETURN jsonb_build_object('success', true, 'message', 'Ticket already secured');
    END IF;

    -- Check Capacity
    v_current_count := jsonb_array_length(v_selected_users);
    IF v_max_participants IS NOT NULL AND v_current_count >= v_max_participants THEN
        RAISE EXCEPTION 'Event is full. No tickets left.';
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
        RAISE EXCEPTION 'This event is invite-only. You cannot manually secure a ticket.';
    END IF;

    -- Approve the user
    v_selected_users := v_selected_users || to_jsonb(v_user_id::text);
    v_target_constraints := jsonb_set(v_target_constraints, '{selected_users}', v_selected_users);

    -- Update the pool constraints
    UPDATE public.event_pools
    SET target_constraints = v_target_constraints
    WHERE id = p_pool_id;

    -- Upsert the application record to track it cleanly in the DB as well
    INSERT INTO public.pool_applications (pool_id, user_id, status)
    VALUES (p_pool_id, v_user_id, 'approved')
    ON CONFLICT (pool_id, user_id) 
    DO UPDATE SET status = 'approved', updated_at = NOW();

    RETURN jsonb_build_object('success', true, 'message', 'Ticket secured successfully!');
END;
$$;

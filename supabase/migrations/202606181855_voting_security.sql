-- Step 1: Create secure voting RPC
CREATE OR REPLACE FUNCTION public.submit_vote(p_pool_id UUID, p_candidate_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_user_id UUID;
    v_user_level TEXT;
    v_user_department_id UUID;
    v_pool_status TEXT;
    v_pool_end_time TIMESTAMPTZ;
    v_participation_rule TEXT;
    v_target_constraints JSONB;
    v_existing_submission UUID;
    v_candidate_exists BOOLEAN;
BEGIN
    -- 1. Get and verify the voting user
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    -- 2. Fetch voting user's metadata from public.users
    SELECT level, department_id INTO v_user_level, v_user_department_id
    FROM public.users
    WHERE id = v_user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'User profile not found';
    END IF;

    -- 3. Fetch event pool details
    SELECT status, end_time, participation_rule, target_constraints
    INTO v_pool_status, v_pool_end_time, v_participation_rule, v_target_constraints
    FROM public.event_pools
    WHERE id = p_pool_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Event pool not found';
    END IF;

    -- 4. Verify pool is live
    IF v_pool_status != 'live' THEN
        RAISE EXCEPTION 'This event pool is not currently live for voting';
    END IF;

    -- 5. Verify deadline with 30s grace period for network latency
    IF v_pool_end_time IS NOT NULL AND NOW() > (v_pool_end_time + INTERVAL '30 seconds') THEN
        RAISE EXCEPTION 'Voting deadline has passed';
    END IF;

    -- 6. Verify voting user's metadata matches the event pool's target constraints
    IF v_participation_rule = 'level_based' THEN
        IF v_user_level IS NULL OR NOT (v_target_constraints -> 'levels' ? v_user_level) THEN
            RAISE EXCEPTION 'Your academic level is not eligible to vote in this event';
        END IF;
    ELSIF v_participation_rule = 'department_based' THEN
        IF v_user_department_id IS NULL OR v_user_department_id::text != (v_target_constraints ->> 'department_id') THEN
            RAISE EXCEPTION 'Your department is not eligible to vote in this event';
        END IF;
    END IF;

    -- 7. Verify the candidate exists
    SELECT EXISTS (
        SELECT 1 FROM public.users WHERE id = p_candidate_user_id
    ) INTO v_candidate_exists;

    IF NOT v_candidate_exists THEN
        RAISE EXCEPTION 'Candidate not found';
    END IF;

    -- 8. Check if the user has already voted in this event pool
    SELECT id INTO v_existing_submission
    FROM public.pool_submissions
    WHERE pool_id = p_pool_id AND user_id = v_user_id;

    IF FOUND THEN
        RAISE EXCEPTION 'You have already cast your vote in this event';
    END IF;

    -- 9. Insert the vote as a submission record
    INSERT INTO public.pool_submissions (pool_id, user_id, answers, score)
    VALUES (p_pool_id, v_user_id, jsonb_build_object('vote_for', p_candidate_user_id), NULL);

    RETURN jsonb_build_object('success', true);
END;
$$;

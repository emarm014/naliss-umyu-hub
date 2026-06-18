-- Step 1: Manual Evaluation RPC (Anti-Cheat Server Side Validation for Essay & Challenge)
CREATE OR REPLACE FUNCTION public.submit_manual_evaluation(p_pool_id UUID, p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_user_id UUID;
    v_existing_submission UUID;
    v_pool_status TEXT;
    v_pool_end_time TIMESTAMPTZ;
BEGIN
    -- 1. Verify User
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    -- 2. Verify Pool Status & Deadlines
    SELECT status, end_time INTO v_pool_status, v_pool_end_time
    FROM public.event_pools
    WHERE id = p_pool_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pool not found';
    END IF;

    IF v_pool_status != 'live' THEN
        RAISE EXCEPTION 'Pool is not active';
    END IF;

    -- We allow a 30-second grace period for network latency on the end_time
    IF v_pool_end_time IS NOT NULL AND NOW() > (v_pool_end_time + INTERVAL '30 seconds') THEN
        RAISE EXCEPTION 'Time limit exceeded';
    END IF;

    -- 3. Check for existing submission
    SELECT id INTO v_existing_submission
    FROM public.pool_submissions
    WHERE pool_id = p_pool_id AND user_id = v_user_id;

    IF FOUND THEN
        RAISE EXCEPTION 'You have already submitted an entry for this event';
    END IF;

    -- 4. Insert Submission Record (No automatic grading)
    INSERT INTO public.pool_submissions (pool_id, user_id, answers, score)
    VALUES (p_pool_id, v_user_id, p_payload, NULL);

    -- 5. Insert or Update Leaderboard (pool_participants) 
    -- final_score remains default 0 until an admin evaluates the submission.
    INSERT INTO public.pool_participants (pool_id, user_id, final_score, completed_at)
    VALUES (p_pool_id, v_user_id, 0, NOW())
    ON CONFLICT (pool_id, user_id) DO UPDATE 
    SET completed_at = EXCLUDED.completed_at;

    RETURN jsonb_build_object('success', true);
END;
$$;

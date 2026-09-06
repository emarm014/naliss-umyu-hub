-- Migration: Automate Event Pool status transitions based on time

-- 1. Update submit_quiz to enforce time boundaries instead of relying on the manual status field
CREATE OR REPLACE FUNCTION public.submit_quiz(p_pool_id UUID, p_answers JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID;
    v_question RECORD;
    v_total_score INTEGER := 0;
    v_answer TEXT;
    v_existing_submission UUID;
    v_pool_start_time TIMESTAMPTZ;
    v_pool_end_time TIMESTAMPTZ;
    v_time_limit INTEGER;
    v_started_at TIMESTAMPTZ;
BEGIN
    -- 1. Verify User
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    -- 2. Verify Pool Deadlines (Time-Based)
    SELECT start_time, end_time, (target_constraints ->> 'total_time_limit_sec')::INTEGER 
    INTO v_pool_start_time, v_pool_end_time, v_time_limit
    FROM public.event_pools
    WHERE id = p_pool_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pool not found';
    END IF;

    IF v_pool_start_time IS NOT NULL AND NOW() < v_pool_start_time THEN
        RAISE EXCEPTION 'Pool has not started yet';
    END IF;

    -- Check global pool deadline (30-second grace period for latency)
    IF v_pool_end_time IS NOT NULL AND NOW() > (v_pool_end_time + INTERVAL '30 seconds') THEN
        RAISE EXCEPTION 'Time limit exceeded';
    END IF;

    -- Check user start time limit (30-second grace period for latency)
    SELECT started_at INTO v_started_at
    FROM public.pool_participants
    WHERE pool_id = p_pool_id AND user_id = v_user_id;

    IF FOUND AND v_time_limit IS NOT NULL AND v_started_at IS NOT NULL THEN
        IF NOW() > (v_started_at + (v_time_limit || ' seconds')::INTERVAL + INTERVAL '30 seconds') THEN
            RAISE EXCEPTION 'Your specific time limit has expired';
        END IF;
    END IF;

    -- 3. Check for existing submission
    SELECT id INTO v_existing_submission
    FROM public.pool_submissions
    WHERE pool_id = p_pool_id AND user_id = v_user_id;

    IF FOUND THEN
        RAISE EXCEPTION 'You have already submitted an entry for this quiz';
    END IF;

    -- 4. Calculate Score (Server-Side)
    FOR v_question IN
        SELECT id, correct_option, points
        FROM public.pool_quiz_questions
        WHERE pool_id = p_pool_id
    LOOP
        v_answer := p_answers ->> v_question.id::TEXT;
        IF v_answer = v_question.correct_option THEN
            v_total_score := v_total_score + v_question.points;
        END IF;
    END LOOP;

    -- 5. Insert Submission Record
    INSERT INTO public.pool_submissions (pool_id, user_id, answers, score)
    VALUES (p_pool_id, v_user_id, p_answers, v_total_score);

    -- 6. Insert or Update Leaderboard (pool_participants)
    INSERT INTO public.pool_participants (pool_id, user_id, final_score, completed_at)
    VALUES (p_pool_id, v_user_id, v_total_score, NOW())
    ON CONFLICT (pool_id, user_id) DO UPDATE 
    SET final_score = EXCLUDED.final_score,
        completed_at = EXCLUDED.completed_at;

    RETURN jsonb_build_object('success', true, 'score', v_total_score);
END;
$$;


-- 2. Update submit_manual_evaluation to enforce time boundaries instead of manual status
CREATE OR REPLACE FUNCTION public.submit_manual_evaluation(p_pool_id UUID, p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_user_id UUID;
    v_existing_submission UUID;
    v_pool_start_time TIMESTAMPTZ;
    v_pool_end_time TIMESTAMPTZ;
BEGIN
    -- 1. Verify User
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    -- 2. Verify Pool Deadlines (Time-Based)
    SELECT start_time, end_time INTO v_pool_start_time, v_pool_end_time
    FROM public.event_pools
    WHERE id = p_pool_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pool not found';
    END IF;

    IF v_pool_start_time IS NOT NULL AND NOW() < v_pool_start_time THEN
        RAISE EXCEPTION 'Pool has not started yet';
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

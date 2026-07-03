-- 1. Modify public.pool_participants table schema
ALTER TABLE public.pool_participants ALTER COLUMN completed_at DROP NOT NULL;
ALTER TABLE public.pool_participants ALTER COLUMN completed_at SET DEFAULT NULL;
ALTER TABLE public.pool_participants ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;

-- 2. Add push_token column to notification_telemetry
ALTER TABLE public.notification_telemetry ADD COLUMN IF NOT EXISTS push_token TEXT;

-- 3. Create public.start_quiz RPC function (SECURITY DEFINER to allow writing to pool_participants)
CREATE OR REPLACE FUNCTION public.start_quiz(p_pool_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID;
    v_pool_status TEXT;
BEGIN
    -- Verify User
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    -- Verify Pool is live
    SELECT status INTO v_pool_status FROM public.event_pools WHERE id = p_pool_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pool not found';
    END IF;
    IF v_pool_status != 'live' THEN
        RAISE EXCEPTION 'Pool is not active';
    END IF;

    -- Register start time (idempotently: do not overwrite if already started)
    INSERT INTO public.pool_participants (pool_id, user_id, started_at, completed_at)
    VALUES (p_pool_id, v_user_id, NOW(), NULL)
    ON CONFLICT (pool_id, user_id) DO UPDATE
    SET started_at = COALESCE(pool_participants.started_at, EXCLUDED.started_at);

    RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.start_quiz(UUID) TO authenticated;

-- 4. Re-configure get_safe_quiz_questions as SECURITY DEFINER
CREATE OR REPLACE FUNCTION public.get_safe_quiz_questions(p_pool_id UUID)
RETURNS TABLE (
    id UUID,
    pool_id UUID,
    question_text TEXT,
    options JSONB,
    points INTEGER,
    difficulty_level TEXT
) 
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT 
        id,
        pool_id,
        question_text,
        options,
        points,
        difficulty_level
    FROM public.pool_quiz_questions
    WHERE pool_id = p_pool_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_safe_quiz_questions(UUID) TO authenticated;

-- 5. Re-configure and secure public.submit_quiz as SECURITY DEFINER
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
    v_pool_status TEXT;
    v_pool_end_time TIMESTAMPTZ;
    v_time_limit INTEGER;
    v_started_at TIMESTAMPTZ;
BEGIN
    -- 1. Verify User
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    -- 2. Verify Pool Status & Deadlines
    SELECT status, end_time, (target_constraints ->> 'total_time_limit_sec')::INTEGER 
    INTO v_pool_status, v_pool_end_time, v_time_limit
    FROM public.event_pools
    WHERE id = p_pool_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pool not found';
    END IF;

    IF v_pool_status != 'live' THEN
        RAISE EXCEPTION 'Pool is not active';
    END IF;

    -- Check global pool deadline (30-second grace period for latency)
    IF v_pool_end_time IS NOT NULL AND NOW() > (v_pool_end_time + INTERVAL '30 seconds') THEN
        RAISE EXCEPTION 'Time limit exceeded';
    END IF;

    -- Check user start time limit (30-second grace period for latency)
    SELECT started_at INTO v_started_at
    FROM public.pool_participants
    WHERE pool_id = p_pool_id AND user_id = v_user_id;

    IF v_time_limit IS NOT NULL AND v_started_at IS NOT NULL THEN
        IF NOW() > (v_started_at + (v_time_limit || ' seconds')::INTERVAL + INTERVAL '30 seconds') THEN
            RAISE EXCEPTION 'Quiz time limit exceeded';
        END IF;
    END IF;

    -- 3. Check for existing submission
    SELECT id INTO v_existing_submission
    FROM public.pool_submissions
    WHERE pool_id = p_pool_id AND user_id = v_user_id;

    IF FOUND THEN
        RAISE EXCEPTION 'You have already submitted answers for this quiz';
    END IF;

    -- 4. Grade the Answers
    FOR v_question IN SELECT q.id, q.correct_option, q.points FROM public.pool_quiz_questions q WHERE q.pool_id = p_pool_id LOOP
        v_answer := p_answers ->> v_question.id::TEXT;
        IF v_answer IS NOT NULL AND v_answer = v_question.correct_option THEN
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
    SET final_score = EXCLUDED.final_score, completed_at = EXCLUDED.completed_at;

    RETURN jsonb_build_object('success', true, 'score', v_total_score);
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_quiz(UUID, JSONB) TO authenticated;

-- 6. Add custom unique constraint exception handling in email swap RPCs
CREATE OR REPLACE FUNCTION public.execute_email_swap_v2(p_new_email TEXT)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID;
BEGIN
    v_user_id := auth.uid();
    
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    BEGIN
        -- Update the identity in auth.users
        UPDATE auth.users
        SET email = p_new_email,
            email_change = NULL,
            email_change_token_new = NULL,
            email_change_confirm_status = 0,
            updated_at = now()
        WHERE id = v_user_id;

        -- Update the custom profile in public.users
        UPDATE public.users
        SET email = p_new_email,
            updated_at = now()
        WHERE id = v_user_id;
    EXCEPTION
        WHEN unique_violation THEN
            RAISE EXCEPTION 'The email address is already in use by another account.';
        WHEN OTHERS THEN
            RAISE EXCEPTION 'Failed to update email: %', SQLERRM;
    END;

    RETURN json_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.execute_email_swap_v2(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.execute_email_swap(p_challenge_id UUID, p_new_email TEXT)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID;
    v_is_verified BOOLEAN;
BEGIN
    v_user_id := auth.uid();
    
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    -- Validate the challenge
    SELECT is_verified INTO v_is_verified
    FROM public.email_change_challenges
    WHERE id = p_challenge_id
      AND user_id = v_user_id
      AND expires_at > now()
    LIMIT 1;

    IF v_is_verified IS NULL OR v_is_verified = FALSE THEN
        RAISE EXCEPTION 'Invalid, expired, or unverified challenge';
    END IF;

    BEGIN
        -- Update the identity in auth.users
        UPDATE auth.users
        SET email = p_new_email,
            updated_at = now()
        WHERE id = v_user_id;

        -- Update the custom profile in public.users
        UPDATE public.users
        SET email = p_new_email,
            updated_at = now()
        WHERE id = v_user_id;
    EXCEPTION
        WHEN unique_violation THEN
            RAISE EXCEPTION 'The email address is already in use by another account.';
        WHEN OTHERS THEN
            RAISE EXCEPTION 'Failed to update email: %', SQLERRM;
    END;

    -- Destroy the challenge to prevent replay attacks
    DELETE FROM public.email_change_challenges
    WHERE id = p_challenge_id;

    RETURN json_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.execute_email_swap(UUID, TEXT) TO authenticated;

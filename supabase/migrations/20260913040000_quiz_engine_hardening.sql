-- ========================================================================
-- 1. ADD TIME-ELAPSED COLUMNS
-- ========================================================================
ALTER TABLE public.pool_submissions 
ADD COLUMN IF NOT EXISTS time_taken_seconds INTEGER;

ALTER TABLE public.pool_participants 
ADD COLUMN IF NOT EXISTS time_taken_seconds INTEGER;

-- ========================================================================
-- 2. REFACTOR 'submit_quiz' RPC WITH TIE-BREAKER & GRACE ENFORCEMENT
-- ========================================================================
CREATE OR REPLACE FUNCTION public.submit_quiz(p_pool_id UUID, p_answers JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_pool RECORD;
    v_participant RECORD;
    v_question RECORD;
    v_total_score NUMERIC(7,2) := 0;
    v_user_answer TEXT;
    v_elapsed_sec INTEGER;
    v_is_blind BOOLEAN := false;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    -- 1. Fetch Pool and verify active state
    SELECT * INTO v_pool FROM public.event_pools WHERE id = p_pool_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Event pool not found';
    END IF;

    IF v_pool.status != 'live' OR NOW() < v_pool.start_time OR NOW() > (v_pool.end_time + INTERVAL '30 seconds') THEN
        RAISE EXCEPTION 'Quiz submission window is closed';
    END IF;

    v_is_blind := COALESCE((v_pool.target_constraints->>'blind_results')::boolean, false);

    -- 2. Fetch Participant start timestamp
    SELECT * INTO v_participant FROM public.pool_participants 
    WHERE pool_id = p_pool_id AND user_id = auth.uid();

    IF NOT FOUND OR v_participant.started_at IS NULL THEN
        RAISE EXCEPTION 'Quiz was not properly initiated';
    END IF;

    IF v_participant.completed_at IS NOT NULL THEN
        RAISE EXCEPTION 'Quiz has already been submitted';
    END IF;

    -- Calculate elapsed seconds
    v_elapsed_sec := GREATEST(1, EXTRACT(EPOCH FROM (NOW() - v_participant.started_at))::INTEGER);

    -- 3. Calculate Score against pool_quiz_questions
    FOR v_question IN SELECT id, correct_option, points FROM public.pool_quiz_questions WHERE pool_id = p_pool_id LOOP
        v_user_answer := p_answers->>v_question.id::text;
        IF v_user_answer IS NOT NULL AND TRIM(v_user_answer) = TRIM(v_question.correct_option) THEN
            v_total_score := v_total_score + COALESCE(v_question.points, 1);
        END IF;
    END LOOP;

    -- 4. Record to pool_submissions
    INSERT INTO public.pool_submissions (
        pool_id,
        user_id,
        answers,
        score,
        time_taken_seconds
    ) VALUES (
        p_pool_id,
        auth.uid(),
        p_answers,
        v_total_score,
        v_elapsed_sec
    );

    -- 5. Update pool_participants (final_score and tie-breaker elapsed seconds)
    UPDATE public.pool_participants
    SET completed_at = NOW(),
        final_score = v_total_score,
        time_taken_seconds = v_elapsed_sec
    WHERE pool_id = p_pool_id AND user_id = auth.uid();

    -- Return response (strip score if blind_results is active)
    RETURN jsonb_build_object(
        'success', true,
        'submitted_at', NOW(),
        'time_taken_seconds', v_elapsed_sec,
        'score', CASE WHEN v_is_blind AND v_pool.status != 'completed' THEN NULL ELSE v_total_score END,
        'is_blind', v_is_blind AND v_pool.status != 'completed'
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_quiz(UUID, JSONB) TO authenticated;

-- ========================================================================
-- 3. DETERMINISTIC LEADERBOARD VIEW WITH TIE-BREAKING
-- ========================================================================
CREATE OR REPLACE VIEW public.pool_quiz_leaderboard 
WITH (security_invoker = true) AS
SELECT 
    p.pool_id,
    p.user_id,
    u.full_name,
    u.avatar_url,
    p.final_score,
    p.time_taken_seconds,
    p.completed_at,
    DENSE_RANK() OVER (
        PARTITION BY p.pool_id 
        ORDER BY p.final_score DESC, p.time_taken_seconds ASC, p.completed_at ASC
    ) as rank_position
FROM public.pool_participants p
JOIN public.users u ON u.id = p.user_id
WHERE p.completed_at IS NOT NULL;

GRANT SELECT ON public.pool_quiz_leaderboard TO authenticated;

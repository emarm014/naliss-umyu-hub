-- Step 1: Create a Secure View for Quiz Questions
-- This completely blocks the frontend from ever seeing the `correct_option` or `explanation` fields.
CREATE OR REPLACE VIEW public.pool_quiz_questions_safe AS
SELECT 
    id,
    pool_id,
    question_text,
    options,
    points,
    difficulty_level,
    created_at
FROM public.pool_quiz_questions;

-- Grant select access to authenticated users for the view
GRANT SELECT ON public.pool_quiz_questions_safe TO authenticated;

-- Revoke select access from the base table just to be absolutely sure (though RLS normally handles this)
-- But wait, if RLS allows it, we must drop the bad RLS policy on the base table.
DROP POLICY IF EXISTS "Enable read access for all authenticated users to pool_quiz_questions" ON public.pool_quiz_questions;

-- Re-add it but strictly restrict it so NO ONE can read it directly from the client except via the VIEW.
-- Postgres views execute with the privileges of the view owner, but wait, if it's a standard view, 
-- RLS on the underlying table still applies to the invoking user.
-- So instead of a VIEW, we must use a SECURITY DEFINER function to bypass RLS, OR we make the view a SECURITY INVOKER (pg 15)
-- Actually, the best way in Supabase is to just let the RPC handle grading, and the frontend calls an RPC to get questions.
-- Or better yet: allow SELECT on the base table but omit the sensitive columns? Postgres RLS doesn't do column-level easily.
-- Let's use a function to fetch questions.

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


-- Step 2: Auto-Grading RPC (Anti-Cheat Server Side Validation)
CREATE OR REPLACE FUNCTION public.submit_quiz(p_pool_id UUID, p_answers JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_user_id UUID;
    v_question RECORD;
    v_total_score INTEGER := 0;
    v_answer TEXT;
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
        RAISE EXCEPTION 'You have already submitted answers for this quiz';
    END IF;

    -- 4. Grade the Answers
    FOR v_question IN SELECT q.id, q.correct_option, q.points FROM public.pool_quiz_questions q WHERE q.pool_id = p_pool_id LOOP
        -- Extract answer from JSONB: p_answers ->> 'question_id'
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

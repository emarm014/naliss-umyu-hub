-- Migration: Fix Auto-Live for All Event Engines
-- Harmonizes start_quiz, submit_quiz, check_quiz_answer, advance_debate_turn,
-- submit_debate_entry, and cast_pool_vote (poll) so they all support 'scheduled' (Auto-Live) pools.

-- =====================================================================
-- 1. START QUIZ (Covers Quiz, Essay, and Challenge on-entry initialization)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.start_quiz(p_pool_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID;
    v_pool_status TEXT;
    v_start_time TIMESTAMPTZ;
    v_end_time TIMESTAMPTZ;
BEGIN
    -- Verify User
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    -- Verify Pool exists and is active (live or scheduled auto-live)
    SELECT status, start_time, end_time
    INTO v_pool_status, v_start_time, v_end_time
    FROM public.event_pools
    WHERE id = p_pool_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pool not found';
    END IF;

    IF v_pool_status NOT IN ('live', 'scheduled') THEN
        RAISE EXCEPTION 'Pool is not active';
    END IF;

    IF v_pool_status = 'scheduled' AND (v_start_time IS NULL OR NOW() < v_start_time) THEN
        RAISE EXCEPTION 'Event has not started yet';
    END IF;

    IF v_end_time IS NOT NULL AND NOW() > (v_end_time + INTERVAL '30 seconds') THEN
        RAISE EXCEPTION 'Event has concluded';
    END IF;

    -- Register start time (idempotently: do not overwrite if already started)
    INSERT INTO public.pool_participants (pool_id, user_id, started_at, completed_at)
    VALUES (p_pool_id, v_user_id, NOW(), NULL)
    ON CONFLICT (pool_id, user_id) DO UPDATE
    SET started_at = COALESCE(pool_participants.started_at, EXCLUDED.started_at);

    RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.start_quiz(UUID) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.start_quiz(UUID) TO authenticated;

-- =====================================================================
-- 2. SUBMIT QUIZ
-- =====================================================================
CREATE OR REPLACE FUNCTION public.submit_quiz(p_pool_id UUID, p_answers JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

    -- Allow quiz submission if status is 'live' OR 'scheduled' (Auto-Live) when within time window
    IF v_pool.status NOT IN ('live', 'scheduled') THEN
        RAISE EXCEPTION 'Quiz is only active while the event is live.';
    END IF;

    IF v_pool.status = 'scheduled' AND (v_pool.start_time IS NULL OR NOW() < v_pool.start_time) THEN
        RAISE EXCEPTION 'Quiz has not started yet.';
    END IF;

    IF v_pool.end_time IS NOT NULL AND NOW() > (v_pool.end_time + INTERVAL '30 seconds') THEN
        RAISE EXCEPTION 'Quiz submission window is closed.';
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

REVOKE EXECUTE ON FUNCTION public.submit_quiz(UUID, JSONB) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_quiz(UUID, JSONB) TO authenticated;

-- =====================================================================
-- 3. CHECK QUIZ ANSWER (Instant Feedback)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.check_quiz_answer(p_question_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_correct_option TEXT;
    v_pool_id UUID;
    v_instant_feedback BOOLEAN;
    v_status TEXT;
    v_start_time TIMESTAMPTZ;
    v_end_time TIMESTAMPTZ;
BEGIN
    -- Get pool and correct option
    SELECT pool_id, correct_option INTO v_pool_id, v_correct_option
    FROM public.pool_quiz_questions
    WHERE id = p_question_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Question not found';
    END IF;

    -- Verify that the pool has instant feedback enabled
    SELECT status, start_time, end_time, COALESCE((target_constraints->>'instant_feedback')::boolean, false)
    INTO v_status, v_start_time, v_end_time, v_instant_feedback
    FROM public.event_pools
    WHERE id = v_pool_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Event pool not found';
    END IF;

    IF v_status NOT IN ('live', 'scheduled') THEN
        RAISE EXCEPTION 'Event pool is not live';
    END IF;

    IF v_status = 'scheduled' AND (v_start_time IS NULL OR NOW() < v_start_time) THEN
        RAISE EXCEPTION 'Event pool has not started yet';
    END IF;

    IF v_end_time IS NOT NULL AND NOW() > (v_end_time + INTERVAL '30 seconds') THEN
        RAISE EXCEPTION 'Event pool has concluded';
    END IF;

    IF NOT v_instant_feedback THEN
        RAISE EXCEPTION 'Instant feedback is not enabled for this event';
    END IF;

    -- Verify user is an active user in the system
    IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND status = 'active') THEN
        RAISE EXCEPTION 'Not authorized';
    END IF;

    RETURN v_correct_option;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.check_quiz_answer(UUID) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_quiz_answer(UUID) TO authenticated;

-- =====================================================================
-- 4. ADVANCE DEBATE TURN
-- =====================================================================
CREATE OR REPLACE FUNCTION public.advance_debate_turn(p_pool_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID;
    v_user_role TEXT;
    v_pool_type TEXT;
    v_pool_status TEXT;
    v_start_time TIMESTAMPTZ;
    v_end_time TIMESTAMPTZ;
    v_constraints JSONB;
    v_debate_state JSONB;
    v_rounds JSONB;
    v_current_index INT;
    v_next_index INT;
    v_next_round JSONB;
    v_duration_sec INT;
    v_next_turn_ends_at TIMESTAMPTZ;
    v_next_speaker_id TEXT;
BEGIN
    -- 1. Authenticate caller
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    -- 2. Verify caller is moderator or super_admin
    SELECT role INTO v_user_role
    FROM public.users
    WHERE id = v_user_id;

    IF v_user_role IS NULL OR v_user_role NOT IN ('moderator', 'super_admin') THEN
        RAISE EXCEPTION 'Only moderators or administrators can advance debate turns';
    END IF;

    -- 3. Fetch pool and validate type + status
    SELECT type::text, status::text, start_time, end_time, target_constraints
    INTO v_pool_type, v_pool_status, v_start_time, v_end_time, v_constraints
    FROM public.event_pools
    WHERE id = p_pool_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Event pool not found';
    END IF;

    IF v_pool_type != 'debate' THEN
        RAISE EXCEPTION 'This function is only for debate-type pools';
    END IF;

    IF v_pool_status NOT IN ('live', 'scheduled') THEN
        RAISE EXCEPTION 'Debate pool is not currently live';
    END IF;

    IF v_pool_status = 'scheduled' AND (v_start_time IS NULL OR NOW() < v_start_time) THEN
        RAISE EXCEPTION 'Debate has not started yet';
    END IF;

    IF v_end_time IS NOT NULL AND NOW() > (v_end_time + INTERVAL '30 seconds') THEN
        RAISE EXCEPTION 'Debate has concluded';
    END IF;

    -- 4. Extract debate_state from target_constraints
    v_debate_state := v_constraints -> 'debate_state';
    IF v_debate_state IS NULL THEN
        RAISE EXCEPTION 'Debate state not initialized in target_constraints';
    END IF;

    v_rounds := v_debate_state -> 'rounds';
    v_current_index := COALESCE((v_debate_state ->> 'current_round_index')::int, -1);
    v_next_index := v_current_index + 1;

    -- 5. Check if there are more rounds
    IF v_next_index >= jsonb_array_length(v_rounds) THEN
        -- All rounds finished — mark pool as completed
        UPDATE public.event_pools
        SET
            status = 'completed',
            target_constraints = jsonb_set(
                v_constraints,
                '{debate_state}',
                v_debate_state || jsonb_build_object(
                    'current_round_index', v_next_index,
                    'active_speaker_id', NULL,
                    'turn_ends_at', NULL,
                    'completed_at', NOW()
                )
            ),
            updated_at = NOW()
        WHERE id = p_pool_id;

        RETURN jsonb_build_object(
            'finished', true,
            'total_rounds', jsonb_array_length(v_rounds),
            'completed_at', NOW()
        );
    END IF;

    -- 6. Advance to next round
    v_next_round := v_rounds -> v_next_index;
    v_duration_sec := COALESCE((v_next_round ->> 'duration_sec')::int, 180);
    v_next_turn_ends_at := NOW() + (v_duration_sec || ' seconds')::interval;
    v_next_speaker_id := v_next_round ->> 'speaker_id';

    -- 7. Update target_constraints with new round state
    UPDATE public.event_pools
    SET
        target_constraints = jsonb_set(
            v_constraints,
            '{debate_state}',
            v_debate_state || jsonb_build_object(
                'current_round_index', v_next_index,
                'active_speaker_id', v_next_speaker_id,
                'turn_ends_at', v_next_turn_ends_at
            )
        ),
        updated_at = NOW()
    WHERE id = p_pool_id;

    RETURN jsonb_build_object(
        'finished', false,
        'current_round_index', v_next_index,
        'round_name', v_next_round ->> 'round_name',
        'active_speaker_id', v_next_speaker_id,
        'speaker_side', v_next_round ->> 'speaker_side',
        'duration_sec', v_duration_sec,
        'turn_ends_at', v_next_turn_ends_at
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.advance_debate_turn(UUID) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.advance_debate_turn(UUID) TO authenticated;

-- =====================================================================
-- 5. SUBMIT DEBATE ENTRY
-- =====================================================================
CREATE OR REPLACE FUNCTION public.submit_debate_entry(p_pool_id UUID, p_content JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID;
    v_pool_status TEXT;
    v_start_time TIMESTAMPTZ;
    v_end_time TIMESTAMPTZ;
    v_constraints JSONB;
    v_debate_state JSONB;
    v_active_speaker_id TEXT;
    v_turn_ends_at TIMESTAMPTZ;
    v_current_round_index INT;
    v_round_name TEXT;
BEGIN
    -- 1. Authenticate
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    -- 2. Fetch pool
    SELECT status::text, start_time, end_time, target_constraints
    INTO v_pool_status, v_start_time, v_end_time, v_constraints
    FROM public.event_pools
    WHERE id = p_pool_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Event pool not found';
    END IF;

    IF v_pool_status NOT IN ('live', 'scheduled') THEN
        RAISE EXCEPTION 'Debate is not currently live';
    END IF;

    IF v_pool_status = 'scheduled' AND (v_start_time IS NULL OR NOW() < v_start_time) THEN
        RAISE EXCEPTION 'Debate has not started yet';
    END IF;

    IF v_end_time IS NOT NULL AND NOW() > (v_end_time + INTERVAL '30 seconds') THEN
        RAISE EXCEPTION 'Debate has concluded';
    END IF;

    -- 3. Extract debate state
    v_debate_state := v_constraints -> 'debate_state';
    IF v_debate_state IS NULL THEN
        RAISE EXCEPTION 'Debate state not initialized';
    END IF;

    v_active_speaker_id := v_debate_state ->> 'active_speaker_id';
    v_turn_ends_at := (v_debate_state ->> 'turn_ends_at')::timestamptz;
    v_current_round_index := COALESCE((v_debate_state ->> 'current_round_index')::int, 0);

    -- 4. Verify caller is the active speaker
    IF v_user_id::text != v_active_speaker_id THEN
        RAISE EXCEPTION 'It is not your turn to speak';
    END IF;

    -- 5. Verify within time window (5s latency grace)
    IF v_turn_ends_at IS NOT NULL AND NOW() > (v_turn_ends_at + INTERVAL '5 seconds') THEN
        RAISE EXCEPTION 'Your speaking time has expired';
    END IF;

    -- 6. Get round name for the submission record
    v_round_name := COALESCE(
        v_debate_state -> 'rounds' -> v_current_round_index ->> 'round_name',
        'Round ' || (v_current_round_index + 1)
    );

    -- 7. Insert speech/argument into pool_submissions
    INSERT INTO public.pool_submissions (pool_id, user_id, answers, score, submitted_at)
    VALUES (
        p_pool_id,
        v_user_id,
        jsonb_build_object(
            'entries', jsonb_build_array(
                jsonb_build_object(
                    'round_index', v_current_round_index,
                    'round_name', v_round_name,
                    'content', p_content,
                    'submitted_at', NOW()
                )
            )
        ),
        NULL,
        NOW()
    )
    ON CONFLICT (pool_id, user_id) DO UPDATE
    SET answers = jsonb_set(
        pool_submissions.answers,
        '{entries}',
        COALESCE(pool_submissions.answers -> 'entries', '[]'::jsonb) || jsonb_build_array(
            jsonb_build_object(
                'round_index', v_current_round_index,
                'round_name', v_round_name,
                'content', p_content,
                'submitted_at', NOW()
            )
        )
    ),
    submitted_at = NOW();

    RETURN jsonb_build_object(
        'success', true,
        'round_index', v_current_round_index,
        'round_name', v_round_name,
        'submitted_at', NOW()
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.submit_debate_entry(UUID, JSONB) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_debate_entry(UUID, JSONB) TO authenticated;

-- =====================================================================
-- 6. CAST POOL VOTE (Poll / Single-Post Option Voting)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.cast_pool_vote(p_pool_id UUID, p_option_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID;
    v_pool_status TEXT;
    v_pool_start_time TIMESTAMPTZ;
    v_pool_end_time TIMESTAMPTZ;
    v_existing_submission UUID;
BEGIN
    -- 1. Ensure the voter is authenticated
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    -- 2. Fetch pool status and time boundaries
    SELECT status, start_time, end_time
    INTO v_pool_status, v_pool_start_time, v_pool_end_time
    FROM public.event_pools
    WHERE id = p_pool_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Event pool not found';
    END IF;

    -- 3. Verify pool is live or scheduled (Auto-Live) within boundaries
    IF v_pool_status NOT IN ('live', 'scheduled') THEN
        RAISE EXCEPTION 'Voting is closed';
    END IF;

    IF v_pool_status = 'scheduled' AND (v_pool_start_time IS NULL OR NOW() < v_pool_start_time) THEN
        RAISE EXCEPTION 'Voting has not started yet';
    END IF;

    IF v_pool_end_time IS NOT NULL AND NOW() > (v_pool_end_time + INTERVAL '30 seconds') THEN
        RAISE EXCEPTION 'Voting is closed';
    END IF;

    -- 4. Check for double voting in pool_submissions
    SELECT id INTO v_existing_submission
    FROM public.pool_submissions
    WHERE pool_id = p_pool_id AND user_id = v_user_id;

    IF FOUND THEN
        RAISE EXCEPTION 'You have already voted in this event';
    END IF;

    -- 5. Record the vote in pool_submissions
    INSERT INTO public.pool_submissions (pool_id, user_id, answers, score)
    VALUES (p_pool_id, v_user_id, jsonb_build_object('selected_option', p_option_id), NULL);

    -- 6. Insert or Update participation record
    INSERT INTO public.pool_participants (pool_id, user_id, completed_at)
    VALUES (p_pool_id, v_user_id, NOW())
    ON CONFLICT (pool_id, user_id) DO UPDATE
    SET completed_at = EXCLUDED.completed_at;

    RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cast_pool_vote(UUID, TEXT) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.cast_pool_vote(UUID, TEXT) TO authenticated;

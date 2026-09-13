-- Migration: Debate State Machine — Turn Advancement & Floor Control
-- Phase 4 of Event Engine Stabilization
--
-- Debate state is stored in event_pools.target_constraints as JSONB:
-- {
--   "debate_state": {
--     "rounds": [
--       { "round_name": "Opening - Affirmative", "speaker_id": "uuid", "speaker_side": "affirmative", "duration_sec": 180 },
--       { "round_name": "Opening - Opposition", "speaker_id": "uuid", "speaker_side": "opposition", "duration_sec": 180 },
--       ...
--     ],
--     "current_round_index": 0,
--     "active_speaker_id": "uuid",
--     "turn_ends_at": "ISO timestamp"
--   }
-- }

-- =====================================================================
-- 1. advance_debate_turn: Moderator-only round advancement
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
    SELECT type::text, status::text, target_constraints
    INTO v_pool_type, v_pool_status, v_constraints
    FROM public.event_pools
    WHERE id = p_pool_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Event pool not found';
    END IF;

    IF v_pool_type != 'debate' THEN
        RAISE EXCEPTION 'This function is only for debate-type pools';
    END IF;

    IF v_pool_status != 'live' THEN
        RAISE EXCEPTION 'Debate pool is not currently live';
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

GRANT EXECUTE ON FUNCTION public.advance_debate_turn(UUID) TO authenticated;


-- =====================================================================
-- 2. submit_debate_entry: Speaker-only argument submission per round
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
    SELECT status::text, target_constraints
    INTO v_pool_status, v_constraints
    FROM public.event_pools
    WHERE id = p_pool_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Event pool not found';
    END IF;

    IF v_pool_status != 'live' THEN
        RAISE EXCEPTION 'Debate is not currently live';
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
    --    Uses ON CONFLICT to upsert (updates the answers JSONB with each round appended)
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

GRANT EXECUTE ON FUNCTION public.submit_debate_entry(UUID, JSONB) TO authenticated;

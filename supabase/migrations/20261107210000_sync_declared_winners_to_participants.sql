-- ============================================================================
-- Migration: Sync declared event winners into pool_participants
-- ----------------------------------------------------------------------------
-- Why:
--   Admins declare winners by setting pool_submissions.podium_status.
--   Students can only SELECT their OWN pool_submissions rows (RLS), so the
--   mobile app can never read other users' podium_status. Public winner
--   displays therefore read pool_participants.winner_position (SELECT is open
--   to all authenticated users).
--
--   Previously winner_position was only written by the admin client, and the
--   write silently did nothing whenever the participant row did not exist.
--   This migration:
--     1. Adds a trigger that keeps winner_position in lock-step with
--        podium_status for EVERY write path (admin UI, SQL, RPCs).
--     2. Backfills winner_position for all winners already declared.
-- ============================================================================

-- 1. Podium label -> numeric position (mirrors the admin "Podium Assignment" options)
CREATE OR REPLACE FUNCTION public.podium_status_to_position(p_status TEXT)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
    SELECT CASE p_status
        WHEN 'Winner'        THEN 1
        WHEN '1st Runner-Up' THEN 2
        WHEN '2nd Runner-Up' THEN 3
        WHEN '4th Position'  THEN 4
        WHEN '5th Position'  THEN 5
        ELSE NULL
    END;
$$;

-- 2. Trigger function: mirror podium_status onto pool_participants.winner_position
CREATE OR REPLACE FUNCTION public.sync_submission_podium_to_participant()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_position INTEGER;
BEGIN
    -- Skip no-op updates
    IF TG_OP = 'UPDATE' AND NEW.podium_status IS NOT DISTINCT FROM OLD.podium_status THEN
        RETURN NEW;
    END IF;

    v_position := public.podium_status_to_position(NEW.podium_status);

    IF v_position IS NOT NULL THEN
        -- Create the participant row if it is missing, otherwise just set the position
        INSERT INTO public.pool_participants (pool_id, user_id, completed_at, winner_position)
        VALUES (NEW.pool_id, NEW.user_id, COALESCE(NEW.submitted_at, NOW()), v_position)
        ON CONFLICT (pool_id, user_id)
        DO UPDATE SET winner_position = EXCLUDED.winner_position;
    ELSIF TG_OP = 'UPDATE' THEN
        -- Podium was removed by the admin -> un-declare the winner
        UPDATE public.pool_participants
        SET winner_position = NULL
        WHERE pool_id = NEW.pool_id
          AND user_id = NEW.user_id
          AND winner_position IS NOT NULL;
    END IF;

    RETURN NEW;
END;
$$;

-- Trigger functions must never be callable through the REST API
REVOKE EXECUTE ON FUNCTION public.sync_submission_podium_to_participant() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_sync_submission_podium_to_participant ON public.pool_submissions;
CREATE TRIGGER trg_sync_submission_podium_to_participant
    AFTER INSERT OR UPDATE OF podium_status ON public.pool_submissions
    FOR EACH ROW
    EXECUTE FUNCTION public.sync_submission_podium_to_participant();

-- 3. Backfill every winner that has already been declared
INSERT INTO public.pool_participants (pool_id, user_id, completed_at, winner_position)
SELECT ps.pool_id,
       ps.user_id,
       COALESCE(ps.submitted_at, NOW()),
       public.podium_status_to_position(ps.podium_status)
FROM public.pool_submissions ps
WHERE public.podium_status_to_position(ps.podium_status) IS NOT NULL
ON CONFLICT (pool_id, user_id)
DO UPDATE SET winner_position = EXCLUDED.winner_position;

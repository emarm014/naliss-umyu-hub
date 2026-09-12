-- Migration: Fix Automated Winner Feed Category
-- Description: Updates the trigger_event_pool_winner_announcement function to use the correct 'event' category instead of 'event_results' which violates the check constraint.

CREATE OR REPLACE FUNCTION public.trigger_event_pool_winner_announcement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_winners_text TEXT := '';
    v_announcement_content TEXT;
    v_sub RECORD;
BEGIN
    -- Check if status is transitioning to 'completed' or 'archived'
    IF NEW.status::text IN ('completed', 'archived') AND OLD.status::text NOT IN ('completed', 'archived') THEN
        
        -- Gather winners
        FOR v_sub IN 
            SELECT ps.podium_status, u.full_name, u.username
            FROM public.pool_submissions ps
            JOIN public.users u ON u.id = ps.user_id
            WHERE ps.pool_id = NEW.id
              AND ps.podium_status IS NOT NULL
            ORDER BY 
              CASE ps.podium_status 
                WHEN 'Winner' THEN 1 
                WHEN '1st Runner-Up' THEN 2 
                WHEN '2nd Runner-Up' THEN 3 
                ELSE 4 
              END
        LOOP
            v_winners_text := v_winners_text || chr(10) || '• **' || v_sub.podium_status || '**: ' || v_sub.full_name || ' (@' || v_sub.username || ')';
        END LOOP;

        IF v_winners_text != '' THEN
            v_announcement_content := 'Congratulations to the top performers of the **' || NEW.title || '** event!' || chr(10) || chr(10) || '🏆 **Results:**' || v_winners_text || chr(10) || chr(10) || 'Tap here to view the event details! [pool_id:' || NEW.id || ']';
            
            INSERT INTO public.announcements (
                title,
                content,
                category,
                priority,
                is_published,
                is_pinned,
                created_at,
                updated_at
            ) VALUES (
                '🏆 ' || NEW.title || ' Results Announced!',
                v_announcement_content,
                'event',
                'high',
                true,
                false,
                NOW(),
                NOW()
            );
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

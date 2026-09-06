-- Migration: Sync featured student deletions and deactivations with notification history

CREATE OR REPLACE FUNCTION public.sync_featured_student_notifications()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        -- Delete all congratulations notifications for this featured student
        DELETE FROM public.notification_history
        WHERE type = 'fyb_congratulation'
          AND data->>'featured_student_id' = OLD.id::text;
        
        RETURN OLD;
    ELSIF TG_OP = 'UPDATE' THEN
        -- If deactivated (is_active changed from true to false)
        IF OLD.is_active = true AND NEW.is_active = false THEN
            -- Shift the notification to general messages
            UPDATE public.notification_history
            SET type = 'message'
            WHERE type = 'fyb_congratulation'
              AND data->>'featured_student_id' = NEW.id::text;
        END IF;
        
        RETURN NEW;
    END IF;
    
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create triggers
DROP TRIGGER IF EXISTS trg_featured_students_notif_sync_delete ON public.featured_students;
CREATE TRIGGER trg_featured_students_notif_sync_delete
AFTER DELETE ON public.featured_students
FOR EACH ROW
EXECUTE FUNCTION public.sync_featured_student_notifications();

DROP TRIGGER IF EXISTS trg_featured_students_notif_sync_update ON public.featured_students;
CREATE TRIGGER trg_featured_students_notif_sync_update
AFTER UPDATE ON public.featured_students
FOR EACH ROW
WHEN (OLD.is_active = true AND NEW.is_active = false)
EXECUTE FUNCTION public.sync_featured_student_notifications();

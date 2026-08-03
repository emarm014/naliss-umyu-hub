-- Migration: 20260803163500_harden_secure_event_ticket.sql
-- Description: Explicitly revoke EXECUTE from PUBLIC and anon on student-authenticated RPC functions and grant exclusively to authenticated role.

DO $$
DECLARE
    func_name text;
    funcs text[] := ARRAY[
        'secure_event_ticket(uuid)',
        'congratulate_student(uuid)',
        'start_quiz(uuid)',
        'submit_quiz(uuid, jsonb)',
        'get_safe_quiz_questions(uuid)',
        'check_quiz_answer(uuid)',
        'execute_email_swap_v2(text)',
        'fetch_activity_trends()',
        'check_username_availability(text, text)',
        'check_matric_availability(text, text)',
        'check_existing_account(text)',
        'check_registration_status(text)'
    ];
BEGIN
    FOREACH func_name IN ARRAY funcs LOOP
        BEGIN
            EXECUTE 'REVOKE EXECUTE ON FUNCTION public.' || func_name || ' FROM PUBLIC, anon';
            EXECUTE 'GRANT EXECUTE ON FUNCTION public.' || func_name || ' TO authenticated';
        EXCEPTION WHEN OTHERS THEN NULL;
        END;
    END LOOP;
END;
$$;

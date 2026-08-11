-- RPC: delete_user_account
-- Deletes all user data across all tables, then the auth user
CREATE OR REPLACE FUNCTION public.delete_user_account(user_id_to_delete UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Verify the caller is deleting their OWN account
    IF auth.uid() IS DISTINCT FROM user_id_to_delete THEN
        RAISE EXCEPTION 'Not authorized to delete this account';
    END IF;

    -- Archive user to deleted_accounts
    INSERT INTO public.deleted_accounts (original_user_id, email, full_name, username, level, logs)
    SELECT id, email, full_name, username, level, jsonb_build_object('deleted_by', auth.uid(), 'deletion_time', now())
    FROM public.users
    WHERE id = user_id_to_delete;

    -- Delete user's messages
    DELETE FROM public.messages WHERE sender_id = user_id_to_delete;
    
    -- Delete other user data
    DELETE FROM public.user_sessions WHERE user_id = user_id_to_delete;
    DELETE FROM public.device_sessions WHERE user_id = user_id_to_delete;
    DELETE FROM public.chat_members WHERE user_id = user_id_to_delete;
    DELETE FROM public.users WHERE id = user_id_to_delete;
    
    -- Finally, delete the auth user
    DELETE FROM auth.users WHERE id = user_id_to_delete;
END;
$$;

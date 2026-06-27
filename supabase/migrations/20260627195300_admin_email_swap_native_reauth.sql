-- Migration: 20260627195300_admin_email_swap_native_reauth.sql
-- Description: Creates a secure RPC execute_email_swap_v2 to support native Supabase Auth reauthentication.

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

    RETURN json_build_object('success', true);
END;
$$;

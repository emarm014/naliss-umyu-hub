-- Migration: 20260712131703_fix_auth_identities_email_sync.sql
-- Description: Fixes the identity_data in auth.identities to match auth.users.email, preventing "Database error querying schema" on login after an email swap, and updates execute_email_swap_v2 to handle identities properly.

-- 1. Repair any existing broken identities
UPDATE auth.identities
SET identity_data = jsonb_set(identity_data, '{email}', to_jsonb(u.email))
FROM auth.users u
WHERE auth.identities.user_id = u.id
  AND auth.identities.provider = 'email'
  AND (auth.identities.identity_data->>'email') IS DISTINCT FROM u.email;

-- 2. Update execute_email_swap_v2 to securely update BOTH tables
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
        email_change = '',
        email_change_token_new = '',
        email_change_confirm_status = 0,
        updated_at = now()
    WHERE id = v_user_id;

    -- Update the identity in auth.identities so GoTrue does not crash
    UPDATE auth.identities
    SET identity_data = jsonb_set(identity_data, '{email}', to_jsonb(p_new_email::text))
    WHERE user_id = v_user_id
      AND provider = 'email';

    -- Update the custom profile in public.users
    UPDATE public.users
    SET email = p_new_email,
        updated_at = now()
    WHERE id = v_user_id;

    RETURN json_build_object('success', true);
END;
$$;

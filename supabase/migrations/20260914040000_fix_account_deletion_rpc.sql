-- ============================================================================
-- FIX ACCOUNT DELETION RPC
-- Migration: 20260914040000_fix_account_deletion_rpc.sql
--
-- The previous delete_user_account RPC attempted to delete from tables that
-- do not exist in the schema (device_sessions, messages, chat_members),
-- causing a "relation does not exist" error during account deletion.
-- This migration updates the RPC to only clean up existing tables, relying
-- on ON DELETE CASCADE constraints for the rest of the related data.
-- It also allows admins/super_admins to delete accounts in addition to self-deletion.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.delete_user_account(user_id_to_delete UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Verify the caller is deleting their OWN account OR caller is an admin
    IF auth.uid() IS DISTINCT FROM user_id_to_delete AND NOT EXISTS (
        SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
    ) THEN
        RAISE EXCEPTION 'Not authorized to delete this account';
    END IF;

    -- Archive user to deleted_accounts
    INSERT INTO public.deleted_accounts (original_user_id, email, full_name, username, level, logs)
    SELECT id, email, full_name, username, level, jsonb_build_object('deleted_by', auth.uid(), 'deletion_time', now())
    FROM public.users
    WHERE id = user_id_to_delete;
    
    -- Delete other user data that does not cascade automatically
    DELETE FROM public.user_sessions WHERE user_id = user_id_to_delete;
    
    -- (Other tables like group_members, pool_participants, etc. use ON DELETE CASCADE 
    -- referencing auth.users or public.users, so they will be automatically cleaned up)
    
    -- Delete the public user record
    DELETE FROM public.users WHERE id = user_id_to_delete;
    
    -- Finally, delete the auth user
    DELETE FROM auth.users WHERE id = user_id_to_delete;
END;
$$;

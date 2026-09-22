-- Migration: 20260922120000_fix_rpc_grants.sql
-- Description: Explicitly re-grants execution permissions for core RPCs to the authenticated role.
-- This ensures that despite the hardening in previous migrations, authenticated users are
-- never locked out of presence and read-receipt functions, which resolves 42501 errors.

GRANT EXECUTE ON FUNCTION public.mark_group_as_read(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_last_active() TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_last_seen() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_group_unread_counts(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_announcement_as_read(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_all_announcements_as_read(text) TO authenticated;

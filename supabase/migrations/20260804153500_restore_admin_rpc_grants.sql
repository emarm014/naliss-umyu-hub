-- Migration: 20260804153500_restore_admin_rpc_grants.sql
-- Description: Grant EXECUTE on admin RPC functions to authenticated role so signed-in admins and moderators can access analytics and administrative functions from the Admin Portal. Functions perform internal role-based authorization checks.

GRANT EXECUTE ON FUNCTION public.fetch_admin_analytics() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_notification_analytics() TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_all_pool_applications(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_pool_application(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unapprove_pool_application(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_moderator_permissions(uuid, jsonb) TO authenticated;

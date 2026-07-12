-- Fix missing EXECUTE permissions for admin/moderator RPCs that were revoked from PUBLIC
-- but never granted to authenticated users in previous remediation scripts.

GRANT EXECUTE ON FUNCTION public.fetch_activity_trends() TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_pool_application(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.archive_executive_tenure(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin_or_moderator() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated;

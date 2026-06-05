-- Migration to grant table-level privileges on public.user_sessions
-- Since default privileges are tightened/revoked, new tables require explicit grants
-- to be accessible by PostgREST client roles (anon, authenticated, service_role).
-- Row-level security (RLS) is enabled and will enforce row-level access control.

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_sessions TO anon, authenticated, service_role;

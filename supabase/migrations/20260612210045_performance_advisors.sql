-- Enable pg_trgm for fast text search
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

-- Drop redundant indexes on group_members
DROP INDEX IF EXISTS public.idx_group_members_group_id_user_id;
DROP INDEX IF EXISTS public.idx_group_members_group_id;

-- Create missing indexes for users based on high sequential scans
CREATE INDEX IF NOT EXISTS idx_users_status ON public.users USING btree (status);

-- Create trigram indexes for fast text search on users (ILIKE searches)
CREATE INDEX IF NOT EXISTS idx_users_full_name_trgm ON public.users USING gin (full_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_users_username_trgm ON public.users USING gin (username gin_trgm_ops);

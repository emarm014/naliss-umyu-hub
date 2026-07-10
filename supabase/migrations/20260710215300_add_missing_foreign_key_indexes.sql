-- Migration: Add Missing Foreign Key Indexes
-- Description: Adds indexes to heavily queried foreign keys that were identified during static analysis to prevent sequential scans and table locks.
-- Note: In Supabase, creating indexes concurrently is not supported inside a transaction block, which migrations use by default. 
-- We are using standard CREATE INDEX here. If the tables are very large in production, this migration should be run outside of standard transactions.

-- 1. user_announcement_reads: announcement_id
-- (user_id is the first column in a UNIQUE constraint, but announcement_id needs an index for joins/cascade deletes)
CREATE INDEX IF NOT EXISTS idx_user_announcement_reads_announcement_id ON public.user_announcement_reads(announcement_id);

-- 2. activity_logs: user_id
-- Very heavily queried for user history and dashboard views.
CREATE INDEX IF NOT EXISTS idx_activity_logs_user_id ON public.activity_logs(user_id);

-- 3. group_members: user_id
-- group_members typically has (group_id, user_id) as primary key or unique constraint. 
-- But querying for "all groups a user is in" by user_id alone requires an index.
CREATE INDEX IF NOT EXISTS idx_group_members_user_id ON public.group_members(user_id);

-- 4. activity_logs: target_id (Optional but recommended if querying by target)
-- If target_id references various polymorphic entities or specific ones.
-- CREATE INDEX IF NOT EXISTS idx_activity_logs_target_id ON public.activity_logs(target_id);

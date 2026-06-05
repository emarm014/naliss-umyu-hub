-- Migration to fix the foreign key constraint of user_sessions
-- Drop the existing constraint linking user_sessions.user_id to auth.users.id
-- Replace it with a constraint linking user_sessions.user_id to public.users.id
-- This allows PostgREST to automatically recognize and join the relation.

-- 1. Drop existing constraints if they exist
ALTER TABLE public.user_sessions 
DROP CONSTRAINT IF EXISTS user_sessions_user_id_fkey,
DROP CONSTRAINT IF EXISTS user_sessions_user_id_fkey1,
DROP CONSTRAINT IF EXISTS fk_user;

-- 2. Add the correct foreign key constraint to public.users
ALTER TABLE public.user_sessions
ADD CONSTRAINT user_sessions_user_id_fkey 
FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

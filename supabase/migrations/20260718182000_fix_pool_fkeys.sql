-- Fix foreign keys to allow PostgREST to join with public.users
ALTER TABLE public.pool_applications DROP CONSTRAINT IF EXISTS pool_applications_user_id_fkey;
ALTER TABLE public.pool_applications ADD CONSTRAINT pool_applications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE public.pool_participants DROP CONSTRAINT IF EXISTS pool_participants_user_id_fkey;
ALTER TABLE public.pool_participants ADD CONSTRAINT pool_participants_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE public.pool_submissions DROP CONSTRAINT IF EXISTS pool_submissions_user_id_fkey;
ALTER TABLE public.pool_submissions ADD CONSTRAINT pool_submissions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

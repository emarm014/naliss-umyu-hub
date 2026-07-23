-- Fix foreign keys to allow PostgREST to join with public.users
ALTER TABLE public.featured_students DROP CONSTRAINT IF EXISTS featured_students_user_id_fkey;
ALTER TABLE public.featured_students ADD CONSTRAINT featured_students_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE public.featured_students DROP CONSTRAINT IF EXISTS featured_students_created_by_fkey;
ALTER TABLE public.featured_students ADD CONSTRAINT featured_students_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE public.student_congratulations DROP CONSTRAINT IF EXISTS student_congratulations_user_id_fkey;
ALTER TABLE public.student_congratulations ADD CONSTRAINT student_congratulations_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

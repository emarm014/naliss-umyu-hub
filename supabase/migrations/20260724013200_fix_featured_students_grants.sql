-- Fix grants for featured_students to allow authenticated users (specifically admins via RLS) to insert, update, and delete.

GRANT INSERT, UPDATE, DELETE ON public.featured_students TO authenticated;

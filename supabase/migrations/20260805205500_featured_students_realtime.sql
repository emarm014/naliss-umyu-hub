-- Enable realtime for featured_students
DO $$ 
BEGIN 
    ALTER PUBLICATION supabase_realtime ADD TABLE public.featured_students;
EXCEPTION WHEN duplicate_object THEN
    NULL;
END $$;

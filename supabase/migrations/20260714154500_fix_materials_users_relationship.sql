-- Fix missing foreign key relationship between materials and users
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'materials_uploaded_by_fkey' AND table_name = 'materials'
    ) THEN
        ALTER TABLE "public"."materials"
        ADD CONSTRAINT "materials_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;
    END IF;
END $$;

-- Fix missing foreign key relationship between resources and users
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'resources_uploaded_by_fkey' AND table_name = 'resources'
    ) THEN
        ALTER TABLE "public"."resources"
        ADD CONSTRAINT "resources_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;
    END IF;
END $$;

-- Fix missing foreign key relationship between past_questions and users
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'past_questions_uploaded_by_fkey' AND table_name = 'past_questions'
    ) THEN
        ALTER TABLE "public"."past_questions"
        ADD CONSTRAINT "past_questions_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;
    END IF;
END $$;

-- Notify PostgREST to reload the schema cache so the API recognizes the new relationships
NOTIFY pgrst, 'reload schema';

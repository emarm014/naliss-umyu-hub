-- Add JSONB 'files' column to 'materials' and 'past_questions'
ALTER TABLE materials ADD COLUMN files JSONB DEFAULT '[]'::jsonb;
ALTER TABLE past_questions ADD COLUMN files JSONB DEFAULT '[]'::jsonb;

-- Optimized indexing for NALISS UMYU Hub Group Chat performance

-- 1. Composite B-Tree index optimized for group history queries (where group_id = $1 ORDER BY created_at DESC)
CREATE INDEX IF NOT EXISTS idx_messages_group_id_created_at ON public.messages (group_id, created_at DESC);

-- 2. Foreign key lookup index on group_members (optimizes membership checks, lists, and RLS policies)
CREATE INDEX IF NOT EXISTS idx_group_members_group_id_user_id ON public.group_members (group_id, user_id);

-- 3. Foreign key lookup index on messages (sender_id) (optimizes sender profile joins)
CREATE INDEX IF NOT EXISTS idx_messages_sender_id ON public.messages (sender_id);

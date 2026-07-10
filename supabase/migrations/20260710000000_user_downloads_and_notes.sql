-- 20260710000000_user_downloads_and_notes.sql
-- Tracks per-user downloads across devices + syncs notepad to the cloud

-- ── USER DOWNLOADS ──────────────────────────────────────────────────────────
-- Records every file a user has downloaded so it can be restored on a new device
CREATE TABLE IF NOT EXISTS public.user_downloads (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    asset_id TEXT NOT NULL,
    asset_type TEXT NOT NULL,
    remote_url TEXT NOT NULL,
    metadata JSONB DEFAULT '{}',
    downloaded_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_downloads_user_id ON public.user_downloads(user_id);

ALTER TABLE public.user_downloads ENABLE ROW LEVEL SECURITY;

-- Users can only see their own downloads
CREATE POLICY user_downloads_select ON public.user_downloads
    FOR SELECT USING (auth.uid() = user_id);

-- Users can insert their own downloads
CREATE POLICY user_downloads_insert ON public.user_downloads
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Users can delete their own downloads
CREATE POLICY user_downloads_delete ON public.user_downloads
    FOR DELETE USING (auth.uid() = user_id);

-- ── USER NOTES ─────────────────────────────────────────────────────────────
-- Syncs notepad notes to the cloud for cross-device access
CREATE TABLE IF NOT EXISTS public.user_notes (
    id TEXT NOT NULL,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    subject TEXT,
    course_code TEXT,
    course_level TEXT,
    content TEXT NOT NULL DEFAULT '',
    media_paths JSONB DEFAULT '[]',
    linked_materials JSONB DEFAULT '[]',
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_notes_user_id ON public.user_notes(user_id);

ALTER TABLE public.user_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_notes_select ON public.user_notes
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY user_notes_insert ON public.user_notes
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY user_notes_update ON public.user_notes
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY user_notes_delete ON public.user_notes
    FOR DELETE USING (auth.uid() = user_id);

-- ── GRANTS ─────────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, DELETE ON public.user_downloads TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_notes TO authenticated;

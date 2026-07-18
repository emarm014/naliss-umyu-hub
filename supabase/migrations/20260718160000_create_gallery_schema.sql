-- Create Gallery Topics Table
CREATE TABLE IF NOT EXISTS public.gallery_topics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    description TEXT,
    cover_image TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create Gallery Media Table
CREATE TABLE IF NOT EXISTS public.gallery_media (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    topic_id UUID NOT NULL REFERENCES public.gallery_topics(id) ON DELETE CASCADE,
    media_url TEXT NOT NULL,
    media_type TEXT NOT NULL CHECK (media_type IN ('image', 'video')),
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.gallery_topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gallery_media ENABLE ROW LEVEL SECURITY;

-- Grant usage to roles
GRANT SELECT ON public.gallery_topics TO authenticated;
GRANT SELECT ON public.gallery_media TO authenticated;
GRANT ALL ON public.gallery_topics TO service_role;
GRANT ALL ON public.gallery_media TO service_role;

-- RLS Policies for gallery_topics
CREATE POLICY "Enable read access for all authenticated users" ON public.gallery_topics
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "Enable all access for admin and executives" ON public.gallery_topics
    FOR ALL TO authenticated USING (
        EXISTS (
            SELECT 1 FROM public.users 
            WHERE users.id = auth.uid() 
            AND users.role IN ('admin', 'super_admin', 'executive', 'moderator')
        )
    ) WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.users 
            WHERE users.id = auth.uid() 
            AND users.role IN ('admin', 'super_admin', 'executive', 'moderator')
        )
    );

-- RLS Policies for gallery_media
CREATE POLICY "Enable read access for all authenticated users" ON public.gallery_media
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "Enable all access for admin and executives" ON public.gallery_media
    FOR ALL TO authenticated USING (
        EXISTS (
            SELECT 1 FROM public.users 
            WHERE users.id = auth.uid() 
            AND users.role IN ('admin', 'super_admin', 'executive', 'moderator')
        )
    ) WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.users 
            WHERE users.id = auth.uid() 
            AND users.role IN ('admin', 'super_admin', 'executive', 'moderator')
        )
    );

-- Create Storage Bucket for Gallery
INSERT INTO storage.buckets (id, name, public) 
VALUES ('gallery', 'gallery', true)
ON CONFLICT (id) DO NOTHING;

-- Storage Policies for Gallery Bucket
CREATE POLICY "Public Access"
ON storage.objects FOR SELECT
TO public
USING ( bucket_id = 'gallery' );

CREATE POLICY "Admin and Executives can insert/update/delete gallery"
ON storage.objects FOR ALL
TO authenticated
USING (
    bucket_id = 'gallery' AND
    EXISTS (
        SELECT 1 FROM public.users 
        WHERE users.id = auth.uid() 
        AND users.role IN ('admin', 'super_admin', 'executive', 'moderator')
    )
) WITH CHECK (
    bucket_id = 'gallery' AND
    EXISTS (
        SELECT 1 FROM public.users 
        WHERE users.id = auth.uid() 
        AND users.role IN ('admin', 'super_admin', 'executive', 'moderator')
    )
);

-- Create function for updated_at if not exists
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger for updated_at on gallery_topics
CREATE TRIGGER handle_gallery_topics_updated_at
    BEFORE UPDATE ON public.gallery_topics
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();

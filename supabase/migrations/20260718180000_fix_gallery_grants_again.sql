-- Fix missing table grants for gallery tables
GRANT ALL ON public.gallery_topics TO authenticated;
GRANT ALL ON public.gallery_media TO authenticated;

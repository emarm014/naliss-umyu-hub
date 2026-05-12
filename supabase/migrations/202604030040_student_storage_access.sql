-- NALISS Storage Access Protocol
-- Ensures students can upload/download media according to features

-- 1. AVATARS - Everyone can view, users can upload/update their own
UPDATE storage.buckets SET public = true WHERE id = 'avatars';

DROP POLICY IF EXISTS "Avatar Public View" ON storage.objects;
CREATE POLICY "Avatar Public View" ON storage.objects
  FOR SELECT TO public USING (bucket_id = 'avatars');

DROP POLICY IF EXISTS "User Upload Avatar" ON storage.objects;
CREATE POLICY "User Upload Avatar" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "User Update Avatar" ON storage.objects;
CREATE POLICY "User Update Avatar" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

-- 2. MESSAGE ATTACHMENTS - Group members can upload and view
UPDATE storage.buckets SET public = false WHERE id = 'message-attachments';

DROP POLICY IF EXISTS "Group Member View Attachments" ON storage.objects;
CREATE POLICY "Group Member View Attachments" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'message-attachments');

DROP POLICY IF EXISTS "Group Member Upload Attachments" ON storage.objects;
CREATE POLICY "Group Member Upload Attachments" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'message-attachments');

-- 3. MATERIALS - Everyone can view/download
UPDATE storage.buckets SET public = true WHERE id = 'materials';

DROP POLICY IF EXISTS "Materials Download" ON storage.objects;
CREATE POLICY "Materials Download" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'materials');

-- 4. PHOTOS & OTHER MEDIA
UPDATE storage.buckets SET public = true WHERE id = 'photos';
UPDATE storage.buckets SET public = true WHERE id = 'announcement-media';
UPDATE storage.buckets SET public = true WHERE id = 'event-covers';

DROP POLICY IF EXISTS "Public Media View" ON storage.objects;
CREATE POLICY "Public Media View" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id IN ('photos', 'announcement-media', 'event-covers'));

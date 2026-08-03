-- Migration: 20260803164000_drop_public_access_storage_policy.sql
-- Description: Drop broad SELECT policy on storage.objects for public gallery bucket to prevent full bucket file listing via API. Public URLs remain accessible automatically via public bucket configuration.

DROP POLICY IF EXISTS "Public Access" ON storage.objects;

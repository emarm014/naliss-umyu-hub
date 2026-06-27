-- Migration: 20260626184000_secure_remaining_activity_logs.sql
-- Description: Drop the obsolete and insecure Student Read Only activity_logs policy

DROP POLICY IF EXISTS "Student Read Only activity_logs" ON public.activity_logs;

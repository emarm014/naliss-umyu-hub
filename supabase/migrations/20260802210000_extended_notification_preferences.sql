-- Migration: Extended Notification Preferences & Quiet Hours
-- 
-- Description: Adds fine-grained preference columns to public.users table for global toggles,
-- granular category controls (quizzes, assignments, security, system), conversation muting, and quiet hours.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS notif_enabled BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS notif_quizzes BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS notif_assignments BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS notif_security BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS notif_system BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS quiet_hours_enabled BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS quiet_hours_start TEXT DEFAULT '22:00',
  ADD COLUMN IF NOT EXISTS quiet_hours_end TEXT DEFAULT '07:00',
  ADD COLUMN IF NOT EXISTS muted_groups JSONB DEFAULT '[]'::jsonb;

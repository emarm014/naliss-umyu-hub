-- Migration: 20260712150000_cleanup_otp_email_swap.sql
-- Description: Cleans up the previous OTP-based email swap implementation as we have moved to a simpler and more robust password-verification flow.

-- 1. Drop the OTP-related functions
DROP FUNCTION IF EXISTS public.initiate_email_swap_v2(text);
DROP FUNCTION IF EXISTS public.verify_email_swap_otp_v2(text);
DROP FUNCTION IF EXISTS public.trigger_send_email_swap_otp() CASCADE;

-- 2. Drop the email change challenges table (this will cascade and drop its triggers/policies)
DROP TABLE IF EXISTS public.email_change_challenges CASCADE;

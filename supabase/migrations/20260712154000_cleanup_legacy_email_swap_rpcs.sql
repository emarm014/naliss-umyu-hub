-- Migration: 20260712154000_cleanup_legacy_email_swap_rpcs.sql
-- Description: Removes the previous implementations of the email swap logic that were superseded by execute_email_swap_v2.

-- 1. Drop the legacy OTP flow functions
DROP FUNCTION IF EXISTS public.initiate_email_swap_auth();
DROP FUNCTION IF EXISTS public.verify_email_swap_otp(text);
DROP FUNCTION IF EXISTS public.execute_email_swap(uuid, text);

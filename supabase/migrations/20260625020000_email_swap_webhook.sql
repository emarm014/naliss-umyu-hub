-- ==========================================
-- Database Webhook for Email Swap OTP
-- ==========================================

-- Ensure pg_net is enabled (required for webhooks)
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Create the trigger function that calls the edge function
CREATE OR REPLACE FUNCTION public.trigger_send_email_swap_otp()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_url TEXT;
BEGIN
    -- Construct the Edge Function URL
    -- Note: In production, this should point to the actual deployed Edge Function URL.
    -- We use a generic localhost fallback for local dev if not configured.
    v_url := COALESCE(
        current_setting('app.settings.edge_function_url', true),
        'http://supabase_kong:8000'
    ) || '/functions/v1/send-email-swap-otp';

    -- Call the edge function using pg_net (asynchronous)
    PERFORM net.http_post(
        url := v_url,
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
        ),
        body := jsonb_build_object(
            'type', 'INSERT',
            'table', TG_TABLE_NAME,
            'schema', TG_TABLE_SCHEMA,
            'record', row_to_json(NEW)
        )
    );
    
    RETURN NEW;
EXCEPTION
    WHEN OTHERS THEN
        -- Log error but don't fail the transaction
        RAISE WARNING 'Failed to trigger send-email-swap-otp webhook: %', SQLERRM;
        RETURN NEW;
END;
$$;

-- Create the trigger on the email_change_challenges table
DROP TRIGGER IF EXISTS on_email_challenge_created ON public.email_change_challenges;
CREATE TRIGGER on_email_challenge_created
AFTER INSERT ON public.email_change_challenges
FOR EACH ROW
EXECUTE FUNCTION public.trigger_send_email_swap_otp();

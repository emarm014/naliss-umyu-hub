-- Migration: 20260627003000_fix_admin_email_swap_webhook_url.sql
-- Description: Fixes the admin email swap webhook URL resolution to work dynamically in both local dev and production.

CREATE OR REPLACE FUNCTION public.trigger_send_email_swap_otp()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, net
AS $$
DECLARE
    v_url TEXT;
    v_server_ip TEXT;
BEGIN
    -- Resolve server inet address text representation safely
    BEGIN
        v_server_ip := inet_server_addr()::text;
    EXCEPTION
        WHEN OTHERS THEN
            v_server_ip := NULL;
    END;

    -- Construct the Edge Function URL dynamically
    v_url := COALESCE(
        NULLIF(current_setting('app.settings.edge_function_url', true), ''),
        CASE 
            WHEN v_server_ip LIKE '172.%' 
                 OR v_server_ip LIKE '192.168.%' 
                 OR v_server_ip LIKE '10.%' 
                 OR v_server_ip = '127.0.0.1' 
                 OR v_server_ip = '::1' 
                 OR v_server_ip IS NULL THEN
                'http://supabase_kong:8000'
            ELSE
                'https://omrtbnywneezpaozbvzd.supabase.co'
        END
    ) || '/functions/v1/send-email-swap-otp';

    -- Call the edge function using pg_net (asynchronous)
    PERFORM net.http_post(
        url := v_url,
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || COALESCE(NULLIF(current_setting('app.settings.service_role_key', true), ''), '')
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

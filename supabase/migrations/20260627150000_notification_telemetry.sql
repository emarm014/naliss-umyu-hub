-- Migration: 20260627150000_notification_telemetry.sql
-- Description: Create notification telemetry tracking table

CREATE TABLE IF NOT EXISTS public.notification_telemetry (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    notification_id TEXT NOT NULL,
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('sent', 'delivered', 'opened', 'dismissed', 'failed')),
    platform TEXT CHECK (platform IN ('android', 'ios', 'web', 'unknown')),
    device_info TEXT,
    retry_count INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_user_notification UNIQUE(user_id, notification_id)
);

-- Index for performance querying telemetry
CREATE INDEX IF NOT EXISTS idx_notification_telemetry_user_status ON public.notification_telemetry(user_id, status);

-- Enable RLS
ALTER TABLE public.notification_telemetry ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can insert their own telemetry"
    ON public.notification_telemetry FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own telemetry"
    ON public.notification_telemetry FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can read their own telemetry"
    ON public.notification_telemetry FOR SELECT
    USING (auth.uid() = user_id);

-- Secure RPC to log/update telemetry from the client
CREATE OR REPLACE FUNCTION public.log_notification_telemetry(
    p_notification_id TEXT,
    p_type TEXT,
    p_status TEXT,
    p_platform TEXT,
    p_device_info TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.notification_telemetry (notification_id, user_id, type, status, platform, device_info)
    VALUES (p_notification_id, auth.uid(), p_type, p_status, p_platform, p_device_info)
    ON CONFLICT (user_id, notification_id) DO UPDATE
    SET status = EXCLUDED.status,
        platform = COALESCE(EXCLUDED.platform, notification_telemetry.platform),
        device_info = COALESCE(EXCLUDED.device_info, notification_telemetry.device_info),
        updated_at = NOW();
END;
$$;

GRANT EXECUTE ON FUNCTION public.log_notification_telemetry(TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;

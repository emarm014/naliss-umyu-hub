CREATE OR REPLACE FUNCTION update_device_heartbeat(p_device_id TEXT)
RETURNS BOOLEAN AS $$
DECLARE
    v_user_id UUID;
    v_exists BOOLEAN;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RETURN FALSE;
    END IF;

    -- Check if session still exists and hasn't been revoked
    SELECT EXISTS (
        SELECT 1 FROM device_sessions 
        WHERE user_id = v_user_id AND device_id = p_device_id
    ) INTO v_exists;

    IF NOT v_exists THEN
        -- If row was deleted, it means the session was revoked or logged out.
        -- We must NOT recreate it here, otherwise deleted devices will constantly resurrect themselves via heartbeat!
        RETURN FALSE;
    END IF;

    UPDATE device_sessions 
    SET last_active_at = NOW()
    WHERE user_id = v_user_id AND device_id = p_device_id;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

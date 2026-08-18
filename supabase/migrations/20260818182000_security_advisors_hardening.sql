-- ── 1. Remediate Security Advisor Warnings for SECURITY DEFINER Functions ──

DO $$
DECLARE
    func record;
    sig text;
BEGIN
    -- Loop through all SECURITY DEFINER functions in the public schema
    FOR func IN 
        SELECT 
            n.nspname AS schema_name, 
            p.proname AS function_name, 
            pg_catalog.pg_get_function_identity_arguments(p.oid) AS args
        FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n ON p.pronamespace = n.oid
        WHERE p.prosecdef = true 
          AND n.nspname = 'public'
    LOOP
        -- Reconstruct the full function signature, e.g., "public"."update_last_seen"()
        sig := format('%I.%I(%s)', func.schema_name, func.function_name, func.args);
        
        -- 1. Fix: function_search_path_mutable
        -- This prevents search_path injection attacks by forcing an empty search path.
        -- Functions must use fully qualified names (e.g., public.users) internally,
        -- or they will use the default Postgres behavior. Supabase recommends setting it explicitly.
        EXECUTE format('ALTER FUNCTION %s SET search_path = ''''', sig);
        
        -- 2. Fix: anon_security_definer_function_executable / authenticated_...
        -- Revoke the implicit "PUBLIC" execution grant which PostgreSQL applies by default.
        EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', sig);
        
        -- 3. Explicitly grant back to the roles that the Supabase API uses
        -- This ensures that the mobile app/frontend does not break, while removing
        -- the dangerous PUBLIC implicit grant.
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon', sig);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', sig);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', sig);
    END LOOP;
END
$$;

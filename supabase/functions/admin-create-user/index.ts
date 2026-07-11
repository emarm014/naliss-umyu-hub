import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, baggage, sentry-trace',
}

serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // 1. Create a Supabase client configured to use the user's JWT
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    )

    // 2. Validate the requester is logged in using the explicit JWT token
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      throw new Error('Missing Authorization header')
    }
    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token)

    if (authError || !user) {
      throw new Error(`Unauthorized - Please log in. Details: ${authError?.message || 'No user found'}`)
    }

    // 3. Optional: Verify they are a super_admin from public.users
    const { data: adminProfile } = await supabaseClient
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single()

    if (adminProfile?.role !== 'super_admin') {
      throw new Error('Forbidden - Super Admin privileges required')
    }

    // 4. Extract the payload
    const body = await req.json()
    const { email, password, full_name, username, role, level, registration_number } = body

    if (!email || !password || !full_name) {
      throw new Error('Missing required fields: email, password, and full_name')
    }

    // 5. Create the admin client to bypass RLS and Auth settings
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    // Check if registration is disabled globally
    const { data: regSetting } = await supabaseAdmin
      .from('system_settings')
      .select('value')
      .eq('key', 'allow_registration')
      .single()

    const isRegistrationDisabled = regSetting?.value === 'false'

    // Temporarily enable it to allow the Admin bypass
    if (isRegistrationDisabled) {
      await supabaseAdmin.from('system_settings').update({ value: 'true' }).eq('key', 'allow_registration')
    }

    let authData, createError;

    try {
      // 6. Create the Auth user bypassing email confirmation loops
      const authRes = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name, username, role, level, admin_created: true }
      })
      authData = authRes.data;
      createError = authRes.error;
    } finally {
      // ALWAYS restore the setting, even if creation fails!
      if (isRegistrationDisabled) {
        await supabaseAdmin.from('system_settings').update({ value: 'false' }).eq('key', 'allow_registration')
      }
    }

    if (createError) throw createError
    const newUserId = authData.user.id

    // 7. Insert the public profile
    const { error: dbError } = await supabaseAdmin.from('users').insert({
      id: newUserId,
      email,
      full_name,
      username: username || null,
      registration_number: registration_number || null,
      role: role || 'moderator',
      level: level || null,
      status: 'active',
      is_verified: true, // Auto verify this admin-created account
    })

    if (dbError) {
      // Rollback auth user creation if DB insert fails
      await supabaseAdmin.auth.admin.deleteUser(newUserId)
      throw dbError
    }

    // 8. If they are a moderator, seed their permissions automatically
    if (role === 'moderator') {
      await supabaseAdmin.from('moderator_permissions').upsert({
        user_id: newUserId,
        can_manage_announcements: false,
        can_manage_materials: false,
        can_manage_lecturers: false,
        can_manage_executives: false,
        can_manage_students: false,
        assigned_level: level || null,
      })
    }

    return new Response(JSON.stringify({ success: true, user: authData.user }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })
  } catch (error: any) {
    console.error('Edge Function Error:', error.message)
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})

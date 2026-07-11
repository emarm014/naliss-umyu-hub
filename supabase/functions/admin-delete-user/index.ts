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

    // 3. Verify they are a super_admin from public.users
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
    const { target_user_id } = body

    if (!target_user_id) {
      throw new Error('Missing required field: target_user_id')
    }

    // Prevent deleting oneself
    if (target_user_id === user.id) {
      throw new Error('Cannot delete your own account')
    }

    // 5. Create the admin client to bypass RLS and Auth settings
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    // 6. Delete the public profile first (this will clean up any foreign key relationships if cascade is enabled)
    // Wait, it's safer to delete the Auth User, and let cascading delete the public user, or delete public user then Auth user.
    // The public.users table does NOT automatically cascade when auth.users is deleted unless defined. 
    // We already have code on the frontend that deletes the group_members. 
    // We will let the frontend delete public rows first, then call this function to just delete the Auth user.
    
    // So this function strictly deletes the Auth user.
    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(target_user_id)

    if (deleteError) {
      throw deleteError
    }

    return new Response(JSON.stringify({ success: true }), {
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

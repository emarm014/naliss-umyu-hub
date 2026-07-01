import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

const corsHeaders = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? 'https://omrtbnywneezpaozbvzd.supabase.co'
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const payload = await req.json()
    const record = payload.record

    if (!record || !record.user_id || !record.otp_code) {
      return new Response(JSON.stringify({ error: 'Missing required payload fields' }), { status: 400, headers: corsHeaders })
    }

    const BREVO_API_KEY = Deno.env.get('BREVO_API_KEY')
    if (!BREVO_API_KEY) {
      return new Response(JSON.stringify({ error: 'BREVO_API_KEY not set' }), { status: 500, headers: corsHeaders })
    }

    if (!SUPABASE_SERVICE_ROLE_KEY) {
      return new Response(JSON.stringify({ error: 'SUPABASE_SERVICE_ROLE_KEY not set' }), { status: 500, headers: corsHeaders })
    }

    // Initialize Supabase client
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    })

    // Fetch the user's current (old) email address
    const { data: { user }, error: userError } = await supabase.auth.admin.getUserById(record.user_id)
    if (userError || !user || !user.email) {
      return new Response(JSON.stringify({ error: 'Failed to retrieve user email' }), { status: 500, headers: corsHeaders })
    }

    const oldEmail = user.email

    // Inject values into the provided HTML template
    const htmlContent = `
      <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto; padding: 20px; color: #333;">
        <!-- HIDDEN PREVIEW TEXT FOR INBOX NOTIFICATIONS -->
        <div style="display: none; max-height: 0px; overflow: hidden;">
          ${record.otp_code} is your verification code to update your administrator email address.
        </div>
        
        <h2 style="color: #0f172a;">Confirm Email Address Update</h2>
        
        <p>Hello,</p>
        <p>You requested to change your administrator email address from <strong>${oldEmail}</strong>.</p>
        
        <p>Please enter the following 6-digit verification code into the security portal to confirm this change:</p>
        
        <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px; text-align: center; margin: 30px 0;">
          <h1 style="margin: 0; font-size: 32px; letter-spacing: 6px; color: #2563eb;">${record.otp_code}</h1>
        </div>
        
        <p style="color: #64748b; font-size: 14px;">If you did not request this change, please ignore this email and your address will remain unchanged. Your password and account remain secure.</p>
      </div>
    `

    // Dispatch the email via Brevo
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': BREVO_API_KEY,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        sender: { name: 'NALISS UMYU HUB', email: 'nalissumyuk@gmail.com' },
        to: [{ email: oldEmail }],
        subject: 'Confirm Your Email Change â€” NALISS UMYU Hub',
        htmlContent,
      }),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      console.error('Brevo error:', JSON.stringify(err))
      return new Response(JSON.stringify({ error: 'Failed to dispatch email', brevo_error: err }), { status: 500, headers: corsHeaders })
    }

    return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders })
  } catch (e) {
    console.error('Hook error:', String(e))
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: corsHeaders })
  }
})

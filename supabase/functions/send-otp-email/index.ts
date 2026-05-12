import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
}

const SUPABASE_PROJECT_URL = Deno.env.get('SUPABASE_URL') ?? 'https://omrtbnywneezpaozbvzd.supabase.co'

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const payload = await req.json()
    const { user, email_data } = payload

    const BREVO_API_KEY = Deno.env.get('BREVO_API_KEY')
    if (!BREVO_API_KEY) {
      return new Response(JSON.stringify({ error: { message: 'BREVO_API_KEY not set', http_code: 500 } }), { status: 500, headers: corsHeaders })
    }

    const email = user?.email
    const actionType = email_data?.email_action_type
    const tokenHash = email_data?.token_hash
    const token = email_data?.token
    const redirectTo = email_data?.redirect_to

    if (!email) {
      return new Response(JSON.stringify({ error: { message: 'Missing email', http_code: 400 } }), { status: 400, headers: corsHeaders })
    }

    let subject: string
    let htmlContent: string

    if (actionType === 'recovery') {
      // ── PASSWORD RESET — send a deep link that opens the app directly ──────
      // Build the Supabase verify URL with the token hash and redirect_to
      // When the user taps this link:
      //   1. Supabase verifies the token and sets a recovery session
      //   2. Redirects to naliss://auth/update-password
      //   3. The app's deep link handler in _layout.tsx extracts the session tokens
      //   4. update-password.tsx detects the session and shows the password form
      if (!tokenHash) {
        return new Response(JSON.stringify({ error: { message: 'Missing token_hash for recovery', http_code: 400 } }), { status: 400, headers: corsHeaders })
      }

      // Use the redirectTo from the request (set by the app as naliss://auth/update-password)
      // Fall back to the app deep link if not provided
      const appRedirectUrl = redirectTo || 'naliss://auth/update-password'

      // Build the Supabase verify URL — this is an HTTPS link that:
      // 1. Verifies the token server-side
      // 2. Redirects to the app deep link (naliss://auth/update-password)
      const verifyUrl = `${SUPABASE_PROJECT_URL}/auth/v1/verify?token=${encodeURIComponent(tokenHash)}&type=recovery&redirect_to=${encodeURIComponent(appRedirectUrl)}`

      subject = 'Reset Your NALISS UMYU Hub Password'
      htmlContent = `
        <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#f8fafc;border-radius:16px">
          <div style="text-align:center;margin-bottom:24px">
            <h1 style="color:#064e3b;font-size:22px;margin:0">NALISS UMYU HUB</h1>
            <p style="color:#64748b;font-size:13px;margin:4px 0 0">Library &amp; Information Science &middot; UMYU Katsina</p>
          </div>
          <div style="background:#fff;border-radius:12px;padding:28px;text-align:center">
            <div style="width:64px;height:64px;background:#f0fdf4;border-radius:16px;margin:0 auto 20px;display:flex;align-items:center;justify-content:center;border:1px solid #bbf7d0">
              <span style="font-size:32px">🔐</span>
            </div>
            <h2 style="color:#0f172a;font-size:20px;margin:0 0 12px">Reset Your Password</h2>
            <p style="color:#475569;font-size:14px;margin:0 0 24px;line-height:1.6">
              You requested a password reset for your NALISS UMYU Hub account.
              Tap the button below to open the app and create a new password.
            </p>
            <a href="${verifyUrl}"
               style="display:inline-block;background:#064e3b;color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:12px;font-size:15px;font-weight:700;letter-spacing:0.3px">
              Reset Password
            </a>
            <p style="color:#94a3b8;font-size:12px;margin:20px 0 0">
              This link expires in 1 hour. If you did not request a password reset, you can safely ignore this email.
            </p>
          </div>
          <p style="color:#94a3b8;font-size:11px;text-align:center;margin-top:20px">NALISS UMYU HUB &copy; 2026</p>
        </div>
      `
    } else {
      // ── ALL OTHER EMAILS (signup OTP, magic link, etc.) — send 6-digit code ──
      if (!token) {
        return new Response(JSON.stringify({ error: { message: 'Missing token', http_code: 400 } }), { status: 400, headers: corsHeaders })
      }

      const subjectMap: Record<string, string> = {
        signup: 'Your NALISS UMYU Hub Verification Code',
        magiclink: 'Your NALISS UMYU Hub Sign-In Code',
        email_change: 'Confirm Your Email Change — NALISS UMYU Hub',
        reauthentication: 'Your NALISS UMYU Hub Re-Authentication Code',
      }
      subject = subjectMap[actionType] || 'Your NALISS UMYU Hub Verification Code'

      htmlContent = `
        <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#f8fafc;border-radius:16px">
          <div style="text-align:center;margin-bottom:24px">
            <h1 style="color:#064e3b;font-size:22px;margin:0">NALISS UMYU HUB</h1>
            <p style="color:#64748b;font-size:13px;margin:4px 0 0">Library &amp; Information Science &middot; UMYU Katsina</p>
          </div>
          <div style="background:#fff;border-radius:12px;padding:28px;text-align:center">
            <p style="color:#0f172a;font-size:15px;margin:0 0 20px">Your verification code is:</p>
            <div style="background:#f0fdf4;border:2px solid #059669;border-radius:12px;padding:20px;display:inline-block">
              <span style="font-size:36px;font-weight:900;color:#064e3b;letter-spacing:8px">${token}</span>
            </div>
            <p style="color:#64748b;font-size:13px;margin:20px 0 0">This code expires in 1 hour. Do not share it with anyone.</p>
          </div>
          <p style="color:#94a3b8;font-size:11px;text-align:center;margin-top:20px">NALISS UMYU HUB &copy; 2026</p>
        </div>
      `
    }

    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': BREVO_API_KEY,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        sender: { name: 'NALISS UMYU HUB', email: 'nalissumyuk@gmail.com' },
        to: [{ email }],
        subject,
        htmlContent,
      }),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      console.error('Brevo error:', JSON.stringify(err))
      return new Response(JSON.stringify({ error: { message: JSON.stringify(err), http_code: 500 } }), { status: 500, headers: corsHeaders })
    }

    return new Response(JSON.stringify({}), { status: 200, headers: corsHeaders })
  } catch (e) {
    console.error('Hook error:', String(e))
    return new Response(JSON.stringify({ error: { message: String(e), http_code: 500 } }), { status: 500, headers: corsHeaders })
  }
})

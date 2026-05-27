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
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f1f5f9; padding: 40px 20px; margin: 0;">
          <div style="max-width: 500px; margin: 0 auto; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.05), 0 10px 15px rgba(0,0,0,0.1);">
            
            <!-- Header -->
            <div style="background-color: #064e3b; padding: 32px 24px; text-align: center;">
              <h1 style="color: #ffffff; font-size: 24px; font-weight: 700; margin: 0; letter-spacing: 0.5px;">NALISS UMYU HUB</h1>
              <p style="color: #d1fae5; font-size: 14px; margin: 6px 0 0 0; opacity: 0.9;">Library &amp; Information Science</p>
            </div>

            <!-- Body -->
            <div style="padding: 40px 32px; text-align: center;">
              <div style="width: 72px; height: 72px; background-color: #f0fdf4; border-radius: 50%; margin: 0 auto 24px; display: flex; align-items: center; justify-content: center; border: 2px solid #bbf7d0;">
                <span style="font-size: 32px; display: block; margin: 0 auto; line-height: 72px;">🔐</span>
              </div>
              
              <h2 style="color: #0f172a; font-size: 22px; font-weight: 700; margin: 0 0 16px;">Reset Your Password</h2>
              
              <p style="color: #475569; font-size: 16px; line-height: 1.6; margin: 0 0 32px; text-align: left;">
                Hello,<br><br>
                We received a request to reset the password for your NALISS UMYU Hub account. 
                Tap the secure button below to open the app and choose a new password.
              </p>

              <a href="${verifyUrl}" 
                 style="display: inline-block; background-color: #064e3b; color: #ffffff; text-decoration: none; padding: 16px 36px; border-radius: 12px; font-size: 16px; font-weight: 600; box-shadow: 0 4px 6px rgba(6, 78, 59, 0.2); transition: all 0.2s ease;">
                Reset Password
              </a>

              <div style="margin-top: 32px; padding-top: 24px; border-top: 1px solid #e2e8f0; text-align: left;">
                <p style="color: #64748b; font-size: 13px; line-height: 1.5; margin: 0;">
                  <strong style="color: #334155;">Security Notice:</strong> This link will securely expire in <strong style="color: #ef4444;">1 hour</strong>. 
                  If you didn't request a password reset, you can safely ignore this email. Your account remains secure.
                </p>
              </div>
            </div>
          </div>

          <!-- Footer -->
          <div style="max-width: 500px; margin: 24px auto 0; text-align: center;">
            <p style="color: #94a3b8; font-size: 12px; margin: 0 0 8px;">
              &copy; 2026 NALISS UMYU Hub. All rights reserved.
            </p>
            <p style="color: #94a3b8; font-size: 12px; margin: 0;">
              Umaru Musa Yar'adua University, Katsina
            </p>
          </div>
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
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f1f5f9; padding: 40px 20px; margin: 0;">
          <div style="max-width: 500px; margin: 0 auto; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.05), 0 10px 15px rgba(0,0,0,0.1);">
            
            <!-- Header -->
            <div style="background-color: #064e3b; padding: 32px 24px; text-align: center;">
              <h1 style="color: #ffffff; font-size: 24px; font-weight: 700; margin: 0; letter-spacing: 0.5px;">NALISS UMYU HUB</h1>
              <p style="color: #d1fae5; font-size: 14px; margin: 6px 0 0 0; opacity: 0.9;">Library &amp; Information Science</p>
            </div>

            <!-- Body -->
            <div style="padding: 40px 32px; text-align: center;">
              <div style="width: 72px; height: 72px; background-color: #f0fdf4; border-radius: 50%; margin: 0 auto 24px; display: flex; align-items: center; justify-content: center; border: 2px solid #bbf7d0;">
                <span style="font-size: 32px; display: block; margin: 0 auto; line-height: 72px;">🛡️</span>
              </div>
              
              <h2 style="color: #0f172a; font-size: 22px; font-weight: 700; margin: 0 0 16px;">Authentication Code</h2>
              
              <p style="color: #475569; font-size: 16px; line-height: 1.6; margin: 0 0 24px; text-align: left;">
                Hello,<br><br>
                Please use the secure verification code below to continue.
              </p>

              <div style="background-color: #f0fdf4; border: 2px dashed #10b981; border-radius: 12px; padding: 24px; display: inline-block; margin-bottom: 32px;">
                <span style="font-size: 40px; font-weight: 900; color: #064e3b; letter-spacing: 12px; font-family: monospace;">${token}</span>
              </div>

              <div style="padding-top: 24px; border-top: 1px solid #e2e8f0; text-align: left;">
                <p style="color: #64748b; font-size: 13px; line-height: 1.5; margin: 0;">
                  <strong style="color: #334155;">Security Notice:</strong> This code will securely expire in <strong style="color: #ef4444;">1 hour</strong>. 
                  Do not share this code with anyone. NALISS admins will never ask for your code.
                </p>
              </div>
            </div>
          </div>

          <!-- Footer -->
          <div style="max-width: 500px; margin: 24px auto 0; text-align: center;">
            <p style="color: #94a3b8; font-size: 12px; margin: 0 0 8px;">
              &copy; 2026 NALISS UMYU Hub. All rights reserved.
            </p>
            <p style="color: #94a3b8; font-size: 12px; margin: 0;">
              Umaru Musa Yar'adua University, Katsina
            </p>
          </div>
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

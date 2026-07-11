import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

const CLOUD_NAME = Deno.env.get('CLOUDINARY_CLOUD_NAME') ?? '';
const API_KEY    = Deno.env.get('CLOUDINARY_API_KEY') ?? '';
const API_SECRET = Deno.env.get('CLOUDINARY_API_SECRET') ?? '';

const getCORSHeaders = (req: Request) => {
  const origin = req.headers.get('Origin') || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, baggage, sentry-trace',
    'Access-Control-Allow-Credentials': 'true',
  };
};

Deno.serve(async (req: Request) => {
  const corsHeaders = getCORSHeaders(req);
  // CORS preflight request
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Enforce authentication
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
  }

  if (!CLOUD_NAME || !API_KEY || !API_SECRET) {
    return new Response(JSON.stringify({ error: 'Cloudinary credentials not configured on server' }), { status: 500, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    
    // We expect: { upload_preset, folder }
    // Generate timestamp to keep client/server in perfect sync
    const timestamp = Math.floor(Date.now() / 1000).toString();
    
    // Prepare parameter dictionary for signing
    const paramsToSign: Record<string, string> = {};
    
    // Add optional/required parameters
    if (body.folder) {
      paramsToSign.folder = body.folder;
    }
    if (body.upload_preset) {
      paramsToSign.upload_preset = body.upload_preset;
    }
    
    // Always include timestamp
    paramsToSign.timestamp = timestamp;

    // Alphabetical sort
    const sortedKeys = Object.keys(paramsToSign).sort();
    
    // Construct query string: key1=value1&key2=value2...
    const stringToSign = sortedKeys
      .map(key => `${key}=${paramsToSign[key]}`)
      .join('&');
      
    console.log("String to sign:", stringToSign);
    
    const signatureString = stringToSign + API_SECRET;

    // Generate SHA-1 Hash using Web Crypto API
    const msgBuffer = new TextEncoder().encode(signatureString);
    const hashBuffer = await crypto.subtle.digest('SHA-1', msgBuffer);
    const signature = Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    return new Response(
      JSON.stringify({
        signature,
        timestamp,
        api_key: API_KEY,
        cloud_name: CLOUD_NAME,
        ...paramsToSign
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message || 'Signature generation failed' }), 
      { status: 500, headers: corsHeaders }
    );
  }
});

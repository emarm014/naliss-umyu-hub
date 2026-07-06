import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

const CLOUD_NAME = Deno.env.get('CLOUDINARY_CLOUD_NAME') ?? '';
const API_KEY    = Deno.env.get('CLOUDINARY_API_KEY') ?? '';
const API_SECRET = Deno.env.get('CLOUDINARY_API_SECRET') ?? '';

const getCORSHeaders = (req: Request) => {
  const origin = req.headers.get('Origin') || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Credentials': 'true',
  };
};

// Signed destroy — the only reliable way to delete from Cloudinary
async function destroyAsset(publicId: string, resourceType: string): Promise<{ ok: boolean; result: string }> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const toSign = `public_id=${publicId}&timestamp=${timestamp}${API_SECRET}`;
  const msgBuffer = new TextEncoder().encode(toSign);
  const hashBuffer = await crypto.subtle.digest('SHA-1', msgBuffer);
  const signature = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');

  const form = new FormData();
  form.append('public_id', publicId);
  form.append('timestamp', timestamp);
  form.append('api_key', API_KEY);
  form.append('signature', signature);

  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/${resourceType}/destroy`,
    { method: 'POST', body: form }
  );
  const data = await res.json();
  const ok = data.result === 'ok' || data.result === 'not found';
  return { ok, result: data.result ?? 'unknown' };
}

Deno.serve(async (req: Request) => {
  const corsHeaders = getCORSHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });

  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).single();
  if (!profile || !['super_admin', 'moderator'].includes(profile.role)) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: corsHeaders });
  }

  if (!CLOUD_NAME || !API_KEY || !API_SECRET) {
    return new Response(JSON.stringify({ error: 'Cloudinary credentials not configured' }), { status: 500, headers: corsHeaders });
  }

  // â”€â”€ DELETE a single asset (or bulk via body) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (req.method === 'DELETE') {
    try {
      const body = await req.json();
      // Single: { public_id, resource_type }
      // Bulk:   { assets: [{ public_id, resource_type }, ...] }
      const items: { public_id: string; resource_type: string }[] = body.assets
        ? body.assets
        : [{ public_id: body.public_id, resource_type: body.resource_type || 'image' }];

      const results = await Promise.all(
        items.map(async item => {
          if (!item.public_id) return { public_id: '', ok: false, result: 'missing public_id' };
          const { ok, result } = await destroyAsset(item.public_id, item.resource_type || 'image');
          return { public_id: item.public_id, ok, result };
        })
      );

      const allOk = results.every(r => r.ok);
      return new Response(JSON.stringify({ results, success: allOk }), {
        status: allOk ? 200 : 207,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders });
    }
  }

  // â”€â”€ GET all assets â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (req.method === 'GET') {
    try {
      const basicAuth = btoa(`${API_KEY}:${API_SECRET}`);
      const cloudHeaders = { 'Authorization': `Basic ${basicAuth}` };

      const fetchAll = async (resource_type: string) => {
        const results: any[] = [];
        let next_cursor: string | undefined;
        do {
          const url = new URL(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/resources/${resource_type}`);
          url.searchParams.set('max_results', '500');
          if (next_cursor) url.searchParams.set('next_cursor', next_cursor);
          const res = await fetch(url.toString(), { headers: cloudHeaders });
          if (!res.ok) break;
          const data = await res.json();
          results.push(...(data.resources || []));
          next_cursor = data.next_cursor;
        } while (next_cursor);
        return results;
      };

      const [images, raw, videos] = await Promise.all([
        fetchAll('image'),
        fetchAll('raw'),
        fetchAll('video'),
      ]);

      const assets = [
        ...images.map((r: any) => ({ ...r, resource_type: 'image' })),
        ...raw.map((r: any) => ({ ...r, resource_type: 'raw' })),
        ...videos.map((r: any) => ({ ...r, resource_type: 'video' })),
      ].map((r: any) => ({
        public_id:     r.public_id,
        secure_url:    r.secure_url,
        bytes:         r.bytes || 0,
        format:        r.format || '',
        resource_type: r.resource_type,
        created_at:    r.created_at,
        folder:        r.folder || r.public_id?.split('/')[0] || 'root',
        width:         r.width || null,
        height:        r.height || null,
        duration:      r.duration || null,
      }));

      assets.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      return new Response(JSON.stringify({ assets, total: assets.length }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: `Failed to fetch assets: ${err}` }), {
        status: 500, headers: corsHeaders,
      });
    }
  }

  return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
});

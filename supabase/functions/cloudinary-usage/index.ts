import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

const CLOUD_NAME  = Deno.env.get('CLOUDINARY_CLOUD_NAME') ?? '';
const API_KEY     = Deno.env.get('CLOUDINARY_API_KEY') ?? '';
const API_SECRET  = Deno.env.get('CLOUDINARY_API_SECRET') ?? '';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST',
  'Access-Control-Allow-Headers': 'authorization, content-type',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: CORS });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: CORS });

  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).single();
  if (!profile || !['super_admin', 'moderator'].includes(profile.role)) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: CORS });
  }

  const adminSupabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  if (!CLOUD_NAME || !API_KEY || !API_SECRET) {
    return new Response(JSON.stringify({ error: 'Cloudinary credentials not configured on server' }), { status: 500, headers: CORS });
  }

  // 1. Try reading from database cache first
  try {
    const { data: cached } = await adminSupabase
      .from('cloudinary_usage_snapshot')
      .select('*')
      .order('last_updated', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (cached) {
      const ageMs = Date.now() - new Date(cached.last_updated).getTime();
      // Cache for 1 hour to prevent Cloudinary rate limiting
      if (ageMs < 60 * 60 * 1000) {
        return new Response(JSON.stringify(cached.data), {
          headers: { ...CORS, 'Content-Type': 'application/json' },
        });
      }
    }
  } catch (err) {
    console.error('Failed to read Cloudinary usage cache:', err);
  }

  try {
    const basicAuth = btoa(`${API_KEY}:${API_SECRET}`);
    const headers = { 'Authorization': `Basic ${basicAuth}`, 'Content-Type': 'application/json' };

    // Fetch usage stats, resource counts, and report data in parallel
    const [usageRes, imageResourcesRes, reportRes] = await Promise.all([
      fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/usage`, { headers }),
      fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/resources?resource_type=image&max_results=500`, { headers }),
      // Usage report for last 30 days â€” gives impressions, bandwidth breakdown, errors
      fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/usage?date=${getDateDaysAgo(30)}`, { headers }),
    ]);

    if (!usageRes.ok) {
      const errText = await usageRes.text();
      return new Response(JSON.stringify({ error: `Cloudinary API error: ${usageRes.status} - ${errText}` }), { status: 502, headers: CORS });
    }

    const [usage, imageResources, usageReport] = await Promise.all([
      usageRes.json(),
      imageResourcesRes.json(),
      reportRes.ok ? reportRes.json() : Promise.resolve(null),
    ]);

    // Also fetch raw (documents) and video resources
    const [rawRes, videoRes] = await Promise.all([
      fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/resources?resource_type=raw&max_results=500`, { headers }),
      fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/resources?resource_type=video&max_results=500`, { headers }),
    ]);

    const [rawResources, videoResources] = await Promise.all([
      rawRes.json(),
      videoRes.json(),
    ]);

    // Compute per-folder breakdown from resources
    const folderMap: Record<string, { count: number; bytes: number; type: string }> = {};

    const processResources = (resources: any[], type: string) => {
      (resources || []).forEach((r: any) => {
        const folder = r.public_id?.split('/')[0] || 'root';
        if (!folderMap[folder]) folderMap[folder] = { count: 0, bytes: 0, type };
        folderMap[folder].count++;
        folderMap[folder].bytes += r.bytes || 0;
      });
    };

    processResources(imageResources.resources || [], 'image');
    processResources(rawResources.resources || [], 'raw');
    processResources(videoResources.resources || [], 'video');

    const totalImages = (imageResources.resources || []).length;
    const totalRaw = (rawResources.resources || []).length;
    const totalVideos = (videoResources.resources || []).length;
    const totalFiles = totalImages + totalRaw + totalVideos;

    const totalBytesFromResources = [
      ...(imageResources.resources || []),
      ...(rawResources.resources || []),
      ...(videoResources.resources || []),
    ].reduce((sum: number, r: any) => sum + (r.bytes || 0), 0);

    // Extract error summary from usage data
    const errorSummary = {
      bad_request:    usage.requests_usage?.error_400 ?? 0,
      unauthorized:   usage.requests_usage?.error_401 ?? 0,
      not_found:      usage.requests_usage?.error_404 ?? 0,
      timeout:        usage.requests_usage?.error_408 ?? 0,
      rate_limited:   usage.requests_usage?.error_420 ?? 0,
      fallback_image: usage.requests_usage?.error_200_fallback ?? 0,
    };

    const response = {
      plan: usage.plan || 'Free',
      last_updated: usage.last_updated || new Date().toISOString(),

      // â”€â”€ Core quota meters â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      storage: {
        used_bytes: usage.storage?.usage ?? totalBytesFromResources,
        limit_bytes: usage.storage?.limit ?? (25 * 1024 * 1024 * 1024),
        used_human: formatBytes(usage.storage?.usage ?? totalBytesFromResources),
        limit_human: formatBytes(usage.storage?.limit ?? (25 * 1024 * 1024 * 1024)),
        percent: Math.min(100, ((usage.storage?.usage ?? totalBytesFromResources) / (usage.storage?.limit ?? (25 * 1024 * 1024 * 1024))) * 100),
      },
      bandwidth: {
        used_bytes: usage.bandwidth?.usage ?? 0,
        limit_bytes: usage.bandwidth?.limit ?? (25 * 1024 * 1024 * 1024),
        used_human: formatBytes(usage.bandwidth?.usage ?? 0),
        limit_human: formatBytes(usage.bandwidth?.limit ?? (25 * 1024 * 1024 * 1024)),
        percent: Math.min(100, ((usage.bandwidth?.usage ?? 0) / (usage.bandwidth?.limit ?? (25 * 1024 * 1024 * 1024))) * 100),
      },
      transformations: {
        used: usage.transformations?.usage ?? 0,
        limit: usage.transformations?.limit ?? 25000,
        percent: Math.min(100, ((usage.transformations?.usage ?? 0) / (usage.transformations?.limit ?? 25000)) * 100),
      },
      credits: {
        used: usage.credits?.usage ?? 0,
        limit: usage.credits?.limit ?? 25,
        percent: Math.min(100, ((usage.credits?.usage ?? 0) / (usage.credits?.limit ?? 25)) * 100),
      },
      objects: {
        used: usage.objects?.usage ?? totalFiles,
        limit: usage.objects?.limit ?? 25000,
        percent: Math.min(100, ((usage.objects?.usage ?? totalFiles) / (usage.objects?.limit ?? 25000)) * 100),
      },

      // â”€â”€ Engagement metrics (what Cloudinary dashboard shows) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      impressions: {
        images: usage.derived_images?.usage ?? usage.requests ?? 0,
        // Cloudinary calls these "image impressions" â€” requests that served an image
        total: usage.requests ?? 0,
      },
      media_count: {
        images: totalImages,
        videos: totalVideos,
        raw: totalRaw,
        total: totalFiles,
      },

      // â”€â”€ Error summary â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      errors: errorSummary,

      // â”€â”€ Resource breakdown â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      resources: {
        total: totalFiles,
        images: totalImages,
        videos: totalVideos,
        raw: totalRaw,
      },
      folders: Object.entries(folderMap)
        .map(([name, data]) => ({ name, ...data }))
        .sort((a, b) => b.bytes - a.bytes),
      requests: usage.requests ?? 0,
    };

    // 2. Save newly fetched usage stats to DB cache asynchronously
    try {
      await adminSupabase.from('cloudinary_usage_snapshot').insert({ data: response });
    } catch (dbErr) {
      console.error('Failed to save Cloudinary usage to cache:', dbErr);
    }

    return new Response(JSON.stringify(response), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: `Failed to fetch Cloudinary stats: ${err}` }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});

function formatBytes(bytes: number): string {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

function getDateDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0];
}

import { supabase } from './supabase';

/**
 * Delete one or more files from Cloudinary via the secure Edge Function.
 * Called after successfully deleting a record from the database.
 * Returns true if all deletions succeeded, false if any failed.
 */
export async function deleteFromCloudinary(urls: (string | null | undefined)[]): Promise<boolean> {
  const validUrls = urls.filter((u): u is string => !!u && u.includes('cloudinary.com'));
  if (validUrls.length === 0) return true;

  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return false;

    const res = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/cloudinary-delete`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ urls: validUrls }),
      }
    );

    if (!res.ok) return false;
    const data = await res.json();
    // Return true only if all deletions reported ok
    return (data.results || []).every((r: { deleted: boolean }) => r.deleted);
  } catch {
    return false;
  }
}

import { supabase } from './supabase';

interface LogActivityParams {
  action: string;
  entity_type: string;
  entity_id?: string | null;
  description: string;
  metadata?: Record<string, any>;
}

/**
 * Global Audit Logger — Records administrative and moderator actions to public.activity_logs
 * with full actor attribution (role, name, email, external vs student status) and metadata.
 */
export async function logAdminActivity(params: LogActivityParams) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Fetch actor profile for role context
    const { data: profile } = await supabase
      .from('users')
      .select('id, full_name, email, role, is_external')
      .eq('id', user.id)
      .maybeSingle();

    const actorName = profile?.full_name || user.email || 'System User';
    const actorRole = profile?.role || 'admin';
    const isExternal = profile?.is_external || false;

    await (supabase as any).from('activity_logs').insert({
      user_id: user.id,
      action: params.action,
      entity_type: params.entity_type,
      entity_id: params.entity_id || null,
      description: params.description,
      metadata: {
        ...(params.metadata || {}),
        actor: {
          id: user.id,
          full_name: actorName,
          email: profile?.email || user.email,
          role: actorRole,
          is_external: isExternal,
        },
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.warn('[ActivityLogger] Failed to record audit log:', err);
  }
}

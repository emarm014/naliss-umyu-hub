import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../api/supabase/client';
import { Session, User as SupabaseUser } from '@supabase/supabase-js';
import { User as Profile } from '../types';
import { useMessageStore } from './message.store';
import { useGroupStore } from './group.store';
import { useGlobalSyncStore } from './globalSync.store';
import { captureStoreError, trackStoreAction } from '../utils/sentry';

interface AuthState {
  session: Session | null;
  user: SupabaseUser | null;
  profile: Profile | null;
  isProfileComplete: boolean | null;
  isLoading: boolean;
  error: string | null;
  lastFetch: number | null;
  // True once zustand-persist has finished reading from AsyncStorage
  _hasHydrated: boolean;

  // Actions
  setSession: (session: Session | null) => void;
  setUser: (user: SupabaseUser | null) => void;
  fetchProfile: (force?: boolean) => Promise<void>;
  updateProfile: (updates: Partial<Record<string, any>>) => Promise<void>;
  updatePreferences: (prefs: {
    notif_announcements?: boolean;
    notif_events?: boolean;
    notif_messages?: boolean;
    notif_materials?: boolean;
  }) => Promise<void>;
  checkProfileComplete: (userId: string) => Promise<void>;
  attemptProfileRepair: () => Promise<boolean>;
  setIsProfileComplete: (complete: boolean | null) => void;
  setProfile: (profile: Profile | null) => void;
  signOut: () => Promise<void>;
  setError: (error: string | null) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      session: null,
      user: null,
      profile: null,
      isProfileComplete: null,
      isLoading: false,
      error: null,
      lastFetch: null,
      _hasHydrated: false,

      setSession: (session) => set({ session, isLoading: false }),
      setUser: (user) => set({ user }),

      fetchProfile: async (force = false) => {
        const { user, lastFetch, profile } = get();
        if (!user) return;

        if (!force && lastFetch && Date.now() - lastFetch < 30000 && profile) {
          return; // Serve from cache
        }

        try {
          const { data, error } = await supabase
            .from('users')
            .select('*')
            .eq('id', user.id)
            .single();

          if (error) throw error;
          set({ profile: (data as any) as Profile, lastFetch: Date.now() });
        } catch (err: any) {
          // On network failure, keep the cached profile — don't clear it
          const isNetworkError = err.message?.includes('fetch') ||
            err.message?.includes('network') ||
            err.message?.includes('timeout') ||
            err.name === 'AbortError';
          if (!isNetworkError) {
            // Real DB error — surface it so the UI can react
            set({ error: err.message || 'Failed to load profile' });
            captureStoreError('auth', 'fetchProfile', err, { userId: user.id });
          }
        }
      },

      // Update profile fields and sync to auth metadata so chat shows updated info
      updateProfile: async (updates) => {
        const { user, profile } = get();
        if (!user || !profile) return;

        // Optimistic local update first — instant UI feedback everywhere
        set({
          profile: { ...profile, ...(updates as any) } as Profile,
          lastFetch: Date.now(),
        });

        try {
          // 1. Update public.users table
          // Use .select() without .single() — avoids PGRST116 if RLS returns 0 rows
          const { data: rows, error: dbError } = await supabase
            .from('users')
            .update(updates as any)
            .eq('id', user.id)
            .select();

          if (dbError) {
            // Network errors — keep optimistic update, sync on next fetch
            const isNetworkError = dbError.message?.includes('fetch') ||
              dbError.message?.includes('network') ||
              (dbError as any)?.name === 'AbortError';
            if (!isNetworkError) {
              // Real DB error — revert optimistic update
              set({ profile });
              throw dbError;
            }
            // Network error — optimistic update stays
            return;
          }

          // Confirm with the actual saved row if available
          const updatedRow = rows?.[0];
          if (updatedRow) {
            set({ profile: (updatedRow as any) as Profile, lastFetch: Date.now() });
          }

          // 2. Sync to auth metadata (best-effort — don't block on failure)
          const metaUpdates: Record<string, any> = {};
          if ((updates as any).username) metaUpdates.username = (updates as any).username;
          if ((updates as any).avatar_url) metaUpdates.avatar_url = (updates as any).avatar_url;
          if ((updates as any).display_name) metaUpdates.display_name = (updates as any).display_name;
          if ((updates as any).full_name) metaUpdates.full_name = (updates as any).full_name;

          if (Object.keys(metaUpdates).length > 0) {
            supabase.auth.updateUser({ data: metaUpdates }).catch(() => {}); // fire and forget
          }

          // 3. Patch cached chat messages so username/avatar updates appear instantly
          const senderPatch: { username?: string; avatar_url?: string; full_name?: string } = {};
          if ((updates as any).username) senderPatch.username = (updates as any).username;
          if ((updates as any).avatar_url) senderPatch.avatar_url = (updates as any).avatar_url;
          if ((updates as any).full_name) senderPatch.full_name = (updates as any).full_name;
          if (Object.keys(senderPatch).length > 0) {
            useMessageStore.getState().patchSenderInfo(user.id, senderPatch);
          }
        } catch (err: any) {
          const isNetworkError = err?.message?.includes('fetch') ||
            err?.message?.includes('network') ||
            err?.name === 'AbortError';

          if (isNetworkError) {
            // Network failure — keep optimistic update, sync on next fetch
            return;
          }
          // Real error — revert optimistic update
          captureStoreError('auth', 'updateProfile', err, { userId: user.id, updates: Object.keys(updates) });
          set({ profile });
          throw err;
        }
      },

      updatePreferences: async (prefs) => {
        const { user, profile } = get();
        if (!user || !profile) return;

        // Optimistic local update first — instant UI feedback, no spinner
        set({ profile: { ...profile, ...prefs } as Profile });

        try {
          const { data: rows, error } = await supabase
            .from('users')
            .update(prefs as any)
            .eq('id', user.id)
            .select();

          if (error) {
            const isNetworkError = error.message?.includes('fetch') ||
              error.message?.includes('network') ||
              (error as any)?.name === 'AbortError';

            if (isNetworkError) {
              // Network failure — keep optimistic update, sync on next fetch
              return;
            }
            // Real DB error — revert optimistic update and throw so UI can react
            set({ profile });
            throw error;
          }

          // Confirm with actual saved row
          const updatedRow = rows?.[0];
          if (updatedRow) {
            set({ profile: (updatedRow as any) as Profile });
          }
        } catch (err: any) {
          const isNetworkError = err?.message?.includes('fetch') ||
            err?.message?.includes('network') ||
            err?.name === 'AbortError';

          if (isNetworkError) {
            return; // Keep optimistic update
          }
          set({ profile }); // Revert
          throw err;
        }
      },

      checkProfileComplete: async (userId: string) => {
        try {
          const { data, error } = await supabase
            .from('users')
            .select('registration_number, level')
            .eq('id', userId)
            .maybeSingle();

          if (error) throw error;
          
          // Profile is complete only when BOTH registration_number AND level are set
          // (matches the same check in ProtectedRoute's onAuthStateChange)
          const complete = !!(data?.registration_number && data?.level);
          set({ isProfileComplete: complete });

          // ── SELF-HEALING: If no profile row but user is logged in, attempt repair ──
          if (!complete) {
            const success = await get().attemptProfileRepair();
            if (success) set({ isProfileComplete: true });
          }
        } catch (err: any) {
          set({ error: err.message, isProfileComplete: false });
        }
      },

      attemptProfileRepair: async () => {
        const { user } = get();
        if (!user || !user.email) return false;

        const metadata = user.user_metadata;
        const regNum = metadata?.registration_number;
        const level = metadata?.level;

        // If metadata has these basics, we can attempt to re-run the profile creation
        if (regNum && level) {
          try {
            const { error: rpcError } = await (supabase.rpc as any)('create_user_profile', {
              p_id: user.id,
              p_full_name: metadata.full_name || 'Student',
              p_email: user.email,
              p_registration_number: regNum,
              p_level: level.toString(),
              p_avatar_url: metadata.avatar_url || `https://api.dicebear.com/9.x/fun-emoji/svg?seed=${user.id}`,
              p_username: metadata.username || (metadata.full_name || 'user').toLowerCase().replace(/\s+/g, '_') + '_' + user.id.slice(0, 6),
            });
            return !rpcError;
          } catch {
            return false;
          }
        }
        return false;
      },

      setIsProfileComplete: (complete) => set({ isProfileComplete: complete }),
      setProfile: (profile) => set({ profile: profile as any }),

      signOut: async () => {
        const { user } = get();
        // Capture userId BEFORE signOut fires the SIGNED_OUT event.
        // ProtectedRoute's onAuthStateChange reads user.id from Zustand state
        // to check ban/suspend — it must be available when the event fires.
        const userId = user?.id;
        if (userId) {
          // Clear push token from DB on sign out (best-effort — don't block signout)
          supabase
            .from('users')
            .update({ push_token: null } as any)
            .eq('id', userId)
            .then(() => {})
            .catch(() => {});
        }
        // Clear local state BEFORE calling signOut so onAuthStateChange
        // sees a clean slate and doesn't re-enter the ban-check with stale data.
        set({ session: null, user: null, profile: null, isProfileComplete: null, error: null });
        // CRITICAL: Clear all cached data to prevent data leak between users
        useMessageStore.getState().clearCache();
        useGroupStore.getState().clearGroups();
        useGlobalSyncStore.getState().terminate();
        await supabase.auth.signOut();
      },

      setError: (error) => set({ error }),
    }),
    {
      name: 'naliss-auth-storage',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ 
        session: state.session,
        user: state.user,
        profile: state.profile,
        lastFetch: state.lastFetch,
        // isProfileComplete intentionally NOT persisted — stale false value causes
        // signup screen flash on cold launch. Always re-derived from onAuthStateChange.
      }),
      // When store rehydrates from AsyncStorage (app open), immediately set
      // isLoading=false so ProtectedRoute doesn't show blank spinner offline.
      // onAuthStateChange will update isProfileComplete once Supabase responds.
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.isLoading = false;
          state._hasHydrated = true;
          // If we have a cached session + complete profile, resolve isProfileComplete
          // immediately — no network call needed, no spinner, instant app access
          if (
            state.session &&
            state.profile?.registration_number &&
            state.profile?.level
          ) {
            // Trust the cache — isProfileComplete is definitively true
            state.isProfileComplete = true;
          } else if (!state.session) {
            // No session cached — user is logged out, no spinner needed
            state.isProfileComplete = null;
          }
          // If session exists but profile is incomplete, leave isProfileComplete
          // as-is so onAuthStateChange can handle the signup resume flow
        }
      },
    }
  )
);


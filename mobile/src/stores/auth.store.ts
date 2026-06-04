import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../api/supabase/client';
import { Session, User as SupabaseUser } from '@supabase/supabase-js';
import { User as Profile } from '../types';
import { captureStoreError, trackStoreAction, isNetworkError } from '../utils/sentry';
import { Logger } from '../utils/logger';
import { withRetry } from '../utils/api-protection';
interface AuthState {
  session: Session | null;
  user: SupabaseUser | null;
  profile: Profile | null;
  isProfileComplete: boolean | null;
  isLoading: boolean;
  error: string | null;
  lastFetch: number | null;
  lastLocalProfileUpdateAt: number | null;
  pendingProfileUpdates: Partial<Record<string, any>>;
  // The most recently confirmed avatar URL — set on upload, never overwritten by any fetch.
  // This is the single source of truth for the avatar displayed in the UI.
  confirmedAvatarUrl: string | null;
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
      lastLocalProfileUpdateAt: null,
      pendingProfileUpdates: {},
      confirmedAvatarUrl: null,
      _hasHydrated: false,

      setSession: (session) => set({ session, isLoading: false }),
      setUser: (user) => set({ user }),

      fetchProfile: async (force = false) => {
        const { user, lastFetch, profile } = get();
        if (!user) return;

        if (!force && lastFetch && Date.now() - lastFetch < 30000 && profile) {
          return; // Serve from cache
        }

        const fetchStartedAt = Date.now();

        try {
          const { data, error } = await Logger.perf('auth.store', 'fetchProfile', () => 
            withRetry(async () => {
              const result = await supabase
                .from('users')
                .select('*')
                .eq('id', user.id)
                .single();
              if (result.error) throw result.error;
              return result;
            }, { componentName: 'auth.store', operationName: 'fetchProfile' })
          );

          const currentState = get();
          
          // If a local optimistic update happened AFTER this fetch started,
          // the fetched data is stale. Ignore it completely.
          if (currentState.lastLocalProfileUpdateAt && currentState.lastLocalProfileUpdateAt > fetchStartedAt) {
            return;
          }

          // Apply any pending offline edits OVER the fetched server data.
          const merged: any = { ...(data as any), ...currentState.pendingProfileUpdates };

          // IRON RULE: confirmedAvatarUrl always wins over anything from the DB.
          // Once a user sets their avatar, no fetch — stale or fresh — can revert it.
          // confirmedAvatarUrl is only cleared on sign-out.
          if (currentState.confirmedAvatarUrl) {
            merged.avatar_url = currentState.confirmedAvatarUrl;
          }
          
          set({ profile: merged as Profile, lastFetch: Date.now() });
        } catch (err: any) {
          // On network failure, keep the cached profile — don't clear it
          if (!isNetworkError(err)) {
            // Real DB error — surface it so the UI can react
            set({ error: err.message || 'Failed to load profile' });
            captureStoreError('auth', 'fetchProfile', err, { userId: user.id });
          }
        }
      },

      // Update profile fields and sync to auth metadata so chat shows updated info
      updateProfile: async (updates) => {
        const { user, profile, pendingProfileUpdates } = get();
        if (!user || !profile) return;

        // Optimistic local update first — record it in pending so fetches don't overwrite
        const newPending = { ...pendingProfileUpdates, ...(updates as any) };
        set({
          pendingProfileUpdates: newPending,
          profile: { ...profile, ...(updates as any) } as Profile,
          lastFetch: Date.now(),
          lastLocalProfileUpdateAt: Date.now(),
          // Lock in the new avatar immediately — no fetch can overwrite this
          ...((updates as any).avatar_url ? { confirmedAvatarUrl: (updates as any).avatar_url } : {}),
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
            // Network errors — keep optimistic update in pending, sync on next fetch
            if (!isNetworkError(dbError)) {
              // Real DB error — revert optimistic update
              const revertedPending = { ...get().pendingProfileUpdates };
              Object.keys(updates).forEach(k => delete revertedPending[k]);
              set({ profile, pendingProfileUpdates: revertedPending });
              throw dbError;
            }
            // Network error — optimistic update stays in pending
            return;
          }

          // DB Success! Remove these fields from pending since server has them now
          const resolvedPending = { ...get().pendingProfileUpdates };
          Object.keys(updates).forEach(k => delete resolvedPending[k]);

          // Confirm with the actual saved row if available
          const updatedRow = rows?.[0];
          if (updatedRow) {
            // Always keep avatar_url from the optimistic update if it was just set —
            // the DB row returned here is the confirmed value, but we trust our
            // optimistic value since we just wrote it. This prevents a race where
            // a concurrent fetchProfile overwrites the new avatar with the old one.
            const avatarGuard = (updates as any).avatar_url
              ? { avatar_url: (updates as any).avatar_url }
              : {};
            set({ 
              profile: { ...(updatedRow as any), ...resolvedPending, ...avatarGuard } as Profile, 
              pendingProfileUpdates: resolvedPending,
              lastFetch: Date.now(),
              lastLocalProfileUpdateAt: Date.now(),
            });
          } else {
            set({ pendingProfileUpdates: resolvedPending });
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
            const { useMessageStore } = require('./message.store');
            useMessageStore.getState().patchSenderInfo(user.id, senderPatch);
          }
        } catch (err: any) {
          if (isNetworkError(err)) {
            // Network failure — keep optimistic update
            return;
          }
          // Real error — revert optimistic update
          captureStoreError('auth', 'updateProfile', err, { userId: user.id, updates: Object.keys(updates) });
          const revertedPending = { ...get().pendingProfileUpdates };
          Object.keys(updates).forEach(k => delete revertedPending[k]);
          set({ profile, pendingProfileUpdates: revertedPending });
          throw err;
        }
      },

      updatePreferences: async (prefs) => {
        const { user, profile, pendingProfileUpdates } = get();
        if (!user || !profile) return;

        // Optimistic local update first
        const newPending = { ...pendingProfileUpdates, ...prefs };
        set({ 
          pendingProfileUpdates: newPending,
          profile: { ...profile, ...prefs } as Profile,
          lastLocalProfileUpdateAt: Date.now(),
        });

        try {
          const { data: rows, error } = await supabase
            .from('users')
            .update(prefs as any)
            .eq('id', user.id)
            .select();

          if (error) {
            if (isNetworkError(error)) {
              // Network failure — keep optimistic update
              return;
            }
            // Real DB error — revert optimistic update
            const revertedPending = { ...get().pendingProfileUpdates };
            Object.keys(prefs).forEach(k => delete revertedPending[k]);
            set({ profile, pendingProfileUpdates: revertedPending });
            throw error;
          }

          // DB Success! Remove from pending
          const resolvedPending = { ...get().pendingProfileUpdates };
          Object.keys(prefs).forEach(k => delete resolvedPending[k]);

          // Confirm with actual saved row
          const updatedRow = rows?.[0];
          if (updatedRow) {
            set({ 
              profile: { ...(updatedRow as any), ...resolvedPending } as Profile,
              pendingProfileUpdates: resolvedPending
            });
          } else {
            set({ pendingProfileUpdates: resolvedPending });
          }
        } catch (err: any) {
          if (isNetworkError(err)) {
            return; // Keep optimistic update
          }
          const revertedPending = { ...get().pendingProfileUpdates };
          Object.keys(prefs).forEach(k => delete revertedPending[k]);
          set({ profile, pendingProfileUpdates: revertedPending }); // Revert
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
            .then(
              () => {},
              () => {}
            );
        }
        // Clear local state BEFORE calling signOut so onAuthStateChange
        // sees a clean slate and doesn't re-enter the ban-check with stale data.
        set({ session: null, user: null, profile: null, isProfileComplete: null, error: null, confirmedAvatarUrl: null });
        // CRITICAL: Clear all cached data to prevent data leak between users
        // Wrap each in its own try/catch so one failure doesn't skip the rest
        try { require('./message.store').useMessageStore.getState().clearCache(); } catch {}
        try { require('./group.store').useGroupStore.getState().clearGroups(); } catch {}
        try { require('./globalSync.store').useGlobalSyncStore.getState().terminate(); } catch {}
        try { require('./announcement.store').useAnnouncementStore.getState().clearCache(); } catch {}
        try { require('./event.store').useEventStore.getState().clearCache(); } catch {}
        try { require('./resource.store').useResourceStore.getState().clearCache(); } catch {}
        try { require('./directory.store').useDirectoryStore.getState().clearCache(); } catch {}
        try { require('./signup.store').useSignupStore.getState().reset(); } catch {}
        
        try {
          await supabase.auth.signOut();
        } catch {
          // Ignore network errors on signout to prevent UI hanging
        }
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
        pendingProfileUpdates: state.pendingProfileUpdates,
        confirmedAvatarUrl: state.confirmedAvatarUrl,
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
          // Seed confirmedAvatarUrl from profile if not already set —
          // handles users who had an avatar before this field was introduced
          if (!state.confirmedAvatarUrl && state.profile?.avatar_url) {
            state.confirmedAvatarUrl = state.profile.avatar_url;
          }
          // If session exists but profile is incomplete, leave isProfileComplete
          // as-is so onAuthStateChange can handle the signup resume flow
        }
      },
    }
  )
);


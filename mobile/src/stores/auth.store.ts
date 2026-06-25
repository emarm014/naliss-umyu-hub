import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { mmkvStorage } from './mmkv.storage';
import { supabase } from '../api/supabase/client';
import { Session, User as SupabaseUser } from '@supabase/supabase-js';
import { User as Profile } from '../types';
import { captureStoreError, trackStoreAction, isNetworkError } from '../utils/sentry';
import { Logger } from '../utils/logger';
import { withRetry } from '../utils/api-protection';
import * as FileSystem from 'expo-file-system/legacy';
import NetInfo from '@react-native-community/netinfo';
import { saveLocalUserSession, getLocalUserSession, clearLocalUserSession } from '../lib/database';

const cacheAvatarLocally = async (userId: string, remoteUrl: string): Promise<string | null> => {
  if (!userId || !remoteUrl || !remoteUrl.startsWith('http')) return null;
  try {
    const fs = FileSystem as any;
    const docDir = fs.Paths?.document?.uri || fs.documentDirectory || fs.cacheDirectory || '';
    if (!docDir) return null;
    const base = docDir.endsWith('/') ? docDir : `${docDir}/`;
    const localPath = `${base}avatar_${userId}.jpg`;
    
    const downloadRes = await FileSystem.downloadAsync(remoteUrl, localPath);
    if (downloadRes.status === 200) {
      return downloadRes.uri;
    }
  } catch (err) {
    // silent failure
  }
  return null;
};

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
  // Local file system URI for the cached avatar image to support offline rendering.
  localAvatarUrl: string | null;
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
  hydrateFromSQLite: () => Promise<void>;
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
      localAvatarUrl: null,
      _hasHydrated: false,

      setSession: (session) => set({ session, isLoading: false }),
      setUser: (user) => set({ user }),

      hydrateFromSQLite: async () => {
        const localProfile = await getLocalUserSession();
        if (localProfile) {
          set({ profile: localProfile as Profile });
        }
      },

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
              const result = await (supabase as any).from('users')
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
          
          // Anchor the fresh fetch payload into SQLite
          await saveLocalUserSession(merged);

          if (merged.avatar_url) {
            cacheAvatarLocally(user.id, merged.avatar_url).then(localUri => {
              if (localUri) {
                set({ localAvatarUrl: localUri });
              }
            }).catch(() => {});
          }
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
        const { user, profile } = get();
        if (!user || !profile) return;

        try {
          const { data: rows, error: dbError } = await (supabase as any).from('users')
            .update(updates as any)
            .eq('id', user.id)
            .select();

          if (dbError) {
            if (isNetworkError(dbError)) {
              throw new Error('Network Connection Required: You must be connected to the internet to modify your profile.');
            }
            throw dbError;
          }

          const updatedRow = rows?.[0];
          if (updatedRow) {
            const merged = { ...profile, ...updatedRow };
            set({
              profile: merged,
              pendingProfileUpdates: {},
              lastLocalProfileUpdateAt: null
            });
            
            // Anchor updated profile to SQLite
            await saveLocalUserSession(merged);

            if ((updates as any).avatar_url) {
                set({ confirmedAvatarUrl: (updates as any).avatar_url });
                cacheAvatarLocally(user.id, (updates as any).avatar_url).then(localUri => {
                  if (localUri) set({ localAvatarUrl: localUri });
                }).catch(() => {});
            }
          }

          const metaUpdates: Record<string, any> = {};
          if ((updates as any).username) metaUpdates.username = (updates as any).username;
          if ((updates as any).avatar_url) metaUpdates.avatar_url = (updates as any).avatar_url;
          if ((updates as any).display_name) metaUpdates.display_name = (updates as any).display_name;
          if ((updates as any).full_name) metaUpdates.full_name = (updates as any).full_name;

          if (Object.keys(metaUpdates).length > 0) {
            supabase.auth.updateUser({ data: metaUpdates }).catch(() => {}); 
          }

          const senderPatch: { username?: string; avatar_url?: string; full_name?: string } = {};
          if ((updates as any).username) senderPatch.username = (updates as any).username;
          if ((updates as any).avatar_url) senderPatch.avatar_url = (updates as any).avatar_url;
          if ((updates as any).full_name) senderPatch.full_name = (updates as any).full_name;
          if (Object.keys(senderPatch).length > 0) {
            const { useMessageStore } = require('./message.store');
            useMessageStore.getState().patchSenderInfo(user.id, senderPatch);
          }
        } catch (err: any) {
          captureStoreError('auth', 'updateProfile', err, { userId: user.id, updates: Object.keys(updates) });
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
          const { data: rows, error } = await (supabase as any).from('users')
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
          const { data, error } = await (supabase as any).from('users')
            .select('registration_number, level, role')
            .eq('id', userId)
            .maybeSingle();

          if (error) throw error;
          
          // Profile is complete only when BOTH registration_number AND level are set
          // (matches the same check in ProtectedRoute's onAuthStateChange)
          // Super admins and system owners bypass student checks.
          const complete = data?.role === 'super_admin' || 
                           data?.role === 'system_owner' || 
                           !!(data?.registration_number && data?.level);
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
            const { error: rpcError } = await ((supabase as any).rpc as any)('create_user_profile', {
              p_id: user.id,
              p_full_name: metadata.full_name || 'Student',
              p_email: user.email,
              p_registration_number: regNum,
              p_level: level.toString(),
              p_avatar_url: metadata.avatar_url || `https://api.dicebear.com/9.x/fun-emoji/png?seed=${user.id}&size=200`,
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
        // ONLINE CONNECTIVITY GUARD GATEWAY
        const networkState = await NetInfo.fetch();
        if (!networkState.isConnected || networkState.isInternetReachable === false) {
          throw new Error('NETWORK_OFFLINE_SIGNOUT');
        }

        const { user } = get();
        // Capture userId BEFORE signOut fires the SIGNED_OUT event.
        // ProtectedRoute's onAuthStateChange reads user.id from Zustand state
        // to check ban/suspend — it must be available when the event fires.
        const userId = user?.id;
        if (userId) {
          // Clear push token from DB on sign out (best-effort — don't block signout)
          (supabase as any).from('users')
            .update({ push_token: null } as any)
            .eq('id', userId)
            .then(
              () => {},
              () => {}
            );
        }
        // sees a clean slate and doesn't re-enter the ban-check with stale data.
        set({ session: null, user: null, profile: null, isProfileComplete: null, error: null, confirmedAvatarUrl: null, localAvatarUrl: null });
        
        // Remove SQLite profile anchor to erase zombie data
        await clearLocalUserSession();

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
        try { require('./notification.store').useNotificationStore.getState().clearNotifications(); } catch {}
        
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
      storage: createJSONStorage(() => mmkvStorage),
      partialize: (state) => ({ 
        session: state.session,
        user: state.user,
        profile: state.profile,
        lastFetch: state.lastFetch,
        pendingProfileUpdates: state.pendingProfileUpdates,
        confirmedAvatarUrl: state.confirmedAvatarUrl,
        localAvatarUrl: state.localAvatarUrl,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.isLoading = false;
          state._hasHydrated = true;
          // If we have a cached session + complete profile, resolve isProfileComplete
          // immediately — no network call needed, no spinner, instant app access
          if (
            state.session &&
            ((state.profile?.role as string) === 'super_admin' ||
             (state.profile?.role as string) === 'system_owner' ||
             (state.profile?.registration_number && state.profile?.level))
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
          
          // Verify that the local avatar file actually exists on disk.
          // If it is missing (e.g. cleared by OS), re-cache it.
          if (state.localAvatarUrl) {
            FileSystem.getInfoAsync(state.localAvatarUrl).then(info => {
              if (!info.exists && state.profile?.avatar_url && state.user?.id) {
                cacheAvatarLocally(state.user.id, state.profile.avatar_url).then(localUri => {
                  if (localUri) useAuthStore.setState({ localAvatarUrl: localUri });
                  else useAuthStore.setState({ localAvatarUrl: null });
                });
              }
            }).catch(() => {
              useAuthStore.setState({ localAvatarUrl: null });
            });
          } else if (state.profile?.avatar_url && state.user?.id) {
            cacheAvatarLocally(state.user.id, state.profile.avatar_url).then(localUri => {
              if (localUri) useAuthStore.setState({ localAvatarUrl: localUri });
            });
          }
        }
      },
    }
  )
);


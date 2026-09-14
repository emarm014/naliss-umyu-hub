import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { mmkvStorage } from './mmkv.storage';
import { supabase } from '../api/supabase/client';
import { Session, User as SupabaseUser } from '@supabase/supabase-js';
import { User as Profile } from '../types';
import { captureStoreError, trackStoreAction, isNetworkError, setSentryUserContext, clearSentryUserContext } from '../utils/sentry';
import { Logger } from '../utils/logger';
import { withRetry } from '../utils/api-protection';
import * as FileSystem from 'expo-file-system/legacy';
import NetInfo from '@react-native-community/netinfo';
import { saveLocalUserSession, getLocalUserSession, clearLocalUserSession } from '../lib/database';
import { safeFire } from '../utils/safeFire';
import { realtimeManager } from '../lib/realtimeManager';
import { getCurrentPushToken } from '../hooks/usePushNotifications';
import { getOrCreateDeviceId } from '../utils/device';
import AsyncStorage from '@react-native-async-storage/async-storage';
const cacheAvatarLocally = async (userId: string, remoteUrl: string): Promise<string | null> => {
  if (!userId || !remoteUrl) return null;
  if (!remoteUrl.startsWith('http')) {
    return remoteUrl.startsWith('file://') ? remoteUrl : null;
  }
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
  // The most recently confirmed avatar URL â€” set on upload, never overwritten by any fetch.
  // This is the single source of truth for the avatar displayed in the UI.
  confirmedAvatarUrl: string | null;
  // Local file system URI for the cached avatar image to support offline rendering.
  localAvatarUrl: string | null;
  pendingAvatarUpload: {
    localUri: string;
    mimeType: string;
    fileName: string;
  } | null;
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
  syncPendingAvatar: () => Promise<void>;
  verifyAndRepairProfile: () => Promise<void>;
  removeLocalData: () => Promise<void>;
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
      pendingAvatarUpload: null,
      _hasHydrated: false,

      setSession: (session) => set({ session, isLoading: false }),
      setUser: (user) => set({ user }),

    hydrateFromSQLite: async () => {
        const localProfile = await getLocalUserSession();
        if (localProfile) {
          set({ 
            profile: localProfile as Profile,
            localAvatarUrl: localProfile.local_avatar_path || null
          });
          setSentryUserContext(localProfile);
          // Run self-healing check on hydrate
          safeFire(get().verifyAndRepairProfile(), 'verifyProfile');
        }
        
        // Re-link existing files to SQLite after SQLite initialization
        const { reconcileAssetCache } = require('../lib/database');
        await reconcileAssetCache();
      },

      fetchProfile: async (force = false) => {
        const { user, lastFetch, profile } = get();
        if (!user) return;

        if (!force && lastFetch && Date.now() - lastFetch < 30000 && profile) {
          return; // Serve from cache
        }

        const fetchStartedAt = Date.now();
        
        const deviceId = 'unknown';

        // Fast-path: if offline, skip network fetch entirely and keep local cache
        try {
          const netState = await NetInfo.fetch();
          if (!netState.isConnected) {
            Logger.info('auth.store', 'Device is offline, serving profile from local cache.');
            return;
          }
        } catch (_) {}

        try {
          const { data, error } = await Logger.perf('auth.store', 'fetchProfile', () => 
            withRetry(async () => {
              const result = await (supabase as any).from('users')
                .select('*')
                .eq('id', user.id)
                .maybeSingle();
              if (result.error) throw result.error;
              return result;
            }, { componentName: 'auth.store', operationName: 'fetchProfile' })
          );

          if (error) {
            const isNet = error.message?.toLowerCase().includes('network') || error.status === 0;
            if (isNet) {
              Logger.warn('auth.store', 'Network error during fetchProfile. Keeping cached local profile.');
              
              return;
            }
            throw error;
          }

          if (!data || Object.keys(data).length === 0) {
            console.log('[AuthStore] Profile not yet created for user:', user.id);
            set({ profile: null, isProfileComplete: false });
            return;
          }

          set({ isProfileComplete: true });

          // Version Control Check
          const localProfile = get().profile;
          if (localProfile) {
            const localVersion = (localProfile as any).profile_version || 1;
            const serverVersion = (data as any).profile_version || 1;
            const localUpdatedAt = localProfile.updated_at ? new Date(localProfile.updated_at).getTime() : 0;
            const serverUpdatedAt = (data as any).updated_at ? new Date((data as any).updated_at).getTime() : 0;

            if (serverVersion < localVersion || (serverVersion === localVersion && serverUpdatedAt <= localUpdatedAt)) {
              Logger.info('auth.store', 'Stale server profile ignored.', { localVersion, serverVersion });
              
              return;
            }
          }

          const isBootstrap = !localProfile;
          if (isBootstrap) {
            
          }

          const currentState = get();
          if (currentState.lastLocalProfileUpdateAt && currentState.lastLocalProfileUpdateAt > fetchStartedAt) {
            return;
          }

          const merged: any = { ...(data as any), ...currentState.pendingProfileUpdates };
          if (currentState.confirmedAvatarUrl) {
            merged.avatar_url = currentState.confirmedAvatarUrl;
          }
          
          set({ profile: merged as Profile, lastFetch: Date.now() });
          setSentryUserContext(merged);
          
          // Anchor the fresh fetch payload into SQLite
          await saveLocalUserSession(merged);

          // Unify avatar download
          if (merged.avatar_url) {
            const { UnifiedDownloadEngine } = require('../utils/unifiedDownload');
            const urlHash = merged.avatar_url.split('/').pop()?.replace(/[^a-zA-Z0-9]/g, '').slice(-10) || Date.now().toString();
            
            // Delete old cached avatar to prevent disk clutter
            const oldLocalPath = get().localAvatarUrl;
            if (oldLocalPath && !oldLocalPath.includes(urlHash)) {
              try { await FileSystem.deleteAsync(oldLocalPath, { idempotent: true }); } catch (e) {}
            }

            const localUri = await UnifiedDownloadEngine.download(
              merged.avatar_url,
              `user_avatar_${user.id}_${urlHash}`,
              undefined,
              'user_avatar'
            );
            if (localUri) {
              const updatedWithAvatar = { ...merged, local_avatar_path: localUri };
              set({ localAvatarUrl: localUri, profile: updatedWithAvatar as Profile });
              await saveLocalUserSession(updatedWithAvatar);
            }
          }

          if (isBootstrap) {
            
          }
        } catch (err: any) {
          if (!isNetworkError(err)) {
            set({ error: err.message || 'Failed to load profile' });
            captureStoreError('auth', 'fetchProfile', err, { userId: user.id });
          }
        }
      },

      // Update profile fields and sync in an offline-first manner
      updateProfile: async (updates) => {
        const { user, profile } = get();
        if (!user || !profile) return;

        // 1. Instantly merge update into memory Zustand + MMKV cache
        const merged = { ...profile, ...updates };
        
        // If avatar is being updated, we MUST clear the legacy local overrides 
        // so the app correctly renders the new remote avatar.
        if (updates.avatar_url) {
          set({ 
            profile: merged as Profile,
            localAvatarUrl: null,
            confirmedAvatarUrl: updates.avatar_url 
          });
        } else {
          set({ profile: merged as Profile });
        }

        // 2. Instantly persist to permanent local SQLite database
        await saveLocalUserSession(merged);

        // 3. Queue update to Supabase via mutationQueue in background
        const dbUpdates = { ...updates };
        delete dbUpdates.localAvatarUrl;
        
        if (Object.keys(dbUpdates).length > 0) {
          const { useMutationQueueStore } = require('./mutationQueue.store');
          useMutationQueueStore.getState().enqueue({
            table: 'users',
            action: 'update',
            payload: dbUpdates,
            queryConstraints: {
              eq: { id: user.id }
            }
          });
          // Best-effort background queue execution
          safeFire(useMutationQueueStore.getState().processQueue(), 'processQueue');
        }

        // 4. Log Telemetry
        
        const deviceId = 'unknown';
        
        

        // 5. Update auth metadata & sender info
        const metaUpdates: Record<string, any> = {};
        if ((updates as any).username) metaUpdates.username = (updates as any).username;
        if ((updates as any).avatar_url) metaUpdates.avatar_url = (updates as any).avatar_url;
        if ((updates as any).display_name) metaUpdates.display_name = (updates as any).display_name;
        if ((updates as any).full_name) metaUpdates.full_name = (updates as any).full_name;

        if (Object.keys(metaUpdates).length > 0) {
          (async () => {
            try { await supabase.auth.updateUser({ data: metaUpdates }); } catch (_) {}
          })();
        }

        const senderPatch: { username?: string; avatar_url?: string; full_name?: string } = {};
        if ((updates as any).username) senderPatch.username = (updates as any).username;
        if ((updates as any).avatar_url) senderPatch.avatar_url = (updates as any).avatar_url;
        if ((updates as any).full_name) senderPatch.full_name = (updates as any).full_name;
        if (Object.keys(senderPatch).length > 0) {
          const { useMessageStore } = require('./message.store');
          useMessageStore.getState().patchSenderInfo(user.id, senderPatch);
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
              // Network failure â€” keep optimistic update
              return;
            }
            // Real DB error â€” revert optimistic update
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

          // â”€â”€ SELF-HEALING: If no profile row but user is logged in, attempt repair â”€â”€
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
      setProfile: (profile) => {
        set({ profile: profile as any });
        if (profile) setSentryUserContext(profile);
      },

      signOut: async () => {
        const { user } = get();
        const userId = user?.id;

        // 1. Cleanly tear down the Realtime master socket and AppState listeners
        try {
          realtimeManager.cleanup();
        } catch (e) {
          console.warn('[AuthStore] Realtime cleanup warning during logout:', e);
        }

        // 2. Teardown per-device push tokens and server sessions
        if (userId) {
          try {
            await AsyncStorage.removeItem(`download_restore_${userId}`);
            await AsyncStorage.removeItem(`download_restore_progress_${userId}`);
          } catch {}

          try {
            const deviceToken = typeof getCurrentPushToken === 'function' ? getCurrentPushToken() : null;
            if (deviceToken) {
              await (supabase as any).from('user_push_tokens')
                .delete()
                .eq('user_id', userId)
                .eq('push_token', deviceToken);
            }
          } catch (e) {
            console.warn('[AuthStore] Push token cleanup warning:', e);
          }

          try {
            const deviceId = await getOrCreateDeviceId();
            await (supabase as any).from('user_sessions')
              .delete()
              .eq('user_id', userId)
              .eq('device_id', deviceId);
          } catch {}
        }

        // 3. Clear auth store state
        set({
          session: null,
          user: null,
          isProfileComplete: null,
          error: null,
        });
        clearSentryUserContext();

        // 4. Invalidate Supabase session
        try {
          await supabase.auth.signOut();
        } catch {}
      },

      syncPendingAvatar: async () => {
        const { pendingAvatarUpload, user, updateProfile } = get();
        if (!pendingAvatarUpload || !user) return;

        const isOnline = require('./network.store').useNetworkStore.getState().isOnline;
        if (!isOnline) return;

        try {
          const { uploadLocalFileToCloudinary } = require('../lib/cloudinary');
          const remoteUrl = await uploadLocalFileToCloudinary(
            pendingAvatarUpload.localUri,
            pendingAvatarUpload.fileName,
            'avatars',
            pendingAvatarUpload.mimeType
          );

          // Update profile with the remote URL
          await updateProfile({ avatar_url: remoteUrl });

          // Clear the pending job on success
          set({ pendingAvatarUpload: null });
          Logger.info('auth.store', 'Background avatar upload completed successfully.', { remoteUrl });
        } catch (err) {
          Logger.warn('auth.store', 'Background avatar upload failed, will retry.', err as any);
        }
      },

      verifyAndRepairProfile: async () => {
        const { user, profile, localAvatarUrl } = get();
        if (!user) return;

        try {
          const { getDB } = require('../lib/database');
          const db = getDB();
          if (!db) return;

          // 1. Repair missing SQLite profile row
          const sqliteProfile = await getLocalUserSession();
          if (!sqliteProfile && profile) {
            Logger.warn('auth.store', 'Self-Healing: SQLite profile missing. Re-saving.');
            await saveLocalUserSession(profile);
            
            const { getOrCreateDeviceId } = require('../utils/device');
            const deviceId = await getOrCreateDeviceId();
            
          }

          // 2. Repair missing MMKV cache
          if (sqliteProfile && !profile) {
            Logger.warn('auth.store', 'Self-Healing: MMKV profile cache missing. Restoring from SQLite.');
            set({ profile: sqliteProfile });
          }

          // 3. Verify local avatar file integrity
          const resolvedProfile = sqliteProfile || profile;
          if (resolvedProfile?.avatar_url) {
            const expectedPath = localAvatarUrl || resolvedProfile.local_avatar_path;
            let needsDownload = false;

            if (expectedPath) {
              const info = await FileSystem.getInfoAsync(expectedPath);
              if (!info.exists || (info as any).size === 0) {
                needsDownload = true;
                Logger.warn('auth.store', 'Self-Healing: Local avatar file missing/empty.');
              }
            } else {
              needsDownload = true;
            }

            if (needsDownload) {
              const { UnifiedDownloadEngine } = require('../utils/unifiedDownload');
              const localPath = await UnifiedDownloadEngine.download(
                resolvedProfile.avatar_url,
                `user_avatar_${user.id}`,
                undefined,
                'user_avatar'
              );
              if (localPath) {
                const updated = { ...resolvedProfile, local_avatar_path: localPath };
                set({ localAvatarUrl: localPath, profile: updated as Profile });
                await saveLocalUserSession(updated);

                const { getOrCreateDeviceId } = require('../utils/device');
                const deviceId = await getOrCreateDeviceId();
                
              }
            }
          }
        } catch (e) {
          Logger.error('auth.store', 'Error in profile self-healing:', e);
        }
      },

      removeLocalData: async () => {
        // Clear SQLite user profile
        await clearLocalUserSession();
        
        // Clear all SQLite tables
        const { getDB, enqueueTransaction } = require('../lib/database');
        await enqueueTransaction(async () => {
            const activeDb = getDB();
            if (activeDb) {
                try {
                    await activeDb.runAsync('DELETE FROM local_messages');
                    // Removed: DELETE FROM local_assets (keep device cache intact across logouts)
                    await activeDb.runAsync('DELETE FROM local_media_manifest');
                    await activeDb.runAsync('DELETE FROM offline_download_jobs');
                    await activeDb.runAsync('DELETE FROM offline_download_telemetry');
                    await activeDb.runAsync('DELETE FROM sync_checkpoint');
                    await activeDb.runAsync('DELETE FROM sync_journal');
                    await activeDb.runAsync('DELETE FROM media_sync_jobs');
                    await activeDb.runAsync('DELETE FROM offline_sync_state');
                    Logger.info('auth.store', 'SQLite database completely wiped.');
                } catch (e) {
                    console.error('Failed to wipe SQLite database:', e);
                }
            }
        });
        
        // Clear all files inside naliss_vault
        try {
            const { getVaultBase } = require('../utils/assetResolver');
            const vaultBase = getVaultBase();
            const info = await FileSystem.getInfoAsync(vaultBase);
            if (info.exists) {
                await FileSystem.deleteAsync(vaultBase, { idempotent: true });
                Logger.info('auth.store', 'Local vault files deleted.');
            }
        } catch (e) {
            console.error('Failed to clear local vault files:', e);
        }
        
        // Clear Zustand stores in memory
        set({ profile: null, confirmedAvatarUrl: null, localAvatarUrl: null, pendingAvatarUpload: null });
        try { require('./message.store').useMessageStore.getState().clearCache(); } catch {}
        try { require('./group.store').useGroupStore.getState().clearGroups(); } catch {}
        try { require('./globalSync.store').useGlobalSyncStore.getState().terminate(); } catch {}
        try { require('./announcement.store').useAnnouncementStore.getState().clearUserData(); } catch {}
        try { require('./event.store').useEventStore.getState().clearUserData(); } catch {}
        try { require('./resource.store').useResourceStore.getState().clearUserData(); } catch {}
        try { require('./directory.store').useDirectoryStore.getState().clearUserData(); } catch {}
        try { require('./news.store').useNewsStore.getState().clearUserData(); } catch {}
        try { require('./archive.store').useArchiveStore.getState().clearUserData(); } catch {}
        try { require('./fyb.store').useFYBStore.getState().clearUserData(); } catch {}
        try { require('./gallery.store').useGalleryStore.getState().clearUserData(); } catch {}
        try { require('./event-pool.store').useEventPoolStore.getState().clearUserData(); } catch {}
        try { require('./signup.store').useSignupStore.getState().reset(); } catch {}
        try { require('./notification.store').useNotificationStore.getState().clearNotifications(); } catch {}
        try { require('./data-restore.store').useDataRestoreStore.getState().reset(); } catch {}
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
        pendingAvatarUpload: state.pendingAvatarUpload,
      }),
      onRehydrateStorage: () => (state, error) => {
        if (error) {
          console.error("Auth store rehydration failed", error);
          useAuthStore.setState({ _hasHydrated: true });
        }
        if (state) {
          state.isLoading = false;
          state._hasHydrated = true;
          
          if (
            state.session &&
            ((state.profile?.role as string) === 'super_admin' ||
             (state.profile?.role as string) === 'system_owner' ||
             (state.profile?.registration_number && state.profile?.level))
          ) {
            state.isProfileComplete = true;
          } else if (!state.session) {
            state.isProfileComplete = null;
          }
          
          if (!state.confirmedAvatarUrl && state.profile?.avatar_url) {
            state.confirmedAvatarUrl = state.profile.avatar_url;
          }
          
          if (state.profile) {
            setSentryUserContext(state.profile);
          }
        }
      },
    }
  )
);

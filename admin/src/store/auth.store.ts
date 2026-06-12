import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { supabase } from '../lib/supabase';
import type { User as SupabaseUser } from '@supabase/supabase-js';
import type { User, UserRole } from '../types';

interface AuthState {
  user: SupabaseUser | null;
  profile: User | null;
  permissions: User['permissions'] | null;
  isLoading: boolean;
  error: string | null;
  isAdminOrModerator: boolean;
  initialize: () => Promise<(() => void) | void>;
  signOut: () => Promise<void>;
  updateProfile: (updates: Partial<User>) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      profile: null,
      permissions: null,
      // If we already have a persisted profile, start as NOT loading so the
      // dashboard renders immediately from cache while the session is verified.
      isLoading: true,
      error: null,
      isAdminOrModerator: false,

      initialize: async () => {
        // If we already have a cached profile, show the app immediately
        // and verify the session silently in the background.
        const hasCachedProfile = !!get().profile;
        if (hasCachedProfile) {
          set({ isLoading: false });
        }

        try {
          const { data: { session } } = await supabase.auth.getSession();
          const user = session?.user ?? null;
          set({ user });

          if (user) {
            await fetchFullProfile(user.id, set);
          } else {
            set({ profile: null, permissions: null, isAdminOrModerator: false, isLoading: false });
          }
        } catch {
          // Network failure on init — keep cached state, just stop loading
          set({ isLoading: false });
        }

        // Listen for auth changes (token refresh, sign-out from another tab, etc.)
        // Store the subscription so it can be cleaned up if needed
        const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
          const newUser = session?.user ?? null;
          set({ user: newUser });

          if (newUser) {
            await fetchFullProfile(newUser.id, set);
          } else {
            set({ profile: null, permissions: null, isAdminOrModerator: false });
          }
        });

        // Return cleanup function (used by React StrictMode)
        return () => subscription.unsubscribe();
      },

      signOut: async () => {
        set({ isLoading: true });
        try {
          await supabase.auth.signOut();
        } catch {
          // Ignore sign-out errors — always clear local state and redirect
        } finally {
          set({ user: null, profile: null, permissions: null, isAdminOrModerator: false, error: null, isLoading: false });
          window.location.href = '/login';
        }
      },

      updateProfile: (updates) => {
        set((state) => ({
          profile: state.profile ? { ...state.profile, ...updates } : null,
        }));
      },
    }),
    {
      name: 'naliss-admin-store',
      storage: createJSONStorage(() => localStorage),
      // Only persist the profile/permissions — not loading state
      partialize: (state) => ({
        user: state.user,
        profile: state.profile,
        permissions: state.permissions,
        isAdminOrModerator: state.isAdminOrModerator,
      }),
    }
  )
);

async function fetchFullProfile(userId: string, set: (state: Partial<AuthState>) => void, retryCount = 0) {
  try {
    const { data: profile, error: profileError } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();

    if (profileError) {
      if (retryCount < 3) {
        await new Promise(resolve => setTimeout(resolve, 2000 * (retryCount + 1)));
        // Verify the session is still valid before retrying
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user || session.user.id !== userId) return;
        return fetchFullProfile(userId, set, retryCount + 1);
      }
      throw profileError;
    }

    if (profile) {
      if (profile.status === 'banned' || profile.status === 'graduated') {
        await supabase.auth.signOut();
        set({ user: null, profile: null, permissions: null, isAdminOrModerator: false, isLoading: false });
        window.location.href = '/login';
        return;
      }

      // Auto-lift expired suspensions
      if (profile.status === 'suspended') {
        const suspendedUntil = profile.suspended_until ? new Date(profile.suspended_until) : null;
        if (!suspendedUntil || suspendedUntil <= new Date()) {
          await supabase.from('users').update({ status: 'active', suspended_until: null, suspension_reason: null }).eq('id', userId);
          profile.status = 'active';
        } else {
          // Still suspended — sign out
          await supabase.auth.signOut();
          set({ user: null, profile: null, permissions: null, isAdminOrModerator: false, isLoading: false });
          window.location.href = '/login';
          return;
        }
      }

      const role = profile.role as UserRole;
      const isAdminOrModerator = (role === 'super_admin' || role === 'moderator') && profile.status === 'active';

      let permissions = null;
      if (role === 'moderator') {
        const { data: permData } = await supabase
          .from('moderator_permissions')
          .select('*')
          .eq('user_id', userId)
          .single();
        permissions = permData;
      }

      set({ profile, permissions, isAdminOrModerator, isLoading: false });
    } else {
      set({ isLoading: false });
    }
  } catch {
    // On network failure keep cached profile — just stop loading
    set({ isLoading: false });
  }
}

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Colors } from '../constants/Colors';

interface ThemeState {
  isDark: boolean;
  colors: typeof Colors.light;
  toggleTheme: () => void;
  setDark: (dark: boolean) => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      isDark: false,
      colors: Colors.light,

      toggleTheme: () =>
        set((state) => {
          const isDark = !state.isDark;
          return { isDark, colors: isDark ? Colors.dark : Colors.light };
        }),

      setDark: (dark: boolean) =>
        set({ isDark: dark, colors: dark ? Colors.dark : Colors.light }),
    }),
    {
      name: 'naliss-theme',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ isDark: state.isDark }),
      // Rehydrate colors from persisted isDark flag
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.colors = state.isDark ? Colors.dark : Colors.light;
        }
      },
    }
  )
);

/**
 * Hook to get the current theme colors.
 * Use this instead of importing COLORS directly.
 */
export function useTheme() {
  return useThemeStore((s) => ({ colors: s.colors, isDark: s.isDark }));
}

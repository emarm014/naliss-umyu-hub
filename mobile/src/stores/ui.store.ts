import { create } from 'zustand';

interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'warning' | 'info';
  duration?: number;
}

interface UIState {
  // Theme
  theme: 'light' | 'dark' | 'system';
  setTheme: (theme: 'light' | 'dark' | 'system') => void;

  // Sidebar (for admin web)
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;

  // Toasts
  toasts: Toast[];
  showToast: (toast: Omit<Toast, 'id'>) => void;
  hideToast: (id: string) => void;
  clearToasts: () => void;

  // Offline banner
  isOfflineBannerVisible: boolean;
  showOfflineBanner: () => void;
  hideOfflineBanner: () => void;

  // Loading overlay
  isGlobalLoading: boolean;
  globalLoadingMessage: string | null;
  showGlobalLoading: (message?: string) => void;
  hideGlobalLoading: () => void;

  // Modals
  activeModals: string[];
  openModal: (modalId: string) => void;
  closeModal: (modalId: string) => void;
  isModalOpen: (modalId: string) => boolean;
}

export const useUIStore = create<UIState>((set, get) => ({
  // Theme
  theme: 'system',
  setTheme: (theme) => set({ theme }),

  // Sidebar
  sidebarCollapsed: false,
  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),

  // Toasts
  toasts: [],
  showToast: (toast) => {
    const id = Date.now().toString();
    const newToast = { ...toast, id };
    set((state) => ({ toasts: [...state.toasts, newToast] }));

    // Auto-hide after duration
    const duration = toast.duration ?? 5000;
    setTimeout(() => {
      get().hideToast(id);
    }, duration);
  },
  hideToast: (id) => {
    set((state) => ({
      toasts: state.toasts.filter((toast) => toast.id !== id),
    }));
  },
  clearToasts: () => set({ toasts: [] }),

  // Offline banner
  isOfflineBannerVisible: false,
  showOfflineBanner: () => set({ isOfflineBannerVisible: true }),
  hideOfflineBanner: () => set({ isOfflineBannerVisible: false }),

  // Global loading
  isGlobalLoading: false,
  globalLoadingMessage: null,
  showGlobalLoading: (message) =>
    set({ isGlobalLoading: true, globalLoadingMessage: message ?? null }),
  hideGlobalLoading: () =>
    set({ isGlobalLoading: false, globalLoadingMessage: null }),

  // Modals
  activeModals: [],
  openModal: (modalId) =>
    set((state) => ({
      activeModals: [...state.activeModals, modalId],
    })),
  closeModal: (modalId) =>
    set((state) => ({
      activeModals: state.activeModals.filter((id) => id !== modalId),
    })),
  isModalOpen: (modalId) => get().activeModals.includes(modalId),
}));

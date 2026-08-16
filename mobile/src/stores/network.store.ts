import { create } from 'zustand';
import * as Network from 'expo-network';
import { trackNetworkChange, setSentryNetworkContext } from '../utils/sentry';
import { useMutationQueueStore } from './mutationQueue.store';
import { useMessageStore } from './message.store';

interface NetworkState {
  isOnline: boolean;
  isConnected: boolean | null;
  networkType: Network.NetworkStateType | null;
  lastOnlineTime: Date | null;
  lastOfflineTime: Date | null;
  pendingSyncCount: number;
  wasOffline: boolean; // tracks if we were offline and just came back

  checkNetworkStatus: () => Promise<boolean>;
  startListening: () => void;
  stopListening: () => void;
  setOnline: () => void;
  setOffline: () => void;
  incrementPendingSync: () => void;
  decrementPendingSync: () => void;
  resetPendingSync: () => void;
  clearWasOffline: () => void;
}

let networkSubscription: { remove: () => void } | null = null;

// Callbacks to run when coming back online
const onlineCallbacks: Array<() => void> = [];
export const registerOnlineCallback = (cb: () => void) => {
  onlineCallbacks.push(cb);
  return () => {
    const idx = onlineCallbacks.indexOf(cb);
    if (idx > -1) onlineCallbacks.splice(idx, 1);
  };
};

export const useNetworkStore = create<NetworkState>((set, get) => ({
  isOnline: true,
  isConnected: null,
  networkType: null,
  lastOnlineTime: new Date(),
  lastOfflineTime: null,
  pendingSyncCount: 0,
  wasOffline: false,

  startListening: () => {
    if (networkSubscription) return;
    try {
      networkSubscription = Network.addNetworkStateListener((state) => {
        const reachable = state.isInternetReachable !== false;
        const isOnline = !!(state.isConnected && reachable);
        const wasOnline = get().isOnline;

        set({
          isConnected: state.isConnected ?? false,
          networkType: state.type,
          isOnline,
        });

        if (!wasOnline && isOnline) {
          get().setOnline();
          trackNetworkChange(true, state.type);
          onlineCallbacks.forEach(cb => { try { cb(); } catch {} });
        } else if (wasOnline && !isOnline) {
          get().setOffline();
          trackNetworkChange(false, state.type);
        }

        setSentryNetworkContext(isOnline, state.type);
      });
    } catch {
      // Fallback: listener not available
    }
  },

  stopListening: () => {
    if (networkSubscription) {
      networkSubscription.remove();
      networkSubscription = null;
    }
  },

  checkNetworkStatus: async () => {
    try {
      const networkState = await Network.getNetworkStateAsync();
      // isInternetReachable can be null on Android (unknown state).
      // Treat null as true â€” assume reachable if connected, to avoid
      // falsely blocking syncs on Android devices.
      const reachable = networkState.isInternetReachable !== false;
      const isOnline = !!(networkState.isConnected && reachable);
      const wasOnline = get().isOnline;

      if (!wasOnline && isOnline) {
        // Just came back online â€” trigger all registered callbacks
        get().setOnline();
        trackNetworkChange(true, networkState.type);
        onlineCallbacks.forEach(cb => {
          try { cb(); } catch { /* silent */ }
        });
      } else if (wasOnline && !isOnline) {
        get().setOffline();
        trackNetworkChange(false, networkState.type);
      }

      set({
        isConnected: networkState.isConnected ?? false,
        networkType: networkState.type,
        isOnline,
      });
      setSentryNetworkContext(isOnline, networkState.type);

      return isOnline;
    } catch (error) {
      set({ isOnline: false, isConnected: false });
      return false;
    }
  },

  setOnline: () => {
    set({
      isOnline: true,
      lastOnlineTime: new Date(),
      wasOffline: get().wasOffline || !get().isOnline,
    });
    setSentryNetworkContext(true, get().networkType);
    try {
      useMutationQueueStore.getState().processQueue();
      useMessageStore.getState().flushUnsentMessageQueue();
    } catch {
      // silent
    }
  },

  setOffline: () => {
    set({
      isOnline: false,
      lastOfflineTime: new Date(),
      wasOffline: true,
    });
    setSentryNetworkContext(false, get().networkType);
  },

  incrementPendingSync: () => set((state) => ({ pendingSyncCount: state.pendingSyncCount + 1 })),
  decrementPendingSync: () => set((state) => ({ pendingSyncCount: Math.max(0, state.pendingSyncCount - 1) })),
  resetPendingSync: () => set({ pendingSyncCount: 0 }),
  clearWasOffline: () => set({ wasOffline: false }),
}));

export const useNetworkStatus = () => {
  const isOnline = useNetworkStore((state) => state.isOnline);
  const checkNetworkStatus = useNetworkStore((state) => state.checkNetworkStatus);
  return { isOnline, isOffline: !isOnline, checkNetworkStatus };
};



import { useEffect, useRef, useState } from 'react';
import { WifiOff, Wifi } from 'lucide-react';

/**
 * Monitors browser online/offline events and shows a slim banner.
 * - Offline → persistent red banner at the top
 * - Just came back online → brief green "Back online" flash for 3 s
 */
export function NetworkBanner() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [showReconnected, setShowReconnected] = useState(false);
  const wasOfflineRef = useRef(!navigator.onLine);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      if (wasOfflineRef.current) {
        setShowReconnected(true);
        timerRef.current = setTimeout(() => setShowReconnected(false), 3000);
      }
      wasOfflineRef.current = false;
    };

    const handleOffline = () => {
      setIsOnline(false);
      wasOfflineRef.current = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      setShowReconnected(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  if (isOnline && !showReconnected) return null;

  if (showReconnected) {
    return (
      <div className="fixed top-0 left-0 right-0 z-[9999] flex items-center justify-center gap-2 bg-green-600 text-white text-sm py-2 px-4 animate-fade-in">
        <Wifi className="w-4 h-4" />
        <span>Back online — data is syncing</span>
      </div>
    );
  }

  return (
    <div className="fixed top-0 left-0 right-0 z-[9999] flex items-center justify-center gap-2 bg-red-600 text-white text-sm py-2 px-4">
      <WifiOff className="w-4 h-4" />
      <span>No internet connection — some features may be unavailable</span>
    </div>
  );
}

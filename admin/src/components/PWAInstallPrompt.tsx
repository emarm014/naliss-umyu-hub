import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';
import { NalissLogo } from './NalissLogo';

let deferredPrompt: any = null;
const INSTALLED_KEY = 'pwa-installed';

export default function PWAInstallPrompt() {
  const [showBanner, setShowBanner] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);

  useEffect(() => {
    // Already installed — never show
    if (localStorage.getItem(INSTALLED_KEY)) return;

    // Running as installed PWA — mark and never show
    if (
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as any).standalone === true
    ) {
      localStorage.setItem(INSTALLED_KEY, '1');
      return;
    }

    // Capture the native install prompt (Android Chrome)
    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      deferredPrompt = e;
      setShowBanner(true); // show immediately when prompt is ready
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);

    // Only hide permanently when browser confirms actual install
    const onInstalled = () => {
      localStorage.setItem(INSTALLED_KEY, '1');
      setShowBanner(false);
      deferredPrompt = null;
    };
    window.addEventListener('appinstalled', onInstalled);

    // Show banner after 2s regardless (covers iOS and cases where prompt fires late)
    const timer = setTimeout(() => {
      if (!localStorage.getItem(INSTALLED_KEY)) {
        setShowBanner(true);
      }
    }, 2000);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
      clearTimeout(timer);
    };
  }, []);

  const handleInstall = async () => {
    if (deferredPrompt) {
      // Android Chrome — trigger native prompt
      setIsInstalling(true);
      try {
        await deferredPrompt.prompt();
        // Do NOT hide banner here — wait for appinstalled event
        // If user cancels, banner stays visible
      } catch {
        // silent
      } finally {
        setIsInstalling(false);
        deferredPrompt = null;
      }
    } else {
      // iOS or no native prompt — show browser menu instruction as alert
      alert(
        'To install:\n\n' +
        'Android: Tap the ⋮ menu → "Add to Home screen"\n\n' +
        'iPhone: Tap the Share button → "Add to Home Screen"'
      );
    }
  };

  const handleDismiss = () => {
    // Hide for now — will show again on next page load
    setShowBanner(false);
  };

  if (!showBanner) return null;

  return (
    <div className="fixed bottom-20 lg:bottom-6 left-3 right-3 lg:left-auto lg:right-6 lg:w-96 z-[201] animate-in slide-in-from-bottom-4 duration-500">
      <div className="bg-white rounded-3xl shadow-2xl shadow-black/20 border border-gray-100 overflow-hidden">
        <div className="h-1 w-full bg-gradient-to-r from-primary-950 to-emerald-500" />
        <div className="p-5">
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-2xl bg-white border border-gray-100 shadow-md flex items-center justify-center shrink-0 overflow-hidden">
              <NalissLogo className="w-10 h-10" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <p className="text-sm font-black text-gray-900">Install Naliss Admin</p>
                <button
                  onClick={handleDismiss}
                  className="p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors ml-2 shrink-0"
                  title="Remind me later"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">
                Install as an app on your device for the best experience.
              </p>
              <button
                onClick={handleInstall}
                disabled={isInstalling}
                className="mt-3 flex items-center gap-2 px-4 py-2.5 bg-primary-950 text-white rounded-xl text-xs font-black uppercase tracking-wider hover:bg-primary-800 active:scale-95 transition-all disabled:opacity-70 shadow-lg shadow-primary-950/20"
              >
                {isInstalling ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Installing…
                  </>
                ) : (
                  <>
                    <Download className="w-3.5 h-3.5" />
                    Install App
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

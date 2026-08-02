import { useEffect, useState } from 'react';
import { Download, X, Sparkles } from 'lucide-react';
import { NalissLogo } from './NalissLogo';

export let globalDeferredPrompt: any = null;

export function triggerAppDownload() {
  if (globalDeferredPrompt) {
    globalDeferredPrompt.prompt();
  } else {
    try {
      const element = document.createElement('a');
      const file = new Blob([
        '[InternetShortcut]\nURL=' + window.location.origin + '/\nIconIndex=0\n'
      ], { type: 'application/x-mswinurl' });
      element.href = URL.createObjectURL(file);
      element.download = 'NALISS_Admin_App.url';
      document.body.appendChild(element);
      element.click();
      document.body.removeChild(element);
    } catch {
      // silent
    }
  }
}

export default function PWAInstallPrompt() {
  const [showBanner, setShowBanner] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);

  useEffect(() => {
    // If running as an installed standalone app window, do not display notification banner
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as any).standalone === true;

    if (isStandalone) {
      return;
    }

    // Capture browser native PWA install prompt event
    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      globalDeferredPrompt = e;
      setShowBanner(true);
    };

    const onInstalled = () => {
      setShowBanner(false);
      globalDeferredPrompt = null;
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);

    // Always show notification banner when entering admin portal until installed
    const timer = setTimeout(() => {
      if (!isStandalone) {
        setShowBanner(true);
      }
    }, 800);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
      clearTimeout(timer);
    };
  }, []);

  const handleInstall = async () => {
    setIsInstalling(true);
    try {
      triggerAppDownload();
    } catch {
      // silent
    } finally {
      setIsInstalling(false);
    }
  };

  const handleDismiss = () => {
    // Hide for current page view — reappears on next entry/refresh until installed
    setShowBanner(false);
  };

  if (!showBanner) return null;

  return (
    <div className="fixed bottom-20 lg:bottom-6 left-3 right-3 lg:left-auto lg:right-6 lg:w-96 z-[201] animate-in slide-in-from-bottom-4 duration-500">
      <div className="bg-white rounded-3xl shadow-2xl shadow-primary-950/20 border border-primary-100 overflow-hidden">
        <div className="h-1.5 w-full bg-gradient-to-r from-primary-950 via-emerald-500 to-amber-500" />
        <div className="p-5">
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-2xl bg-primary-950 flex items-center justify-center shrink-0 overflow-hidden shadow-lg shadow-primary-950/20">
              <NalissLogo className="w-10 h-10 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
                  <p className="text-sm font-black text-gray-900">NALISS Admin App</p>
                </div>
                <button
                  onClick={handleDismiss}
                  className="p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors ml-2 shrink-0"
                  title="Close for now"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-1 leading-relaxed font-medium">
                App download available for Desktop & Mobile. Tap to download instantly.
              </p>
              <button
                onClick={handleInstall}
                disabled={isInstalling}
                className="mt-3.5 w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-primary-950 text-white rounded-xl text-xs font-black uppercase tracking-wider hover:bg-primary-900 active:scale-95 transition-all disabled:opacity-70 shadow-lg shadow-primary-950/20"
              >
                {isInstalling ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Downloading App…
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4" />
                    Download App Now
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

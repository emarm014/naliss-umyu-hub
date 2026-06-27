import React from 'react';
import * as Sentry from '@sentry/react';
import { useOverlayStore } from '../../../store/overlay.store';

interface ErrorBoundaryState {
    hasError: boolean;
}

class OverlayErrorBoundary extends React.Component<{ id: string; onClose: () => void; children: React.ReactNode }, ErrorBoundaryState> {
    state = { hasError: false };

    static getDerivedStateFromError() {
        return { hasError: true };
    }

    componentDidCatch(error: Error, errorInfo: any) {
        console.error("Web Overlay crash intercepted:", error, errorInfo);
        Sentry.captureException(error, {
            tags: { location: 'OverlayErrorBoundary.web', overlayId: this.props.id },
            extra: errorInfo,
        });
        
        setTimeout(() => {
            this.props.onClose();
        }, 1000);
    }

    render() {
        if (this.state.hasError) {
            return null;
        }
        return this.props.children;
    }
}

/**
 * OverlayManager is the global host for programmatically invoked overlays on the PWA.
 * It reads from `useOverlayStore` and renders them in a safe stacking order.
 */
export function OverlayManager() {
    const overlays = useOverlayStore(state => state.overlays);
    const hideOverlay = useOverlayStore(state => state.hideOverlay);

    if (overlays.length === 0) {
        return null;
    }

    return (
        <div className="fixed inset-0 z-50 pointer-events-none" aria-modal="true">
            {overlays.map((overlay) => (
                <OverlayErrorBoundary
                    key={overlay.id}
                    id={overlay.id}
                    onClose={() => hideOverlay(overlay.id, 'Dismiss')}
                >
                    <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                        <div className="pointer-events-auto w-full h-full flex items-center justify-center">
                            {overlay.component}
                        </div>
                    </div>
                </OverlayErrorBoundary>
            ))}
        </div>
    );
}

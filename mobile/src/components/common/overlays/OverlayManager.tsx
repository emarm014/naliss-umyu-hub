import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useOverlayStore, OverlayConfig } from '../../../stores/overlay.store';
import * as Sentry from '@sentry/react-native';

interface ErrorBoundaryState {
    hasError: boolean;
}

class OverlayErrorBoundary extends React.Component<{ id: string; onClose: () => void; children: React.ReactNode }, ErrorBoundaryState> {
    state = { hasError: false };

    static getDerivedStateFromError() {
        return { hasError: true };
    }

    componentDidCatch(error: any, errorInfo: any) {
        Sentry.captureException(error, {
            extra: { overlayId: this.props.id, errorInfo }
        });
    }

    render() {
        if (this.state.hasError) {
            return null; // Gracefully recover by rendering nothing
        }
        return this.props.children;
    }
}

/**
 * OverlayManager is the global host for programmatically invoked overlays.
 * It reads from `useOverlayStore` and renders them in a safe stacking order.
 * This should be placed near the root of the app (e.g., inside _layout.tsx).
 */
export function OverlayManager() {
    const overlays = useOverlayStore((state: any) => state.overlays);
    const hideOverlay = useOverlayStore((state: any) => state.hideOverlay);

    if (overlays.length === 0) {
        return null;
    }

    return (
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none" accessibilityViewIsModal>
            {overlays.map((overlay: OverlayConfig) => (
                <OverlayErrorBoundary
                    key={overlay.id}
                    id={overlay.id}
                    onClose={() => hideOverlay(overlay.id, 'Dismiss')}
                >
                    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
                        {overlay.component}
                    </View>
                </OverlayErrorBoundary>
            ))}
        </View>
    );
}

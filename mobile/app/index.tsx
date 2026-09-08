import { Redirect } from 'expo-router';
import { useAuthStore } from '../src/stores/auth.store';
import { useState, useEffect } from 'react';
import * as Linking from 'expo-linking';

export default function Index() {
    // If we have a cached session + complete profile, go straight to tabs.
    // Otherwise, go to login. ProtectedRoute will handle the final redirect.
    const session = useAuthStore(s => s.session);
    const isProfileComplete = useAuthStore(s => s.isProfileComplete);
    const _hasHydrated = useAuthStore(s => s._hasHydrated);

    const [initialUrlChecked, setInitialUrlChecked] = useState(false);
    const [hasAuthLink, setHasAuthLink] = useState(false);

    useEffect(() => {
        Linking.getInitialURL().then((url) => {
            // If the app was opened via a deep link containing an auth token,
            // we stall the default redirect so _layout.tsx can handle it.
            if (url && (url.includes('type=recovery') || url.includes('access_token='))) {
                setHasAuthLink(true);
            }
            setInitialUrlChecked(true);
        });
    }, []);

    // Before hydration or URL check completes, render nothing (splash screen is still visible)
    if (!_hasHydrated || !initialUrlChecked) return null;

    // If an auth deep link is present, do nothing and let _layout.tsx's deep link handler route us
    if (hasAuthLink) return null;

    // If we have a valid cached session with a complete profile, go to tabs
    if (session && isProfileComplete === true) {
        return <Redirect href="/(tabs)" />;
    }

    // Default: send to login — ProtectedRoute will redirect to tabs if session is valid
    return <Redirect href="/auth/login" />;
}

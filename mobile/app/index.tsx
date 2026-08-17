import { Redirect } from 'expo-router';
import { useAuthStore } from '../src/stores/auth.store';

export default function Index() {
    // If we have a cached session + complete profile, go straight to tabs.
    // Otherwise, go to login. ProtectedRoute will handle the final redirect.
    const session = useAuthStore(s => s.session);
    const isProfileComplete = useAuthStore(s => s.isProfileComplete);
    const _hasHydrated = useAuthStore(s => s._hasHydrated);

    // Before hydration completes, render nothing (splash screen is still visible)
    if (!_hasHydrated) return null;

    // If we have a valid cached session with a complete profile, go to tabs
    if (session && isProfileComplete === true) {
        return <Redirect href="/(tabs)" />;
    }

    // Default: send to login — ProtectedRoute will redirect to tabs if session is valid
    return <Redirect href="/auth/login" />;
}

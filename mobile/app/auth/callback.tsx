import { useEffect } from 'react';

// This is a placeholder route to intercept the OAuth redirect deep link (`/auth/callback`).
// When Google OAuth finishes, it redirects to `nalisshub://auth/callback?code=...`.
// Without this file, Expo Router treats the URL as a missing route and redirects to `+not-found.tsx`,
// which cascades into `/` and then `/auth/login`, creating a race condition that breaks the auth flow.
// The actual OAuth session exchange is handled globally by `_layout.tsx` and `oauth-redirect.ts`.
export default function AuthCallback() {
  return null;
}

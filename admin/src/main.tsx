import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import * as Sentry from "@sentry/react";
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  integrations: [
    Sentry.browserTracingIntegration(),
    Sentry.replayIntegration(),
    Sentry.captureConsoleIntegration({ levels: ['error'] }),
  ],
  // Performance Monitoring
  tracesSampleRate: 1.0, 
  tracePropagationTargets: ["localhost", /^\/api/, /\.supabase\.co/],
  // Session Replays
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
  // Filter out known operational noise — these are expected behaviors, not bugs
  beforeSend(event) {
    const msg = event.exception?.values?.[0]?.value || event.message || '';
    // GoTrue lock contention (React Strict Mode double-mount, expected recovery)
    if (msg.includes('Lock broken by another request') || msg.includes('not released within 5000ms')) return null;
    // Stale deployment chunks (handled by safeLazy auto-reload)
    if (msg.includes('Failed to fetch dynamically imported module')) return null;
    // External service fetch failures (ipify, Sentry ingestion)
    if (msg.includes('Failed to fetch') && (msg.includes('ipify') || msg.includes('sentry'))) return null;
    // RealtimeManager reconnect exhaustion (enters slow-retry mode, not a crash)
    if (msg.includes('[RealtimeManager] Max reconnect attempts')) return null;
    return event;
  },
});


const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  )
}

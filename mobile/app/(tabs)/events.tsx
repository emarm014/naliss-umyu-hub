import { Redirect } from 'expo-router';

/**
 * Placeholder for Events tab — events are displayed within the Announcements tab.
 * This file exists solely to satisfy the Expo Router route registration
 * in (tabs)/_layout.tsx (name="events", href=null).
 */
export default function EventsRedirect() {
  return <Redirect href="/(tabs)/announcements" />;
}

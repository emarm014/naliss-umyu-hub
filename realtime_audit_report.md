# Realtime & WebSocket Infrastructure Audit Report

## 1. REALTIME CHANNEL INVENTORY & CLEANUP AUDIT
During the scan of the codebase, several critical issues were found regarding how channels are dynamically created and managed inside React lifecycles.

### Uncleaned / Re-render Leak Risks
- **`mobile/app/event-pool/[id].tsx` (Lines 179-190)**
  - **Issue**: The channel is created using a dynamic timestamp: `supabase.channel('pool_updates_${id}_${Date.now()}')`.
  - **Re-render Loop**: This subscription lives inside a `useEffect` that has `user` in its dependency array. Because `user` is an object (from the auth store), its reference changes on profile updates or rehydrations. This causes the `useEffect` to repeatedly tear down and recreate a brand new WebSocket channel, flooding the network payload.
- **`mobile/app/(tabs)/index.tsx` (Lines 371-385)**
  - **Issue**: `supabase.channel('home_fyb_listener_${Date.now()}')` is created inside a `useEffect`. While it does return a teardown call (`supabase.removeChannel(channel)`), appending `Date.now()` completely bypasses Supabase's internal channel reuse/pooling mechanism if a race condition occurs.
- **`mobile/app/(tabs)/directory.tsx` (Lines 46-68)**
  - **Issue**: Creates two entirely separate channels (`public:lecturers_${Date.now()}` and `public:executives_${Date.now()}`) inside the same `useEffect` instead of multiplexing them.
- **`mobile/app/chat/[id].tsx` (Lines 650-869)**
  - **Issue**: The `setupRealtime` function properly scopes the teardown using `realtimeChannelRef.current = channel` and cleans it up on unmount (Line 381). However, the channel name `chat:${idRef.current}:${Date.now()}` forces a completely new WebSocket channel allocation on every minor network reconnect.

## 2. GROUP CHAT & ADMIN ACTIVITY REALTIME PIPELINE
**Architectural Root Cause: Why data fails to appear without a hard restart**

1. **Active Screen Isolation**: In `mobile/app/chat/[id].tsx` (Line 660), the real-time subscription is strictly scoped using `filter: 'group_id=eq.${idRef.current}'`. The client ONLY listens for messages belonging to the currently open chat screen. 
2. **Missing Global Listener (The Core Bug)**: 
   - Found in **`mobile/src/stores/globalSync.store.ts` (Lines 220-224)**:
     ```typescript
     // ── Emergency Realtime Optimization ────────────────────────────────
     // Removed the 'mobile:global:broadcast' WebSocket completely to protect the
     // Supabase Free Tier 200 concurrent connection limit.
     // Sync now relies exclusively on AppState foregrounding and background sync intervals.
     ```
   - **Impact**: Because the global listener was explicitly removed, when a user is sitting in Group 1, any message sent to Group 2 is completely ignored. Similarly, when an Admin creates a new Event Pool or Activity, the mobile clients do not receive a broadcast. 
   - **Fallback Mechanism**: The app currently relies on a silent 10-minute polling interval (`BG_SYNC_INTERVAL`) or the user foregrounding the app to trigger a data fetch, completely breaking the "real-time" experience.

## 3. CONNECTION CONCURRENCY & BANDWIDTH RISKS (FREE TIER CHECK)
**Where the 200 concurrent connection limit is burning:**

Unlike the Admin dashboard (`admin/src/lib/realtimeManager.ts`), which correctly utilizes a unified "Single Multiplexed Channel" (`admin_rt_multiplexed`), the Mobile app suffers from severe channel fragmentation. 

Because React Navigation (Expo Router) keeps tab screens mounted in the background, a single user exploring the app concurrently opens multiple isolated WebSocket connections:
- **Home Screen** (`index.tsx`): 1 active channel (`home_fyb_listener`)
- **Directory Screen** (`directory.tsx`): 2 active channels (`public:lecturers`, `public:executives`)
- **Chat Screen** (`chat/[id].tsx`): 1 active channel (`chat:[id]`)
- **Event Pool** (`event-pool/[id].tsx`): 1 active channel (`pool_updates_[id]`)

**Final Tally:**
A single mobile client easily opens and maintains **4 to 5 distinct WebSocket channels** simultaneously during a typical session. 

**The Free Tier Risk**: With 4-5 connections per user, **just 40 to 50 active users** navigating the app will instantly exhaust the Supabase Free Tier limit of 200 concurrent connections, leading to WebSocket drops and `CHANNEL_ERROR` failures across the entire user base.

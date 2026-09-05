# Mobile App Full Bug Audit & Fix Plan

## Feature Map (verified by reading every screen, store, and service)
1. **Auth**: login, register (email + Google), OTP, password reset, level selection
2. **Group Chat**: WhatsApp-style with text/sticker/image/video/document/audio messages
3. **Media**: Cloudinary upload + download to local vault + offline access
4. **Resources**: Materials, Past Questions, Courses — admin posts, students stream/download
5. **Announcements & Events**: with category filtering, read tracking
6. **Directory**: Lecturers + Executives
7. **Profile**: Avatar, username, bio, notification prefs, password change
8. **Sync**: Global realtime sync, background sync, offline-first

---

## BUGS FOUND

### BUG 1: Sign-out does NOT clear message cache or group cache (CRITICAL - Data Leak)
**File**: `mobile/src/stores/auth.store.ts` line 257-268
**Problem**: `signOut()` clears session/user/profile but does NOT call `useMessageStore.getState().clearCache()` or `useGroupStore.getState().clearGroups()`. When User A signs out and User B signs in on the same device, User B sees User A's chat messages and group list from AsyncStorage. This is a privacy/data-leak bug.
**Fix**: Add `clearCache()` and `clearGroups()` calls to `signOut()`. Also terminate the global sync store.

### BUG 2: Chat document/audio/video upload uses stale `user_metadata` instead of `profile` (Consistency)
**File**: `mobile/app/chat/[id].tsx` lines 1516-1517, 1603-1604
**Problem**: `handlePickDocument` and `handlePickAudioVideo` create optimistic messages using `currentUser.user_metadata?.username` and `currentUser.user_metadata?.avatar_url`, while `handleSend`, `handleSendSticker`, and `handlePickImage` correctly use `profile?.username` and `profile?.avatar_url`. The document/audio/video upload handlers are inconsistent and will show stale usernames/avatars if the user recently updated their profile.
**Fix**: Replace `currentUser.user_metadata?.username` with `profile?.username || currentUser.user_metadata?.username` and `currentUser.user_metadata?.avatar_url` with `profile?.avatar_url || currentUser.user_metadata?.avatar_url` in both `handlePickDocument` and `handlePickAudioVideo`.

### BUG 3: Chat search uses client-side filter but also calls server-side `fetchMessages` with search params
**File**: `mobile/app/chat/[id].tsx` lines 1875-1880 vs 236-300
**Problem**: When `isSearching` is true, the FlatList filters `messages` client-side (lines 1875-1880). But the `fetchMessages` function at line 236 also accepts `searchParams` for server-side filtering. However, the search UI never calls `fetchMessages(searchParams)` — the "Search" button just sets `isSearching=true` (line 1853) which only applies the client-side filter on the already-loaded messages. This is actually fine for local search, BUT the `fetchMessages` server-side search branch (lines 253-265) has a bug: when `params.username` is set, it uses `ilike('user.username', ...)` which queries a JOIN column — this may not work with Supabase PostgREST and could silently return 0 results, making the server-side search broken while the client-side search works. Since only client-side is used, this is a latent bug but should be noted.
**Fix**: Remove the dead server-side search code path or fix the query. For now, the client-side search works correctly, so this is low priority.

### BUG 4: `handlePickDocument` optimistic message uses `uploadName` as content instead of display text
**File**: `mobile/app/chat/[id].tsx` line 1512
**Problem**: The optimistic message for documents sets `content: uploadName` where `uploadName = ${Date.now()}-${originalName}`. This timestamp-prefixed name shows in the chat bubble as the "content" of the message, which looks ugly and confusing. For text messages, content is the actual text. For images, it's a local URI that renders as an image. But for documents, the user sees something like "1715512345678-Assignment1.pdf" as the message content text. It should show the original name or a friendlier label.
**Fix**: Change `content: uploadName` to `content: originalName` in the optimistic message so the user sees "Assignment1.pdf" instead of the timestamped upload name.

### BUG 5: Same issue in `handlePickAudioVideo` — optimistic content uses `uploadName`
**File**: `mobile/app/chat/[id].tsx` line 1600
**Problem**: Same as BUG 4 — `content: uploadName` shows the timestamped name instead of the original.
**Fix**: Change `content: uploadName` to `content: originalName`.

### BUG 6: Resource viewer `handleRead` vault file name mismatch with download function
**File**: `mobile/app/(tabs)/resources.tsx` lines 179-185
**Problem**: The `handleRead` function checks for a vault file using `${material.id}_${safeName}` where `safeName = displayName.replace(/[^a-z0-9._-]/gi, '_').toLowerCase()`. Then it calls `getVaultFilePath(material.id, displayName)` which internally does the same sanitization. This is consistent. However, the `downloadFile` utility in `download.ts` uses `getVaultFilePath(fileId, displayName)` which also sanitizes. The `refreshDownloadedStatus` in `resource.store.ts` uses `checkFileExists(`${item.id}_${realName.replace(/[^a-z0-9._-]/gi, '_').toLowerCase()}`)` which is the same pattern. So this is actually consistent — no bug here on closer inspection.

### BUG 7: `formatFileSize` in chat screen only handles up to MB
**File**: `mobile/app/chat/[id].tsx` lines 1653-1659
**Problem**: The `sizes` array is `['B', 'KB', 'MB']` — it doesn't include 'GB'. For very large files (videos can be up to 20MB which is fine, but still), the `Math.log(bytes) / Math.log(k)` calculation could produce `i >= 3` for files > 1GB, causing `sizes[i]` to be `undefined`. This would display "1.5 undefined" instead of "1.5 GB".
**Fix**: Add 'GB' to the sizes array: `const sizes = ['B', 'KB', 'MB', 'GB'];`

### BUG 8: Profile screen `showPasswordVisible` state is declared but never used meaningfully
**File**: `mobile/app/(tabs)/profile.tsx` line 102
**Problem**: `const [showPasswordVisible, setShowPasswordVisible] = useState(false);` is declared but `showPasswordVisible` is never read in the rendered JSX. The password visibility toggle uses a different mechanism or is missing the toggle button.
**Fix**: Either wire up `showPasswordVisible` to control password field visibility in the security modal, or remove the dead state. This is a minor UI bug — password fields may not have a show/hide toggle.

### BUG 9: Notification settings `updatePreferences` in profile screen doesn't sync `notifSettings` local state on DB confirm
**File**: `mobile/app/(tabs)/profile.tsx` — notification settings handling
**Problem**: When notification toggles are changed, `updatePreferences` is called which does optimistic update on the auth store profile. But the local `notifSettings` state may get out of sync if the DB update returns a different value or fails silently. Looking at the code more carefully, the `useEffect` on `storeProfile` at line 58-72 syncs `editData` but NOT `notifSettings`. If the user changes a notification toggle, the optimistic store update fires, which triggers the `storeProfile` effect, but `notifSettings` is NOT updated from the new store profile.
**Fix**: Add `notifSettings` sync to the `storeProfile` effect, similar to how `editData` is synced.

### BUG 10: Chat `handleClearChat` only clears UI but does NOT clear the persistent message cache
**File**: `mobile/app/chat/[id].tsx` lines 1016-1035
**Problem**: This is actually BY DESIGN — the comment says "do NOT touch the persistent cache. Messages are permanent and will reappear when the user navigates back." This means the "Clear Chat" action is effectively useless — messages reappear immediately when the user navigates away and comes back. This is confusing UX. The user expects "Clear Chat" to actually clear the chat.
**Fix**: Either remove the "Clear Chat" option (since it doesn't do anything meaningful), or properly clear the cache for this group using `messageStore.setMessages(id, [])`. If the intent is WhatsApp-style where clearing only affects the local device, then `messageStore.setMessages(id, [])` is the correct implementation.

---

## PRIORITY ORDER

| # | Bug | Severity | Impact |
|---|-----|----------|--------|
| 1 | Sign-out doesn't clear caches | CRITICAL | Data leak between users |
| 2 | Document/audio/video stale user_metadata | MEDIUM | Shows wrong username/avatar |
| 4 | Document optimistic content shows uploadName | MEDIUM | Ugly timestamped filenames |
| 5 | Audio/video optimistic content shows uploadName | MEDIUM | Same as #4 |
| 7 | formatFileSize missing GB | LOW | Display bug for very large files |
| 9 | Notif settings not synced from store | LOW | Toggle may show stale state |
| 10 | Clear Chat is a no-op | LOW | Confusing UX |
| 8 | Unused showPasswordVisible state | LOW | Dead code / missing feature |
| 3 | Server-side chat search unused/broken | LOW | Latent bug, client search works |

---

## EXECUTION PLAN

### Task 1: Fix sign-out data leak (BUG 1)
- Edit `mobile/src/stores/auth.store.ts` `signOut()` method
- Add `useMessageStore.getState().clearCache()` and `useGroupStore.getState().clearGroups()` and `useGlobalSyncStore.getState().terminate()`
- Import the stores at top

### Task 2: Fix stale user_metadata in document/audio/video uploads (BUG 2)
- Edit `mobile/app/chat/[id].tsx`
- In `handlePickDocument` (line ~1516): change `currentUser.user_metadata?.username` to `profile?.username || currentUser.user_metadata?.username` and same for `avatar_url`
- In `handlePickAudioVideo` (line ~1603): same changes

### Task 3: Fix optimistic document content display (BUGs 4 + 5)
- Edit `mobile/app/chat/[id].tsx`
- In `handlePickDocument` (line ~1512): change `content: uploadName` to `content: originalName`
- In `handlePickAudioVideo` (line ~1600): change `content: uploadName` to `content: originalName`

### Task 4: Fix formatFileSize missing GB (BUG 7)
- Edit `mobile/app/chat/[id].tsx` line 1656
- Change `const sizes = ['B', 'KB', 'MB']` to `const sizes = ['B', 'KB', 'MB', 'GB']`

### Task 5: Fix notification settings sync (BUG 9)
- Edit `mobile/app/(tabs)/profile.tsx`
- Add notifSettings sync to the storeProfile useEffect

### Task 6: Fix Clear Chat to actually clear cache (BUG 10)
- Edit `mobile/app/chat/[id].tsx` `handleClearChat`
- Change to call `messageStore.setMessages(id, [])` so messages don't reappear

### Task 7: Verify TypeScript compilation
- Run `npx tsc --noEmit` on mobile directory

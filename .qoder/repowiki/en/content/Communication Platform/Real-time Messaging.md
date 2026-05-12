# Real-time Messaging

<cite>
**Referenced Files in This Document**
- [005_messaging.sql](file://supabase/migrations/005_messaging.sql)
- [008_governance_functions.sql](file://supabase/migrations/008_governance_functions.sql)
- [client.ts](file://mobile/src/api/supabase/client.ts)
- [messages.tsx](file://mobile/app/(tabs)/messages.tsx)
- [index.ts](file://mobile/src/types/index.ts)
</cite>

## Table of Contents
1. [Introduction](#introduction)
2. [Project Structure](#project-structure)
3. [Core Components](#core-components)
4. [Architecture Overview](#architecture-overview)
5. [Detailed Component Analysis](#detailed-component-analysis)
6. [Dependency Analysis](#dependency-analysis)
7. [Performance Considerations](#performance-considerations)
8. [Troubleshooting Guide](#troubleshooting-guide)
9. [Conclusion](#conclusion)

## Introduction
This document describes the real-time messaging system architecture, covering conversation management (direct messages and group conversations with level-based grouping), message threading, read receipts, typing indicators, and real-time synchronization via Supabase Realtime. It also documents participant management, role-based permissions, notification settings, content types and attachments, replies, moderation features, and the database schema with relationships and constraints. Finally, it outlines performance considerations, indexing strategies, and scalability patterns for large-scale messaging.

## Project Structure
The messaging system spans two primary areas:
- Backend database schema and triggers in Supabase migrations
- Frontend mobile application integrating Supabase client and Realtime subscriptions

```mermaid
graph TB
subgraph "Mobile App"
UI["Messages Screen<br/>messages.tsx"]
Store["Auth Store"]
SupabaseClient["Supabase Client<br/>client.ts"]
end
subgraph "Supabase Backend"
Pub["Publication: supabase_realtime"]
Triggers["Triggers & Functions<br/>005_messaging.sql"]
Views["Views & Policies<br/>008_governance_functions.sql"]
end
subgraph "Database"
Conv["conversations"]
Part["conversation_participants"]
Msg["messages"]
Receipts["message_read_receipts"]
Typing["typing_indicators"]
Reports["message_reports"]
Filters["profanity_filters"]
end
UI --> SupabaseClient
Store --> SupabaseClient
SupabaseClient --> Pub
Pub --> Conv
Pub --> Part
Pub --> Msg
Pub --> Typing
Triggers --> Conv
Triggers --> Part
Triggers --> Msg
Views --> Conv
Views --> Part
Views --> Msg
Conv --> Msg
Conv --> Part
Part --> Msg
Msg --> Receipts
Msg --> Reports
Msg --> Filters
```

**Diagram sources**
- [messages.tsx](file://mobile/app/(tabs)/messages.tsx#L16-L65)
- [client.ts](file://mobile/src/api/supabase/client.ts#L15-L32)
- [005_messaging.sql](file://supabase/migrations/005_messaging.sql#L9-L321)
- [008_governance_functions.sql](file://supabase/migrations/008_governance_functions.sql#L501-L509)

**Section sources**
- [messages.tsx](file://mobile/app/(tabs)/messages.tsx#L16-L65)
- [client.ts](file://mobile/src/api/supabase/client.ts#L15-L32)
- [005_messaging.sql](file://supabase/migrations/005_messaging.sql#L9-L321)
- [008_governance_functions.sql](file://supabase/migrations/008_governance_functions.sql#L501-L509)

## Core Components
- Conversations: Direct or group chats with optional level-based grouping and general department-wide groups
- Participants: Membership with roles, read tracking, and notification settings
- Messages: Rich content with attachments, replies, edits, deletions, and moderation
- Read receipts: Delivery and read status tracking
- Typing indicators: Real-time presence of other users typing
- Moderation: Reports, flagging, and profanity filtering
- Realtime: Supabase Realtime publication enabling live updates

**Section sources**
- [005_messaging.sql](file://supabase/migrations/005_messaging.sql#L9-L191)
- [008_governance_functions.sql](file://supabase/migrations/008_governance_functions.sql#L501-L509)

## Architecture Overview
The frontend fetches conversations and subscribes to Supabase Realtime channels for live updates. Backend triggers maintain conversation timestamps, participant unread counts, and updated_at fields. Moderation and reporting tables support content governance.

```mermaid
sequenceDiagram
participant User as "User"
participant UI as "Messages Screen<br/>messages.tsx"
participant Client as "Supabase Client<br/>client.ts"
participant Pub as "Publication : supabase_realtime"
participant DB as "PostgreSQL"
User->>UI : Open Messages
UI->>Client : Initialize Supabase client
UI->>Client : Subscribe to channels (conversations, participants, messages, typing)
Client->>Pub : Connect to Realtime
Pub-->>Client : Live events (insert/update/delete)
Client-->>UI : Notify UI of changes
UI->>DB : Query conversations (conversation_participants join)
DB-->>UI : Conversation list with unread counts
UI-->>User : Render conversations and typing indicators
```

**Diagram sources**
- [messages.tsx](file://mobile/app/(tabs)/messages.tsx#L16-L65)
- [client.ts](file://mobile/src/api/supabase/client.ts#L15-L32)
- [008_governance_functions.sql](file://supabase/migrations/008_governance_functions.sql#L501-L509)

## Detailed Component Analysis

### Conversations
- Purpose: Stores chat rooms (direct or group), metadata, level-based grouping, and general department-wide groups
- Key attributes: Type flag, name, avatar, creator, level, general flag, activity status, last message timestamp
- Constraints: Group name required for non-direct conversations
- Indexes: Active status, last message ordering, level-based grouping, general groups

```mermaid
erDiagram
CONVERSATIONS {
uuid id PK
boolean is_direct
varchar name
text avatar_url
text description
uuid created_by
enum level
boolean is_level_group
boolean is_general
boolean is_active
timestamptz last_message_at
timestamptz created_at
timestamptz updated_at
}
```

**Diagram sources**
- [005_messaging.sql](file://supabase/migrations/005_messaging.sql#L9-L44)

**Section sources**
- [005_messaging.sql](file://supabase/migrations/005_messaging.sql#L9-L44)

### Conversation Participants
- Purpose: Tracks who belongs to a conversation, roles, read status, and notification preferences
- Key attributes: Joined/Left timestamps, admin flag, last read timestamp, unread count, notification settings, muting
- Indexes: Per-conversation lookup, per-user lookup, unread counts, active memberships

```mermaid
erDiagram
CONVERSATION_PARTICIPANTS {
uuid id PK
uuid conversation_id FK
uuid user_id FK
timestamptz joined_at
timestamptz left_at
boolean is_admin
timestamptz last_read_at
integer unread_count
boolean notifications_enabled
boolean is_muted
timestamptz muted_until
}
```

**Diagram sources**
- [005_messaging.sql](file://supabase/migrations/005_messaging.sql#L50-L83)

**Section sources**
- [005_messaging.sql](file://supabase/migrations/005_messaging.sql#L50-L83)

### Messages
- Purpose: Stores messages with rich content, attachments, threading via replies, system actions, moderation flags, and timestamps
- Key attributes: Content type, attachments, reply-to, edit/deleted flags, system action/data, moderation flags, timestamps
- Indexes: Conversation-ordered retrieval, sender, reply chain, creation time, active messages, full-text search

```mermaid
erDiagram
MESSAGES {
uuid id PK
uuid conversation_id FK
uuid sender_id FK
text content
varchar content_type
text attachment_url
varchar attachment_name
bigint attachment_size
varchar attachment_mime_type
text attachment_thumbnail_url
uuid reply_to_id FK
boolean is_edited
timestamptz edited_at
boolean is_deleted
timestamptz deleted_at
uuid deleted_by
varchar system_action
jsonb system_data
boolean is_flagged
text flagged_reason
uuid flagged_by
timestamptz flagged_at
timestamptz created_at
}
```

**Diagram sources**
- [005_messaging.sql](file://supabase/migrations/005_messaging.sql#L89-L145)

**Section sources**
- [005_messaging.sql](file://supabase/migrations/005_messaging.sql#L89-L145)

### Message Read Receipts
- Purpose: Tracks delivery and read status per user per message
- Attributes: Status, read timestamp, creation timestamp
- Indexes: Message/user/status for efficient lookups

```mermaid
erDiagram
MESSAGE_READ_RECEIPTS {
uuid id PK
uuid message_id FK
uuid user_id FK
enum status
timestamptz read_at
timestamptz created_at
}
```

**Diagram sources**
- [005_messaging.sql](file://supabase/migrations/005_messaging.sql#L151-L170)

**Section sources**
- [005_messaging.sql](file://supabase/migrations/005_messaging.sql#L151-L170)

### Typing Indicators
- Purpose: Real-time typing presence per conversation
- Attributes: Typing flag, last updated timestamp
- Indexes: Conversation-based lookup

```mermaid
erDiagram
TYPING_INDICATORS {
uuid id PK
uuid conversation_id FK
uuid user_id FK
boolean is_typing
timestamptz updated_at
}
```

**Diagram sources**
- [005_messaging.sql](file://supabase/migrations/005_messaging.sql#L176-L191)

**Section sources**
- [005_messaging.sql](file://supabase/migrations/005_messaging.sql#L176-L191)

### Moderation and Reporting
- Message Reports: Tracks user-reported messages with categories and resolution status
- Profanity Filters: Word list with severity and actions for moderation
- Muted Users: Records user-level muting by admins/moderators

```mermaid
erDiagram
MESSAGE_REPORTS {
uuid id PK
uuid message_id FK
uuid reported_by FK
text reason
varchar category
varchar status
uuid reviewed_by
timestamptz reviewed_at
text resolution_notes
timestamptz created_at
}
PROFANITY_FILTERS {
uuid id PK
varchar word UK
varchar severity
varchar replacement
varchar action
boolean is_active
uuid created_by
timestamptz created_at
}
MUTED_USERS {
uuid id PK
uuid user_id FK
uuid muted_by FK
text reason
timestamptz mute_until
boolean is_permanent
timestamptz created_at
}
MESSAGES ||--o{ MESSAGE_REPORTS : "reported"
MESSAGES ||..|| PROFANITY_FILTERS : "filtered_by"
USERS ||--o{ MUTED_USERS : "muted_by"
```

**Diagram sources**
- [005_messaging.sql](file://supabase/migrations/005_messaging.sql#L224-L271)

**Section sources**
- [005_messaging.sql](file://supabase/migrations/005_messaging.sql#L224-L271)

### Triggers and Automatic Behaviors
- Conversation last message timestamp update on new message
- Unread count increment for participants (excluding sender, muted, or left)
- Updated-at column maintenance for conversations

```mermaid
flowchart TD
Start(["Message Insert"]) --> UpdateConv["Update conversation last_message_at and updated_at"]
Start --> IncUnread["Increment unread_count for participants (except sender, muted, left)"]
UpdateConv --> End(["Done"])
IncUnread --> End
```

**Diagram sources**
- [005_messaging.sql](file://supabase/migrations/005_messaging.sql#L277-L321)

**Section sources**
- [005_messaging.sql](file://supabase/migrations/005_messaging.sql#L277-L321)

### Frontend Integration and Realtime
- Mobile screen fetches conversations via a join of conversation_participants and conversations, orders by last_read_at, and displays unread counts
- Supabase client configured with Realtime events per second limit and helper for channels
- Supabase Realtime publication enabled for messaging tables

```mermaid
sequenceDiagram
participant Screen as "Messages Screen<br/>messages.tsx"
participant Supa as "Supabase Client<br/>client.ts"
participant Pub as "Realtime Publication"
participant DB as "Database"
Screen->>Supa : Initialize client
Supa->>Pub : Connect channels (conversations, participants, messages, typing)
Pub-->>Supa : Events (insert/update/delete)
Supa-->>Screen : Notify UI
Screen->>DB : SELECT conversation_participants JOIN conversations
DB-->>Screen : Conversations with unread counts
Screen-->>Screen : Render UI
```

**Diagram sources**
- [messages.tsx](file://mobile/app/(tabs)/messages.tsx#L16-L65)
- [client.ts](file://mobile/src/api/supabase/client.ts#L15-L32)
- [008_governance_functions.sql](file://supabase/migrations/008_governance_functions.sql#L501-L509)

**Section sources**
- [messages.tsx](file://mobile/app/(tabs)/messages.tsx#L16-L65)
- [client.ts](file://mobile/src/api/supabase/client.ts#L15-L32)
- [008_governance_functions.sql](file://supabase/migrations/008_governance_functions.sql#L501-L509)

### Role-Based Permissions and Notification Settings
- Roles and permissions are defined centrally and include messaging capabilities
- Participants carry notification settings and muting controls

```mermaid
classDiagram
class RolePermission {
+UserRole role
+Permission[] permissions
}
class ConversationParticipant {
+boolean notifications_enabled
+boolean is_muted
+timestamptz muted_until
}
```

**Diagram sources**
- [index.ts](file://mobile/src/types/index.ts#L410-L447)
- [005_messaging.sql](file://supabase/migrations/005_messaging.sql#L66-L69)

**Section sources**
- [index.ts](file://mobile/src/types/index.ts#L410-L447)
- [005_messaging.sql](file://supabase/migrations/005_messaging.sql#L66-L69)

## Dependency Analysis
- Conversations ↔ Messages: One-to-many relationship via conversation_id
- Conversations ↔ Participants: One-to-many relationship via conversation_id
- Participants ↔ Users: Many-to-one via user_id
- Messages ↔ Messages (threading): Self-reference via reply_to_id
- Read receipts ↔ Messages/Users: Many-to-one to both
- Typing indicators ↔ Conversations/Users: Many-to-one to both
- Moderation: Reports link to messages; filters apply to messages; muted users link to users

```mermaid
erDiagram
CONVERSATIONS ||--o{ MESSAGES : "contains"
CONVERSATIONS ||--o{ CONVERSATION_PARTICIPANTS : "has"
CONVERSATION_PARTICIPANTS }o--|| USERS : "belongs_to"
MESSAGES }o--|| MESSAGES : "reply_to"
MESSAGES ||--o{ MESSAGE_READ_RECEIPTS : "receipts"
MESSAGE_READ_RECEIPTS }o--|| USERS : "user"
TYPING_INDICATORS }o--|| CONVERSATIONS : "in"
TYPING_INDICATORS }o--|| USERS : "user"
MESSAGE_REPORTS }o--|| MESSAGES : "reports"
MUTED_USERS }o--|| USERS : "muted_user"
```

**Diagram sources**
- [005_messaging.sql](file://supabase/migrations/005_messaging.sql#L9-L191)

**Section sources**
- [005_messaging.sql](file://supabase/migrations/005_messaging.sql#L9-L191)

## Performance Considerations
- Indexing strategy
  - Conversations: Active status, last_message_at descending, level/general filters
  - Participants: Conversation/user, unread counts with partial index, active membership
  - Messages: Conversation-ordered by created_at, sender, reply chain, created_at, flagged, active messages, full-text search
  - Read receipts: message/user/status
  - Typing indicators: conversation-based
  - Moderation: active filters and word indexing
- Triggers
  - Minimal overhead: lightweight updates for last_message_at and unread counts
- Realtime
  - Controlled events-per-second to balance responsiveness and bandwidth
- Scalability patterns
  - Partitioning: level-based groups and general groups reduce query scope
  - Pagination: fetch messages per conversation with cursor-based pagination
  - Caching: unread counts and recent previews cached in memory
  - Offloading heavy moderation tasks to background jobs if needed

[No sources needed since this section provides general guidance]

## Troubleshooting Guide
- Realtime not updating
  - Verify publication includes messaging tables
  - Confirm client initialization and channel creation
- Missing conversations
  - Ensure participant records are not marked as left
  - Check ordering by last_read_at and active flags
- Typing indicators not appearing
  - Confirm typing indicator entries and channel subscription
- Moderation issues
  - Validate report statuses and flagged flags
  - Check profanity filter activation and word normalization

**Section sources**
- [008_governance_functions.sql](file://supabase/migrations/008_governance_functions.sql#L501-L509)
- [client.ts](file://mobile/src/api/supabase/client.ts#L15-L32)
- [005_messaging.sql](file://supabase/migrations/005_messaging.sql#L176-L191)
- [005_messaging.sql](file://supabase/migrations/005_messaging.sql#L224-L271)

## Conclusion
The messaging system integrates robust database modeling with Supabase Realtime to deliver responsive direct and group conversations, level-based grouping, threaded replies, read receipts, typing indicators, and comprehensive moderation. Carefully designed indexes and triggers ensure performance at scale, while role-based permissions and notification settings provide flexibility for diverse user needs.
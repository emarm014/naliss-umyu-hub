# Communication Platform

<cite>
**Referenced Files in This Document**
- [README.md](file://README.md)
- [client.ts](file://mobile/src/api/supabase/client.ts)
- [supabase.ts](file://admin/src/lib/supabase.ts)
- [005_messaging.sql](file://supabase/migrations/005_messaging.sql)
- [004_events_announcements.sql](file://supabase/migrations/004_events_announcements.sql)
- [007_rls_policies.sql](file://supabase/migrations/007_rls_policies.sql)
- [006_triggers.sql](file://supabase/migrations/006_triggers.sql)
- [008_governance_functions.sql](file://supabase/migrations/008_governance_functions.sql)
- [index.ts](file://mobile/src/types/index.ts)
- [auth.store.ts](file://mobile/src/stores/auth.store.ts)
- [authStore.ts](file://admin/src/store/authStore.ts)
- [DashboardPage.tsx](file://admin/src/pages/DashboardPage.tsx)
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
This document describes the real-time communication platform built with a cross-platform mobile application, a React-based admin panel, and a Supabase-powered backend. It focuses on the messaging system architecture (conversation management, message threading, presence detection), the announcement system for institutional communications, event registration and calendar integration, and notification mechanisms. It also covers real-time features via Supabase Realtime, offline-aware workflows, push notification integration, user blocking mechanisms, and content moderation features, including the integration between mobile messaging and admin moderation tools.

## Project Structure
The platform consists of three primary areas:
- Mobile application (React Native with Expo) for messaging, events, announcements, and profile management
- Admin panel (React with Vite) for dashboard, user management, content moderation, and analytics
- Supabase backend (PostgreSQL) with row-level security, triggers, stored functions, and publication-based real-time

```mermaid
graph TB
subgraph "Mobile App"
M_API["Supabase Client<br/>client.ts"]
M_AUTH["Auth Store<br/>auth.store.ts"]
M_TYPES["Types & Permissions<br/>types/index.ts"]
end
subgraph "Admin Panel"
A_LIB["Supabase Client<br/>supabase.ts"]
A_AUTH["Auth Store<br/>authStore.ts"]
A_DASH["Dashboard<br/>DashboardPage.tsx"]
end
subgraph "Supabase Backend"
DB["PostgreSQL Database"]
RT["Realtime Publication"]
RL["Row-Level Security"]
TR["Triggers & Functions"]
end
M_API --> DB
A_LIB --> DB
M_API --> RT
A_LIB --> RT
DB --> RL
DB --> TR
```

**Diagram sources**
- [client.ts](file://mobile/src/api/supabase/client.ts#L15-L27)
- [supabase.ts](file://admin/src/lib/supabase.ts#L10-L18)
- [007_rls_policies.sql](file://supabase/migrations/007_rls_policies.sql#L9-L36)
- [008_governance_functions.sql](file://supabase/migrations/008_governance_functions.sql#L498-L510)

**Section sources**
- [README.md](file://README.md#L1-L14)
- [client.ts](file://mobile/src/api/supabase/client.ts#L1-L87)
- [supabase.ts](file://admin/src/lib/supabase.ts#L1-L73)

## Core Components
- Real-time messaging: conversations, participants, messages, read receipts, typing indicators, muted users, message reports, and profanity filters
- Announcements and events: lifecycle, targeting, scheduling, visibility, and engagement metrics
- Presence and notifications: push tokens and presence records
- Governance and moderation: role hierarchy, ban/suspend/mute functions, reporting, and audit logging
- Authentication and permissions: institutional email validation, registration binding, and role-based access control

**Section sources**
- [005_messaging.sql](file://supabase/migrations/005_messaging.sql#L9-L321)
- [004_events_announcements.sql](file://supabase/migrations/004_events_announcements.sql#L9-L262)
- [007_rls_policies.sql](file://supabase/migrations/007_rls_policies.sql#L42-L510)
- [006_triggers.sql](file://supabase/migrations/006_triggers.sql#L9-L154)
- [008_governance_functions.sql](file://supabase/migrations/008_governance_functions.sql#L9-L284)
- [index.ts](file://mobile/src/types/index.ts#L1-L456)

## Architecture Overview
The system leverages Supabase for authentication, database, storage, and real-time subscriptions. The mobile app and admin panel share the same Supabase project and rely on RLS policies to enforce access control. Real-time updates are enabled for messaging, announcements, and events via the supabase_realtime publication.

```mermaid
graph TB
subgraph "Clients"
MOBILE["Mobile App"]
ADMIN["Admin Panel"]
end
subgraph "Supabase"
AUTH["Auth"]
DB["PostgreSQL"]
RT["Realtime"]
ST["Storage"]
end
MOBILE --> AUTH
ADMIN --> AUTH
MOBILE --> DB
ADMIN --> DB
DB --> RT
DB --> ST
RT --> MOBILE
RT --> ADMIN
```

**Diagram sources**
- [client.ts](file://mobile/src/api/supabase/client.ts#L15-L27)
- [supabase.ts](file://admin/src/lib/supabase.ts#L10-L18)
- [008_governance_functions.sql](file://supabase/migrations/008_governance_functions.sql#L498-L510)

## Detailed Component Analysis

### Messaging System Architecture
The messaging system centers around conversations, participants, and messages with threading and moderation support. Real-time updates are delivered via Supabase Realtime, and presence-related signals (typing indicators) are tracked.

```mermaid
erDiagram
CONVERSATIONS {
uuid id PK
boolean is_direct
varchar name
text avatar_url
text description
uuid created_by FK
enum level
boolean is_level_group
boolean is_general
boolean is_active
timestamptz last_message_at
timestamptz created_at
timestamptz updated_at
}
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
uuid deleted_by FK
varchar system_action
jsonb system_data
boolean is_flagged
text flagged_reason
uuid flagged_by FK
timestamptz flagged_at
timestamptz created_at
}
MESSAGE_READ_RECEIPTS {
uuid id PK
uuid message_id FK
uuid user_id FK
enum status
timestamptz read_at
timestamptz created_at
}
TYPING_INDICATORS {
uuid id PK
uuid conversation_id FK
uuid user_id FK
boolean is_typing
timestamptz updated_at
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
MESSAGE_REPORTS {
uuid id PK
uuid message_id FK
uuid reported_by FK
text reason
varchar category
varchar status
uuid reviewed_by FK
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
uuid created_by FK
timestamptz created_at
}
CONVERSATIONS ||--o{ CONVERSATION_PARTICIPANTS : "has"
CONVERSATIONS ||--o{ MESSAGES : "contains"
MESSAGES ||--o{ MESSAGE_READ_RECEIPTS : "has"
CONVERSATIONS ||--o{ TYPING_INDICATORS : "tracked_in"
USERS ||--o{ CONVERSATION_PARTICIPANTS : "participates_as"
USERS ||--o{ MESSAGES : "sends"
USERS ||--o{ MESSAGES : "flags"
USERS ||--o{ MESSAGE_REPORTS : "reports"
USERS ||--o{ MESSAGES : "deletes"
USERS ||--o{ MUTED_USERS : "mutes"
```

**Diagram sources**
- [005_messaging.sql](file://supabase/migrations/005_messaging.sql#L9-L321)

#### Real-time Subscriptions and Presence
- Realtime channels are created per conversation and broadcast message inserts, updates, and deletions.
- Typing indicators track who is currently typing in a conversation.
- Presence records capture user activity for presence-aware features.

```mermaid
sequenceDiagram
participant Client as "Mobile Client"
participant Supabase as "Supabase Realtime"
participant DB as "PostgreSQL"
Client->>Supabase : "subscribe(conversation_id)"
Supabase->>DB : "listen to messages, typing_indicators"
DB-->>Supabase : "insert/update/delete on messages"
Supabase-->>Client : "realtime event {new, updated, deleted}"
Client->>Supabase : "publish typing indicator"
Supabase-->>Client : "broadcast typing updates"
```

**Diagram sources**
- [client.ts](file://mobile/src/api/supabase/client.ts#L29-L32)
- [005_messaging.sql](file://supabase/migrations/005_messaging.sql#L176-L191)
- [008_governance_functions.sql](file://supabase/migrations/008_governance_functions.sql#L498-L510)

#### Conversation Management Workflows
- Creating a conversation (direct or group) and adding participants
- Managing unread counts and last message timestamps
- Enforcing mute and notification preferences per participant

```mermaid
flowchart TD
Start(["Create Conversation"]) --> Type{"Direct or Group?"}
Type --> |Direct| CreateDM["Create DM with is_direct=true"]
Type --> |Group| CreateGroup["Create Group with name and settings"]
CreateDM --> AddParticipants["Add participants with joined_at"]
CreateGroup --> AddParticipants
AddParticipants --> UpdateUnread["Increment unread counts for others"]
UpdateUnread --> UpdateLastMsg["Update conversation last_message_at"]
UpdateLastMsg --> End(["Conversation Ready"])
```

**Diagram sources**
- [005_messaging.sql](file://supabase/migrations/005_messaging.sql#L9-L41)
- [005_messaging.sql](file://supabase/migrations/005_messaging.sql#L277-L321)

#### Message Threading and Replies
- Messages can reference another message via reply_to_id to form threads
- Deleted messages are marked soft-deleted with metadata
- System messages can annotate conversation events (e.g., user joined/left)

```mermaid
flowchart TD
NewMsg["New Message"] --> HasReply{"reply_to_id set?"}
HasReply --> |Yes| Thread["Attach to thread parent"]
HasReply --> |No| Standalone["Standalone message"]
Standalone --> Save["Insert into messages"]
Thread --> Save
Save --> SoftDelete{"Soft delete?"}
SoftDelete --> |Yes| MarkDeleted["Mark is_deleted and set deleted_at"]
SoftDelete --> |No| Active["Active message"]
MarkDeleted --> End(["End"])
Active --> End
```

**Diagram sources**
- [005_messaging.sql](file://supabase/migrations/005_messaging.sql#L89-L127)
- [005_messaging.sql](file://supabase/migrations/005_messaging.sql#L105-L117)

#### Presence Detection
- Typing indicators are maintained per conversation and user
- Cleanup functions remove stale typing indicators automatically

```mermaid
flowchart TD
Start(["User starts typing"]) --> SetTyping["Set typing_indicators.is_typing=true"]
SetTyping --> Broadcast["Broadcast typing event"]
Broadcast --> Wait["Wait for activity or timeout"]
Wait --> Clear["Clear typing indicator or timeout cleanup"]
Clear --> End(["Presence updated"])
```

**Diagram sources**
- [005_messaging.sql](file://supabase/migrations/005_messaging.sql#L176-L191)
- [008_governance_functions.sql](file://supabase/migrations/008_governance_functions.sql#L438-L449)

### Announcement System
Announcements support targeting, scheduling, publishing, pinning, and view tracking. Events include lifecycle management, capacity tracking, and registration workflows.

```mermaid
erDiagram
ANNOUNCEMENTS {
uuid id PK
uuid author_id FK
varchar title
text content
text cover_image_url
enum priority
user_role[] target_roles
academic_level[] target_levels
uuid target_department_id FK
boolean is_scheduled
timestamptz scheduled_for
boolean is_published
boolean is_pinned
integer view_count
timestamptz published_at
timestamptz expires_at
timestamptz created_at
timestamptz updated_at
}
ANNOUNCEMENT_VIEWS {
uuid id PK
uuid announcement_id FK
uuid user_id FK
timestamptz viewed_at
}
EVENTS {
uuid id PK
uuid created_by FK
varchar title
text description
text cover_image_url
date start_date
date end_date
time start_time
time end_time
varchar venue
boolean is_virtual
text virtual_link
integer max_attendees
integer current_attendees
enum status
boolean is_public
integer view_count
timestamptz published_at
timestamptz created_at
timestamptz updated_at
}
EVENT_REGISTRATIONS {
uuid id PK
uuid event_id FK
uuid user_id FK
timestamptz registered_at
boolean attended
timestamptz attended_at
varchar email
varchar phone
boolean is_cancelled
timestamptz cancelled_at
text cancel_reason
}
ANNOUNCEMENTS ||--o{ ANNOUNCEMENT_VIEWS : "viewed_by"
USERS ||--o{ ANNOUNCEMENTS : "authored"
USERS ||--o{ EVENTS : "created"
EVENTS ||--o{ EVENT_REGISTRATIONS : "registered_by"
```

**Diagram sources**
- [004_events_announcements.sql](file://supabase/migrations/004_events_announcements.sql#L105-L160)
- [004_events_announcements.sql](file://supabase/migrations/004_events_announcements.sql#L69-L100)
- [004_events_announcements.sql](file://supabase/migrations/004_events_announcements.sql#L9-L51)

### Notification Mechanisms
- Push tokens are stored per user and device, enabling targeted push notifications
- Tokens are associated with device metadata and push service identifiers
- Activity logs capture administrative actions for audit trails

```mermaid
erDiagram
PUSH_TOKENS {
uuid id PK
uuid user_id FK
text token UK
varchar device_type
varchar device_name
varchar device_id
varchar push_service
boolean is_active
timestamptz last_used_at
timestamptz created_at
timestamptz updated_at
}
ACTIVITY_LOGS {
uuid id PK
uuid user_id FK
varchar user_email
enum user_role
enum action
varchar entity_type
uuid entity_id
text description
jsonb metadata
inet ip_address
text user_agent
text request_path
varchar request_method
timestamptz created_at
}
USERS ||--o{ PUSH_TOKENS : "owns"
USERS ||--o{ ACTIVITY_LOGS : "involved_in"
```

**Diagram sources**
- [006_triggers.sql](file://supabase/migrations/006_triggers.sql#L261-L291)
- [006_triggers.sql](file://supabase/migrations/006_triggers.sql#L220-L255)

### Content Moderation and Governance
- Role hierarchy defines permissions for users, moderators, super admins, and system owners
- Functions handle role assignment, banning, suspending, muting, and unmute
- Message reports and profanity filters support automated and manual moderation
- Audit logging captures all significant actions

```mermaid
flowchart TD
Start(["Moderation Action"]) --> CheckRole{"Has sufficient role?"}
CheckRole --> |No| Deny["Deny action"]
CheckRole --> |Yes| Perform{"Action type"}
Perform --> Ban["Ban user"]
Perform --> Suspend["Suspend user until"]
Perform --> Mute["Mute messaging until/permanent"]
Perform --> Report["Resolve message report"]
Perform --> Profanity["Manage profanity filters"]
Ban --> Log["Log activity"]
Suspend --> Log
Mute --> Log
Report --> Log
Profanity --> Log
Log --> End(["Complete"])
```

**Diagram sources**
- [008_governance_functions.sql](file://supabase/migrations/008_governance_functions.sql#L9-L284)
- [007_rls_policies.sql](file://supabase/migrations/007_rls_policies.sql#L42-L88)
- [005_messaging.sql](file://supabase/migrations/005_messaging.sql#L224-L250)

### Authentication and Security
- Institutional email validation ensures only UMYU LIS students use student accounts
- Registration number validation binds academic identity to email
- Login attempts are validated against account status (active, banned, suspended)
- Row-level security enforces fine-grained access control across all tables
- Activity logs record user actions for auditability

```mermaid
sequenceDiagram
participant User as "User"
participant Auth as "Supabase Auth"
participant DB as "PostgreSQL"
participant Trig as "Triggers"
User->>Auth : "Sign in with email/password"
Auth->>DB : "Verify credentials"
DB->>Trig : "Validate login attempt"
Trig-->>DB : "Check status (active/banned/suspended)"
DB-->>Auth : "Session or error"
Auth-->>User : "Session established or blocked"
```

**Diagram sources**
- [auth.store.ts](file://mobile/src/stores/auth.store.ts#L99-L134)
- [006_triggers.sql](file://supabase/migrations/006_triggers.sql#L108-L154)
- [007_rls_policies.sql](file://supabase/migrations/007_rls_policies.sql#L94-L122)

### Admin Moderation Tools
- Dashboard displays system statistics and moderation alerts
- RPC function aggregates counts for users, content, messaging, engagement, and moderation
- Role-based access controls ensure only authorized users can manage content and users

```mermaid
sequenceDiagram
participant Admin as "Admin User"
participant AdminUI as "Admin Dashboard"
participant Supabase as "Supabase RPC"
participant DB as "PostgreSQL"
Admin->>AdminUI : "Open Dashboard"
AdminUI->>Supabase : "rpc get_system_stats()"
Supabase->>DB : "Execute function"
DB-->>Supabase : "JSON stats"
Supabase-->>AdminUI : "Stats payload"
AdminUI-->>Admin : "Render cards and alerts"
```

**Diagram sources**
- [DashboardPage.tsx](file://admin/src/pages/DashboardPage.tsx#L21-L31)
- [008_governance_functions.sql](file://supabase/migrations/008_governance_functions.sql#L290-L336)

**Section sources**
- [auth.store.ts](file://mobile/src/stores/auth.store.ts#L99-L134)
- [authStore.ts](file://admin/src/store/authStore.ts#L94-L172)
- [DashboardPage.tsx](file://admin/src/pages/DashboardPage.tsx#L21-L31)
- [006_triggers.sql](file://supabase/migrations/006_triggers.sql#L9-L154)
- [007_rls_policies.sql](file://supabase/migrations/007_rls_policies.sql#L314-L426)
- [008_governance_functions.sql](file://supabase/migrations/008_governance_functions.sql#L288-L336)

## Dependency Analysis
- Mobile and admin clients depend on shared Supabase configuration and environment variables
- Realtime subscriptions rely on the supabase_realtime publication being enabled for messaging and announcements
- RLS policies depend on helper functions to evaluate roles and statuses
- Governance functions encapsulate administrative operations and audit logging

```mermaid
graph TB
M_CLIENT["mobile/src/api/supabase/client.ts"]
A_CLIENT["admin/src/lib/supabase.ts"]
RLS["supabase/migrations/007_rls_policies.sql"]
TRIG["supabase/migrations/006_triggers.sql"]
FUNC["supabase/migrations/008_governance_functions.sql"]
M_CLIENT --> RLS
A_CLIENT --> RLS
RLS --> TRIG
RLS --> FUNC
FUNC --> TRIG
```

**Diagram sources**
- [client.ts](file://mobile/src/api/supabase/client.ts#L6-L27)
- [supabase.ts](file://admin/src/lib/supabase.ts#L3-L18)
- [007_rls_policies.sql](file://supabase/migrations/007_rls_policies.sql#L42-L88)
- [006_triggers.sql](file://supabase/migrations/006_triggers.sql#L108-L154)
- [008_governance_functions.sql](file://supabase/migrations/008_governance_functions.sql#L498-L510)

**Section sources**
- [client.ts](file://mobile/src/api/supabase/client.ts#L6-L27)
- [supabase.ts](file://admin/src/lib/supabase.ts#L3-L18)
- [007_rls_policies.sql](file://supabase/migrations/007_rls_policies.sql#L42-L88)
- [006_triggers.sql](file://supabase/migrations/006_triggers.sql#L108-L154)
- [008_governance_functions.sql](file://supabase/migrations/008_governance_functions.sql#L498-L510)

## Performance Considerations
- Realtime event rate limiting: the mobile client configures eventsPerSecond to control load
- Indexes on frequently queried columns (timestamps, foreign keys, flags) improve read performance
- Full-text search indexes support efficient content discovery
- Cleanup functions for typing indicators, rate limits, and expired sessions reduce storage overhead
- Use pagination and server-side filtering for large datasets (events, announcements, logs)

[No sources needed since this section provides general guidance]

## Troubleshooting Guide
Common issues and resolutions:
- Supabase environment variables missing: ensure EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY are set in the mobile app and VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in the admin panel
- Authentication failures: verify institutional email format and registration binding; check login attempt validation for banned/suspended/pending users
- Realtime not updating: confirm supabase_realtime publication includes messaging and announcements tables
- RLS access denied: review policy conditions and user roles; ensure user status is active
- Push notifications not received: validate push tokens are registered and active; confirm device metadata and push service identifiers

**Section sources**
- [client.ts](file://mobile/src/api/supabase/client.ts#L9-L13)
- [supabase.ts](file://admin/src/lib/supabase.ts#L6-L8)
- [auth.store.ts](file://mobile/src/stores/auth.store.ts#L104-L107)
- [006_triggers.sql](file://supabase/migrations/006_triggers.sql#L108-L154)
- [008_governance_functions.sql](file://supabase/migrations/008_governance_functions.sql#L498-L510)
- [007_rls_policies.sql](file://supabase/migrations/007_rls_policies.sql#L317-L335)

## Conclusion
The platform provides a robust, real-time communication ecosystem with strong governance, moderation, and user management capabilities. Supabase’s real-time, RLS, and stored functions enable scalable, secure, and auditable operations across mobile and admin interfaces. The architecture supports institutional identity binding, presence detection, event-driven announcements, and comprehensive moderation workflows.
# NALISS UMYU HUB

A modern cross-platform mobile application for Library and Information Science (LIS) students at UMYU. The system provides academic resources, real-time messaging, departmental information, and leadership transparency through a secure, identity-bound digital ecosystem.

## Project Structure

```
naliss-umyu-hub/
├── mobile/                    # React Native Expo App (iOS & Android)
├── admin/                     # React Web Admin Panel
├── supabase/                  # Database migrations
│   └── migrations/           # SQL migration files
└── docs/                      # Documentation
```

## Tech Stack

### Mobile App
- **React Native** with Expo (Managed Workflow)
- **Expo Router** for file-based navigation
- **Supabase** for backend (Database, Auth, Realtime, Storage)
- **Zustand** for client state management
- **React Query** for server state management
- **SQLite** for offline storage

### Admin Panel
- **React** with Vite
- **React Router** for navigation
- **Tailwind CSS** for styling
- **Supabase** for backend
- **Zustand** + **React Query** for state management

### Backend (Supabase)
- PostgreSQL database with Row-Level Security
- Authentication (Email/Password + Google OAuth)
- Real-time subscriptions for messaging
- Storage buckets for file uploads

## Features

### Authentication & Security
- Institutional email validation (blis/lis[digits]@students.umyu.edu.ng)
- Academic identity binding with registration number
- 4-tier role hierarchy (Student → Moderator → Super Admin → System Owner)
- Row-Level Security on all tables
- Automatic ban enforcement

### Mobile App Features
- Dashboard with announcements, events, courses
- Mini-LMS with offline support
- Real-time messaging with presence
- Event registration and calendar
- Profile management
- Push notifications

### Admin Panel Features
- Dashboard with system statistics
- Student management (view, ban, assign roles)
- Content management (announcements, events, materials)
- Messaging moderation
- Lecturer & executive profiles
- Activity logs and audit trail
- System settings (System Owner only)

## Getting Started

### Prerequisites
- Node.js 18+
- npm or yarn
- Expo CLI (`npm install -g expo-cli`)
- Supabase account

### 1. Supabase Setup

1. Create a new Supabase project at [supabase.com](https://supabase.com)
2. Go to SQL Editor and run migrations in order:
   ```
   supabase/migrations/001_enums.sql
   supabase/migrations/002_core_tables.sql
   supabase/migrations/003_lms_tables.sql
   supabase/migrations/004_events_announcements.sql
   supabase/migrations/005_messaging.sql
   supabase/migrations/006_triggers.sql
   supabase/migrations/007_rls_policies.sql
   supabase/migrations/008_governance_functions.sql
   supabase/migrations/009_storage_policies.sql
   ```
3. Create storage buckets:
   - `avatars`
   - `materials`
   - `event-covers`
   - `announcement-media`
   - `message-attachments`
4. Configure Google OAuth (optional) in Authentication → Providers
5. Get your project URL and anon key from Settings → API

### 2. Mobile App Setup

```bash
cd mobile

# Install dependencies
npm install

# Create .env file
cp .env.example .env

# Edit .env with your Supabase credentials
# EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
# EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key

# Start development server
npx expo start
```

### 3. Admin Panel Setup

```bash
cd admin

# Install dependencies
npm install

# Create .env file
cp .env.example .env

# Edit .env with your Supabase credentials
# VITE_SUPABASE_URL=https://your-project.supabase.co
# VITE_SUPABASE_ANON_KEY=your-anon-key

# Start development server
npm run dev
```

### 4. Create First Admin User

After setting up, you need to create the first System Owner:

1. Register a user through the mobile app
2. In Supabase SQL Editor, run:
   ```sql
   SELECT promote_initial_system_owner('user-uuid-here');
   ```

## Database Schema

### Core Tables
- `users` - Extended user profiles with role and status
- `departments` - Department information
- `lecturers` - Lecturer directory
- `executives` - Student leadership

### LMS Tables
- `levels` - Academic levels (100-500)
- `semesters` - Semester definitions
- `courses` - Course catalog
- `materials` - Academic resources
- `user_progress` - Progress tracking

### Communication Tables
- `conversations` - Chat rooms
- `messages` - Chat messages
- `announcements` - System announcements
- `events` - Events management

### Governance Tables
- `activity_logs` - Audit trail
- `push_tokens` - Notification tokens
- `system_settings` - Configuration

## Role Hierarchy

| Role | Level | Permissions |
|------|-------|-------------|
| Student | 1 | View content, send messages |
| Moderator | 2 | Content moderation, announcements |
| Super Admin | 3 | User management, full content access |
| System Owner | 4 | Admin management, system settings |

## Security Features

- **Email Validation**: Only `blis/lis[digits]@students.umyu.edu.ng` emails allowed
- **Registration Binding**: Cross-validation with email suffix
- **Ban Enforcement**: Automatic access revocation
- **RLS Policies**: Row-level security on all tables
- **Audit Logging**: All admin actions logged

## Building for Production

### Mobile App

```bash
cd mobile

# Configure EAS
eas build:configure

# Build for Android
eas build --platform android

# Build for iOS
eas build --platform ios
```

### Admin Panel

```bash
cd admin

# Build for production
npm run build

# Deploy to Vercel
vercel --prod
```

## Environment Variables

### Mobile App (.env)
```
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
EXPO_PUBLIC_APP_ENV=production
```

### Admin Panel (.env)
```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## License

This project is proprietary software for NALISS UMYU.

## Support

For support, contact the development team or create an issue in the repository.

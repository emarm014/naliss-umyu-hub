# Getting Started

<cite>
**Referenced Files in This Document**
- [README.md](file://README.md)
- [mobile/package.json](file://mobile/package.json)
- [admin/package.json](file://admin/package.json)
- [mobile/.env.example](file://mobile/.env.example)
- [admin/.env.example](file://admin/.env.example)
- [mobile/app.json](file://mobile/app.json)
- [admin/vite.config.ts](file://admin/vite.config.ts)
- [mobile/src/api/supabase/client.ts](file://mobile/src/api/supabase/client.ts)
- [admin/src/lib/supabase.ts](file://admin/src/lib/supabase.ts)
- [mobile/src/stores/auth.store.ts](file://mobile/src/stores/auth.store.ts)
- [admin/src/store/authStore.ts](file://admin/src/store/authStore.ts)
- [supabase/migrations/001_enums.sql](file://supabase/migrations/001_enums.sql)
- [supabase/migrations/002_core_tables.sql](file://supabase/migrations/002_core_tables.sql)
</cite>

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Supabase Setup](#supabase-setup)
4. [Mobile Application Setup](#mobile-application-setup)
5. [Admin Panel Setup](#admin-panel-setup)
6. [Initial Project Setup](#initial-project-setup)
7. [Supabase Migration Process](#supabase-migration-process)
8. [Storage Buckets Configuration](#storage-buckets-configuration)
9. [Google OAuth Configuration](#google-oauth-configuration)
10. [Creating the First Admin User](#creating-the-first-admin-user)
11. [Environment Variables](#environment-variables)
12. [Verification Steps](#verification-steps)
13. [Troubleshooting Guide](#troubleshooting-guide)
14. [Conclusion](#conclusion)

## Introduction
This guide provides comprehensive instructions to set up the Naliss UMYU Hub platform, covering both the mobile application and admin panel. It includes prerequisites, environment setup with Supabase configuration, step-by-step installation instructions, initial project setup, migration process, storage bucket creation, Google OAuth configuration, creating the first admin user, and verification steps to ensure proper installation.

## Prerequisites
Before installing Naliss UMYU Hub, ensure your development environment meets the following requirements:
- Node.js 18 or later
- npm or yarn package manager
- Expo CLI installed globally (`npm install -g expo-cli`)
- A Supabase account for backend services

These prerequisites are essential for running both the mobile app and admin panel locally.

**Section sources**
- [README.md](file://README.md#L67-L72)

## Supabase Setup
Follow these steps to configure your Supabase project:
1. Create a new Supabase project at [supabase.com](https://supabase.com)
2. Navigate to the SQL Editor and run the migration files in the exact order listed below:
   - `supabase/migrations/001_enums.sql`
   - `supabase/migrations/002_core_tables.sql`
   - `supabase/migrations/003_lms_tables.sql`
   - `supabase/migrations/004_events_announcements.sql`
   - `supabase/migrations/005_messaging.sql`
   - `supabase/migrations/006_triggers.sql`
   - `supabase/migrations/007_rls_policies.sql`
   - `supabase/migrations/008_governance_functions.sql`
   - `supabase/migrations/009_storage_policies.sql`
3. Create the following storage buckets:
   - `avatars`
   - `materials`
   - `event-covers`
   - `announcement-media`
   - `message-attachments`
4. Configure Google OAuth (optional) under Authentication → Providers
5. Retrieve your project URL and anon key from Settings → API

These steps establish the database schema, policies, triggers, and storage infrastructure required by the platform.

**Section sources**
- [README.md](file://README.md#L73-L96)

## Mobile Application Setup
Set up the mobile application with the following commands:
```bash
cd mobile
npm install
cp .env.example .env
# Edit .env with your Supabase credentials
npx expo start
```
- Install dependencies using npm
- Copy the example environment file to `.env`
- Add your Supabase URL and anon key to the `.env` file
- Start the development server using Expo

The mobile app uses Expo Router for navigation and integrates with Supabase for authentication, real-time updates, and storage.

**Section sources**
- [README.md](file://README.md#L97-L114)
- [mobile/package.json](file://mobile/package.json#L1-L40)
- [mobile/.env.example](file://mobile/.env.example#L1-L12)

## Admin Panel Setup
Set up the admin panel with the following commands:
```bash
cd admin
npm install
cp .env.example .env
# Edit .env with your Supabase credentials
npm run dev
```
- Install dependencies using npm
- Copy the example environment file to `.env`
- Add your Supabase URL and anon key to the `.env` file
- Start the development server using Vite

The admin panel uses React Router for navigation and Tailwind CSS for styling, integrating with Supabase for data management and authentication.

**Section sources**
- [README.md](file://README.md#L116-L133)
- [admin/package.json](file://admin/package.json#L1-L43)
- [admin/.env.example](file://admin/.env.example#L1-L4)
- [admin/vite.config.ts](file://admin/vite.config.ts#L1-L8)

## Initial Project Setup
After completing the Supabase setup and local environment configuration:
1. Confirm that both the mobile app and admin panel can connect to your Supabase project
2. Verify that the storage buckets are created and accessible
3. Test authentication flows for both platforms
4. Ensure environment variables are correctly configured in both projects

This ensures that all components are ready for development and testing.

**Section sources**
- [README.md](file://README.md#L65-L72)

## Supabase Migration Process
The migration process establishes the database schema and policies required by the platform. Run the migration files in the specified order to create:
- Custom ENUM types for roles, statuses, academic levels, and content types
- Core tables for departments, users, lecturers, and executives
- LMS tables for courses and materials
- Messaging tables for conversations and messages
- Triggers and RLS policies for row-level security
- Governance functions and storage policies

This structured approach ensures a consistent and secure foundation for the application.

**Section sources**
- [README.md](file://README.md#L76-L87)
- [supabase/migrations/001_enums.sql](file://supabase/migrations/001_enums.sql#L1-L167)
- [supabase/migrations/002_core_tables.sql](file://supabase/migrations/002_core_tables.sql#L1-L252)

## Storage Buckets Configuration
Create the following storage buckets in your Supabase project:
- `avatars`: For user profile pictures
- `materials`: For academic resources
- `event-covers`: For event cover images
- `announcement-media`: For announcement media
- `message-attachments`: For message attachments

These buckets enable file uploads and retrieval across the mobile app and admin panel, supporting rich content management.

**Section sources**
- [README.md](file://README.md#L88-L94)

## Google OAuth Configuration
Configure Google OAuth (optional) in the Supabase dashboard under Authentication → Providers. After enabling Google OAuth, update the mobile app environment variables with the appropriate client IDs:
- `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`
- `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`
- `EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID`

These values allow users to sign in via Google within the mobile application.

**Section sources**
- [README.md](file://README.md#L94-L96)
- [mobile/.env.example](file://mobile/.env.example#L8-L12)

## Creating the First Admin User
To establish the initial administrative access:
1. Register a user through the mobile app
2. In the Supabase SQL Editor, run the following function with the user's UUID:
   ```sql
   SELECT promote_initial_system_owner('user-uuid-here');
   ```

This grants the user the highest administrative role, enabling full system management capabilities.

**Section sources**
- [README.md](file://README.md#L135-L144)

## Environment Variables
Configure environment variables for both applications:

Mobile App (.env):
- `EXPO_PUBLIC_SUPABASE_URL`: Supabase project URL
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`: Supabase anon key
- `EXPO_PUBLIC_APP_ENV`: Application environment (development/production)
- Optional Google OAuth client IDs

Admin Panel (.env):
- `VITE_SUPABASE_URL`: Supabase project URL
- `VITE_SUPABASE_ANON_KEY`: Supabase anon key

These variables enable secure and flexible configuration across environments.

**Section sources**
- [README.md](file://README.md#L217-L231)
- [mobile/.env.example](file://mobile/.env.example#L1-L12)
- [admin/.env.example](file://admin/.env.example#L1-L4)

## Verification Steps
Perform the following checks to confirm a successful installation:
- Mobile App
  - Launch the app and verify it connects to Supabase
  - Test authentication with email/password and Google OAuth (if configured)
  - Upload and retrieve files from storage buckets
  - Access real-time messaging features
- Admin Panel
  - Start the development server and open the browser
  - Log in with admin credentials
  - Navigate to dashboard and verify data loading
  - Test content management features

These steps ensure all components are functioning as expected.

**Section sources**
- [mobile/src/api/supabase/client.ts](file://mobile/src/api/supabase/client.ts#L1-L87)
- [admin/src/lib/supabase.ts](file://admin/src/lib/supabase.ts#L1-L73)
- [mobile/src/stores/auth.store.ts](file://mobile/src/stores/auth.store.ts#L1-L302)
- [admin/src/store/authStore.ts](file://admin/src/store/authStore.ts#L1-L228)

## Troubleshooting Guide
Common setup issues and solutions:
- Missing Supabase Credentials
  - Symptom: Application fails to connect to backend
  - Solution: Ensure `.env` files contain valid Supabase URL and anon key
- Authentication Failures
  - Symptom: Login attempts fail or redirect incorrectly
  - Solution: Verify email format and Google OAuth configuration; check redirect URIs
- Storage Upload Issues
  - Symptom: File uploads fail or return errors
  - Solution: Confirm storage bucket names match those defined in the code; verify permissions
- Environment Variable Errors
  - Symptom: Build errors related to missing environment variables
  - Solution: Double-check variable names and values; ensure they match the expected format for each platform
- Database Migration Errors
  - Symptom: Schema inconsistencies or missing tables
  - Solution: Re-run migrations in the correct order; verify each migration completes successfully

**Section sources**
- [mobile/src/api/supabase/client.ts](file://mobile/src/api/supabase/client.ts#L9-L13)
- [admin/src/lib/supabase.ts](file://admin/src/lib/supabase.ts#L6-L18)
- [mobile/src/stores/auth.store.ts](file://mobile/src/stores/auth.store.ts#L104-L107)
- [mobile/src/stores/auth.store.ts](file://mobile/src/stores/auth.store.ts#L141-L150)

## Conclusion
You have successfully configured the Naliss UMYU Hub platform for both mobile and admin environments. By following the steps outlined above—setting up Supabase, configuring environment variables, running migrations, creating storage buckets, and establishing the first admin user—you are ready to develop and deploy features for the UMYU LIS community. For ongoing development, refer to the project's tech stack and feature documentation included in the repository.
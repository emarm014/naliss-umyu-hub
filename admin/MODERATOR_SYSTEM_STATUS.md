# Moderator System - Current Status & Required Fixes

## Date: May 7, 2026

---

## What's Already Working ✅

### 1. **Level-Based Access Control**
- Moderators are assigned a specific level (100, 200, 300, or 400)
- All content pages automatically filter to show only the moderator's assigned level
- Students page shows only students from the moderator's level
- Storage page shows only files from the moderator's level

### 2. **Permission-Based Page Access**
- Moderators with `can_manage_announcements` permission can access:
  - `/announcements` page
  - `/events` page
- Moderators with `can_manage_materials` permission can access:
  - `/materials` page
  - `/past-questions` page
- Moderators with `can_manage_students` permission can:
  - View/verify/manage students in their level

### 3. **Course Dropdown Filtering**
- When adding materials or past questions, moderators only see courses for their assigned level
- Course selection is automatically filtered by level + semester

### 4. **Storage Management**
- Storage page shows breakdown by type (materials, past questions, announcements, events, chat media, avatars)
- Moderators can only see and delete files from their assigned level
- Super admins see all levels

### 5. **Group Management (Partial)**
- Moderators can see the level group for their assigned level
- Moderators can view members and add/remove members
- Group members list is filtered to show only students from the moderator's level

---

## What Needs to Be Fixed ❌

### 1. **Cloud Archive Access (REMOVE)**
**Current:** Moderators can access `/resources` (Cloud Archive) page
**Required:** Moderators should have NO access to Cloud Archive
**Fix:** Remove Cloud Archive from moderator navigation and routing

### 2. **Group Editing Restrictions**
**Current:** Moderators can edit group name, description, avatar, and delete groups
**Required:** Moderators can only:
- View group details
- Add/remove members from their level
- Cannot edit group name, description, avatar
- Cannot delete groups
- Cannot toggle chat_enabled
- Cannot assign/remove moderators

**Fix:** Add role checks in GroupsPage to disable edit/delete buttons for moderators

### 3. **Group Creation Restrictions**
**Current:** Moderators can create any type of group
**Required:** Moderators can create groups but:
- Can only add members from their assigned level
- Cannot create "level" type groups (those are system-managed)
- Can only create "department" or custom groups

**Fix:** Restrict group creation form for moderators

### 4. **Student Management Restrictions**
**Current:** Moderators can see students from their level
**Required:** Moderators should be able to:
- View students from their level
- Verify pending students
- Ban/suspend students (if `can_manage_students` permission is enabled)
- Cannot promote students to moderator
- Cannot delete students
- Cannot edit student level (would move them out of moderator's scope)

**Fix:** Add permission checks in StudentsPage for moderator-restricted actions

---

## Permission Matrix

| Permission Flag | Pages Accessible | Actions Allowed |
|----------------|------------------|-----------------|
| `can_manage_announcements` | Announcements, Events | Create/edit/delete/publish announcements and events for assigned level |
| `can_manage_materials` | Materials, Past Questions | Upload/edit/delete materials and past questions for assigned level |
| `can_manage_students` | Students | View/verify/ban/suspend students in assigned level |
| `can_manage_lecturers` | ❌ Not accessible to moderators | Super admin only |
| `can_manage_executives` | ❌ Not accessible to moderators | Super admin only |

---

## Routing Structure

### Super Admin Only
- `/` - Dashboard
- `/graduates` - Graduates management
- `/settings` - System settings
- `/analytics` - Analytics dashboard
- `/logs` - Activity logs
- `/courses` - Course management
- `/lecturers` - Lecturer directory
- `/executives` - Executive management

### Moderator + Super Admin
- `/students` - Student management (filtered by level for moderators)
- `/announcements` - Announcements (requires `can_manage_announcements`)
- `/events` - Events (requires `can_manage_announcements`)
- `/materials` - Materials (requires `can_manage_materials`)
- `/past-questions` - Past Questions (requires `can_manage_materials`)
- `/groups` - Group management (level-filtered for moderators)
- `/group-media` - Group media viewer
- `/storage` - Storage management (level-filtered for moderators)
- `/messaging` - Messaging interface

### Should Be Removed from Moderators
- `/resources` - Cloud Archive (currently accessible, should be super admin only)

---

## Database Tables & Level Filtering

### Tables with Level Filtering for Moderators

1. **users** - `level` field
   - Moderators see only students where `level = assigned_level`

2. **materials** - `level` field
   - Moderators see/manage only materials where `level = assigned_level`

3. **past_questions** - `level` field
   - Moderators see/manage only past questions where `level = assigned_level`

4. **announcements** - `target_level` field
   - Moderators see/manage only announcements where `target_level = assigned_level` OR `target_level IS NULL` (all levels)

5. **events** - `target_level` field
   - Moderators see/manage only events where `target_level = assigned_level` OR `target_level IS NULL`

6. **courses** - `level` field
   - Moderators see only courses where `level = assigned_level` (read-only in dropdowns)

7. **groups** - `level` field (for level-type groups)
   - Moderators see only the level group where `level = assigned_level`

8. **group_members** - filtered by group's level
   - When adding members, moderators only see students from their assigned level

---

## Recommended Fixes (Priority Order)

### High Priority
1. ✅ **Remove Cloud Archive access from moderators**
   - Update `App.tsx` routing to require `super_admin` role for `/resources`
   - Remove "Cloud Archive" from Sidebar for moderators

2. ✅ **Restrict group editing for moderators**
   - Disable edit/delete buttons in GroupsPage for moderators
   - Show read-only view of group details
   - Allow only member add/remove

3. ✅ **Restrict student management actions**
   - Disable "Promote to Moderator" button for moderators
   - Disable "Delete Student" button for moderators
   - Disable level editing for moderators

### Medium Priority
4. ✅ **Restrict group creation**
   - Prevent moderators from creating "level" type groups
   - Filter member selection to assigned level only

5. ✅ **Add permission checks to all action buttons**
   - Verify moderator permissions before showing edit/delete buttons
   - Show appropriate error messages when actions are restricted

### Low Priority
6. **Add moderator activity logging**
   - Log all moderator actions to activity_logs table
   - Track what content moderators create/edit/delete

7. **Add moderator dashboard**
   - Create a simple dashboard for moderators showing their level's stats
   - Quick links to common tasks

---

## Testing Checklist

### For Moderators with Level 200 Assignment

- [ ] Can access Announcements page (if permission enabled)
- [ ] Can create announcement for Level 200
- [ ] Cannot see announcements for other levels
- [ ] Can access Materials page (if permission enabled)
- [ ] Can upload material for Level 200 courses only
- [ ] Cannot see materials for other levels
- [ ] Can access Students page
- [ ] Can see only Level 200 students
- [ ] Cannot promote students to moderator
- [ ] Cannot delete students
- [ ] Can access Groups page
- [ ] Can see only Level 200 group
- [ ] Can add/remove members from Level 200 only
- [ ] Cannot edit group name/description
- [ ] Cannot delete group
- [ ] Cannot access Cloud Archive
- [ ] Cannot access Dashboard
- [ ] Cannot access Analytics
- [ ] Cannot access Settings
- [ ] Cannot access Courses management
- [ ] Cannot access Lecturers
- [ ] Cannot access Executives
- [ ] Cannot access Graduates

---

## Implementation Notes

All fixes should maintain the existing level-filtering logic:

```typescript
const assignedLevel = profile?.role === 'moderator' ? permissions?.assigned_level : null;

// In queries:
if (assignedLevel) {
  query = query.eq('level', assignedLevel);
}

// In UI filters:
const filteredData = data.filter(item => {
  if (assignedLevel) return item.level === assignedLevel;
  return true; // super_admin sees all
});
```

All permission checks should follow this pattern:

```typescript
const canEdit = profile?.role === 'super_admin' || 
  (profile?.role === 'moderator' && permissions?.can_manage_materials);

const canDelete = profile?.role === 'super_admin'; // moderators cannot delete
```

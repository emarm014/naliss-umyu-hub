// User Role Types
export type UserRole = 'student' | 'moderator' | 'super_admin';

// Account Status Types
export type AccountStatus = 'active' | 'suspended' | 'banned' | 'pending_verification' | 'pending_onboarding' | 'graduated';

// Academic Level Types
export type AcademicLevel = '100' | '200' | '300' | '400' | '500' | 'postgraduate';

// Semester Types
export type SemesterType = 'first' | 'second' | 'summer';

// Event Status Types
export type EventStatus = 'draft' | 'published' | 'ongoing' | 'completed' | 'cancelled';

// Material Types
export type MaterialType = 'note' | 'assignment' | 'video' | 'link' | 'document';

// Announcement Priority Types
export type AnnouncementPriority = 'low' | 'normal' | 'high' | 'urgent';

// Message Status Types
export type MessageStatus = 'sent' | 'delivered' | 'read';

// Log Action Types
export type LogAction =
  | 'user.login'
  | 'user.logout'
  | 'user.register'
  | 'user.profile_update'
  | 'user.role_change'
  | 'user.ban'
  | 'user.unban'
  | 'user.suspend'
  | 'message.send'
  | 'message.delete'
  | 'material.upload'
  | 'material.delete'
  | 'material.update'
  | 'event.create'
  | 'event.update'
  | 'event.delete'
  | 'announcement.create'
  | 'announcement.update'
  | 'announcement.delete'
  | 'admin.impersonation_start'
  | 'admin.impersonation_end'
  | 'settings.change';

// User Profile Interface
export interface User {
  id: string;
  registration_number: string;
  email: string;
  full_name: string;
  display_name: string | null;
  avatar_url: string | null;
  phone: string | null;
  bio: string | null;
  username: string;
  role: UserRole;
  status: AccountStatus;
  department_id: string | null;
  level: AcademicLevel | null;
  email_verified_at: string | null;
  registration_verified_at: string | null;
  last_active_at: string | null;
  created_at: string;
  updated_at: string;
  banned_at: string | null;
  banned_reason: string | null;
  banned_by: string | null;
  suspended_until: string | null;
  notif_announcements: boolean;
  notif_events: boolean;
  notif_messages: boolean;
  notif_materials: boolean;
  push_token: string | null;
}

// Department Interface
export interface Department {
  id: string;
  name: string;
  code: string;
  description: string | null;
  logo_url: string | null;
  office_location: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// Lecturer Interface
export interface Lecturer {
  id: string;
  department_id: string;
  full_name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  avatar_url: string | null;
  position: string | null;
  specialization: string | null;
  office_location: string | null;
  office_hours: string | null;
  is_active: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
}

// Executive Interface
export interface Executive {
  id: string;
  user_id: string | null;
  full_name: string | null;
  avatar_url: string | null;
  department_id: string | null;
  position: string;
  position_code: string | null;
  academic_session: string;
  start_date: string | null;
  end_date: string | null;
  is_active: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
}

// Level Interface
export interface Level {
  id: string;
  level: AcademicLevel;
  display_name: string;
  description: string | null;
  display_order: number;
  is_active: boolean;
  created_at: string;
}

// Semester Interface
export interface Semester {
  id: string;
  level_id: string;
  semester: SemesterType;
  display_name: string;
  is_current: boolean;
  academic_session: string;
  start_date: string | null;
  end_date: string | null;
  is_active: boolean;
  created_at: string;
}

// Course Interface
export interface Course {
  id: string;
  code: string;
  title: string;
  description: string | null;
  level: AcademicLevel;
  semester: 'first' | 'second';
  credit_units: number;
  is_core: boolean;
  lecturer_name: string | null;
  is_active: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
}

// Material Interface
export interface Material {
  id: string;
  course_id: string | null;
  uploaded_by: string;
  title: string;
  description: string | null;
  material_type: MaterialType | string;
  level: AcademicLevel | null;
  semester: SemesterType | null;
  file_url: string | null;
  file_name: string | null;
  file_size: number | null;
  file_mime_type: string | null;
  external_url: string | null;
  video_duration: number | null;
  video_thumbnail_url: string | null;
  is_public: boolean;
  is_downloadable: boolean;
  view_count: number;
  download_count: number;
  is_active: boolean;
  is_featured: boolean;
  created_at: string;
  updated_at: string;
}

// Past Question Interface
export interface PastQuestion {
  id: string;
  course_id: string | null;
  uploaded_by: string;
  title: string;
  description: string | null;
  file_url: string | null;
  file_name: string | null;
  file_size: number | null;
  level: AcademicLevel | null;
  semester: SemesterType | null;
  is_public: boolean;
  is_downloadable: boolean;
  is_featured: boolean;
  view_count: number;
  download_count: number;
  created_at: string;
  updated_at: string;
  course?: Course | null;
}


// Event Interface
export interface Event {
  id: string;
  created_by: string;
  title: string;
  description: string | null;
  cover_image_url: string | null;
  start_date: string;
  end_date: string | null;
  start_time: string | null;
  end_time: string | null;
  venue: string | null;
  is_virtual: boolean;
  virtual_link: string | null;
  max_attendees: number | null;
  current_attendees: number;
  status: EventStatus;
  is_public: boolean;
  view_count: number;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

// Event Registration Interface
export interface EventRegistration {
  id: string;
  event_id: string;
  user_id: string;
  registered_at: string;
  attended: boolean;
  attended_at: string | null;
  email: string | null;
  phone: string | null;
  is_cancelled: boolean;
  cancelled_at: string | null;
}

// Announcement Interface
export interface Announcement {
  id: string;
  author_id: string;
  title: string;
  content: string;
  cover_image_url: string | null;
  priority: AnnouncementPriority;
  target_roles: UserRole[];
  target_department_id: string | null;
  is_scheduled: boolean;
  scheduled_for: string | null;
  is_published: boolean;
  is_pinned: boolean;
  view_count: number;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

// Conversation Interface
export interface Conversation {
  id: string;
  is_direct: boolean;
  name: string | null;
  created_by: string | null;
  avatar_url: string | null;
  description: string | null;
  is_active: boolean;
  last_message_at: string | null;
  created_at: string;
  updated_at: string;
}

// Conversation Participant Interface
export interface ConversationParticipant {
  id: string;
  conversation_id: string;
  user_id: string;
  joined_at: string;
  left_at: string | null;
  is_admin: boolean;
  last_read_at: string | null;
  unread_count: number;
  notifications_enabled: boolean;
}

// Message Interface
export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  content_type: string;
  attachment_url: string | null;
  attachment_name: string | null;
  attachment_size: number | null;
  attachment_mime_type: string | null;
  reply_to_id: string | null;
  is_edited: boolean;
  edited_at: string | null;
  is_deleted: boolean;
  deleted_at: string | null;
  system_action: string | null;
  system_data: Record<string, unknown> | null;
  created_at: string;
}

// Message Read Receipt Interface
export interface MessageReadReceipt {
  id: string;
  message_id: string;
  user_id: string;
  status: MessageStatus;
  read_at: string | null;
  created_at: string;
}

// Activity Log Interface
export interface ActivityLog {
  id: string;
  user_id: string | null;
  user_email: string | null;
  user_role: UserRole | null;
  action: LogAction;
  entity_type: string | null;
  entity_id: string | null;
  description: string;
  metadata: Record<string, unknown>;
  ip_address: string | null;
  user_agent: string | null;
  request_path: string | null;
  request_method: string | null;
  created_at: string;
}

// Push Token Interface
export interface PushToken {
  id: string;
  user_id: string;
  token: string;
  device_type: string;
  device_name: string | null;
  device_id: string | null;
  push_service: string;
  is_active: boolean;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}

// System Settings Interface
export interface SystemSettings {
  id: string;
  key: string;
  value: string;
  value_type: string;
  description: string | null;
  category: string | null;
  is_public: boolean;
  editable_by: UserRole[];
  created_at: string;
  updated_at: string;
}

// Auth Session Interface
export interface AuthSession {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  expires_at: number;
  token_type: string;
  user: {
    id: string;
    email: string;
    email_confirmed_at: string | null;
  };
}

// API Response Types
export interface ApiResponse<T> {
  data: T | null;
  error: {
    message: string;
    code?: string;
  } | null;
}

// Pagination Types
export interface PaginationParams {
  page: number;
  limit: number;
  offset?: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// Permission Types
export type Permission =
  | 'courses:view'
  | 'courses:create'
  | 'courses:edit'
  | 'courses:delete'
  | 'users:view'
  | 'users:manage'
  | 'users:role_change'
  | 'content:moderate'
  | 'content:delete'
  | 'messages:send'
  | 'announcements:create'
  | 'system:settings'
  | 'analytics:view';

// Role Permissions Map
export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  student: ['courses:view', 'messages:send'],
  moderator: [
    'courses:view',
    'messages:send',
    'content:moderate',
    'content:delete',
    'announcements:create',
  ],
  super_admin: [
    'courses:view',
    'courses:create',
    'courses:edit',
    'courses:delete',
    'users:view',
    'users:manage',
    'users:role_change',
    'content:moderate',
    'content:delete',
    'messages:send',
    'announcements:create',
    'system:settings',
    'analytics:view',
  ],
};

// Role Hierarchy Level
export const ROLE_LEVELS: Record<UserRole, number> = {
  student: 1,
  moderator: 2,
  super_admin: 3,
};

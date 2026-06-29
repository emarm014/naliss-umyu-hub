// User Role Types (System Owner removed - developer only, not in platform)
export type UserRole = 'student' | 'moderator' | 'super_admin';

// Account Status Types
export type AccountStatus = 'active' | 'suspended' | 'banned' | 'pending_verification' | 'pending_onboarding' | 'graduated';

// Maintenance Status
export type MaintenanceStatus = 'operational' | 'maintenance' | 'read_only';

// Academic Level Types (LIS Undergraduate only: 100-400)
export type AcademicLevel = '100' | '200' | '300' | '400';

// Semester Types
export type Semester = 'first' | 'second';

// Level Labels
export const LEVEL_LABELS: Record<AcademicLevel, string> = {
  '100': 'Level 100 (Freshman)',
  '200': 'Level 200 (Sophomore)',
  '300': 'Level 300 (Junior)',
  '400': 'Level 400 (Senior)',
};

// Semester Labels
export const SEMESTER_LABELS: Record<Semester, string> = {
  'first': 'First Semester',
  'second': 'Second Semester',
};

// Graduation Year mapping (current level -> graduation year)
export const GRADUATION_YEARS: Record<AcademicLevel, number> = {
  '400': 2026, // Current seniors graduate this year
  '300': 2027,
  '200': 2028,
  '100': 2029,
};

// User Profile Interface
export interface User {
  id: string;
  registration_number: string;
  email: string;
  full_name: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  phone: string | null;
  bio: string | null;
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
  suspension_reason: string | null;
  // Level 400 Senior Profile Fields
  senior_photo_url: string | null;
  motivational_advice: string | null;
  senior_bio: string | null;
  permissions?: {
    can_manage_announcements: boolean;
    can_manage_materials: boolean;
    can_manage_events: boolean;
    can_manage_past_questions: boolean;
    can_manage_lecturers: boolean;
    can_manage_executives: boolean;
    can_manage_students: boolean;
    can_manage_groups: boolean;
    can_manage_group_media: boolean;
    can_manage_news: boolean;
    can_manage_archives: boolean;
    can_manage_messaging: boolean;
    can_manage_courses: boolean;
    can_manage_graduates: boolean;
    can_manage_analytics: boolean;
    can_manage_logs: boolean;
    can_manage_settings: boolean;
    can_manage_storage: boolean;
    can_manage_security: boolean;
    can_manage_cloud_archive: boolean;
    assigned_level: AcademicLevel | null;
    is_restricted?: boolean;
  } | null;
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

// Course Interface (for specific level and semester)
export interface Course {
  id: string;
  code: string;
  title: string;
  description: string | null;
  level: AcademicLevel;
  semester: Semester;
  credit_units: number;
  is_core: boolean;
  lecturer_id: string | null;
  is_active: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
  lecturer?: { full_name: string; title: string | null } | null;
}

// Material Interface
export interface Material {
  id: string;
  course_id: string | null;
  uploaded_by: string;
  title: string;
  description: string | null;
  material_type: 'note' | 'assignment' | 'video' | 'link' | 'document' | 'pdf' | 'word' | 'ppt';
  level: AcademicLevel | null;
  semester: Semester | null;
  file_url: string | null;
  file_name: string | null;
  file_size: number | null;
  file_mime_type: string | null;
  is_public: boolean;
  is_downloadable: boolean;
  view_count: number;
  download_count: number;
  is_active: boolean;
  is_featured: boolean;
  created_at: string;
  updated_at: string;
  course?: Course | null;
}

export interface PastQuestion {
  id: string;
  title: string;
  description: string | null;
  course_id: string | null;
  file_url: string | null;
  file_name: string | null;
  file_size: number | null;
  file_mime_type: string | null;
  level: AcademicLevel | null;
  semester: Semester | null;
  uploaded_by: string;
  is_public: boolean;
  is_downloadable: boolean;
  is_featured: boolean;
  view_count: number;
  download_count: number;
  created_at: string;
  updated_at: string;
  course?: Course | null;
  uploader?: { full_name: string; email: string } | null;
}

// Global Cloud Resource Interface
export interface Resource {
  id: string;
  title: string;
  file_url: string;
  uploaded_by: string;
  created_at: string;
  file_size: number | null;
  file_type: string | null;
  category: string;
  uploader?: {
    full_name: string;
    email: string;
  } | null;
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
  target_level: AcademicLevel | null; // null = all levels/general
  status: 'draft' | 'published' | 'ongoing' | 'completed' | 'cancelled';
  is_public: boolean;
  view_count: number;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

// Announcement Interface
export interface Announcement {
  id: string;
  author_id: string;
  title: string;
  content: string;
  category: 'general' | 'academic' | 'social' | 'event';
  cover_image_url: string | null;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  target_level: AcademicLevel | null; // null = all levels/general
  is_scheduled: boolean;
  scheduled_for: string | null;
  is_published: boolean;
  is_pinned: boolean;
  view_count: number;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  author?: { full_name: string; email: string } | null;
}

// Activity Log Interface
export interface ActivityLog {
  id: string;
  user_id: string | null;
  user_email?: string | null;   // added via migration
  user_role?: string | null;    // added via migration
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  description: string;
  metadata: Record<string, unknown>;
  ip_address: string | null;
  user_agent?: string | null;   // added via migration
  request_path?: string | null; // added via migration
  request_method?: string | null; // added via migration
  created_at: string;
  user?: {
    full_name?: string;
    email?: string;
  } | null;
}

// System Stats Interface
export interface SystemStats {
  users: {
    total: number;
    active: number;
    banned: number;
    suspended: number;
    pending: number;
    graduated: number;
    by_role: Record<UserRole, number>;
    by_level: Record<string, number>;
  };
  content: {
    materials: number;
    past_questions: number;
    courses: number;
    events: number;
    announcements: number;
  };
  community: {
    groups: number;
    lecturers: number;
    executives: number;
    graduates: number;
    messages: number;
    conversations: number;
    media_messages: number;
    image_messages: number;
    video_messages: number;
    document_messages: number;
  };
  messaging: {
    conversations: number;
    messages: number;
    flagged_messages: number;
  };
  engagement: {
    event_registrations: number;
    material_views: number;
    material_downloads: number;
    announcement_views: number;
  };
  moderation: {
    muted_users: number;
    pending_reports: number;
  };
  storage: {
    total: number;
    resources: number;
    materials: number;
    past_questions: number;
    chat: number;
    backups: number;
  };
}

// Role Hierarchy Level
export const ROLE_LEVELS: Record<UserRole, number> = {
  student: 1,
  moderator: 2,
  super_admin: 3,
};

// Role Labels
export const ROLE_LABELS: Record<UserRole, string> = {
  student: 'Student',
  moderator: 'Moderator',
  super_admin: 'Super Admin',
};

// Status Labels
export const STATUS_LABELS: Record<AccountStatus, string> = {
  active: 'Active',
  suspended: 'Suspended',
  banned: 'Banned',
  pending_verification: 'Pending Verification',
  pending_onboarding: 'Pending Onboarding',
  graduated: 'Graduated',
};

// Status Colors
export const STATUS_COLORS: Record<AccountStatus, string> = {
  active: 'bg-green-100 text-green-800',
  suspended: 'bg-yellow-100 text-yellow-800',
  banned: 'bg-red-100 text-red-800',
  pending_verification: 'bg-gray-100 text-gray-800',
  pending_onboarding: 'bg-blue-100 text-blue-800',
  graduated: 'bg-indigo-100 text-indigo-800',
};

// Role Badge Colors
export const ROLE_BADGE_COLORS: Record<UserRole, string> = {
  student: 'bg-blue-100 text-blue-800',
  moderator: 'bg-green-100 text-green-800',
  super_admin: 'bg-purple-100 text-purple-800',
};

// Also export as ROLE_COLORS for backward compatibility or different usage
export const ROLE_COLORS = ROLE_BADGE_COLORS;

// Graduate Interface (for tracking graduated students)
export interface Graduate {
  id: string;
  user_id: string | null;
  full_name: string;
  registration_number: string;
  email: string;
  phone: string | null;
  graduation_year: number;
  avatar_url: string | null;
  current_occupation: string | null;
  current_organization: string | null;
  contact_email: string | null;
  linkedin_url: string | null;
  achievements: string | null;
  is_private: boolean;
  archived_at: string | null;
  created_at: string;
}

// Photo Gallery Interface
export interface Photo {
  id: string;
  entity_type: 'lecturer' | 'executive' | 'event';
  entity_id: string;
  url: string;
  caption: string | null;
  display_order: number;
  created_at: string;
}

// Lecturer Extended Interface with photos
export interface LecturerWithPhotos {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  office_location: string | null;
  avatar_url: string | null;
  bio: string | null;
  specialization: string | null;
  department_id: string | null;
  is_active: boolean;
  photos?: Photo[];
}

// Executive Extended Interface with photos
export interface ExecutiveWithPhotos {
  id: string;
  user_id: string | null;
  department_id: string | null;
  full_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  position: string;
  position_code: string | null;
  email: string | null;
  phone: string | null;
  social_links: Record<string, string>;
  is_active: boolean;
  photos?: Photo[];
}

// Group Types
export type GroupType = 'level' | 'department';

// Department Group Name
export const DEPARTMENT_GROUP_NAME = 'NALISS FAMILY UMYU';

// Group Interface
export interface Group {
  id: string;
  name: string;
  description: string | null;
  group_type: GroupType;
  level: AcademicLevel | null; // Only for level groups
  department_id: string | null;
  avatar_url: string | null;
  moderator_id: string | null;
  created_by?: string | null; // optional — added via migration
  is_active: boolean;
  is_official: boolean;
  chat_enabled: boolean;
  created_at: string;
  updated_at: string;
  member_count?: number;
  moderator?: User | null;
}

// Group Member Interface
export interface GroupMember {
  id: string;
  group_id: string;
  user_id: string;
  role: 'member' | 'moderator' | 'admin';
  joined_at: string;
  user?: User;
  group?: Group;
}

// Level Groups Configuration
export const LEVEL_GROUP_NAMES: Record<AcademicLevel, string> = {
  '100': 'LIS 100 level group',
  '200': 'LIS 200 level group',
  '300': 'LIS 300 level group',
  '400': 'LIS 400 level group',
};

// System Settings Interface
export interface SystemSettings {
  id: string;
  maintenance_mode: boolean;
  maintenance_message: string | null;
  read_only_mode: boolean;
  allow_registration: boolean;
  current_academic_year: string;
  updated_at: string;
  updated_by: string | null;
}

// Lecturer Interface (simplified for LIS only)
export interface Lecturer {
  id: string;
  full_name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  avatar_url: string | null;
  position: string | null;
  specialization: string | null;
  bio: string | null;
  qualifications: string | null;
  is_active: boolean;
  display_order: number;
  social_links?: Record<string, string>;
  created_at: string;
  photos?: Photo[];
}

// Executive Interface
export interface Executive {
  id: string;
  user_id: string | null;
  department_id: string | null;
  full_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  position: string;
  position_code: string | null;
  email: string | null;
  phone: string | null;
  social_links: Record<string, string>;
  academic_session: string;
  start_date: string | null;
  end_date: string | null;
  is_current: boolean;
  is_alumni?: boolean;
  display_order: number;
  is_active: boolean;
  created_at: string;
  department?: Department | null;
  linked_user?: User | null;
  photos?: Photo[];
}

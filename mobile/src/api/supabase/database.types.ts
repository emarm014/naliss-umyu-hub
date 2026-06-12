export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      activity_logs: {
        Row: {
          action: string
          created_at: string
          description: string | null
          entity_id: string | null
          entity_type: string | null
          id: string
          ip_address: string | null
          metadata: Json | null
          request_method: string | null
          request_path: string | null
          user_agent: string | null
          user_email: string | null
          user_id: string | null
          user_role: string | null
        }
        Insert: {
          action: string
          created_at?: string
          description?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: string | null
          metadata?: Json | null
          request_method?: string | null
          request_path?: string | null
          user_agent?: string | null
          user_email?: string | null
          user_id?: string | null
          user_role?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          description?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: string | null
          metadata?: Json | null
          request_method?: string | null
          request_path?: string | null
          user_agent?: string | null
          user_email?: string | null
          user_id?: string | null
          user_role?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activity_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      announcements: {
        Row: {
          author_id: string | null
          category: string | null
          content: string
          cover_image_size: number | null
          cover_image_url: string | null
          created_at: string
          id: string
          is_pinned: boolean | null
          is_published: boolean | null
          is_scheduled: boolean | null
          priority: string | null
          published_at: string | null
          scheduled_for: string | null
          target_level: string | null
          title: string
          updated_at: string
          view_count: number | null
        }
        Insert: {
          author_id?: string | null
          category?: string | null
          content: string
          cover_image_size?: number | null
          cover_image_url?: string | null
          created_at?: string
          id?: string
          is_pinned?: boolean | null
          is_published?: boolean | null
          is_scheduled?: boolean | null
          priority?: string | null
          published_at?: string | null
          scheduled_for?: string | null
          target_level?: string | null
          title: string
          updated_at?: string
          view_count?: number | null
        }
        Update: {
          author_id?: string | null
          category?: string | null
          content?: string
          cover_image_size?: number | null
          cover_image_url?: string | null
          created_at?: string
          id?: string
          is_pinned?: boolean | null
          is_published?: boolean | null
          is_scheduled?: boolean | null
          priority?: string | null
          published_at?: string | null
          scheduled_for?: string | null
          target_level?: string | null
          title?: string
          updated_at?: string
          view_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "announcements_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "announcements_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          created_at: string | null
          id: string
          is_direct: boolean | null
          name: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_direct?: boolean | null
          name?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          is_direct?: boolean | null
          name?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      courses: {
        Row: {
          code: string
          created_at: string | null
          credit_units: number | null
          department_id: string | null
          description: string | null
          display_order: number | null
          id: string
          is_active: boolean | null
          is_core: boolean | null
          lecturer_id: string | null
          level: string | null
          semester: string | null
          title: string
          updated_at: string | null
        }
        Insert: {
          code: string
          created_at?: string | null
          credit_units?: number | null
          department_id?: string | null
          description?: string | null
          display_order?: number | null
          id?: string
          is_active?: boolean | null
          is_core?: boolean | null
          lecturer_id?: string | null
          level?: string | null
          semester?: string | null
          title: string
          updated_at?: string | null
        }
        Update: {
          code?: string
          created_at?: string | null
          credit_units?: number | null
          department_id?: string | null
          description?: string | null
          display_order?: number | null
          id?: string
          is_active?: boolean | null
          is_core?: boolean | null
          lecturer_id?: string | null
          level?: string | null
          semester?: string | null
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "courses_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courses_lecturer_id_fkey"
            columns: ["lecturer_id"]
            isOneToOne: false
            referencedRelation: "lecturers"
            referencedColumns: ["id"]
          },
        ]
      }
      departments: {
        Row: {
          code: string
          contact_email: string | null
          contact_phone: string | null
          created_at: string
          description: string | null
          id: string
          is_active: boolean | null
          logo_url: string | null
          name: string
          office_location: string | null
          updated_at: string
        }
        Insert: {
          code: string
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean | null
          logo_url?: string | null
          name: string
          office_location?: string | null
          updated_at?: string
        }
        Update: {
          code?: string
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean | null
          logo_url?: string | null
          name?: string
          office_location?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      events: {
        Row: {
          cover_image_size: number | null
          cover_image_url: string | null
          created_at: string
          created_by: string | null
          current_attendees: number | null
          description: string | null
          end_date: string | null
          end_time: string | null
          id: string
          is_public: boolean | null
          is_virtual: boolean | null
          max_attendees: number | null
          published_at: string | null
          start_date: string
          start_time: string | null
          status: string | null
          target_level: string | null
          title: string
          updated_at: string
          venue: string | null
          view_count: number | null
          virtual_link: string | null
        }
        Insert: {
          cover_image_size?: number | null
          cover_image_url?: string | null
          created_at?: string
          created_by?: string | null
          current_attendees?: number | null
          description?: string | null
          end_date?: string | null
          end_time?: string | null
          id?: string
          is_public?: boolean | null
          is_virtual?: boolean | null
          max_attendees?: number | null
          published_at?: string | null
          start_date: string
          start_time?: string | null
          status?: string | null
          target_level?: string | null
          title: string
          updated_at?: string
          venue?: string | null
          view_count?: number | null
          virtual_link?: string | null
        }
        Update: {
          cover_image_size?: number | null
          cover_image_url?: string | null
          created_at?: string
          created_by?: string | null
          current_attendees?: number | null
          description?: string | null
          end_date?: string | null
          end_time?: string | null
          id?: string
          is_public?: boolean | null
          is_virtual?: boolean | null
          max_attendees?: number | null
          published_at?: string | null
          start_date?: string
          start_time?: string | null
          status?: string | null
          target_level?: string | null
          title?: string
          updated_at?: string
          venue?: string | null
          view_count?: number | null
          virtual_link?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "events_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      executives: {
        Row: {
          academic_session: string
          avatar_url: string | null
          bio: string | null
          created_at: string
          department_id: string | null
          display_order: number | null
          email: string | null
          end_date: string | null
          full_name: string | null
          id: string
          is_active: boolean | null
          is_alumni: boolean | null
          is_current: boolean | null
          phone: string | null
          position: string
          position_code: string | null
          social_links: Json | null
          start_date: string | null
          user_id: string | null
        }
        Insert: {
          academic_session: string
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          department_id?: string | null
          display_order?: number | null
          email?: string | null
          end_date?: string | null
          full_name?: string | null
          id?: string
          is_active?: boolean | null
          is_alumni?: boolean | null
          is_current?: boolean | null
          phone?: string | null
          position: string
          position_code?: string | null
          social_links?: Json | null
          start_date?: string | null
          user_id?: string | null
        }
        Update: {
          academic_session?: string
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          department_id?: string | null
          display_order?: number | null
          email?: string | null
          end_date?: string | null
          full_name?: string | null
          id?: string
          is_active?: boolean | null
          is_alumni?: boolean | null
          is_current?: boolean | null
          phone?: string | null
          position?: string
          position_code?: string | null
          social_links?: Json | null
          start_date?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "executives_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "executives_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "executives_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      graduates: {
        Row: {
          achievements: string | null
          archived_at: string | null
          avatar_url: string | null
          contact_email: string | null
          created_at: string | null
          current_occupation: string | null
          current_organization: string | null
          department_id: string | null
          email: string | null
          full_name: string
          graduation_year: number
          id: string
          is_private: boolean | null
          linkedin_url: string | null
          phone: string | null
          registration_number: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          achievements?: string | null
          archived_at?: string | null
          avatar_url?: string | null
          contact_email?: string | null
          created_at?: string | null
          current_occupation?: string | null
          current_organization?: string | null
          department_id?: string | null
          email?: string | null
          full_name: string
          graduation_year: number
          id?: string
          is_private?: boolean | null
          linkedin_url?: string | null
          phone?: string | null
          registration_number?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          achievements?: string | null
          archived_at?: string | null
          avatar_url?: string | null
          contact_email?: string | null
          created_at?: string | null
          current_occupation?: string | null
          current_organization?: string | null
          department_id?: string | null
          email?: string | null
          full_name?: string
          graduation_year?: number
          id?: string
          is_private?: boolean | null
          linkedin_url?: string | null
          phone?: string | null
          registration_number?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "graduates_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "graduates_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "graduates_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      group_members: {
        Row: {
          created_at: string | null
          group_id: string | null
          id: string
          last_read_at: string | null
          role: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          group_id?: string | null
          id?: string
          last_read_at?: string | null
          role?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          group_id?: string | null
          id?: string
          last_read_at?: string | null
          role?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_group_members_user"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_group_members_user"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      groups: {
        Row: {
          avatar_url: string | null
          chat_enabled: boolean | null
          created_at: string | null
          created_by: string | null
          department_id: string | null
          description: string | null
          group_type: string
          id: string
          is_active: boolean | null
          is_official: boolean | null
          level: string | null
          moderator_id: string | null
          name: string
          updated_at: string | null
        }
        Insert: {
          avatar_url?: string | null
          chat_enabled?: boolean | null
          created_at?: string | null
          created_by?: string | null
          department_id?: string | null
          description?: string | null
          group_type: string
          id?: string
          is_active?: boolean | null
          is_official?: boolean | null
          level?: string | null
          moderator_id?: string | null
          name: string
          updated_at?: string | null
        }
        Update: {
          avatar_url?: string | null
          chat_enabled?: boolean | null
          created_at?: string | null
          created_by?: string | null
          department_id?: string | null
          description?: string | null
          group_type?: string
          id?: string
          is_active?: boolean | null
          is_official?: boolean | null
          level?: string | null
          moderator_id?: string | null
          name?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "groups_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "groups_moderator_id_fkey"
            columns: ["moderator_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "groups_moderator_id_fkey"
            columns: ["moderator_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      lecturers: {
        Row: {
          avatar_url: string | null
          bio: string | null
          created_at: string
          department_id: string | null
          display_order: number | null
          email: string | null
          full_name: string
          id: string
          is_active: boolean | null
          office_hours: string | null
          office_location: string | null
          phone: string | null
          position: string | null
          qualifications: string | null
          social_links: Json | null
          specialization: string | null
          title: string | null
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          department_id?: string | null
          display_order?: number | null
          email?: string | null
          full_name: string
          id?: string
          is_active?: boolean | null
          office_hours?: string | null
          office_location?: string | null
          phone?: string | null
          position?: string | null
          qualifications?: string | null
          social_links?: Json | null
          specialization?: string | null
          title?: string | null
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          department_id?: string | null
          display_order?: number | null
          email?: string | null
          full_name?: string
          id?: string
          is_active?: boolean | null
          office_hours?: string | null
          office_location?: string | null
          phone?: string | null
          position?: string | null
          qualifications?: string | null
          social_links?: Json | null
          specialization?: string | null
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lecturers_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      materials: {
        Row: {
          course_id: string | null
          created_at: string
          description: string | null
          download_count: number | null
          file_mime_type: string | null
          file_name: string | null
          file_size: number | null
          file_url: string | null
          files: Json | null
          id: string
          is_active: boolean | null
          is_downloadable: boolean | null
          is_featured: boolean | null
          is_public: boolean | null
          level: string | null
          material_type: string
          semester: string | null
          title: string
          updated_at: string
          uploaded_by: string | null
          view_count: number | null
        }
        Insert: {
          course_id?: string | null
          created_at?: string
          description?: string | null
          download_count?: number | null
          file_mime_type?: string | null
          file_name?: string | null
          file_size?: number | null
          file_url?: string | null
          files?: Json | null
          id?: string
          is_active?: boolean | null
          is_downloadable?: boolean | null
          is_featured?: boolean | null
          is_public?: boolean | null
          level?: string | null
          material_type: string
          semester?: string | null
          title: string
          updated_at?: string
          uploaded_by?: string | null
          view_count?: number | null
        }
        Update: {
          course_id?: string | null
          created_at?: string
          description?: string | null
          download_count?: number | null
          file_mime_type?: string | null
          file_name?: string | null
          file_size?: number | null
          file_url?: string | null
          files?: Json | null
          id?: string
          is_active?: boolean | null
          is_downloadable?: boolean | null
          is_featured?: boolean | null
          is_public?: boolean | null
          level?: string | null
          material_type?: string
          semester?: string | null
          title?: string
          updated_at?: string
          uploaded_by?: string | null
          view_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "materials_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      message_reports: {
        Row: {
          category: string | null
          created_at: string | null
          id: string
          message_id: string | null
          reason: string
          reported_by: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string | null
        }
        Insert: {
          category?: string | null
          created_at?: string | null
          id?: string
          message_id?: string | null
          reason: string
          reported_by?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string | null
        }
        Update: {
          category?: string | null
          created_at?: string | null
          id?: string
          message_id?: string | null
          reason?: string
          reported_by?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "message_reports_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_reports_reported_by_fkey"
            columns: ["reported_by"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_reports_reported_by_fkey"
            columns: ["reported_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          attachment_metadata: Json | null
          attachment_name: string | null
          attachment_size: number | null
          attachment_type: string | null
          attachment_url: string | null
          content: string
          content_type: string | null
          created_at: string | null
          deleted_at: string | null
          deleted_by: string | null
          deleted_by_user_id: string | null
          file_size: number | null
          flagged_by: string | null
          flagged_reason: string | null
          group_id: string | null
          id: string
          is_deleted: boolean | null
          is_edited: boolean | null
          is_flagged: boolean | null
          message_type: string | null
          metadata: Json | null
          reply_from_meta: Json | null
          reply_to_id: string | null
          sender_id: string | null
          updated_at: string | null
        }
        Insert: {
          attachment_metadata?: Json | null
          attachment_name?: string | null
          attachment_size?: number | null
          attachment_type?: string | null
          attachment_url?: string | null
          content: string
          content_type?: string | null
          created_at?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_by_user_id?: string | null
          file_size?: number | null
          flagged_by?: string | null
          flagged_reason?: string | null
          group_id?: string | null
          id?: string
          is_deleted?: boolean | null
          is_edited?: boolean | null
          is_flagged?: boolean | null
          message_type?: string | null
          metadata?: Json | null
          reply_from_meta?: Json | null
          reply_to_id?: string | null
          sender_id?: string | null
          updated_at?: string | null
        }
        Update: {
          attachment_metadata?: Json | null
          attachment_name?: string | null
          attachment_size?: number | null
          attachment_type?: string | null
          attachment_url?: string | null
          content?: string
          content_type?: string | null
          created_at?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_by_user_id?: string | null
          file_size?: number | null
          flagged_by?: string | null
          flagged_reason?: string | null
          group_id?: string | null
          id?: string
          is_deleted?: boolean | null
          is_edited?: boolean | null
          is_flagged?: boolean | null
          message_type?: string | null
          metadata?: Json | null
          reply_from_meta?: Json | null
          reply_to_id?: string | null
          sender_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_deleted_by_user_id_fkey"
            columns: ["deleted_by_user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_deleted_by_user_id_fkey"
            columns: ["deleted_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_reply_to_id_fkey"
            columns: ["reply_to_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      moderator_permissions: {
        Row: {
          assigned_level: string | null
          can_manage_announcements: boolean | null
          can_manage_executives: boolean | null
          can_manage_lecturers: boolean | null
          can_manage_materials: boolean | null
          can_manage_students: boolean | null
          created_at: string | null
          id: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          assigned_level?: string | null
          can_manage_announcements?: boolean | null
          can_manage_executives?: boolean | null
          can_manage_lecturers?: boolean | null
          can_manage_materials?: boolean | null
          can_manage_students?: boolean | null
          created_at?: string | null
          id?: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          assigned_level?: string | null
          can_manage_announcements?: boolean | null
          can_manage_executives?: boolean | null
          can_manage_lecturers?: boolean | null
          can_manage_materials?: boolean | null
          can_manage_students?: boolean | null
          created_at?: string | null
          id?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "moderator_permissions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "moderator_permissions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      muted_users: {
        Row: {
          created_at: string | null
          id: string
          mute_until: string | null
          muted_by: string | null
          reason: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          mute_until?: string | null
          muted_by?: string | null
          reason?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          mute_until?: string | null
          muted_by?: string | null
          reason?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "muted_users_muted_by_fkey"
            columns: ["muted_by"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "muted_users_muted_by_fkey"
            columns: ["muted_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "muted_users_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "muted_users_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      past_questions: {
        Row: {
          course_id: string | null
          created_at: string | null
          description: string | null
          download_count: number | null
          file_mime_type: string | null
          file_name: string | null
          file_size: number | null
          file_url: string | null
          files: Json | null
          id: string
          is_downloadable: boolean | null
          is_featured: boolean | null
          is_public: boolean | null
          level: string | null
          semester: string | null
          title: string
          updated_at: string | null
          uploaded_by: string | null
          view_count: number | null
        }
        Insert: {
          course_id?: string | null
          created_at?: string | null
          description?: string | null
          download_count?: number | null
          file_mime_type?: string | null
          file_name?: string | null
          file_size?: number | null
          file_url?: string | null
          files?: Json | null
          id?: string
          is_downloadable?: boolean | null
          is_featured?: boolean | null
          is_public?: boolean | null
          level?: string | null
          semester?: string | null
          title: string
          updated_at?: string | null
          uploaded_by?: string | null
          view_count?: number | null
        }
        Update: {
          course_id?: string | null
          created_at?: string | null
          description?: string | null
          download_count?: number | null
          file_mime_type?: string | null
          file_name?: string | null
          file_size?: number | null
          file_url?: string | null
          files?: Json | null
          id?: string
          is_downloadable?: boolean | null
          is_featured?: boolean | null
          is_public?: boolean | null
          level?: string | null
          semester?: string | null
          title?: string
          updated_at?: string | null
          uploaded_by?: string | null
          view_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "past_questions_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      photos: {
        Row: {
          caption: string | null
          created_at: string
          display_order: number | null
          entity_id: string
          entity_type: string
          id: string
          url: string
        }
        Insert: {
          caption?: string | null
          created_at?: string
          display_order?: number | null
          entity_id: string
          entity_type: string
          id?: string
          url: string
        }
        Update: {
          caption?: string | null
          created_at?: string
          display_order?: number | null
          entity_id?: string
          entity_type?: string
          id?: string
          url?: string
        }
        Relationships: []
      }
      resources: {
        Row: {
          category: string | null
          created_at: string | null
          file_size: number | null
          file_type: string | null
          file_url: string
          id: string
          title: string
          uploaded_by: string | null
        }
        Insert: {
          category?: string | null
          created_at?: string | null
          file_size?: number | null
          file_type?: string | null
          file_url: string
          id?: string
          title: string
          uploaded_by?: string | null
        }
        Update: {
          category?: string | null
          created_at?: string | null
          file_size?: number | null
          file_type?: string | null
          file_url?: string
          id?: string
          title?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "resources_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resources_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      system_settings: {
        Row: {
          category: string
          created_at: string | null
          description: string | null
          editable_by: string[] | null
          id: string
          is_public: boolean | null
          key: string
          updated_at: string | null
          value: string
          value_type: string
        }
        Insert: {
          category?: string
          created_at?: string | null
          description?: string | null
          editable_by?: string[] | null
          id?: string
          is_public?: boolean | null
          key: string
          updated_at?: string | null
          value: string
          value_type?: string
        }
        Update: {
          category?: string
          created_at?: string | null
          description?: string | null
          editable_by?: string[] | null
          id?: string
          is_public?: boolean | null
          key?: string
          updated_at?: string | null
          value?: string
          value_type?: string
        }
        Relationships: []
      }
      user_announcement_reads: {
        Row: {
          announcement_id: string
          id: string
          read_at: string | null
          user_id: string
        }
        Insert: {
          announcement_id: string
          id?: string
          read_at?: string | null
          user_id: string
        }
        Update: {
          announcement_id?: string
          id?: string
          read_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_announcement_reads_announcement_id_fkey"
            columns: ["announcement_id"]
            isOneToOne: false
            referencedRelation: "announcements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_announcement_reads_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_announcement_reads_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_sessions: {
        Row: {
          created_at: string
          device_id: string
          device_name: string
          id: string
          ip_address: string | null
          is_active: boolean
          last_active_at: string
          os: string
          user_id: string
        }
        Insert: {
          created_at?: string
          device_id: string
          device_name: string
          id?: string
          ip_address?: string | null
          is_active?: boolean
          last_active_at?: string
          os: string
          user_id: string
        }
        Update: {
          created_at?: string
          device_id?: string
          device_name?: string
          id?: string
          ip_address?: string | null
          is_active?: boolean
          last_active_at?: string
          os?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          avatar_url: string | null
          banned_at: string | null
          banned_by: string | null
          banned_reason: string | null
          bio: string | null
          biography: string | null
          blocked_until: string | null
          created_at: string | null
          department_id: string | null
          display_name: string | null
          email: string | null
          email_verified_at: string | null
          failed_auth_attempts: number | null
          full_name: string | null
          hobbies: string | null
          id: string
          is_verified: boolean | null
          last_active_at: string | null
          level: string | null
          motivation: string | null
          motivational_advice: string | null
          notif_announcements: boolean | null
          notif_events: boolean | null
          notif_materials: boolean | null
          notif_messages: boolean | null
          phone: string | null
          push_token: string | null
          registration_number: string | null
          registration_verified_at: string | null
          role: string | null
          senior_bio: string | null
          senior_photo_url: string | null
          status: string | null
          suspended_until: string | null
          suspension_reason: string | null
          updated_at: string | null
          username: string | null
        }
        Insert: {
          avatar_url?: string | null
          banned_at?: string | null
          banned_by?: string | null
          banned_reason?: string | null
          bio?: string | null
          biography?: string | null
          blocked_until?: string | null
          created_at?: string | null
          department_id?: string | null
          display_name?: string | null
          email?: string | null
          email_verified_at?: string | null
          failed_auth_attempts?: number | null
          full_name?: string | null
          hobbies?: string | null
          id: string
          is_verified?: boolean | null
          last_active_at?: string | null
          level?: string | null
          motivation?: string | null
          motivational_advice?: string | null
          notif_announcements?: boolean | null
          notif_events?: boolean | null
          notif_materials?: boolean | null
          notif_messages?: boolean | null
          phone?: string | null
          push_token?: string | null
          registration_number?: string | null
          registration_verified_at?: string | null
          role?: string | null
          senior_bio?: string | null
          senior_photo_url?: string | null
          status?: string | null
          suspended_until?: string | null
          suspension_reason?: string | null
          updated_at?: string | null
          username?: string | null
        }
        Update: {
          avatar_url?: string | null
          banned_at?: string | null
          banned_by?: string | null
          banned_reason?: string | null
          bio?: string | null
          biography?: string | null
          blocked_until?: string | null
          created_at?: string | null
          department_id?: string | null
          display_name?: string | null
          email?: string | null
          email_verified_at?: string | null
          failed_auth_attempts?: number | null
          full_name?: string | null
          hobbies?: string | null
          id?: string
          is_verified?: boolean | null
          last_active_at?: string | null
          level?: string | null
          motivation?: string | null
          motivational_advice?: string | null
          notif_announcements?: boolean | null
          notif_events?: boolean | null
          notif_materials?: boolean | null
          notif_messages?: boolean | null
          phone?: string | null
          push_token?: string | null
          registration_number?: string | null
          registration_verified_at?: string | null
          role?: string | null
          senior_bio?: string | null
          senior_photo_url?: string | null
          status?: string | null
          suspended_until?: string | null
          suspension_reason?: string | null
          updated_at?: string | null
          username?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "users_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      cloud_archive: {
        Row: {
          category: string | null
          created_at: string | null
          file_size: number | null
          file_type: string | null
          file_url: string | null
          id: string | null
          origin_table: string | null
          title: string | null
          uploaded_by: string | null
          uploader_name: string | null
        }
        Relationships: []
      }
      public_profiles: {
        Row: {
          avatar_url: string | null
          bio: string | null
          created_at: string | null
          display_name: string | null
          full_name: string | null
          id: string | null
          last_active_at: string | null
          level: string | null
          motivational_advice: string | null
          role: string | null
          senior_bio: string | null
          senior_photo_url: string | null
          status: string | null
          username: string | null
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string | null
          display_name?: string | null
          full_name?: string | null
          id?: string | null
          last_active_at?: string | null
          level?: string | null
          motivational_advice?: string | null
          role?: string | null
          senior_bio?: string | null
          senior_photo_url?: string | null
          status?: string | null
          username?: string | null
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string | null
          display_name?: string | null
          full_name?: string | null
          id?: string | null
          last_active_at?: string | null
          level?: string | null
          motivational_advice?: string | null
          role?: string | null
          senior_bio?: string | null
          senior_photo_url?: string | null
          status?: string | null
          username?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      archive_executive_tenure: {
        Args: { target_id: string }
        Returns: undefined
      }
      check_existing_account: { Args: { email_addr: string }; Returns: string }
      check_is_admin: { Args: never; Returns: boolean }
      check_matric_availability: {
        Args: { p_email: string; p_matric_no: string }
        Returns: boolean
      }
      check_registration_status: {
        Args: { email_addr: string }
        Returns: string
      }
      check_username_availability: {
        Args: { p_email: string; p_username: string }
        Returns: boolean
      }
      cleanup_incomplete_signups: { Args: never; Returns: undefined }
      create_user_profile: {
        Args: {
          p_avatar_url: string
          p_email: string
          p_full_name: string
          p_id: string
          p_level: string
          p_registration_number: string
          p_username: string
        }
        Returns: undefined
      }
      delete_incomplete_signup: { Args: never; Returns: undefined }
      fetch_admin_analytics: { Args: never; Returns: Json }
      get_group_unread_counts: {
        Args: { p_user_id: string }
        Returns: {
          group_id: string
          unread_count: number
        }[]
      }
      get_groups_with_counts: {
        Args: never
        Returns: {
          avatar_url: string
          chat_enabled: boolean
          created_at: string
          created_by: string
          description: string
          group_type: string
          id: string
          is_active: boolean
          is_official: boolean
          level: string
          member_count: number
          moderator_email: string
          moderator_full_name: string
          moderator_id: string
          moderator_role: string
          name: string
          updated_at: string
        }[]
      }
      get_system_stats: { Args: never; Returns: Json }
      get_total_storage_usage: { Args: never; Returns: Json }
      increment_announcement_view_count: {
        Args: { announcement_id: string }
        Returns: undefined
      }
      increment_event_view_count: {
        Args: { event_id: string }
        Returns: undefined
      }
      increment_material_download_count: {
        Args: { material_id: string }
        Returns: undefined
      }
      increment_material_view_count: {
        Args: { material_id: string }
        Returns: undefined
      }
      increment_pq_download_count: {
        Args: { pq_id: string }
        Returns: undefined
      }
      increment_pq_view_count: { Args: { pq_id: string }; Returns: undefined }
      is_active_user: { Args: never; Returns: boolean }
      is_admin_or_moderator: { Args: never; Returns: boolean }
      is_group_member: {
        Args: { p_group_id: string; p_user_id: string }
        Returns: boolean
      }
      is_institutional_email: { Args: { email: string }; Returns: boolean }
      is_super_admin: { Args: never; Returns: boolean }
      log_failed_auth_attempt: {
        Args: { email_addr: string }
        Returns: undefined
      }
      mark_all_announcements_as_read: {
        Args: { u_level?: string }
        Returns: undefined
      }
      mark_announcement_as_read: { Args: { a_id: string }; Returns: undefined }
      mark_group_as_read: { Args: { p_group_id: string }; Returns: undefined }
      perform_academic_year_transition: { Args: never; Returns: undefined }
      perform_system_forensics: { Args: never; Returns: Json }
      purge_incomplete_account: {
        Args: { email_addr: string }
        Returns: undefined
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      update_last_active: { Args: never; Returns: undefined }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

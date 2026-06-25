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
      announcements: {
        Row: {
          author_id: string | null
          category: string | null
          content: string
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
        Relationships: []
      }
      courses: {
        Row: {
          code: string
          created_at: string | null
          credit_units: number | null
          department_id: string | null
          description: string | null
          id: string
          is_active: boolean | null
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
          id?: string
          is_active?: boolean | null
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
          id?: string
          is_active?: boolean | null
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
        Relationships: []
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
        ]
      }
      group_members: {
        Row: {
          created_at: string | null
          group_id: string | null
          id: string
          role: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          group_id?: string | null
          id?: string
          role?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          group_id?: string | null
          id?: string
          role?: string | null
          user_id?: string | null
        }
        Relationships: [
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
          created_at: string | null
          description: string | null
          group_type: string
          id: string
          is_active: boolean | null
          level: string | null
          moderator_id: string | null
          name: string
          updated_at: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          description?: string | null
          group_type: string
          id?: string
          is_active?: boolean | null
          level?: string | null
          moderator_id?: string | null
          name: string
          updated_at?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          description?: string | null
          group_type?: string
          id?: string
          is_active?: boolean | null
          level?: string | null
          moderator_id?: string | null
          name?: string
          updated_at?: string | null
        }
        Relationships: []
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
          file_name: string | null
          file_size: number | null
          file_url: string | null
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
          file_name?: string | null
          file_size?: number | null
          file_url?: string | null
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
          file_name?: string | null
          file_size?: number | null
          file_url?: string | null
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
        Relationships: []
      }
      messages: {
        Row: {
          attachment_url: string | null
          content: string
          content_type: string | null
          created_at: string | null
          group_id: string | null
          id: string
          is_deleted: boolean | null
          is_edited: boolean | null
          edited_at: string | null
          message_type: string | null
          reply_to_id: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          attachment_url?: string | null
          content: string
          content_type?: string | null
          created_at?: string | null
          group_id?: string | null
          id?: string
          is_deleted?: boolean | null
          is_edited?: boolean | null
          edited_at?: string | null
          message_type?: string | null
          reply_to_id?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          attachment_url?: string | null
          content?: string
          content_type?: string | null
          created_at?: string | null
          group_id?: string | null
          id?: string
          is_deleted?: boolean | null
          is_edited?: boolean | null
          edited_at?: string | null
          message_type?: string | null
          reply_to_id?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_messages_user"
            columns: ["user_id"]
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
            referencedRelation: "users"
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
          file_url?: string | null
          id?: string
          title?: string
          uploaded_by?: string | null
        }
        Relationships: []
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
      users: {
        Row: {
          avatar_url: string | null
          banned_at: string | null
          banned_reason: string | null
          bio: string | null
          biography: string | null
          blocked_until: string | null
          created_at: string | null
          department_id: string | null
          display_name: string | null
          email: string | null
          failed_auth_attempts: number | null
          full_name: string | null
          hobbies: string | null
          id: string
          is_verified: boolean | null
          last_active_at: string | null
          level: string | null
          motivation: string | null
          motivational_advice: string | null
          phone: string | null
          registration_number: string | null
          registration_verified_at: string | null
          role: string | null
          senior_bio: string | null
          senior_photo_url: string | null
          status: string | null
          suspended_until: string | null
          updated_at: string | null
          username: string | null
        }
        Insert: {
          avatar_url?: string | null
          banned_at?: string | null
          banned_reason?: string | null
          bio?: string | null
          biography?: string | null
          blocked_until?: string | null
          created_at?: string | null
          department_id?: string | null
          display_name?: string | null
          email?: string | null
          failed_auth_attempts?: number | null
          full_name?: string | null
          hobbies?: string | null
          id: string
          is_verified?: boolean | null
          last_active_at?: string | null
          level?: string | null
          motivation?: string | null
          motivational_advice?: string | null
          phone?: string | null
          registration_number?: string | null
          registration_verified_at?: string | null
          role?: string | null
          senior_bio?: string | null
          senior_photo_url?: string | null
          status?: string | null
          suspended_until?: string | null
          updated_at?: string | null
          username?: string | null
        }
        Update: {
          avatar_url?: string | null
          banned_at?: string | null
          banned_reason?: string | null
          bio?: string | null
          biography?: string | null
          blocked_until?: string | null
          created_at?: string | null
          department_id?: string | null
          display_name?: string | null
          email?: string | null
          failed_auth_attempts?: number | null
          full_name?: string | null
          hobbies?: string | null
          id?: string
          is_verified?: boolean | null
          last_active_at?: string | null
          level?: string | null
          motivation?: string | null
          motivational_advice?: string | null
          phone?: string | null
          registration_number?: string | null
          registration_verified_at?: string | null
          role?: string | null
          senior_bio?: string | null
          senior_photo_url?: string | null
          status?: string | null
          suspended_until?: string | null
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
      [_ in never]: never
    }
    Functions: {
      check_existing_account: { Args: { email_addr: string }; Returns: string }
      check_registration_status: {
        Args: { email_addr: string }
        Returns: string
      }
      is_institutional_email: { Args: { email_addr: string }; Returns: boolean }
      log_failed_auth_attempt: {
        Args: { email_addr: string }
        Returns: undefined
      }
      increment_material_download_count: {
        Args: { material_id: string }
        Returns: undefined
      }
      perform_academic_year_transition: { Args: never; Returns: undefined }
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
    Enums: {
    },
  },
} as const

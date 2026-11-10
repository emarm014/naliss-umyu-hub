import { create } from 'zustand';
import { supabase, ensureActiveSession } from '../lib/supabase';
import { adminRealtimeManager as realtimeCoordinator } from '../lib/realtimeManager';
import { queryClient } from '../lib/queryClient';
import { sortHierarchically } from '../utils/hierarchy';

// ── Paginated user fetcher ────────────────────────────────────────────────────
// PostgREST has a default max-rows cap (typically 1000). For departments with
// 1000+ students we page through all results automatically using range().
// Each page is 500 rows — small enough to be fast, large enough to minimise
// round-trips. All pages are fetched in sequence and merged into one array.
const PAGE_SIZE = 500;

async function fetchAllUsers(): Promise<User[]> {
  const all: User[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from('users')
      .select('*, departments(name, code), moderator_permissions(assigned_level, assigned_levels, level_permissions, can_manage_announcements, can_manage_materials, can_manage_past_questions, can_manage_lecturers, can_manage_executives, can_manage_students, can_manage_groups, can_manage_group_media, can_manage_storage, can_manage_messaging, can_manage_security, can_manage_archives, can_manage_news, can_manage_events, is_restricted)')
      .neq('role', 'super_admin')
      .order('created_at', { ascending: false })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw error;
    if (!data || data.length === 0) break;

    const formatted = data.map((u: any) => {
      const perms = Array.isArray(u.moderator_permissions) ? u.moderator_permissions[0] : u.moderator_permissions;
      return {
        ...u,
        permissions: perms || u.permissions
      };
    });

    all.push(...(formatted as User[]));

    // If we got fewer rows than the page size, we've reached the last page
    if (data.length < PAGE_SIZE) break;

    from += PAGE_SIZE;
  }

  return all;
}

import type { 
  User, 
  SystemStats, 
  Material, 
  Lecturer, 
  Executive, 
  Announcement, 
  Event, 
  Course,
  PastQuestion,
  Graduate,
  Group,
  Department,
  ActivityLog,
  Resource
} from '../types';
import { RealtimeChannel } from '@supabase/supabase-js';

interface AdminDataState {
  analytics: SystemStats | null;
  cloudinaryStorageBytes: number | null;
  students: User[];
  deletedAccounts: any[];
  materials: Material[];
  pastQuestions: PastQuestion[];
  lecturers: Lecturer[];
  executives: Executive[];
  announcements: Announcement[];
  events: Event[];
  courses: Course[];
  graduates: Graduate[];
  groups: Group[];
  resources: Resource[];
  departments: Department[];
  activityLogs: ActivityLog[];
  flaggedMessages: any[];
  messageReports: any[];
  mutedUsers: any[];

  isSyncing: boolean;
  lastSync: string | null;
  error: string | null;
  syncWarnings: string[];

  syncAll: (force?: boolean) => Promise<void>;
  syncMaterialsOnly: () => Promise<void>;
  syncUsersOnly: () => Promise<void>;
  clearData: () => void;

  // Incremental updaters — instant local patch, no re-fetch needed
  updateStudent: (student: User) => void;
  updateMaterial: (material: Material) => void;
  updateLecturer: (lecturer: Lecturer) => void;
  updateExecutive: (executive: Executive) => void;
  updateAnnouncement: (announcement: Announcement) => void;
  updateEvent: (event: Event) => void;
  updateCourse: (course: Course) => void;
  updateResource: (resource: Resource) => void;
  updatePastQuestion: (pq: PastQuestion) => void;
  updateGroup: (group: Group) => void;

  // Optimistic adders — instant local insert before DB confirms
  addMaterial: (material: Material) => void;
  addAnnouncement: (announcement: Announcement) => void;
  addEvent: (event: Event) => void;
  addCourse: (course: Course) => void;
  addLecturer: (lecturer: Lecturer) => void;
  addExecutive: (executive: Executive) => void;
  addPastQuestion: (pq: PastQuestion) => void;

  // Instant removers
  removeMaterial: (id: string) => void;
  removePastQuestion: (id: string) => void;
  removeAnnouncement: (id: string) => void;
  removeEvent: (id: string) => void;
  removeCourse: (id: string) => void;
  removeLecturer: (id: string) => void;
  removeExecutive: (id: string) => void;
  removeGraduate: (id: string) => void;
  removeGroup: (id: string) => void;
  removeStudent: (id: string) => void;

  // Targeted fast-fetchers
  fetchGroups: () => Promise<void>;
  fetchPastQuestions: () => Promise<void>;
  fetchMessaging: () => Promise<void>;
  fetchActivityLogs: () => Promise<void>;
  refreshAnalytics: () => Promise<void>;

  handleRealtimeEvent: (payload: any) => Promise<void>;
  subscribe: () => void;
  unsubscribe: () => void;
  _channels: RealtimeChannel[];
}

// Sync mutex: prevents concurrent syncAll() from spawning duplicate query storms.
let _syncPromise: Promise<void> | null = null;

export const useAdminDataStore = create<AdminDataState>((set, get) => ({
  analytics: null,
  cloudinaryStorageBytes: null,
  students: [],
  deletedAccounts: [],
  materials: [],
  pastQuestions: [],
  lecturers: [],
  executives: [],
  announcements: [],
  events: [],
  courses: [],
  graduates: [],
  groups: [],
  resources: [],
  departments: [],
  activityLogs: [],
  flaggedMessages: [],
  messageReports: [],
  mutedUsers: [],

  isSyncing: false,
  lastSync: null,
  error: null,
  syncWarnings: [],
  _channels: [],

  // ── Full sync — ALL queries backed by TanStack Query Client ────────────────
  syncAll: async (force = false) => {
    // If a sync is already running, piggyback on it instead of spawning a
    // duplicate set of 17 parallel queries. This prevents the "Sync took
    // longer than 30s" cascade when syncAll(true) fires concurrently.
    if (_syncPromise) {
      return _syncPromise;
    }

    const now = new Date();
    const lastSyncTime = get().lastSync ? new Date(get().lastSync!) : null;
    const isInitialLoad = !get().lastSync;

    if (!force) {
      const currentState = get();
      if (currentState.isSyncing || (!isInitialLoad && lastSyncTime && now.getTime() - lastSyncTime.getTime() < 5000)) {
        return;
      }
    }

    // Wrap the entire sync body in a shared promise so concurrent callers
    // piggyback on the same operation instead of spawning duplicate queries.
    _syncPromise = (async () => {
      // Set isSyncing immediately before any async operations
      set({ isSyncing: true, error: null });

      // Safety fallback: if sync takes longer than 30s, force reset isSyncing
      const safetyTimeout = setTimeout(() => {
        if (get().isSyncing) {
          console.warn('[Sync Engine] Sync took longer than 30s. Force resetting isSyncing state.');
          set({ isSyncing: false });
        }
      }, 30000);

      const failedKeys: string[] = [];

      try {
        // PREVENT FREEZE: Ensure session is refreshed/valid BEFORE firing 15 parallel queries.
        // If a tab wakes up and 15 queries fire simultaneously while the token is expired, 
        // 1. Force token refresh to prevent "token expired" 401s during long-idle sync
        // Use singleton wrapper to prevent gotrue-js lock contention when syncAll fires concurrently with page mounts
        const { data: sessionData, error: sessionError } = await ensureActiveSession();
        if (sessionError || !sessionData?.session) throw new Error("Unauthorized");

        const fetchOrUseCache = async (key: string, queryFn: () => Promise<any>, staleTime = 5 * 60 * 1000) => {
          if (force) {
            await queryClient.invalidateQueries({ queryKey: [key] });
          }
          return await queryClient.fetchQuery({
            queryKey: [key],
            queryFn,
            staleTime: force ? 0 : staleTime,
          });
        };

        const safeFetch = async (key: string, queryFn: () => Promise<any>, currentValue: any, staleTime?: number) => {
          try {
            return await fetchOrUseCache(key, queryFn, staleTime);
          } catch (err: any) {
            console.error(`[Sync Engine] Failed to sync slice "${key}":`, err);
            failedKeys.push(key);
            return currentValue || [];
          }
        };

        // Define thunks that execute the queries
        const tasks = [
          async () => ({
            analytics: await safeFetch('analytics', async () => {
              const { data, error } = await supabase.rpc('fetch_admin_analytics');
              if (error) throw error;
              return data;
            }, get().analytics, 60000)
          }),
          async () => ({
            students: await safeFetch('students', () => fetchAllUsers(), get().students, 5 * 60 * 1000)
          }),
          async () => ({
            deletedAccounts: await safeFetch('deleted_accounts', async () => {
              const { data, error } = await supabase.from('deleted_accounts').select('*').order('deleted_at', { ascending: false });
              if (error) throw error;
              return data || [];
            }, get().deletedAccounts, 5 * 60 * 1000)
          }),
          async () => ({
            departments: await safeFetch('departments', async () => {
              const { data, error } = await supabase.from('departments').select('*').order('name', { ascending: true });
              if (error) throw error;
              return data || [];
            }, get().departments, 60 * 60 * 1000)
          }),
          async () => ({
            groups: await safeFetch('groups', async () => {
              const { data, error } = await supabase.rpc('get_groups_with_counts');
              if (error) throw error;
              return (data || []).map((g: any) => ({
                ...g,
                allow_media: g.allow_media ?? true,
                member_count: Number(g.member_count) || 0,
                moderator: g.moderator_id ? { id: g.moderator_id, full_name: g.moderator_full_name, email: g.moderator_email, role: g.moderator_role } : null,
              }));
            }, get().groups, 5 * 60 * 1000)
          }),
          async () => ({
            courses: await safeFetch('courses', async () => {
              const { data, error } = await supabase.from('courses').select('*, lecturer:lecturers!courses_lecturer_id_fkey(id, full_name, title)').order('code', { ascending: true });
              if (error) throw error;
              return data || [];
            }, get().courses, 30 * 60 * 1000)
          }),
          async () => ({
            materials: await safeFetch('materials', async () => {
              const { data, error } = await supabase.from('materials').select('*, course:courses!materials_course_id_fkey(id, code, title, level, semester)').order('created_at', { ascending: false }).limit(100);
              if (error) throw error;
              return data || [];
            }, get().materials, 5 * 60 * 1000)
          }),
          async () => ({
            pastQuestions: await safeFetch('pastQuestions', async () => {
              const { data, error } = await supabase.from('past_questions').select('*, course:courses!past_questions_course_id_fkey(id, code, title, level, semester)').order('created_at', { ascending: false }).limit(100);
              if (error) throw error;
              return data || [];
            }, get().pastQuestions, 5 * 60 * 1000)
          }),
          async () => ({
            resources: await safeFetch('resources', async () => {
              const { data, error } = await supabase.from('cloud_archive').select('*').order('created_at', { ascending: false }).limit(10000);
              if (error) throw error;
              return (data || []).map((r: any) => ({ ...r, file_size: r.file_size || 0, file_type: r.file_type || null }));
            }, get().resources, 5 * 60 * 1000)
          }),
          async () => ({
            lecturers: await safeFetch('lecturers', async () => {
              const { data, error } = await supabase.from('lecturers').select('*').order('display_order', { ascending: true });
              if (error) throw error;
              return sortHierarchically(data || [], 'lecturer');
            }, get().lecturers, 30 * 60 * 1000)
          }),
          async () => ({
            executives: await safeFetch('executives', async () => {
              const { data, error } = await supabase.from('executives').select('*, linked_user:users(id, full_name, username, avatar_url, level, registration_number, email, phone, bio, department_id)').order('display_order', { ascending: true });
              if (error) throw error;
              return sortHierarchically(data || [], 'executive');
            }, get().executives, 30 * 60 * 1000)
          }),
          async () => ({
            announcements: await safeFetch('announcements', async () => {
              const { data, error } = await supabase.from('announcements').select('*').order('created_at', { ascending: false }).limit(50);
              if (error) throw error;
              return data || [];
            }, get().announcements, 2 * 60 * 1000)
          }),
          async () => ({
            events: await safeFetch('events', async () => {
              const { data, error } = await supabase.from('events').select('*').order('start_date', { ascending: true });
              if (error) throw error;
              return data || [];
            }, get().events, 5 * 60 * 1000)
          }),
          async () => ({
            graduates: await safeFetch('graduates', async () => {
              const { data, error } = await supabase.from('graduates').select('*').order('graduation_year', { ascending: false });
              if (error) throw error;
              return data || [];
            }, get().graduates, 10 * 60 * 1000)
          }),
          async () => ({
            activityLogs: await safeFetch('activityLogs', async () => {
              const { data, error } = await supabase.from('activity_logs').select('*, user:users!activity_logs_user_id_fkey(id, full_name, email, role, is_external, avatar_url)').order('created_at', { ascending: false }).limit(200);
              if (error) throw error;
              return data || [];
            }, get().activityLogs, 30000)
          }),
          async () => ({
            flaggedMessages: await safeFetch('flaggedMessages', async () => {
              const { data, error } = await supabase.from('messages').select('*, sender:users!messages_sender_id_fkey(id, full_name, email, role)').eq('is_flagged', true).eq('is_deleted', false).order('created_at', { ascending: false }).limit(50);
              if (error) throw error;
              return data || [];
            }, get().flaggedMessages, 30000)
          }),
          async () => ({
            messageReports: await safeFetch('messageReports', async () => {
              const { data, error } = await supabase.from('message_reports').select('*, reporter:users!message_reports_reported_by_fkey(id, full_name, email), message:messages(id, content, sender_id, sender:users!messages_sender_id_fkey(full_name, email, role))').order('created_at', { ascending: false }).limit(50);
              if (error) throw error;
              return data || [];
            }, get().messageReports, 30000)
          }),
          async () => ({
            mutedUsers: await safeFetch('mutedUsers', async () => {
              const { data, error } = await supabase.from('muted_users').select('*, user:users!muted_users_user_id_fkey(id, full_name, email), mutedBy:users!muted_users_muted_by_fkey(id, full_name, email)').order('created_at', { ascending: false }).limit(50);
              if (error) throw error;
              return data || [];
            }, get().mutedUsers, 30000)
          }),
        ];

        // Batch queries in concurrent chunks of 6 to prevent HTTP pipeline saturation on high-latency networks
        const combinedResults: Record<string, any> = {};
        const BATCH_SIZE = 6;
        for (let i = 0; i < tasks.length; i += BATCH_SIZE) {
          const chunk = tasks.slice(i, i + BATCH_SIZE);
          const chunkResults = await Promise.all(chunk.map(t => t()));
          chunkResults.forEach(res => Object.assign(combinedResults, res));
        }

        set({
          analytics: combinedResults.analytics,
          students: combinedResults.students,
          departments: combinedResults.departments,
          groups: combinedResults.groups,
          courses: combinedResults.courses,
          materials: combinedResults.materials,
          pastQuestions: combinedResults.pastQuestions,
          resources: combinedResults.resources,
          lecturers: combinedResults.lecturers,
          executives: combinedResults.executives,
          announcements: combinedResults.announcements,
          events: combinedResults.events,
          graduates: combinedResults.graduates,
          activityLogs: combinedResults.activityLogs,
          flaggedMessages: combinedResults.flaggedMessages,
          messageReports: combinedResults.messageReports,
          mutedUsers: combinedResults.mutedUsers,
          lastSync: new Date().toISOString(),
          syncWarnings: failedKeys,
          error: null,
        });
      } catch (err: unknown) {
        // "Unauthorized" is expected when lock contention returns a null session — downgrade to warn
        const errMsg = (err as Error)?.message || '';
        if (errMsg === 'Unauthorized') {
          console.warn('[Sync Engine] Session unavailable during sync (auth race), will retry on next cycle.');
        } else {
          console.error('[Sync Engine] Critical unhandled sync error:', err);
        }
        set({ error: errMsg });
      } finally {
        clearTimeout(safetyTimeout);
        set({ isSyncing: false });
        _syncPromise = null;
      }
    })();

    return _syncPromise;
  },

  syncMaterialsOnly: async () => {
    const { data, error } = await supabase.from('materials').select('*, course:courses!materials_course_id_fkey(id, code, title, level, semester)').order('created_at', { ascending: false }).limit(100);
    if (!error && data) set({ materials: data });
  },

  syncUsersOnly: async () => {
    try {
      const users = await fetchAllUsers();
      set({ students: users });
    } catch (err) {
      console.error('Failed to sync users:', err);
    }
  },

  // ── Refresh only analytics (fast — single RPC call) ───────────────────────
  refreshAnalytics: async () => {
    const { data, error } = await supabase.rpc('fetch_admin_analytics');
    if (!error && data) set({ analytics: data });
  },

  clearData: () => set({
    analytics: null, students: [], materials: [], pastQuestions: [],
    lecturers: [], executives: [], announcements: [], events: [],
    courses: [], graduates: [], groups: [], resources: [],
    departments: [], activityLogs: [], lastSync: null
  }),

  // ── Incremental updaters ──────────────────────────────────────────────────
  updateStudent: (student) => set(s => ({ students: s.students.map(u => u.id === student.id ? student : u) })),
  updateMaterial: (material) => set(s => ({ materials: s.materials.map(m => m.id === material.id ? material : m) })),
  updateLecturer: (lecturer) => set(s => ({ lecturers: s.lecturers.map(l => l.id === lecturer.id ? lecturer : l) })),
  updateExecutive: (executive) => set(s => ({ executives: s.executives.map(e => e.id === executive.id ? executive : e) })),
  updateAnnouncement: (announcement) => set(s => ({ announcements: s.announcements.map(a => a.id === announcement.id ? announcement : a) })),
  updateEvent: (event) => set(s => ({ events: s.events.map(e => e.id === event.id ? event : e) })),
  updateCourse: (course) => set(s => ({ courses: s.courses.map(c => c.id === course.id ? course : c) })),
  updateResource: (resource) => set(s => ({ resources: s.resources.map(r => r.id === resource.id ? resource : r) })),
  updatePastQuestion: (pq) => set(s => ({ pastQuestions: s.pastQuestions.map(p => p.id === pq.id ? pq : p) })),
  updateGroup: (group) => set(s => ({ groups: s.groups.map(g => g.id === group.id ? group : g) })),

  // ── Optimistic adders — instant UI before DB confirms ────────────────────
  addMaterial: (material) => set(s => ({ materials: [material, ...s.materials] })),
  addAnnouncement: (announcement) => set(s => ({ announcements: [announcement, ...s.announcements] })),
  addEvent: (event) => set(s => ({ events: [...s.events, event] })),
  addCourse: (course) => set(s => ({ courses: [...s.courses, course] })),
  addLecturer: (lecturer) => set(s => ({ lecturers: [...s.lecturers, lecturer] })),
  addExecutive: (executive) => set(s => ({ executives: [...s.executives, executive] })),
  addPastQuestion: (pq) => set(s => ({ pastQuestions: [pq, ...s.pastQuestions] })),

  // ── Instant removers ──────────────────────────────────────────────────────
  removeMaterial: (id) => set(s => ({ materials: s.materials.filter(m => m.id !== id), resources: s.resources.filter(r => r.id !== id) })),
  removePastQuestion: (id) => set(s => ({ pastQuestions: s.pastQuestions.filter(p => p.id !== id), resources: s.resources.filter(r => r.id !== id) })),
  removeAnnouncement: (id) => set(s => ({ announcements: s.announcements.filter(a => a.id !== id), resources: s.resources.filter(r => r.id !== id) })),
  removeEvent: (id) => set(s => ({ events: s.events.filter(e => e.id !== id), resources: s.resources.filter(r => r.id !== id) })),
  removeCourse: (id) => set(s => ({ courses: s.courses.filter(c => c.id !== id) })),
  removeLecturer: (id) => set(s => ({ lecturers: s.lecturers.filter(l => l.id !== id) })),
  removeExecutive: (id) => set(s => ({ executives: s.executives.filter(e => e.id !== id) })),
  removeGraduate: (id) => set(s => ({ graduates: s.graduates.filter(g => g.id !== id) })),
  removeGroup: (id) => set(s => ({ groups: s.groups.filter(g => g.id !== id) })),
  removeStudent: (id) => set(s => ({ students: s.students.filter(u => u.id !== id) })),

  // ── Targeted fast-fetchers ────────────────────────────────────────────────
  fetchGroups: async () => {
    const [groupsRes, usersResult] = await Promise.all([
      supabase.rpc('get_groups_with_counts'),
      get().students.length === 0
        ? fetchAllUsers()
        : Promise.resolve(null),
    ]);
    const update: Partial<AdminDataState> = {};
    if (!groupsRes.error) {
      update.groups = (groupsRes.data || []).map((g: any) => ({
        ...g,
        allow_media: g.allow_media ?? true,
        member_count: Number(g.member_count) || 0,
        moderator: g.moderator_id ? { id: g.moderator_id, full_name: g.moderator_full_name, email: g.moderator_email, role: g.moderator_role } : null,
      }));
    }
    if (usersResult !== null) update.students = usersResult;
    if (Object.keys(update).length) set(update);
  },

  fetchPastQuestions: async () => {
    const [pqRes, coursesRes] = await Promise.all([
      supabase.from('past_questions').select('*, course:courses!past_questions_course_id_fkey(id, code, title, level, semester)').order('created_at', { ascending: false }).limit(100),
      get().courses.length === 0
        ? supabase.from('courses').select('*, lecturer:lecturers!courses_lecturer_id_fkey(id, full_name, title)').order('code', { ascending: true })
        : Promise.resolve({ data: null, error: null }),
    ]);
    const update: Partial<AdminDataState> = {};
    if (!pqRes.error) update.pastQuestions = pqRes.data || [];
    if (coursesRes.data && !coursesRes.error) update.courses = coursesRes.data;
    if (Object.keys(update).length) set(update);
  },

  fetchMessaging: async () => {
    const [flaggedRes, reportsRes, mutedRes] = await Promise.all([
      supabase.from('messages').select('*, sender:users!messages_sender_id_fkey(id, full_name, email, role)').eq('is_flagged', true).eq('is_deleted', false).order('created_at', { ascending: false }).limit(50),
      supabase.from('message_reports').select('*, reporter:users!message_reports_reported_by_fkey(id, full_name, email), message:messages(id, content, sender_id, sender:users!messages_sender_id_fkey(full_name, email, role))').order('created_at', { ascending: false }).limit(50),
      supabase.from('muted_users').select('*, user:users!muted_users_user_id_fkey(id, full_name, email), mutedBy:users!muted_users_muted_by_fkey(id, full_name, email)').order('created_at', { ascending: false }).limit(50),
    ]);
    const update: Partial<AdminDataState> = {};
    if (!flaggedRes.error) update.flaggedMessages = flaggedRes.data || [];
    if (!reportsRes.error) update.messageReports = reportsRes.data || [];
    if (!mutedRes.error) update.mutedUsers = mutedRes.data || [];
    if (Object.keys(update).length) set(update);
  },

  fetchActivityLogs: async () => {
    const { data, error } = await supabase
      .from('activity_logs')
      .select('*, user:users!activity_logs_user_id_fkey(id, full_name, email, role, is_external, avatar_url)')
      .order('created_at', { ascending: false })
      .limit(500);
    if (!error) set({ activityLogs: data || [] });
  },

  // ── Realtime subscriptions ────────────────────────────────────────────────
  handleRealtimeEvent: async (payload: any) => {
    const { table, eventType, newRecord, oldRecord } = payload;
    
    // Refresh analytics when data changes
    get().refreshAnalytics();

    const fetchJoinedRecord = async (table: string, id: string) => {
      try {
        if (table === 'materials') {
          const { data } = await supabase
            .from('materials')
            .select('*, course:courses!materials_course_id_fkey(id, code, title, level, semester)')
            .eq('id', id)
            .single();
          return data;
        }
        if (table === 'past_questions') {
          const { data } = await supabase
            .from('past_questions')
            .select('*, course:courses!past_questions_course_id_fkey(id, code, title, level, semester)')
            .eq('id', id)
            .single();
          return data;
        }
        if (table === 'courses') {
          const { data } = await supabase
            .from('courses')
            .select('*, lecturer:lecturers!courses_lecturer_id_fkey(id, full_name, title)')
            .eq('id', id)
            .single();
          return data;
        }
        if (table === 'activity_logs') {
          const { data } = await supabase
            .from('activity_logs')
            .select('*, user:users!activity_logs_user_id_fkey(id, full_name, email, role)')
            .eq('id', id)
            .single();
          return data;
        }
        if (table === 'messages') {
          const { data } = await supabase
            .from('messages')
            .select('*, sender:users!messages_sender_id_fkey(id, full_name, email, role)')
            .eq('id', id)
            .single();
          return data;
        }
        if (table === 'message_reports') {
          const { data } = await supabase
            .from('message_reports')
            .select('*, reporter:users!message_reports_reported_by_fkey(id, full_name, email), message:messages(id, content, sender_id, sender:users!messages_sender_id_fkey(full_name, email, role))')
            .eq('id', id)
            .single();
          return data;
        }
        if (table === 'muted_users') {
          const { data } = await supabase
            .from('muted_users')
            .select('*, user:users!muted_users_user_id_fkey(id, full_name, email), mutedBy:users!muted_users_muted_by_fkey(id, full_name, email)')
            .eq('id', id)
            .single();
          return data;
        }
      } catch (err) {
        console.error('Error fetching joined record:', err);
      }
      return null;
    };

    if (eventType === 'DELETE' && oldRecord?.id) {
      const id = oldRecord.id;
      switch (table) {
        case 'materials': set(s => ({ materials: s.materials.filter(m => m.id !== id), resources: s.resources.filter(r => r.id !== id) })); break;
        case 'past_questions': set(s => ({ pastQuestions: s.pastQuestions.filter(p => p.id !== id), resources: s.resources.filter(r => r.id !== id) })); break;
        case 'announcements': set(s => ({ announcements: s.announcements.filter(a => a.id !== id), resources: s.resources.filter(r => r.id !== id) })); break;
        case 'events': set(s => ({ events: s.events.filter(e => e.id !== id), resources: s.resources.filter(r => r.id !== id) })); break;
        case 'courses': set(s => ({ courses: s.courses.filter(c => c.id !== id) })); break;
        case 'lecturers': set(s => ({ lecturers: s.lecturers.filter(l => l.id !== id) })); break;
        case 'executives': set(s => ({ executives: s.executives.filter(e => e.id !== id) })); break;
        case 'graduates': set(s => ({ graduates: s.graduates.filter(g => g.id !== id) })); break;
        case 'groups': set(s => ({ groups: s.groups.filter(g => g.id !== id) })); break;
        case 'users': set(s => ({ students: s.students.filter(u => u.id !== id) })); break;
        case 'resources': set(s => ({ resources: s.resources.filter(r => r.id !== id) })); break;
        case 'activity_logs': set(s => ({ activityLogs: s.activityLogs.filter(l => l.id !== id) })); break;
        case 'message_reports': set(s => ({ messageReports: s.messageReports.filter(r => r.id !== id) })); break;
        case 'muted_users': set(s => ({ mutedUsers: s.mutedUsers.filter(u => u.id !== id) })); break;
        case 'deleted_accounts': set(s => ({ deletedAccounts: s.deletedAccounts.filter(d => d.id !== id) })); break;
      }
      return;
    }

    if (eventType === 'INSERT' && newRecord) {
      const joinedTables = ['materials', 'past_questions', 'courses', 'activity_logs', 'messages', 'message_reports', 'muted_users'];
      let recordToUse = newRecord;
      if (joinedTables.includes(table)) {
        const fetched = await fetchJoinedRecord(table, newRecord.id);
        if (fetched) recordToUse = fetched;
      }
      switch (table) {
        case 'materials': set(s => ({ materials: [recordToUse as any, ...s.materials] })); break;
        case 'past_questions': set(s => ({ pastQuestions: [recordToUse as any, ...s.pastQuestions] })); break;
        case 'announcements': set(s => ({ announcements: [recordToUse as any, ...s.announcements] })); break;
        case 'events': set(s => ({ events: [...s.events, recordToUse as any] })); break;
        case 'courses': set(s => ({ courses: [...s.courses, recordToUse as any] })); break;
        case 'lecturers': set(s => ({ lecturers: [...s.lecturers, recordToUse as any] })); break;
        case 'executives': set(s => ({ executives: [...s.executives, recordToUse as any] })); break;
        case 'graduates': set(s => ({ graduates: [recordToUse as any, ...s.graduates] })); break;
        case 'groups': set(s => ({ groups: [...s.groups, { ...recordToUse, member_count: 0 } as any] })); break;
        case 'users': set(s => ({ students: [recordToUse as any, ...s.students] })); break;
        case 'resources': set(s => ({ resources: [recordToUse as any, ...s.resources] })); break;
        case 'activity_logs': set(s => ({ activityLogs: [recordToUse as any, ...s.activityLogs] })); break;
        case 'message_reports': set(s => ({ messageReports: [recordToUse as any, ...s.messageReports] })); break;
        case 'muted_users': set(s => ({ mutedUsers: [recordToUse as any, ...s.mutedUsers] })); break;
        case 'deleted_accounts': set(s => ({ deletedAccounts: [recordToUse as any, ...s.deletedAccounts] })); break;
        case 'messages':
          if ((recordToUse as any).is_flagged && !(recordToUse as any).is_deleted) {
            set(s => ({ flaggedMessages: [recordToUse as any, ...s.flaggedMessages] }));
          }
          break;
      }
      return;
    }

    if (eventType === 'UPDATE' && newRecord?.id) {
      const id = newRecord.id;
      const joinedTables = ['materials', 'past_questions', 'courses', 'activity_logs', 'messages', 'message_reports', 'muted_users'];
      let recordToUse = newRecord;
      if (joinedTables.includes(table)) {
        const fetched = await fetchJoinedRecord(table, id);
        if (fetched) recordToUse = fetched;
      }
      switch (table) {
        case 'materials': set(s => ({ materials: s.materials.map(m => m.id === id ? { ...m, ...recordToUse } as any : m) })); break;
        case 'past_questions': set(s => ({ pastQuestions: s.pastQuestions.map(p => p.id === id ? { ...p, ...recordToUse } as any : p) })); break;
        case 'announcements': set(s => ({ announcements: s.announcements.map(a => a.id === id ? { ...a, ...recordToUse } as any : a) })); break;
        case 'events': set(s => ({ events: s.events.map(e => e.id === id ? { ...e, ...recordToUse } as any : e) })); break;
        case 'courses': set(s => ({ courses: s.courses.map(c => c.id === id ? { ...c, ...recordToUse } as any : c) })); break;
        case 'lecturers': set(s => ({ lecturers: s.lecturers.map(l => l.id === id ? { ...l, ...recordToUse } as any : l) })); break;
        case 'executives': set(s => ({ executives: s.executives.map(e => e.id === id ? { ...e, ...recordToUse } as any : e) })); break;
        case 'graduates': set(s => ({ graduates: s.graduates.map(g => g.id === id ? { ...g, ...recordToUse } as any : g) })); break;
        case 'groups': set(s => ({ groups: s.groups.map(g => g.id === id ? { ...g, ...recordToUse } as any : g) })); break;
        case 'users': set(s => ({ students: s.students.map(u => u.id === id ? { ...u, ...recordToUse } as any : u) })); break;
        case 'resources': set(s => ({ resources: s.resources.map(r => r.id === id ? { ...r, ...recordToUse } as any : r) })); break;
        case 'activity_logs': set(s => ({ activityLogs: s.activityLogs.map(l => l.id === id ? { ...l, ...recordToUse } as any : l) })); break;
        case 'message_reports': set(s => ({ messageReports: s.messageReports.map(r => r.id === id ? { ...r, ...recordToUse } as any : r) })); break;
        case 'muted_users': set(s => ({ mutedUsers: s.mutedUsers.map(u => u.id === id ? { ...u, ...recordToUse } as any : u) })); break;
        case 'deleted_accounts': set(s => ({ deletedAccounts: s.deletedAccounts.map(d => d.id === id ? { ...d, ...recordToUse } as any : d) })); break;
        case 'messages':
          if (!(recordToUse as any).is_flagged || (recordToUse as any).is_deleted) {
            set(s => ({ flaggedMessages: s.flaggedMessages.filter(m => m.id !== id) }));
          } else {
            set(s => ({ flaggedMessages: s.flaggedMessages.map(m => m.id === id ? { ...m, ...recordToUse } as any : m) }));
          }
          break;
      }
    }
  },

  subscribe: () => {
    const tables = [
      'users', 'materials', 'past_questions', 'announcements',
      'events', 'courses', 'lecturers', 'executives',
      'resources', 'messages', 'message_reports', 'muted_users',
      'graduates', 'groups', 'activity_logs', 'system_settings',
      'archives', 'news', 'event_pools', 'moderator_permissions',
      'deleted_accounts'
    ];
    realtimeCoordinator.registerTables(tables);
    realtimeCoordinator.subscribe(get().handleRealtimeEvent);
  },

  unsubscribe: () => {
    realtimeCoordinator.unsubscribe(get().handleRealtimeEvent);
  },

}));

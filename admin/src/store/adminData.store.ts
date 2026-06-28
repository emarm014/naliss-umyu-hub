import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import { realtimeCoordinator } from '../lib/runtime/realtime';
import { cacheManager } from '../lib/runtime/cache';

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
      .select('*, departments(name, code)')
      .neq('role', 'super_admin')
      .order('created_at', { ascending: false })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw error;
    if (!data || data.length === 0) break;

    all.push(...(data as User[]));

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
  resubscribe: () => void;
  _channels: RealtimeChannel[];
  _syncTimer: ReturnType<typeof setTimeout> | null;
  _rtSyncTimer: ReturnType<typeof setTimeout> | null;
}

export const useAdminDataStore = create<AdminDataState>((set, get) => ({
  analytics: null,
  cloudinaryStorageBytes: null,
  students: [],
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
  _syncTimer: null,
  _rtSyncTimer: null,

  // ── Full sync — ALL queries backed by TanStack Query Client ────────────────
  syncAll: async (force = false) => {
    const now = new Date();
    const lastSyncTime = get().lastSync ? new Date(get().lastSync!) : null;
    const isInitialLoad = !get().lastSync;

    if (get().isSyncing || (!force && !isInitialLoad && lastSyncTime && now.getTime() - lastSyncTime.getTime() < 5000)) {
      return;
    }

    set({ isSyncing: true, error: null });

    const failedKeys: string[] = [];

    try {
      const fetchOrUseCache = async (key: string, queryFn: () => Promise<any>) => {
        if (force) {
          cacheManager.invalidate([key]);
        }
        const cached = cacheManager.get(key);
        if (cached !== undefined) return cached;

        const fresh = await queryFn();
        cacheManager.set(key, fresh);
        return fresh;
      };

      const safeFetch = async (key: string, queryFn: () => Promise<any>, currentValue: any) => {
        try {
          return await fetchOrUseCache(key, queryFn);
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
          }, get().analytics)
        }),
        async () => ({
          students: await safeFetch('students', () => fetchAllUsers(), get().students)
        }),
        async () => ({
          departments: await safeFetch('departments', async () => {
            const { data, error } = await supabase.from('departments').select('*').order('name', { ascending: true });
            if (error) throw error;
            return data || [];
          }, get().departments)
        }),
        async () => ({
          groups: await safeFetch('groups', async () => {
            const { data, error } = await supabase.rpc('get_groups_with_counts');
            if (error) throw error;
            return (data || []).map((g: any) => ({
              ...g,
              member_count: Number(g.member_count) || 0,
              moderator: g.moderator_id ? { id: g.moderator_id, full_name: g.moderator_full_name, email: g.moderator_email, role: g.moderator_role } : null,
            }));
          }, get().groups)
        }),
        async () => ({
          courses: await safeFetch('courses', async () => {
            const { data, error } = await supabase.from('courses').select('*, lecturer:lecturers!courses_lecturer_id_fkey(id, full_name, title)').order('code', { ascending: true });
            if (error) throw error;
            return data || [];
          }, get().courses)
        }),
        async () => ({
          materials: await safeFetch('materials', async () => {
            const { data, error } = await supabase.from('materials').select('*, course:courses!materials_course_id_fkey(id, code, title, level, semester)').order('created_at', { ascending: false }).limit(100);
            if (error) throw error;
            return data || [];
          }, get().materials)
        }),
        async () => ({
          pastQuestions: await safeFetch('pastQuestions', async () => {
            const { data, error } = await supabase.from('past_questions').select('*, course:courses!past_questions_course_id_fkey(id, code, title, level, semester)').order('created_at', { ascending: false }).limit(100);
            if (error) throw error;
            return data || [];
          }, get().pastQuestions)
        }),
        async () => ({
          resources: await safeFetch('resources', async () => {
            const { data, error } = await supabase.from('cloud_archive').select('*').order('created_at', { ascending: false }).limit(300);
            if (error) throw error;
            return (data || []).map((r: any) => ({ ...r, file_size: r.file_size || 0, file_type: r.file_type || null }));
          }, get().resources)
        }),
        async () => ({
          lecturers: await safeFetch('lecturers', async () => {
            const { data, error } = await supabase.from('lecturers').select('*').order('display_order', { ascending: true });
            if (error) throw error;
            return data || [];
          }, get().lecturers)
        }),
        async () => ({
          executives: await safeFetch('executives', async () => {
            const { data, error } = await supabase.from('executives').select('*').order('display_order', { ascending: true });
            if (error) throw error;
            return data || [];
          }, get().executives)
        }),
        async () => ({
          announcements: await safeFetch('announcements', async () => {
            const { data, error } = await supabase.from('announcements').select('*').order('created_at', { ascending: false }).limit(50);
            if (error) throw error;
            return data || [];
          }, get().announcements)
        }),
        async () => ({
          events: await safeFetch('events', async () => {
            const { data, error } = await supabase.from('events').select('*').order('start_date', { ascending: true });
            if (error) throw error;
            return data || [];
          }, get().events)
        }),
        async () => ({
          graduates: await safeFetch('graduates', async () => {
            const { data, error } = await supabase.from('graduates').select('*').order('graduation_year', { ascending: false });
            if (error) throw error;
            return data || [];
          }, get().graduates)
        }),
        async () => ({
          activityLogs: await safeFetch('activityLogs', async () => {
            const { data, error } = await supabase.from('activity_logs').select('*, user:users!activity_logs_user_id_fkey(id, full_name, email, role)').order('created_at', { ascending: false }).limit(50);
            if (error) throw error;
            return data || [];
          }, get().activityLogs)
        }),
        async () => ({
          flaggedMessages: await safeFetch('flaggedMessages', async () => {
            const { data, error } = await supabase.from('messages').select('*, sender:users!messages_sender_id_fkey(id, full_name, email, role)').eq('is_flagged', true).eq('is_deleted', false).order('created_at', { ascending: false }).limit(50);
            if (error) throw error;
            return data || [];
          }, get().flaggedMessages)
        }),
        async () => ({
          messageReports: await safeFetch('messageReports', async () => {
            const { data, error } = await supabase.from('message_reports').select('*, reporter:users!message_reports_reported_by_fkey(id, full_name, email), message:messages(id, content, sender_id, sender:users!messages_sender_id_fkey(full_name, email, role))').order('created_at', { ascending: false }).limit(50);
            if (error) throw error;
            return data || [];
          }, get().messageReports)
        }),
        async () => ({
          mutedUsers: await safeFetch('mutedUsers', async () => {
            const { data, error } = await supabase.from('muted_users').select('*, user:users!muted_users_user_id_fkey(id, full_name, email), mutedBy:users!muted_users_muted_by_fkey(id, full_name, email)').order('created_at', { ascending: false }).limit(50);
            if (error) throw error;
            return data || [];
          }, get().mutedUsers)
        }),
      ];

      // Run sequential batches of 4 to prevent browser queue stalling
      const combinedResults: Record<string, any> = {};
      const batchSize = 4;
      for (let i = 0; i < tasks.length; i += batchSize) {
        const batch = tasks.slice(i, i + batchSize);
        const batchResults = await Promise.all(batch.map(t => t()));
        batchResults.forEach(res => Object.assign(combinedResults, res));
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
      console.error('[Sync Engine] Critical unhandled sync error:', err);
      set({ error: (err as Error).message });
    } finally {
      set({ isSyncing: false });
    }
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
      .select('*, user:users!activity_logs_user_id_fkey(id, full_name, email, role)')
      .order('created_at', { ascending: false })
      .limit(200);
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
      'archives', 'news', 'event_pools', 'moderator_permissions'
    ];
    realtimeCoordinator.registerTables(tables);
    realtimeCoordinator.subscribe(get().handleRealtimeEvent);
  },

  unsubscribe: () => {
    realtimeCoordinator.unsubscribe(get().handleRealtimeEvent);
  },

  resubscribe: () => {
    get().unsubscribe();
    get().subscribe();
    get().syncAll(true);
  },
}));

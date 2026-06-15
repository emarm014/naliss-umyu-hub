import { create } from 'zustand';
import { supabase } from '../lib/supabase';

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
  _channels: [],
  _syncTimer: null,
  _rtSyncTimer: null,

  // ── Full sync — ALL queries fire in ONE parallel batch ────────────────────
  syncAll: async (force = false) => {
    const now = new Date();
    const lastSyncTime = get().lastSync ? new Date(get().lastSync!) : null;
    const isInitialLoad = !get().lastSync;

    if (get().isSyncing || (!force && !isInitialLoad && lastSyncTime && now.getTime() - lastSyncTime.getTime() < 1000)) {
      return;
    }

    set({ isSyncing: true, error: null });

    try {
      // ALL queries fire simultaneously — users are fetched with pagination
      const [
        analyticsRes, usersResult, depsRes, groupsRes,
        coursesRes, materialsRes, pqRes, resourcesRes,
        lecturersRes, executivesRes, announcementsRes, eventsRes,
        graduatesRes, logsRes, flaggedRes, reportsRes, mutedRes
      ] = await Promise.allSettled([
        supabase.rpc('fetch_admin_analytics'),
        fetchAllUsers(),
        supabase.from('departments').select('*').order('name', { ascending: true }),
        supabase.rpc('get_groups_with_counts'),
        supabase.from('courses').select('*, lecturer:lecturers!courses_lecturer_id_fkey(id, full_name, title)').order('code', { ascending: true }),
        supabase.from('materials').select('*, course:courses!materials_course_id_fkey(id, code, title, level, semester)').order('created_at', { ascending: false }).limit(100),
        supabase.from('past_questions').select('*, course:courses!past_questions_course_id_fkey(id, code, title, level, semester)').order('created_at', { ascending: false }).limit(100),
        supabase.from('cloud_archive').select('*').order('created_at', { ascending: false }).limit(300),
        supabase.from('lecturers').select('*').order('display_order', { ascending: true }),
        supabase.from('executives').select('*').order('display_order', { ascending: true }),
        supabase.from('announcements').select('*').order('created_at', { ascending: false }).limit(50),
        supabase.from('events').select('*').order('start_date', { ascending: true }),
        supabase.from('graduates').select('*').order('graduation_year', { ascending: false }),
        supabase.from('activity_logs').select('*, user:users!activity_logs_user_id_fkey(id, full_name, email, role)').order('created_at', { ascending: false }).limit(50),
        supabase.from('messages').select('*, sender:users!messages_sender_id_fkey(id, full_name, email, role)').eq('is_flagged', true).eq('is_deleted', false).order('created_at', { ascending: false }).limit(50),
        supabase.from('message_reports').select('*, reporter:users!message_reports_reported_by_fkey(id, full_name, email), message:messages(id, content, sender_id, sender:users!messages_sender_id_fkey(full_name, email, role))').order('created_at', { ascending: false }).limit(50),
        supabase.from('muted_users').select('*, user:users!muted_users_user_id_fkey(id, full_name, email), mutedBy:users!muted_users_muted_by_fkey(id, full_name, email)').order('created_at', { ascending: false }).limit(50),
      ]);

      const s: Partial<AdminDataState> = { lastSync: new Date().toISOString() };

      if (analyticsRes.status === 'fulfilled' && !analyticsRes.value.error) s.analytics = analyticsRes.value.data;
      // usersResult is a plain array (from fetchAllUsers) or a rejection
      if (usersResult.status === 'fulfilled') s.students = usersResult.value;
      if (depsRes.status === 'fulfilled' && !depsRes.value.error) s.departments = depsRes.value.data || [];
      if (groupsRes.status === 'fulfilled' && !groupsRes.value.error) {
        s.groups = (groupsRes.value.data || []).map((g: any) => ({
          ...g,
          member_count: Number(g.member_count) || 0,
          moderator: g.moderator_id ? { id: g.moderator_id, full_name: g.moderator_full_name, email: g.moderator_email, role: g.moderator_role } : null,
        }));
      }
      if (coursesRes.status === 'fulfilled' && !coursesRes.value.error) s.courses = coursesRes.value.data || [];
      if (materialsRes.status === 'fulfilled' && !materialsRes.value.error) s.materials = materialsRes.value.data || [];
      if (pqRes.status === 'fulfilled' && !pqRes.value.error) s.pastQuestions = pqRes.value.data || [];
      if (resourcesRes.status === 'fulfilled' && !resourcesRes.value.error) {
        s.resources = (resourcesRes.value.data || []).map((r: any) => ({ ...r, file_size: r.file_size || 0, file_type: r.file_type || null }));
      }
      if (lecturersRes.status === 'fulfilled' && !lecturersRes.value.error) s.lecturers = lecturersRes.value.data || [];
      if (executivesRes.status === 'fulfilled' && !executivesRes.value.error) s.executives = executivesRes.value.data || [];
      if (announcementsRes.status === 'fulfilled' && !announcementsRes.value.error) s.announcements = announcementsRes.value.data || [];
      if (eventsRes.status === 'fulfilled' && !eventsRes.value.error) s.events = eventsRes.value.data || [];
      if (graduatesRes.status === 'fulfilled' && !graduatesRes.value.error) s.graduates = graduatesRes.value.data || [];
      if (logsRes.status === 'fulfilled' && !logsRes.value.error) s.activityLogs = logsRes.value.data || [];
      if (flaggedRes.status === 'fulfilled' && !flaggedRes.value.error) s.flaggedMessages = flaggedRes.value.data || [];
      if (reportsRes.status === 'fulfilled' && !reportsRes.value.error) s.messageReports = reportsRes.value.data || [];
      if (mutedRes.status === 'fulfilled' && !mutedRes.value.error) s.mutedUsers = mutedRes.value.data || [];

      set(s);
    } catch (err: unknown) {
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
  subscribe: () => {
    if (get()._channels.length > 0) return;

    const tables = [
      'users', 'materials', 'past_questions', 'announcements',
      'events', 'courses', 'lecturers', 'executives',
      'resources', 'messages', 'message_reports', 'muted_users',
      'graduates', 'groups', 'activity_logs', 'system_settings'
    ];

    // Debounce analytics refresh only (not full sync) — 200ms is enough
    // Store the timer on the state so unsubscribe can cancel it and prevent
    // the callback from firing after channels are torn down.
    const debouncedAnalytics = () => {
      const existing = get()._syncTimer;
      if (existing) clearTimeout(existing);
      const timer = setTimeout(() => {
        set({ _syncTimer: null });
        get().refreshAnalytics();
      }, 1000);
      set({ _syncTimer: timer });
    };

    const debouncedSync = () => {
      const existing = get()._rtSyncTimer;
      if (existing) clearTimeout(existing);
      const timer = setTimeout(() => {
        set({ _rtSyncTimer: null });
        get().syncAll(true);
      }, 500);
      set({ _rtSyncTimer: timer });
    };

    const channels = tables.map(table =>
      supabase
        .channel(`admin_rt_${table}`)  // stable name — prevents duplicate channels on resubscribe
        .on('postgres_changes', { event: '*', schema: 'public', table }, (payload) => {
          const { eventType, old: oldRecord, new: newRecord } = payload;

          // Trigger debounced background sync to pull down complete joined relations
          debouncedSync();

          // ── INSTANT DELETE ───────────────────────────────────────────────
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
            debouncedAnalytics();
            return;
          }

          // ── INSTANT INSERT ───────────────────────────────────────────────
          if (eventType === 'INSERT' && newRecord) {
            switch (table) {
              case 'materials': set(s => ({ materials: [newRecord as any, ...s.materials] })); break;
              case 'past_questions': set(s => ({ pastQuestions: [newRecord as any, ...s.pastQuestions] })); break;
              case 'announcements': set(s => ({ announcements: [newRecord as any, ...s.announcements] })); break;
              case 'events': set(s => ({ events: [...s.events, newRecord as any] })); break;
              case 'courses': set(s => ({ courses: [...s.courses, newRecord as any] })); break;
              case 'lecturers': set(s => ({ lecturers: [...s.lecturers, newRecord as any] })); break;
              case 'executives': set(s => ({ executives: [...s.executives, newRecord as any] })); break;
              case 'graduates': set(s => ({ graduates: [newRecord as any, ...s.graduates] })); break;
              case 'groups': set(s => ({ groups: [...s.groups, { ...newRecord, member_count: 0 } as any] })); break;
              case 'users': set(s => ({ students: [newRecord as any, ...s.students] })); break;
              case 'resources': set(s => ({ resources: [newRecord as any, ...s.resources] })); break;
              case 'activity_logs': set(s => ({ activityLogs: [newRecord as any, ...s.activityLogs] })); break;
              case 'message_reports': set(s => ({ messageReports: [newRecord as any, ...s.messageReports] })); break;
              case 'muted_users': set(s => ({ mutedUsers: [newRecord as any, ...s.mutedUsers] })); break;
              // Only push to flaggedMessages if the new message is actually flagged
              case 'messages':
                if ((newRecord as any).is_flagged && !(newRecord as any).is_deleted) {
                  set(s => ({ flaggedMessages: [newRecord as any, ...s.flaggedMessages] }));
                }
                break;
            }
            debouncedAnalytics();
          }

          // ── INSTANT UPDATE ───────────────────────────────────────────────
          if (eventType === 'UPDATE' && newRecord?.id) {
            const id = newRecord.id;
            switch (table) {
              case 'materials': set(s => ({ materials: s.materials.map(m => m.id === id ? { ...m, ...newRecord } as any : m) })); break;
              case 'past_questions': set(s => ({ pastQuestions: s.pastQuestions.map(p => p.id === id ? { ...p, ...newRecord } as any : p) })); break;
              case 'announcements': set(s => ({ announcements: s.announcements.map(a => a.id === id ? { ...a, ...newRecord } as any : a) })); break;
              case 'events': set(s => ({ events: s.events.map(e => e.id === id ? { ...e, ...newRecord } as any : e) })); break;
              case 'courses': set(s => ({ courses: s.courses.map(c => c.id === id ? { ...c, ...newRecord } as any : c) })); break;
              case 'lecturers': set(s => ({ lecturers: s.lecturers.map(l => l.id === id ? { ...l, ...newRecord } as any : l) })); break;
              case 'executives': set(s => ({ executives: s.executives.map(e => e.id === id ? { ...e, ...newRecord } as any : e) })); break;
              case 'graduates': set(s => ({ graduates: s.graduates.map(g => g.id === id ? { ...g, ...newRecord } as any : g) })); break;
              case 'groups': set(s => ({ groups: s.groups.map(g => g.id === id ? { ...g, ...newRecord } as any : g) })); break;
              case 'users': set(s => ({ students: s.students.map(u => u.id === id ? { ...u, ...newRecord } as any : u) })); break;
              case 'resources': set(s => ({ resources: s.resources.map(r => r.id === id ? { ...r, ...newRecord } as any : r) })); break;
              case 'activity_logs': set(s => ({ activityLogs: s.activityLogs.map(l => l.id === id ? { ...l, ...newRecord } as any : l) })); break;
              case 'message_reports': set(s => ({ messageReports: s.messageReports.map(r => r.id === id ? { ...r, ...newRecord } as any : r) })); break;
              case 'muted_users': set(s => ({ mutedUsers: s.mutedUsers.map(u => u.id === id ? { ...u, ...newRecord } as any : u) })); break;
              // If a message is unflagged or deleted, remove it from the flagged list
              case 'messages':
                if (!(newRecord as any).is_flagged || (newRecord as any).is_deleted) {
                  set(s => ({ flaggedMessages: s.flaggedMessages.filter(m => m.id !== id) }));
                }
                break;
              // System settings changed — no full re-sync needed, settings are
              // managed independently by SettingsPage's own realtime subscription
              case 'system_settings':
                break;
            }
            // No analytics refresh needed for updates — counts don't change
          }
        })
        .subscribe()
    );

    set({ _channels: channels });
  },

  unsubscribe: () => {
    const timer = get()._syncTimer;
    if (timer) clearTimeout(timer);
    const rtTimer = get()._rtSyncTimer;
    if (rtTimer) clearTimeout(rtTimer);
    get()._channels.forEach(ch => supabase.removeChannel(ch));
    set({ _channels: [], _syncTimer: null, _rtSyncTimer: null });
  },

  resubscribe: () => {
    // Cancel any pending debounced calls before tearing down channels
    const timer = get()._syncTimer;
    if (timer) clearTimeout(timer);
    const rtTimer = get()._rtSyncTimer;
    if (rtTimer) clearTimeout(rtTimer);
    get()._channels.forEach(ch => supabase.removeChannel(ch));
    set({ _channels: [], _syncTimer: null, _rtSyncTimer: null });
    get().subscribe();
    get().syncAll(true);
  },
}));

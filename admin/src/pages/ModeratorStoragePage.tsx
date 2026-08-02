// placeholder moderator storage

import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { deleteFromCloudinary } from '../lib/cloudinaryDelete';
import { useAuthStore } from '../store/auth.store';
import { getAssignedLevels, getAllowedLevelsForPermission } from '../utils/access';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import {
  HardDrive, BookOpen, FileText, Megaphone, Calendar,
  Trash2, RefreshCw, AlertTriangle, CheckCircle2, Eye,
  BarChart3, Lock,
} from 'lucide-react';
import { format } from 'date-fns';

interface StorageItem {
  id: string;
  title: string;
  file_url: string | null;
  file_size: number | null;
  created_at: string;
  type: 'material' | 'past_question' | 'announcement' | 'event' | 'chat_media' | 'avatar' | 'news' | 'archive' | 'gallery_topic' | 'gallery_media' | 'featured_student';
  level?: string | null;
  uploader_name?: string | null;
  sender_name?: string | null;
  group_name?: string | null;
}

const fmtBytes = (b?: number | null) => {
  if (b === null || b === undefined) return '—';
  if (b === 0) return '0 B';
  const k = 1024, s = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return parseFloat((b / Math.pow(k, i)).toFixed(1)) + ' ' + s[i];
};

const TABLE_MAP: Record<string, string> = {
  material: 'materials',
  past_question: 'past_questions',
  announcement: 'announcements',
  event: 'events',
  chat_media: 'messages',
  avatar: 'users',
  news: 'news',
  archive: 'archives',
  gallery_topic: 'gallery_topics',
  gallery_media: 'gallery_media',
  featured_student: 'featured_students',
};

const TYPE_CONFIG = {
  material:      { label: 'Materials',      color: 'bg-blue-100 text-blue-700',    bar: 'bg-blue-500',    icon: BookOpen },
  past_question: { label: 'Past Questions', color: 'bg-amber-100 text-amber-700',  bar: 'bg-amber-500',   icon: FileText },
  announcement:  { label: 'Announcements',  color: 'bg-emerald-100 text-emerald-700', bar: 'bg-emerald-500', icon: Megaphone },
  event:         { label: 'Events',         color: 'bg-purple-100 text-purple-700', bar: 'bg-purple-500',  icon: Calendar },
  chat_media:    { label: 'Chat Media',     color: 'bg-sky-100 text-sky-700',      bar: 'bg-sky-500',     icon: HardDrive },
  avatar:        { label: 'Avatars',        color: 'bg-rose-100 text-rose-700',    bar: 'bg-rose-500',    icon: HardDrive },
  news:          { label: 'News',           color: 'bg-indigo-100 text-indigo-700',bar: 'bg-indigo-500',  icon: FileText },
  archive:       { label: 'Archives',       color: 'bg-orange-100 text-orange-700',bar: 'bg-orange-500',  icon: FileText },
  gallery_topic: { label: 'Gallery Topics', color: 'bg-pink-100 text-pink-700',    bar: 'bg-pink-500',    icon: HardDrive },
  gallery_media: { label: 'Gallery Media',  color: 'bg-fuchsia-100 text-fuchsia-700',bar: 'bg-fuchsia-500', icon: HardDrive },
  featured_student: { label: 'Featured Students', color: 'bg-teal-100 text-teal-700',bar: 'bg-teal-500', icon: HardDrive },
} as const;

export default function ModeratorStoragePage() {
  const { profile, permissions } = useAuthStore();
  const isSuperAdmin = profile?.role === 'super_admin';
  const isModerator = profile?.role === 'moderator';

  const assignedLevels = useMemo(() => isModerator ? getAssignedLevels(permissions) : null, [isModerator, permissions]);
  const allowedMatLevels = useMemo(() => isModerator ? getAllowedLevelsForPermission(permissions, 'can_manage_materials') : null, [isModerator, permissions]);
  const allowedPQLevels = useMemo(() => isModerator ? getAllowedLevelsForPermission(permissions, 'can_manage_past_questions') : null, [isModerator, permissions]);
  const allowedAnnLevels = useMemo(() => isModerator ? getAllowedLevelsForPermission(permissions, 'can_manage_announcements') : null, [isModerator, permissions]);
  const allowedEvLevels = useMemo(() => isModerator ? getAllowedLevelsForPermission(permissions, 'can_manage_events') : null, [isModerator, permissions]);

  // Memoize level keys as primitive string to prevent infinite reference re-creation loops
  const levelKeys = useMemo(() => [
    (assignedLevels || []).join(','),
    (allowedMatLevels || []).join(','),
    (allowedPQLevels || []).join(','),
    (allowedAnnLevels || []).join(','),
    (allowedEvLevels || []).join(',')
  ].join('|'), [assignedLevels, allowedMatLevels, allowedPQLevels, allowedAnnLevels, allowedEvLevels]);

  const [items, setItems] = useState<StorageItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<StorageItem['type'] | 'all'>('all');
  const [sortBy, setSortBy] = useState<'size' | 'date'>('size');

  const showSuccess = (msg: string) => {
    setSuccessMessage(msg);
    setTimeout(() => setSuccessMessage(null), 5000);
  };

  const fetchItems = useCallback(async (showLoader = true) => {
    if (showLoader) setIsLoading(true);
    setError(null);
    try {
      // Fetch materials
      let mats: any[] = [];
      if (!allowedMatLevels || allowedMatLevels.length > 0) {
        let matQ = supabase
          .from('materials')
          .select('id, title, file_url, file_size, created_at, level, uploaded_by')
          .not('file_url', 'is', null);
        if (allowedMatLevels && !isSuperAdmin) matQ = matQ.in('level', allowedMatLevels);
        const { data } = await matQ;
        mats = data || [];
      }

      // Fetch past questions
      let pqs: any[] = [];
      if (!allowedPQLevels || allowedPQLevels.length > 0) {
        let pqQ = supabase
          .from('past_questions')
          .select('id, title, file_url, file_size, created_at, level, uploaded_by');
        if (allowedPQLevels && !isSuperAdmin) pqQ = pqQ.in('level', allowedPQLevels);
        const { data } = await pqQ;
        pqs = data || [];
      }

      // Fetch announcements (cover images with size)
      let anns: any[] = [];
      if (!allowedAnnLevels || allowedAnnLevels.length > 0) {
        let annQ = supabase
          .from('announcements')
          .select('id, title, cover_image_url, cover_image_size, created_at, target_level, author_id')
          .not('cover_image_url', 'is', null);
        if (allowedAnnLevels && !isSuperAdmin) annQ = annQ.in('target_level', allowedAnnLevels);
        const { data } = await annQ;
        anns = data || [];
      }

      // Fetch events (cover images with size)
      let evs: any[] = [];
      if (!allowedEvLevels || allowedEvLevels.length > 0) {
        let evQ = supabase
          .from('events')
          .select('id, title, cover_image_url, cover_image_size, created_at, target_level, created_by');
        if (allowedEvLevels && !isSuperAdmin) evQ = evQ.in('target_level', allowedEvLevels);
        const { data } = await evQ;
        evs = data || [];
      }

      // Fetch chat media messages (images, videos, audio, documents sent in groups)
      const { data: chatMedia } = await supabase
        .from('messages')
        .select('id, content, message_type, file_size, metadata, created_at, group_id, sender_id, groups(name)')
        .in('message_type', ['image', 'video', 'audio', 'document'])
        .eq('is_deleted', false)
        .not('content', 'is', null)
        .order('created_at', { ascending: false })
        .limit(500);

      // Fetch user avatars — filter by assigned levels for moderators
      let avatarQ = supabase
        .from('users')
        .select('id, full_name, avatar_url, created_at, level')
        .not('avatar_url', 'is', null)
        .neq('avatar_url', '');
      if (assignedLevels && !isSuperAdmin) avatarQ = avatarQ.in('level', assignedLevels);
      const { data: avatarUsers } = await avatarQ;

      // Fetch news
      const { data: newsData } = await supabase
        .from('news')
        .select('id, title, image_url, created_at')
        .not('image_url', 'is', null);

      // Fetch archives
      const { data: archivesData } = await supabase
        .from('archives')
        .select('id, title, file_url, file_size, created_at')
        .not('file_url', 'is', null);

      // Fetch gallery topics
      const { data: galleryTopics } = await supabase
        .from('gallery_topics')
        .select('id, title, cover_image, created_at')
        .not('cover_image', 'is', null);

      // Fetch gallery media
      const { data: galleryMedia } = await supabase
        .from('gallery_media')
        .select('id, media_url, created_at, gallery_topics(title)')
        .not('media_url', 'is', null);

      // Fetch featured students
      const { data: featuredStudents } = await supabase
        .from('featured_students')
        .select('id, title, custom_image_url, created_at')
        .not('custom_image_url', 'is', null);

      const all: StorageItem[] = [
        ...(mats || []).map((m: any) => ({ id: m.id, title: m.title, file_url: m.file_url, file_size: m.file_size, created_at: m.created_at, type: 'material' as const, level: m.level })),
        ...(pqs || []).map((p: any) => ({ id: p.id, title: p.title, file_url: p.file_url, file_size: p.file_size, created_at: p.created_at, type: 'past_question' as const, level: p.level })),
        ...(anns || []).map((a: any) => ({ id: a.id, title: a.title, file_url: a.cover_image_url, file_size: a.cover_image_size ?? null, created_at: a.created_at, type: 'announcement' as const, level: a.target_level })),
        ...(evs || []).map((e: any) => ({ id: e.id, title: e.title, file_url: e.cover_image_url, file_size: e.cover_image_size ?? null, created_at: e.created_at, type: 'event' as const, level: e.target_level })),
        ...(chatMedia || []).map((m: any) => ({
          id: m.id,
          title: `${m.message_type.charAt(0).toUpperCase() + m.message_type.slice(1)} — ${(m.groups as any)?.name || 'Group Chat'}`,
          file_url: m.content,
          file_size: m.file_size ?? m.metadata?.size ?? null,
          created_at: m.created_at,
          type: 'chat_media' as const,
          group_name: (m.groups as any)?.name || null,
        })),
        ...(avatarUsers || []).map((u: any) => ({
          id: u.id,
          title: u.avatar_url?.includes('cloudinary.com') ? `Avatar — ${u.full_name || 'User'}` : `Default Avatar — ${u.full_name || 'User'}`,
          file_url: u.avatar_url,
          file_size: null,
          created_at: u.created_at,
          type: 'avatar' as const,
        })),
        ...(newsData || []).map((n: any) => ({ id: n.id, title: n.title, file_url: n.image_url, file_size: null, created_at: n.created_at, type: 'news' as const })),
        ...(archivesData || []).map((a: any) => ({ id: a.id, title: a.title, file_url: a.file_url, file_size: typeof a.file_size === 'string' ? null : a.file_size, created_at: a.created_at, type: 'archive' as const })),
        ...(galleryTopics || []).map((g: any) => ({ id: g.id, title: g.title, file_url: g.cover_image, file_size: null, created_at: g.created_at, type: 'gallery_topic' as const })),
        ...(galleryMedia || []).map((g: any) => ({ id: g.id, title: `Gallery Media — ${(g.gallery_topics as any)?.title || 'Topic'}`, file_url: g.media_url, file_size: null, created_at: g.created_at, type: 'gallery_media' as const })),
        ...(featuredStudents || []).map((f: any) => ({ id: f.id, title: f.title, file_url: f.custom_image_url, file_size: null, created_at: f.created_at, type: 'featured_student' as const })),
      ];

      setItems(all);
      setIsLoading(false); // Instantly display loaded UI

      // Non-blocking background fetch for Cloudinary HEAD file sizes
      const needsSize = all.filter(i =>
        i.file_size === null &&
        i.file_url?.includes('cloudinary.com')
      );

      if (needsSize.length > 0) {
        (async () => {
          const fetchSize = async (item: StorageItem): Promise<number | null> => {
            try {
              const res = await fetch(item.file_url!, { method: 'HEAD' });
              const len = res.headers.get('content-length');
              return len ? parseInt(len, 10) : null;
            } catch {
              return null;
            }
          };

          const batchSize = 5;
          for (let i = 0; i < needsSize.length; i += batchSize) {
            const batch = needsSize.slice(i, i + batchSize);
            const sizes = await Promise.all(batch.map(fetchSize));

            setItems(prev => prev.map(item => {
              const idx = batch.findIndex(b => b.id === item.id);
              if (idx === -1 || sizes[idx] === null) return item;
              return { ...item, file_size: sizes[idx] };
            }));

            for (let j = 0; j < batch.length; j++) {
              const item = batch[j];
              const size = sizes[j];
              if (size === null) continue;

              if (item.type === 'announcement') {
                supabase.from('announcements').update({ cover_image_size: size }).eq('id', item.id).then(() => {});
              } else if (item.type === 'event') {
                supabase.from('events').update({ cover_image_size: size }).eq('id', item.id).then(() => {});
              } else if (item.type === 'chat_media') {
                supabase.from('messages').update({ file_size: size }).eq('id', item.id).then(() => {});
              }
            }
          }
        })();
      }
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Failed to load storage data.');
      setIsLoading(false);
    }
  }, [levelKeys, isSuperAdmin]);

  useEffect(() => { fetchItems(true); }, [fetchItems]);

  // Real-time: subscribe once on mount without re-subscribing endlessly
  const fetchItemsRef = useRef(fetchItems);
  useEffect(() => { fetchItemsRef.current = fetchItems; }, [fetchItems]);

  useEffect(() => {
    const tables = ['materials', 'past_questions', 'announcements', 'events', 'messages', 'news', 'archives', 'gallery_topics', 'gallery_media', 'featured_students'];
    const channels = tables.map(table =>
      supabase
        .channel(`storage-watch:${table}`)
        .on('postgres_changes', { event: '*', schema: 'public', table }, () => { fetchItemsRef.current(false); })
        .subscribe()
    );

    return () => {
      channels.forEach(ch => supabase.removeChannel(ch));
    };
  }, []);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleDelete = async (item: StorageItem) => {
    if (!window.confirm(`Delete "${item.title}"? This permanently removes the file from Cloudinary.`)) return;

    setDeletingId(item.id);
    setDeleteError(null);

    try {
      if (item.file_url) {
        await deleteFromCloudinary([item.file_url]);
      }

      const table = TABLE_MAP[item.type];
      if (table === 'messages') {
        await supabase
          .from('messages')
          .update({ is_deleted: true, content: 'Attachment deleted by moderator' })
          .eq('id', item.id);
      } else if (table === 'users') {
        await supabase
          .from('users')
          .update({ avatar_url: null })
          .eq('id', item.id);
      } else if (table === 'announcements' || table === 'events') {
        await supabase
          .from(table)
          .update({ cover_image_url: null, cover_image_size: null })
          .eq('id', item.id);
      } else if (table === 'news') {
        await supabase
          .from('news')
          .update({ image_url: null })
          .eq('id', item.id);
      } else if (table) {
        await supabase
          .from(table)
          .delete()
          .eq('id', item.id);
      }

      setItems(prev => prev.filter(i => i.id !== item.id));
      showSuccess(`"${item.title}" deleted.`);
    } catch (e: unknown) {
      setDeleteError((e as Error)?.message || 'Failed to delete item.');
    } finally {
      setDeletingId(null);
    }
  };

  // ── Derived state ─────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = items;
    if (typeFilter !== 'all') list = list.filter(i => i.type === typeFilter);
    return list.sort((a, b) => {
      if (sortBy === 'size') return (b.file_size || 0) - (a.file_size || 0);
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [items, typeFilter, sortBy]);

  const stats = useMemo(() => {
    const totalBytes = items.reduce((acc, i) => acc + (i.file_size || 0), 0);
    const byType: Record<string, { count: number; bytes: number }> = {};
    items.forEach(i => {
      if (!byType[i.type]) byType[i.type] = { count: 0, bytes: 0 };
      byType[i.type].count++;
      byType[i.type].bytes += i.file_size || 0;
    });
    return { totalBytes, totalCount: items.length, byType };
  }, [items]);

  if (isLoading) return <LoadingSpinner size="lg" />;

  return (
    <div className="space-y-8 max-w-[1600px] mx-auto pb-12 animate-in fade-in duration-500">

      {/* Toast Messages */}
      {successMessage && (
        <div className="fixed bottom-10 right-10 z-[200] bg-primary-950 border border-primary-800 text-white px-8 py-5 rounded-[2rem] shadow-2xl flex items-center gap-5 animate-in slide-in-from-bottom-8 duration-400">
          <CheckCircle2 className="w-6 h-6 text-emerald-400 shrink-0" />
          <div>
            <p className="text-[10px] font-black tracking-[0.25em] text-primary-400 uppercase">Storage Action</p>
            <p className="text-sm font-bold">{successMessage}</p>
          </div>
        </div>
      )}
      {deleteError && (
        <div className="fixed bottom-10 right-10 z-[200] bg-red-600 border border-red-500 text-white px-8 py-5 rounded-[2rem] shadow-2xl flex items-center gap-5 animate-in slide-in-from-bottom-8 duration-400">
          <AlertTriangle className="w-6 h-6 shrink-0" />
          <div>
            <p className="text-[10px] font-black tracking-[0.25em] text-red-200 uppercase">Error</p>
            <p className="text-sm font-bold">{deleteError}</p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 bg-white p-8 rounded-3xl border border-gray-100 shadow-sm">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-1.5 h-8 bg-primary-950 rounded-full" />
            <h1 className="text-3xl font-black text-gray-900 tracking-tight uppercase">Storage Manager</h1>
          </div>
          {!isSuperAdmin && assignedLevels ? (
            <div className="flex items-center gap-3 mt-1">
              <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-xl">
                <Lock className="w-3.5 h-3.5 text-amber-600" />
                <span className="text-xs font-black text-amber-700 uppercase tracking-widest">
                  {assignedLevels.length === 1 ? `Level ${assignedLevels[0]} only` : `Managing Levels ${assignedLevels.join(', ')}`}
                </span>
              </div>
              <p className="text-gray-500 font-medium text-sm">
                View and delete files you manage. Deleting removes from Cloudinary and frees storage.
              </p>
            </div>
          ) : (
            <p className="text-gray-500 font-medium">
              All content storage across the platform. Delete files to free Cloudinary space.
            </p>
          )}
        </div>
        <button
          onClick={() => fetchItems(true)}
          disabled={isLoading}
          className="flex items-center gap-2 px-5 py-3 bg-primary-950 text-white rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-primary-800 transition-all disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Storage breakdown by type */}
      <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-8 h-8 bg-primary-950 rounded-xl flex items-center justify-center">
            <BarChart3 className="w-4 h-4 text-primary-400" />
          </div>
          <div>
            <h2 className="text-lg font-black text-gray-950 uppercase tracking-tight">Storage Breakdown</h2>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
              Total: {fmtBytes(stats.totalBytes)} across {items.length} files
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {(Object.entries(TYPE_CONFIG) as [StorageItem['type'], typeof TYPE_CONFIG[keyof typeof TYPE_CONFIG]][]).map(([type, cfg]) => {
            const s = stats.byType[type] || { count: 0, bytes: 0 };
            const pct = stats.totalBytes > 0 ? (s.bytes / stats.totalBytes) * 100 : 0;
            const Icon = cfg.icon;
            return (
              <div key={type} className="bg-gray-50 rounded-2xl border border-gray-100 p-5">
                <div className="flex items-center gap-3 mb-3">
                  <div className={`p-2 rounded-xl ${cfg.color}`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest">{cfg.label}</p>
                    <p className="text-lg font-black text-gray-950">{s.count} files</p>
                  </div>
                </div>
                <p className="text-sm font-bold text-gray-600 mb-2">{fmtBytes(s.bytes)}</p>
                <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className={`h-full ${cfg.bar} rounded-full transition-all duration-700`}
                    style={{ width: `${Math.max(pct, s.bytes > 0 ? 2 : 0)}%` }}
                  />
                </div>
                <p className="text-[9px] font-bold text-gray-400 mt-1">{pct.toFixed(1)}% of total</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex flex-col md:flex-row gap-4 items-center">
        <div className="flex gap-2 flex-wrap">
          {(['all', 'material', 'past_question', 'announcement', 'event', 'chat_media', 'avatar'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                typeFilter === t ? 'bg-primary-950 text-white shadow-lg' : 'bg-gray-50 text-gray-400 hover:bg-gray-100'
              }`}
            >
              {t === 'all' ? 'All' : TYPE_CONFIG[t as StorageItem['type']]?.label || t}
            </button>
          ))}
        </div>
        <div className="flex gap-2 ml-auto">
          <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest self-center">Sort:</span>
          {(['size', 'date'] as const).map(s => (
            <button
              key={s}
              onClick={() => setSortBy(s)}
              className={`px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                sortBy === s ? 'bg-primary-950 text-white' : 'bg-gray-50 text-gray-400 hover:bg-gray-100'
              }`}
            >
              {s === 'size' ? 'Largest First' : 'Newest First'}
            </button>
          ))}
        </div>
      </div>

      {/* File list */}
      {isLoading ? (
        <div className="flex items-center justify-center h-64 bg-white rounded-3xl border border-gray-100">
          <LoadingSpinner size="lg" />
        </div>
      ) : error ? (
        <div className="bg-white rounded-3xl p-12 text-center border border-red-100">
          <AlertTriangle className="w-10 h-10 text-red-400 mx-auto mb-3" />
          <p className="font-bold text-red-600">{error}</p>
          <button onClick={() => fetchItems(true)} className="mt-4 px-5 py-2 bg-primary-950 text-white rounded-xl text-xs font-black uppercase tracking-widest">Retry</button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-3xl p-20 text-center border-2 border-dashed border-gray-100">
          <HardDrive className="w-14 h-14 text-gray-200 mx-auto mb-4" />
          <h3 className="text-lg font-black text-gray-900">No files found</h3>
          <p className="text-gray-400 text-sm mt-1">No content with files for this level yet.</p>
        </div>
      ) : (
        <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-0 text-[9px] font-black text-gray-400 uppercase tracking-widest px-6 py-3 border-b border-gray-100 bg-gray-50">
            <span>File</span>
            <span className="text-right pr-8">Type</span>
            <span className="text-right pr-8">Size</span>
            <span className="text-right pr-8">Date</span>
            <span className="text-right">Action</span>
          </div>
          <div className="divide-y divide-gray-50">
            {filtered.map(item => {
              const cfg = TYPE_CONFIG[item.type];
              const Icon = cfg.icon;
              return (
                <div key={item.id} className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-0 items-center px-6 py-4 hover:bg-gray-50 transition-colors group">
                  {/* Title + level */}
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`p-2 rounded-xl shrink-0 ${cfg.color}`}>
                      <Icon className="w-3.5 h-3.5" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-gray-900 truncate">{item.title}</p>
                      {item.level && (
                        <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest">Level {item.level}</span>
                      )}
                    </div>
                  </div>
                  {/* Type badge */}
                  <div className="pr-8">
                    <span className={`px-2 py-0.5 rounded-lg text-[9px] font-black uppercase tracking-widest ${cfg.color}`}>
                      {cfg.label}
                    </span>
                  </div>
                  {/* Size */}
                  <div className="pr-8 text-right">
                    <span className={`text-xs font-bold ${item.file_size === null && item.file_url?.includes('cloudinary.com') ? 'text-gray-300' : 'text-gray-600'}`}>
                      {item.file_size === null && item.file_url?.includes('cloudinary.com')
                        ? <span className="inline-flex items-center gap-1 text-gray-300">
                            <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                            </svg>
                            <span className="text-[10px]">...</span>
                          </span>
                        : fmtBytes(item.file_size)
                      }
                    </span>
                  </div>
                  {/* Date */}
                  <div className="pr-8 text-right">
                    <span className="text-xs font-bold text-gray-400">{format(new Date(item.created_at), 'MMM d, yyyy')}</span>
                  </div>
                  {/* Actions */}
                  <div className="flex items-center gap-2">
                    {item.file_url && (
                      <a
                        href={item.file_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-2 text-gray-400 hover:text-primary-950 hover:bg-primary-50 rounded-xl transition-all"
                        title="Preview"
                      >
                        <Eye className="w-4 h-4" />
                      </a>
                    )}
                    {(() => {
                      const isSuperAdminItem = item.level === 'all';
                      const canDelete = isSuperAdmin || (!isSuperAdminItem);
                      if (!canDelete) return null;

                      return (
                        <button
                          onClick={() => handleDelete(item)}
                          disabled={deletingId === item.id}
                          className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all disabled:opacity-50"
                          title="Delete from Cloudinary"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      );
                    })()}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 flex items-center justify-between">
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
              {filtered.length} files · {fmtBytes(filtered.reduce((s, i) => s + (i.file_size || 0), 0))} total
            </p>
            <p className="text-[10px] font-bold text-gray-400">
              Deleting a file removes it from Cloudinary and the app permanently
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

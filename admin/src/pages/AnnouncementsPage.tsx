import { useEffect, useState, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/auth.store';
import { getAssignedLevels } from '../utils/access';
import type { Announcement } from '../types';
import { useShallow } from 'zustand/react/shallow';
import { useAdminDataStore } from '../store/adminData.store';
import ErrorState from '../components/ui/ErrorState';
import { logAdminActivity } from '../lib/activityLogger';
import {
  Plus,
  Search,
  Edit,
  Trash2,
  Eye,
  Send,
  Pin,
  XCircle,
  X,
  ChevronLeft,
  ChevronRight,
  Activity,
  LayoutDashboard,
  ShieldCheck,
  Clock,
  Database,
  CheckCircle2,
  AlertTriangle,
  Info
} from 'lucide-react';
import FileUpload from '../lib/FileUpload';
import { deleteFromCloudinary } from '../lib/cloudinaryDelete';
import { sendPushNotification, getUserIdsForLevel } from '../lib/notifications';
import { useFormDraft } from '../hooks/useFormDraft';

interface AnnouncementWithAuthor extends Announcement {
  author?: { full_name: string; email: string } | null;
}

const ITEMS_PER_PAGE = 10;

type LevelOption = 'all' | '100' | '200' | '300' | '400';
type CategoryOption = 'all' | 'general' | 'academic' | 'social' | 'event';

const priorityConfig = {
  low: { icon: Info, color: 'text-blue-600 bg-blue-50', label: 'Low' },
  normal: { icon: Info, color: 'text-gray-600 bg-gray-50', label: 'Normal' },
  high: { icon: AlertTriangle, color: 'text-orange-600 bg-orange-50', label: 'High' },
  urgent: { icon: XCircle, color: 'text-red-600 bg-red-50', label: 'Urgent' },
};

export default function AnnouncementsPage() {
  const { profile, permissions } = useAuthStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'published' | 'draft'>('all');
  const [categoryFilter, setCategoryFilter] = useState<CategoryOption>('all');
  const [priorityFilter] = useState<Announcement['priority'] | 'all'>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const assignedLevels = profile?.role === 'moderator' ? getAssignedLevels(permissions) : null;

  const { showModal, setShowModal, formData, setFormData, clearDraft } = useFormDraft('announcements_draft', {
    title: '',
    content: '',
    category: 'general',
    priority: 'normal',
    target_level: assignedLevels?.[0] || 'all',
    is_published: false,
    is_pinned: false,
    cover_image_url: '',
    cover_image_size: null as number | null,
  });
  const [selectedAnnouncement, setSelectedAnnouncement] = useState<AnnouncementWithAuthor | null>(null);
  const [levelFilter, setLevelFilter] = useState<LevelOption>('all');
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [actioningId, setActioningId] = useState<string | null>(null); // tracks which card is mid-action
  const { announcements: allAnnouncements, isSyncing, error: storeError, syncAll, removeAnnouncement, refreshAnalytics } = useAdminDataStore(
    useShallow((state) => ({
      announcements: state.announcements,
      isSyncing: state.isSyncing,
      error: state.error,
      syncAll: state.syncAll,
      removeAnnouncement: state.removeAnnouncement,
      refreshAnalytics: state.refreshAnalytics,
    }))
  );
  
  useEffect(() => {
    syncAll();
  }, [syncAll]);

  const location = useLocation();
  const [predefinedAsset, setPredefinedAsset] = useState<any>(null);

  // Detect and consume assets shared from the Cloud Archive
  useEffect(() => {
    const asset = (location.state as any)?.predefinedAsset;
    if (asset && !showModal) {
      setPredefinedAsset(asset);
      setShowModal('create');
      // Clean up location state to prevent re-opening on refresh
      window.history.replaceState({}, document.title);
    }
  }, [location, showModal]);

  const levelScopedAnnouncements = useMemo(() => {
    if (!assignedLevels) return allAnnouncements || [];
    return (allAnnouncements || []).filter(announcement => {
      const targetLevelStr = (announcement.target_level as string) || null;
      return !targetLevelStr || targetLevelStr === 'all' || targetLevelStr === 'general' || assignedLevels.includes(targetLevelStr as any);
    });
  }, [allAnnouncements, assignedLevels]);

  // Client-side filtering and pagination
  const filteredAnnouncements = useMemo(() => {
    return levelScopedAnnouncements.filter(announcement => {
      const matchesSearch = (announcement.title || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
                           (announcement.content || '').toLowerCase().includes(searchQuery.toLowerCase());
      const matchesStatus = statusFilter === 'all' || 
                           (statusFilter === 'published' && announcement.is_published) ||
                           (statusFilter === 'draft' && !announcement.is_published);
      const matchesCategory = categoryFilter === 'all' || announcement.category === categoryFilter;
      const targetLevelStr = (announcement.target_level as string) || null;
      const matchesLevel = (levelFilter as string) === 'all' || targetLevelStr === (levelFilter as string) || (!targetLevelStr && (levelFilter as string) === 'all');
      const matchesPriority = priorityFilter === 'all' || announcement.priority === priorityFilter;

      return matchesSearch && matchesStatus && matchesCategory && matchesLevel && matchesPriority;
    });
  }, [levelScopedAnnouncements, searchQuery, statusFilter, categoryFilter, levelFilter, priorityFilter]);

  const totalCount = filteredAnnouncements.length;
  const totalPages = Math.ceil(totalCount / ITEMS_PER_PAGE);
  const paginatedAnnouncements = filteredAnnouncements.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, statusFilter, categoryFilter, levelFilter, priorityFilter]);

  const handlePublish = async (announcement: AnnouncementWithAuthor) => {
    setActioningId(announcement.id);
    // Optimistic update
    useAdminDataStore.getState().updateAnnouncement({ ...announcement, is_published: true, published_at: new Date().toISOString() } as any);
    try {
      const { error } = await supabase
        .from('announcements')
        .update({ is_published: true, published_at: new Date().toISOString() })
        .eq('id', announcement.id);
      if (error) throw error;
      setSuccessMessage('Announcement published successfully');
      setTimeout(() => setSuccessMessage(null), 5000);
      // Push notification — fire and forget
      const targetIds = await getUserIdsForLevel(announcement.target_level || null);
      if (targetIds.length > 0) {
        sendPushNotification({
          targetUserIds: targetIds,
          title: '📢 New Announcement',
          body: announcement.title,
          data: {
            type: 'announcement',
            id: announcement.id,
            title: announcement.title,
            content: announcement.content,
            category: announcement.category,
            priority: announcement.priority,
            cover_image_url: announcement.cover_image_url || null,
            created_at: announcement.created_at,
            published_at: announcement.published_at || new Date().toISOString(),
          },
        });
      }
    } catch (err: unknown) {
      // Revert optimistic update
      useAdminDataStore.getState().updateAnnouncement(announcement as any);
      setErrorMessage('Failed to publish: ' + ((err as any)?.message || 'Unknown error'));
      setTimeout(() => setErrorMessage(null), 5000);
    } finally {
      setActioningId(null);
    }
  };

  const handleTogglePin = async (announcement: AnnouncementWithAuthor) => {
    setActioningId(announcement.id);
    const newPinned = !announcement.is_pinned;
    // Optimistic update
    useAdminDataStore.getState().updateAnnouncement({ ...announcement, is_pinned: newPinned } as any);
    try {
      const { error } = await supabase
        .from('announcements')
        .update({ is_pinned: newPinned })
        .eq('id', announcement.id);
      if (error) throw error;
      setSuccessMessage(`Announcement ${newPinned ? 'pinned' : 'unpinned'} successfully`);
      setTimeout(() => setSuccessMessage(null), 5000);
      logAdminActivity({
        action: newPinned ? 'announcement.pin' : 'announcement.unpin',
        entity_type: 'announcement',
        entity_id: announcement.id,
        description: `${newPinned ? 'Pinned' : 'Unpinned'} announcement: "${announcement.title}"`,
        metadata: { title: announcement.title, is_pinned: newPinned }
      });
    } catch (err: unknown) {
      // Revert
      useAdminDataStore.getState().updateAnnouncement(announcement as any);
      setErrorMessage('Failed to update pin: ' + ((err as any)?.message || 'Unknown error'));
      setTimeout(() => setErrorMessage(null), 5000);
    } finally {
      setActioningId(null);
    }
  };

  const handleDelete = async (id: string) => {
    const announcement = allAnnouncements.find(a => a.id === id);
    if (!window.confirm(`Are you sure you want to delete "${announcement?.title || 'this announcement'}"? This action cannot be undone.`)) {
      return;
    }

    // Capture cover URL BEFORE optimistic remove
    const coverUrl = announcement?.cover_image_url;

    // Optimistic: remove instantly
    removeAnnouncement(id);
    setSuccessMessage('Announcement deleted successfully');
    setTimeout(() => setSuccessMessage(null), 5000);

    logAdminActivity({
      action: 'announcement.delete',
      entity_type: 'announcement',
      entity_id: id,
      description: `Deleted announcement: "${announcement?.title || id}"`,
      metadata: { title: announcement?.title, category: announcement?.category }
    });

    try {
      const { error } = await supabase.from('announcements').delete().eq('id', id);
      if (error) {
        syncAll(true);
        setSuccessMessage(null);
      } else {
        deleteFromCloudinary([coverUrl]);
      }
    } catch {
      syncAll(true);
    }
  };

  return (
    <div className="p-8 lg:p-12 max-w-7xl mx-auto space-y-12 animate-in fade-in duration-700 pb-20">
      {/* Success Notification */}
      {successMessage && (
        <div className="fixed top-10 right-10 z-[100] bg-primary-950 border border-primary-800 text-white px-8 py-6 rounded-[2rem] shadow-2xl flex items-center gap-5 animate-in fade-in slide-in-from-right-10 duration-500 backdrop-blur-3xl">
          <div className="w-12 h-12 bg-primary-400 rounded-2xl flex items-center justify-center flex-shrink-0 shadow-lg shadow-primary-400/20">
            <Send className="w-6 h-6 text-primary-950" />
          </div>
          <div>
            <p className="font-black text-sm uppercase tracking-widest text-primary-400">Success</p>
            <p className="text-sm font-medium text-primary-100/80">{successMessage}</p>
          </div>
          <button onClick={() => setSuccessMessage(null)} className="p-2 hover:bg-white/5 rounded-xl transition-colors">
            <X className="w-5 h-5 text-primary-400/50" />
          </button>
        </div>
      )}

      {/* Error Notification */}
      {errorMessage && (
        <div className="fixed top-10 right-10 z-[100] bg-red-600 border border-red-500 text-white px-8 py-6 rounded-[2rem] shadow-2xl flex items-center gap-5 animate-in fade-in slide-in-from-right-10 duration-500">
          <div className="w-12 h-12 bg-red-700 rounded-2xl flex items-center justify-center flex-shrink-0">
            <XCircle className="w-6 h-6 text-white" />
          </div>
          <div>
            <p className="font-black text-sm uppercase tracking-widest text-red-200">Error</p>
            <p className="text-sm font-medium text-red-100">{errorMessage}</p>
          </div>
          <button onClick={() => setErrorMessage(null)} className="p-2 hover:bg-white/10 rounded-xl transition-colors">
            <X className="w-5 h-5 text-red-200" />
          </button>
        </div>
      )}

      {/* Broadcast Intelligence Header */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-8 pb-10 border-b border-gray-100">
        <div>
          <div className="flex items-center gap-3 mb-4">
            <div className="px-4 py-1 bg-primary-950 text-primary-400 rounded-full flex items-center gap-2 border border-primary-800/50 shadow-xl shadow-primary-950/20">
               <ShieldCheck className="w-3.5 h-3.5" />
               <span className="text-[10px] font-black uppercase tracking-[0.2em] italic">Announcement Manager</span>
            </div>
            <div className="px-4 py-1 bg-green-50 text-green-600 rounded-full flex items-center gap-2 border border-green-100">
               <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
               <span className="text-[10px] font-black uppercase tracking-widest text-green-700">Active</span>
            </div>
          </div>
          <h1 className="text-4xl lg:text-6xl font-black text-gray-950 tracking-tight leading-[0.9]">
            Notice & <br/>
            <span className="text-primary-600">Announcements.</span>
          </h1>
          <p className="text-gray-400 mt-6 text-lg font-medium max-w-xl leading-relaxed">
              Official communication gateway for students and staff within the NALISS community.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-4">
            <div className="flex items-center gap-4 px-6 py-4 bg-gray-50 rounded-[2rem] border border-gray-100 shadow-inner">
                <Clock className="w-5 h-5 text-gray-300" />
                <div className="flex flex-col">
                    <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Network Timestamp</span>
                    <span className="text-xs font-black text-gray-950">{new Date().toLocaleTimeString()}</span>
                </div>
            </div>
            <button
              onClick={() => setShowModal('create')}
              className="group relative flex items-center gap-3 px-8 py-5 bg-primary-950 text-primary-400 rounded-[2rem] font-black text-sm uppercase tracking-[0.2em] hover:bg-white hover:text-primary-950 transition-all duration-500 shadow-2xl shadow-primary-950/20 overflow-hidden"
            >
              <div className="absolute inset-0 bg-primary-400/10 translate-y-full group-hover:translate-y-0 transition-transform duration-500" />
              <Plus className="w-5 h-5 relative z-10" />
              <span className="relative z-10">Add Announcement</span>
            </button>
        </div>
      </div>

      {/* Broadcast Tiers Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="bg-white p-10 rounded-[3rem] border border-gray-100 shadow-sm flex flex-col gap-6 group hover:shadow-2xl transition-all duration-500 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-24 h-24 bg-primary-50 rounded-bl-[3rem] -mr-12 -mt-12 group-hover:bg-primary-100 transition-colors" />
            <div className="p-5 bg-primary-950 text-primary-400 rounded-2xl w-fit shadow-xl shadow-primary-950/20 group-hover:scale-110 group-hover:rotate-6 transition-all duration-500">
                <Database className="w-8 h-8" />
            </div>
            <div>
                <p className="text-[10px] font-black text-gray-300 uppercase tracking-[0.2em] mb-1">Total Announcements</p>
                <div className="flex items-baseline gap-3">
                    <p className="text-4xl font-black text-gray-950 tracking-tighter">{levelScopedAnnouncements.length.toLocaleString()}</p>
                    <div className="flex items-center gap-1 text-[10px] font-bold text-primary-600 bg-primary-50 px-2 py-0.5 rounded-full uppercase tracking-widest">
                        Total
                    </div>
                </div>
            </div>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-tight pt-4 border-t border-gray-50 flex items-center justify-between group-hover:text-primary-800 transition-colors">
                Announcement History
                <ChevronRight className="w-4 h-4 opacity-0 -translate-x-4 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-500" />
            </p>
        </div>

        <div className="bg-white p-10 rounded-[3rem] border border-gray-100 shadow-sm flex flex-col gap-6 group hover:shadow-2xl transition-all duration-500 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-24 h-24 bg-red-50 rounded-bl-[3rem] -mr-12 -mt-12 group-hover:bg-red-100 transition-colors" />
            <div className="p-5 bg-red-950 text-red-400 rounded-2xl w-fit shadow-xl shadow-red-950/20 group-hover:scale-110 group-hover:rotate-6 transition-all duration-500">
                <AlertTriangle className="w-8 h-8" />
            </div>
            <div>
                <p className="text-[10px] font-black text-gray-300 uppercase tracking-[0.2em] mb-1">Important Alerts</p>
                <div className="flex items-baseline gap-3">
                    <p className="text-4xl font-black text-gray-950 tracking-tighter">
                        {levelScopedAnnouncements.filter((a: Announcement) => a.priority === 'urgent' || a.priority === 'high').length}
                    </p>
                    <div className="flex items-center gap-1 text-[10px] font-bold text-red-600 bg-red-50 px-2 py-0.5 rounded-full uppercase tracking-widest">
                        High Priority
                    </div>
                </div>
            </div>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-tight pt-4 border-t border-gray-50 flex items-center justify-between group-hover:text-primary-800 transition-colors">
                Urgent Notifications
                <ChevronRight className="w-4 h-4 opacity-0 -translate-x-4 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-500" />
            </p>
        </div>

        <div className="bg-white p-10 rounded-[3rem] border border-gray-100 shadow-sm flex flex-col gap-6 group hover:shadow-2xl transition-all duration-500 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-50 rounded-bl-[3rem] -mr-12 -mt-12 group-hover:bg-emerald-100 transition-colors" />
            <div className="p-5 bg-emerald-950 text-emerald-400 rounded-2xl w-fit shadow-xl shadow-emerald-950/20 group-hover:scale-110 group-hover:rotate-6 transition-all duration-500">
                <Eye className="w-8 h-8" />
            </div>
            <div>
                <p className="text-[10px] font-black text-gray-300 uppercase tracking-[0.2em] mb-1">Total Reach</p>
                <div className="flex items-baseline gap-3">
                    <p className="text-4xl font-black text-gray-950 tracking-tighter">
                        {levelScopedAnnouncements.reduce((acc: number, curr: Announcement) => acc + (curr.view_count || 0), 0).toLocaleString()}
                    </p>
                    <div className="flex items-center gap-1 text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full uppercase tracking-widest">
                        Total Views
                    </div>
                </div>
            </div>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-tight pt-4 border-t border-gray-50 flex items-center justify-between group-hover:text-primary-800 transition-colors">
                Engagement Stats
                <ChevronRight className="w-4 h-4 opacity-0 -translate-x-4 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-500" />
            </p>
        </div>
      </div>

      {/* Filter Options */}
      <div className="bg-white p-8 rounded-[3rem] border border-gray-100 shadow-sm flex flex-col md:flex-row gap-6 items-center group hover:shadow-xl transition-all duration-500">
        <div className="flex-1 w-full relative">
          <Search className="absolute left-6 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-300 group-focus-within:text-primary-600 transition-colors" />
          <input
            type="text"
            placeholder="Search announcements..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-16 pr-8 py-5 bg-gray-50 border-none rounded-[2rem] focus:ring-2 focus:ring-primary-950 font-medium text-gray-950 placeholder:text-gray-300 transition-all shadow-inner"
          />
        </div>
        <div className="flex flex-wrap md:flex-nowrap gap-4 w-full md:w-fit">
          <select
            value={levelFilter}
            onChange={(e) => setLevelFilter(e.target.value as LevelOption)}
            disabled={!!assignedLevels && assignedLevels.length === 1}
            className="flex-1 md:w-40 px-6 py-5 bg-gray-50 border-none rounded-[2rem] focus:ring-2 focus:ring-primary-950 font-black text-[10px] uppercase tracking-widest text-gray-600 disabled:opacity-50 appearance-none text-center shadow-inner cursor-pointer"
          >
            {(!assignedLevels || assignedLevels.length > 1) && <option value="all">Global Tier</option>}
            <option value="100">Level 100</option>
            <option value="200">Level 200</option>
            <option value="300">Level 300</option>
            <option value="400">Level 400</option>
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'all' | 'published' | 'draft')}
            className="flex-1 md:w-40 px-6 py-5 bg-gray-50 border-none rounded-[2rem] focus:ring-2 focus:ring-primary-950 font-black text-[10px] uppercase tracking-widest text-gray-600 appearance-none text-center shadow-inner cursor-pointer"
          >
            <option value="all">All Status</option>
            <option value="published">Published</option>
            <option value="draft">Draft</option>
          </select>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as CategoryOption)}
            className="flex-1 md:w-40 px-6 py-5 bg-gray-50 border-none rounded-[2rem] focus:ring-2 focus:ring-primary-950 font-black text-[10px] uppercase tracking-widest text-gray-600 appearance-none text-center shadow-inner cursor-pointer"
          >
            <option value="all">Categories</option>
            <option value="general">General</option>
            <option value="academic">Academic</option>
            <option value="social">Social</option>
            <option value="event">Events</option>
          </select>
        </div>
      </div>

      <div className="flex items-center justify-between px-2">
          <p className="text-[10px] font-black text-gray-300 uppercase tracking-[0.2em] italic">
              Displaying {paginatedAnnouncements.length} / {totalCount} Records
          </p>
          <div className="h-px flex-1 mx-8 bg-gray-100/50" />
          <button className="flex items-center gap-2 text-[10px] font-black text-primary-600 uppercase tracking-widest hover:text-primary-800 transition-colors">
              <Activity className="w-3.5 h-3.5" />
              Statistics
          </button>
      </div>

      {/* Announcements List */}
      <div className="space-y-8">
        {(isSyncing && allAnnouncements.length === 0) ? (
          <div className="flex flex-col items-center justify-center py-24 bg-white rounded-[3rem] border border-gray-100 shadow-sm gap-6">
            <div className="relative">
                <div className="w-16 h-16 border-4 border-primary-100 border-t-primary-600 rounded-full animate-spin" />
                <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-8 h-8 bg-primary-950 rounded-lg animate-pulse" />
                </div>
            </div>
            <p className="text-[10px] font-black text-gray-300 uppercase tracking-[0.2em] animate-pulse italic">Loading Announcements...</p>
          </div>
        ) : storeError ? (
          <div className="py-12">
            <ErrorState onRetry={syncAll} message={storeError} />
          </div>
        ) : paginatedAnnouncements.length === 0 ? (
          <div className="bg-white rounded-[3rem] border border-gray-100 shadow-sm p-24 text-center flex flex-col items-center gap-6">
            <div className="w-20 h-20 bg-gray-50 rounded-[2rem] flex items-center justify-center border border-gray-100">
                <Database className="w-10 h-10 text-gray-200" />
            </div>
            <div>
                <p className="text-xl font-black text-gray-950 tracking-tight">No Announcements Found</p>
                <p className="text-sm text-gray-400 mt-1 font-medium">There are currently no announcements to display.</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-8">
            {paginatedAnnouncements.map((announcement: AnnouncementWithAuthor) => {
              const priority = priorityConfig[announcement.priority as keyof typeof priorityConfig] || priorityConfig.normal;
              const PriorityIcon = priority.icon;
              
              return (
                <div
                  key={announcement.id}
                  className={`group bg-white rounded-[3rem] border border-gray-100 shadow-sm hover:shadow-2xl transition-all duration-700 overflow-hidden relative ${
                    announcement.is_pinned ? 'ring-2 ring-primary-500 ring-offset-4' : ''
                  }`}
                >
                  <div className="p-10 flex flex-col lg:flex-row gap-10">
                    {/* Visual Anchor */}
                    <div className="lg:w-72 h-48 lg:h-auto bg-gray-50 rounded-[2.5rem] border border-gray-100 overflow-hidden shrink-0 relative">
                        {announcement.cover_image_url ? (
                            <img 
                                src={announcement.cover_image_url} 
                                alt={announcement.title}
                                className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-1000"
                            />
                        ) : (
                            <div className="w-full h-full flex items-center justify-center bg-primary-950 relative overflow-hidden">
                                <div className="absolute inset-0 bg-primary-400/5 rotate-12" />
                                <LayoutDashboard className="w-16 h-16 text-primary-400/20 relative z-10" />
                            </div>
                        )}
                        <div className="absolute top-6 left-6 z-10">
                            <span className={`px-4 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest flex items-center gap-2 shadow-2xl backdrop-blur-md ${priority.color}`}>
                                <PriorityIcon className="w-3.5 h-3.5" />
                                {priority.label}
                            </span>
                        </div>
                    </div>

                    {/* Content Intelligence */}
                    <div className="flex-1 flex flex-col justify-between py-2">
                        <div>
                            <div className="flex items-center gap-4 mb-4">
                                {announcement.is_pinned && (
                                    <span className="flex items-center gap-1 text-[9px] font-black text-primary-600 bg-primary-50 px-3 py-1 rounded-lg uppercase tracking-widest border border-primary-100">
                                        <Pin className="w-3 h-3" />
                                        Pinned
                                    </span>
                                )}
                                <span className={`text-[9px] font-black px-3 py-1 rounded-lg uppercase tracking-widest border ${
                                    announcement.is_published 
                                    ? 'bg-green-50 text-green-600 border-green-100' 
                                    : 'bg-slate-50 text-slate-500 border-slate-200'
                                }`}>
                                    {announcement.is_published ? 'Published' : 'Draft'}
                                </span>
                                <span className="text-[9px] font-black text-gray-300 uppercase tracking-widest italic">{announcement.category} tier</span>
                            </div>
                            <h3 className="text-2xl font-black text-gray-950 tracking-tight group-hover:text-primary-600 transition-colors mb-4 line-clamp-1">
                                {announcement.title}
                            </h3>
                            <p className="text-sm text-gray-400 leading-relaxed font-medium line-clamp-2 mb-6">
                                {announcement.content}
                            </p>
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-6 pt-6 border-t border-gray-50">
                            <div className="flex items-center gap-8">
                                <div className="flex items-center gap-3">
                                    <div className="w-9 h-9 bg-primary-950 text-primary-400 rounded-xl flex items-center justify-center text-[10px] font-black border border-primary-800 shadow-xl shadow-primary-950/10">
                                        {announcement.author?.full_name?.charAt(0) || 'S'}
                                    </div>
                                    <div className="flex flex-col">
                                        <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Archivist</span>
                                        <span className="text-xs font-black text-gray-950 tracking-tight">{announcement.author?.full_name || 'System Auditor'}</span>
                                    </div>
                                </div>
                                <div className="flex flex-col">
                                    <span className="text-xs font-black text-gray-950 tracking-tight">
                                        {new Date(announcement.created_at).toLocaleDateString()}
                                    </span>
                                </div>
                                <div className="flex flex-col">
                                    <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Engagement</span>
                                    <span className="text-xs font-black text-primary-600 flex items-center gap-1.5 leading-none mt-0.5">
                                        <Eye className="w-3.5 h-3.5" />
                                        {announcement.view_count.toLocaleString()} <span className="text-[10px] text-gray-300 ml-0.5 uppercase tracking-tighter">Views</span>
                                    </span>
                                </div>
                            </div>

                            {(() => {
                                const isSuperAdminAuthored = (announcement as any).author?.role === 'super_admin' || (announcement.target_level as string) === 'all';
                                const canManage = profile?.role === 'super_admin' || (!isSuperAdminAuthored && announcement.author_id === profile?.id);

                                if (!canManage) {
                                    return (
                                        <span className="text-[10px] font-black text-amber-600 bg-amber-50 px-3 py-1.5 rounded-xl uppercase tracking-wider border border-amber-200">
                                            {(announcement.target_level as string) === 'all' ? 'General Broadcast (Read-Only)' : 'Super Admin Post (Read-Only)'}
                                        </span>
                                    );
                                }

                                return (
                                    <div className="flex items-center gap-3">
                                        <button
                                            onClick={() => handleTogglePin(announcement)}
                                            disabled={actioningId === announcement.id}
                                            className={`p-3 rounded-xl transition-all disabled:opacity-50 ${announcement.is_pinned ? 'text-primary-600 bg-primary-50 border border-primary-100' : 'text-gray-300 bg-gray-50 hover:bg-white hover:text-primary-600 border border-transparent hover:border-gray-100'}`}
                                            title={announcement.is_pinned ? 'Unpin' : 'Pin Strategic'}
                                        >
                                            <Pin className="h-5 w-5" />
                                        </button>
                                        {!announcement.is_published && (
                                            <button
                                                onClick={() => handlePublish(announcement)}
                                                disabled={actioningId === announcement.id}
                                                className="p-3 bg-green-50 text-green-600 rounded-xl border border-green-100 hover:bg-green-600 hover:text-white transition-all shadow-xl shadow-green-600/5 disabled:opacity-50"
                                                title="Commit to Broadcast"
                                            >
                                                <Send className="h-5 w-5" />
                                            </button>
                                        )}
                                        <button
                                            onClick={() => {
                                                setSelectedAnnouncement(announcement);
                                                setShowModal('edit');
                                            }}
                                            className="p-3 text-gray-400 hover:text-primary-950 bg-gray-50 hover:bg-white rounded-xl transition-all border border-transparent hover:border-gray-100"
                                            title="Modify Notice"
                                        >
                                            <Edit className="h-5 w-5" />
                                        </button>
                                        <button
                                            onClick={() => handleDelete(announcement.id)}
                                            className="p-3 text-red-400 hover:text-red-600 bg-red-50/50 hover:bg-red-50 rounded-xl transition-all border border-transparent hover:border-red-100"
                                            title="Expunge Broadcast"
                                        >
                                            <Trash2 className="h-5 w-5" />
                                        </button>
                                    </div>
                                );
                            })()}
                        </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Pagination Controls */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-10 pt-10 border-t border-gray-50">
          <button
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            className="group flex items-center gap-4 text-[10px] font-black text-gray-400 uppercase tracking-[0.25em] hover:text-primary-950 disabled:opacity-30 transition-all"
          >
            <div className="w-12 h-12 bg-gray-50 rounded-2xl flex items-center justify-center group-hover:bg-primary-950 group-hover:text-primary-400 transition-all border border-gray-100">
                <ChevronLeft className="h-5 w-5" />
            </div>
            Previous
          </button>
          
          <div className="flex items-center gap-3">
              <span className="text-[10px] font-black text-gray-300 uppercase tracking-widest">Page</span>
              <div className="px-6 py-3 bg-primary-950 text-primary-400 rounded-xl font-black text-xs shadow-xl ring-4 ring-primary-50">
                {currentPage} <span className="mx-2 opacity-50">/</span> {totalPages}
              </div>
          </div>

          <button
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
            className="group flex items-center gap-4 text-[10px] font-black text-gray-400 uppercase tracking-[0.25em] hover:text-primary-950 disabled:opacity-30 transition-all text-right"
          >
            Next
            <div className="w-12 h-12 bg-gray-50 rounded-2xl flex items-center justify-center group-hover:bg-primary-950 group-hover:text-primary-400 transition-all border border-gray-100">
                <ChevronRight className="h-5 w-5" />
            </div>
          </button>
        </div>
      )}

      {/* Create/Edit Modal */}
      {(showModal === 'create' || showModal === 'edit') && (
        <AnnouncementFormModal
          announcement={selectedAnnouncement}
          predefinedAsset={predefinedAsset}
          assignedLevels={assignedLevels}
          formData={formData}
          setFormData={setFormData}
          onClose={() => {
            if (showModal === 'create') clearDraft();
            else setShowModal(null);
            setSelectedAnnouncement(null);
          }}
          onSave={(msg) => {
            setSuccessMessage(msg);
            if (showModal === 'create') clearDraft();
            else setShowModal(null);
            setSelectedAnnouncement(null);
            refreshAnalytics();
            setTimeout(() => setSuccessMessage(null), 5000);
          }}
        />
      )}
    </div>
  );
}

interface AnnouncementFormModalProps {
  announcement: AnnouncementWithAuthor | null;
  predefinedAsset?: any;
  assignedLevels: LevelOption[] | null;
  formData: any;
  setFormData: (data: any) => void;
  onClose: () => void;
  onSave: (message: string) => void;
}

function AnnouncementFormModal({
  announcement,
  predefinedAsset,
  assignedLevels,
  formData,
  setFormData,
  onClose,
  onSave,
}: AnnouncementFormModalProps) {
  const { profile: authProfile } = useAuthStore();
  const [localFormData, setLocalFormData] = useState({
    title: announcement?.title || predefinedAsset?.title || '',
    content: announcement?.content || '',
    category: announcement?.category || 'general',
    priority: announcement?.priority || 'normal',
    target_level: (announcement?.target_level as LevelOption) || assignedLevels?.[0] || 'all',
    is_published: announcement?.is_published || false,
    is_pinned: announcement?.is_pinned || false,
    cover_image_url: announcement?.cover_image_url || predefinedAsset?.url || '',
    cover_image_size: (announcement as any)?.cover_image_size || null as number | null,
  });
  
  const isEditing = !!announcement;
  const currentFormData = isEditing ? localFormData : formData;
  const setCurrentFormData = isEditing ? setLocalFormData : setFormData;
  
  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = async (e?: React.FormEvent | React.MouseEvent) => {
    e?.preventDefault();
    setErrorMsg(null);

    if (!currentFormData.title.trim()) { setErrorMsg('Title is required.'); return; }
    if (!currentFormData.content.trim()) { setErrorMsg('Content is required.'); return; }

    setIsSaving(true);

    try {
      if (!authProfile?.id) throw new Error('Not authenticated');

      const data = {
        ...currentFormData,
        author_id: authProfile.id,
        target_level: currentFormData.target_level === 'all' ? null : currentFormData.target_level,
        published_at: currentFormData.is_published ? new Date().toISOString() : null,
      };

      let insertedId: string | null = null;
      if (announcement) {
        const { data: updated, error } = await supabase.from('announcements').update(data).eq('id', announcement.id).select('*').single();
        if (error) throw error;
        if (updated) {
          useAdminDataStore.getState().updateAnnouncement(updated as any);
          await supabase.from('activity_logs').insert({
            user_id: authProfile?.id,
            action: 'announcement.update',
            entity_id: updated.id,
            entity_type: 'announcement',
            description: `Updated announcement: "${updated.title}"`,
            metadata: {
              target: { id: updated.id, title: updated.title, level: updated.target_level },
              actor: { id: authProfile?.id, full_name: authProfile?.full_name, role: authProfile?.role }
            }
          });
        }
      } else {
        const { data: inserted, error: insertError } = await supabase
          .from('announcements')
          .insert([data])
          .select('*')
          .single();
        if (insertError) throw insertError;
        insertedId = inserted?.id || null;
        if (inserted) {
          useAdminDataStore.getState().addAnnouncement(inserted as any);
          await supabase.from('activity_logs').insert({
            user_id: authProfile?.id,
            action: 'announcement.create',
            entity_id: inserted.id,
            entity_type: 'announcement',
            description: `Created announcement: "${inserted.title}"`,
            metadata: {
              target: { id: inserted.id, title: inserted.title, level: inserted.target_level },
              actor: { id: authProfile?.id, full_name: authProfile?.full_name, role: authProfile?.role }
            }
          });
        }
      }

      // Push notification when publishing (new or updated to published)
      if (formData.is_published) {
        const targetLevel = formData.target_level === 'all' ? null : formData.target_level;
        getUserIdsForLevel(targetLevel).then(targetIds => {
          if (targetIds.length > 0) {
            sendPushNotification({
              targetUserIds: targetIds,
              title: '📢 New Announcement',
              body: currentFormData.title,
              data: {
                type: 'announcement',
                id: insertedId || announcement?.id || '',
                title: currentFormData.title,
                content: currentFormData.content,
                category: currentFormData.category,
                priority: currentFormData.priority,
                cover_image_url: currentFormData.cover_image_url || null,
                created_at: announcement?.created_at || new Date().toISOString(),
                published_at: data.published_at || new Date().toISOString(),
              },
            });
          }
        });
      }

      onSave(`Announcement "${currentFormData.title}" ${announcement ? 'updated' : 'created'} successfully!`);
    } catch (err: unknown) {
      const msg = (err as any)?.message || (err as any)?.error_description || JSON.stringify(err);
      setErrorMsg(`Failed to save announcement: ${msg}`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-md flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-3xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col border border-white animate-in zoom-in-95 duration-300">
        <div className="p-10 border-b border-gray-50 flex items-center justify-between bg-gray-50/50">
          <div>
            <h2 className="text-xl font-bold text-slate-900">
              {announcement ? 'Edit Announcement' : 'Add to Mobile App'}
            </h2>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">Announcement Details</p>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-all">
            <X className="h-6 w-6" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-10 space-y-8 overflow-y-auto flex-1">
          <div className="space-y-6">
              <div className="space-y-4">
                  <div className="flex items-center gap-3 ml-1">
                      <div className="w-1.5 h-6 bg-primary-600 rounded-full" />
                      <span className="text-[11px] font-black text-gray-400 uppercase tracking-widest">General Information</span>
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 ml-1">Notice Title</label>
                    <input
                      type="text"
                      value={currentFormData.title}
                      onChange={(e) => setCurrentFormData({ ...currentFormData, title: e.target.value })}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary-950/10 focus:border-primary-950 text-sm font-bold text-slate-900 placeholder:text-slate-400 transition-all"
                      placeholder="Enter title..."
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 ml-1">Notice Content</label>
                    <textarea
                      value={currentFormData.content}
                      onChange={(e) => setCurrentFormData({ ...currentFormData, content: e.target.value })}
                      rows={6}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary-950/10 focus:border-primary-950 text-sm font-medium text-slate-900 placeholder:text-slate-400 transition-all min-h-[160px] resize-none"
                      placeholder="Write your broadcast content here..."
                    />
                  </div>
              </div>

              <div className="space-y-6">
                <div className="flex items-center gap-3 ml-1">
                    <div className="w-1.5 h-6 bg-emerald-600 rounded-full" />
                    <span className="text-[11px] font-black text-gray-400 uppercase tracking-widest">Media</span>
                </div>
                <div className="p-4 border-2 border-dashed border-slate-200 rounded-xl bg-slate-50">
                  {currentFormData.cover_image_url ? (
                    <div className="flex items-center justify-between p-3 bg-white border border-slate-200 rounded-xl shadow-sm">
                      <div className="flex items-center gap-3 overflow-hidden">
                        <img src={currentFormData.cover_image_url} alt="Cover" className="w-10 h-10 object-cover rounded-lg shrink-0" />
                        <div className="truncate">
                          <p className="text-sm font-bold text-slate-900 truncate">Cover Image Attached</p>
                          <p className="text-xs text-slate-500 font-medium truncate">{currentFormData.cover_image_url.split('/').pop()}</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setCurrentFormData({ ...currentFormData, cover_image_url: '', cover_image_size: null })}
                        className="p-2 text-rose-400 hover:bg-rose-50 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <FileUpload
                      accept="image/*"
                      isImage={true}
                      folder="announcements"
                      onUploadComplete={(url: string, file: File) => setCurrentFormData((prev: any) => ({ ...prev, cover_image_url: url, cover_image_size: file.size }))}
                      label="Announcement Cover"
                      description="Upload an image for this announcement"
                    />
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 lg:grid-cols-3 gap-6 pt-4">
                <div className="space-y-2">
                  <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Category</label>
                  <select
                    value={currentFormData.category}
                    onChange={(e) => setCurrentFormData({ ...currentFormData, category: e.target.value as Announcement['category'] })}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary-950/10 focus:border-primary-950 text-sm font-bold text-slate-700 transition-all appearance-none cursor-pointer"
                  >
                    <option value="general">General</option>
                    <option value="academic">Academic</option>
                    <option value="social">Social</option>
                    <option value="urgent">Urgent</option>
                    <option value="official">Official</option>
                    <option value="event">Event</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Priority Pulse</label>
                  <select
                    value={currentFormData.priority}
                    onChange={(e) => setCurrentFormData({ ...currentFormData, priority: e.target.value as Announcement['priority'] })}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary-950/10 focus:border-primary-950 text-sm font-bold text-slate-700 transition-all appearance-none cursor-pointer"
                  >
                    <option value="low">Low</option>
                    <option value="normal">Normal</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Target Tier</label>
                  <select
                    value={currentFormData.target_level}
                    onChange={(e) => setCurrentFormData({ ...currentFormData, target_level: e.target.value as LevelOption })}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary-950/10 focus:border-primary-950 text-sm font-bold text-slate-700 transition-all disabled:opacity-50 appearance-none cursor-pointer"
                    disabled={!!assignedLevels && assignedLevels.length === 1}
                  >
                    {(!assignedLevels || assignedLevels.length > 1) && <option value="all">Global Tier</option>}
                    {(['100', '200', '300', '400'] as LevelOption[])
                      .filter(lvl => !assignedLevels || assignedLevels.includes(lvl as any))
                      .map(lvl => (
                        <option key={lvl} value={lvl}>Level {lvl}</option>
                      ))}
                  </select>
                </div>
              </div>

              <div className="flex items-center gap-8 px-6 py-6 bg-primary-50 rounded-[2rem] border border-primary-100 shadow-inner">
                <label className="flex items-center gap-3 cursor-pointer group">
                  <div className="relative">
                      <input
                        type="checkbox"
                        checked={currentFormData.is_published}
                        onChange={(e) => setCurrentFormData({ ...currentFormData, is_published: e.target.checked })}
                        className="peer hidden"
                      />
                      <div className="w-6 h-6 bg-white border-2 border-gray-200 rounded-lg peer-checked:bg-primary-600 peer-checked:border-primary-600 transition-all flex items-center justify-center">
                          {currentFormData.is_published && <CheckCircle2 className="w-4 h-4 text-white transition-opacity" />}
                      </div>
                  </div>
                  <span className="text-[10px] font-black text-gray-500 uppercase tracking-widest group-hover:text-primary-600 transition-colors">Commit to Feed</span>
                </label>
                <label className="flex items-center gap-3 cursor-pointer group">
                   <div className="relative">
                      <input
                        type="checkbox"
                        checked={currentFormData.is_pinned}
                        onChange={(e) => setCurrentFormData({ ...currentFormData, is_pinned: e.target.checked })}
                        className="peer hidden"
                      />
                      <div className="w-6 h-6 bg-white border-2 border-gray-200 rounded-lg peer-checked:bg-primary-600 peer-checked:border-primary-600 transition-all flex items-center justify-center">
                          {currentFormData.is_pinned && <CheckCircle2 className="w-4 h-4 text-white transition-opacity" />}
                      </div>
                  </div>
                  <span className="text-[10px] font-black text-gray-500 uppercase tracking-widest group-hover:text-primary-600 transition-colors">Strategic Pin</span>
                </label>
              </div>
          </div>
        </form>
        <div className="p-10 bg-gray-50/50 border-t border-gray-50 flex flex-col gap-4">
          {errorMsg && (
            <div className="flex items-center gap-3 px-5 py-4 bg-red-50 border border-red-100 rounded-2xl">
              <XCircle className="w-5 h-5 text-red-500 shrink-0" />
              <p className="text-sm font-medium text-red-700">{errorMsg}</p>
            </div>
          )}
          <div className="flex gap-4">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 px-8 py-5 bg-white text-gray-400 rounded-2xl font-black text-[10px] uppercase tracking-widest border border-gray-100 hover:bg-gray-100 hover:text-gray-600 transition-all"
          >
            {isEditing ? 'Cancel' : 'Discard Draft'}
          </button>
          <button
            onClick={handleSubmit}
            disabled={isSaving}
            className="flex-[2] px-8 py-5 bg-primary-950 text-primary-400 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-primary-900 transition-all shadow-xl shadow-primary-950/20 disabled:opacity-50"
          >
            {isSaving ? 'Saving...' : announcement ? 'Save Changes' : 'Add Announcement'}
          </button>
          </div>
        </div>
      </div>
    </div>
  );
}

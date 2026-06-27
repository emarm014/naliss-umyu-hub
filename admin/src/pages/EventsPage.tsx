import { useState, useMemo, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/auth.store';
import type { Event, AcademicLevel } from '../types';
import { useAdminDataStore } from '../store/adminData.store';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import ErrorState from '../components/ui/ErrorState';
import {
  Plus,
  Search,
  Edit,
  Trash2,
  Calendar,
  MapPin,
  X,
  ChevronLeft,
  ChevronRight,
  Activity,
  Globe,
  EyeOff,
  CheckCircle,
  Filter
} from 'lucide-react';
import FileUpload from '../lib/FileUpload';
import { deleteFromCloudinary } from '../lib/cloudinaryDelete';
import { sendPushNotification, getUserIdsForLevel } from '../lib/notifications';

interface EventWithCreator extends Event {
  creator?: { full_name: string; email: string } | null;
}

const ITEMS_PER_PAGE = 10;
type LevelOption = 'all' | '100' | '200' | '300' | '400';

const statusConfig = {
  draft: { color: 'bg-gray-100 text-gray-700 border-gray-200', label: 'Draft', icon: EyeOff },
  published: { color: 'bg-blue-100 text-blue-700 border-blue-200', label: 'Published', icon: Globe },
  ongoing: { color: 'bg-green-100 text-green-700 border-green-200', label: 'Ongoing', icon: Activity },
  completed: { color: 'bg-purple-100 text-purple-700 border-purple-200', label: 'Completed', icon: CheckCircle },
  cancelled: { color: 'bg-red-100 text-red-700 border-red-200', label: 'Cancelled', icon: X },
};

export default function EventsPage() {
  const { events: allEvents, isSyncing, error: storeError, syncAll, removeEvent, refreshAnalytics } = useAdminDataStore();
  
  useEffect(() => {
    syncAll();
  }, [syncAll]);
  
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<Event['status'] | 'all'>('all');
  const [levelFilter, setLevelFilter] = useState<LevelOption>('all');
  const [currentPage, setCurrentPage] = useState(1);
  
  const [showModal, setShowModal] = useState<'create' | 'edit' | 'view' | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<EventWithCreator | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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

  const { profile, permissions } = useAuthStore();
  const assignedLevel = (profile?.role === 'moderator' ? permissions?.assigned_level : null) ?? null;

  // Derived Telemetry
  const stats = useMemo(() => ({
    total: allEvents.length,
    active: allEvents.filter(e => e.status === 'ongoing' || e.status === 'published').length,
    drafts: allEvents.filter(e => e.status === 'draft').length,
  }), [allEvents]);

  // Client-side Filtering
  const filteredEvents = useMemo(() => {
    return allEvents.filter(event => {
      const matchesSearch = event.title.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesStatus = statusFilter === 'all' || event.status === statusFilter;
      const matchesLevel = levelFilter === 'all' || event.target_level === levelFilter;
      const matchesAssigned = !assignedLevel || event.target_level === assignedLevel;
      
      return matchesSearch && matchesStatus && matchesLevel && matchesAssigned;
    });
  }, [allEvents, searchQuery, statusFilter, levelFilter, assignedLevel]);

  // Pagination logic
  const totalCount = filteredEvents.length;
  const totalPages = Math.ceil(totalCount / ITEMS_PER_PAGE);
  const paginatedEvents = useMemo(() => {
    const from = (currentPage - 1) * ITEMS_PER_PAGE;
    const to = from + ITEMS_PER_PAGE;
    return filteredEvents.slice(from, to);
  }, [filteredEvents, currentPage]);

  // Global Synchronization is handled by the Root DashboardLayout

  const handleStatusChange = async (event: EventWithCreator, newStatus: Event['status']) => {
    try {
      const updateData: Partial<Event> = { status: newStatus };
      if (newStatus === 'published') {
        updateData.published_at = new Date().toISOString();
      }
      if (newStatus === 'cancelled') {
        updateData.is_public = false;
      }

      const { error } = await supabase
        .from('events')
        .update(updateData)
        .eq('id', event.id);

      if (error) throw error;
      setSuccessMessage(`Event status updated to ${newStatus}`);
      refreshAnalytics();
      setTimeout(() => setSuccessMessage(null), 5000);
    } catch (err: unknown) {
      setErrorMessage('Failed to update status: ' + ((err as any)?.message || 'Unknown error'));
      setTimeout(() => setErrorMessage(null), 5000);
    }
  };

  const handleDelete = async (id: string, title: string) => {
    if (!window.confirm(`Are you sure you want to permanently delete "${title}"? This action cannot be undone.`)) {
      return;
    }

    // Capture cover image URL BEFORE optimistic remove
    const ev = allEvents.find(e => e.id === id);
    const coverUrl = ev?.cover_image_url;

    // Optimistic: remove instantly
    removeEvent(id);
    setSuccessMessage(`Event "${title}" has been deleted successfully.`);
    setTimeout(() => setSuccessMessage(null), 5000);

    try {
      const { error } = await supabase.from('events').delete().eq('id', id);
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
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Success Notification */}
      {successMessage && (
        <div className="fixed top-4 right-4 z-[100] bg-primary-950 border border-primary-900 text-white px-6 py-4 rounded-2xl shadow-2xl flex items-center gap-4 animate-in fade-in slide-in-from-top-4 duration-500">
          <div className="w-10 h-10 bg-primary-900 rounded-full flex items-center justify-center flex-shrink-0">
            <CheckCircle className="w-5 h-5 text-primary-400" />
          </div>
          <div>
            <p className="font-bold text-sm tracking-wide">Success</p>
            <p className="text-xs text-primary-200 mt-0.5">{successMessage}</p>
          </div>
        </div>
      )}

      {/* Error Notification */}
      {errorMessage && (
        <div className="fixed top-4 right-4 z-[100] bg-red-600 border border-red-500 text-white px-6 py-4 rounded-2xl shadow-2xl flex items-center gap-4 animate-in fade-in slide-in-from-top-4 duration-500">
          <div className="w-10 h-10 bg-red-700 rounded-full flex items-center justify-center flex-shrink-0">
            <X className="w-5 h-5 text-white" />
          </div>
          <div>
            <p className="font-bold text-sm tracking-wide">Error</p>
            <p className="text-xs text-red-100 mt-0.5">{errorMessage}</p>
          </div>
        </div>
      )}

      {/* Header & Primary Actions */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-6">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">Events</h1>
          <p className="text-sm text-slate-500 font-medium mt-1">Manage and schedule departmental events.</p>
        </div>
        <button
          onClick={() => setShowModal('create')}
          className="btn-institutional group"
        >
          <div className="bg-white/20 p-1.5 rounded-full group-hover:bg-white/30 transition-colors">
            <Plus className="h-4 w-4" />
          </div>
          Add to Mobile App
        </button>
      </div>

      {/* Dashboard Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="glass-card p-6 rounded-2xl relative overflow-hidden group">
          <div className="absolute inset-0 bg-gradient-to-br from-primary-950/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
          <div className="flex items-center justify-between mb-4">
            <div className="h-10 w-10 bg-primary-50 rounded-xl flex items-center justify-center">
              <Calendar className="h-5 w-5 text-primary-600" />
            </div>
            <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Total Events</span>
          </div>
          <div>
            <h3 className="text-3xl font-black text-slate-900">{stats.total}</h3>
            <p className="text-sm text-slate-500 font-medium mt-1">Total registered</p>
          </div>
        </div>

        <div className="glass-card p-6 rounded-2xl relative overflow-hidden group">
          <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
          <div className="flex items-center justify-between mb-4">
            <div className="h-10 w-10 bg-blue-50 rounded-xl flex items-center justify-center">
              <Activity className="h-5 w-5 text-blue-600" />
            </div>
            <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Active</span>
          </div>
          <div>
            <h3 className="text-3xl font-black text-slate-900">{stats.active}</h3>
            <p className="text-sm text-slate-500 font-medium mt-1">Published events</p>
          </div>
        </div>

        <div className="glass-card p-6 rounded-2xl relative overflow-hidden group">
          <div className="absolute inset-0 bg-gradient-to-br from-amber-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
          <div className="flex items-center justify-between mb-4">
            <div className="h-10 w-10 bg-amber-50 rounded-xl flex items-center justify-center">
              <EyeOff className="h-5 w-5 text-amber-600" />
            </div>
            <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Drafts</span>
          </div>
          <div>
            <h3 className="text-3xl font-black text-slate-900">{stats.drafts}</h3>
            <p className="text-sm text-slate-500 font-medium mt-1">Unpublished</p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="glass-card p-2 rounded-2xl flex flex-col md:flex-row items-center gap-2 relative z-10">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search events..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-11 pr-4 py-3.5 bg-transparent border-none focus:ring-0 text-sm font-medium text-slate-900 placeholder:text-slate-400"
          />
        </div>
        <div className="w-px h-8 bg-slate-200 hidden md:block" />
        <div className="flex w-full md:w-auto p-2 gap-2">
          <div className="relative flex-1 md:w-auto">
             <Filter className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
             <select
                value={levelFilter}
                onChange={(e) => setLevelFilter(e.target.value as LevelOption)}
                disabled={!!assignedLevel}
                className="w-full pl-9 pr-8 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 uppercase tracking-wider appearance-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50"
             >
                {!assignedLevel && <option value="all">All Levels</option>}
                <option value="100">Level 100</option>
                <option value="200">Level 200</option>
                <option value="300">Level 300</option>
                <option value="400">Level 400</option>
             </select>
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as Event['status'] | 'all')}
            className="flex-1 md:w-auto px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 uppercase tracking-wider appearance-none focus:ring-2 focus:ring-primary-500"
          >
            <option value="all">All Statuses</option>
            <option value="draft">Drafts</option>
            <option value="published">Published</option>
            <option value="ongoing">Ongoing</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
      </div>

      {/* Search Results Summary */}
      <div className="flex items-center justify-between px-2">
         <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">
            Showing {paginatedEvents.length} of {totalCount} events
         </p>
      </div>

      {/* Events Grid */}
      {isSyncing && allEvents.length === 0 ? (
        <div className="flex items-center justify-center py-20 glass-card rounded-3xl">
          <LoadingSpinner size="lg" />
        </div>
      ) : storeError ? (
        <div className="glass-card rounded-3xl p-8">
          <ErrorState onRetry={() => syncAll()} message={storeError} />
        </div>
      ) : paginatedEvents.length === 0 ? (
        <div className="glass-card rounded-3xl p-16 flex flex-col items-center justify-center text-center">
          <div className="w-16 h-16 bg-slate-50 rounded-2xl flex items-center justify-center mb-4 border border-slate-100">
            <Calendar className="h-8 w-8 text-slate-400" />
          </div>
          <h3 className="text-lg font-bold text-slate-900 mb-2">No Events Found</h3>
          <p className="text-slate-500 max-w-sm">No events match the current filters. Adjust criteria or create a new event.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {paginatedEvents.map((event) => {
            const StatusIcon = statusConfig[event.status].icon;
            
            return (
            <div
              key={event.id}
              className="glass-card rounded-2xl overflow-hidden hover:-translate-y-1 hover:shadow-2xl transition-all duration-300 flex flex-col"
            >
              {/* Event Poster / Cover */}
              <div className="relative h-48 w-full bg-slate-900 overflow-hidden">
                {event.cover_image_url ? (
                  <img
                    src={event.cover_image_url}
                    alt={event.title}
                    className="w-full h-full object-cover opacity-90 transition-transform duration-700 hover:scale-105"
                  />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-primary-900 to-primary-950 flex flex-col items-center justify-center">
                    <Calendar className="h-10 w-10 text-primary-500/50 mb-2" />
                    <span className="text-primary-500/50 text-xs font-bold uppercase tracking-widest">No Poster</span>
                  </div>
                )}
                
                {/* Overlay Gradient for contrast */}
                <div className="absolute inset-0 bg-gradient-to-t from-slate-900/90 via-transparent to-transparent" />
                
                {/* Badges */}
                <div className="absolute top-4 left-4 flex flex-col gap-2">
                  <span className={`inline-flex items-center gap-1.5 px-3 py-1 text-[10px] font-black uppercase tracking-widest rounded-lg border backdrop-blur-md ${statusConfig[event.status].color.replace('bg-', 'bg-white/90 border-').replace('text-', 'text-')}`}>
                    <StatusIcon className="w-3.5 h-3.5" />
                    {statusConfig[event.status].label}
                  </span>
                </div>
              </div>

              {/* Event Body */}
              <div className="p-6 flex-1 flex flex-col">
                <h3 className="text-lg font-black text-slate-900 leading-snug mb-4 line-clamp-2">
                  {event.title}
                </h3>

                <div className="space-y-3 mb-6 flex-1 text-sm">
                  {/* Date Block */}
                  <div className="flex items-start gap-3 text-slate-600">
                    <div className="mt-0.5 p-1.5 bg-slate-50 rounded-md border border-slate-100 text-slate-400">
                       <Calendar className="w-4 h-4" />
                    </div>
                    <div>
                      <p className="font-bold text-slate-900">
                        {new Date(event.start_date).toLocaleDateString('en-US', {
                          weekday: 'long', month: 'short', day: 'numeric', year: 'numeric',
                        })}
                      </p>
                    </div>
                  </div>
                  
                  {/* Venue Block */}
                  {event.venue && (
                     <div className="flex items-start gap-3 text-slate-600">
                        <div className="mt-0.5 p-1.5 bg-slate-50 rounded-md border border-slate-100 text-slate-400">
                           <MapPin className="w-4 h-4" />
                        </div>
                        <p className="font-medium truncate pt-1 flex-1">
                           {event.venue}
                        </p>
                     </div>
                  )}
                </div>

                {/* Workflow Toolbar */}
                <div className="flex flex-col gap-2">
                   {/* State Transitions */}
                   <div className="flex gap-2 w-full">
                     {event.status === 'draft' && (
                       <button
                         onClick={() => handleStatusChange(event, 'published')}
                         className="btn-institutional-sm !bg-blue-50 !border-blue-200 !text-blue-700"
                       >
                         <Globe className="w-3.5 h-3.5" /> Publish
                       </button>
                     )}
                     {event.status === 'published' && (
                       <button
                         onClick={() => handleStatusChange(event, 'ongoing')}
                         className="btn-institutional-sm !bg-green-50 !border-green-200 !text-green-700"
                       >
                         <Activity className="w-3.5 h-3.5" /> Start
                       </button>
                     )}
                     {event.status === 'ongoing' && (
                       <button
                         onClick={() => handleStatusChange(event, 'completed')}
                         className="btn-institutional-sm !bg-purple-50 !border-purple-200 !text-purple-700"
                       >
                         <CheckCircle className="w-3.5 h-3.5" /> Complete
                       </button>
                     )}
                   </div>
                   
                   {/* Admin Actions */}
                   <div className="flex gap-2 pt-3 border-t border-slate-100 mt-2">
                     <button
                       onClick={() => {
                         setSelectedEvent(event);
                         setShowModal('edit');
                       }}
                       className="btn-institutional-sm !py-2 !text-slate-600 hover:!text-primary-700"
                     >
                       <Edit className="w-3.5 h-3.5" /> Edit
                     </button>
                     <button
                       onClick={() => handleDelete(event.id, event.title)}
                       className="btn-institutional-sm !py-2 !text-slate-600 hover:!bg-red-50 hover:!text-red-700 hover:!border-red-200 w-auto fl-0 !px-3"
                       title="Delete Event"
                     >
                       <Trash2 className="w-3.5 h-3.5" />
                     </button>
                   </div>
                </div>
              </div>
            </div>
          )})}
        </div>
      )}

      {/* Pagination Container */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between glass-card px-6 py-4 rounded-2xl">
          <button
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            className="flex items-center gap-2 px-4 py-2 border border-slate-200 text-slate-700 rounded-xl text-xs font-bold uppercase hover:bg-slate-50 disabled:opacity-50 transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
            Previous
          </button>
          <div className="text-xs font-bold text-slate-400 uppercase tracking-widest bg-slate-50 px-4 py-2 rounded-xl border border-slate-100">
            Page <span className="text-primary-600">{currentPage}</span> of {totalPages}
          </div>
          <button
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
            className="flex items-center gap-2 px-4 py-2 border border-slate-200 text-slate-700 rounded-xl text-xs font-bold uppercase hover:bg-slate-50 disabled:opacity-50 transition-colors"
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Event Modals */}
      {(showModal === 'create' || showModal === 'edit') && (
        <EventFormModal
          event={selectedEvent}
          predefinedAsset={predefinedAsset}
          assignedLevel={assignedLevel}
          onClose={() => {
            setShowModal(null);
            setSelectedEvent(null);
          }}
          onSave={(msg) => {
            setSuccessMessage(msg);
            setShowModal(null);
            setSelectedEvent(null);
            refreshAnalytics();
            setTimeout(() => setSuccessMessage(null), 5000);
          }}
        />
      )}
    </div>
  );
}

// Event Configuration Modal Component
function EventFormModal({
  event,
  predefinedAsset,
  assignedLevel,
  onClose,
  onSave,
}: {
  event: EventWithCreator | null;
  predefinedAsset?: any;
  assignedLevel: AcademicLevel | null;
  onClose: () => void;
  onSave: (message: string) => void;
}) {
  const { profile: authProfile } = useAuthStore();
  const [formData, setFormData] = useState({
    title: event?.title || predefinedAsset?.title || '',
    description: event?.description || '',
    cover_image_url: event?.cover_image_url || predefinedAsset?.url || '',
    cover_image_size: (event as any)?.cover_image_size || null as number | null,
    venue: event?.venue || '',
    target_level: (event?.target_level as LevelOption) || assignedLevel || 'all',
    status: event?.status || 'draft',
  });
  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!formData.title.trim()) { setErrorMsg('Event title is required.'); return; }

    setIsSaving(true);

    try {
      if (!authProfile?.id) throw new Error('Not authenticated');

      const data = {
        title: formData.title,
        description: formData.description,
        cover_image_url: formData.cover_image_url,
        cover_image_size: formData.cover_image_size,
        venue: formData.venue,
        target_level: formData.target_level === 'all' ? null : formData.target_level,
        status: formData.status,
        created_by: authProfile.id,
        start_date: event ? event.start_date : new Date().toISOString().split('T')[0],
        end_date: null,
        start_time: null,
        end_time: null,
        is_virtual: false,
        virtual_link: null,
        is_public: true,
        max_attendees: null,
      };

      let savedEvent: any = null;
      if (event) {
        const { data: updated, error } = await supabase
          .from('events')
          .update(data)
          .eq('id', event.id)
          .select('*')
          .single();
        if (error) throw error;
        savedEvent = updated;
        if (savedEvent) useAdminDataStore.getState().updateEvent(savedEvent);
      } else {
        const { data: inserted, error } = await supabase.from('events').insert([data]).select('*').single();
        if (error) throw error;
        savedEvent = inserted;
        if (savedEvent) useAdminDataStore.getState().addEvent(savedEvent);

        // Push notification for new event — fire and forget
        const targetLevel = formData.target_level === 'all' ? null : formData.target_level;
        getUserIdsForLevel(targetLevel).then(targetIds => {
          if (targetIds.length > 0) {
            sendPushNotification({
              targetUserIds: targetIds,
              title: '🗓️ New Event',
              body: `${formData.title}`,
              data: {
                type: 'event',
                id: savedEvent?.id || '',
                title: formData.title,
                description: formData.description,
                cover_image_url: formData.cover_image_url || null,
                status: formData.status || 'published',
                is_virtual: false,
                virtual_link: null,
                venue: formData.venue || null,
                start_date: data.start_date,
                end_date: null,
                start_time: null,
                end_time: null,
                max_attendees: null,
                current_attendees: 0,
                created_at: savedEvent?.created_at || new Date().toISOString(),
                published_at: savedEvent?.published_at || new Date().toISOString(),
              },
            });
          }
        });
      }

      onSave(`Event "${formData.title}" ${event ? 'updated' : 'added'} successfully.`);
    } catch (err: unknown) {
      const msg = (err as any)?.message || (err as any)?.error_description || JSON.stringify(err);
      setErrorMsg(`Failed to save event: ${msg}`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-[200] p-4">
      <div className="bg-white rounded-3xl shadow-2xl max-w-2xl w-full max-h-[90vh] border border-white overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
        
        <div className="bg-slate-50 p-6 border-b border-slate-100 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-primary-100/50 rounded-xl flex items-center justify-center border border-primary-100 text-primary-600">
               {event ? <Edit className="w-5 h-5" /> : <Calendar className="w-5 h-5" />}
            </div>
            <div>
               <h2 className="text-xl font-black text-slate-900 tracking-tight">
                 {event ? 'Edit Event' : 'Add to Mobile App'}
               </h2>
               <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-0.5">
                  Event Details
               </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors">
            <X className="h-6 w-6" />
          </button>
        </div>
        
        <form id="event-form" onSubmit={handleSubmit} className="p-8 space-y-6 overflow-y-auto flex-1">
          <div className="space-y-4">
             <div>
               <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Title</label>
               <input
                 type="text"
                 value={formData.title}
                 onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                 className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-900 focus:bg-white focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-all placeholder:text-slate-400"
                 placeholder="Main event title..."
               />
             </div>

             <div>
               <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Description</label>
               <textarea
                 value={formData.description}
                 onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                 rows={4}
                 className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-900 focus:bg-white focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-all placeholder:text-slate-400 resize-none"
                 placeholder="Comprehensive details and instructions..."
               />
             </div>

             {/* File Upload for Cover Art */}
             <div className="bg-slate-50 border border-slate-200 p-5 rounded-xl border-dashed">
               <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-3">Event Poster Image</label>
               <FileUpload
                 accept="image/*"
                 isImage={true}
                 folder="events"
                 onUploadComplete={(url: string, file: File) => setFormData(prev => ({ ...prev, cover_image_url: url, cover_image_size: file.size }))}
                 currentFileUrl={formData.cover_image_url}
                 label=""
                 description="Drag and drop or select a high-fidelity image"
               />
             </div>

             <div>
               <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Venue</label>
               <input
                 type="text"
                 value={formData.venue}
                 onChange={(e) => setFormData({ ...formData, venue: e.target.value })}
                 className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-900 focus:bg-white focus:ring-2 focus:ring-primary-500/20 placeholder:text-slate-400"
                 placeholder="E.g., University Auditorium"
               />
             </div>

             <div>
               <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Target level</label>
               <select
                 value={formData.target_level}
                 onChange={(e) => setFormData({ ...formData, target_level: e.target.value as LevelOption })}
                 disabled={!!assignedLevel}
                 className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-900 focus:bg-white focus:ring-2 focus:ring-primary-500/20 disabled:opacity-50 appearance-none"
               >
                 {!assignedLevel && <option value="all">All Levels</option>}
                 <option value="100">Level 100</option>
                 <option value="200">Level 200</option>
                 <option value="300">Level 300</option>
                 <option value="400">Level 400</option>
               </select>
             </div>
          </div>
        </form>

        {/* Sticky footer — always visible */}
        <div className="shrink-0 p-6 border-t border-slate-100 bg-white">
          {errorMsg && (
            <div className="flex items-center gap-3 px-4 py-3 mb-4 bg-red-50 border border-red-100 rounded-xl">
              <X className="w-4 h-4 text-red-500 shrink-0" />
              <p className="text-sm font-medium text-red-700">{errorMsg}</p>
            </div>
          )}
          <div className="flex gap-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-4 border-2 border-slate-200 text-slate-700 rounded-2xl text-sm font-black uppercase tracking-widest hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="event-form"
              disabled={isSaving}
              className="flex-[2] py-4 bg-primary-950 text-white rounded-2xl text-sm font-black uppercase tracking-widest hover:bg-slate-900 disabled:opacity-50 transition-colors shadow-xl shadow-primary-900/20 flex items-center justify-center gap-2"
            >
              {isSaving ? (
                <>
                   <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                   Processing...
                </>
              ) : event ? (
                <>
                   <Edit className="w-4 h-4" /> Update Event
                </>
              ) : (
                <>
                   <Plus className="w-4 h-4" /> Add to Mobile App
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

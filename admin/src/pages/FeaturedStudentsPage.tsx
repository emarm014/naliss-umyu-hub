import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import {
  Crown, Star, Trophy, Plus, Search, Edit, Trash2, Eye, EyeOff,
  CheckCircle, X, Users, Calendar, Sparkles, Heart,
  ChevronLeft, ChevronRight, Clock, Send
} from 'lucide-react';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import FileUpload from '../lib/FileUpload';
import { useFormDraft } from '../hooks/useFormDraft';
import { useAuthStore } from '../store/auth.store';

// ─── Types ────────────────────────────────────────────────────────
type FeaturedStudent = {
  id: string;
  user_id: string;
  type: 'event_winner' | 'student_of_the_week' | 'legend_of_the_month';
  scope: 'department' | 'faculty' | 'university';
  title: string;
  subtitle: string | null;
  description: string | null;
  custom_image_url: string | null;
  pool_id: string | null;
  is_active: boolean;
  published_at: string;
  expires_at: string | null;
  total_congratulations: number;
  created_at: string;
  users?: { full_name: string; username: string; avatar_url: string | null; level: string | null; department_id: string | null };
};

type SearchUser = {
  id: string;
  full_name: string;
  username: string;
  avatar_url: string | null;
  level: string | null;
  department_id: string | null;
};

const TYPE_OPTIONS = [
  { value: 'student_of_the_week', label: 'Student of the Week', icon: Star, color: 'text-amber-500', bg: 'bg-amber-50' },
  { value: 'legend_of_the_month', label: 'Legend of the Month', icon: Crown, color: 'text-purple-500', bg: 'bg-purple-50' },
  { value: 'event_winner', label: 'Event Winner', icon: Trophy, color: 'text-emerald-500', bg: 'bg-emerald-50' },
];

const SCOPE_OPTIONS = [
  { value: 'department', label: 'Department' },
  { value: 'faculty', label: 'Faculty' },
  { value: 'university', label: 'University-Wide' },
];

const ITEMS_PER_PAGE = 8;

export default function FeaturedStudentsPage() {
  const { profile } = useAuthStore();
  const isSuperAdmin = profile?.role === 'super_admin';
  const canManageFeatured = (item: FeaturedStudent) => isSuperAdmin || (profile?.role === 'moderator' && (item as any).created_by === profile?.id);

  // ─── State ──────────────────────────────────────────────────
  const [featured, setFeatured] = useState<FeaturedStudent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filterType, setFilterType] = useState<string>('all');
  const [filterActive, setFilterActive] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);

  const { showModal, setShowModal, formData, setFormData, clearDraft } = useFormDraft('featured_draft', {
    formType: 'student_of_the_week',
    formScope: 'department',
    formTitle: 'Student of the Week',
    formSubtitle: '',
    formDescription: '',
    formImageUrl: '',
    formExpiresAt: '',
    formSelectedUser: null as SearchUser | null,
  });

  const [editingItem, setEditingItem] = useState<FeaturedStudent | null>(null);

  // User search
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [userSearchResults, setUserSearchResults] = useState<SearchUser[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // Feedback
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // ─── Fetch ──────────────────────────────────────────────────
  useEffect(() => { fetchFeatured(); }, []);

  const fetchFeatured = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('featured_students')
        .select('*, users:user_id(full_name, username, avatar_url, level, department_id)')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setFeatured((data as any) || []);
    } catch (e: any) {
      console.error('Error fetching featured students:', e);
    } finally {
      setIsLoading(false);
    }
  };

  // ─── User Search ────────────────────────────────────────────
  useEffect(() => {
    if (userSearchQuery.length < 2) { setUserSearchResults([]); return; }
    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const { data, error } = await supabase
          .from('users')
          .select('id, full_name, username, avatar_url, level, department_id')
          .or(`full_name.ilike.%${userSearchQuery}%,username.ilike.%${userSearchQuery}%`)
          .limit(8);
        if (error) throw error;
        setUserSearchResults(data || []);
      } catch { setUserSearchResults([]); }
      finally { setIsSearching(false); }
    }, 350);
    return () => clearTimeout(timer);
  }, [userSearchQuery]);

  // ─── Filtered & Paginated ───────────────────────────────────
  const filtered = useMemo(() => {
    return featured.filter(item => {
      const matchesType = filterType === 'all' || item.type === filterType;
      const matchesActive = filterActive === 'all' || (filterActive === 'active' ? item.is_active : !item.is_active);
      const matchesSearch = !searchQuery ||
        item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.users?.full_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.users?.username?.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesType && matchesActive && matchesSearch;
    });
  }, [featured, filterType, filterActive, searchQuery]);

  const totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE);
  const paginated = useMemo(() => {
    const from = (currentPage - 1) * ITEMS_PER_PAGE;
    return filtered.slice(from, from + ITEMS_PER_PAGE);
  }, [filtered, currentPage]);

  // ─── Stats ──────────────────────────────────────────────────
  const stats = useMemo(() => ({
    total: featured.length,
    active: featured.filter(f => f.is_active).length,
    totalCongrats: featured.reduce((sum, f) => sum + f.total_congratulations, 0),
    thisWeek: featured.filter(f => {
      const d = new Date(f.created_at);
      const now = new Date();
      return (now.getTime() - d.getTime()) < 7 * 24 * 60 * 60 * 1000;
    }).length,
  }), [featured]);

  // ─── Form Helpers ───────────────────────────────────────────
  const handleClearDraft = () => {
    clearDraft();
    setFormError(null);
    setUserSearchQuery('');
    setUserSearchResults([]);
    setEditingItem(null);
  };

  const openCreate = () => { handleClearDraft(); setShowModal('create'); };

  const openEdit = (item: FeaturedStudent) => {
    setEditingItem(item);
    setFormData({
      formType: item.type,
      formScope: item.scope,
      formTitle: item.title,
      formSubtitle: item.subtitle || '',
      formDescription: item.description || '',
      formImageUrl: item.custom_image_url || '',
      formExpiresAt: item.expires_at ? new Date(item.expires_at).toISOString().slice(0, 16) : '',
      formSelectedUser: item.users ? {
        id: item.user_id,
        full_name: item.users.full_name,
        username: item.users.username,
        avatar_url: item.users.avatar_url,
        level: item.users.level,
        department_id: item.users.department_id,
      } : null
    });
    setShowModal('edit');
  };

  // ─── Submit ─────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.formSelectedUser) { setFormError('Please select a student.'); return; }
    if (!formData.formTitle.trim()) { setFormError('Title is required.'); return; }

    setIsSubmitting(true);
    setFormError(null);

    try {
      const payload = {
        user_id: formData.formSelectedUser.id,
        type: formData.formType,
        scope: formData.formScope,
        title: formData.formTitle.trim(),
        subtitle: formData.formSubtitle.trim() || `${formData.formSelectedUser.level || ''} Level`.trim(),
        description: formData.formDescription.trim() || null,
        custom_image_url: formData.formImageUrl || null,
        expires_at: formData.formExpiresAt ? new Date(formData.formExpiresAt).toISOString() : null,
        is_active: true,
      };

      if (showModal === 'create') {
        const { error } = await supabase.from('featured_students').insert([payload]);
        if (error) throw error;
        setSuccessMessage('🎉 Featured student published successfully!');
      } else if (showModal === 'edit' && editingItem) {
        const { error } = await supabase.from('featured_students').update(payload).eq('id', editingItem.id);
        if (error) throw error;
        setSuccessMessage('Featured student updated successfully.');
      }

      handleClearDraft();
      fetchFeatured();
      setTimeout(() => setSuccessMessage(null), 5000);
    } catch (err: any) {
      setFormError(err.message || 'Failed to save.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // ─── Toggle Active ──────────────────────────────────────────
  const toggleActive = async (item: FeaturedStudent) => {
    const newState = !item.is_active;
    setFeatured(prev => prev.map(f => f.id === item.id ? { ...f, is_active: newState } : f));
    try {
      const { error } = await supabase.from('featured_students').update({ is_active: newState }).eq('id', item.id);
      if (error) throw error;
      setSuccessMessage(newState ? 'Activated — now visible to students.' : 'Deactivated — hidden from students.');
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err: any) {
      fetchFeatured();
      alert('Failed: ' + err.message);
    }
  };

  // ─── Delete ─────────────────────────────────────────────────
  const handleDelete = async (item: FeaturedStudent) => {
    if (!window.confirm(`Delete "${item.title}" for ${item.users?.full_name || 'this student'}?`)) return;
    setFeatured(prev => prev.filter(f => f.id !== item.id));
    try {
      const { error } = await supabase.from('featured_students').delete().eq('id', item.id);
      if (error) throw error;
      setSuccessMessage('Deleted successfully.');
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err: any) {
      fetchFeatured();
      alert('Failed to delete: ' + err.message);
    }
  };

  // ─── Helpers ────────────────────────────────────────────────
  const getTypeInfo = (type: string) => TYPE_OPTIONS.find(t => t.value === type) || TYPE_OPTIONS[0];

  // ─── Render ─────────────────────────────────────────────────
  return (
    <div className="p-8 lg:p-12 max-w-7xl mx-auto space-y-12 animate-in fade-in duration-700 pb-20">
      {/* ── Success Toast ── */}
      {successMessage && (
        <div className="fixed top-10 right-10 z-[100] bg-primary-950 border border-primary-800 text-white px-8 py-6 rounded-[2rem] shadow-2xl flex items-center gap-5 animate-in fade-in slide-in-from-right-10 duration-500 backdrop-blur-3xl">
          <div className="w-12 h-12 bg-primary-400 rounded-2xl flex items-center justify-center flex-shrink-0 shadow-lg shadow-primary-400/20">
            <CheckCircle className="w-6 h-6 text-primary-950" />
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

      {/* ── Hero Header ── */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-8 pb-10 border-b border-gray-100">
        <div>
          <div className="flex items-center gap-3 mb-4">
            <div className="px-4 py-1 bg-primary-950 text-primary-400 rounded-full flex items-center gap-2 border border-primary-800/50 shadow-xl shadow-primary-950/20">
              <Crown className="w-3.5 h-3.5" />
              <span className="text-[10px] font-black uppercase tracking-[0.2em] italic">Hall of Fame</span>
            </div>
            <div className="px-4 py-1 bg-amber-50 text-amber-600 rounded-full flex items-center gap-2 border border-amber-100">
              <div className="w-2 h-2 bg-amber-500 rounded-full animate-pulse" />
              <span className="text-[10px] font-black uppercase tracking-widest text-amber-700">{stats.active} Active</span>
            </div>
          </div>
          <h1 className="text-4xl lg:text-6xl font-black text-gray-950 tracking-tight leading-[0.9]">
            Featured<br />
            <span className="text-primary-600">Students.</span>
          </h1>
          <p className="text-gray-400 mt-6 text-lg font-medium max-w-xl leading-relaxed">
            Celebrate excellence. Declare Students of the Week, Legends of the Month, and Event Pool Winners.
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
            onClick={openCreate}
            className="flex items-center gap-3 px-8 py-4 bg-primary-950 text-white rounded-[2rem] hover:bg-primary-900 transition-all shadow-2xl shadow-primary-950/30 hover:shadow-primary-950/50 hover:-translate-y-0.5 active:scale-[0.98] font-black text-sm uppercase tracking-wider"
          >
            <Plus className="w-5 h-5" />
            Feature Student
          </button>
        </div>
      </div>

      {/* ── Stats Grid ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
        {[
          { label: 'Total Featured', value: stats.total, icon: Users, color: 'text-blue-500', bg: 'bg-blue-50' },
          { label: 'Active Now', value: stats.active, icon: Eye, color: 'text-emerald-500', bg: 'bg-emerald-50' },
          { label: 'Total Congrats', value: stats.totalCongrats, icon: Heart, color: 'text-rose-500', bg: 'bg-rose-50' },
          { label: 'This Week', value: stats.thisWeek, icon: Calendar, color: 'text-violet-500', bg: 'bg-violet-50' },
        ].map((stat, i) => (
          <div key={i} className="p-6 bg-white rounded-3xl border border-gray-100 shadow-sm hover:shadow-lg transition-all">
            <div className={`w-12 h-12 ${stat.bg} rounded-2xl flex items-center justify-center mb-4`}>
              <stat.icon className={`w-6 h-6 ${stat.color}`} />
            </div>
            <p className="text-3xl font-black text-gray-950">{stat.value}</p>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mt-1">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* ── Filters ── */}
      <div className="flex flex-col lg:flex-row items-center gap-4">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-300" />
          <input
            type="text"
            placeholder="Search by name or title..."
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
            className="w-full pl-14 pr-6 py-4 bg-gray-50 rounded-[2rem] border border-gray-100 text-sm font-medium text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500/50 transition-all"
          />
        </div>
        <select
          value={filterType}
          onChange={(e) => { setFilterType(e.target.value); setCurrentPage(1); }}
          className="px-6 py-4 bg-gray-50 rounded-[2rem] border border-gray-100 text-sm font-bold text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
        >
          <option value="all">All Types</option>
          {TYPE_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <select
          value={filterActive}
          onChange={(e) => { setFilterActive(e.target.value); setCurrentPage(1); }}
          className="px-6 py-4 bg-gray-50 rounded-[2rem] border border-gray-100 text-sm font-bold text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
        >
          <option value="all">All Status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      {/* ── Content ── */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20"><LoadingSpinner /></div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 space-y-4">
          <div className="w-24 h-24 bg-gray-50 rounded-full flex items-center justify-center mx-auto">
            <Crown className="w-12 h-12 text-gray-200" />
          </div>
          <p className="text-xl font-black text-gray-300">No featured students yet</p>
          <p className="text-sm text-gray-400 font-medium">Click "Feature Student" to celebrate your first star.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {paginated.map(item => {
            const typeInfo = getTypeInfo(item.type);
            const TypeIcon = typeInfo.icon;
            return (
              <div
                key={item.id}
                className={`group relative bg-white rounded-3xl border overflow-hidden transition-all duration-300 hover:shadow-xl hover:-translate-y-1 ${
                  item.is_active ? 'border-gray-100' : 'border-gray-100 opacity-60'
                }`}
              >
                {/* Top Banner Gradient */}
                <div className={`h-2 ${
                  item.type === 'legend_of_the_month' ? 'bg-gradient-to-r from-purple-500 via-pink-500 to-amber-500' :
                  item.type === 'student_of_the_week' ? 'bg-gradient-to-r from-amber-400 via-amber-500 to-orange-500' :
                  'bg-gradient-to-r from-emerald-400 via-emerald-500 to-teal-500'
                }`} />

                <div className="p-6">
                  {/* Header Row */}
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      {/* Avatar */}
                      <div className="relative">
                        {item.custom_image_url || item.users?.avatar_url ? (
                          <img
                            src={item.custom_image_url || item.users?.avatar_url || ''}
                            alt=""
                            className="w-14 h-14 rounded-2xl object-cover border-2 border-gray-100"
                          />
                        ) : (
                          <div className="w-14 h-14 rounded-2xl bg-gray-100 flex items-center justify-center">
                            <Users className="w-6 h-6 text-gray-300" />
                          </div>
                        )}
                        {item.is_active && (
                          <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-emerald-500 rounded-full border-2 border-white flex items-center justify-center">
                            <Sparkles className="w-3 h-3 text-white" />
                          </div>
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="text-base font-black text-gray-950 truncate">{item.users?.full_name || 'Unknown'}</p>
                        <p className="text-xs font-medium text-gray-400 truncate">@{item.users?.username || '—'}</p>
                      </div>
                    </div>

                    {/* Type Badge */}
                    <div className={`px-3 py-1.5 ${typeInfo.bg} rounded-full flex items-center gap-1.5`}>
                      <TypeIcon className={`w-3.5 h-3.5 ${typeInfo.color}`} />
                      <span className={`text-[10px] font-black uppercase tracking-wider ${typeInfo.color}`}>
                        {item.type === 'student_of_the_week' ? 'FYB' :
                         item.type === 'legend_of_the_month' ? 'Legend' : 'Winner'}
                      </span>
                    </div>
                  </div>

                  {/* Title & Subtitle */}
                  <h3 className="text-lg font-black text-gray-900 mb-1">{item.title}</h3>
                  {item.subtitle && <p className="text-sm font-medium text-gray-400 mb-3">{item.subtitle}</p>}

                  {/* Metrics Row */}
                  <div className="flex items-center gap-4 mb-4">
                    <div className="flex items-center gap-1.5 text-rose-500">
                      <Heart className="w-4 h-4 fill-rose-500" />
                      <span className="text-sm font-black">{item.total_congratulations}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-gray-400">
                      <Calendar className="w-4 h-4" />
                      <span className="text-xs font-bold">{new Date(item.published_at).toLocaleDateString()}</span>
                    </div>
                    <div className={`flex items-center gap-1.5 ${item.is_active ? 'text-emerald-500' : 'text-gray-300'}`}>
                      <div className={`w-2 h-2 rounded-full ${item.is_active ? 'bg-emerald-500 animate-pulse' : 'bg-gray-300'}`} />
                      <span className="text-xs font-bold uppercase">{item.is_active ? 'Live' : 'Off'}</span>
                    </div>
                  </div>

                  {/* Actions */}
                  {canManageFeatured(item) && (
                    <div className="flex items-center gap-2 pt-4 border-t border-gray-50">
                      <button
                        onClick={() => toggleActive(item)}
                        className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                          item.is_active
                            ? 'bg-amber-50 text-amber-600 hover:bg-amber-100'
                            : 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100'
                        }`}
                      >
                        {item.is_active ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        {item.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                      <button
                        onClick={() => openEdit(item)}
                        className="flex items-center gap-2 px-4 py-2 bg-gray-50 text-gray-600 rounded-xl text-xs font-bold hover:bg-gray-100 transition-all"
                      >
                        <Edit className="w-3.5 h-3.5" /> Edit
                      </button>
                      <button
                        onClick={() => handleDelete(item)}
                        className="flex items-center gap-2 px-4 py-2 bg-red-50 text-red-500 rounded-xl text-xs font-bold hover:bg-red-100 transition-all ml-auto"
                      >
                        <Trash2 className="w-3.5 h-3.5" /> Delete
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Create / Edit Modal ── */}
      {(showModal === 'create' || showModal === 'edit') && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center z-[100] p-4 animate-in fade-in duration-300">
          <div className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-2xl flex flex-col max-h-[90vh] overflow-hidden border border-white/10 animate-in zoom-in-95 duration-500">
            <div className="p-8 border-b border-slate-50 flex items-center justify-between bg-slate-50/50">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-primary-950 text-white rounded-2xl shadow-lg ring-4 ring-primary-50">
                  {showModal === 'create' ? <Plus className="w-6 h-6" /> : <Edit className="w-6 h-6" />}
                </div>
                <div>
                  <h2 className="text-2xl font-black text-slate-900 tracking-tight">
                    {showModal === 'create' ? 'Feature a Student' : 'Edit Featured Student'}
                  </h2>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Hall of Fame Network</p>
                </div>
              </div>
              <button type="button" onClick={handleClearDraft} className="p-3 bg-white hover:bg-rose-500 hover:text-white rounded-xl shadow-sm transition-all active:scale-90 text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto min-h-0 custom-scrollbar">
              <form id="featured-student-form" onSubmit={handleSubmit} className="p-8 space-y-8">
              {formError && (
                <div className="p-4 bg-red-50 border border-red-100 rounded-2xl text-sm text-red-600 font-medium flex items-center gap-3">
                  <X className="w-5 h-5 flex-shrink-0" />
                  {formError}
                </div>
              )}

              {/* Student Search */}
              <div className="space-y-3">
                <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest ml-1">Select Student</label>
                {formData.formSelectedUser ? (
                  <div className="flex items-center gap-4 p-4 bg-primary-50 rounded-2xl border border-primary-100">
                    {formData.formSelectedUser.avatar_url ? (
                      <img src={formData.formSelectedUser.avatar_url} alt="" className="w-12 h-12 rounded-xl object-cover" />
                    ) : (
                      <div className="w-12 h-12 rounded-xl bg-primary-100 flex items-center justify-center">
                        <Users className="w-5 h-5 text-primary-400" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-black text-slate-950 truncate">{formData.formSelectedUser.full_name}</p>
                      <p className="text-xs text-slate-400 font-medium">@{formData.formSelectedUser.username} • {formData.formSelectedUser.level || '—'} Level</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => { setFormData(prev => ({ ...prev, formSelectedUser: null })); setUserSearchQuery(''); }}
                      className="p-2 bg-white rounded-xl hover:bg-rose-50 hover:text-rose-500 transition-all text-slate-400"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <div className="relative">
                    <Search className="absolute left-6 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-300" />
                    <input
                      type="text"
                      value={userSearchQuery}
                      onChange={e => setUserSearchQuery(e.target.value)}
                      placeholder="Type a student name or username..."
                      className="w-full pl-14 pr-6 py-4 bg-slate-50 border-2 border-transparent focus:border-primary-950 rounded-2xl transition-all focus:bg-white outline-none font-bold text-slate-900"
                    />
                    {isSearching && (
                      <div className="absolute right-4 top-1/2 -translate-y-1/2">
                        <div className="w-5 h-5 border-2 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
                      </div>
                    )}
                    {userSearchResults.length > 0 && (
                      <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-2xl border border-slate-100 shadow-2xl z-50 max-h-64 overflow-y-auto">
                        {userSearchResults.map(user => (
                          <button
                            key={user.id}
                            type="button"
                            onClick={() => {
                              setFormData(prev => ({
                                ...prev,
                                formSelectedUser: user,
                                formSubtitle: prev.formSubtitle || `${user.level || ''} Level`.trim()
                              }));
                              setUserSearchQuery('');
                              setUserSearchResults([]);
                            }}
                            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-all text-left"
                          >
                            {user.avatar_url ? (
                              <img src={user.avatar_url} alt="" className="w-10 h-10 rounded-lg object-cover" />
                            ) : (
                              <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center">
                                <Users className="w-4 h-4 text-slate-300" />
                              </div>
                            )}
                            <div className="min-w-0">
                              <p className="text-sm font-bold text-slate-900 truncate">{user.full_name}</p>
                              <p className="text-xs text-slate-400">@{user.username} • {user.level || '—'} Level</p>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Type Selector */}
              <div className="space-y-3">
                <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest ml-1">Recognition Type</label>
                <div className="grid grid-cols-3 gap-3">
                  {TYPE_OPTIONS.map(opt => {
                    const Icon = opt.icon;
                    const isSelected = formData.formType === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => {
                          setFormData(prev => {
                            let title = prev.formTitle;
                            if (opt.value === 'student_of_the_week') title = 'Student of the Week';
                            else if (opt.value === 'legend_of_the_month') title = 'Legend of the Month';
                            else title = 'Event Pool Winner';
                            return { ...prev, formType: opt.value, formTitle: title };
                          });
                        }}
                        className={`p-4 rounded-2xl border-2 transition-all text-center ${
                          isSelected
                            ? 'border-primary-950 bg-primary-50 shadow-lg shadow-primary-950/10'
                            : 'border-transparent bg-slate-50 hover:border-slate-200'
                        }`}
                      >
                        <Icon className={`w-6 h-6 mx-auto mb-2 ${isSelected ? 'text-primary-600' : opt.color}`} />
                        <p className={`text-[10px] font-black uppercase tracking-widest ${isSelected ? 'text-primary-950' : 'text-slate-500'}`}>
                          {opt.label}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Scope */}
              <div className="space-y-3">
                <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest ml-1">Scope</label>
                <div className="flex gap-3">
                  {SCOPE_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setFormData(prev => ({ ...prev, formScope: opt.value }))}
                      className={`px-5 py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all ${
                        formData.formScope === opt.value
                          ? 'bg-primary-950 text-white shadow-lg'
                          : 'bg-slate-50 text-slate-500 hover:bg-slate-100 border-2 border-transparent'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Title & Subtitle */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest ml-1">Title</label>
                  <input
                    type="text"
                    value={formData.formTitle}
                    onChange={e => setFormData(prev => ({ ...prev, formTitle: e.target.value }))}
                    className="w-full px-6 py-4 bg-slate-50 border-2 border-transparent focus:border-primary-950 rounded-2xl transition-all focus:bg-white outline-none font-bold text-slate-900"
                    placeholder="e.g. Student of the Week"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest ml-1">Subtitle</label>
                  <input
                    type="text"
                    value={formData.formSubtitle}
                    onChange={e => setFormData(prev => ({ ...prev, formSubtitle: e.target.value }))}
                    className="w-full px-6 py-4 bg-slate-50 border-2 border-transparent focus:border-primary-950 rounded-2xl transition-all focus:bg-white outline-none font-bold text-slate-900"
                    placeholder="e.g. Computer Science — 300 Level"
                  />
                </div>
              </div>

              {/* Description */}
              <div className="space-y-2">
                <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest ml-1">Description (optional)</label>
                <textarea
                  value={formData.formDescription}
                  onChange={e => setFormData(prev => ({ ...prev, formDescription: e.target.value }))}
                  rows={3}
                  className="w-full px-6 py-4 bg-slate-50 border-2 border-transparent focus:border-primary-950 rounded-2xl transition-all focus:bg-white outline-none font-bold text-slate-900 resize-none"
                  placeholder="Short write-up about the student's achievement..."
                />
              </div>

              {/* Custom Flyer Image */}
              <div className="space-y-2">
                <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest ml-1">Custom Flyer / Photo</label>
                <FileUpload
                  accept="image/*"
                  folder="featured-students"
                  label="Upload Flyer"
                  description="Upload a custom flyer or photo for the featured student"
                  isImage
                  currentFileUrl={formData.formImageUrl}
                  onUploadComplete={(url) => setFormData(prev => ({ ...prev, formImageUrl: url }))}
                />
              </div>

              {/* Expires At */}
              <div className="space-y-2">
                <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest ml-1">Auto-Expire (optional)</label>
                <input
                  type="datetime-local"
                  value={formData.formExpiresAt}
                  onChange={e => setFormData(prev => ({ ...prev, formExpiresAt: e.target.value }))}
                  className="w-full px-6 py-4 bg-slate-50 border-2 border-transparent focus:border-primary-950 rounded-2xl transition-all focus:bg-white outline-none font-bold text-slate-900"
                />
                <p className="text-xs text-slate-400 font-medium ml-1">Leave blank to keep it active until you manually deactivate it.</p>
              </div>

              </form>
            </div>

            {/* Submit */}
            <div className="shrink-0 px-8 pb-8 pt-4 bg-white border-t border-slate-100">
              <div className="flex gap-4">
                <button
                  type="button"
                  onClick={handleClearDraft}
                  className="flex-1 px-8 py-5 bg-slate-100 text-slate-500 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-200 transition-all active:scale-95"
                >
                  Discard Changes
                </button>
                <button
                  type="submit"
                  form="featured-student-form"
                  disabled={isSubmitting || !formData.formSelectedUser}
                  className="flex-[2] relative group inline-flex items-center justify-center gap-3 px-8 py-5 bg-primary-950 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-primary-900 transition-all active:scale-95 shadow-xl shadow-primary-950/20 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <div className="absolute -inset-px bg-gradient-to-r from-emerald-400 to-primary-400 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                  <span className="relative flex items-center gap-2">
                  {isSubmitting ? (
                    <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                  ) : (
                    <>
                      <Send className="w-5 h-5" />
                      {showModal === 'create' ? 'Publish to Students' : 'Save Changes'}
                    </>
                  )}
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Pagination ── */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-4 pt-8">
          <button
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            className="p-3 rounded-2xl bg-gray-50 hover:bg-gray-100 disabled:opacity-30 transition-all"
          >
            <ChevronLeft className="w-5 h-5 text-gray-600" />
          </button>
          <span className="text-sm font-black text-gray-600">
            Page {currentPage} of {totalPages}
          </span>
          <button
            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
            className="p-3 rounded-2xl bg-gray-50 hover:bg-gray-100 disabled:opacity-30 transition-all"
          >
            <ChevronRight className="w-5 h-5 text-gray-600" />
          </button>
        </div>
      )}
    </div>
  );
}

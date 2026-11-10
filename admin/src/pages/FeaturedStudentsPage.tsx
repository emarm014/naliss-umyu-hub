import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import {
  Crown, Star, Trophy, Plus, Search, Edit, Trash2, Eye, EyeOff,
  CheckCircle, X, Users, Calendar, Sparkles, Heart,
  ChevronLeft, ChevronRight, Clock, Send,
  Zap, Flame, Shield, Award, Medal, Rocket, Diamond,
  GraduationCap
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
  icon?: string;
  color?: string;
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

const ICON_OPTIONS = [
  { value: 'star', label: 'Star', icon: Star },
  { value: 'crown', label: 'Crown', icon: Crown },
  { value: 'trophy', label: 'Trophy', icon: Trophy },
  { value: 'award', label: 'Award', icon: Award },
  { value: 'medal', label: 'Medal', icon: Medal },
  { value: 'sparkles', label: 'Sparkles', icon: Sparkles },
  { value: 'heart', label: 'Heart', icon: Heart },
  { value: 'zap', label: 'Zap', icon: Zap },
  { value: 'flame', label: 'Flame', icon: Flame },
  { value: 'shield', label: 'Shield', icon: Shield },
  { value: 'rocket', label: 'Rocket', icon: Rocket },
  { value: 'diamond', label: 'Diamond', icon: Diamond },
  { value: 'graduation-cap', label: 'Graduation', icon: GraduationCap },
];

const COLOR_OPTIONS = [
  { value: '#059669', label: 'Emerald' },
  { value: '#d97706', label: 'Gold' },
  { value: '#2563eb', label: 'Blue' },
  { value: '#7c3aed', label: 'Purple' },
  { value: '#e11d48', label: 'Rose' },
  { value: '#4f46e5', label: 'Indigo' },
  { value: '#0891b2', label: 'Cyan' },
  { value: '#0f172a', label: 'Slate' },
];

const SCOPE_OPTIONS = [
  { value: 'department', label: 'Department' },
  { value: 'faculty', label: 'Faculty' },
  { value: 'university', label: 'University-Wide' },
];

const TYPE_OPTIONS = [
  { value: 'student_of_the_week', label: 'Student of the Week', icon: Star },
  { value: 'legend_of_the_month', label: 'Legend of the Month', icon: Crown },
  { value: 'event_winner', label: 'Event Winner', icon: Trophy },
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
    formType: 'student_of_the_week', // Fallback for DB enum
    formTitle: 'Student of the Week',
    formIcon: 'star',
    formColor: '#059669',
    formScope: 'department',
    formSubtitle: '',
    formDescription: '',
    formImageUrl: '',
    formExpiresAt: '',
    formSelectedUser: null as SearchUser | null,
  });

  const [editingItem, setEditingItem] = useState<FeaturedStudent | null>(null);
  const [viewingItem, setViewingItem] = useState<FeaturedStudent | null>(null);

  const applyDurationHours = (hours: number | null) => {
    if (hours === null) {
      setFormData(prev => ({ ...prev, formExpiresAt: '' }));
      return;
    }
    const target = new Date(Date.now() + hours * 60 * 60 * 1000);
    const localIso = new Date(target.getTime() - target.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
    setFormData(prev => ({ ...prev, formExpiresAt: localIso }));
  };

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
      formIcon: item.icon || 'star',
      formColor: item.color || '#059669',
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
        icon: formData.formIcon,
        color: formData.formColor,
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
    const isPastExpiry = item.expires_at ? new Date(item.expires_at) <= new Date() : false;
    const updatePayload: Record<string, any> = { is_active: newState };
    if (newState && isPastExpiry) {
      updatePayload.expires_at = null;
      updatePayload.published_at = new Date().toISOString();
    }
    setFeatured(prev => prev.map(f => f.id === item.id ? { ...f, ...updatePayload } : f));
    try {
      const { error } = await supabase.from('featured_students').update(updatePayload).eq('id', item.id);
      if (error) throw error;
      setSuccessMessage(newState ? 'Activated — now visible to students.' : 'Deactivated — moved to FYB History on mobile.');
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
            return (
              <div
                key={item.id}
                className={`group relative bg-white rounded-3xl border overflow-hidden transition-all duration-300 hover:shadow-xl hover:-translate-y-1 ${
                  item.is_active ? 'border-gray-100' : 'border-gray-100 opacity-60'
                }`}
              >
                {/* Top Banner Gradient */}
                <div 
                  className="h-2 opacity-80"
                  style={{ backgroundColor: item.color || '#059669' }} 
                />

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
                    <div 
                      className="px-3 py-1.5 rounded-full flex items-center gap-1.5 shadow-sm"
                      style={{ backgroundColor: `${item.color || '#059669'}15`, color: item.color || '#059669' }}
                    >
                      {(() => {
                        const IconComp = ICON_OPTIONS.find(o => o.value === (item.icon || 'star'))?.icon || Star;
                        return <IconComp className="w-3.5 h-3.5" />;
                      })()}
                      <span className="text-[10px] font-black uppercase tracking-wider">
                        {item.title}
                      </span>
                    </div>
                  </div>

                  {/* Title & Subtitle */}
                  <h3 className="text-lg font-black text-gray-900 mb-1">{item.title}</h3>
                  {item.subtitle && <p className="text-sm font-medium text-gray-400 mb-3">{item.subtitle}</p>}

                  {/* Student Note / Motivation Preview */}
                  {item.description ? (
                    <div
                      onClick={() => setViewingItem(item)}
                      className="mb-4 p-3.5 rounded-2xl bg-gray-50 border border-gray-100 cursor-pointer hover:bg-gray-100/70 transition-colors"
                    >
                      <p className="text-[10px] font-black uppercase tracking-widest text-primary-600 mb-1">
                        Featured Note & Motivation
                      </p>
                      <p className="text-xs font-medium text-gray-600 italic line-clamp-2">
                        "{item.description}"
                      </p>
                    </div>
                  ) : null}

                  {/* Metrics Row */}
                  <div className="flex flex-wrap items-center gap-4 mb-4">
                    <div className="flex items-center gap-1.5 text-rose-500">
                      <Heart className="w-4 h-4 fill-rose-500" />
                      <span className="text-sm font-black">{item.total_congratulations}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-gray-400">
                      <Calendar className="w-4 h-4" />
                      <span className="text-xs font-bold">{new Date(item.published_at).toLocaleDateString()}</span>
                    </div>
                    {item.expires_at && (
                      <div className="flex items-center gap-1.5 text-amber-600">
                        <Clock className="w-3.5 h-3.5" />
                        <span className="text-xs font-bold">
                          {new Date(item.expires_at) > new Date()
                            ? `Until ${new Date(item.expires_at).toLocaleDateString()}`
                            : `Ended ${new Date(item.expires_at).toLocaleDateString()}`}
                        </span>
                      </div>
                    )}
                    <div className={`flex items-center gap-1.5 ${item.is_active && (!item.expires_at || new Date(item.expires_at) > new Date()) ? 'text-emerald-500' : 'text-gray-300'}`}>
                      <div className={`w-2 h-2 rounded-full ${item.is_active && (!item.expires_at || new Date(item.expires_at) > new Date()) ? 'bg-emerald-500 animate-pulse' : 'bg-gray-300'}`} />
                      <span className="text-xs font-bold uppercase">
                        {item.is_active && (!item.expires_at || new Date(item.expires_at) > new Date()) ? 'Live' : 'History'}
                      </span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex flex-wrap items-center gap-2 pt-4 border-t border-gray-50">
                    <button
                      onClick={() => setViewingItem(item)}
                      className="flex items-center gap-2 px-4 py-2 bg-primary-50 text-primary-700 rounded-xl text-xs font-bold hover:bg-primary-100 transition-all"
                    >
                      <Eye className="w-3.5 h-3.5" /> View Card
                    </button>
                    {canManageFeatured(item) && (
                      <>
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
                      </>
                    )}
                  </div>
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

              {/* Custom Icon & Title Setup */}
              <div className="space-y-6">
                <div className="space-y-2">
                  <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest ml-1">Recognition Title</label>
                  <input
                    type="text"
                    value={formData.formTitle}
                    onChange={e => setFormData(prev => ({ ...prev, formTitle: e.target.value }))}
                    className="w-full px-6 py-4 bg-slate-50 border-2 border-transparent focus:border-primary-950 rounded-2xl transition-all focus:bg-white outline-none font-bold text-slate-900"
                    placeholder="e.g. Developer of the Year"
                  />
                  <p className="text-xs text-slate-400 font-medium ml-1">Type any custom recognition title you want.</p>
                </div>

                <div className="space-y-3">
                  <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest ml-1">Select Icon</label>
                  <div className="grid grid-cols-5 sm:grid-cols-7 gap-3">
                    {ICON_OPTIONS.map(opt => {
                      const Icon = opt.icon;
                      const isSelected = formData.formIcon === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setFormData(prev => ({ ...prev, formIcon: opt.value }))}
                          className={`p-3 rounded-2xl border-2 transition-all flex flex-col items-center justify-center gap-1 ${
                            isSelected
                              ? 'border-primary-950 bg-primary-50 shadow-md'
                              : 'border-transparent bg-slate-50 hover:border-slate-200'
                          }`}
                        >
                          <Icon className={`w-5 h-5 ${isSelected ? 'text-primary-600' : 'text-slate-400'}`} />
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-3">
                  <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest ml-1">Select Badge Color</label>
                  <div className="flex flex-wrap gap-3">
                    {COLOR_OPTIONS.map(opt => {
                      const isSelected = formData.formColor === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setFormData(prev => ({ ...prev, formColor: opt.value }))}
                          style={{ backgroundColor: opt.value }}
                          className={`w-10 h-10 rounded-full transition-all flex items-center justify-center shadow-sm hover:scale-110 active:scale-95 ${
                            isSelected ? 'ring-4 ring-offset-2 ring-primary-950' : 'ring-1 ring-black/10'
                          }`}
                        >
                          {isSelected && <CheckCircle className="w-5 h-5 text-white" />}
                        </button>
                      );
                    })}
                  </div>
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

              {/* Subtitle */}
              <div className="grid grid-cols-1 gap-6">
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

              {/* Student Note / Motivation & Description */}
              <div className="space-y-2">
                <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest ml-1">
                  Student Note / Motivation & Description
                </label>
                <textarea
                  value={formData.formDescription}
                  onChange={e => setFormData(prev => ({ ...prev, formDescription: e.target.value }))}
                  rows={5}
                  className="w-full px-6 py-4 bg-slate-50 border-2 border-transparent focus:border-primary-950 rounded-2xl transition-all focus:bg-white outline-none font-bold text-slate-900 resize-y"
                  placeholder="Write the featured student's note, motivational message, or achievement story to display on their Featured Card and in FYB History..."
                />
                <p className="text-xs text-slate-400 font-medium ml-1">
                  This note & motivation is shown on the Featured Student card and stays readable in the Mobile FYB History card even after deactivation.
                </p>
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

              {/* Feature Duration / Auto-Expire */}
              <div className="space-y-3">
                <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest ml-1">
                  Feature Duration Time / Auto-Expire
                </label>
                <div className="flex flex-wrap gap-2">
                  {[
                    { label: '24 Hours', hours: 24 },
                    { label: '3 Days', hours: 72 },
                    { label: '7 Days (1 Week)', hours: 168 },
                    { label: '14 Days', hours: 336 },
                    { label: '30 Days (1 Month)', hours: 720 },
                    { label: 'Until Deactivated', hours: null },
                  ].map(preset => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => applyDurationHours(preset.hours)}
                      className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-primary-950 hover:text-white text-slate-700 text-[11px] font-black uppercase tracking-wider transition-all"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
                <input
                  type="datetime-local"
                  value={formData.formExpiresAt}
                  onChange={e => setFormData(prev => ({ ...prev, formExpiresAt: e.target.value }))}
                  className="w-full px-6 py-4 bg-slate-50 border-2 border-transparent focus:border-primary-950 rounded-2xl transition-all focus:bg-white outline-none font-bold text-slate-900"
                />
                <p className="text-xs text-slate-400 font-medium ml-1">
                  Select a duration preset above or pick an exact date/time. Leave blank to keep active until you manually deactivate it.
                </p>
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

      {/* ── Featured Student Detail Card Preview Modal ── */}
      {viewingItem && (
        <div
          onClick={() => setViewingItem(null)}
          className="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center z-[100] p-4 animate-in fade-in duration-300"
        >
          <div
            onClick={e => e.stopPropagation()}
            className="bg-white rounded-[2rem] shadow-2xl w-full max-w-lg flex flex-col max-h-[86vh] overflow-hidden border border-slate-100 animate-in zoom-in-95 duration-300"
          >
            {/* Top Honor Banner */}
            <div
              className="px-6 py-3.5 flex items-center justify-between text-white"
              style={{ background: `linear-gradient(90deg, ${viewingItem.color || '#059669'}, #022c22)` }}
            >
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4" />
                <span className="text-xs font-black uppercase tracking-widest">
                  {viewingItem.title}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setViewingItem(null)}
                className="p-1.5 rounded-full bg-black/25 hover:bg-black/40 transition-colors"
              >
                <X className="w-4 h-4 text-white" />
              </button>
            </div>

            {/* Status & Stats Row */}
            <div className="px-6 py-3 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
              <span
                className="px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider text-white"
                style={{ backgroundColor: viewingItem.color || '#059669' }}
              >
                {viewingItem.is_active && (!viewingItem.expires_at || new Date(viewingItem.expires_at) > new Date())
                  ? '✨ Active Feature'
                  : '🏛️ FYB History Archive'}
              </span>
              <div className="flex items-center gap-3">
                <span className="text-xs font-bold text-slate-400">
                  {new Date(viewingItem.published_at).toLocaleDateString()}
                </span>
                <span className="px-2.5 py-1 rounded-full bg-rose-50 text-rose-600 text-xs font-black flex items-center gap-1">
                  <Heart className="w-3.5 h-3.5 fill-rose-500 text-rose-500" />
                  {viewingItem.total_congratulations}
                </span>
              </div>
            </div>

            {/* Scrollable Body */}
            <div className="overflow-y-auto flex-1 custom-scrollbar">
              {/* Image Header */}
              <div className="relative h-52 bg-slate-900">
                {viewingItem.custom_image_url || viewingItem.users?.avatar_url ? (
                  <img
                    src={viewingItem.custom_image_url || viewingItem.users?.avatar_url || ''}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-slate-800">
                    <Star className="w-12 h-12 text-white/20" />
                  </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent flex items-end p-5">
                  <div className="flex items-center gap-3">
                    {viewingItem.users?.avatar_url ? (
                      <img
                        src={viewingItem.users.avatar_url}
                        alt=""
                        className="w-11 h-11 rounded-full object-cover border-2 border-amber-400"
                      />
                    ) : null}
                    <div>
                      <p className="text-lg font-black text-amber-400 leading-tight">
                        {viewingItem.users?.full_name || 'Featured Student'}
                      </p>
                      <p className="text-xs font-semibold text-white/80">
                        @{viewingItem.users?.username || 'student'}
                        {viewingItem.subtitle ? ` • ${viewingItem.subtitle}` : ''}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Note & Motivation Content */}
              <div className="p-6 space-y-4">
                <div className="text-center">
                  <h3 className="text-xl font-black text-emerald-700">{viewingItem.title}</h3>
                  {viewingItem.subtitle && (
                    <p className="text-xs font-bold text-slate-400 mt-1">{viewingItem.subtitle}</p>
                  )}
                </div>

                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-2">
                  <p
                    className="text-[11px] font-black uppercase tracking-widest"
                    style={{ color: viewingItem.color || '#059669' }}
                  >
                    Featured Note & Motivation
                  </p>
                  <p className="text-sm font-medium text-slate-700 italic whitespace-pre-line leading-relaxed">
                    {viewingItem.description
                      ? `"${viewingItem.description}"`
                      : 'Recognized for outstanding academic excellence, leadership, and positive contribution in the Department of Library and Information Science (NALISS), UMYU.'}
                  </p>
                </div>

                {viewingItem.expires_at && (
                  <div className="flex items-center gap-2 text-xs font-bold text-slate-400 pt-2 border-t border-slate-100">
                    <Clock className="w-4 h-4" />
                    <span>
                      {new Date(viewingItem.expires_at) > new Date()
                        ? `Active until ${new Date(viewingItem.expires_at).toLocaleString()}`
                        : `Feature period ended ${new Date(viewingItem.expires_at).toLocaleString()}`}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="p-4 bg-white border-t border-slate-100 flex items-center justify-end gap-3">
              {canManageFeatured(viewingItem) && (
                <button
                  type="button"
                  onClick={() => {
                    const itemToEdit = viewingItem;
                    setViewingItem(null);
                    openEdit(itemToEdit);
                  }}
                  className="px-5 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-black uppercase tracking-wider transition-all"
                >
                  Edit Note / Duration
                </button>
              )}
              <button
                type="button"
                onClick={() => setViewingItem(null)}
                className="px-6 py-2.5 rounded-xl bg-primary-950 hover:bg-primary-900 text-white text-xs font-black uppercase tracking-wider transition-all"
              >
                Done
              </button>
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

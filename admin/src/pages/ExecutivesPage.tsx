import { useEffect, useState, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import type { Executive } from '../types';
import { useAdminDataStore } from '../store/adminData.store';
import { deleteFromCloudinary } from '../lib/cloudinaryDelete';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import ErrorState from '../components/ui/ErrorState';
import { Crown, Search, Edit, Trash2, Linkedin, Twitter, Facebook, Plus, Users, Activity, ShieldAlert, FileText, Play, Eye, X, Loader2, User as UserIcon, Instagram, ImageIcon, ChevronLeft, ChevronRight, CheckCircle, AlertTriangle } from 'lucide-react';
import FileUpload from '../lib/FileUpload';
import { getValidUrl, getVideoThumbnail } from '../utils/media';
import { useAuthStore } from '../store/auth.store';
import { sortHierarchically } from '../utils/hierarchy';

const ITEMS_PER_PAGE = 12;

const positionLabels: Record<string, string> = {
  president: 'President',
  vice_president: 'Vice President',
  secretary: 'Secretary',
  assistant_secretary: 'Assistant Secretary',
  treasurer: 'Treasurer',
  financial_secretary: 'Financial Secretary',
  public_relations: 'Public Relations Officer',
  social_director: 'Social Director',
  sport_director: 'Sport Director',
  welfare_director: 'Welfare Director',
  academic_director: 'Academic Director',
};

export default function ExecutivesPage() {
  const { profile } = useAuthStore();
  const isSuperAdmin = profile?.role === 'super_admin';
  const canManageExec = (executive: Executive) => isSuperAdmin || (profile?.role === 'moderator' && (executive as any).created_by === profile?.id);
  const [searchQuery, setSearchQuery] = useState('');
  const [sessionFilter, setSessionFilter] = useState<string>('all');
  const [currentFilter, setCurrentFilter] = useState<'all' | 'current' | 'past'>('current');
  const [currentPage, setCurrentPage] = useState(1);
  const [showModal, setShowModal] = useState<'create' | 'edit' | 'photos' | null>(null);
  const [selectedExecutive, setSelectedExecutive] = useState<Executive | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [customPosition, setCustomPosition] = useState('');
  const [studentSearchQuery, setStudentSearchQuery] = useState('');

  const { executives: allExecutives, students, isSyncing, error: storeError, syncAll, removeExecutive, refreshAnalytics } = useAdminDataStore();

  useEffect(() => {
    syncAll();
  }, [syncAll]);

  // Executive Statistics
  const executiveStats = {
    totalExecutives: allExecutives.length,
    current: allExecutives.filter(e => e.is_current).length,
    past: allExecutives.filter(e => !e.is_current).length
  };

  // Client-side filtering and pagination
  let filteredExecutives = allExecutives.filter(executive => {
    const displayName = executive.full_name || executive.linked_user?.full_name || '';
    const matchesSearch = displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      executive.position.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCurrent = currentFilter === 'all' ||
      (currentFilter === 'current' && executive.is_current) ||
      (currentFilter === 'past' && !executive.is_current);
    const matchesSession = sessionFilter === 'all' || executive.academic_session === sessionFilter;

    return matchesSearch && matchesCurrent && matchesSession;
  });

  filteredExecutives = sortHierarchically(filteredExecutives, 'executive');

  const totalCount = filteredExecutives.length;
  const totalPages = Math.ceil(totalCount / ITEMS_PER_PAGE);
  const paginatedExecutives = filteredExecutives.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  const [formData, setFormData] = useState({
    user_id: '',
    full_name: '',
    position: 'president',
    email: '',
    phone: '',
    avatar_url: '',
    bio: '',
    department_id: '',
    academic_session: '2026/2027',
    start_date: '',
    end_date: '',
    is_current: true,
    linkedin: '',
    twitter: '',
    instagram: '',
    facebook: '',
  });

  // Selected student resolution (from store or linked record)
  const selectedStudent = useMemo(() => {
    if (!formData.user_id) return null;
    return students.find(s => s.id === formData.user_id) || (selectedExecutive?.user_id === formData.user_id ? (selectedExecutive as any).linked_user || {
      id: formData.user_id,
      full_name: formData.full_name,
      username: '',
      avatar_url: formData.avatar_url,
      level: '',
      email: formData.email,
    } : null);
  }, [formData.user_id, students, selectedExecutive, formData.full_name, formData.avatar_url, formData.email]);

  // Filter registered students for the selection dropdown
  const filteredStudents = useMemo(() => {
    const q = studentSearchQuery.trim().toLowerCase();
    if (!q) return students.slice(0, 30);
    return students.filter(s => {
      const name = (s.full_name || '').toLowerCase();
      const username = (s.username || '').toLowerCase();
      const reg = (s.registration_number || '').toLowerCase();
      const level = String(s.level || '').toLowerCase();
      return name.includes(q) || username.includes(q) || reg.includes(q) || level.includes(q);
    }).slice(0, 30);
  }, [students, studentSearchQuery]);

  const handleSelectStudent = (student: any) => {
    setFormData(prev => ({
      ...prev,
      user_id: student.id,
      full_name: student.full_name || prev.full_name,
      email: student.email || prev.email,
      phone: student.phone || prev.phone,
      avatar_url: student.avatar_url || prev.avatar_url,
      bio: student.bio || student.biography || prev.bio,
      department_id: student.department_id || prev.department_id,
    }));
    setStudentSearchQuery('');
    setFormError(null);
  };

  const handleDeselectStudent = () => {
    setFormData(prev => ({
      ...prev,
      user_id: '',
      full_name: '',
      email: '',
      phone: '',
      avatar_url: '',
      bio: '',
      department_id: '',
    }));
    setStudentSearchQuery('');
  };

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, currentFilter, sessionFilter]);

  const handleDelete = async (id: string) => {
    if (isSubmitting) return;
    if (!window.confirm('Are you sure you want to permanently delete this executive record?')) return;

    // Capture avatar URL BEFORE optimistic remove
    const exec = allExecutives.find(e => e.id === id) as any;
    const avatarUrl = exec?.avatar_url;

    removeExecutive(id);
    setSuccessMessage('Executive record removed.');
    setTimeout(() => setSuccessMessage(null), 5000);

    try {
      const { error } = await supabase.from('executives').delete().eq('id', id);
      if (error) {
        syncAll(true);
        setSuccessMessage(null);
      } else {
        deleteFromCloudinary([avatarUrl]);
      }
    } catch {
      syncAll(true);
    }
  };

  const handleToggleCurrent = async (executive: Executive) => {
    try {
      const { error } = await supabase
        .from('executives')
        .update({ is_current: !executive.is_current })
        .eq('id', executive.id);
      if (error) throw error;
      setSuccessMessage(`Executive marked as ${!executive.is_current ? 'Current' : 'Past'}.`);
      refreshAnalytics();
      setTimeout(() => setSuccessMessage(null), 5000);
    } catch (err: unknown) {
      setFormError('Failed to update: ' + ((err as any)?.message || 'Unknown error'));
    }
  };

  const handleArchiveTenure = async (executive: Executive) => {
    if (!window.confirm(`Are you sure you want to end the tenure for ${executive.full_name} and shift them to Alumni?`)) return;

    try {
      const { error } = await supabase
        .from('executives')
        .update({ is_current: false, is_alumni: true, end_date: new Date().toISOString() })
        .eq('id', executive.id);
      if (error) throw error;
      setSuccessMessage(`${executive.full_name || 'Executive'} archived as Alumni.`);
      syncAll(true);
      refreshAnalytics();
      setTimeout(() => setSuccessMessage(null), 5000);
    } catch (err: unknown) {
      setFormError('Failed to archive: ' + ((err as any)?.message || 'Unknown error'));
    }
  };

  const openCreateModal = () => {
    setCustomPosition('');
    setStudentSearchQuery('');
    setFormError(null);
    setFormData({
      user_id: '',
      full_name: '', position: 'president', email: '', phone: '', avatar_url: '', bio: '',
      department_id: '', academic_session: '2026/2027', start_date: '', end_date: '',
      is_current: true, linkedin: '', twitter: '', instagram: '', facebook: '',
    });
    setShowModal('create');
  };

  const openEditModal = (executive: Executive) => {
    setSelectedExecutive(executive);
    const isStandard = Object.keys(positionLabels).includes(executive.position_code || '');
    setStudentSearchQuery('');
    setFormError(null);
    setFormData({
      user_id: executive.user_id || '',
      full_name: executive.full_name || '',
      position: isStandard ? (executive.position_code || 'president') : 'other',
      email: executive.email || '',
      phone: executive.phone || '',
      avatar_url: executive.avatar_url || '',
      bio: executive.bio || '',
      department_id: executive.department_id || '',
      academic_session: executive.academic_session,
      start_date: executive.start_date || '',
      end_date: executive.end_date || '',
      is_current: executive.is_current,
      linkedin: executive.social_links?.linkedin || '',
      twitter: executive.social_links?.twitter || '',
      instagram: executive.social_links?.instagram || '',
      facebook: executive.social_links?.facebook || '',
    });
    setCustomPosition(isStandard ? '' : executive.position);
    setShowModal('edit');
  };

  const openPhotosModal = async (executive: Executive) => {
    try {
      const { data, error } = await supabase.from('photos').select('*').eq('entity_type', 'executive').eq('entity_id', executive.id).order('display_order');
      if (error) throw error;
      setSelectedExecutive({ ...executive, photos: data || [] });
      setShowModal('photos');
    } catch {
      setSelectedExecutive(executive);
      setShowModal('photos');
    }
  };



  const handleDeletePhoto = async (photoId: string) => {
    if (!selectedExecutive) return;
    if (!window.confirm('Are you sure you want to delete this photo?')) return;
    try {
      const { error } = await supabase.from('photos').delete().eq('id', photoId);
      if (error) throw error;
      const { data } = await supabase
        .from('photos').select('*')
        .eq('entity_type', 'executive').eq('entity_id', selectedExecutive.id)
        .order('display_order');
      setSelectedExecutive({ ...selectedExecutive, photos: data || [] });
    } catch (err: unknown) {
      setFormError((err as any)?.message || 'Failed to delete photo.');
    }
  };

  const handleSetProfilePhoto = async (photoUrl: string) => {
    if (!selectedExecutive) return;
    try {
      const { error } = await supabase
        .from('executives').update({ avatar_url: photoUrl }).eq('id', selectedExecutive.id);
      if (error) throw error;
      setSelectedExecutive({ ...selectedExecutive, avatar_url: photoUrl });
      refreshAnalytics();
      setSuccessMessage('Profile photo updated.');
      setTimeout(() => setSuccessMessage(null), 4000);
    } catch (err: unknown) {
      setFormError((err as any)?.message || 'Failed to set profile photo.');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Enforce that only registered students can be added as executives
    if (!formData.user_id) {
      setFormError('Please select a registered student. Only registered students can be appointed as department executives.');
      return;
    }

    setIsSubmitting(true);
    setFormError(null);
    try {
      const social_links: Record<string, string> = {
        linkedin: formData.linkedin || '',
        twitter: formData.twitter || '',
        instagram: formData.instagram || '',
        facebook: formData.facebook || '',
      };

      const executiveData = {
        user_id: formData.user_id,
        full_name: formData.full_name || null,
        position: formData.position === 'other' ? customPosition : positionLabels[formData.position] || formData.position,
        position_code: formData.position === 'other' ? customPosition.toLowerCase().replace(/\s+/g, '_') : formData.position,
        email: formData.email || null,
        phone: formData.phone || null,
        avatar_url: formData.avatar_url || null,
        bio: formData.bio || null,
        department_id: formData.department_id || null,
        academic_session: formData.academic_session,
        start_date: formData.start_date || null,
        end_date: formData.end_date || null,
        is_current: formData.is_current,
        social_links,
      };

      if (showModal === 'create') {
        const { data: inserted, error } = await supabase.from('executives').insert(executiveData).select('*, linked_user:users(id, full_name, username, avatar_url, level, registration_number, email, phone, bio, department_id)').single();
        if (error) throw error;
        if (inserted) useAdminDataStore.getState().addExecutive(inserted as any);
      } else if (showModal === 'edit' && selectedExecutive) {
        const { data: updated, error } = await supabase.from('executives').update(executiveData).eq('id', selectedExecutive.id).select('*, linked_user:users(id, full_name, username, avatar_url, level, registration_number, email, phone, bio, department_id)').single();
        if (error) throw error;
        if (updated) useAdminDataStore.getState().updateExecutive(updated as any);
      }

      setSuccessMessage(`Executive saved successfully.`);
      setShowModal(null);
      setFormError(null);
      refreshAnalytics();
      setTimeout(() => setSuccessMessage(null), 5000);
    } catch (err: unknown) {
      setFormError((err as any)?.message || 'Failed to save. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };


  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Global Success Banner */}
      {successMessage && (
        <div className="fixed top-6 right-6 z-[100] bg-green-900 border border-green-700 text-green-100 px-6 py-4 rounded-xl shadow-2xl flex items-center gap-4 animate-in fade-in slide-in-from-top-6 duration-300">
          <div className="w-10 h-10 bg-green-800 rounded-full flex items-center justify-center flex-shrink-0 border border-green-600">
            <Crown className="w-5 h-5 text-green-300" />
          </div>
          <div>
            <p className="font-bold tracking-wide">SUCCESS</p>
            <p className="text-sm opacity-90">{successMessage}</p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="bg-primary-950 rounded-[2.5rem] p-10 lg:p-14 text-white shadow-2xl relative overflow-hidden group">
        <div className="absolute top-0 right-0 w-[600px] h-full bg-primary-400/5 -skew-x-12 translate-x-20 transition-transform duration-1000 group-hover:translate-x-10" />
        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-12">
          <div className="max-w-2xl">
            <div className="flex flex-wrap items-center gap-4 mb-4">
              <div className="px-4 py-1.5 bg-primary-400/20 border border-primary-300/30 rounded-xl flex items-center gap-2.5">
                <Crown className="w-4 h-4 text-primary-400 animate-pulse" />
                <span className="text-[10px] font-black uppercase tracking-[0.25em] text-primary-300 italic">Executives</span>
              </div>
            </div>
            <h1 className="text-4xl lg:text-7xl font-black leading-[1.05] tracking-tight">
              Student <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary-200 via-primary-300 to-amber-200">Leadership.</span>
            </h1>
            <p className="text-slate-400 font-medium text-base mt-6 max-w-xl">Manage union executives, office holders, and archived student leadership rosters.</p>
          </div>
          {isSuperAdmin && (
            <button onClick={openCreateModal} className="btn-institutional px-8 py-4 text-base font-bold shadow-xl flex items-center justify-center gap-3">
              <Plus className="w-5 h-5" />
              <span>Register Executive</span>
            </button>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="glass-card p-6 border-l-4 border-l-primary-500">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-bold text-slate-400 tracking-wider uppercase">Total Records</p>
              <p className="text-3xl font-extrabold text-primary-950 mt-1">{executiveStats.totalExecutives}</p>
            </div>
            <div className="w-12 h-12 bg-primary-50 rounded-xl flex items-center justify-center">
              <Users className="w-6 h-6 text-primary-600" />
            </div>
          </div>
        </div>
        <div className="glass-card p-6 border-l-4 border-l-green-500">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-bold text-slate-500 uppercase tracking-wider">Current Executives</p>
              <p className="text-3xl font-extrabold text-primary-950 mt-1">{executiveStats.current}</p>
            </div>
            <div className="w-12 h-12 bg-green-50 rounded-xl flex items-center justify-center">
              <Activity className="w-6 h-6 text-green-600" />
            </div>
          </div>
        </div>
        <div className="glass-card p-6 border-l-4 border-l-amber-500">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-bold text-slate-500 uppercase tracking-wider">Past Executives</p>
              <p className="text-3xl font-extrabold text-primary-950 mt-1">{executiveStats.past}</p>
            </div>
            <div className="w-12 h-12 bg-amber-50 rounded-xl flex items-center justify-center">
              <ShieldAlert className="w-6 h-6 text-amber-600" />
            </div>
          </div>
        </div>
      </div>

      {/* Tools */}
      <div className="glass-card p-4 flex flex-col md:flex-row gap-4 items-center justify-between">
        <div className="relative w-full md:flex-1 max-w-lg">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" />
          <input
            type="text"
            placeholder="Search executives..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary-500 focus:bg-white font-medium text-slate-700"
          />
        </div>
        <div className="flex gap-2 w-full md:w-auto overflow-x-auto">
          <select value={currentFilter} onChange={(e) => setCurrentFilter(e.target.value as 'all' | 'current' | 'past')} className="px-4 py-3 bg-white border border-slate-200 rounded-xl font-bold text-slate-600 focus:ring-2 focus:ring-primary-500">
            <option value="all">All Records</option>
            <option value="current">Current Term</option>
            <option value="past">Past Terms</option>
          </select>
          <select value={sessionFilter} onChange={(e) => setSessionFilter(e.target.value)} className="px-4 py-3 bg-white border border-slate-200 rounded-xl font-bold text-slate-600 focus:ring-2 focus:ring-primary-500">
            <option value="all">All Sessions</option>
            <option value="2027/2028">2027/2028</option>
            <option value="2026/2027">2026/2027</option>
            <option value="2025/2026">2025/2026</option>
          </select>
        </div>
      </div>

      {/* Executive List */}
      {(isSyncing && allExecutives.length === 0) ? (
        <div className="flex flex-col items-center justify-center py-24 glass-card">
          <LoadingSpinner size="lg" />
          <p className="mt-4 text-slate-500 font-medium tracking-wide animate-pulse">Loading executives...</p>
        </div>
      ) : (storeError && allExecutives.length === 0) ? (
        <div className="py-12 glass-card">
          <ErrorState onRetry={syncAll} message={storeError} />
        </div>
      ) : paginatedExecutives.length === 0 ? (
        <div className="glass-card p-16 text-center border-dashed border-2 border-slate-300">
          <Crown className="h-16 w-16 text-slate-300 mx-auto mb-4" />
          <h3 className="text-xl font-bold text-slate-700">No Executives Found</h3>
          <p className="text-slate-500 mt-2 max-w-md mx-auto">The directory is empty. Add an executive to build the student leadership roster.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {paginatedExecutives.map((executive) => {
            const linkedStudent = students.find(s => s.id === executive.user_id) || executive.linked_user;
            const displayName = executive.full_name || linkedStudent?.full_name || 'NALISS Executive';
            const displayAvatar = executive.avatar_url || linkedStudent?.avatar_url;
            return (
              <div key={executive.id} className={`glass-card relative overflow-hidden group transition-all duration-300 hover:-translate-y-1 hover:shadow-xl ${!executive.is_current ? 'opacity-70 grayscale-[30%]' : ''}`}>
                <div className={`absolute top-0 right-0 h-1 w-full ${executive.is_current ? 'bg-primary-500' : 'bg-amber-500'}`} />
                <div className="p-6">
                  <div className="flex items-start gap-4">
                    <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-primary-100 to-primary-50 border-2 border-white shadow-md flex items-center justify-center overflow-hidden">
                      {displayAvatar ? (
                        <img src={displayAvatar} alt={displayName} className="w-full h-full object-cover" />
                      ) : (
                        <UserIcon className="h-8 w-8 text-primary-400/50" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-lg font-bold text-slate-900 truncate tracking-tight">{displayName}</h3>
                      <div className="inline-flex mt-1 bg-primary-950 text-white px-2 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase">
                        {executive.position}
                      </div>
                      <p className="text-xs font-bold text-slate-400 mt-2">{executive.academic_session} SESSION</p>

                      {/* Linked Student Indicator */}
                      {linkedStudent ? (
                        <div className="flex items-center gap-1.5 mt-2 text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-lg w-fit border border-emerald-200">
                          <CheckCircle className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                          <span className="truncate">@{linkedStudent.username || 'student'} • {linkedStudent.level || '—'} Lvl</span>
                        </div>
                      ) : executive.user_id ? (
                        <div className="flex items-center gap-1.5 mt-2 text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-lg w-fit border border-emerald-200">
                          <CheckCircle className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                          <span>Linked Student</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 mt-2 text-[11px] font-bold text-amber-700 bg-amber-50 px-2.5 py-1 rounded-lg w-fit border border-amber-200">
                          <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                          <span>Unlinked Legacy</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="mt-5 pt-4 border-t border-slate-100 grid grid-cols-4 gap-2">
                    {['linkedin', 'twitter', 'instagram', 'facebook'].map(platform => {
                      const url = (executive.social_links as Record<string, string>)?.[platform];
                      if (!url) return null;
                      return (
                        <a key={platform} href={url} target="_blank" rel="noopener noreferrer" className="h-8 flex justify-center items-center bg-slate-50 border border-slate-100 rounded-lg hover:bg-primary-50 hover:text-primary-600 text-slate-400 transition-colors">
                          {platform === 'linkedin' && <Linkedin className="w-4 h-4" />}
                          {platform === 'twitter' && <Twitter className="w-4 h-4" />}
                          {platform === 'instagram' && <Instagram className="w-4 h-4" />}
                          {platform === 'facebook' && <Facebook className="w-4 h-4" />}
                        </a>
                      );
                    })}
                  </div>

                  {canManageExec(executive) && (
                    <div className="mt-4 flex flex-col gap-2">
                      <div className="flex items-center justify-between">
                        <button onClick={() => handleToggleCurrent(executive)} className={`btn-institutional-sm ${executive.is_current ? 'bg-amber-100 text-amber-700 hover:bg-amber-200' : 'bg-green-100 text-green-700 hover:bg-green-200'}`}>
                          {executive.is_current ? 'Archive Profile' : 'Restore'}
                        </button>
                        <div className="flex gap-1.5">
                          <button onClick={() => openPhotosModal(executive)} className="p-2 bg-slate-50 text-slate-500 rounded-lg hover:bg-primary-50 hover:text-primary-600 transition-colors" title="Manage Gallery">
                            <ImageIcon className="h-4 w-4" />
                          </button>
                          <button onClick={() => openEditModal(executive)} className="p-2 bg-slate-50 text-slate-500 rounded-lg hover:bg-slate-200 transition-colors" title="Edit Profile">
                            <Edit className="h-4 w-4" />
                          </button>
                          <button onClick={() => handleDelete(executive.id)} className="p-2 bg-slate-50 text-slate-400 rounded-lg hover:bg-red-50 hover:text-red-600 transition-colors" title="Delete Profile">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                      {executive.is_current && !executive.is_alumni && (
                        <button onClick={() => handleArchiveTenure(executive)} className="w-full py-2 bg-primary-100 text-primary-700 hover:bg-primary-200 rounded-lg text-xs font-bold transition-colors">
                          End Tenure / Shift to Alumni
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between glass-card p-4">
          <p className="text-sm font-medium text-slate-500">PAGE <span className="text-slate-900">{currentPage}</span> OF {totalPages}</p>
          <div className="flex gap-2">
            <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} className="p-2 rounded-xl bg-slate-50 border disabled:opacity-50"><ChevronLeft className="w-5 h-5" /></button>
            <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} className="p-2 rounded-xl bg-slate-50 border disabled:opacity-50"><ChevronRight className="w-5 h-5" /></button>
          </div>
        </div>
      )}

      {/* Modal Section */}
      {(showModal === 'create' || showModal === 'edit') && (
        <div className="fixed inset-0 bg-primary-950/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between p-6 bg-slate-50 border-b border-slate-100">
              <div>
                <h2 className="text-xl font-bold tracking-tight text-slate-900">
                  {showModal === 'create' ? 'Register New Executive' : 'Edit Executive'}
                </h2>
                <p className="text-sm text-slate-500 font-medium">
                  {showModal === 'create' ? 'Add a new student leader to the mobile app.' : 'Update executive information below.'}
                </p>
              </div>
              <button onClick={() => setShowModal(null)} className="p-2 bg-white text-slate-400 hover:text-slate-600 rounded-xl shadow-sm border border-slate-200"><X className="w-5 h-5" /></button>
            </div>
            <form id="exec-form" onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Mandatory Registered Student Selection */}
              <div className="bg-slate-50 p-5 rounded-2xl border border-slate-200/80 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <label className="block text-xs font-black text-slate-800 uppercase tracking-widest">
                      Select Registered Student <span className="text-rose-500">*</span>
                    </label>
                    <p className="text-xs text-slate-500 font-medium mt-0.5">
                      Only active registered students can be appointed as department executives.
                    </p>
                  </div>
                  {selectedStudent && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-100 text-emerald-800 text-[10px] font-black rounded-lg uppercase tracking-wider">
                      <CheckCircle className="w-3 h-3 text-emerald-600" /> Linked
                    </span>
                  )}
                </div>

                {selectedStudent ? (
                  <div className="flex items-center gap-4 p-4 bg-white rounded-xl border border-emerald-200 shadow-sm">
                    {selectedStudent.avatar_url ? (
                      <img src={selectedStudent.avatar_url} alt="" className="w-12 h-12 rounded-xl object-cover border border-slate-100" />
                    ) : (
                      <div className="w-12 h-12 rounded-xl bg-emerald-100 flex items-center justify-center text-emerald-700 font-black text-lg">
                        {(selectedStudent.full_name || 'S').charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-bold text-slate-900 truncate">{selectedStudent.full_name}</p>
                        <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded text-[10px] font-bold">
                          {selectedStudent.level || '—'} Level
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 font-medium truncate mt-0.5">
                        @{selectedStudent.username || 'student'} {selectedStudent.registration_number ? `• Reg: ${selectedStudent.registration_number}` : ''} {selectedStudent.email ? `• ${selectedStudent.email}` : ''}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleDeselectStudent}
                      className="px-3 py-1.5 text-xs font-bold text-slate-500 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors border border-slate-200"
                    >
                      Change Student
                    </button>
                  </div>
                ) : (
                  <div className="relative">
                    <div className="relative">
                      <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        type="text"
                        value={studentSearchQuery}
                        onChange={(e) => setStudentSearchQuery(e.target.value)}
                        placeholder="Search student by name, reg number, username, or level..."
                        className="w-full pl-10 pr-4 py-3 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary-500 font-medium text-slate-800 text-sm shadow-sm"
                      />
                    </div>

                    {students.length === 0 ? (
                      <div className="mt-2 p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-center gap-2.5 text-xs text-amber-800">
                        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                        <span>No registered students found. Students must register on the mobile app before they can be assigned as executives.</span>
                      </div>
                    ) : (
                      <div className="mt-2 max-h-56 overflow-y-auto bg-white border border-slate-200 rounded-xl shadow-lg divide-y divide-slate-100">
                        {filteredStudents.length > 0 ? (
                          filteredStudents.map((student) => (
                            <button
                              key={student.id}
                              type="button"
                              onClick={() => handleSelectStudent(student)}
                              className="w-full p-3 flex items-center gap-3 hover:bg-slate-50 transition-colors text-left"
                            >
                              {student.avatar_url ? (
                                <img src={student.avatar_url} alt="" className="w-9 h-9 rounded-lg object-cover border border-slate-100 shrink-0" />
                              ) : (
                                <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center text-slate-600 font-bold text-xs shrink-0">
                                  {(student.full_name || 'S').charAt(0).toUpperCase()}
                                </div>
                              )}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="font-bold text-sm text-slate-900 truncate">{student.full_name}</span>
                                  <span className="px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded text-[10px] font-bold shrink-0">
                                    {student.level || '—'} Lvl
                                  </span>
                                </div>
                                <p className="text-xs text-slate-400 truncate">
                                  @{student.username || 'student'} {student.registration_number ? `• ${student.registration_number}` : ''}
                                </p>
                              </div>
                              <span className="px-2.5 py-1 text-xs font-bold text-primary-600 bg-primary-50 rounded-lg shrink-0">
                                Select
                              </span>
                            </button>
                          ))
                        ) : (
                          <div className="p-4 text-center text-xs text-slate-400">
                            No registered students found matching &quot;{studentSearchQuery}&quot;
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-6">
                <div className="col-span-2 bg-slate-50/50 p-5 rounded-xl border border-slate-100">
                  <h3 className="text-sm font-bold text-slate-900 mb-4 tracking-wide uppercase text-[10px] tracking-[0.2em] text-primary-900">Profile Photo</h3>
                  <FileUpload accept="image/*" isImage={true} folder="avatars" onUploadComplete={(url) => setFormData({ ...formData, avatar_url: url })} currentFileUrl={formData.avatar_url} label="Upload Photo" />
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Legal Name</label>
                  <input type="text" value={formData.full_name} onChange={(e) => setFormData({ ...formData, full_name: e.target.value })} className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary-500 font-medium" required />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Office Held</label>
                  <select value={formData.position} onChange={(e) => setFormData({ ...formData, position: e.target.value })} className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary-500 font-medium">
                    {Object.entries(positionLabels).map(([code, label]) => (<option key={code} value={code}>{label}</option>))}
                    <option value="other">Other (Custom)</option>
                  </select>
                  {formData.position === 'other' && <input type="text" value={customPosition} onChange={(e) => setCustomPosition(e.target.value)} placeholder="Custom Title" className="w-full mt-2 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary-500" required />}
                </div>
                <div><label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Session</label><input type="text" value={formData.academic_session} onChange={(e) => setFormData({ ...formData, academic_session: e.target.value })} className="w-full px-4 py-3 bg-slate-50 border rounded-xl" /></div>
                <div><label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Email Address</label><input type="email" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} className="w-full px-4 py-3 bg-slate-50 border rounded-xl" /></div>
                <div><label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Phone Number</label><input type="tel" value={formData.phone} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} placeholder="e.g. +234..." className="w-full px-4 py-3 bg-slate-50 border rounded-xl" /></div>

                <div className="col-span-2">
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Biography / Introduction</label>
                  <textarea value={formData.bio} onChange={(e) => setFormData({ ...formData, bio: e.target.value })} rows={3} placeholder="Brief bio of the executive..." className="w-full px-4 py-3 bg-slate-50 border rounded-xl font-medium resize-none" />
                </div>

                <div className="col-span-2 flex items-center gap-3 p-4 bg-slate-50 rounded-xl border border-slate-100">
                  <input
                    type="checkbox"
                    id="is_current"
                    checked={formData.is_current}
                    onChange={(e) => setFormData({ ...formData, is_current: e.target.checked })}
                    className="w-5 h-5 text-primary-600 rounded border-slate-300 focus:ring-primary-500"
                  />
                  <div>
                    <label htmlFor="is_current" className="text-sm font-bold text-slate-900 cursor-pointer">Current Administration</label>
                    <p className="text-xs font-medium text-slate-500">Uncheck to archive this executive into legacy records.</p>
                  </div>
                </div>
              </div>
            </form>
            <div className="flex flex-col gap-3 p-6 bg-slate-50 border-t border-slate-100">
              {formError && (
                <div className="flex items-center gap-3 px-4 py-3 bg-red-50 border border-red-100 rounded-xl">
                  <Crown className="w-4 h-4 text-red-500 shrink-0" />
                  <p className="text-sm font-medium text-red-700">{formError}</p>
                </div>
              )}
              <div className="flex justify-end gap-3">
                <button type="button" onClick={() => setShowModal(null)} className="px-6 py-2.5 text-slate-600 font-bold hover:bg-slate-200 rounded-xl">Cancel</button>
                <button
                  type="submit"
                  form="exec-form"
                  disabled={isSubmitting || !formData.user_id}
                  className="btn-institutional px-8 py-2.5 min-w-[180px] disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Processing...</span>
                    </>
                  ) : (
                    <>
                      <Plus className="w-4 h-4" />
                      <span>{showModal === 'create' ? 'Add to Mobile App' : 'Update Profile'}</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Media Archive Modal */}
      {showModal === 'photos' && selectedExecutive && (
        <div className="fixed inset-0 bg-primary-950/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between p-6 bg-slate-50 border-b border-slate-100">
              <div>
                <h2 className="text-xl font-bold text-slate-900 tracking-tight">Executive Photos</h2>
                <p className="text-sm text-slate-500 font-medium">Gallery for {selectedExecutive.full_name}</p>
              </div>
              <button
                onClick={() => setShowModal(null)}
                className="p-2 bg-white text-slate-400 hover:text-slate-600 rounded-xl shadow-sm border border-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                {/* Photo Upload */}
                <div className="aspect-square bg-slate-50 border-2 border-dashed border-slate-200 rounded-2xl flex items-center justify-center p-4 group hover:border-primary-500 hover:bg-primary-50/30 transition-all duration-300">
                  <FileUpload
                    accept="image/*,video/*"
                    folder="executive-photos"
                    onUploadComplete={async (url) => {
                      try {
                        const { error } = await supabase.from('photos').insert({
                          entity_type: 'executive',
                          entity_id: selectedExecutive.id,
                          url,
                          display_order: (selectedExecutive.photos?.length || 0) + 1
                        });
                        if (error) throw error;
                        openPhotosModal(selectedExecutive);
                      } catch (err: unknown) {
                        setFormError((err as Error)?.message || 'Failed to save photo.');
                      }
                    }}
                    label="Upload"
                  />
                </div>

                {/* Photo Gallery */}
                {selectedExecutive.photos?.map((photo) => {
                  const isImage = photo.url.match(/\.(jpeg|jpg|gif|png|webp|svg)$/i) != null;
                  const isVideo = photo.url.match(/\.(mp4|webm|ogg|mov|avi)$/i) != null;
                  return (
                    <div key={photo.id} className="aspect-square relative group bg-slate-100 rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-all border border-slate-100">
                      {isImage ? (
                        <img src={getValidUrl(photo.url)} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                      ) : isVideo ? (
                        <div className="w-full h-full relative bg-purple-50">
                          <img src={getVideoThumbnail(getValidUrl(photo.url))} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                          <div className="absolute inset-0 flex items-center justify-center bg-black/10">
                            <div className="w-10 h-10 bg-purple-600/90 rounded-full flex items-center justify-center shadow-lg"><Play className="w-4 h-4 text-white ml-1" /></div>
                          </div>
                        </div>
                      ) : (
                        <div className="w-full h-full flex items-center justify-center bg-blue-50/50"><FileText className="w-10 h-10 text-blue-300 group-hover:scale-110 transition-transform duration-300" /></div>
                      )}
                      <div className="absolute inset-0 bg-primary-950/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center p-4 gap-2">
                        <button
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); window.open(photo.url, '_blank'); }}
                          className="w-full py-1.5 bg-white hover:bg-slate-50 text-slate-900 rounded-lg text-xs font-bold shadow-lg flex items-center justify-center gap-1.5 transition-colors"
                          title="Preview"
                        >
                          <Eye className="w-3.5 h-3.5" /> PREVIEW
                        </button>
                        {isImage && (
                          <button
                            onClick={() => handleSetProfilePhoto(photo.url)}
                            className="w-full py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold shadow-lg flex items-center justify-center gap-1.5 transition-colors"
                          >
                            <UserIcon className="w-3.5 h-3.5" /> SET AVATAR
                          </button>
                        )}
                        <button
                          onClick={() => handleDeletePhoto(photo.id)}
                          className="w-full py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-bold shadow-lg flex items-center justify-center gap-1.5 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" /> DELETE
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>

              {(!selectedExecutive.photos || selectedExecutive.photos.length === 0) && (
                <div className="py-20 text-center">
                  <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4 border border-slate-100">
                    <Plus className="w-8 h-8 text-slate-300" />
                  </div>
                  <p className="text-slate-400 font-bold tracking-tight">NO PHOTOS FOUND</p>
                  <p className="text-slate-500 text-sm mt-1">Upload images to populate the executive gallery.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

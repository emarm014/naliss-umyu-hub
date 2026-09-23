import { useEffect, useState, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import type { Graduate, User } from '../types';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import ErrorState from '../components/ui/ErrorState';
import {
  Search, Edit, Trash2, GraduationCap, Calendar,
  Briefcase, Linkedin, X, ChevronLeft, ChevronRight,
  Archive, Lock, Unlock, ShieldAlert, Award
} from 'lucide-react';

import { useAdminDataStore } from '../store/adminData.store';
import FileUpload from '../lib/FileUpload';

interface GraduateWithUser extends Graduate {
  original_user?: Pick<User, 'avatar_url' | 'department_id'> | null;
}

const ITEMS_PER_PAGE = 12;
const currentYear = new Date().getFullYear();
const graduateYears = Array.from({ length: 20 }, (_, i) => currentYear - 5 + i);

export default function GraduatesPage() {
  const { graduates: allGraduates, students: allStudents, isSyncing, lastSync, syncAll, removeGraduate, error, refreshAnalytics } = useAdminDataStore();

  useEffect(() => {
    syncAll();
  }, [syncAll]);

  const [searchQuery, setSearchQuery] = useState('');
  const [yearFilter, setYearFilter] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [showModal, setShowModal] = useState<'edit' | null>(null);
  const [selectedGraduate, setSelectedGraduate] = useState<GraduateWithUser | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [graduatingId, setGraduatingId] = useState<string | null>(null); // per-student guard
  const [activeTab, setActiveTab] = useState<'graduates' | 'graduate'>('graduates');
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const showSuccess = (message: string) => {
    setSuccessMessage(message);
    setTimeout(() => setSuccessMessage(null), 5000);
  };

  const [formData, setFormData] = useState({
    full_name: '', registration_number: '', email: '', phone: '',
    graduation_year: currentYear, current_occupation: '', current_organization: '',
    contact_email: '', linkedin_url: '', achievements: '', is_private: false, avatar_url: '',
  });

  // Derive Level 400 candidates from the global student roster
  const level400Students = (allStudents as User[]).filter(
    (s) => s.level === '400' && s.status === 'active'
  );

  // Instant Client-Side Orchestration
  const filteredGraduates = useMemo(() => {
    let result = [...(allGraduates as GraduateWithUser[])];

    if (yearFilter !== 'all') {
      result = result.filter(g => g.graduation_year === Number(yearFilter));
    }

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(g =>
        g.full_name?.toLowerCase().includes(q) ||
        g.registration_number?.toLowerCase().includes(q)
      );
    }

    return result;
  }, [allGraduates, yearFilter, searchQuery]);

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [yearFilter, searchQuery]);

  const totalCount = filteredGraduates.length;
  const from = (currentPage - 1) * ITEMS_PER_PAGE;
  const to = from + ITEMS_PER_PAGE;
  const graduates = filteredGraduates.slice(from, to);
  const totalPages = Math.ceil(totalCount / ITEMS_PER_PAGE);

  // Reactive Pulse Stats from global store
  const pulseStats = {
    totalAlumni: allGraduates.length,
    currentClass: allGraduates.filter(g => (g as GraduateWithUser).graduation_year === currentYear).length,
  };

  const handleGraduateStudent = async (student: User) => {
    if (graduatingId === student.id) return; // prevent double-click on same student
    if (!window.confirm(`Are you sure you want to graduate ${student.full_name}? This will archive their student account and move them to the alumni roster.`)) {
      return;
    }

    // Check if already graduated to prevent duplicates
    const alreadyGraduated = (allGraduates as any[]).some(g => g.user_id === student.id);
    if (alreadyGraduated) {
      setFormError(`${student.full_name} has already been graduated.`);
      return;
    }

    setGraduatingId(student.id);
    try {
      // Insert alumni record first — if this fails, user status is NOT changed
      const { error: graduateError } = await supabase.from('graduates').insert({
        user_id: student.id, full_name: student.full_name, registration_number: student.registration_number,
        email: student.email, phone: student.phone, graduation_year: currentYear, avatar_url: student.avatar_url, is_private: true,
      });
      if (graduateError) throw graduateError;

      const { error: userError } = await supabase.from('users').update({ 
        status: 'graduated',
        updated_at: new Date().toISOString(),
      }).eq('id', student.id);
      if (userError) throw userError;

      // Remove from all group memberships so they no longer appear in chats
      await supabase.from('group_members').delete().eq('user_id', student.id);

      // Audit log
      const currentAdmin = (await supabase.auth.getUser()).data.user;
      await supabase.from('activity_logs').insert({
        user_id: currentAdmin?.id,
        action: 'user.graduate',
        entity_id: student.id,
        entity_type: 'user',
        description: `Graduated student: ${student.full_name} (${student.registration_number}) — Class of ${currentYear}`,
      });

      showSuccess(`Student ${student.full_name} archived to Alumni successfully!`);
      refreshAnalytics();
    } catch (err: unknown) {
      setFormError((err as any)?.message || 'Failed to graduate student. Please try again.');
    } finally {
      setGraduatingId(null);
    }
  };

  const handleDelete = async (graduate: GraduateWithUser) => {
    if (!window.confirm(`Are you sure you want to permanently delete the alumni record for ${graduate.full_name}?`)) {
      return;
    }

    removeGraduate(graduate.id);
    showSuccess('Alumni record deleted successfully.');

    try {
      const { error } = await supabase.from('graduates').delete().eq('id', graduate.id);
      if (error) syncAll(true);
    } catch {
      syncAll(true);
    }
  };

  const handleTogglePrivacy = async (graduate: GraduateWithUser) => {
    try {
      const { error } = await supabase.from('graduates').update({ is_private: !graduate.is_private }).eq('id', graduate.id);
      if (error) throw error;
      showSuccess(`Alumni profile is now ${!graduate.is_private ? 'private' : 'public'}.`);
      refreshAnalytics();
    } catch (err: unknown) {
      setFormError('Failed to update privacy: ' + ((err as any)?.message || 'Unknown error'));
    }
  };

  const openEditModal = (graduate: GraduateWithUser) => {
    setSelectedGraduate(graduate);
    setFormData({
      full_name: graduate.full_name, registration_number: graduate.registration_number, email: graduate.email,
      phone: graduate.phone || '', graduation_year: graduate.graduation_year, current_occupation: graduate.current_occupation || '',
      current_organization: graduate.current_organization || '', contact_email: graduate.contact_email || '',
      linkedin_url: graduate.linkedin_url || '', achievements: graduate.achievements || '', is_private: graduate.is_private,
      avatar_url: graduate.avatar_url || '',
    });
    setShowModal('edit');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      if (showModal === 'edit' && selectedGraduate) {
        const { error } = await supabase.from('graduates').update({
          full_name: formData.full_name, registration_number: formData.registration_number, email: formData.email,
          phone: formData.phone || null, graduation_year: formData.graduation_year, current_occupation: formData.current_occupation || null,
          current_organization: formData.current_organization || null, contact_email: formData.contact_email || null,
          linkedin_url: formData.linkedin_url || null, achievements: formData.achievements || null, is_private: formData.is_private,
          avatar_url: formData.avatar_url || null,
        }).eq('id', selectedGraduate.id);
        if (error) throw error;
        showSuccess(`Alumni profile synchronized.`);
        setShowModal(null);
        setFormError(null);
        refreshAnalytics();
      }
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
        <div className="fixed top-6 right-6 z-[100] bg-primary-950 border border-primary-800 text-white px-8 py-5 rounded-[2rem] shadow-2xl flex items-center gap-6 animate-in slide-in-from-top-6 duration-500">
          <div className="w-12 h-12 bg-primary-800 rounded-full flex items-center justify-center flex-shrink-0 border border-primary-700 shadow-inner">
            <GraduationCap className="w-6 h-6 text-primary-400" />
          </div>
          <div>
            <p className="text-[10px] font-black tracking-[0.25em] text-primary-400 italic">ALUMNI</p>
            <p className="text-sm font-bold tracking-tight">{successMessage}</p>
          </div>
        </div>
      )}

      {/* Hero Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-6 bg-white/50 p-6 rounded-2xl border border-gray-100 shadow-sm backdrop-blur-sm">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-primary-950 to-primary-700 bg-clip-text text-transparent">Alumni Center</h1>
          <p className="text-slate-500 mt-2 font-medium">Manage and track NALISS alumni and graduating students.</p>
        </div>
        <div className="flex bg-slate-100 p-1.5 rounded-xl border border-slate-200">
          <button onClick={() => {
            if (activeTab === 'graduates') syncAll();
            else setActiveTab('graduates');
          }} className={`px-6 py-2.5 rounded-lg font-bold text-sm transition-all duration-300 ${activeTab === 'graduates' ? 'bg-white text-primary-950 shadow-sm border border-slate-200/60' : 'text-slate-500 hover:text-slate-700'}`}>
            <div className="flex items-center gap-2">
              {activeTab === 'graduates' && isSyncing ? <Archive className="w-4 h-4 animate-spin" /> : <Archive className="w-4 h-4" />}
              Alumni List
            </div>
          </button>
          <button onClick={() => {
            if (activeTab === 'graduate') syncAll();
            else setActiveTab('graduate');
          }} className={`px-6 py-2.5 rounded-lg font-bold text-sm transition-all duration-300 flex items-center gap-2 ${activeTab === 'graduate' ? 'bg-primary-950 text-white shadow-lg' : 'text-slate-500 hover:text-slate-700'}`}>
            {activeTab === 'graduate' && isSyncing ? <GraduationCap className="w-4 h-4 animate-spin" /> : <GraduationCap className="w-4 h-4" />}
            Candidate Pool
            {level400Students.length > 0 && <span className="bg-amber-500 text-amber-950 text-xs px-2 py-0.5 rounded-full ml-1">{level400Students.length}</span>}
          </button>
        </div>
      </div>

      {/* Alumni Pulse (Telemetry) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="glass-card p-6 border-l-4 border-l-primary-600">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-bold text-slate-400 tracking-wider uppercase">Generational Registry</p>
              <p className="text-3xl font-extrabold text-primary-950 mt-1">{pulseStats.totalAlumni}</p>
            </div>
            <div className="w-12 h-12 bg-primary-50 rounded-xl flex items-center justify-center">
              <Archive className="w-6 h-6 text-primary-600" />
            </div>
          </div>
        </div>
        <div className="glass-card p-6 border-l-4 border-l-green-500">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-bold text-slate-400 tracking-wider uppercase">Class of {currentYear}</p>
              <p className="text-3xl font-extrabold text-primary-950 mt-1">{pulseStats.currentClass}</p>
            </div>
            <div className="w-12 h-12 bg-green-50 rounded-xl flex items-center justify-center">
              <Award className="w-6 h-6 text-green-600" />
            </div>
          </div>
        </div>
        <div className="glass-card p-6 border-l-4 border-l-amber-500">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-bold text-slate-400 tracking-wider uppercase">L400 Candidates</p>
              <p className="text-3xl font-extrabold text-primary-950 mt-1">{level400Students.length}</p>
            </div>
            <div className="w-12 h-12 bg-amber-50 rounded-xl flex items-center justify-center">
              <ShieldAlert className="w-6 h-6 text-amber-600" />
            </div>
          </div>
        </div>
      </div>

      {activeTab === 'graduate' ? (
        // ======================= PENDING ARCHIVAL LAYER ======================= //
        <div className="space-y-6 animate-in slide-in-from-right-8 duration-300">
          <div className="flex items-center justify-between">
             <h2 className="text-xl font-bold tracking-tight text-slate-900 border-b-2 border-primary-950 pb-2 inline-block">Students Ready to Graduate</h2>
          </div>
          {level400Students.length === 0 ? (
            <div className="glass-card p-16 text-center border-dashed border-2 border-slate-300">
              <GraduationCap className="h-16 w-16 text-slate-300 mx-auto mb-4" />
              <h3 className="text-xl font-bold text-slate-700">No Students Found</h3>
              <p className="text-slate-500 mt-2 max-w-md mx-auto">There are currently no active Level 400 students ready for graduation.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {level400Students.map((student) => (
                <div key={student.id} className="glass-card relative overflow-hidden group border border-amber-200">
                  <div className="absolute top-0 right-0 h-1 w-full bg-amber-500" />
                  <div className="p-6">
                    <div className="flex items-start gap-4">
                      <div className="w-14 h-14 rounded-xl bg-amber-50 border-2 border-white shadow-sm flex items-center justify-center overflow-hidden flex-shrink-0">
                        {student.avatar_url ? (
                          <img src={student.avatar_url} alt={student.full_name} className="w-full h-full object-cover" />
                        ) : (
                          <span className="text-lg font-bold text-amber-600 uppercase">{student.full_name.slice(0, 2)}</span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="text-lg font-bold text-slate-900 truncate">{student.full_name}</h3>
                        <p className="text-xs font-bold text-slate-400 mt-1 uppercase tracking-widest">{student.registration_number}</p>
                        <p className="text-xs font-medium text-slate-500 truncate mt-0.5">{student.email}</p>
                      </div>
                    </div>
                    <button onClick={() => handleGraduateStudent(student)} disabled={graduatingId === student.id} className="btn-institutional w-full mt-6 bg-primary-950 hover:bg-primary-900 disabled:opacity-50 flex items-center justify-center gap-2">
                      <Archive className="w-4 h-4" /> {graduatingId === student.id ? 'GRADUATING...' : 'GRADUATE STUDENT'}
                    </button>
                    {formError && (
                      <div className="mt-3 flex items-center gap-3 px-4 py-3 bg-red-50 border border-red-100 rounded-xl">
                        <ShieldAlert className="w-4 h-4 text-red-500 shrink-0" />
                        <p className="text-xs font-medium text-red-700">{formError}</p>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        // ======================= GLOBAL SECURE ARCHIVE ======================= //
        <div className="space-y-6 animate-in slide-in-from-left-8 duration-300">
          <div className="glass-card p-4 flex flex-col md:flex-row gap-4 items-center justify-between">
            <div className="relative w-full md:flex-1 max-w-lg">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" />
              <input
                type="text" placeholder="Trace historical records..."
                value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary-500 focus:bg-white font-medium text-slate-700"
              />
            </div>
            <select value={yearFilter} onChange={(e) => setYearFilter(e.target.value)} className="px-4 py-3 bg-white border border-slate-200 rounded-xl font-bold text-slate-600 focus:ring-2 focus:ring-primary-500 w-full md:w-auto">
              <option value="all">All Years</option>
              {graduateYears.map((year) => (<option key={year} value={year}>Class of {year}</option>))}
            </select>
          </div>

          {allGraduates.length === 0 && isSyncing && !lastSync ? (
            <div className="flex flex-col items-center justify-center py-24 glass-card">
              <LoadingSpinner size="lg" />
              <p className="mt-4 text-slate-500 font-medium tracking-wide animate-pulse">Loading alumni records...</p>
            </div>
          ) : error ? (
            <div className="py-12 glass-card"><ErrorState onRetry={() => syncAll()} message="Institutional synchronization failed. Verify connection." /></div>
          ) : graduates.length === 0 ? (
            <div className="glass-card p-16 text-center border-dashed border-2 border-slate-300">
              <Archive className="h-16 w-16 text-slate-300 mx-auto mb-4" />
              <h3 className="text-xl font-bold text-slate-700">No Records Found</h3>
              <p className="text-slate-500 mt-2 max-w-md mx-auto">No alumni records match your current search filters.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {graduates.map((graduate) => (
                <div key={graduate.id} className="glass-card relative overflow-hidden group transition-all duration-300 hover:-translate-y-1 hover:shadow-xl">
                  <div className={`absolute top-0 right-0 h-1 w-full ${graduate.is_private ? 'bg-amber-500' : 'bg-primary-500'}`} />
                  <div className="p-6">
                    <div className="flex justify-between items-start mb-4">
                       <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded border text-[10px] font-bold uppercase tracking-widest ${graduate.is_private ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-primary-50 border-primary-200 text-primary-700'}`}>
                          {graduate.is_private ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                          {graduate.is_private ? 'Private Profile' : 'Public Profile'}
                        </span>
                        <div className="bg-slate-100 text-slate-600 border border-slate-200 px-3 py-1 rounded text-[10px] font-extrabold uppercase tracking-widest flex items-center gap-1">
                           <Calendar className="w-3 h-3"/> CLASS OF '{graduate.graduation_year.toString().slice(2)}
                        </div>
                    </div>
                    
                    <div className="flex items-center gap-4">
                      <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-slate-100 to-slate-50 border-2 border-white shadow-sm flex items-center justify-center overflow-hidden flex-shrink-0">
                        {graduate.avatar_url ? (
                          <img src={graduate.avatar_url} alt={graduate.full_name} className="w-full h-full object-cover" />
                        ) : (
                          <span className="text-xl font-bold text-slate-400 uppercase">{graduate.full_name.slice(0, 2)}</span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="text-lg font-bold text-slate-900 truncate">{graduate.full_name}</h3>
                        <p className="text-xs font-bold text-slate-400 mt-0.5 uppercase tracking-widest">{graduate.registration_number}</p>
                        {graduate.current_occupation && (
                           <div className="flex items-center gap-1 mt-2 text-xs font-medium text-primary-700">
                              <Briefcase className="w-3.5 h-3.5"/>
                              <span className="truncate">{graduate.current_occupation} {graduate.current_organization && <span className="text-slate-500">@ {graduate.current_organization}</span>}</span>
                           </div>
                        )}
                      </div>
                    </div>

                    <div className="mt-5 pt-4 border-t border-slate-100 flex items-center justify-between">
                      <div className="flex gap-2">
                        {graduate.linkedin_url && (
                           <a href={graduate.linkedin_url} target="_blank" rel="noopener noreferrer" className="p-2 bg-slate-50 text-blue-600 rounded-lg border border-slate-100 hover:bg-blue-50">
                              <Linkedin className="w-4 h-4" />
                           </a>
                        )}
                        <button onClick={() => openEditModal(graduate)} className="p-2 bg-slate-50 text-slate-500 rounded-lg hover:bg-slate-200"><Edit className="w-4 h-4" /></button>
                        <button onClick={() => handleDelete(graduate)} className="p-2 bg-slate-50 text-slate-400 rounded-lg hover:bg-red-50 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
                      </div>
                      <button onClick={() => handleTogglePrivacy(graduate)} className={`text-xs font-bold tracking-wider uppercase px-3 py-1.5 rounded-lg border ${graduate.is_private ? 'border-primary-200 text-primary-600 hover:bg-primary-50' : 'border-amber-200 text-amber-600 hover:bg-amber-50'}`}>
                         {graduate.is_private ? 'Make Public' : 'Make Private'}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
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
        </div>
      )}

      {/* Legacy Edit Modal */}
      {showModal === 'edit' && (
        <div className="fixed inset-0 bg-primary-950/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between p-6 bg-slate-50 border-b border-slate-100">
              <div>
                <h2 className="text-xl font-bold tracking-tight text-slate-900">Edit Alumni Profile</h2>
                <p className="text-sm text-slate-500 font-medium">Update alumni information.</p>
              </div>
              <button onClick={() => setShowModal(null)} className="p-2 bg-white text-slate-400 hover:text-slate-600 rounded-xl shadow-sm border border-slate-200"><X className="w-5 h-5" /></button>
            </div>
            
            <form id="graduate-edit-form" onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-6 flex flex-col">
              <div className="grid grid-cols-2 gap-6 flex-1">
                <div className="col-span-2 bg-slate-50/50 p-5 rounded-xl border border-slate-100">
                  <h3 className="text-sm font-bold text-slate-900 mb-4 tracking-[0.2em] uppercase text-[10px] text-primary-900">Alumni Photo</h3>
                  <FileUpload
                    accept="image/*"
                    isImage={true}
                    folder="avatars"
                    onUploadComplete={(url) => setFormData({ ...formData, avatar_url: url })}
                    currentFileUrl={formData.avatar_url}
                    label="Upload Photo"
                  />
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Full Name</label>
                  <input type="text" value={formData.full_name} onChange={(e) => setFormData({ ...formData, full_name: e.target.value })} className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary-500 font-medium" required />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Reg Number</label>
                  <input type="text" value={formData.registration_number} onChange={(e) => setFormData({ ...formData, registration_number: e.target.value })} className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary-500 font-medium" required />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Graduation Year</label>
                  <select value={formData.graduation_year} onChange={(e) => setFormData({ ...formData, graduation_year: Number(e.target.value) })} className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary-500 font-medium" required>
                    {graduateYears.map((year) => (<option key={year} value={year}>{year}</option>))}
                  </select>
                </div>
                <div><label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Email Address</label><input type="email" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} className="w-full px-4 py-3 bg-slate-50 border rounded-xl" /></div>
                <div><label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Occupation</label><input type="text" value={formData.current_occupation} onChange={(e) => setFormData({ ...formData, current_occupation: e.target.value })} className="w-full px-4 py-3 bg-slate-50 border rounded-xl" placeholder="e.g. Lead Architect"/></div>
                <div><label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Organization</label><input type="text" value={formData.current_organization} onChange={(e) => setFormData({ ...formData, current_organization: e.target.value })} className="w-full px-4 py-3 bg-slate-50 border rounded-xl" placeholder="e.g. Company Name"/></div>
                <div><label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">LinkedIn URL</label><input type="url" value={formData.linkedin_url} onChange={(e) => setFormData({ ...formData, linkedin_url: e.target.value })} className="w-full px-4 py-3 bg-slate-50 border rounded-xl"/></div>
                <div><label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Contact Link</label><input type="email" value={formData.contact_email} onChange={(e) => setFormData({ ...formData, contact_email: e.target.value })} className="w-full px-4 py-3 bg-slate-50 border rounded-xl"/></div>
                
                <div className="col-span-2">
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Achievements</label>
                  <textarea value={formData.achievements} onChange={(e) => setFormData({ ...formData, achievements: e.target.value })} rows={3} className="w-full px-4 py-3 bg-slate-50 border rounded-xl font-medium" placeholder="Notable achievements..."></textarea>
                </div>
                
                <div className="col-span-2 mt-2 bg-amber-50 p-4 rounded-xl border border-amber-200 flex items-center gap-3">
                    <input type="checkbox" id="is_private" checked={formData.is_private} onChange={(e) => setFormData({ ...formData, is_private: e.target.checked })} className="w-6 h-6 rounded border-amber-300 text-amber-600 focus:ring-amber-500 cursor-pointer" />
                    <div><label htmlFor="is_private" className="text-sm font-bold text-amber-900 cursor-pointer">Private Profile</label><p className="text-xs font-medium text-amber-700 mt-0.5">If checked, this alumni record will be hidden from public view.</p></div>
                </div>
              </div>
            </form>
            <div className="flex flex-col gap-3 p-6 bg-slate-50 border-t border-slate-100">
              {formError && (
                <div className="flex items-center gap-3 px-4 py-3 bg-red-50 border border-red-100 rounded-xl">
                  <GraduationCap className="w-4 h-4 text-red-500 shrink-0" />
                  <p className="text-sm font-medium text-red-700">{formError}</p>
                </div>
              )}
              <div className="flex justify-end gap-3">
              <button type="button" onClick={() => setShowModal(null)} className="px-6 py-2.5 text-slate-600 font-bold hover:bg-slate-200 rounded-xl">Cancel</button>
              <button type="submit" form="graduate-edit-form" disabled={isSubmitting} className="btn-institutional px-8 py-2.5 disabled:opacity-50">{isSubmitting ? 'Saving...' : 'Save Changes'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

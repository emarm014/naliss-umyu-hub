import { useEffect, useState, useMemo } from 'react';
import { useLocation } from 'react-router-dom';

import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/auth.store';
import { useShallow } from 'zustand/react/shallow';
import { useAdminDataStore } from '../store/adminData.store';
import type { PastQuestion } from '../types';
import ErrorState from '../components/ui/ErrorState';
import {
  Plus,
  Search,
  Edit,
  Trash2,
  Eye,
  Star,
  MoreVertical,
  X,
  ChevronLeft,
  ChevronRight,
  Layers,
  Calendar,
  BookOpen,
  Shield,
  Workflow,
  Database,
  Activity,
  FileSearch,
  Info,
  Archive,
  AlertCircle,
  ExternalLink,
  ChevronDown,
  Globe,
  FileType,
  CheckCircle,
} from 'lucide-react';

import FileUpload from '../lib/FileUpload';
import { deleteFromCloudinary } from '../lib/cloudinaryDelete';
import InstitutionalDocumentViewer from '../components/InstitutionalDocumentViewer';
import { useFormDraft } from '../hooks/useFormDraft';

interface PastQuestionWithDetails extends Omit<PastQuestion, 'course'> {
  course?: { code: string; title: string } | null;
  uploader?: { full_name: string; email: string } | null;
}

interface ArchiveStats {
  totalRecords: number;
  featuredCount: number;
  storageUsage: number;
  lastUpdate: Date;
}

const ITEMS_PER_PAGE = 10;

export default function PastQuestionsPage() {
  const { 
    pastQuestions: storePastQuestions, 
    courses: storeCourses, 
    isSyncing: loading, 
    error, 
    syncAll,
    removePastQuestion,
    refreshAnalytics,
  } = useAdminDataStore(
    useShallow((state) => ({
      pastQuestions: state.pastQuestions,
      courses: state.courses,
      isSyncing: state.isSyncing,
      error: state.error,
      syncAll: state.syncAll,
      removePastQuestion: state.removePastQuestion,
      refreshAnalytics: state.refreshAnalytics,
    }))
  );


  const [searchQuery, setSearchQuery] = useState('');
  const [levelFilter, setLevelFilter] = useState<string>('all');
  const [courseFilter, setCourseFilter] = useState<string>('all');
  const [semesterFilter, setSemesterFilter] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedPQ, setSelectedPQ] = useState<PastQuestionWithDetails | null>(null);
  const [showPreview, setShowPreview] = useState<string | null>(null);
  const [showDropdown, setShowDropdown] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const { permissions, profile } = useAuthStore();
  const assignedLevel = permissions?.assigned_level || null;
  const { showModal, setShowModal, formData, setFormData, clearDraft } = useFormDraft('past_questions_draft', {
    title: '',
    description: '',
    course_id: '',
    file_url: '',
    file_name: '',
    file_mime_type: '',
    is_public: true,
    is_downloadable: true,
    is_featured: false,
    level: '' as string,
    semester: '' as string,
    file_size: 0,
    files: [] as Array<{url: string, name: string, size: number, type?: string}>,
  });

  useEffect(() => {
    syncAll();
  }, [syncAll]);

  const location = useLocation();

  // Detect and consume assets shared from the Cloud Archive
  useEffect(() => {
      const asset = (location.state as any)?.predefinedAsset;
      if (asset && !showModal) {
          setFormData(prev => ({
              ...prev,
              title: asset.title || prev.title,
              file_url: asset.url,
              file_size: asset.size || 0,
              files: [],
          }));
          setShowModal('create');
          // Clean up location state to prevent re-opening on refresh
          window.history.replaceState({}, document.title);
      }
  }, [location, showModal]);

  // Derived Filtering
  const filteredPastQuestions = useMemo(() => {
    return storePastQuestions.filter(pq => {
      const matchesSearch = !searchQuery || pq.title.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesLevel = levelFilter === 'all' ? true : pq.level === levelFilter;
      const matchesCourse = courseFilter === 'all' || pq.course_id === courseFilter;
      const matchesSemester = semesterFilter === 'all' || pq.semester === semesterFilter;
      const matchesAssignedLevel = !assignedLevel || pq.level === assignedLevel;

      return matchesSearch && matchesLevel && matchesCourse && matchesSemester && matchesAssignedLevel;
    });
  }, [storePastQuestions, searchQuery, levelFilter, courseFilter, semesterFilter, assignedLevel]);

  // Derived Stats
  const stats = useMemo<ArchiveStats>(() => {
    return {
      totalRecords: storePastQuestions.length,
      featuredCount: storePastQuestions.filter(pq => pq.is_featured).length,
      storageUsage: storePastQuestions.reduce((sum, pq) => sum + (pq.file_size || 0), 0),
      lastUpdate: new Date()
    };
  }, [storePastQuestions]);

  const totalCount = filteredPastQuestions.length;
  const totalPages = Math.ceil(totalCount / ITEMS_PER_PAGE);

  const paginatedPQ = useMemo(() => {
    const from = (currentPage - 1) * ITEMS_PER_PAGE;
    const to = from + ITEMS_PER_PAGE;
    return filteredPastQuestions.slice(from, to);
  }, [filteredPastQuestions, currentPage]);


  const handleToggleFeatured = async (pq: PastQuestionWithDetails) => {
    const newVal = !pq.is_featured;
    useAdminDataStore.getState().updatePastQuestion({ ...pq, is_featured: newVal } as any);
    try {
      const { error } = await supabase.from('past_questions').update({ is_featured: newVal }).eq('id', pq.id);
      if (error) throw error;
    } catch (err: unknown) {
      useAdminDataStore.getState().updatePastQuestion(pq as any); // revert
      setFormError('Failed to update: ' + ((err as any)?.message || 'Unknown error'));
    }
  };

  const handleDelete = async (pq: PastQuestionWithDetails) => {
    if (!window.confirm(`Are you sure you want to delete "${pq.title}"? This action cannot be undone.`)) {
      return;
    }

    removePastQuestion(pq.id);
    setSuccessMessage('Past question deleted successfully');
    setTimeout(() => setSuccessMessage(null), 5000);

    try {
      const { error } = await supabase.from('past_questions').delete().eq('id', pq.id);
      if (error) {
        syncAll(true);
        setSuccessMessage(null);
      } else {
        deleteFromCloudinary([pq.file_url]);
      }
    } catch {
      syncAll(true);
    }
  };

  const handlePreview = (url: string, e: React.MouseEvent) => {
    e.preventDefault();
    setShowPreview(url);
  };


  const openCreateModal = () => {
    if (!localStorage.getItem('past_questions_draft')) {
      setFormData({
        title: '',
        description: '',
        course_id: '',
        file_url: '',
        file_name: '',
        file_mime_type: '',
        is_public: true,
        is_downloadable: true,
        is_featured: false,
        level: assignedLevel || '',
        semester: '',
        file_size: 0,
        files: [],
      });
    }
    setShowModal('create');
  };

  const openEditModal = (pq: PastQuestionWithDetails) => {
    setSelectedPQ(pq);
    setFormData({
      title: pq.title,
      description: pq.description || '',
      course_id: pq.course_id || '',
      file_url: pq.file_url || '',
      file_name: pq.file_name || '',
      file_mime_type: pq.file_mime_type || '',
      is_public: pq.is_public,
      is_downloadable: pq.is_downloadable,
      is_featured: pq.is_featured,
      level: pq.level || '',
      semester: pq.semester || '',
      file_size: pq.file_size || 0,
      files: (pq as any).files || [],
    });
    setShowModal('edit');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setFormError(null);

    if (!formData.level || !formData.semester) {
      setFormError('Please select a Level and Semester.');
      setIsSubmitting(false);
      return;
    }

    try {
      const pqData = {
        title: formData.title,
        description: formData.description || null,
        course_id: (!formData.course_id || formData.course_id === 'general') ? null : formData.course_id,
        is_public: true,        // Always public — students must always be able to access past questions
        is_downloadable: formData.is_downloadable,
        is_featured: formData.is_featured,
        level: formData.level || null,
        semester: formData.semester || null,
        uploaded_by: profile?.id,
      };

      if (showModal === 'create') {
        const hasBatch = formData.files && formData.files.length > 0;
        if (hasBatch) {
            const inserts = formData.files.map((f: any, i: number) => ({
                ...pqData,
                title: formData.files.length > 1 && !formData.title.includes(f.name)
                    ? `${formData.title} (${i + 1})`
                    : formData.title || f.name,
                file_url: f.url,
                file_name: f.name,
                file_size: f.size,
                file_mime_type: f.type,
                files: []
            }));
            const { data: insertedList, error } = await supabase.from('past_questions').insert(inserts).select('*, course:courses!past_questions_course_id_fkey(id, code, title, level, semester)');
            if (error) throw error;
            if (insertedList) {
                insertedList.forEach((item: any) => useAdminDataStore.getState().addPastQuestion(item as any));
            }
        } else {
            const singleData = {
                ...pqData,
                file_url: formData.file_url || null,
                file_name: formData.file_name || null,
                file_size: formData.file_size || 0,
                file_mime_type: formData.file_mime_type || null,
                files: []
            };
            const { data: inserted, error } = await supabase.from('past_questions').insert(singleData).select('*, course:courses!past_questions_course_id_fkey(id, code, title, level, semester)').single();
            if (error) throw error;
            if (inserted) useAdminDataStore.getState().addPastQuestion(inserted as any);
        }
      } else if (showModal === 'edit' && selectedPQ) {
        const singleData = {
            ...pqData,
            file_url: formData.file_url || null,
            file_name: formData.file_name || null,
            file_size: formData.file_size || 0,
            file_mime_type: formData.file_mime_type || null,
            files: []
        };
        const { data: updated, error } = await supabase.from('past_questions').update(singleData).eq('id', selectedPQ.id).select('*, course:courses!past_questions_course_id_fkey(id, code, title, level, semester)').single();
        if (error) throw error;
        if (updated) useAdminDataStore.getState().updatePastQuestion(updated as any);
      }

      setSuccessMessage(`Past Question ${showModal === 'create' ? 'created' : 'updated'} successfully!`);
      if (showModal === 'create') clearDraft();
      else setShowModal(null);
      refreshAnalytics();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      setTimeout(() => setSuccessMessage(null), 5000);
    } catch (err: unknown) {
      const msg = (err as any)?.message || (err as any)?.error_description || JSON.stringify(err);
      setFormError(`Failed to save: ${msg}`);
    } finally {
      setIsSubmitting(false);
    }
  };


  const formatFileSize = (bytes: number | null) => {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const StatCard = ({ icon: Icon, label, value, subValue, color, trend }: {
    icon: React.ElementType;
    label: string;
    value: string | number;
    subValue?: string;
    color: string;
    trend?: boolean;
  }) => (
    <div className="bg-slate-900/50 backdrop-blur-sm border border-slate-800 p-5 rounded-2xl relative overflow-hidden group hover:border-primary-500/30 transition-all duration-300">
      <div className={`absolute top-0 right-0 w-32 h-32 bg-gradient-to-br ${color} opacity-5 -mr-16 -mt-16 rounded-full group-hover:scale-110 transition-transform duration-500`}></div>
      <div className="flex items-start justify-between relative z-10">
        <div>
          <p className="text-slate-400 text-sm font-medium mb-1">{label}</p>
          <h3 className="text-2xl font-bold text-white tracking-tight">{value}</h3>
          {subValue && (
            <div className="flex items-center mt-2 text-xs font-medium text-slate-500">
              {trend && <Activity className="w-3 h-3 mr-1 text-emerald-500" />}
              {subValue}
            </div>
          )}
        </div>
        <div className={`p-3 rounded-xl bg-slate-800/80 border border-slate-700/50 text-white group-hover:scale-110 transition-transform duration-300`}>
          <Icon className="w-6 h-6 opacity-80" />
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Institutional Document Viewer (Full Screen Shield) */}
      {showPreview && (
        <div className="fixed inset-0 z-[200] bg-slate-950/95 backdrop-blur-3xl animate-in fade-in duration-500 overflow-hidden flex flex-col">
            <div className="flex-1 overflow-hidden relative">
                <InstitutionalDocumentViewer 
                    url={showPreview} 
                    isOffice={showPreview.toLowerCase().match(/\.(docx|doc|pptx|ppt|xlsx|xls)$/) !== null} 
                />
            </div>
            
            {/* Control Bar Overlay */}
            <div className="absolute top-6 right-6 flex items-center gap-4 z-[210]">
                <button
                    onClick={() => setShowPreview(null)}
                    className="p-4 bg-white/10 hover:bg-rose-500 text-white rounded-2xl transition-all shadow-2xl backdrop-blur-md group active:scale-95"
                >
                    <X className="w-6 h-6 group-hover:rotate-90 transition-transform duration-300" />
                </button>
            </div>
        </div>
      )}

      {/* Success Message Notification */}
      {successMessage && (
        <div className="fixed top-4 right-4 z-[250] bg-white border-2 border-emerald-100 p-1 rounded-3xl shadow-2xl animate-in slide-in-from-top-12 duration-500 max-w-sm">
          <div className="flex items-center gap-4 bg-emerald-50/50 p-4 rounded-[2rem] border border-emerald-50">
            <div className="w-12 h-12 bg-primary-950 rounded-2xl flex items-center justify-center shadow-lg shadow-emerald-500/20">
                <Shield className="w-6 h-6 text-emerald-400" />
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-600 mb-0.5">Success Protocol</p>
              <p className="text-sm font-bold text-slate-900 leading-tight">{successMessage}</p>
            </div>
          </div>
        </div>
      )}

      {/* Past Questions Header */}
      <div className="relative group">
        <div className="absolute -inset-1 bg-gradient-to-r from-primary-950 to-primary-800 rounded-[2rem] blur opacity-25 group-hover:opacity-40 transition duration-1000 group-hover:duration-200"></div>
        <div className="relative bg-white border border-slate-100 rounded-[2rem] p-8 sm:p-10">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-8">
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-primary-950 rounded-xl text-primary-400 shadow-lg shadow-primary-950/20 ring-4 ring-primary-50">
                  <Archive className="w-7 h-7" />
                </div>
                <h1 className="text-3xl lg:text-4xl font-extrabold text-slate-900 tracking-tight">
                  Past Questions Manager
                  <span className="ml-3 text-[10px] bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-black uppercase align-middle">
                    Store: {storePastQuestions.length} | Filtered: {filteredPastQuestions.length}
                  </span>
                </h1>
              </div>
              <p className="text-slate-500 text-lg max-w-2xl leading-relaxed">
                Manage past examination questions and academic resources for students.
              </p>
            </div>
            
            <button
              onClick={openCreateModal}
              className="group relative inline-flex items-center justify-center px-8 py-4 font-bold text-white transition-all duration-300 bg-primary-950 font-pj rounded-2xl focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-950 shadow-xl shadow-primary-950/20 hover:scale-[1.02] active:scale-95"
            >
              <div className="absolute -inset-px bg-gradient-to-r from-primary-400 to-emerald-400 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
              <Plus className="relative mr-2 w-6 h-6 transition-transform group-hover:rotate-90 duration-500" />
              <span className="relative text-lg">Add to Mobile App</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-10">
            <StatCard 
              icon={Activity} 
              label="Total Records" 
              value={`${stats.totalRecords} Papers`}
              subValue="Global Archive"
              color="from-blue-500 to-indigo-600"
              trend={true}
            />
            <StatCard 
              icon={Shield} 
              label="Featured Content" 
              value={`${stats.featuredCount} Featured`}
              subValue="High Priority"
              color="from-emerald-500 to-teal-600"
            />
            <StatCard 
              icon={Database} 
              label="Storage Used" 
              value={formatFileSize(stats.storageUsage)}
              subValue="Total Payload"
              color="from-amber-500 to-orange-600"
            />
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-slate-900 rounded-[2rem] p-6 border border-slate-800 shadow-2xl relative overflow-hidden group">
        <div className="absolute top-0 right-0 w-64 h-64 bg-primary-500/5 blur-[100px] -mr-32 -mt-32"></div>
        <div className="relative z-10 flex flex-col lg:flex-row gap-6">
          <div className="flex-1 relative group/search">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500 group-focus-within/search:text-primary-400 transition-colors" />
            <input
              type="text"
              placeholder="Search by title, level, or course..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-12 pr-4 py-4 bg-slate-800/50 border border-slate-700 rounded-2xl focus:ring-2 focus:ring-primary-500 focus:border-transparent text-slate-100 placeholder-slate-500 font-medium transition-all"
            />
          </div>
          
          <div className="flex flex-wrap gap-4">
            <div className="relative">
              <label className="absolute -top-2.5 left-4 px-2 bg-slate-900 text-[10px] font-black text-slate-500 uppercase tracking-widest z-10">Level</label>
              <div className="relative">
                <Layers className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <select
                  value={levelFilter}
                  onChange={(e) => { setLevelFilter(e.target.value); setCourseFilter('all'); }}
                  disabled={!!assignedLevel}
                  className="pl-11 pr-10 py-4 bg-slate-800/50 border border-slate-700 rounded-2xl focus:ring-2 focus:ring-primary-500 appearance-none text-slate-200 font-bold text-sm min-w-[160px] cursor-pointer hover:bg-slate-800 transition-colors disabled:opacity-50"
                >
                  {!assignedLevel && <option value="all">All Levels</option>}
                  <option value="100">Level 100</option>
                  <option value="200">Level 200</option>
                  <option value="300">Level 300</option>
                  <option value="400">Level 400</option>
                </select>
                <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
              </div>
            </div>

            <div className="relative">
              <label className="absolute -top-2.5 left-4 px-2 bg-slate-900 text-[10px] font-black text-slate-500 uppercase tracking-widest z-10">Semester</label>
              <div className="relative">
                <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <select
                  value={semesterFilter}
                  onChange={(e) => setSemesterFilter(e.target.value)}
                  className="pl-11 pr-10 py-4 bg-slate-800/50 border border-slate-700 rounded-2xl focus:ring-2 focus:ring-primary-500 appearance-none text-slate-200 font-bold text-sm min-w-[160px] cursor-pointer hover:bg-slate-800 transition-colors"
                >
                  <option value="all">Full Cycle</option>
                  <option value="first">1st Semester</option>
                  <option value="second">2nd Semester</option>
                </select>
                <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
              </div>
            </div>

            <button
              onClick={() => {
                setLevelFilter('all');
                setSemesterFilter('all');
                setCourseFilter('all');
                setSearchQuery('');
              }}
              className="p-4 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-2xl text-slate-400 hover:text-white transition-all group/reset"
              title="Reset Filters"
            >
              <Workflow className="w-5 h-5 group-hover:rotate-180 transition-transform duration-500" />
            </button>
          </div>
        </div>
      </div>

      {/* Grid */}
      {/* Archive Vault Grid */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-24 text-slate-300">
          <Activity className="w-16 h-16 animate-spin mb-6 opacity-40 text-primary-500" />
          <span className="font-black text-xs uppercase tracking-[4px] animate-pulse">Syncing...</span>
        </div>
      ) : error ? (
        <ErrorState onRetry={() => syncAll()} message={error} />
      ) : paginatedPQ.length === 0 ? (

        <div className="bg-white border-2 border-dashed border-slate-200 rounded-[3rem] p-24 text-center group hover:border-primary-200 transition-colors">
          <div className="inline-flex items-center justify-center p-8 bg-slate-50 rounded-full mb-6 group-hover:scale-110 transition-transform duration-500">
            <Archive className="w-16 h-16 text-slate-300 group-hover:text-primary-300" />
          </div>
          <h3 className="text-3xl font-black text-slate-900 mb-3 tracking-tight">Records Empty</h3>
          <p className="text-slate-500 text-lg max-w-sm mx-auto font-medium">
            No records found matching your current filters.
          </p>
          <button
            onClick={openCreateModal}
            className="mt-10 inline-flex items-center px-8 py-4 bg-primary-950 text-white rounded-2xl font-bold hover:scale-105 transition-transform shadow-xl shadow-primary-950/20"
          >
            <Plus className="w-6 h-6 mr-2" />
            Add First Past Question
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8">
          {paginatedPQ.map((pq) => (

            <div
              key={pq.id}
              className={`group relative bg-white rounded-[2.5rem] border-2 ${pq.is_featured ? 'border-primary-500/20 bg-primary-50/5' : 'border-slate-100'} p-8 hover:border-primary-500/30 hover:shadow-2xl hover:shadow-slate-900/10 transition-all duration-500 flex flex-col justify-between overflow-hidden`}
            >
              {pq.is_featured && (
                <div className="absolute top-0 right-0 p-1.5 bg-primary-500 rounded-bl-2xl text-white shadow-lg">
                  <Star className="w-4 h-4 fill-current" />
                </div>
              )}
              
              <div className="space-y-6">
                <div className="flex items-start justify-between">
                  <div className={`p-4 rounded-2xl ${pq.is_featured ? 'bg-primary-950 text-primary-400' : 'bg-slate-900 text-slate-400'} group-hover:scale-110 transition-transform duration-500 shadow-xl shadow-slate-950/10`}>
                    <FileType className="w-6 h-6" />
                  </div>
                  
                  <div className="relative">
                    <button
                      onClick={() => setShowDropdown(showDropdown === pq.id ? null : pq.id)}
                      className="p-3 bg-slate-50 hover:bg-slate-100 text-slate-600 rounded-xl transition-all"
                    >
                      <MoreVertical className="w-5 h-5" />
                    </button>
                    
                    {showDropdown === pq.id && (
                      <div className="absolute right-0 mt-3 w-64 bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl py-3 z-30 animate-in fade-in zoom-in-95 duration-200">
                        <div className="px-5 py-2 border-b border-slate-800 mb-2">
                          <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Actions</p>
                        </div>
                        <button 
                          onClick={() => { openEditModal(pq); setShowDropdown(null); }}
                          className="w-full px-5 py-3 text-left text-sm font-bold text-slate-300 hover:text-white hover:bg-slate-800 flex items-center gap-3 transition-colors"
                        >
                          <Edit className="w-4 h-4 text-primary-400" /> Edit Past Question
                        </button>
                        <button 
                          onClick={() => { handleToggleFeatured(pq); setShowDropdown(null); }}
                          className="w-full px-5 py-3 text-left text-sm font-bold text-slate-300 hover:text-white hover:bg-slate-800 flex items-center gap-3 transition-colors"
                        >
                          <Star className={`w-4 h-4 ${pq.is_featured ? 'fill-primary-400 text-primary-400' : 'text-slate-500'}`} />
                          {pq.is_featured ? 'Release Feature' : 'Promote to Featured'}
                        </button>
                        <div className="h-px bg-slate-800 my-2 mx-5"></div>
                        <button 
                          onClick={() => { handleDelete(pq); setShowDropdown(null); }}
                          className="w-full px-5 py-3 text-left text-sm font-black text-rose-400 hover:text-rose-300 hover:bg-rose-950/30 flex items-center gap-3 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" /> Delete Past Question
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="px-3 py-1 bg-slate-900 text-white text-[10px] font-black uppercase tracking-widest rounded-lg">Level {pq.level}</span>
                    <span className="px-3 py-1 bg-primary-100 text-primary-900 text-[10px] font-black uppercase tracking-widest rounded-lg">{pq.semester === 'first' ? '1st Semester' : '2nd Semester'}</span>
                    <span className="flex items-center gap-1.5 px-3 py-1 bg-slate-100 text-slate-600 text-[10px] font-black uppercase tracking-widest rounded-lg">
                      <Database className="w-3 h-3" /> {formatFileSize(pq.file_size)}
                    </span>
                  </div>
                  
                  <h3 className="text-xl font-black text-slate-900 line-clamp-2 leading-tight tracking-tight min-h-[3.5rem] group-hover:text-primary-950 transition-colors">
                    {pq.title}
                  </h3>
                  
                  {pq.description && (
                    <p className="text-slate-500 text-sm font-medium line-clamp-2 leading-relaxed opacity-80 italic">
                      "{pq.description}"
                    </p>
                  )}
                </div>
              </div>

              <div className="mt-8 pt-8 border-t border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="relative">
                    <div className="w-10 h-10 bg-slate-900 rounded-xl flex items-center justify-center text-white font-black text-xs">
                      {pq.course?.code?.substring(0, 2) || 'GN'}
                    </div>
                    <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-primary-500 border-2 border-white rounded-full"></div>
                  </div>
                  <div>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Course Code</p>
                    <p className="text-sm font-black text-slate-900 uppercase">{pq.course?.code || 'General'}</p>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-1.5 text-xs font-black text-slate-400">
                    <Activity className="w-3.5 h-3.5 text-blue-500" />
                    <span>{pq.view_count || 0}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs font-black text-slate-400">
                    <Database className="w-3.5 h-3.5 text-emerald-500" />
                    <span>{pq.download_count || 0}</span>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                      {pq.file_url && (
                        <div className="flex gap-2">
                           <button
                            onClick={(e) => handlePreview(pq.file_url!, e)}
                            className="inline-flex items-center gap-3 px-6 py-3 bg-primary-950 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-black transition-all hover:scale-105 active:scale-95 shadow-xl shadow-primary-950/20"
                          >
                            <Eye className="w-4 h-4 text-emerald-400" />
                            View Stream
                          </button>

                          <a
                            href={pq.file_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-3 bg-slate-50 hover:bg-slate-100 text-slate-600 rounded-xl transition-all hover:scale-110 active:scale-95 shadow-sm border border-slate-100"
                            title="Open in New Tab"
                          >
                            <ExternalLink className="w-5 h-5" />
                          </a>
                        </div>
                      )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {/* Pagination Intelligence */}
      {totalPages > 1 && (
        <div className="flex flex-col sm:flex-row items-center justify-between bg-white rounded-[2rem] shadow-xl shadow-slate-900/5 border border-slate-100 p-8 mt-12 gap-6">
          <p className="text-sm font-bold text-slate-400 uppercase tracking-widest">
            Showing: <span className="text-slate-900">{((currentPage - 1) * ITEMS_PER_PAGE) + 1} - {Math.min(currentPage * ITEMS_PER_PAGE, totalCount)}</span> of <span className="text-slate-900 tracking-normal">{totalCount}</span> Records
          </p>
          <div className="flex items-center gap-4">
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="p-4 bg-slate-50 rounded-2xl disabled:opacity-20 hover:bg-slate-100 text-slate-700 transition-all border border-slate-100 shadow-sm"
            >
              <ChevronLeft className="w-6 h-6" />
            </button>
            <div className="px-6 py-4 bg-slate-900 rounded-2xl text-sm font-black text-white shadow-lg shadow-slate-950/20">
              Page {currentPage} / {totalPages}
            </div>
            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="p-4 bg-slate-50 rounded-2xl disabled:opacity-20 hover:bg-slate-100 text-slate-700 transition-all border border-slate-100 shadow-sm"
            >
              <ChevronRight className="w-6 h-6" />
            </button>
          </div>
        </div>
      )}
      {/* Asset Ingestion Modal */}
      {showModal && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-xl animate-in fade-in duration-500" onClick={() => setShowModal(null)}></div>
          
          <div className="relative w-full max-w-4xl bg-white rounded-[3rem] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300">
            <div className="absolute top-0 right-0 w-96 h-96 bg-primary-500/5 blur-[120px] -mr-48 -mt-48 pointer-events-none"></div>
            
            <form onSubmit={handleSubmit} className="relative z-10">
              <div className="bg-slate-900 p-8 flex items-center justify-between border-b border-slate-800">
                <div className="space-y-1">
                  <h2 className="text-3xl font-black text-white tracking-tight">
                    {showModal === 'edit' ? 'Edit Past Question' : 'Add to Mobile App'}
                  </h2>
                  <p className="text-slate-400 font-bold uppercase text-xs tracking-widest">Past Question Information</p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowModal(null)}
                  className="p-3 bg-white/10 hover:bg-white/20 text-white rounded-2xl transition-all"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="p-8 lg:p-10 max-h-[75vh] overflow-y-auto custom-scrollbar">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
                  <div className="space-y-8">
                    <div className="space-y-3 relative group">
                      <label className="flex items-center gap-2 text-sm font-black text-slate-800 uppercase tracking-widest">
                        <FileSearch className="w-4 h-4 text-primary-600" />
                        Past Question Title <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        value={formData.title}
                        onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                        placeholder="e.g. 2023 First Semester Exam - GSP 101"
                        className="w-full px-6 py-4 bg-slate-50 border-2 border-slate-100 rounded-2xl focus:border-primary-500 focus:bg-white transition-all text-slate-900 font-bold placeholder:text-slate-400 placeholder:font-medium"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-6">
                      <div className="space-y-3">
                        <label className="flex items-center gap-2 text-sm font-black text-slate-800 uppercase tracking-widest">
                          <Layers className="w-4 h-4 text-primary-600" />
                          Level
                        </label>
                        <select
                          value={formData.level}
                          onChange={(e) => setFormData({ ...formData, level: e.target.value })}
                          disabled={!!assignedLevel}
                          className="w-full px-6 py-4 bg-slate-50 border-2 border-slate-100 rounded-2xl focus:border-primary-500 font-bold text-slate-800 appearance-none disabled:opacity-50"
                        >
                          {!assignedLevel && <option value="">Select Level</option>}
                          <option value="100">Level 100</option>
                          <option value="200">Level 200</option>
                          <option value="300">Level 300</option>
                          <option value="400">Level 400</option>
                        </select>
                      </div>

                      <div className="space-y-3">
                        <label className="flex items-center gap-2 text-sm font-black text-slate-800 uppercase tracking-widest">
                          <Calendar className="w-4 h-4 text-primary-600" />
                          Semester
                        </label>
                        <select
                          value={formData.semester}
                          onChange={(e) => setFormData({ ...formData, semester: e.target.value })}
                          className="w-full px-6 py-4 bg-slate-50 border-2 border-slate-100 rounded-2xl focus:border-primary-500 font-bold text-slate-800 appearance-none"
                        >
                          <option value="">Select Semester</option>
                          <option value="first">1st Semester</option>
                          <option value="second">2nd Semester</option>
                        </select>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <label className="flex items-center gap-2 text-sm font-black text-slate-800 uppercase tracking-widest">
                        <BookOpen className="w-4 h-4 text-primary-600" />
                        Course
                      </label>
                      <select
                        value={formData.course_id}
                        onChange={(e) => setFormData({ ...formData, course_id: e.target.value })}
                        className="w-full px-6 py-4 bg-slate-50 border-2 border-slate-100 rounded-2xl focus:border-primary-500 font-bold text-slate-800 appearance-none"
                      >
                        <option value="">General (No Course)</option>
                        {storeCourses
                          .filter(c => (formData.level ? c.level === formData.level : true) && (formData.semester ? c.semester === formData.semester : true))
                          .map((course) => (
                            <option key={course.id} value={course.id}>
                              {course.code} - {course.title}
                            </option>
                          ))}

                      </select>
                    </div>

                    <div className="space-y-3">
                      <label className="flex items-center gap-2 text-sm font-black text-slate-800 uppercase tracking-widest">
                        <Info className="w-4 h-4 text-primary-600" />
                        Description
                      </label>
                        <textarea
                        value={formData.description}
                        onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                        placeholder="Optional description about this past question."
                        className="w-full px-6 py-4 bg-slate-50 border-2 border-slate-100 rounded-2xl focus:border-primary-500 min-h-[120px] font-medium text-slate-700 resize-none"
                      />
                    </div>
                  </div>

                  <div className="space-y-8">
                    <div className="space-y-4">
                      <label className="flex items-center gap-2 text-sm font-black text-slate-800 uppercase tracking-widest">
                        <Database className="w-4 h-4 text-primary-600" />
                        File Upload
                      </label>
                      <div className="bg-slate-50 border-2 border-slate-100 rounded-[2rem] p-6">
                        <FileUpload 
                          accept=".pdf,.png,.jpg,.jpeg" 
                          folder="past-questions" 
                          multiple={true}
                          onUploadComplete={(url, file) => {
                            setFormData({ 
                              ...formData, 
                              file_url: url, 
                              file_size: file.size,
                              file_name: file.name,
                              file_mime_type: file.type,
                              files: [{ url, name: file.name, size: file.size, type: file.type }]
                            });
                          }}
                          onMultiUploadComplete={(results) => {
                            const first = results[0];
                            const newFiles = results.map(r => ({ url: r.url, name: r.originalFilename || r.file.name, size: r.file.size, type: r.file.type }));
                            // Append if files exist, else create new
                            const existingFiles = Array.isArray(formData.files) ? formData.files : [];
                            const combinedFiles = [...existingFiles, ...newFiles];
                            
                            setFormData({
                              ...formData,
                              file_url: combinedFiles[0]?.url || first.url,
                              file_size: combinedFiles[0]?.size || first.file.size,
                              file_name: combinedFiles[0]?.name || first.originalFilename || first.file.name,
                              file_mime_type: combinedFiles[0]?.type || first.file.type,
                              files: combinedFiles
                            });
                          }}
                          currentFileUrl={formData.file_url} 
                          label="Select Past Question Files" 
                          description="Supported formats: PDF, PNG, JPG (Max 100MB per file)"
                          currentBatchUrls={formData.files}
                          onRemoveBatchItem={(idx) => {
                              const updatedFiles = formData.files.filter((_, i) => i !== idx);
                              setFormData({
                                ...formData,
                                files: updatedFiles,
                                file_url: updatedFiles[0]?.url || '',
                              });
                          }}
                        />
                      </div>
                    </div>

                    <div className="bg-primary-50/50 rounded-[2rem] p-8 border border-primary-100 space-y-6">
                      <h4 className="text-primary-900 font-black text-xs uppercase tracking-[0.2em]">Settings</h4>
                      
                      <div className="space-y-4">
                        <label className="flex items-center justify-between cursor-pointer group">
                          <div className="flex items-center gap-3">
                            <div className="p-2 bg-white rounded-lg group-hover:scale-110 transition-transform">
                              <Shield className="w-4 h-4 text-primary-600" />
                            </div>
                            <div>
                               <span className="block font-bold text-slate-900">Featured</span>
                              <span className="text-[10px] text-slate-500 font-bold uppercase tracking-tight">Pinned to resource top</span>
                            </div>
                          </div>
                          <input
                            type="checkbox"
                            checked={formData.is_featured}
                            onChange={(e) => setFormData({ ...formData, is_featured: e.target.checked })}
                            className="w-6 h-6 rounded-lg text-primary-600 border-slate-200 focus:ring-primary-500 focus:ring-offset-0 transition-all cursor-pointer"
                          />
                        </label>

                        <label className="flex items-center justify-between cursor-pointer group">
                          <div className="flex items-center gap-3">
                            <div className="p-2 bg-white rounded-lg group-hover:scale-110 transition-transform">
                              <Globe className="w-4 h-4 text-green-600" />
                            </div>
                            <div>
                              <span className="block font-bold text-slate-900">Public Access</span>
                              <span className="text-[10px] text-green-600 font-bold uppercase tracking-tight">Always visible to all students</span>
                            </div>
                          </div>
                          <div className="w-6 h-6 rounded-lg bg-green-100 flex items-center justify-center">
                            <Globe className="w-4 h-4 text-green-600" />
                          </div>
                        </label>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-8 bg-slate-50 border-t border-slate-100 flex flex-col gap-4">
                {formError && (
                  <div className="flex items-center gap-3 px-4 py-3 bg-red-50 border border-red-100 rounded-2xl">
                    <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
                    <p className="text-sm font-medium text-red-700">{formError}</p>
                  </div>
                )}
                <div className="flex flex-col sm:flex-row items-center justify-between gap-6">
                <div className="flex items-center gap-3 text-slate-500">
                  <AlertCircle className="w-5 h-5 text-amber-500" />
                  <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 italic">Final verification recommended before saving.</span>
                </div>
                <div className="flex items-center gap-4 w-full sm:w-auto">
                  <button
                    type="button"
                    onClick={() => {
                      if (showModal === 'create') clearDraft();
                      else setShowModal(null);
                    }}
                    className="flex-1 sm:flex-none px-8 py-4 bg-white border-2 border-slate-200 text-slate-600 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-50 transition-all"
                  >
                    {showModal === 'create' ? 'Discard Draft' : 'Cancel'}
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting || !formData.file_url}
                    className="flex-1 sm:flex-none relative group overflow-hidden px-10 py-4 bg-primary-950 text-white rounded-2xl font-black transition-all shadow-xl shadow-primary-950/20 disabled:opacity-50 disabled:cursor-not-allowed hover:scale-105 active:scale-95"
                  >
                    <span className="relative z-10 flex items-center gap-2">
                      {isSubmitting ? (
                        <>
                          <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                          Processing...
                        </>
                      ) : showModal === 'edit' ? (
                        <>
                          <Edit className="w-5 h-5" />
                          Update Past Question
                        </>
                      ) : (
                        <>
                          <Plus className="w-5 h-5" />
                          Add to Mobile App
                        </>
                      )}
                    </span>
                  </button>
                </div>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

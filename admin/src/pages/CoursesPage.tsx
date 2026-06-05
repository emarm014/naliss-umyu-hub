import { useState, useMemo, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/auth.store';
import { useAdminDataStore } from '../store/adminData.store';
import type { Course, AcademicLevel, Semester } from '../types';
import { LEVEL_LABELS, SEMESTER_LABELS } from '../types';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import ErrorState from '../components/ui/ErrorState';
import {
  Plus,
  Search,
  Edit,
  Trash2,
  BookOpen,
  X,
  ChevronLeft,
  ChevronRight,
  Filter,
  GraduationCap,
  Users,
  Layout,
  Clock,
  CheckCircle2,
  AlertCircle,
  FileText
} from 'lucide-react';

interface CourseWithDetails extends Course {
  lecturer?: { full_name: string; title: string | null } | null;
}

interface CurriculumStats {
  total: number;
  active: number;
  totalCredits: number;
  assignedLecturers: number;
}

const ITEMS_PER_PAGE = 20;

export default function CoursesPage() {
  const { 
    courses: storeCourses, 
    lecturers: storeLecturers,
    departments: storeDepartments,
    isSyncing, 
    syncAll,
    removeCourse,
    error: syncError,
    refreshAnalytics
  } = useAdminDataStore();

  useEffect(() => {
    syncAll();
  }, [syncAll]);

  const [searchQuery, setSearchQuery] = useState('');
  const { profile, permissions } = useAuthStore();
  const assignedLevel = profile?.role === 'moderator' ? permissions?.assigned_level : null;
  
  // State initialization: Default to assigned level if moderator, else 'all'
  // State initialization: Default to assigned level if moderator, else 'all'
  const [levelFilter, setLevelFilter] = useState<AcademicLevel | 'all'>(assignedLevel || 'all');
  const [semesterFilter, setSemesterFilter] = useState<Semester | 'all'>('all');
  const [lecturerFilter, setLecturerFilter] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [showModal, setShowModal] = useState<'create' | 'edit' | null>(null);
  const [selectedCourse, setSelectedCourse] = useState<CourseWithDetails | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    code: '',
    title: '',
    description: '',
    level: '' as any,
    semester: '' as any,
    credit_units: 2,
    is_core: true,
    lecturer_id: '',
    is_active: true,
  });


  // Derived Filtering and Pagination
  const filteredCourses = useMemo(() => {
    return storeCourses.filter(course => {
      const matchesLevel = levelFilter === 'all' ? true : course.level === levelFilter;
      const matchesSemester = semesterFilter === 'all' || course.semester === semesterFilter;
      const matchesLecturer = lecturerFilter === 'all' || course.lecturer_id === lecturerFilter;
      const matchesSearch = !searchQuery || 
        course.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        course.code.toLowerCase().includes(searchQuery.toLowerCase());
      
      return matchesLevel && matchesSemester && matchesLecturer && matchesSearch;
    });
  }, [storeCourses, levelFilter, semesterFilter, lecturerFilter, searchQuery]);

  const stats = useMemo<CurriculumStats>(() => {
    return {
      total: storeCourses.length,
      active: storeCourses.filter(c => c.is_active).length,
      totalCredits: storeCourses.filter(c => c.is_active).reduce((sum, c) => sum + (c.credit_units || 0), 0),
      assignedLecturers: new Set(storeCourses.filter(c => c.lecturer_id).map(c => c.lecturer_id)).size
    };
  }, [storeCourses]);

  const totalCount = filteredCourses.length;
  const totalPages = Math.ceil(totalCount / ITEMS_PER_PAGE);

  const paginatedCourses = useMemo(() => {
    const from = (currentPage - 1) * ITEMS_PER_PAGE;
    const to = from + ITEMS_PER_PAGE;
    return filteredCourses.slice(from, to);
  }, [filteredCourses, currentPage]);


  const handleDelete = async (course: CourseWithDetails) => {
    if (!window.confirm(`Are you sure you want to delete "${course.code}: ${course.title}"? This action cannot be undone.`)) {
      return;
    }

    removeCourse(course.id);
    setSuccessMessage('Course deleted successfully');
    setTimeout(() => setSuccessMessage(null), 5000);

    try {
      const { error } = await supabase.from('courses').delete().eq('id', course.id);
      if (error) {
        syncAll(true);
        setSuccessMessage(null);
      }
    } catch {
      syncAll(true);
    }
  };

  const openCreateModal = () => {
    setFormData({
      code: '',
      title: '',
      description: '',
      level: assignedLevel || '' as any,
      semester: '' as any,
      credit_units: 2,
      is_core: true,
      lecturer_id: '',
      is_active: true,
    });
    setShowModal('create');
  };

  const openEditModal = (course: CourseWithDetails) => {
    setSelectedCourse(course);
    setFormData({
      code: course.code,
      title: course.title,
      description: course.description || '',
      level: course.level,
      semester: course.semester,
      credit_units: course.credit_units,
      is_core: course.is_core,
      lecturer_id: course.lecturer_id || '',
      is_active: course.is_active,
    });
    setShowModal('edit');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Manual validation — browser native validation is blocked by overflow-hidden containers
    if (!formData.code.trim()) { setFormError('Course code is required.'); return; }
    if (!formData.title.trim()) { setFormError('Course title is required.'); return; }
    if (!formData.level) { setFormError('Please select an Academic Level.'); return; }
    if (!formData.semester) { setFormError('Please select a Semester.'); return; }

    setFormError(null);
    setIsSubmitting(true);

    try {
      // Get next display_order (small sequential int, not Date.now() which overflows int4)
      const { data: maxOrderData } = await supabase
        .from('courses')
        .select('display_order')
        .order('display_order', { ascending: false })
        .limit(1)
        .single();
      const nextOrder = ((maxOrderData?.display_order ?? 0) as number) + 1;

      const courseData = {
        code: formData.code.toUpperCase(),
        title: formData.title,
        description: formData.description || null,
        level: formData.level,
        semester: formData.semester,
        credit_units: formData.credit_units,
        is_core: formData.is_core,
        lecturer_id: formData.lecturer_id || null,
        department_id: storeDepartments[0]?.id || 'b8345bc1-1f80-4f9b-9262-c608dbd92de0', // LIS Department
        is_active: formData.is_active,
        display_order: showModal === 'create' ? nextOrder : selectedCourse?.display_order,
      };

      if (showModal === 'create') {
        const { data: inserted, error } = await supabase.from('courses').insert(courseData).select('*, lecturer:lecturers!courses_lecturer_id_fkey(id, full_name, title)').single();
        if (error) throw error;
        if (inserted) useAdminDataStore.getState().addCourse(inserted as any);
      } else if (showModal === 'edit' && selectedCourse) {
        const { data: updated, error } = await supabase.from('courses').update(courseData).eq('id', selectedCourse.id).select('*, lecturer:lecturers!courses_lecturer_id_fkey(id, full_name, title)').single();
        if (error) throw error;
        if (updated) useAdminDataStore.getState().updateCourse(updated as any);
      }

      setSuccessMessage(`Course ${showModal === 'create' ? 'added' : 'updated'} successfully!`);
      setShowModal(null);
      refreshAnalytics();
      setTimeout(() => setSuccessMessage(null), 5000);
    } catch (err: unknown) {
      setFormError((err as any)?.message || 'Failed to save course. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleActive = async (course: CourseWithDetails) => {
    try {
      const { error } = await supabase
        .from('courses')
        .update({ is_active: !course.is_active })
        .eq('id', course.id);

      if (error) throw error;
      setSuccessMessage(`Course is now ${!course.is_active ? 'active' : 'inactive'}`);
      refreshAnalytics();
      setTimeout(() => setSuccessMessage(null), 5000);
    } catch (err: unknown) {
      setFormError('Failed to update: ' + ((err as any)?.message || 'Unknown error'));
    }
  };

  return (
    <div className="space-y-6">
      {/* Global Progress Feedback */}
      {successMessage && (
        <div className="fixed bottom-12 right-12 z-[100] bg-primary-950 border border-primary-800 text-white px-8 py-5 rounded-[2rem] shadow-2xl flex items-center gap-6 animate-in slide-in-from-bottom-12 duration-500">
          <div className="w-12 h-12 bg-primary-800 rounded-full flex items-center justify-center flex-shrink-0 border border-primary-700 shadow-inner">
            <BookOpen className="w-6 h-6 text-primary-400" />
          </div>
          <div>
            <p className="text-[10px] font-black tracking-[0.25em] text-primary-400 italic">SUCCESS</p>
            <p className="text-sm font-bold tracking-tight">{successMessage}</p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Course Manager</h1>
          <p className="text-slate-500 mt-1 font-medium flex items-center gap-2">
            <Layout className="w-4 h-4 text-primary-600" />
            Manage courses and syllabi for each level.
          </p>
        </div>
        <button
          onClick={openCreateModal}
          className="inline-flex items-center px-6 py-3 bg-primary-950 text-white rounded-xl font-bold hover:bg-primary-900 transition-all shadow-lg shadow-primary-900/20 active:scale-95 group"
        >
          <Plus className="w-5 h-5 mr-2 group-hover:rotate-90 transition-transform" />
          Add to Mobile App
        </button>
      </div>

      {/* Statistics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 flex items-center gap-4 group hover:border-primary-200 transition-colors">
          <div className="w-12 h-12 bg-primary-50 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform">
            <BookOpen className="w-6 h-6 text-primary-600" />
          </div>
          <div>
            <p className="text-sm font-bold text-slate-500 uppercase tracking-wider">Active Courses</p>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-black text-slate-900">{stats.active}</span>
              <span className="text-xs font-bold text-slate-400">Courses</span>
            </div>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 flex items-center gap-4 group hover:border-primary-200 transition-colors">
          <div className="w-12 h-12 bg-emerald-50 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform">
            <Users className="w-6 h-6 text-emerald-600" />
          </div>
          <div>
            <p className="text-sm font-bold text-slate-500 uppercase tracking-wider">Lecturers</p>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-black text-slate-900">{stats.assignedLecturers}</span>
              <span className="text-xs font-bold text-slate-400">Lecturers</span>
            </div>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 flex items-center gap-4 group hover:border-primary-200 transition-colors">
          <div className="w-12 h-12 bg-blue-50 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform">
            <Clock className="w-6 h-6 text-blue-600" />
          </div>
          <div>
            <p className="text-sm font-bold text-slate-500 uppercase tracking-wider">Total Units</p>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-black text-slate-900">{stats.totalCredits}</span>
              <span className="text-xs font-bold text-slate-400">Units</span>
            </div>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 flex items-center gap-4 group hover:border-primary-200 transition-colors">
          <div className="w-12 h-12 bg-amber-50 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform">
            <GraduationCap className="w-6 h-6 text-amber-600" />
          </div>
          <div>
            <p className="text-sm font-bold text-slate-500 uppercase tracking-wider">Total Courses</p>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-black text-slate-900">{stats.total}</span>
              <span className="text-xs font-bold text-slate-400">Total</span>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100">
        <div className="flex flex-col lg:flex-row gap-4">
          <div className="flex-1 relative group">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 group-focus-within:text-primary-600 transition-colors" />
            <input
              type="text"
              placeholder="Search by code or title..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-12 pr-4 py-3 bg-slate-50 border border-slate-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-900/10 focus:border-primary-900 transition-all font-medium"
            />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 lg:w-[600px]">
            <div className="relative">
              <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <select
                value={levelFilter}
                onChange={(e) => setLevelFilter(e.target.value as AcademicLevel | 'all')}
                className="w-full pl-9 pr-3 py-3 bg-slate-50 border border-slate-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-900/10 focus:border-primary-900 appearance-none font-bold text-sm text-slate-700 transition-all font-black"
              >
                <option value="all">View All (Global)</option>
                {Object.entries(LEVEL_LABELS).map(([value]) => (
                  <option key={value} value={value}>L{value} {assignedLevel === value ? '(My Assigned)' : ''}</option>
                ))}
              </select>
            </div>
            <div className="relative">
              <Clock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <select
                value={semesterFilter}
                onChange={(e) => setSemesterFilter(e.target.value as Semester | 'all')}
                className="w-full pl-9 pr-3 py-3 bg-slate-50 border border-slate-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-900/10 focus:border-primary-900 appearance-none font-bold text-sm text-slate-700 transition-all"
              >
                <option value="all">Semesters</option>
                <option value="first">1st Sem</option>
                <option value="second">2nd Sem</option>
              </select>
            </div>
      <div className="col-span-2 relative">
              <Users className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <select
                value={lecturerFilter}
                onChange={(e) => setLecturerFilter(e.target.value)}
                className="w-full pl-9 pr-3 py-3 bg-slate-50 border border-slate-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-900/10 focus:border-primary-900 appearance-none font-bold text-sm text-slate-700 transition-all"
              >
                <option value="all">All Lecturers</option>
                {storeLecturers.map(l => (
                  <option key={l.id} value={l.id}>{l.title} {l.full_name}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Courses List */}
      {isSyncing && storeCourses.length === 0 ? (
        <div className="flex justify-center py-12">
          <LoadingSpinner size="lg" />
        </div>
      ) : syncError ? (
        <ErrorState message={syncError} onRetry={() => syncAll(true)} />
      ) : paginatedCourses.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm p-12 text-center text-gray-500">
          <BookOpen className="w-16 h-16 mx-auto mb-4 opacity-20" />
          <p>No courses found matching your filters.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {paginatedCourses.map((course) => (
            <div
              key={course.id}
              className={`group bg-white rounded-2xl shadow-sm border p-5 transition-all hover:shadow-xl hover:-translate-y-1 ${course.is_active ? 'border-glass-200' : 'border-slate-200 grayscale opacity-60 bg-slate-50/50'
                }`}
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="px-3 py-1 bg-primary-100 text-primary-900 text-xs font-black rounded-lg uppercase tracking-tight">
                    {course.code}
                  </span>
                  <span className={`px-2.5 py-1 text-[10px] font-black uppercase tracking-widest rounded-lg ${course.is_core ? 'bg-amber-100 text-amber-900' : 'bg-slate-100 text-slate-800'
                    }`}>
                    {course.is_core ? 'Core' : 'Elective'}
                  </span>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => openEditModal(course)}
                    className="p-2 text-slate-400 hover:text-primary-900 hover:bg-primary-50 rounded-xl transition-colors"
                  >
                    <Edit className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(course)}
                    className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <h3 className="text-lg font-black text-slate-900 leading-tight mb-2 group-hover:text-primary-950 transition-colors line-clamp-2 min-h-[3.5rem]">
                {course.title}
              </h3>

              <div className="flex items-center gap-3 mb-4 p-2 bg-slate-50 rounded-xl border border-slate-100/50">
                <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center border border-slate-200">
                  <GraduationCap className="w-4 h-4 text-slate-400" />
                </div>
                <div className="flex flex-col">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Lecturer</span>
                  <span className="text-xs font-extrabold text-slate-700 truncate max-w-[150px]">
                    {course.lecturer ? `${course.lecturer.title || ''} ${course.lecturer.full_name}` : 'Unassigned'}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between pt-4 border-t border-slate-100">
                <div className="flex flex-col">
                  <div className="flex items-center gap-1.5 text-[10px] font-black text-slate-500 uppercase tracking-wider">
                    <span>L{course.level}</span>
                    <span className="w-1 h-1 rounded-full bg-slate-300" />
                    <span>{course.semester === 'first' ? '1st' : '2nd'} Sem</span>
                  </div>
                  <span className="text-[10px] font-bold text-primary-600/70">{course.credit_units} Units</span>
                </div>
                <button
                  onClick={() => handleToggleActive(course)}
                  className={`flex items-center gap-1.5 text-[10px] font-black px-3 py-1.5 rounded-full transition-all uppercase tracking-widest ${course.is_active
                    ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                    : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                    }`}
                >
                  {course.is_active ? (
                    <><CheckCircle2 className="w-3 h-3" /> Active</>
                  ) : (
                    <><AlertCircle className="w-3 h-3" /> Hidden</>
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between bg-white rounded-2xl shadow-sm border border-slate-100 p-5 mt-6">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">
            Showing {((currentPage - 1) * ITEMS_PER_PAGE) + 1} -{' '}
            {Math.min(currentPage * ITEMS_PER_PAGE, totalCount)} of {totalCount} Courses
          </p>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="p-3 rounded-xl border border-slate-200 disabled:opacity-30 hover:bg-primary-50 hover:border-primary-200 transition-all active:scale-90"
            >
              <ChevronLeft className="w-5 h-5 text-slate-600" />
            </button>
            <div className="flex items-center justify-center min-w-[100px] h-10 px-4 bg-slate-50 rounded-xl border border-slate-100 font-black text-sm text-slate-700">
              {currentPage} / {totalPages}
            </div>
            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="p-3 rounded-xl border border-slate-200 disabled:opacity-30 hover:bg-primary-50 hover:border-primary-200 transition-all active:scale-90"
            >
              <ChevronRight className="w-5 h-5 text-slate-600" />
            </button>
          </div>
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-300">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col scale-in duration-300 border border-white/20">
            {/* Modal Header */}
            <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-primary-950 rounded-xl flex items-center justify-center">
                  <Plus className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h2 className="text-xl font-black text-slate-900 uppercase tracking-tight">
                    {showModal === 'create' ? 'Add to Mobile App' : 'Edit Course'}
                  </h2>
                  <p className="text-xs font-bold text-slate-400 tracking-widest uppercase">Course Details</p>
                </div>
              </div>
              <button
                onClick={() => setShowModal(null)}
                className="p-2 hover:bg-slate-200 rounded-full transition-colors text-slate-400 hover:text-slate-900"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form id="course-form" onSubmit={handleSubmit} className="p-8 space-y-6 overflow-y-auto flex-1">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-xs font-black text-slate-500 uppercase tracking-widest mb-2">Course Code</label>                  <div className="relative">
                    <FileText className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                      type="text"
                      placeholder="e.g. LIS 101"
                      value={formData.code}
                      onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                      className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl focus:outline-none focus:ring-2 focus:ring-primary-950/10 focus:border-primary-950 font-bold transition-all placeholder:text-slate-300 uppercase"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-black text-slate-500 uppercase tracking-widest mb-2">Credit Units</label>
                  <div className="relative">
                    <Clock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                      type="number"
                      value={formData.credit_units}
                      onChange={(e) => setFormData({ ...formData, credit_units: Number(e.target.value) })}
                      className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl focus:outline-none focus:ring-2 focus:ring-primary-950/10 focus:border-primary-950 font-bold transition-all"
                      min="1"
                      max="6"
                      required
                    />
                  </div>
                </div>

                <div className="md:col-span-2">
                  <label className="block text-xs font-black text-slate-500 uppercase tracking-widest mb-2">Course Title</label>
                  <div className="relative">
                    <BookOpen className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Enter full course title..."
                      value={formData.title}
                      onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                      className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl focus:outline-none focus:ring-2 focus:ring-primary-950/10 focus:border-primary-950 font-bold transition-all placeholder:text-slate-300"
                    />
                  </div>
                </div>

                <div className="md:col-span-2">
                  <label className="block text-xs font-black text-slate-500 uppercase tracking-widest mb-2">Course Description</label>
                  <textarea
                    placeholder="Provide a brief description of the course content..."
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl focus:outline-none focus:ring-2 focus:ring-primary-950/10 focus:border-primary-950 font-medium transition-all h-28 resize-none text-sm leading-relaxed"
                  />
                </div>

                <div>
                  <label className="block text-xs font-black text-slate-500 uppercase tracking-widest mb-2">Academic Level</label>
                  <div className="relative">
                    <GraduationCap className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <select
                      value={formData.level}
                      onChange={(e) => setFormData({ ...formData, level: e.target.value as AcademicLevel })}
                      disabled={!!assignedLevel}
                      className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl focus:outline-none focus:ring-2 focus:ring-primary-950/10 focus:border-primary-950 appearance-none font-bold transition-all disabled:opacity-50"
                    >
                      {!assignedLevel && <option value="">Select Level</option>}
                      {Object.entries(LEVEL_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-black text-slate-500 uppercase tracking-widest mb-2">Semester</label>
                  <div className="relative">
                    <Clock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <select
                      value={formData.semester}
                      onChange={(e) => setFormData({ ...formData, semester: e.target.value as Semester })}
                      className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl focus:outline-none focus:ring-2 focus:ring-primary-950/10 focus:border-primary-950 appearance-none font-bold transition-all"
                    >
                      <option value="">Select Semester</option>
                      {Object.entries(SEMESTER_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="md:col-span-2">
                  <label className="block text-xs font-black text-slate-500 uppercase tracking-widest mb-2">Lecturer</label>
                  <div className="relative">
                    <Users className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <select
                      value={formData.lecturer_id}
                      onChange={(e) => setFormData({ ...formData, lecturer_id: e.target.value })}
                      className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl focus:outline-none focus:ring-2 focus:ring-primary-950/10 focus:border-primary-950 appearance-none font-bold transition-all"
                    >
                      <option value="">Select Lecturer (Optional)</option>
                      {storeLecturers.map(l => (
                        <option key={l.id} value={l.id}>{l.title} {l.full_name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="flex items-center gap-6 p-4 bg-slate-50 rounded-2xl border border-slate-100 md:col-span-2">
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      id="is_core"
                      checked={formData.is_core}
                      onChange={(e) => setFormData({ ...formData, is_core: e.target.checked })}
                      className="w-5 h-5 rounded-lg border-slate-300 text-primary-950 focus:ring-primary-950 transition-all cursor-pointer"
                    />
                    <label htmlFor="is_core" className="text-sm font-bold text-slate-700 cursor-pointer">Core Requirement</label>
                  </div>
                  <div className="w-px h-6 bg-slate-200" />
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      id="is_active"
                      checked={formData.is_active}
                      onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                      className="w-5 h-5 rounded-lg border-slate-300 text-primary-950 focus:ring-primary-950 transition-all cursor-pointer"
                    />
                    <label htmlFor="is_active" className="text-sm font-bold text-slate-700 cursor-pointer">Visible to Students</label>
                  </div>
                </div>
              </div>
            </form>

            {/* Sticky footer — always visible, never clipped */}
            <div className="flex flex-col gap-3 p-6 border-t border-slate-100 bg-white shrink-0">
              {formError && (
                <div className="flex items-center gap-3 px-4 py-3 bg-red-50 border border-red-100 rounded-xl">
                  <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
                  <p className="text-sm font-medium text-red-700">{formError}</p>
                </div>
              )}
              <div className="flex gap-4">
              <button
                type="button"
                onClick={() => setShowModal(null)}
                className="flex-1 py-4 border-2 border-slate-200 text-slate-700 rounded-2xl text-sm font-black uppercase tracking-widest hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                form="course-form"
                disabled={isSubmitting}
                className="flex-[2] py-4 bg-primary-950 text-white rounded-2xl text-sm font-black uppercase tracking-widest hover:bg-slate-900 disabled:opacity-50 transition-colors shadow-xl shadow-primary-900/20 flex items-center justify-center gap-2"
              >
                {isSubmitting ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                    Processing...
                  </>
                ) : showModal === 'create' ? (
                  <>
                    <Plus className="w-4 h-4" /> Add to Mobile App
                  </>
                ) : (
                  <>
                    <Edit className="w-4 h-4" /> Update Course
                  </>
                )}
              </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

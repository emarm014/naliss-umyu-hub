import React, { useState, useEffect, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useShallow } from 'zustand/react/shallow';
import { useAdminDataStore } from '../store/adminData.store';
import { useAuthStore } from '../store/auth.store';
import { 
  Plus, 
  Search, 
  MoreVertical, 
  Edit, 
  Trash2, 
  Eye, 
  FileText, 
  Video, 
  Link as LinkIcon,
  File, 
  BookOpen, 
  ClipboardList, 
  Star, 
  ChevronLeft, 
  ChevronRight, 
  ExternalLink, 
  UserCheck, 
  X, 
  Layers, 
  Calendar, 
  ShieldAlert 
} from 'lucide-react';
import FileUpload from '../lib/FileUpload';
import { deleteFromCloudinary } from '../lib/cloudinaryDelete';
import { sendPushNotification, getUserIdsForLevel } from '../lib/notifications';
import type { Material, Course } from '../types';
import InstitutionalDocumentViewer from '../components/InstitutionalDocumentViewer';

interface MaterialWithDetails extends Material {
  course?: Course;
  uploader?: { full_name: string };
}

const ITEMS_PER_PAGE = 12;

const materialTypeConfig = {
  note: { color: 'bg-blue-100 text-blue-700', label: 'Note', icon: BookOpen },
  assignment: { color: 'bg-purple-100 text-purple-700', label: 'Assignment', icon: ClipboardList },
  pdf: { color: 'bg-red-100 text-red-700', label: 'PDF Document', icon: FileText },
  word: { color: 'bg-indigo-100 text-indigo-700', label: 'Word Document', icon: File },
  ppt: { color: 'bg-orange-100 text-orange-700', label: 'PowerPoint', icon: Layers },
  video: { color: 'bg-rose-100 text-rose-700', label: 'Video Lecture', icon: Video },
  link: { color: 'bg-emerald-100 text-emerald-700', label: 'External Resource', icon: LinkIcon },
  document: { color: 'bg-slate-100 text-slate-700', label: 'Document', icon: File }
};

export default function MaterialsPage() {
  const { materials: allMaterials, courses, syncAll, removeMaterial, refreshAnalytics } = useAdminDataStore(
    useShallow((state) => ({
      materials: state.materials,
      courses: state.courses,
      syncAll: state.syncAll,
      removeMaterial: state.removeMaterial,
      refreshAnalytics: state.refreshAnalytics,
    }))
  );
  const { user, profile, permissions } = useAuthStore();
  const assignedLevel = (profile?.role === 'moderator' ? permissions?.assigned_level : null) ?? null;

  useEffect(() => {
    syncAll();
  }, [syncAll]);

  const [showModal, setShowModal] = useState<'create' | 'edit' | 'view' | null>(null);
  const [selectedMaterial, setSelectedMaterial] = useState<MaterialWithDetails | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [showDropdown, setShowDropdown] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [courseFilter, setCourseFilter] = useState('all');
  const [levelFilter, setLevelFilter] = useState(assignedLevel || 'all');
  const [semesterFilter, setSemesterFilter] = useState<'all' | 'first' | 'second'>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [showPreview, setShowPreview] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [predefinedAsset, setPredefinedAsset] = useState<any>(null);

  const [formData, setFormData] = useState({
    title: '',
    description: '',
    material_type: 'note' as Material['material_type'],
    course_id: '',
    file_url: '',
    file_name: '',
    file_size: 0,
    file_mime_type: null as string | null,
    files: [] as Array<{url: string, name: string, size: number, type?: string}>,
    level: assignedLevel || '',
    semester: '',
    is_public: true,
    is_downloadable: false,
    is_featured: false,
    is_active: true
  });

  // Ensure setTypeFilter is used or remove the unused state if filtering is not needed
  // Since the code uses typeFilter, we should keep it.

  const availableCourses = useMemo(() => {
    if (!formData.level || !formData.semester) return [];
    return courses.filter(c => c.level === formData.level && c.semester === formData.semester);
  }, [courses, formData.level, formData.semester]);

  const [filteredMaterials, setFilteredMaterials] = useState<MaterialWithDetails[]>([]);

  useEffect(() => {
    let result = [...allMaterials];

    if (assignedLevel) {
      result = result.filter(m => m.level === assignedLevel);
    }

    if (typeFilter !== 'all') {
      result = result.filter(m => m.material_type === typeFilter);
    }

    if (courseFilter !== 'all') {
      result = result.filter(m => m.course_id === courseFilter);
    }

    if (levelFilter !== 'all') {
      result = result.filter(m => m.level === levelFilter);
    }

    if (semesterFilter !== 'all') {
      result = result.filter(m => m.semester === semesterFilter);
    }

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(m => 
        m.title?.toLowerCase().includes(q) ||
        m.course?.code?.toLowerCase().includes(q) ||
        m.description?.toLowerCase().includes(q)
      );
    }

    setFilteredMaterials(result as MaterialWithDetails[]);
    setCurrentPage(1);
  }, [allMaterials, typeFilter, courseFilter, levelFilter, semesterFilter, searchQuery, assignedLevel]);

  const totalCount = filteredMaterials.length;
  const totalPages = Math.ceil(totalCount / ITEMS_PER_PAGE);

  const paginatedMaterials = useMemo(() => {
    const from = (currentPage - 1) * ITEMS_PER_PAGE;
    const to = from + ITEMS_PER_PAGE;
    return filteredMaterials.slice(from, to);
  }, [filteredMaterials, currentPage]);

  const handleToggleFeatured = async (material: MaterialWithDetails) => {
    const newVal = !material.is_featured;
    useAdminDataStore.getState().updateMaterial({ ...material, is_featured: newVal } as any);
    try {
      const { error } = await supabase.from('materials').update({ is_featured: newVal }).eq('id', material.id);
      if (error) throw error;
    } catch (err: unknown) {
      useAdminDataStore.getState().updateMaterial(material as any); // revert
      setFormError('Failed to update: ' + ((err as any)?.message || 'Unknown error'));
    }
  };

  const handleToggleActive = async (material: MaterialWithDetails) => {
    const newVal = !material.is_active;
    useAdminDataStore.getState().updateMaterial({ ...material, is_active: newVal } as any);
    try {
      const { error } = await supabase.from('materials').update({ is_active: newVal }).eq('id', material.id);
      if (error) throw error;
    } catch (err: unknown) {
      useAdminDataStore.getState().updateMaterial(material as any); // revert
      setFormError('Failed to update: ' + ((err as any)?.message || 'Unknown error'));
    }
  };

  const handleDelete = async (material: MaterialWithDetails) => {
    if (!window.confirm(`Are you sure you want to delete "${material.title}"?`)) return;

    // Optimistic: remove instantly from UI
    removeMaterial(material.id);
    setSuccessMessage('Material removed successfully');
    setTimeout(() => setSuccessMessage(null), 5000);

    try {
      const { error } = await supabase.from('materials').delete().eq('id', material.id);
      if (error) {
        useAdminDataStore.getState().addMaterial(material as any);
        setSuccessMessage(null);
        setFormError('Failed to delete: ' + error.message);
      } else {
        // Fire-and-forget: clean up Cloudinary storage
        deleteFromCloudinary([material.file_url]);
      }
    } catch (err: any) {
      useAdminDataStore.getState().addMaterial(material as any);
      setSuccessMessage(null);
      setFormError('Failed to delete: ' + err.message);
    }
  };

  const openCreateModal = () => {
    setFormData({
      title: '',
      description: '',
      material_type: 'note',
      course_id: '',
      file_url: '',
      file_name: '',
      file_size: 0,
      file_mime_type: null,
      files: [],
      level: assignedLevel || '',
      semester: '',
      is_public: true,
      is_downloadable: false,
      is_featured: false,
      is_active: true
    });
    setShowModal('create');
    setPredefinedAsset(null);
  };

  const location = useLocation();

  // Detect and consume assets shared from the Cloud Archive (vault push)
  useEffect(() => {
    const asset = (location.state as any)?.predefinedAsset;
    if (asset && !showModal) {
      // Detect material type from file extension
      const url = (asset.url || '').toLowerCase();
      let detectedType: Material['material_type'] = 'note';
      if (url.endsWith('.pdf')) detectedType = 'pdf';
      else if (url.match(/\.(doc|docx)$/)) detectedType = 'word';
      else if (url.match(/\.(ppt|pptx)$/)) detectedType = 'ppt';
      else if (url.match(/\.(mp4|mov|avi)$/)) detectedType = 'video';

      setPredefinedAsset(asset);
      setFormData(prev => ({
        ...prev,
        title: asset.title || prev.title,
        file_url: asset.url || prev.file_url,
        file_size: asset.size || 0,
        material_type: detectedType,
      }));
      setShowModal('create');
      window.history.replaceState({}, document.title);
    }
  }, [location, showModal]); // eslint-disable-line react-hooks/exhaustive-deps

  const openEditModal = (material: MaterialWithDetails) => {
    setSelectedMaterial(material);
    setFormData({
      title: material.title,
      description: material.description || '',
      material_type: material.material_type,
      course_id: material.course_id || '',
      file_url: material.file_url || '',
      file_name: material.file_name || '',
      file_size: material.file_size || 0,
      file_mime_type: (material as any).file_mime_type || null,
      files: (material as any).files || [],
      level: material.level || '',
      semester: material.semester || '',
      is_public: material.is_public,
      is_downloadable: material.is_downloadable,
      is_featured: material.is_featured,
      is_active: material.is_active
    });
    setShowModal('edit');
  };

  const handleView = (material: MaterialWithDetails) => {
    setSelectedMaterial(material);
    setShowModal('view');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    // Manual validation — browser native validation is blocked by overflow-hidden containers
    if (!formData.title.trim()) { setFormError('Title is required.'); return; }
    if (!formData.level) { setFormError('Please select an Academic Level.'); return; }
    if (!formData.semester) { setFormError('Please select a Semester.'); return; }
    if (!formData.course_id) { setFormError('Please select a Course.'); return; }
    if (!formData.file_url && formData.files.length === 0 && formData.material_type !== 'link') { setFormError('Please upload a file.'); return; }
    if (formData.material_type === 'link' && !formData.file_url) { setFormError('Please enter a resource URL.'); return; }

    setIsSubmitting(true);

    try {
      const materialData = {
        title: formData.title,
        description: formData.description,
        course_id: formData.course_id === 'general' ? null : formData.course_id,
        material_type: formData.material_type,
        file_url: formData.file_url,
        file_name: formData.file_name || null,
        file_size: formData.file_size,
        file_mime_type: formData.file_mime_type || null,
        files: formData.files,
        level: formData.level,
        semester: formData.semester,
        is_public: true,        // Always public — students must always be able to access materials
        is_downloadable: formData.is_downloadable,
        is_featured: formData.is_featured,
        is_active: formData.is_active,
        uploaded_by: user?.id
      };

      if (showModal === 'create') {
        const { data: inserted, error } = await supabase.from('materials').insert(materialData).select('*, course:courses!materials_course_id_fkey(id, code, title, level, semester)').single();
        if (error) throw error;
        if (inserted) useAdminDataStore.getState().addMaterial(inserted as any);

        // Push notification to students of the target level — fire and forget
        const targetLevel = formData.level || null;
        getUserIdsForLevel(targetLevel).then(targetIds => {
          if (targetIds.length > 0) {
            sendPushNotification({
              targetUserIds: targetIds,
              title: '📚 New Study Material',
              body: `"${formData.title}" has been uploaded`,
              data: {
                type: 'material',
                id: inserted?.id || '',
                title: formData.title,
                description: formData.description,
                file_url: formData.file_url,
                file_name: formData.file_name,
                file_size: formData.file_size,
                file_mime_type: formData.file_mime_type,
                level: formData.level,
                semester: formData.semester,
                course_id: formData.course_id === 'general' ? null : formData.course_id,
                download_count: 0,
                created_at: inserted?.created_at || new Date().toISOString(),
              },
            });
          }
        });
      } else {
        const { data: updated, error } = await supabase
          .from('materials')
          .update(materialData)
          .eq('id', selectedMaterial?.id)
          .select('*, course:courses!materials_course_id_fkey(id, code, title, level, semester)')
          .single();
        if (error) throw error;
        if (updated) useAdminDataStore.getState().updateMaterial(updated as any);
      }

      setSuccessMessage(`Material ${showModal === 'create' ? 'created' : 'updated'} successfully`);
      setShowModal(null);
      refreshAnalytics();
      setTimeout(() => setSuccessMessage(null), 5000);
    } catch (err: unknown) {
      const msg = (err as any)?.message || (err as any)?.error_description || JSON.stringify(err);
      setFormError(`Failed to save material: ${msg}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatFileSize = (bytes: number | null) => {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
  };

  const handlePreview = (url: string, e: React.MouseEvent) => {
    e.preventDefault();
    setShowPreview(url);
  };

  const getTypeIcon = (type: Material['material_type']) => {
    const Icon = materialTypeConfig[type].icon;
    return <Icon className="w-5 h-5" />;
  };

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

      <div className="space-y-6">
      {/* Success Message Notification */}
        {successMessage && (
          <div className="fixed top-4 right-4 z-[100] bg-green-50 border border-green-200 text-green-800 px-6 py-4 rounded-xl shadow-lg flex items-center gap-3 animate-in fade-in slide-in-from-top-4 duration-300">
            <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center flex-shrink-0">
              <UserCheck className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="font-bold">Success!</p>
              <p className="text-sm opacity-90">{successMessage}</p>
            </div>
          </div>
        )}

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Study Materials</h1>
            <p className="text-sm text-gray-500 mt-1">Manage course materials, notes, and resources</p>
          </div>
          <button
            onClick={openCreateModal}
            className="inline-flex items-center px-6 py-3 bg-primary-950 text-white rounded-xl hover:bg-primary-900 transition-all shadow-lg hover:shadow-primary-950/20 font-bold text-lg group"
          >
            <Plus className="w-6 h-6 mr-2 group-hover:rotate-90 transition-transform" />
            Add to Mobile App
          </button>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-xl shadow-sm p-4">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search materials..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-950 focus:border-transparent"
                />
              </div>
            </div>
            <div className="flex gap-2">
                {(['all', 'note', 'document', 'video'] as const).map((t) => (
                    <button
                        key={t}
                        onClick={() => setTypeFilter(t)}
                        className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                            typeFilter === t 
                            ? 'bg-primary-950 text-white shadow-lg shadow-primary-950/20' 
                            : 'bg-slate-50 text-slate-400 hover:bg-slate-100'
                        }`}
                    >
                        {t}
                    </button>
                ))}
            </div>
            <div className="flex gap-3">
              <div className="relative group/filter min-w-[140px]">
                <Layers className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 group-focus-within/filter:text-primary-600 transition-colors" />
                <select
                  value={levelFilter}
                  onChange={(e) => {
                    setLevelFilter(e.target.value);
                    setCourseFilter('all');
                  }}
                  disabled={!!assignedLevel}
                  className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-950 appearance-none bg-white text-sm font-medium hover:border-gray-300 transition-colors disabled:opacity-50"
                >
                  {!assignedLevel && <option value="all">All Levels</option>}
                  <option value="100">Level 100</option>
                  <option value="200">Level 200</option>
                  <option value="300">Level 300</option>
                  <option value="400">Level 400</option>
                </select>
              </div>

              <div className="relative group/filter min-w-[140px]">
                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 group-focus-within/filter:text-primary-600 transition-colors" />
                <select
                  value={semesterFilter}
                  onChange={(e) => setSemesterFilter(e.target.value as 'all' | 'first' | 'second')}
                  className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-950 appearance-none bg-white text-sm font-medium hover:border-gray-300 transition-colors"
                >
                  <option value="all">All Semesters</option>
                  <option value="first">First Semester</option>
                  <option value="second">Second Semester</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Materials Grid */}
        {filteredMaterials.length === 0 ? (
          <div className="bg-white rounded-2xl border-2 border-dashed border-gray-200 p-20 text-center">
            <div className="w-20 h-20 bg-gray-50 rounded-3xl flex items-center justify-center mx-auto mb-6">
              <BookOpen className="w-10 h-10 text-gray-300" />
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-2">No matching materials</h3>
            <p className="text-gray-500">Try adjusting your search or filters to find what you're looking for.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {paginatedMaterials.map((material: MaterialWithDetails) => {
              const typeConf = materialTypeConfig[material.material_type as keyof typeof materialTypeConfig] || materialTypeConfig.note;
              return (
                <div 
                  key={material.id} 
                  className="bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 overflow-hidden group"
                >
                  <div className="p-6">
                    <div className="flex items-start justify-between">
                      <div className={`p-3 rounded-xl ${typeConf.color} shadow-sm group-hover:scale-110 transition-transform`}>
                        <typeConf.icon className="w-6 h-6" />
                      </div>
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button 
                          onClick={() => handleToggleFeatured(material)}
                          className={`p-2 rounded-lg transition-colors ${material.is_featured ? 'text-amber-500 bg-amber-50' : 'text-gray-400 hover:bg-gray-50'}`}
                        >
                          <Star className={`w-5 h-5 ${material.is_featured ? 'fill-current' : ''}`} />
                        </button>
                        <div className="relative">
                          <button 
                            onClick={() => setShowDropdown(showDropdown === material.id ? null : material.id)}
                            className="p-2 text-gray-400 hover:bg-gray-50 rounded-lg"
                          >
                            <MoreVertical className="w-5 h-5" />
                          </button>
                          
                          {showDropdown === material.id && (
                            <div className="absolute right-0 mt-2 w-48 bg-white rounded-xl shadow-2xl border border-gray-100 py-2 z-20 animate-in fade-in zoom-in-95 duration-200">
                              <button
                                onClick={() => { openEditModal(material); setShowDropdown(null); }}
                                className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-2"
                              >
                                <Edit className="w-4 h-4" /> Edit Material
                              </button>
                              <button
                                onClick={() => { handleToggleActive(material); setShowDropdown(null); }}
                                className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-2"
                              >
                                <FileText className="w-4 h-4" />
                                {material.is_active ? 'Deactivate' : 'Activate'}
                              </button>
                              <hr className="my-1 border-gray-100" />
                              <button
                                onClick={() => { handleDelete(material); setShowDropdown(null); }}
                                className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                              >
                                <Trash2 className="w-4 h-4" /> Delete
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    <h3 className="mt-4 font-bold text-gray-900 group-hover:text-primary-950 transition-colors line-clamp-1">{material.title}</h3>
                    <p className="mt-2 text-sm text-gray-500 line-clamp-2 leading-relaxed h-10">{material.description || 'No description provided'}</p>

                    <div className="mt-4 flex flex-wrap gap-2">
                       <span className={`px-2.5 py-1 text-[10px] font-black uppercase tracking-widest rounded-lg ${typeConf.color}`}>
                        {typeConf.label}
                      </span>
                      {material.course && (
                        <span className="px-2.5 py-1 text-[10px] font-black uppercase tracking-widest rounded-lg bg-slate-100 text-slate-600">
                          {material.course.code}
                        </span>
                      )}
                    </div>

                    <div className="mt-6 pt-4 border-t border-gray-50 flex items-center justify-between">
                      <div className="flex items-center gap-4 text-xs font-bold text-slate-400">
                        <span className="flex items-center gap-1.5">
                          <Eye className="w-4 h-4 text-emerald-400" />
                          {material.view_count} accesses
                        </span>
                        {material.file_size && material.file_size > 0 && (
                          <span className="flex items-center gap-1.5 grayscale opacity-50">
                            <File className="w-4 h-4" />
                            {formatFileSize(material.file_size)}
                          </span>
                        )}
                      </div>
                      
                      <div className="flex items-center gap-2">
                        {material.file_url && (
                          <button
                            onClick={(e) => handlePreview(material.file_url!, e)}
                            className="p-2.5 bg-primary-950 text-white rounded-xl shadow-lg shadow-primary-950/10 hover:scale-110 active:scale-95 transition-all group/btn"
                          >
                            <Eye className="w-5 h-5 text-emerald-400 group-hover/btn:text-white transition-colors" />
                          </button>
                        )}
                        <button
                          onClick={() => handleView(material)}
                          className="px-4 py-2 text-xs font-black uppercase tracking-widest text-slate-600 hover:text-primary-950 transition-colors"
                        >
                          View Details
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-white p-6 rounded-2xl shadow-sm border border-gray-50">
            <p className="text-sm font-bold text-slate-400 uppercase tracking-widest">
              Showing <span className="text-slate-900">{((currentPage - 1) * ITEMS_PER_PAGE) + 1} - {Math.min(currentPage * ITEMS_PER_PAGE, totalCount)}</span> of {totalCount} records
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="p-3 rounded-xl border-2 border-slate-50 disabled:opacity-30 disabled:cursor-not-allowed hover:border-primary-100 hover:text-primary-600 transition-all active:scale-90"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <div className="flex items-center gap-1">
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                  <button
                    key={p}
                    onClick={() => setCurrentPage(p)}
                    className={`w-10 h-10 rounded-xl text-sm font-black transition-all ${
                      currentPage === p 
                      ? 'bg-primary-950 text-white shadow-lg shadow-primary-950/20' 
                      : 'text-slate-400 hover:bg-slate-50'
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="p-3 rounded-xl border-2 border-slate-50 disabled:opacity-30 disabled:cursor-not-allowed hover:border-primary-100 hover:text-primary-600 transition-all active:scale-90"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
          </div>
        )}

        {/* Create/Edit Modal */}
        {showModal === 'create' || showModal === 'edit' ? (
          <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center z-[100] p-4 animate-in fade-in duration-300">
            <div className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-xl flex flex-col max-h-[90vh] overflow-hidden border border-white/10 animate-in zoom-in-95 duration-500">
              <div className="p-8 border-b border-slate-50 flex items-center justify-between bg-slate-50/50">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-primary-950 text-white rounded-2xl shadow-lg ring-4 ring-primary-50">
                    {showModal === 'create' ? <Plus className="w-6 h-6" /> : <Edit className="w-6 h-6" />}
                  </div>
                  <div>
                    <h2 className="text-2xl font-black text-slate-900 tracking-tight">
                      {showModal === 'create' ? 'Add Material' : 'Edit Material'}
                    </h2>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Institutional Hub Sequence</p>
                  </div>
                </div>
                <button onClick={() => setShowModal(null)} className="p-3 bg-slate-100 hover:bg-rose-500 hover:text-white rounded-2xl transition-all active:scale-90">
                  <X className="w-6 h-6" />
                </button>
              </div>

              <form id="material-form" onSubmit={handleSubmit} className="p-8 space-y-6 overflow-y-auto flex-1">
                {/* Archive source banner */}
                {predefinedAsset && formData.file_url && showModal === 'create' && (
                  <div className="flex items-center gap-3 p-4 bg-amber-50 border border-amber-200 rounded-2xl text-amber-800 text-xs font-bold animate-in slide-in-from-top-2">
                    <span className="text-lg">📦</span>
                    File pre-loaded from Cloud Archive vault — fill in the details below to publish to the mobile app.
                  </div>
                )}
                <div className="space-y-4">
                  <div>
                    <label className="block text-[11px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Document Title *</label>
                    <input
                      type="text"
                      value={formData.title}
                      onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                      className="w-full px-6 py-4 bg-slate-50 border-2 border-transparent focus:border-primary-950 rounded-2xl transition-all focus:bg-white outline-none font-bold text-slate-900"
                      placeholder="Enter material title..."
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Study Description</label>
                    <textarea
                      value={formData.description}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                      rows={3}
                      className="w-full px-6 py-4 bg-slate-50 border-2 border-transparent focus:border-primary-950 rounded-2xl transition-all focus:bg-white outline-none font-bold text-slate-900 resize-none"
                      placeholder="Brief context for students..."
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[11px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Academic Level *</label>
                      <select
                        value={formData.level}
                        onChange={(e) => setFormData({ ...formData, level: e.target.value, course_id: '' })}
                        disabled={!!assignedLevel}
                        className="w-full px-6 py-4 bg-slate-50 border-2 border-transparent focus:border-primary-950 rounded-2xl transition-all focus:bg-white outline-none font-bold text-slate-900 appearance-none disabled:opacity-50"
                      >
                        {!assignedLevel && <option value="">Select Level</option>}
                        <option value="100">Level 100</option>
                        <option value="200">Level 200</option>
                        <option value="300">Level 300</option>
                        <option value="400">Level 400</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Semester *</label>
                      <select
                        value={formData.semester}
                        onChange={(e) => setFormData({ ...formData, semester: e.target.value, course_id: '' })}
                        className="w-full px-6 py-4 bg-slate-50 border-2 border-transparent focus:border-primary-950 rounded-2xl transition-all focus:bg-white outline-none font-bold text-slate-900 appearance-none"
                      >
                        <option value="">Select Semester</option>
                        <option value="first">First Semester</option>
                        <option value="second">Second Semester</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[11px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Related Course *</label>
                      <select
                        value={formData.course_id}
                        onChange={(e) => setFormData({ ...formData, course_id: e.target.value })}
                        disabled={!formData.level || !formData.semester}
                        className="w-full px-6 py-4 bg-slate-50 border-2 border-transparent focus:border-primary-950 rounded-2xl transition-all focus:bg-white outline-none font-bold text-slate-900 appearance-none disabled:opacity-50"
                      >
                        <option value="">Select Course</option>
                        {formData.level && formData.semester && (
                          <option value="general" className="font-bold text-emerald-600">General Resource</option>
                        )}
                        {availableCourses.map((c: Course) => (
                          <option key={c.id} value={c.id}>{c.code} - {c.title}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Material Type *</label>
                      <select
                        value={formData.material_type}
                        onChange={(e) => setFormData({ ...formData, material_type: e.target.value as Material['material_type'] })}
                        className="w-full px-6 py-4 bg-slate-50 border-2 border-transparent focus:border-primary-950 rounded-2xl transition-all focus:bg-white outline-none font-bold text-slate-900 appearance-none"
                        required
                      >
                        {Object.entries(materialTypeConfig).map(([key, config]) => (
                          <option key={key} value={key}>{config.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="p-6 bg-slate-50 rounded-[2rem] border-2 border-dashed border-slate-200">
                    {formData.material_type === 'link' ? (
                      <div className="space-y-4">
                        <label className="block text-[11px] font-black text-slate-400 uppercase tracking-widest ml-1">Resource URL *</label>
                        <div className="relative">
                           <input
                            type="url"
                            value={formData.file_url}
                            onChange={(e) => setFormData({ ...formData, file_url: e.target.value })}
                            className="w-full px-6 py-4 bg-white border-2 border-transparent focus:border-primary-950 rounded-2xl transition-all outline-none font-bold text-slate-900 pr-14"
                            placeholder="https://..."
                            required
                          />
                          <LinkIcon className="absolute right-6 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-300" />
                        </div>
                      </div>
                    ) : (
                      <FileUpload
                        accept={
                          formData.material_type === 'pdf' ? '.pdf' :
                          formData.material_type === 'word' ? '.doc,.docx' :
                          formData.material_type === 'ppt' ? '.ppt,.pptx' :
                          formData.material_type === 'video' ? 'video/*' : '*/*'
                        }
                        folder="materials"
                        multiple={true}
                        onUploadComplete={(url: string, file: File, originalFilename?: string) => setFormData({ ...formData, file_url: url, file_name: originalFilename || file.name, file_size: file.size, file_mime_type: file.type || null })}
                        onMultiUploadComplete={(results) => {
                          const first = results[0];
                          const newFiles = results.map(r => ({ url: r.url, name: r.originalFilename || r.file.name, size: r.file.size, type: r.file.type }));
                          setFormData({
                            ...formData, 
                            file_url: first.url, 
                            file_name: first.originalFilename || first.file.name, 
                            file_size: first.file.size, 
                            file_mime_type: first.file.type,
                            files: newFiles
                          });
                        }}
                        currentFileUrl={formData.file_url}
                        label="Source Attachment"
                      />
                    )}
                  </div>

                  <div className="flex flex-wrap gap-6 p-2">
                    <div className="flex items-center gap-3">
                      <div className="w-2 h-2 rounded-full bg-green-500" />
                      <label className="text-xs font-black text-green-600 uppercase tracking-widest">Public Access — Always On</label>
                    </div>
                    
                    <div className="flex items-center gap-3">
                      <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                      <label className="text-[10px] font-black text-emerald-600 uppercase tracking-[0.2em]">Secured by IDS V5.0 Protocol</label>
                    </div>

                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        id="is_featured"
                        checked={formData.is_featured}
                        onChange={(e) => setFormData({ ...formData, is_featured: e.target.checked })}
                        className="w-5 h-5 rounded-lg border-2 border-slate-200 text-primary-950 focus:ring-primary-950 cursor-pointer"
                      />
                      <label htmlFor="is_featured" className="text-xs font-black text-slate-600 uppercase tracking-widest cursor-pointer">Featured Rank</label>
                    </div>
                  </div>
                </div>
              </form>

              {/* Sticky footer — always visible */}
              <div className="shrink-0 px-8 pb-8 pt-4 bg-white border-t border-slate-100">
                {formError && (
                  <div className="mb-4 flex items-center gap-3 px-5 py-3 bg-red-50 border border-red-100 rounded-2xl">
                    <ShieldAlert className="w-4 h-4 text-red-500 shrink-0" />
                    <p className="text-sm font-medium text-red-700">{formError}</p>
                  </div>
                )}
                <div className="flex gap-4">
                  <button
                    type="button"
                    onClick={() => setShowModal(null)}
                    className="flex-1 px-8 py-5 bg-slate-100 text-slate-500 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-200 transition-all active:scale-95"
                  >
                    Discard Changes
                  </button>
                  <button
                    type="submit"
                    form="material-form"
                    disabled={isSubmitting}
                    className="flex-[2] relative group inline-flex items-center justify-center px-8 py-5 font-black text-white transition-all duration-300 bg-primary-950 rounded-2xl shadow-xl shadow-primary-950/20 hover:scale-[1.02] active:scale-95 disabled:opacity-50"
                  >
                    <div className="absolute -inset-px bg-gradient-to-r from-emerald-400 to-primary-400 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                    <span className="relative flex items-center gap-2">
                      {isSubmitting ? (
                        <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      ) : (
                        showModal === 'create' ? <Plus className="w-5 h-5" /> : <Edit className="w-5 h-5" />
                      )}
                      {showModal === 'create' ? 'Add To Mobile App' : 'Commit Updates'}
                    </span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {/* View Modal */}
        {showModal === 'view' && selectedMaterial && (
          <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center z-[100] p-4 animate-in fade-in duration-300">
            <div className="bg-white rounded-[3rem] shadow-2xl w-full max-w-2xl overflow-hidden border border-white/10 animate-in zoom-in-95 duration-500">
              <div className="p-10 pb-6 flex items-center justify-between">
                <div className="flex items-center gap-6">
                  <div className={`p-5 rounded-[2rem] ${materialTypeConfig[selectedMaterial.material_type as keyof typeof materialTypeConfig]?.color || materialTypeConfig.word.color} shadow-lg ring-8 ring-slate-50`}>
                    {getTypeIcon(selectedMaterial.material_type)}
                  </div>
                  <div>
                    <h2 className="text-3xl font-black text-slate-900 tracking-tight leading-tight">{selectedMaterial.title}</h2>
                    <p className="text-[11px] font-black text-emerald-600 uppercase tracking-[0.3em] mt-1">Study Material Authenticated</p>
                  </div>
                </div>
                <button onClick={() => setShowModal(null)} className="p-4 bg-slate-100 hover:bg-rose-500 hover:text-white rounded-2xl transition-all active:scale-90">
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="px-10 py-6 space-y-8">
                <div className="p-8 bg-slate-50 rounded-[2.5rem] border border-slate-100 italic font-medium text-slate-600 leading-relaxed">
                  "{selectedMaterial.description || 'No supplementary context provided for this institutional resource.'}"
                </div>

                <div className="grid grid-cols-2 gap-6">
                  <div className="p-6 bg-white border-2 border-slate-50 rounded-2xl shadow-sm">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Resource Type</p>
                    <p className="text-sm font-black text-slate-900 uppercase tracking-wide">{materialTypeConfig[selectedMaterial.material_type as keyof typeof materialTypeConfig]?.label || 'Study Material'}</p>
                  </div>
                   <div className="p-6 bg-white border-2 border-slate-50 rounded-2xl shadow-sm">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Institutional Source</p>
                    <p className="text-sm font-black text-slate-900 line-clamp-1">{selectedMaterial.uploader?.full_name || 'NALISS Library'}</p>
                  </div>
                </div>

                <div className="flex gap-4">
                  <div className="flex-1 p-6 bg-slate-900 border border-white/10 rounded-2xl text-center">
                    <p className="text-[10px] text-white/40 font-black uppercase tracking-widest mb-2">Total Accesses</p>
                    <p className="text-2xl font-black text-emerald-400">{selectedMaterial.view_count}</p>
                  </div>
                  <div className="flex-1 p-6 bg-slate-900 border border-white/10 rounded-2xl text-center">
                    <p className="text-[10px] text-white/40 font-black uppercase tracking-widest mb-2">Document Volume</p>
                    <p className="text-2xl font-black text-emerald-400">{formatFileSize(selectedMaterial.file_size)}</p>
                  </div>
                </div>

                {selectedMaterial.file_url && (
                  <div className="flex flex-col gap-4 pt-4">
                    <button
                      onClick={(e) => handlePreview(selectedMaterial.file_url!, e)}
                      className="group relative inline-flex items-center justify-center px-10 py-6 font-black text-white transition-all duration-300 bg-primary-950 rounded-[2rem] shadow-2xl shadow-primary-950/20 hover:scale-[1.02] active:scale-95"
                    >
                      <div className="absolute -inset-px bg-gradient-to-r from-emerald-400 to-primary-400 rounded-[2rem] opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                      <Eye className="relative mr-4 w-7 h-7 text-emerald-400" />
                      <span className="relative text-xl tracking-widest uppercase">Initiate Secure Stream</span>
                    </button>
                    
                    <a
                      href={selectedMaterial.file_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center gap-3 px-6 py-4 bg-white border-2 border-slate-100 text-slate-400 rounded-2xl hover:text-slate-600 hover:border-slate-200 transition-all text-[11px] font-black uppercase tracking-[0.3em]"
                    >
                      <ExternalLink className="w-5 h-5" /> Open Archive Original
                    </a>
                  </div>
                )}
              </div>
              <div className="p-6 bg-slate-50 flex items-center justify-center gap-3 opacity-40">
                  <ShieldAlert className="w-3 h-3 text-slate-950" />
                  <p className="text-[8px] font-black uppercase tracking-[0.4em] text-slate-950">Library Integrity Protocol Active</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

import React, { useState, useEffect, useMemo } from 'react';
import { 
  FileText,
  Calendar,
  Plus,
  Edit,
  Trash2,
  X,
  ShieldCheck,
  CheckCircle,
  Database,
  Layers,
  ChevronLeft,
  ChevronRight,
  Eye,
  Info,
  Search,
  HardDrive
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { deleteFromCloudinary } from '../lib/cloudinaryDelete';
import FileUpload from '../lib/FileUpload';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import { useFormDraft } from '../hooks/useFormDraft';

type ArchiveItem = {
  id: string;
  title: string;
  description: string | null;
  file_url: string;
  file_type: string;
  file_size: string | null;
  created_at: string;
};

const ITEMS_PER_PAGE = 10;

export default function ArchiveManagementPage() {
  const [archives, setArchives] = useState<ArchiveItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedArchive, setSelectedArchive] = useState<ArchiveItem | null>(null);

  const { showModal, setShowModal, formData, setFormData, clearDraft, resetForm } = useFormDraft('archives_draft', {
    title: '',
    description: '',
    file_type: 'document' as 'pdf' | 'image' | 'video' | 'document',
    file_size: '',
    file_url: '',
    batch_files: [] as Array<{ url: string; size?: number; name: string; type?: string }>
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    fetchArchives();
  }, []);

  const fetchArchives = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('archives')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setArchives(data || []);
    } catch (e: any) {
      console.error('Error fetching archives:', e);
    } finally {
      setIsLoading(false);
    }
  };

  const filteredArchives = useMemo(() => {
    return archives.filter(item => {
      const matchesSearch = item.title.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesType = typeFilter === 'all' || item.file_type === typeFilter;
      return matchesSearch && matchesType;
    });
  }, [archives, searchQuery, typeFilter]);

  const totalPages = Math.ceil(filteredArchives.length / ITEMS_PER_PAGE);
  const paginatedArchives = useMemo(() => {
    const from = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredArchives.slice(from, from + ITEMS_PER_PAGE);
  }, [filteredArchives, currentPage]);

  const handleOpenCreate = () => {
    if (!localStorage.getItem('archives_draft')) {
      resetForm();
    }
    setSelectedArchive(null);
    setShowModal('create');
  };

  const handleOpenEdit = (item: ArchiveItem) => {
    setSelectedArchive(item);
    setFormData({
      title: item.title,
      description: item.description || '',
      file_type: item.file_type as any,
      file_size: item.file_size || '',
      file_url: item.file_url,
      batch_files: []
    });
    setShowModal('edit');
  };

  const handleDelete = async (id: string, title: string) => {
    if (!window.confirm(`Are you sure you want to delete "${title}"?`)) return;

    setArchives(prev => prev.filter(a => a.id !== id));

    try {
      const { error } = await supabase.from('archives').delete().eq('id', id);
      if (error) {
        fetchArchives();
        throw error;
      }
      setSuccessMessage('Archive deleted successfully');
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (e: any) {
      alert('Failed to delete: ' + e.message);
    }
  };

  const handleDeleteIndividualFile = async (item: any, fileIndex: number, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (!window.confirm('Are you sure you want to delete this specific file?')) return;
    
    const existingFiles = (item as any).files || [];
    const updatedFiles = existingFiles.filter((_: any, idx: number) => idx !== fileIndex);
    
    const singleData = {
        file_url: updatedFiles.length > 0 ? updatedFiles[0].url : '',
        file_size: updatedFiles.length > 0 ? String(updatedFiles[0].size) : '0',
        files: updatedFiles
    };

    try {
      const { error } = await supabase
        .from('cloud_archives')
        .update(singleData)
        .eq('id', item.id);
        
      if (error) throw error;
      fetchArchives();
      
      if (existingFiles[fileIndex]?.url) {
        deleteFromCloudinary([existingFiles[fileIndex].url]);
      }
      setSuccessMessage('File deleted successfully');
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err: any) {
      setFormError('Failed to delete file: ' + (err.message || 'Unknown error'));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const hasBatch = formData.batch_files && formData.batch_files.length > 0;
    if (!formData.title || (!formData.file_url && !hasBatch)) {
      setFormError('Title and file attachment are required.');
      return;
    }

    setIsSubmitting(true);
    setFormError(null);

    try {
      if (showModal === 'create') {
        const hasBatch = formData.batch_files && formData.batch_files.length > 0;
        const { error } = await supabase.from('archives').insert([{
            title: formData.title,
            description: formData.description,
            file_type: formData.file_type,
            file_url: formData.file_url || (hasBatch ? formData.batch_files[0].url : null),
            file_size: formData.file_size || (hasBatch ? formData.batch_files[0].size : null),
            files: hasBatch ? formData.batch_files : []
        }]);
        if (error) throw error;
        setSuccessMessage('Archive added successfully');
      } else if (showModal === 'edit' && selectedArchive) {
        const hasBatch = formData.batch_files && formData.batch_files.length > 0;
        const { error } = await supabase.from('archives').update({
          title: formData.title,
          description: formData.description,
          file_type: formData.file_type,
          file_url: formData.file_url || (hasBatch ? formData.batch_files[0].url : null),
          file_size: formData.file_size || (hasBatch ? formData.batch_files[0].size : null),
          files: hasBatch ? formData.batch_files : []
        }).eq('id', selectedArchive.id);
        if (error) throw error;
        setSuccessMessage('Archive updated successfully');
      }

      if (showModal === 'create') clearDraft();
      else setShowModal(null);
      fetchArchives();
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err: any) {
      setFormError(err.message || 'Failed to save archive.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Derived stats
  const uniqueTypes = useMemo(() => new Set(archives.map(a => a.file_type)).size, [archives]);
  const latestDate = useMemo(() => {
    if (archives.length === 0) return '—';
    return new Date(archives[0].created_at).toLocaleDateString();
  }, [archives]);

  return (
    <div className="p-8 lg:p-12 max-w-7xl mx-auto space-y-12 animate-in fade-in duration-700 pb-20">
      {/* Success Toast */}
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

      {/* Hero Header */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-8 pb-10 border-b border-gray-100">
        <div>
          <div className="flex items-center gap-3 mb-4">
            <div className="px-4 py-1 bg-primary-950 text-primary-400 rounded-full flex items-center gap-2 border border-primary-800/50 shadow-xl shadow-primary-950/20">
               <ShieldCheck className="w-3.5 h-3.5" />
               <span className="text-[10px] font-black uppercase tracking-[0.2em] italic">Archive Manager</span>
            </div>
            <div className="px-4 py-1 bg-green-50 text-green-600 rounded-full flex items-center gap-2 border border-green-100">
               <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
               <span className="text-[10px] font-black uppercase tracking-widest text-green-700">Active</span>
            </div>
          </div>
          <h1 className="text-4xl lg:text-6xl font-black text-gray-950 tracking-tight leading-[0.9]">
            Cloud <br/>
            <span className="text-primary-600">Archives.</span>
          </h1>
          <p className="text-gray-400 mt-6 text-lg font-medium max-w-xl leading-relaxed">
              Add and manage institutional research repository assets for the NALISS mobile application.
          </p>
        </div>

        <button
          onClick={handleOpenCreate}
          className="group relative flex items-center gap-3 px-8 py-5 bg-primary-950 text-primary-400 rounded-[2rem] font-black text-sm uppercase tracking-[0.2em] hover:bg-white hover:text-primary-950 transition-all duration-500 shadow-2xl shadow-primary-950/20 overflow-hidden"
        >
          <div className="absolute inset-0 bg-primary-400/10 translate-y-full group-hover:translate-y-0 transition-transform duration-500" />
          <Plus className="w-5 h-5 relative z-10" />
          <span className="relative z-10">Add to Mobile App</span>
        </button>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="bg-white p-10 rounded-[3rem] border border-gray-100 shadow-sm flex flex-col gap-6 group hover:shadow-2xl transition-all duration-500 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-24 h-24 bg-primary-50 rounded-bl-[3rem] -mr-12 -mt-12 group-hover:bg-primary-100 transition-colors" />
            <div className="p-5 bg-primary-950 text-primary-400 rounded-2xl w-fit shadow-xl shadow-primary-950/20 group-hover:scale-110 group-hover:rotate-6 transition-all duration-500">
                <Database className="w-8 h-8" />
            </div>
            <div>
                <p className="text-[10px] font-black text-gray-300 uppercase tracking-[0.2em] mb-1">Total Archives</p>
                <div className="flex items-baseline gap-3">
                    <p className="text-4xl font-black text-gray-950 tracking-tighter">{archives.length.toLocaleString()}</p>
                    <div className="flex items-center gap-1 text-[10px] font-bold text-primary-600 bg-primary-50 px-2 py-0.5 rounded-full uppercase tracking-widest">
                        Records
                    </div>
                </div>
            </div>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-tight pt-4 border-t border-gray-50 flex items-center justify-between group-hover:text-primary-800 transition-colors">
                Repository Items
                <ChevronRight className="w-4 h-4 opacity-0 -translate-x-4 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-500" />
            </p>
        </div>

        <div className="bg-white p-10 rounded-[3rem] border border-gray-100 shadow-sm flex flex-col gap-6 group hover:shadow-2xl transition-all duration-500 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-24 h-24 bg-amber-50 rounded-bl-[3rem] -mr-12 -mt-12 group-hover:bg-amber-100 transition-colors" />
            <div className="p-5 bg-amber-950 text-amber-400 rounded-2xl w-fit shadow-xl shadow-amber-950/20 group-hover:scale-110 group-hover:rotate-6 transition-all duration-500">
                <Layers className="w-8 h-8" />
            </div>
            <div>
                <p className="text-[10px] font-black text-gray-300 uppercase tracking-[0.2em] mb-1">Document Types</p>
                <div className="flex items-baseline gap-3">
                    <p className="text-4xl font-black text-gray-950 tracking-tighter">{uniqueTypes}</p>
                    <div className="flex items-center gap-1 text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full uppercase tracking-widest">
                        Formats
                    </div>
                </div>
            </div>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-tight pt-4 border-t border-gray-50 flex items-center justify-between group-hover:text-primary-800 transition-colors">
                File Categories
                <ChevronRight className="w-4 h-4 opacity-0 -translate-x-4 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-500" />
            </p>
        </div>

        <div className="bg-white p-10 rounded-[3rem] border border-gray-100 shadow-sm flex flex-col gap-6 group hover:shadow-2xl transition-all duration-500 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-50 rounded-bl-[3rem] -mr-12 -mt-12 group-hover:bg-emerald-100 transition-colors" />
            <div className="p-5 bg-emerald-950 text-emerald-400 rounded-2xl w-fit shadow-xl shadow-emerald-950/20 group-hover:scale-110 group-hover:rotate-6 transition-all duration-500">
                <HardDrive className="w-8 h-8" />
            </div>
            <div>
                <p className="text-[10px] font-black text-gray-300 uppercase tracking-[0.2em] mb-1">Latest Upload</p>
                <div className="flex items-baseline gap-3">
                    <p className="text-4xl font-black text-gray-950 tracking-tighter">{latestDate}</p>
                </div>
            </div>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-tight pt-4 border-t border-gray-50 flex items-center justify-between group-hover:text-primary-800 transition-colors">
                Most Recent Entry
                <ChevronRight className="w-4 h-4 opacity-0 -translate-x-4 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-500" />
            </p>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-white p-8 rounded-[3rem] border border-gray-100 shadow-sm flex flex-col md:flex-row gap-6 items-center group hover:shadow-xl transition-all duration-500">
        <div className="flex-1 w-full relative">
          <Search className="absolute left-6 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-300 group-focus-within:text-primary-600 transition-colors" />
          <input
            type="text"
            placeholder="Search archives..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-16 pr-8 py-5 bg-gray-50 border-none rounded-[2rem] focus:ring-2 focus:ring-primary-950 font-medium text-gray-950 placeholder:text-gray-300 transition-all shadow-inner"
          />
        </div>
        <div className="flex flex-wrap md:flex-nowrap gap-4 w-full md:w-fit">
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="flex-1 md:w-48 px-6 py-5 bg-gray-50 border-none rounded-[2rem] focus:ring-2 focus:ring-primary-950 font-black text-[10px] uppercase tracking-widest text-gray-600 appearance-none text-center shadow-inner cursor-pointer"
          >
            <option value="all">All Types</option>
            <option value="document">Document</option>
            <option value="pdf">PDF</option>
            <option value="image">Image</option>
            <option value="video">Video</option>
          </select>
        </div>
      </div>

      {/* List */}
      <div className="space-y-6">
        {isLoading ? (
          <div className="col-span-full py-20 flex justify-center"><LoadingSpinner size="lg" /></div>
        ) : filteredArchives.length === 0 ? (
          <div className="col-span-full py-20 text-center">
            <div className="w-20 h-20 bg-gray-50 rounded-[2rem] flex items-center justify-center mx-auto mb-6">
              <FileText className="w-10 h-10 text-gray-200" />
            </div>
            <p className="text-lg font-black text-gray-300">No archives found</p>
            <p className="text-sm text-gray-300 mt-1">Try adjusting your search or filters</p>
          </div>
        ) : (
          paginatedArchives.map((item) => (
            <div key={item.id} className="bg-white rounded-[2rem] border border-gray-100 p-8 group hover:shadow-2xl hover:border-primary-200 transition-all duration-500 flex flex-col sm:flex-row sm:items-center justify-between gap-6">
              <div className="flex items-start gap-5">
                <div className="p-4 bg-primary-950 text-primary-400 rounded-2xl flex-shrink-0 shadow-xl shadow-primary-950/20 group-hover:scale-110 group-hover:rotate-3 transition-all duration-500">
                  <FileText className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-xl font-black text-gray-950">
                    <a href={item.file_url} target="_blank" rel="noopener noreferrer" className="hover:text-primary-600 transition-colors">
                      {item.title}
                    </a>
                  </h3>
                  <div className="flex items-center gap-3 mt-2 flex-wrap">
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest flex items-center gap-1.5">
                      <Calendar className="h-3.5 w-3.5" />
                      {new Date(item.created_at).toLocaleDateString()}
                    </span>
                    <span className="text-[10px] font-bold text-primary-600 bg-primary-50 px-3 py-1 rounded-full uppercase tracking-widest border border-primary-100">
                      {item.file_type}
                    </span>
                  </div>
                  {/* Embedded Files List */}
                  {(((item as any).files && Array.isArray((item as any).files) && (item as any).files.length > 0) || item.file_url) && (
                    <div className="mt-4 space-y-2 border-t border-gray-50 pt-4 w-full">
                      {((item as any).files && Array.isArray((item as any).files) && (item as any).files.length > 0) ? (
                        (item as any).files.map((file: any, idx: number) => (
                           <div key={idx} className="flex items-center justify-between p-2 bg-slate-50 rounded-lg border border-slate-100">
                             <div className="flex items-center gap-2 overflow-hidden">
                                <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                                <span className="text-xs font-medium text-slate-700 truncate">{file.name || 'Attached File'}</span>
                             </div>
                             <div className="flex items-center gap-1 shrink-0">
                               <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); window.open(file.url, '_blank'); }} className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-md" title="Preview"><Eye className="w-4 h-4" /></button>
                               <button onClick={(e) => handleDeleteIndividualFile(item, idx, e)} className="p-1.5 text-rose-600 hover:bg-rose-50 rounded-md" title="Delete"><Trash2 className="w-4 h-4" /></button>
                             </div>
                           </div>
                        ))
                      ) : item.file_url ? (
                           <div className="flex items-center justify-between p-2 bg-slate-50 rounded-lg border border-slate-100">
                             <div className="flex items-center gap-2 overflow-hidden">
                                <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                                <span className="text-xs font-medium text-slate-700 truncate">Attached File</span>
                             </div>
                             <div className="flex items-center gap-1 shrink-0">
                               <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); window.open(item.file_url, '_blank'); }} className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-md" title="Preview"><Eye className="w-4 h-4" /></button>
                             </div>
                           </div>
                      ) : null}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => handleOpenEdit(item)}
                  className="p-2.5 hover:bg-primary-50 text-gray-300 hover:text-primary-600 rounded-xl transition-all"
                >
                  <Edit className="h-5 w-5" />
                </button>
                <button
                  onClick={() => handleDelete(item.id, item.title)}
                  className="p-2.5 hover:bg-red-50 text-gray-300 hover:text-red-600 rounded-xl transition-all"
                >
                  <Trash2 className="h-5 w-5" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            className="w-10 h-10 rounded-[1rem] flex items-center justify-center text-sm font-bold bg-white text-gray-400 border border-gray-100 hover:bg-gray-50 hover:text-gray-600 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          {Array.from({ length: totalPages }).map((_, i) => (
            <button
              key={i}
              onClick={() => setCurrentPage(i + 1)}
              className={`w-10 h-10 rounded-[1rem] flex items-center justify-center text-sm font-bold transition-all ${
                currentPage === i + 1
                  ? 'bg-primary-950 text-primary-400 shadow-lg shadow-primary-950/20'
                  : 'bg-white text-gray-400 border border-gray-100 hover:bg-gray-50 hover:text-gray-600'
              }`}
            >
              {i + 1}
            </button>
          ))}
          <button
            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
            className="w-10 h-10 rounded-[1rem] flex items-center justify-center text-sm font-bold bg-white text-gray-400 border border-gray-100 hover:bg-gray-50 hover:text-gray-600 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Modal */}
      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-md flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col border border-white animate-in zoom-in-95 duration-300">
            <form onSubmit={handleSubmit} className="flex flex-col h-full overflow-hidden">
              {/* Header */}
              <div className="p-10 border-b border-gray-50 flex items-center justify-between bg-gray-50/50">
                <div>
                  <h2 className="text-xl font-bold text-slate-900">
                    {showModal === 'create' ? 'Add to Mobile App' : 'Edit Archive'}
                  </h2>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">Archive Details</p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowModal(null)}
                  className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-all"
                >
                  <X className="h-6 w-6" />
                </button>
              </div>

              {/* Scrollable content */}
              <div className="p-10 space-y-6 overflow-y-auto flex-1">
                {formError && (
                  <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm font-medium">
                    {formError}
                  </div>
                )}
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-5">
                    <div>
                      <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2 ml-1">
                        Title <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        value={formData.title}
                        onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary-950/10 focus:border-primary-950 text-sm font-bold text-slate-900 placeholder:text-slate-400 transition-all"
                        placeholder="e.g. 2025 Institutional Handbook"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2 ml-1">
                        Description / Abstract Findings
                      </label>
                      <textarea
                        value={formData.description}
                        onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary-950/10 focus:border-primary-950 text-sm font-medium text-slate-900 placeholder:text-slate-400 transition-all min-h-[100px]"
                        placeholder="Summary of the findings..."
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2 ml-1">
                          File Type
                        </label>
                        <select
                          value={formData.file_type}
                          onChange={(e) => setFormData({ ...formData, file_type: e.target.value as any })}
                          className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary-950/10 focus:border-primary-950 text-sm font-bold text-slate-700 transition-all appearance-none cursor-pointer"
                        >
                          <option value="pdf">PDF</option>
                          <option value="document">Document</option>
                          <option value="image">Image</option>
                          <option value="video">Video</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2 ml-1">
                          File Size (Optional)
                        </label>
                        <input
                          type="text"
                          value={formData.file_size}
                          onChange={(e) => setFormData({ ...formData, file_size: e.target.value })}
                          className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary-950/10 focus:border-primary-950 text-sm font-medium text-slate-900 placeholder:text-slate-400 transition-all"
                          placeholder="e.g. 2.4 MB"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2 ml-1">
                      Asset Attachment <span className="text-red-500">*</span>
                    </label>
                    
                    <div className="p-4 border-2 border-dashed border-slate-200 rounded-xl bg-slate-50">
                        <FileUpload
                          multiple={true}
                          onUploadComplete={(url, _name, size) => {
                            const sizeMB = size ? (Number(size) / (1024 * 1024)).toFixed(1) : '0.0';
                            setFormData({ 
                              ...formData, 
                              file_url: url,
                              file_size: formData.file_size || `${sizeMB} MB`
                            });
                          }}
                          onMultiUploadComplete={(results) => {
                            const batchFiles = results.map(r => ({
                                url: r.url,
                                size: r.file.size,
                                name: r.originalFilename || r.file.name,
                                type: r.file.type
                            }));
                            const existingFiles = formData.batch_files || [];
                            const combinedFiles = [...existingFiles, ...batchFiles];

                            setFormData({
                                ...formData,
                                // we set the first one to file_url just in case edit assumes it
                                file_url: combinedFiles[0]?.url || '',
                                file_size: combinedFiles[0]?.size ? (Number(combinedFiles[0].size) / (1024 * 1024)).toFixed(1) + ' MB' : '',
                                batch_files: combinedFiles
                            });
                          }}
                          currentFileUrl={formData.file_url}
                          currentBatchUrls={formData.batch_files}
                          onRemoveBatchItem={(idx) => {
                              const updatedFiles = (formData.batch_files || []).filter((_, i) => i !== idx);
                              setFormData({
                                ...formData,
                                batch_files: updatedFiles,
                                file_url: updatedFiles[0]?.url || '',
                              });
                          }}
                        />
                    </div>
                    
                    <div className="flex items-start gap-2 text-sm text-slate-500 mt-2 bg-blue-50/50 p-3 rounded-xl">
                      <Info className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" />
                      <p>Upload a file to automatically secure it into the cloud bucket and generate a permanent download link.</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="p-10 bg-gray-50/50 border-t border-gray-50 flex gap-4">
                <button
                  type="button"
                  onClick={() => {
                    if (showModal === 'create') clearDraft();
                    else setShowModal(null);
                  }}
                  className="flex-1 px-8 py-5 bg-white text-gray-400 rounded-2xl font-black text-[10px] uppercase tracking-widest border border-gray-100 hover:bg-gray-100 hover:text-gray-600 transition-all"
                >
                  {showModal === 'create' ? 'Discard Draft' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || !formData.file_url}
                  className="flex-[2] px-8 py-5 bg-primary-950 text-primary-400 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-primary-900 transition-all shadow-xl shadow-primary-950/20 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isSubmitting ? (
                    <>
                      <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      <span>Saving...</span>
                    </>
                  ) : (
                    <>
                      <Plus className="h-5 w-5" />
                      <span>{showModal === 'create' ? 'Add to Mobile App' : 'Save Changes'}</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

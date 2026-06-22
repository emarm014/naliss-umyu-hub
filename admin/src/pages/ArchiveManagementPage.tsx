import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { Plus, X, CheckCircle, Info, Search, Edit, Trash2, Calendar, FileText } from 'lucide-react';
import FileUpload from '../lib/FileUpload';
import Modal from '../components/ui/Modal';
import LoadingSpinner from '../components/ui/LoadingSpinner';

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

  const [showModal, setShowModal] = useState<'create' | 'edit' | null>(null);
  const [selectedArchive, setSelectedArchive] = useState<ArchiveItem | null>(null);

  const [formData, setFormData] = useState({
    title: '',
    description: '',
    file_type: 'document' as 'pdf' | 'image' | 'video' | 'document',
    file_size: '',
    file_url: ''
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
    setFormData({
      title: '',
      description: '',
      file_type: 'document',
      file_size: '',
      file_url: ''
    });
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
      file_url: item.file_url
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.title || !formData.file_url) {
      setFormError('Title and file attachment are required.');
      return;
    }

    setIsSubmitting(true);
    setFormError(null);

    try {
      if (showModal === 'create') {
        const { error } = await supabase.from('archives').insert([{
          title: formData.title,
          description: formData.description,
          file_type: formData.file_type,
          file_size: formData.file_size,
          file_url: formData.file_url
        }]);
        if (error) throw error;
        setSuccessMessage('Archive item successfully created!');
      } else if (showModal === 'edit' && selectedArchive) {
        const { error } = await supabase.from('archives').update({
          title: formData.title,
          description: formData.description,
          file_type: formData.file_type,
          file_size: formData.file_size,
          file_url: formData.file_url
        }).eq('id', selectedArchive.id);
        if (error) throw error;
        setSuccessMessage('Archive updated successfully!');
      }

      setShowModal(null);
      fetchArchives();
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err: any) {
      setFormError(err.message || 'Failed to save archive.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Archive Management</h1>
          <p className="text-slate-600 mt-1">Add and manage institutional research repository assets.</p>
        </div>
        <button
          onClick={handleOpenCreate}
          className="btn-institutional group flex items-center gap-2 px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
        >
          <div className="bg-white/20 p-1.5 rounded-full group-hover:bg-white/30 transition-colors">
            <Plus className="h-4 w-4" />
          </div>
          Add to Mobile App
        </button>
      </div>

      {successMessage && (
        <div className="bg-emerald-50 border-l-4 border-emerald-500 p-4 rounded-r-md">
          <div className="flex">
            <div className="flex-shrink-0">
              <CheckCircle className="h-5 w-5 text-emerald-400" />
            </div>
            <div className="ml-3">
              <p className="text-sm text-emerald-700">{successMessage}</p>
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" />
          <input
            type="text"
            placeholder="Search archives..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:ring-2 focus:ring-primary-500"
          />
        </div>
        <div>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:ring-2 focus:ring-primary-500"
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
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        {isLoading ? (
          <div className="p-12 flex justify-center"><LoadingSpinner size="lg" /></div>
        ) : filteredArchives.length === 0 ? (
          <div className="p-12 text-center text-slate-500">
            No archives found.
          </div>
        ) : (
          <div className="divide-y divide-slate-200">
            {paginatedArchives.map((item) => (
              <div key={item.id} className="p-6 hover:bg-slate-50 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
                    <FileText className="h-6 w-6 text-slate-400" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-slate-900">
                      <a href={item.file_url} target="_blank" rel="noopener noreferrer" className="hover:text-primary-600 hover:underline">
                        {item.title}
                      </a>
                    </h3>
                    <div className="flex items-center gap-3 mt-1 text-sm text-slate-500">
                      <span className="flex items-center gap-1">
                        <Calendar className="h-4 w-4" />
                        {new Date(item.created_at).toLocaleDateString()}
                      </span>
                      <span className="px-2.5 py-0.5 bg-slate-100 text-slate-700 rounded-full text-xs font-medium border border-slate-200 uppercase">
                        {item.file_type}
                      </span>
                      {item.file_size && (
                        <span className="text-xs text-slate-400 border border-slate-200 px-2.5 py-0.5 rounded-full bg-white">
                          {item.file_size}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleOpenEdit(item)}
                    className="p-2 text-slate-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"
                  >
                    <Edit className="h-5 w-5" />
                  </button>
                  <button
                    onClick={() => handleDelete(item.id, item.title)}
                    className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                  >
                    <Trash2 className="h-5 w-5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center mt-6">
          <div className="flex gap-2">
            {Array.from({ length: totalPages }).map((_, i) => (
              <button
                key={i}
                onClick={() => setCurrentPage(i + 1)}
                className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-medium transition-colors ${
                  currentPage === i + 1
                    ? 'bg-primary-600 text-white'
                    : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
                }`}
              >
                {i + 1}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <Modal 
          isOpen={true} 
          onClose={() => setShowModal(null)}
          title={showModal === 'create' ? 'Add to Mobile App' : 'Edit Archive'}
          size="2xl"
        >
          <form onSubmit={handleSubmit} className="space-y-6">
            {formError && (
              <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
                {formError}
              </div>
            )}
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Title <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.title}
                    onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                    placeholder="e.g. 2025 Institutional Handbook"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Description / Abstract Findings
                  </label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 min-h-[100px]"
                    placeholder="Summary of the findings..."
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      File Type
                    </label>
                    <select
                      value={formData.file_type}
                      onChange={(e) => setFormData({ ...formData, file_type: e.target.value as any })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                    >
                      <option value="pdf">PDF</option>
                      <option value="document">Document</option>
                      <option value="image">Image</option>
                      <option value="video">Video</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      File Size (Optional)
                    </label>
                    <input
                      type="text"
                      value={formData.file_size}
                      onChange={(e) => setFormData({ ...formData, file_size: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                      placeholder="e.g. 2.4 MB"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Asset Attachment <span className="text-red-500">*</span>
                </label>
                
                <div className="p-4 border-2 border-dashed border-slate-300 rounded-xl bg-slate-50">
                  {formData.file_url ? (
                    <div className="flex items-center justify-between p-3 bg-white rounded-lg border border-slate-200">
                      <div className="flex items-center space-x-3 overflow-hidden">
                        <div className="p-2 bg-primary-50 text-primary-600 rounded-lg">
                          <CheckCircle className="h-5 w-5" />
                        </div>
                        <span className="text-sm text-slate-700 truncate max-w-[200px]" title={formData.file_url}>
                          Asset Attached
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setFormData({ ...formData, file_url: '' })}
                        className="p-1 hover:bg-slate-100 rounded-full text-slate-500 transition-colors"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <FileUpload
                      onUploadComplete={(url, _name, size) => {
                        const sizeMB = size ? (Number(size) / (1024 * 1024)).toFixed(1) : '0.0';
                        setFormData({ 
                          ...formData, 
                          file_url: url,
                          file_size: formData.file_size || `${sizeMB} MB`
                        });
                      }}
                    />
                  )}
                </div>
                
                <div className="flex items-start gap-2 text-sm text-slate-500 mt-2 bg-blue-50/50 p-3 rounded-lg">
                  <Info className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" />
                  <p>Upload a file to automatically secure it into the cloud bucket and generate a permanent download link.</p>
                </div>
              </div>
            </div>

            <div className="pt-6 border-t border-slate-200 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowModal(null)}
                className="px-4 py-2 text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting || !formData.file_url}
                className="px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
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
        </Modal>
      )}
    </div>
  );
}

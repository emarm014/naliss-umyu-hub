import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { CheckCircle, Plus, Search, Edit, Trash2, Calendar, Globe } from 'lucide-react';
import FileUpload from '../lib/FileUpload';
import Modal from '../components/ui/Modal';
import LoadingSpinner from '../components/ui/LoadingSpinner';

type NewsItem = {
  id: string;
  title: string;
  content: string;
  category: string;
  image_url: string | null;
  created_at: string;
};

const ITEMS_PER_PAGE = 10;

export default function NewsManagementPage() {
  const [news, setNews] = useState<NewsItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState(1);
  
  const [showModal, setShowModal] = useState<'create' | 'edit' | null>(null);
  const [selectedNews, setSelectedNews] = useState<NewsItem | null>(null);
  
  const [formData, setFormData] = useState({
    title: '',
    content: '',
    category: 'General',
    image_url: ''
  });
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    fetchNews();
  }, []);

  const fetchNews = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('news')
        .select('*')
        .order('created_at', { ascending: false });
        
      if (error) throw error;
      setNews(data || []);
    } catch (e: any) {
      console.error('Error fetching news:', e);
    } finally {
      setIsLoading(false);
    }
  };

  const filteredNews = useMemo(() => {
    return news.filter(item => {
      const matchesSearch = item.title.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesCategory = categoryFilter === 'all' || item.category.toLowerCase() === categoryFilter.toLowerCase();
      return matchesSearch && matchesCategory;
    });
  }, [news, searchQuery, categoryFilter]);

  const totalPages = Math.ceil(filteredNews.length / ITEMS_PER_PAGE);
  const paginatedNews = useMemo(() => {
    const from = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredNews.slice(from, from + ITEMS_PER_PAGE);
  }, [filteredNews, currentPage]);

  const handleOpenCreate = () => {
    setFormData({ title: '', content: '', category: 'General', image_url: '' });
    setSelectedNews(null);
    setShowModal('create');
  };

  const handleOpenEdit = (item: NewsItem) => {
    setSelectedNews(item);
    setFormData({
      title: item.title,
      content: item.content,
      category: item.category,
      image_url: item.image_url || ''
    });
    setShowModal('edit');
  };

  const handleDelete = async (id: string, title: string) => {
    if (!window.confirm(`Are you sure you want to delete "${title}"?`)) return;
    
    setNews(prev => prev.filter(n => n.id !== id));
    
    try {
      const { error } = await supabase.from('news').delete().eq('id', id);
      if (error) {
        fetchNews();
        throw error;
      }
      setSuccessMessage('News deleted successfully');
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (e: any) {
      alert('Failed to delete: ' + e.message);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.title || !formData.content) {
      setFormError('Title and content are required.');
      return;
    }

    setIsSubmitting(true);
    setFormError(null);

    try {
      const formattedCategory = formData.category.charAt(0).toUpperCase() + formData.category.slice(1);
      const formattedImageUrl = formData.image_url.trim() === '' ? null : formData.image_url;

      if (showModal === 'create') {
        const { error } = await supabase.from('news').insert([{
          title: formData.title,
          content: formData.content,
          category: formattedCategory,
          image_url: formattedImageUrl
        }]);
        if (error) throw error;
        setSuccessMessage('News added successfully!');
      } else if (showModal === 'edit' && selectedNews) {
        const { error } = await supabase.from('news').update({
          title: formData.title,
          content: formData.content,
          category: formattedCategory,
          image_url: formattedImageUrl
        }).eq('id', selectedNews.id);
        if (error) throw error;
        setSuccessMessage('News updated successfully!');
      }

      setShowModal(null);
      fetchNews();
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err: any) {
      setFormError(err.message || 'Failed to save news.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">News Management</h1>
          <p className="text-slate-600 mt-1">Publish and manage breaking information and campus updates.</p>
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
            placeholder="Search news..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:ring-2 focus:ring-primary-500"
          />
        </div>
        <div>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:ring-2 focus:ring-primary-500"
          >
            <option value="all">All Categories</option>
            <option value="general">General</option>
            <option value="academic">Academic</option>
            <option value="social">Social</option>
            <option value="event">Event</option>
          </select>
        </div>
      </div>

      {/* List */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        {isLoading ? (
          <div className="p-12 flex justify-center"><LoadingSpinner size="lg" /></div>
        ) : filteredNews.length === 0 ? (
          <div className="p-12 text-center text-slate-500">
            No news articles found.
          </div>
        ) : (
          <div className="divide-y divide-slate-200">
            {paginatedNews.map((item) => (
              <div key={item.id} className="p-6 hover:bg-slate-50 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-start gap-4">
                  {item.image_url ? (
                    <img src={item.image_url} alt="Cover" className="w-16 h-16 rounded-lg object-cover bg-slate-100 flex-shrink-0" />
                  ) : (
                    <div className="w-16 h-16 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
                      <Globe className="h-6 w-6 text-slate-400" />
                    </div>
                  )}
                  <div>
                    <h3 className="text-lg font-bold text-slate-900">{item.title}</h3>
                    <div className="flex items-center gap-3 mt-1 text-sm text-slate-500">
                      <span className="flex items-center gap-1">
                        <Calendar className="h-4 w-4" />
                        {new Date(item.created_at).toLocaleDateString()}
                      </span>
                      <span className="px-2.5 py-0.5 bg-slate-100 text-slate-700 rounded-full text-xs font-medium border border-slate-200">
                        {item.category}
                      </span>
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
          title={showModal === 'create' ? 'Add to Mobile App' : 'Edit News'}
          size="xl"
        >
          <form onSubmit={handleSubmit} className="space-y-6">
            {formError && (
              <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
                {formError}
              </div>
            )}
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Title Headline <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  placeholder="e.g. Campus Wi-Fi Maintenance Schedule"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Category <span className="text-red-500">*</span>
                </label>
                <select
                  value={formData.category}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value as any })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                >
                  <option value="General">General</option>
                  <option value="Academic">Academic</option>
                  <option value="Social">Social</option>
                  <option value="Event">Event</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Cover Image Asset (Optional)
                </label>
                <FileUpload
                  onUploadComplete={(url) => setFormData({ ...formData, image_url: url })}
                  folder="news_covers"
                />
                {formData.image_url && (
                  <div className="mt-2 text-sm text-emerald-600 flex items-center">
                    <CheckCircle className="w-4 h-4 mr-1" /> Image attached successfully
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Content <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={formData.content}
                  onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 min-h-[200px]"
                  placeholder="Full article content..."
                  required
                />
              </div>
            </div>

            <div className="pt-4 border-t border-slate-200 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowModal(null)}
                className="px-4 py-2 text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors font-medium disabled:opacity-50 flex items-center gap-2"
              >
                {isSubmitting ? 'Saving...' : (showModal === 'create' ? 'Add to Mobile App' : 'Save Changes')}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

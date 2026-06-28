import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { CheckCircle, Plus, Search, Edit, Trash2, Calendar, Globe, Newspaper, Tag, Clock, ShieldCheck, X, ChevronLeft, ChevronRight } from 'lucide-react';
import FileUpload from '../lib/FileUpload';
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

  // Derived stats
  const uniqueCategories = useMemo(() => new Set(news.map(n => n.category)), [news]);
  const latestDate = useMemo(() => {
    if (news.length === 0) return '—';
    return new Date(news[0].created_at).toLocaleDateString();
  }, [news]);

  return (
    <div className="p-8 lg:p-12 max-w-7xl mx-auto space-y-12 animate-in fade-in duration-700 pb-20">
      {/* Success Notification */}
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
              <span className="text-[10px] font-black uppercase tracking-[0.2em] italic">News Manager</span>
            </div>
            <div className="px-4 py-1 bg-green-50 text-green-600 rounded-full flex items-center gap-2 border border-green-100">
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
              <span className="text-[10px] font-black uppercase tracking-widest text-green-700">Active</span>
            </div>
          </div>
          <h1 className="text-4xl lg:text-6xl font-black text-gray-950 tracking-tight leading-[0.9]">
            News &<br />
            <span className="text-primary-600">Updates.</span>
          </h1>
          <p className="text-gray-400 mt-6 text-lg font-medium max-w-xl leading-relaxed">
            Publish and manage breaking information and campus updates for the NALISS mobile app.
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
            onClick={handleOpenCreate}
            className="group relative flex items-center gap-3 px-8 py-5 bg-primary-950 text-primary-400 rounded-[2rem] font-black text-sm uppercase tracking-[0.2em] hover:bg-white hover:text-primary-950 transition-all duration-500 shadow-2xl shadow-primary-950/20 overflow-hidden"
          >
            <div className="absolute inset-0 bg-primary-400/10 translate-y-full group-hover:translate-y-0 transition-transform duration-500" />
            <Plus className="w-5 h-5 relative z-10" />
            <span className="relative z-10">Add to Mobile App</span>
          </button>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {/* Total News */}
        <div className="bg-white p-10 rounded-[3rem] border border-gray-100 shadow-sm flex flex-col gap-6 group hover:shadow-2xl transition-all duration-500 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-24 h-24 bg-primary-50 rounded-bl-[3rem] -mr-12 -mt-12 group-hover:bg-primary-100 transition-colors" />
          <div className="p-5 bg-primary-950 text-primary-400 rounded-2xl w-fit shadow-xl shadow-primary-950/20 group-hover:scale-110 group-hover:rotate-6 transition-all duration-500">
            <Newspaper className="w-8 h-8" />
          </div>
          <div>
            <p className="text-[10px] font-black text-gray-300 uppercase tracking-[0.2em] mb-1">Total News</p>
            <div className="flex items-baseline gap-3">
              <p className="text-4xl font-black text-gray-950 tracking-tighter">{news.length.toLocaleString()}</p>
              <div className="flex items-center gap-1 text-[10px] font-bold text-primary-600 bg-primary-50 px-2 py-0.5 rounded-full uppercase tracking-widest">
                Articles
              </div>
            </div>
          </div>
        </div>

        {/* Categories */}
        <div className="bg-white p-10 rounded-[3rem] border border-gray-100 shadow-sm flex flex-col gap-6 group hover:shadow-2xl transition-all duration-500 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-24 h-24 bg-primary-50 rounded-bl-[3rem] -mr-12 -mt-12 group-hover:bg-primary-100 transition-colors" />
          <div className="p-5 bg-primary-950 text-primary-400 rounded-2xl w-fit shadow-xl shadow-primary-950/20 group-hover:scale-110 group-hover:rotate-6 transition-all duration-500">
            <Tag className="w-8 h-8" />
          </div>
          <div>
            <p className="text-[10px] font-black text-gray-300 uppercase tracking-[0.2em] mb-1">Categories</p>
            <div className="flex items-baseline gap-3">
              <p className="text-4xl font-black text-gray-950 tracking-tighter">{uniqueCategories.size}</p>
              <div className="flex items-center gap-1 text-[10px] font-bold text-primary-600 bg-primary-50 px-2 py-0.5 rounded-full uppercase tracking-widest">
                Active
              </div>
            </div>
          </div>
        </div>

        {/* Latest */}
        <div className="bg-white p-10 rounded-[3rem] border border-gray-100 shadow-sm flex flex-col gap-6 group hover:shadow-2xl transition-all duration-500 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-24 h-24 bg-primary-50 rounded-bl-[3rem] -mr-12 -mt-12 group-hover:bg-primary-100 transition-colors" />
          <div className="p-5 bg-primary-950 text-primary-400 rounded-2xl w-fit shadow-xl shadow-primary-950/20 group-hover:scale-110 group-hover:rotate-6 transition-all duration-500">
            <Calendar className="w-8 h-8" />
          </div>
          <div>
            <p className="text-[10px] font-black text-gray-300 uppercase tracking-[0.2em] mb-1">Latest Published</p>
            <div className="flex items-baseline gap-3">
              <p className="text-4xl font-black text-gray-950 tracking-tighter">{latestDate}</p>
              <div className="flex items-center gap-1 text-[10px] font-bold text-primary-600 bg-primary-50 px-2 py-0.5 rounded-full uppercase tracking-widest">
                Recent
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-white/50 backdrop-blur-sm p-6 rounded-[2rem] border border-gray-100 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="relative">
          <Search className="absolute left-5 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-300" />
          <input
            type="text"
            placeholder="Search news..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-12 pr-6 py-4 bg-gray-50 border border-gray-100 rounded-[1.5rem] text-sm font-medium focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 focus:bg-white transition-all placeholder:text-gray-300"
          />
        </div>
        <div>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="w-full px-4 py-4 bg-gray-50 border border-gray-100 rounded-[1.5rem] text-sm font-bold text-gray-700 focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-all"
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
      {isLoading ? (
        <div className="py-20 flex justify-center"><LoadingSpinner size="lg" /></div>
      ) : filteredNews.length === 0 ? (
        <div className="col-span-full py-20 text-center">
          <div className="w-20 h-20 bg-gray-50 rounded-[2rem] flex items-center justify-center mx-auto mb-6">
            <Newspaper className="w-10 h-10 text-gray-200" />
          </div>
          <p className="text-lg font-black text-gray-300 uppercase tracking-widest">No news articles found</p>
          <p className="text-sm text-gray-300 mt-2 font-medium">Try adjusting your search or filters</p>
        </div>
      ) : (
        <div className="space-y-4">
          {paginatedNews.map((item) => (
            <div key={item.id} className="bg-white rounded-[2rem] border border-gray-100 p-8 group hover:shadow-2xl hover:border-primary-200 transition-all duration-500">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-start gap-5">
                  {item.image_url ? (
                    <img src={item.image_url} alt="Cover" className="w-16 h-16 rounded-2xl object-cover bg-gray-50 flex-shrink-0 shadow-sm" />
                  ) : (
                    <div className="w-16 h-16 rounded-2xl bg-primary-50 flex items-center justify-center flex-shrink-0">
                      <Globe className="h-7 w-7 text-primary-300" />
                    </div>
                  )}
                  <div>
                    <h3 className="text-xl font-black text-gray-950">{item.title}</h3>
                    <div className="flex items-center gap-3 mt-2">
                      <span className="flex items-center gap-1.5 text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                        <Calendar className="h-3.5 w-3.5" />
                        {new Date(item.created_at).toLocaleDateString()}
                      </span>
                      <span className="text-[10px] font-bold text-primary-600 bg-primary-50 px-2.5 py-0.5 rounded-full uppercase tracking-widest border border-primary-100">
                        {item.category}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
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
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            className="w-10 h-10 rounded-[1rem] flex items-center justify-center text-sm font-bold bg-white text-gray-400 border border-gray-100 hover:bg-gray-50 hover:text-gray-600 transition-all disabled:opacity-30"
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
            className="w-10 h-10 rounded-[1rem] flex items-center justify-center text-sm font-bold bg-white text-gray-400 border border-gray-100 hover:bg-gray-50 hover:text-gray-600 transition-all disabled:opacity-30"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-md flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col border border-white animate-in zoom-in-95 duration-300">
            <form onSubmit={handleSubmit} className="flex flex-col h-full overflow-hidden">
              {/* Header */}
              <div className="p-10 border-b border-gray-50 flex items-center justify-between bg-gray-50/50">
                <div>
                  <h2 className="text-xl font-bold text-slate-900">
                    {showModal === 'create' ? 'Add to Mobile App' : 'Edit News'}
                  </h2>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">News Details</p>
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
                
                <div className="space-y-5">
                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2 ml-1">
                      Title Headline <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={formData.title}
                      onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary-950/10 focus:border-primary-950 text-sm font-bold text-slate-900 placeholder:text-slate-400 transition-all"
                      placeholder="e.g. Campus Wi-Fi Maintenance Schedule"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2 ml-1">
                      Category <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={formData.category}
                      onChange={(e) => setFormData({ ...formData, category: e.target.value as any })}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary-950/10 focus:border-primary-950 text-sm font-bold text-slate-700 transition-all appearance-none cursor-pointer"
                    >
                      <option value="General">General</option>
                      <option value="Academic">Academic</option>
                      <option value="Social">Social</option>
                      <option value="Event">Event</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2 ml-1">
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
                    <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2 ml-1">
                      Content <span className="text-red-500">*</span>
                    </label>
                    <textarea
                      value={formData.content}
                      onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary-950/10 focus:border-primary-950 text-sm font-medium text-slate-900 placeholder:text-slate-400 transition-all min-h-[200px]"
                      placeholder="Full article content..."
                      required
                    />
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="p-10 bg-gray-50/50 border-t border-gray-50 flex gap-4">
                <button
                  type="button"
                  onClick={() => setShowModal(null)}
                  className="flex-1 px-8 py-5 bg-white text-gray-400 rounded-2xl font-black text-[10px] uppercase tracking-widest border border-gray-100 hover:bg-gray-100 hover:text-gray-600 transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-[2] px-8 py-5 bg-primary-950 text-primary-400 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-primary-900 transition-all shadow-xl shadow-primary-950/20 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isSubmitting ? 'Saving...' : (showModal === 'create' ? 'Add to Mobile App' : 'Save Changes')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { Image as ImageIcon, Plus, Trash2, Edit, X, Search, ShieldAlert, ExternalLink, Eye, Camera, Film, LayoutGrid } from 'lucide-react';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import ErrorState from '../components/ui/ErrorState';
import FileUpload from '../lib/FileUpload';

import { useFormDraft } from '../hooks/useFormDraft';

export default function GalleryPage() {
  const [topics, setTopics] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const { showModal, setShowModal, formData, setFormData, clearDraft } = useFormDraft('gallery_draft', {
    title: '',
    description: '',
    cover_image: '',
    files: [] as any[] // For uploads queue {url, name, size, type}
  });

  const [editingTopicId, setEditingTopicId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  
  const [selectedTopic, setSelectedTopic] = useState<any | null>(null);
  const [topicMedia, setTopicMedia] = useState<any[]>([]);
  const [mediaLoading, setMediaLoading] = useState(false);

  useEffect(() => {
    fetchTopics();
  }, []);

  const fetchTopics = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('gallery_topics')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setTopics(data || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchTopicMedia = async (topicId: string) => {
    try {
      setMediaLoading(true);
      const { data, error } = await supabase
        .from('gallery_media')
        .select('*')
        .eq('topic_id', topicId)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true });

      if (error) throw error;
      setTopicMedia(data || []);
    } catch (err: any) {
      console.error(err);
    } finally {
      setMediaLoading(false);
    }
  };

  const handleOpenViewModal = (topic: any) => {
    setSelectedTopic(topic);
    fetchTopicMedia(topic.id);
    setShowModal('view');
  };

  const handleOpenEditModal = (topic: any) => {
    setSelectedTopic(topic);
    setFormData({
      title: topic.title,
      description: topic.description || '',
      cover_image: topic.cover_image || '',
      files: []
    });
    setEditingTopicId(topic.id);
    setShowModal('edit');
  };

  const handleClearDraft = () => {
    clearDraft();
    setFormError(null);
    setEditingTopicId(null);
    setSelectedTopic(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setFormError(null);

    try {
      if (showModal === 'create') {
        if (!formData.files || formData.files.length === 0) {
          throw new Error('Please select at least one media file.');
        }

        const coverImg = formData.files.find(f => f.type?.startsWith('image'))?.url || formData.files[0]?.url;

        // 1. Insert Topic
        const { data: newTopic, error: topicError } = await supabase
          .from('gallery_topics')
          .insert([{ 
            title: formData.title, 
            description: formData.description,
            cover_image: coverImg
          }])
          .select()
          .single();

        if (topicError) throw topicError;

        // 2. Insert Media
        const mediaEntries = formData.files.map((file, idx) => ({
          topic_id: newTopic.id,
          media_url: file.url,
          media_type: file.type?.startsWith('video') ? 'video' : 'image',
          sort_order: idx
        }));

        const { error: mediaError } = await supabase
          .from('gallery_media')
          .insert(mediaEntries);

        if (mediaError) throw mediaError;

      } else if (showModal === 'edit') {
        // Edit Topic
        const { error: topicError } = await supabase
          .from('gallery_topics')
          .update({ 
            title: formData.title, 
            description: formData.description 
          })
          .eq('id', editingTopicId);

        if (topicError) throw topicError;
        
        // If there are new files uploaded during edit, insert them too
        if (formData.files && formData.files.length > 0) {
            const mediaEntries = formData.files.map((file) => ({
              topic_id: editingTopicId,
              media_url: file.url,
              media_type: file.type?.startsWith('video') ? 'video' : 'image',
              sort_order: 999
            }));
            
            const { error: mediaError } = await supabase
              .from('gallery_media')
              .insert(mediaEntries);
              
            if (mediaError) throw mediaError;
        }
      }
      
      handleClearDraft();
      fetchTopics();
      
    } catch (err: any) {
      setFormError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteTopic = async (id: string) => {
    if (!confirm('Are you sure you want to delete this topic and all its media?')) return;
    try {
      const { error } = await supabase
        .from('gallery_topics')
        .delete()
        .eq('id', id);
      if (error) throw error;
      fetchTopics();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleDeleteMedia = async (mediaId: string) => {
    if (!confirm('Delete this item?')) return;
    try {
      const { error } = await supabase
        .from('gallery_media')
        .delete()
        .eq('id', mediaId);
      if (error) throw error;
      
      if (selectedTopic) fetchTopicMedia(selectedTopic.id);
    } catch (err: any) {
      alert(err.message);
    }
  };

  const filteredTopics = topics.filter(t => 
    t.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
    (t.description && t.description.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  if (loading) return <LoadingSpinner />;
  if (error) return <ErrorState message={error} onRetry={fetchTopics} />;

  return (
    <div className="flex h-[calc(100vh-64px)] overflow-hidden bg-slate-50 relative isolate">
      {/* Dynamic Background Pattern */}
      <div className="absolute inset-0 opacity-[0.02] mix-blend-multiply pointer-events-none" style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, slate 1px, transparent 0)', backgroundSize: '48px 48px' }}></div>

      <div className="flex-1 flex flex-col min-w-0 z-10">
        <div className="p-10 border-b border-slate-200 bg-white shadow-sm flex flex-col md:flex-row gap-6 justify-between items-start md:items-center relative z-20">
          <div>
            <div className="flex items-center gap-4 mb-2">
              <div className="p-3 bg-fuchsia-100 text-fuchsia-600 rounded-2xl shadow-inner">
                <LayoutGrid className="w-8 h-8" />
              </div>
              <h1 className="text-4xl font-black text-slate-900 tracking-tight">Gallery Control</h1>
            </div>
            <p className="text-slate-500 font-medium ml-1">Manage institutional albums and visual documentation</p>
          </div>
          <div className="flex flex-col sm:flex-row gap-4 w-full md:w-auto">
            <div className="relative group">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5 group-focus-within:text-fuchsia-500 transition-colors" />
              <input
                type="text"
                placeholder="Search albums..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full sm:w-80 pl-12 pr-6 py-4 bg-slate-50 border-2 border-transparent focus:border-fuchsia-500 rounded-[1.5rem] transition-all focus:bg-white outline-none font-bold text-slate-700 shadow-sm"
              />
            </div>
            <button
              onClick={() => setShowModal('create')}
              className="group relative inline-flex items-center justify-center px-8 py-4 font-black text-white transition-all duration-300 bg-primary-950 rounded-[1.5rem] shadow-xl shadow-primary-950/20 hover:scale-105 active:scale-95"
            >
              <div className="absolute -inset-px bg-gradient-to-r from-fuchsia-400 to-primary-400 rounded-[1.5rem] opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
              <Plus className="relative mr-2 w-5 h-5" />
              <span className="relative">Add To Mobile App</span>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-10">
          {filteredTopics.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-400 bg-white/50 backdrop-blur-sm rounded-[3rem] border border-slate-100 p-12 shadow-sm">
              <div className="w-32 h-32 mb-8 rounded-[2.5rem] bg-slate-100 flex items-center justify-center shadow-inner">
                <ImageIcon className="w-16 h-16 text-slate-300" />
              </div>
              <h3 className="text-2xl font-black text-slate-900 mb-2">No Gallery Albums Yet</h3>
              <p className="font-medium text-slate-500 max-w-md text-center">Add photos or videos to start documenting departmental activities and events.</p>
              <button 
                onClick={() => setShowModal('create')}
                className="mt-8 px-8 py-4 bg-primary-50 text-primary-700 font-bold rounded-2xl hover:bg-primary-100 transition-colors"
              >
                Create First Album
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
              {filteredTopics.map((topic) => (
                <div key={topic.id} className="group flex flex-col bg-white rounded-[2.5rem] border border-slate-100 shadow-sm hover:shadow-2xl transition-all duration-300 overflow-hidden hover:-translate-y-1">
                  
                  <div className="relative aspect-[4/3] bg-slate-100 overflow-hidden cursor-pointer" onClick={() => handleOpenViewModal(topic)}>
                    {topic.cover_image ? (
                        <img src={topic.cover_image} alt={topic.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                    ) : (
                        <div className="w-full h-full flex items-center justify-center text-slate-300 bg-slate-50">
                            <ImageIcon className="w-12 h-12" />
                        </div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-slate-900/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-6">
                        <p className="text-white font-bold flex items-center gap-2">
                            <Eye className="w-5 h-5" /> View Album
                        </p>
                    </div>
                  </div>

                  <div className="p-6 flex-1 flex flex-col">
                    <div className="flex-1">
                        <h3 className="font-black text-slate-900 text-lg leading-tight mb-2 line-clamp-2">{topic.title}</h3>
                        {topic.description && (
                            <p className="text-sm font-medium text-slate-500 line-clamp-2 mb-4">{topic.description}</p>
                        )}
                    </div>
                    
                    <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
                        <span className="text-[10px] font-black text-fuchsia-600 uppercase tracking-widest bg-fuchsia-50 px-3 py-1.5 rounded-lg">
                           Mobile Published
                        </span>
                        
                        <div className="flex items-center gap-2">
                            <button
                                onClick={(e) => { e.stopPropagation(); handleOpenEditModal(topic); }}
                                className="p-2 text-slate-400 hover:text-primary-600 hover:bg-primary-50 rounded-xl transition-colors"
                            >
                                <Edit className="w-4 h-4" />
                            </button>
                            <button
                                onClick={(e) => { e.stopPropagation(); handleDeleteTopic(topic.id); }}
                                className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-xl transition-colors"
                            >
                                <Trash2 className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Form Modal */}
      {(showModal === 'create' || showModal === 'edit') && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center z-[100] p-4 animate-in fade-in duration-300">
            <div className="bg-white rounded-[3rem] shadow-2xl w-full max-w-3xl overflow-hidden border border-white/10 flex flex-col max-h-[95vh] animate-in slide-in-from-bottom-10 duration-500">
              <div className="shrink-0 p-8 pb-6 flex items-center justify-between bg-slate-50 border-b border-slate-100">
                <div className="flex items-center gap-4">
                  <div className="p-4 bg-fuchsia-100 text-fuchsia-600 rounded-2xl shadow-inner">
                    <Camera className="w-6 h-6" />
                  </div>
                  <div>
                    <h2 className="text-2xl font-black text-slate-900 tracking-tight">
                      {showModal === 'create' ? 'Create Album' : 'Edit Album Info'}
                    </h2>
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mt-1">Publish to Mobile Network</p>
                  </div>
                </div>
                <button type="button" onClick={handleClearDraft} className="p-3 bg-white hover:bg-rose-500 hover:text-white rounded-xl shadow-sm transition-all active:scale-90 text-slate-400">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form id="gallery-form" onSubmit={handleSubmit} className="p-8 space-y-6 overflow-y-auto flex-1">
                <div className="space-y-4">
                  <div>
                    <label className="block text-[11px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Album Title *</label>
                    <input
                      type="text"
                      value={formData.title}
                      onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                      className="w-full px-6 py-4 bg-slate-50 border-2 border-transparent focus:border-fuchsia-500 rounded-2xl transition-all focus:bg-white outline-none font-bold text-slate-900"
                      placeholder="e.g. Matriculation Ceremony 2026..."
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Caption / Description</label>
                    <textarea
                      value={formData.description}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                      rows={3}
                      className="w-full px-6 py-4 bg-slate-50 border-2 border-transparent focus:border-fuchsia-500 rounded-2xl transition-all focus:bg-white outline-none font-bold text-slate-900 resize-none"
                      placeholder="Brief context for the album..."
                    />
                  </div>

                </div>

                  <div className="space-y-4 mt-6">
                      <label className="flex items-center gap-2 text-sm font-black text-slate-800 uppercase tracking-widest">
                        <Camera className="w-4 h-4 text-primary-600" />
                        Album Media Files
                      </label>
                      <div className="bg-slate-50 border-2 border-slate-100 rounded-[2rem] p-6">
                        <FileUpload
                          accept="image/*,video/*"
                          folder="gallery"
                          multiple={true}
                          onUploadComplete={(url: string, file: File, originalFilename?: string) => setFormData({ 
                            ...formData, 
                            files: [{ url, name: originalFilename || file.name, size: file.size, type: file.type }]
                          })}
                          onMultiUploadComplete={(results) => {
                            const newFiles = results.map(r => ({ url: r.url, name: r.originalFilename || r.file.name, size: r.file.size, type: r.file.type }));
                            const combinedFiles = [...(formData.files || []), ...newFiles];

                            setFormData({
                              ...formData, 
                              files: combinedFiles
                            });
                          }}
                          label="Add Media Files"
                          currentBatchUrls={formData.files}
                          onRemoveBatchItem={(idx) => {
                              const updatedFiles = (formData.files || []).filter((_, i) => i !== idx);
                              setFormData({
                                ...formData,
                                files: updatedFiles
                              });
                          }}
                        />
                      </div>
                      {showModal === 'edit' && (
                          <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl text-amber-800 text-xs font-bold flex items-center gap-3">
                             <ShieldAlert className="w-5 h-5 shrink-0" />
                             Note: Added files will be appended to this album. To remove old media, open the album view.
                          </div>
                      )}
                  </div>
              </form>

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
                    onClick={handleClearDraft}
                    className="flex-1 px-8 py-5 bg-slate-100 text-slate-500 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-200 transition-all active:scale-95"
                  >
                    Discard Changes
                  </button>
                  <button
                    type="submit"
                    form="gallery-form"
                    disabled={isSubmitting}
                    className="flex-[2] relative group inline-flex items-center justify-center px-8 py-5 font-black text-white transition-all duration-300 bg-primary-950 rounded-2xl shadow-xl shadow-primary-950/20 hover:scale-[1.02] active:scale-95 disabled:opacity-50"
                  >
                    <div className="absolute -inset-px bg-gradient-to-r from-fuchsia-400 to-primary-400 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                    <span className="relative flex items-center gap-2">
                      {isSubmitting ? (
                        <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      ) : (
                        showModal === 'create' ? <Plus className="w-5 h-5" /> : <Edit className="w-5 h-5" />
                      )}
                      {showModal === 'create' ? 'Add To Mobile App' : 'Save Changes'}
                    </span>
                  </button>
                </div>
              </div>
            </div>
        </div>
      )}

      {/* View Modal */}
      {showModal === 'view' && selectedTopic && (
          <div className="fixed inset-0 bg-slate-950/90 backdrop-blur-md flex items-center justify-center z-[100] p-4 animate-in fade-in duration-300">
            <div className="bg-white rounded-[3rem] shadow-2xl w-full max-w-5xl overflow-hidden border border-white/10 flex flex-col max-h-[95vh] animate-in zoom-in-95 duration-500">
              <div className="p-10 pb-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-6 shrink-0">
                <div className="flex items-center gap-6">
                  <div className="p-5 rounded-[2rem] bg-fuchsia-100 text-fuchsia-600 shadow-lg ring-8 ring-slate-50">
                    <Camera className="w-8 h-8" />
                  </div>
                  <div>
                    <h2 className="text-3xl font-black text-slate-900 tracking-tight leading-tight">{selectedTopic.title}</h2>
                    <p className="text-[11px] font-black text-fuchsia-600 uppercase tracking-[0.3em] mt-1">{topicMedia.length} Media Items</p>
                  </div>
                </div>
                <button type="button" onClick={handleClearDraft} className="p-4 bg-slate-100 hover:bg-rose-500 hover:text-white rounded-2xl transition-all active:scale-90 self-start md:self-auto">
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="px-10 py-6 overflow-y-auto flex-1 bg-slate-50/50">
                {selectedTopic.description && (
                    <div className="p-8 bg-white rounded-[2.5rem] border border-slate-100 italic font-medium text-slate-600 leading-relaxed shadow-sm mb-8">
                    "{selectedTopic.description}"
                    </div>
                )}

                {mediaLoading ? (
                    <div className="flex justify-center py-20"><LoadingSpinner /></div>
                ) : topicMedia.length === 0 ? (
                    <div className="text-center py-20 bg-white rounded-[2.5rem] border border-slate-100">
                        <ImageIcon size={48} className="mx-auto text-slate-300 mb-4" />
                        <h3 className="text-xl font-bold text-slate-900">Album is Empty</h3>
                        <p className="text-slate-500 font-medium">This album currently has no photos or videos.</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                        {topicMedia.map((media) => (
                            <div key={media.id} className="relative group aspect-square rounded-3xl overflow-hidden border-2 border-white shadow-sm bg-slate-100">
                                {media.media_type === 'image' ? (
                                    <img src={media.media_url} alt="" className="w-full h-full object-cover" />
                                ) : (
                                    <div className="relative w-full h-full">
                                        <video src={media.media_url} className="w-full h-full object-cover" />
                                        <div className="absolute inset-0 flex items-center justify-center bg-black/20 pointer-events-none">
                                            <Film className="w-10 h-10 text-white drop-shadow-md" />
                                        </div>
                                    </div>
                                )}
                                <div className="absolute inset-0 bg-slate-950/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3 backdrop-blur-[2px]">
                                    <a
                                        href={media.media_url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="p-3 bg-white/20 text-white rounded-full hover:bg-white hover:text-slate-900 transition-colors backdrop-blur-md"
                                        title="View Original"
                                    >
                                        <ExternalLink size={20} />
                                    </a>
                                    <button
                                        onClick={() => handleDeleteMedia(media.id)}
                                        className="p-3 bg-rose-500/80 text-white rounded-full hover:bg-rose-500 transition-colors backdrop-blur-md"
                                        title="Delete Media"
                                    >
                                        <Trash2 size={20} />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
              </div>
              <div className="p-6 bg-slate-50 flex items-center justify-center gap-3 opacity-40 shrink-0 border-t border-slate-100">
                  <ShieldAlert className="w-3 h-3 text-slate-950" />
                  <p className="text-[8px] font-black uppercase tracking-[0.4em] text-slate-950">Library Integrity Protocol Active</p>
              </div>
            </div>
          </div>
      )}
    </div>
  );
}

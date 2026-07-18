import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { Image as ImageIcon, Plus, Trash2, Edit, Upload } from 'lucide-react';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import ErrorState from '../components/ui/ErrorState';
import Modal from '../components/ui/Modal';

export default function GalleryPage() {
  const [topics, setTopics] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [showTopicModal, setShowTopicModal] = useState<'create' | 'edit' | false>(false);
  const [editingTopicId, setEditingTopicId] = useState<string | null>(null);
  
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  
  const [selectedTopic, setSelectedTopic] = useState<any | null>(null);
  const [topicMedia, setTopicMedia] = useState<any[]>([]);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [uploading, setUploading] = useState(false);

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

  const handleOpenTopic = (topic: any) => {
    setSelectedTopic(topic);
    fetchTopicMedia(topic.id);
  };

  const handleSaveTopic = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (showTopicModal === 'create') {
        const { error } = await supabase
          .from('gallery_topics')
          .insert([{ title, description }]);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('gallery_topics')
          .update({ title, description })
          .eq('id', editingTopicId);
        if (error) throw error;
      }
      
      setShowTopicModal(false);
      setTitle('');
      setDescription('');
      setEditingTopicId(null);
      fetchTopics();
      
      // Update selected topic if edited
      if (editingTopicId && selectedTopic?.id === editingTopicId) {
          setSelectedTopic({ ...selectedTopic, title, description });
      }
    } catch (err: any) {
      alert(err.message);
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
      
      if (selectedTopic?.id === id) {
        setSelectedTopic(null);
      }
      fetchTopics();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleMediaUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || !selectedTopic) return;
    
    setUploading(true);
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const fileExt = file.name.split('.').pop();
        const fileName = `${selectedTopic.id}/${Math.random().toString(36).substring(2)}.${fileExt}`;
        
        const { error: uploadError } = await supabase.storage
          .from('gallery')
          .upload(fileName, file);
          
        if (uploadError) throw uploadError;
        
        const { data: { publicUrl } } = supabase.storage
          .from('gallery')
          .getPublicUrl(fileName);
          
        const mediaType = file.type.startsWith('video') ? 'video' : 'image';
        
        const { error: dbError } = await supabase
          .from('gallery_media')
          .insert([{
            topic_id: selectedTopic.id,
            media_url: publicUrl,
            media_type: mediaType
          }]);
          
        if (dbError) throw dbError;
        
        // Update cover image of topic if it's the first image
        if (mediaType === 'image' && topicMedia.length === 0 && i === 0) {
            await supabase.from('gallery_topics').update({ cover_image: publicUrl }).eq('id', selectedTopic.id);
        }
      }
      
      fetchTopicMedia(selectedTopic.id);
      fetchTopics(); // Refresh to get cover image update
    } catch (err: any) {
      alert(err.message);
    } finally {
      setUploading(false);
      // Reset input
      e.target.value = '';
    }
  };

  const handleDeleteMedia = async (mediaId: string, url: string) => {
    if (!confirm('Delete this item?')) return;
    try {
      // Extract file path from URL
      const pathParts = url.split('/gallery/');
      if (pathParts.length > 1) {
          const filePath = pathParts[1];
          await supabase.storage.from('gallery').remove([filePath]);
      }
      
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

  if (loading) return <LoadingSpinner />;
  if (error) return <ErrorState message={error} onRetry={fetchTopics} />;

  return (
    <div className="flex h-[calc(100vh-64px)] overflow-hidden">
      {/* Sidebar for Topics */}
      <div className="w-1/3 border-r bg-gray-50 flex flex-col h-full">
        <div className="p-4 border-b bg-white flex justify-between items-center">
          <h2 className="text-lg font-bold text-gray-800">Gallery Topics</h2>
          <button
            onClick={() => {
              setTitle('');
              setDescription('');
              setShowTopicModal('create');
            }}
            className="p-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
          >
            <Plus size={20} />
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {topics.length === 0 ? (
            <p className="text-gray-500 text-sm text-center py-4">No topics created yet.</p>
          ) : (
            topics.map(topic => (
              <div 
                key={topic.id}
                onClick={() => handleOpenTopic(topic)}
                className={`p-3 rounded-lg border cursor-pointer transition-colors ${selectedTopic?.id === topic.id ? 'bg-primary-50 border-primary-200' : 'bg-white border-gray-200 hover:bg-gray-50'}`}
              >
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <h3 className="font-semibold text-gray-800">{topic.title}</h3>
                    {topic.description && (
                      <p className="text-xs text-gray-500 mt-1 line-clamp-2">{topic.description}</p>
                    )}
                  </div>
                  <div className="flex gap-1 ml-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setTitle(topic.title);
                        setDescription(topic.description || '');
                        setEditingTopicId(topic.id);
                        setShowTopicModal('edit');
                      }}
                      className="p-1.5 text-gray-400 hover:text-blue-600 rounded-md hover:bg-blue-50"
                    >
                      <Edit size={16} />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteTopic(topic.id);
                      }}
                      className="p-1.5 text-gray-400 hover:text-red-600 rounded-md hover:bg-red-50"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Main Content for Media */}
      <div className="w-2/3 bg-white flex flex-col h-full relative">
        {selectedTopic ? (
          <>
            <div className="p-6 border-b">
              <h1 className="text-2xl font-bold text-gray-800">{selectedTopic.title}</h1>
              {selectedTopic.description && (
                <p className="text-gray-600 mt-2">{selectedTopic.description}</p>
              )}
            </div>
            
            <div className="p-4 border-b bg-gray-50 flex justify-between items-center">
              <span className="text-sm font-medium text-gray-700">
                {topicMedia.length} items
              </span>
              <div>
                <label className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg cursor-pointer hover:bg-primary-700 transition-colors">
                  <Upload size={18} />
                  <span>{uploading ? 'Uploading...' : 'Upload Media'}</span>
                  <input
                    type="file"
                    multiple
                    accept="image/*,video/*"
                    className="hidden"
                    onChange={handleMediaUpload}
                    disabled={uploading}
                  />
                </label>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              {mediaLoading ? (
                <div className="flex justify-center py-12"><LoadingSpinner /></div>
              ) : topicMedia.length === 0 ? (
                <div className="text-center py-16">
                  <ImageIcon size={48} className="mx-auto text-gray-300 mb-4" />
                  <h3 className="text-lg font-medium text-gray-900">No media in this topic</h3>
                  <p className="text-gray-500 mt-1">Upload images or videos to get started.</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                  {topicMedia.map((media) => (
                    <div key={media.id} className="relative group aspect-square rounded-xl overflow-hidden border bg-gray-100">
                      {media.media_type === 'image' ? (
                        <img src={media.media_url} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <video src={media.media_url} className="w-full h-full object-cover" controls />
                      )}
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <button
                          onClick={() => handleDeleteMedia(media.id, media.media_url)}
                          className="p-2 bg-red-600 text-white rounded-full hover:bg-red-700 shadow-lg"
                        >
                          <Trash2 size={20} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-400">
            <div className="text-center">
              <ImageIcon size={48} className="mx-auto mb-4 opacity-50" />
              <p>Select a topic to manage its gallery</p>
            </div>
          </div>
        )}
      </div>

      <Modal
        isOpen={!!showTopicModal}
        onClose={() => setShowTopicModal(false)}
        title={showTopicModal === 'create' ? 'Create Topic' : 'Edit Topic'}
      >
        <form onSubmit={handleSaveTopic} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Title / Heading</label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
              placeholder="e.g. FYB Dinner 2026"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description / Caption</label>
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 resize-none"
              placeholder="Optional description for this album..."
            />
          </div>
          <div className="flex justify-end gap-3 mt-6">
            <button
              type="button"
              onClick={() => setShowTopicModal(false)}
              className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
            >
              {showTopicModal === 'create' ? 'Create' : 'Save Changes'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

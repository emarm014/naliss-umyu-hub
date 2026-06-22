import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { CheckCircle } from 'lucide-react';
import FileUpload from '../lib/FileUpload';

export default function NewsManagementPage() {
  const [formData, setFormData] = useState({
    title: '',
    content: '',
    category: 'general' as 'general' | 'academic' | 'social' | 'event',
    image_url: ''
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.title || !formData.content) {
      setFormError('Title and content are required.');
      return;
    }

    setIsSubmitting(true);
    setFormError(null);

    try {
      // Capitalize first letter of category (e.g. 'general' -> 'General')
      const formattedCategory = formData.category.charAt(0).toUpperCase() + formData.category.slice(1);
      
      // Ensure empty strings for images are saved as true database NULLs
      const formattedImageUrl = formData.image_url.trim() === '' ? null : formData.image_url;

      const { error, status } = await supabase
        .from('news')
        .insert([{
          title: formData.title,
          content: formData.content,
          category: formattedCategory,
          image_url: formattedImageUrl
        }]);

      if (error) throw error;
      
      // Assume success on 201 Created or if no error is thrown
      if (status === 201 || !error) {
        setSuccessMessage('News successfully published!');
        setFormData({
          title: '',
          content: '',
          category: 'general',
          image_url: ''
        });
        setTimeout(() => setSuccessMessage(null), 3000);
      }
    } catch (err: any) {
      setFormError(err.message || 'Failed to publish news.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto p-4 md:p-6 lg:p-8">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">News Management</h1>
          <p className="text-slate-600 mt-1">Publish breaking information and campus updates.</p>
        </div>
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

      {formError && (
        <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-r-md">
          <div className="flex">
            <div className="ml-3">
              <p className="text-sm text-red-700">{formError}</p>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          <div className="grid grid-cols-1 gap-6">
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
                  <option value="general">General</option>
                  <option value="academic">Academic</option>
                  <option value="social">Social</option>
                  <option value="event">Event</option>
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
                    <CheckCircle className="w-4 h-4 mr-1" /> Image uploaded successfully
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
          </div>

          <div className="pt-4 border-t border-slate-200 flex justify-end">
            <button
              type="submit"
              disabled={isSubmitting}
              className={`px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 font-medium ${isSubmitting ? 'opacity-70 cursor-not-allowed' : ''}`}
            >
              {isSubmitting ? 'Adding...' : 'Add to Mobile App'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

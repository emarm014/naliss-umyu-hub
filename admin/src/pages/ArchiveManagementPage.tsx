import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { Plus, X, CheckCircle, Info } from 'lucide-react';
import FileUpload from '../lib/FileUpload';

export default function ArchiveManagementPage() {
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.title || !formData.file_url) {
      setFormError('Title and file attachment are required.');
      return;
    }

    setIsSubmitting(true);
    setFormError(null);

    try {
      const { error, status } = await supabase
        .from('archives')
        .insert([{
          title: formData.title,
          description: formData.description,
          file_type: formData.file_type,
          file_size: formData.file_size,
          file_url: formData.file_url
        }]);

      if (error) throw error;
      
      // Assume success on 201 Created or if no error is thrown
      if (status === 201 || !error) {
        setSuccessMessage('Archive successfully created!');
        setFormData({
          title: '',
          description: '',
          file_type: 'document',
          file_size: '',
          file_url: ''
        });
        setTimeout(() => setSuccessMessage(null), 3000);
      }
    } catch (err: any) {
      setFormError(err.message || 'Failed to create archive.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto p-4 md:p-6 lg:p-8">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Archive Management</h1>
          <p className="text-slate-600 mt-1">Add new institutional research repository assets.</p>
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
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
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
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500 min-h-[100px]"
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
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
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
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
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
                      <div className="p-2 bg-brand-50 text-brand-600 rounded-lg">
                        <CheckCircle className="h-5 w-5" />
                      </div>
                      <span className="text-sm text-slate-700 truncate max-w-[200px]">
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
                      // Optionally format size here if you want to automatically set it
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

          <div className="pt-6 border-t border-slate-200 flex justify-end">
            <button
              type="submit"
              disabled={isSubmitting || !formData.file_url}
              className="px-6 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
            >
              {isSubmitting ? (
                <>
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Adding...</span>
                </>
              ) : (
                <>
                  <Plus className="h-5 w-5" />
                  <span>Add to Mobile App</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

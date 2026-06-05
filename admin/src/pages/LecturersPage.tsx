import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Department } from '../types';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import ErrorState from '../components/ui/ErrorState';
import {
  Plus,
  Search,
  Edit,
  Trash2,
  User,
  Mail,
  Phone,
  Clock,
  X,
  ChevronLeft,
  ChevronRight,
  Image as ImageIcon,
  Upload,
  Camera,
  Linkedin,
  Globe,
  UserCheck,
  Activity,
  ShieldAlert,
  Users,
  Building,
  Loader2
} from 'lucide-react';
import FileUpload from '../lib/FileUpload';

import { useAdminDataStore } from '../store/adminData.store';
import { deleteFromCloudinary } from '../lib/cloudinaryDelete';

interface Photo {
  id: string;
  url: string;
  caption: string | null;
  display_order: number;
}

interface Lecturer {
  id: string;
  department_id: string;
  full_name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  avatar_url: string | null;
  position: string | null;
  specialization: string | null;
  office_location: string | null;
  office_hours: string | null;
  bio: string | null;
  qualifications: string | null;
  is_active: boolean;
  display_order: number;
  social_links?: Record<string, string>;
  created_at: string;
  department?: Department | null;
  photos?: Photo[];
}

const ITEMS_PER_PAGE = 12;

export default function LecturersPage() {
  const { lecturers: allLecturers, isSyncing, lastSync, syncAll, removeLecturer, error, refreshAnalytics } = useAdminDataStore();
  
  useEffect(() => {
    syncAll();
  }, [syncAll]);
  
  const [filteredLecturers, setFilteredLecturers] = useState<Lecturer[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [showModal, setShowModal] = useState<'create' | 'edit' | 'photos' | null>(null);
  const [selectedLecturer, setSelectedLecturer] = useState<Lecturer | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [photoUrl, setPhotoUrl] = useState('');
  const [photoCaption, setPhotoCaption] = useState('');

  const [formData, setFormData] = useState({
    full_name: '',
    title: '',
    email: '',
    phone: '',
    avatar_url: '',
    position: '',
    specialization: '',
    office_location: '',
    office_hours: '',
    bio: '',
    qualifications: '',
    department_id: '',
    is_active: true,
    linkedin_url: '',
    website_url: '',
  });

  // Search and Filter Logic
  useEffect(() => {
    let result = [...(allLecturers as Lecturer[])];

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(l => 
        l.full_name?.toLowerCase().includes(q) ||
        l.email?.toLowerCase().includes(q) ||
        l.specialization?.toLowerCase().includes(q) ||
        l.position?.toLowerCase().includes(q)
      );
    }

    setFilteredLecturers(result);
    setCurrentPage(1);
  }, [allLecturers, searchQuery]);

  const totalCount = filteredLecturers.length;
  const from = (currentPage - 1) * ITEMS_PER_PAGE;
  const to = from + ITEMS_PER_PAGE;
  const lecturers = filteredLecturers.slice(from, to);

  const facultyStats = {
    totalLecturers: allLecturers.length,
    active: allLecturers.filter(l => (l as Lecturer).is_active).length,
    inactive: allLecturers.filter(l => !(l as Lecturer).is_active).length
  };

  const totalPages = Math.ceil(totalCount / ITEMS_PER_PAGE);

  const handleDelete = async (id: string) => {
    if (!window.confirm('Are you sure you want to permanently delete this lecturer profile? This action cannot be undone.')) {
      return;
    }

    // Capture avatar URL BEFORE optimistic remove — allLecturers will no longer contain this item after removeLecturer()
    const lec = allLecturers.find(l => l.id === id) as any;
    const avatarUrl = lec?.avatar_url;

    removeLecturer(id);
    setSuccessMessage('Lecturer profile deleted successfully.');
    setTimeout(() => setSuccessMessage(null), 5000);

    try {
      const { error } = await supabase.from('lecturers').delete().eq('id', id);
      if (error) {
        syncAll(true);
        setSuccessMessage(null);
      } else {
        // avatarUrl captured before optimistic remove — always valid here
        deleteFromCloudinary([avatarUrl]);
      }
    } catch {
      syncAll(true);
    }
  };

  const handleToggleActive = async (lecturer: Lecturer) => {
    try {
      const { error } = await supabase
        .from('lecturers')
        .update({ is_active: !lecturer.is_active })
        .eq('id', lecturer.id);

      if (error) throw error;
      setSuccessMessage(`Lecturer is now ${!lecturer.is_active ? 'visible in mobile app' : 'hidden from mobile app'}.`);
      refreshAnalytics();
      setTimeout(() => setSuccessMessage(null), 5000);
    } catch (err: unknown) {
      setFormError('Failed to update: ' + ((err as any)?.message || 'Unknown error'));
    }
  };

  const openCreateModal = () => {
    setFormData({
      full_name: '',
      title: '',
      email: '',
      phone: '',
      avatar_url: '',
      position: '',
      specialization: '',
      office_location: '',
      office_hours: '',
      bio: '',
      qualifications: '',
      department_id: '',
      is_active: true,
      linkedin_url: '',
      website_url: '',
    });
    setShowModal('create');
  };

  const openEditModal = (lecturer: Lecturer) => {
    setSelectedLecturer(lecturer);
    setFormData({
      full_name: lecturer.full_name,
      title: lecturer.title || '',
      email: lecturer.email || '',
      phone: lecturer.phone || '',
      avatar_url: lecturer.avatar_url || '',
      position: lecturer.position || '',
      specialization: lecturer.specialization || '',
      office_location: lecturer.office_location || '',
      office_hours: lecturer.office_hours || '',
      bio: lecturer.bio || '',
      qualifications: lecturer.qualifications || '',
      department_id: lecturer.department_id || '',
      is_active: lecturer.is_active,
      linkedin_url: lecturer.social_links?.linkedin || '',
      website_url: lecturer.social_links?.website || '',
    });
    setShowModal('edit');
  };

  const openPhotosModal = async (lecturer: Lecturer) => {
    try {
      const { data, error } = await supabase
        .from('photos')
        .select('*')
        .eq('entity_type', 'lecturer')
        .eq('entity_id', lecturer.id)
        .order('display_order');

      if (error) throw error;
      setSelectedLecturer({ ...lecturer, photos: data || [] });
      setShowModal('photos');
    } catch {
      setSelectedLecturer(lecturer);
      setShowModal('photos');
    }
  };
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const lecturerData = {
        full_name: formData.full_name,
        title: formData.title || null,
        email: formData.email || null,
        phone: formData.phone || null,
        avatar_url: formData.avatar_url || null,
        position: formData.position || null,
        specialization: formData.specialization || null,
        office_location: formData.office_location || null,
        office_hours: formData.office_hours || null,
        bio: formData.bio || null,
        qualifications: formData.qualifications || null,
        department_id: formData.department_id || null,
        is_active: formData.is_active,
        display_order: (allLecturers.length || 0) + 1,
        social_links: {
          linkedin: formData.linkedin_url || '',
          website: formData.website_url || '',
        },
      };

      if (showModal === 'create') {
        const { data: inserted, error } = await supabase.from('lecturers').insert(lecturerData).select('*').single();
        if (error) throw error;
        if (inserted) useAdminDataStore.getState().addLecturer(inserted as any);
      } else if (showModal === 'edit' && selectedLecturer) {
        const { data: updated, error } = await supabase
          .from('lecturers')
          .update(lecturerData)
          .eq('id', selectedLecturer.id)
          .select('*')
          .single();
        if (error) throw error;
        if (updated) useAdminDataStore.getState().updateLecturer(updated as any);
      }

      setSuccessMessage(`Lecturer ${showModal === 'create' ? 'registered' : 'updated'} successfully!`);
      setShowModal(null);
      setFormError(null);
      refreshAnalytics();
      setTimeout(() => setSuccessMessage(null), 5000);
    } catch (err: unknown) {
      setFormError((err as any)?.message || 'Failed to save. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAddPhoto = async () => {
    if (!photoUrl || !selectedLecturer) return;
    setIsSubmitting(true);
    try {
      const { error } = await supabase.from('photos').insert({
        entity_type: 'lecturer',
        entity_id: selectedLecturer.id,
        url: photoUrl,
        caption: photoCaption || null,
        display_order: (selectedLecturer.photos?.length || 0) + 1,
      });
      if (error) throw error;
      const { data } = await supabase
        .from('photos').select('*')
        .eq('entity_type', 'lecturer').eq('entity_id', selectedLecturer.id)
        .order('display_order');
      setSelectedLecturer({ ...selectedLecturer, photos: data || [] });
      setPhotoUrl('');
      setPhotoCaption('');
    } catch (err: unknown) {
      setFormError((err as any)?.message || 'Failed to add photo.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeletePhoto = async (photoId: string) => {
    if (!selectedLecturer) return;
    if (!window.confirm('Are you sure you want to delete this photo?')) return;
    try {
      const { error } = await supabase.from('photos').delete().eq('id', photoId);
      if (error) throw error;
      const { data } = await supabase
        .from('photos').select('*')
        .eq('entity_type', 'lecturer').eq('entity_id', selectedLecturer.id)
        .order('display_order');
      setSelectedLecturer({ ...selectedLecturer, photos: data || [] });
    } catch (err: unknown) {
      setFormError((err as any)?.message || 'Failed to delete photo.');
    }
  };

  const handleSetProfilePhoto = async (photoUrl: string) => {
    if (!selectedLecturer) return;
    try {
      const { error } = await supabase
        .from('lecturers').update({ avatar_url: photoUrl }).eq('id', selectedLecturer.id);
      if (error) throw error;
      setSelectedLecturer({ ...selectedLecturer, avatar_url: photoUrl });
      refreshAnalytics();
      setSuccessMessage('Profile photo updated.');
      setTimeout(() => setSuccessMessage(null), 4000);
    } catch (err: unknown) {
      setFormError((err as any)?.message || 'Failed to set profile photo.');
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Global Success Banner */}
      {successMessage && (
        <div className="fixed top-6 right-6 z-[100] bg-green-900 border border-green-700 text-green-100 px-6 py-4 rounded-xl shadow-2xl flex items-center gap-4 animate-in fade-in slide-in-from-top-6 duration-300">
          <div className="w-10 h-10 bg-green-800 rounded-full flex items-center justify-center flex-shrink-0 border border-green-600">
            <UserCheck className="w-5 h-5 text-green-300" />
          </div>
          <div>
            <p className="text-[10px] font-black tracking-[0.25em] text-primary-400 italic">SUCCESS</p>
            <p className="text-sm font-bold tracking-tight">{successMessage}</p>
          </div>
        </div>
      )}

      {/* Hero Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-6 bg-white/50 p-6 rounded-2xl border border-gray-100 shadow-sm backdrop-blur-sm">
        <div>
          <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Lecturers</h1>
          <p className="text-slate-500 mt-1 font-medium flex items-center gap-2">
            <Users className="w-4 h-4 text-primary-600" />
            Manage lecturer profiles, bios, and contact information.
          </p>
        </div>
        <button
          onClick={openCreateModal}
          className="btn-institutional flex items-center shadow-lg hover:shadow-primary-900/20"
        >
          <Plus className="w-5 h-5 mr-2 group-hover:rotate-90 transition-transform" />
          Add Lecturer
        </button>
      </div>

      {/* Faculty Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="glass-card p-6 border-l-4 border-l-primary-600">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-bold text-slate-500 uppercase tracking-wider">Lecturer Statistics</p>
              <p className="text-3xl font-extrabold text-primary-950 mt-1">{facultyStats.totalLecturers}</p>
            </div>
            <div className="w-12 h-12 bg-primary-50 rounded-xl flex items-center justify-center">
              <Users className="w-6 h-6 text-primary-600" />
            </div>
          </div>
        </div>
        <div className="glass-card p-6 border-l-4 border-l-green-500">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-bold text-slate-500 uppercase tracking-wider">Active</p>
              <p className="text-3xl font-extrabold text-primary-950 mt-1">{facultyStats.active}</p>
            </div>
            <div className="w-12 h-12 bg-green-50 rounded-xl flex items-center justify-center">
              <Activity className="w-6 h-6 text-green-600" />
            </div>
          </div>
        </div>
        <div className="glass-card p-6 border-l-4 border-l-amber-500">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-bold text-slate-500 uppercase tracking-wider">Inactive</p>
              <p className="text-3xl font-extrabold text-primary-950 mt-1">{facultyStats.inactive}</p>
            </div>
            <div className="w-12 h-12 bg-amber-50 rounded-xl flex items-center justify-center">
              <ShieldAlert className="w-6 h-6 text-amber-600" />
            </div>
          </div>
        </div>
      </div>

      {/* Search and Filter */}
      <div className="glass-card p-4 flex flex-col md:flex-row gap-4 items-center justify-between">
        <div className="relative w-full md:w-96">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" />
          <input
            type="text"
            placeholder="Search lecturers..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary-500 focus:bg-white transition-all font-medium text-slate-700 placeholder:text-slate-400"
          />
        </div>
        <div className="flex items-center gap-3 bg-primary-50 px-4 py-2 rounded-lg border border-primary-100">
          <Building className="w-4 h-4 text-primary-600" />
          <span className="text-sm font-bold text-primary-800 tracking-wide">Department: LIS</span>
        </div>
      </div>

      {/* Lecturer Directory */}
      {allLecturers.length === 0 && isSyncing && !lastSync ? (
        <div className="flex flex-col items-center justify-center py-24 glass-card">
          <LoadingSpinner size="lg" />
          <span className="text-sm font-bold text-slate-400 uppercase tracking-widest animate-pulse">Loading lecturers...</span>
        </div>
      ) : error ? (
        <div className="py-12 glass-card">
          <ErrorState onRetry={() => syncAll()} message="Sync failed. Please check your connection." />
        </div>
      ) : lecturers.length === 0 ? (
        <div className="glass-card p-16 text-center border-dashed border-2 border-slate-300">
          <Users className="h-16 w-16 text-slate-300 mx-auto mb-4" />
          <h3 className="text-xl font-bold text-slate-700">No Lecturers Found</h3>
          <p className="text-slate-500 mt-2 max-w-md mx-auto">The directory is currently empty or your search query yielded zero results.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {lecturers.map((lecturer) => (
            <div
              key={lecturer.id}
              className={`glass-card relative overflow-hidden group transition-all duration-300 hover:-translate-y-1 hover:shadow-xl ${
                !lecturer.is_active ? 'opacity-70 grayscale-[30%]' : ''
              }`}
            >
              {/* Status Ribbon */}
              <div className={`absolute top-0 right-0 h-1 w-full ${lecturer.is_active ? 'bg-primary-500' : 'bg-amber-500'}`} />

              <div className="p-6">
                <div className="flex items-start gap-5">
                  {/* Profile Picture */}
                  <div className="relative group/avatar cursor-pointer" onClick={() => openPhotosModal(lecturer)}>
                    <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-primary-100 to-primary-50 border-2 border-white shadow-md flex items-center justify-center overflow-hidden">
                      {lecturer.avatar_url ? (
                        <img
                          src={lecturer.avatar_url}
                          alt={lecturer.full_name}
                          className="w-full h-full object-cover transition-transform duration-500 group-hover/avatar:scale-110"
                        />
                      ) : (
                        <User className="h-10 w-10 text-primary-400/50" />
                      )}
                    </div>
                    {/* Hover Overlay for Photos */}
                    <div className="absolute inset-0 bg-primary-950/60 rounded-2xl opacity-0 group-hover/avatar:opacity-100 flex items-center justify-center transition-all duration-200">
                      <Camera className="w-6 h-6 text-white" />
                    </div>
                  </div>

                  <div className="flex-1 min-w-0 pt-1">
                    <h3 className="text-lg font-bold text-slate-900 truncate tracking-tight">
                      {lecturer.title ? `${lecturer.title} ` : ''}{lecturer.full_name}
                    </h3>
                    <div className="inline-flex mt-1 items-center px-2 py-1 rounded bg-primary-50 border border-primary-100">
                      <p className="text-xs font-bold tracking-wide text-primary-700 uppercase">
                        {lecturer.position || 'Lecturer'}
                      </p>
                    </div>
                    
                    {!lecturer.is_active && (
                      <span className="inline-flex mt-2 items-center px-2 py-1 rounded bg-amber-50 border border-amber-200 text-[10px] font-bold tracking-wide text-amber-700 uppercase">
                        Inactive
                      </span>
                    )}

                    {/* Social Media Links */}
                    <div className="flex gap-2 mt-3">
                      {lecturer.social_links?.linkedin && (
                        <a href={lecturer.social_links.linkedin} target="_blank" rel="noopener noreferrer" className="w-7 h-7 rounded-full bg-slate-50 flex items-center justify-center text-slate-400 hover:text-[#0A66C2] hover:bg-blue-50 transition-colors border border-slate-100">
                          <Linkedin className="w-3.5 h-3.5" />
                        </a>
                      )}
                      {lecturer.social_links?.website && (
                        <a href={lecturer.social_links.website} target="_blank" rel="noopener noreferrer" className="w-7 h-7 rounded-full bg-slate-50 flex items-center justify-center text-slate-400 hover:text-primary-600 hover:bg-primary-50 transition-colors border border-slate-100">
                          <Globe className="w-3.5 h-3.5" />
                        </a>
                      )}
                    </div>
                  </div>
                </div>

                {/* Contact Details */}
                <div className="mt-6 space-y-3 bg-slate-50/50 p-4 rounded-xl border border-slate-100">
                  {lecturer.email && (
                    <div className="flex items-center gap-3 text-sm">
                      <Mail className="h-4 w-4 text-primary-400" />
                      <a href={`mailto:${lecturer.email}`} className="text-slate-600 font-medium hover:text-primary-600 truncate">
                        {lecturer.email}
                      </a>
                    </div>
                  )}
                  {lecturer.phone && (
                    <div className="flex items-center gap-3 text-sm">
                      <Phone className="h-4 w-4 text-primary-400" />
                      <span className="text-slate-600 font-medium">{lecturer.phone}</span>
                    </div>
                  )}
                  {lecturer.office_hours && (
                    <div className="flex items-center gap-3 text-sm">
                      <Clock className="h-4 w-4 text-primary-400" />
                      <span className="text-slate-600 font-medium truncate">{lecturer.office_hours}</span>
                    </div>
                  )}
                </div>

                {/* Specialization Pill */}
                {lecturer.specialization && (
                  <div className="mt-4">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-1">Specialization</p>
                    <p className="text-sm font-medium text-slate-800 leading-snug">{lecturer.specialization}</p>
                  </div>
                )}

                {/* Actions */}
                <div className="mt-5 pt-4 border-t border-slate-100 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleToggleActive(lecturer)}
                      className={`btn-institutional-sm ${lecturer.is_active ? 'bg-amber-100 text-amber-700 hover:bg-amber-200' : 'bg-green-100 text-green-700 hover:bg-green-200'}`}
                    >
                      {lecturer.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => openPhotosModal(lecturer)}
                      className="p-2 bg-slate-50 text-slate-500 rounded-lg hover:bg-primary-50 hover:text-primary-600 transition-colors"
                      title="Manage Gallery"
                    >
                      <ImageIcon className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => openEditModal(lecturer)}
                      className="p-2 bg-slate-50 text-slate-500 rounded-lg hover:bg-slate-200 transition-colors"
                      title="Edit Profile"
                    >
                      <Edit className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(lecturer.id)}
                      className="p-2 bg-slate-50 text-slate-400 rounded-lg hover:bg-red-50 hover:text-red-600 transition-colors"
                      title="Purge Profile"
                    >
                      <Trash2 className="w-4 h-4" /> Delete Profile
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between glass-card p-4">
          <p className="text-sm font-medium text-slate-500 tracking-wide uppercase">
            Page <span className="text-slate-900">{currentPage} of {totalPages}</span>
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="p-2 rounded-xl bg-slate-50 border border-slate-200 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-primary-50 hover:text-primary-600 transition-colors"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="p-2 rounded-xl bg-slate-50 border border-slate-200 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-primary-50 hover:text-primary-600 transition-colors"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}

      {/* Modal Section */}
      {(showModal === 'create' || showModal === 'edit') && (
        <div className="fixed inset-0 bg-primary-950/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between p-6 bg-slate-50 border-b border-slate-100">
              <div>
                <h2 className="text-2xl font-black text-slate-900 uppercase tracking-tight">
                  {showModal === 'edit' ? 'Edit Lecturer' : 'Register New Lecturer'}
                </h2>
                <p className="text-xs font-bold text-slate-400 tracking-[0.2em] uppercase">
                  {showModal === 'edit' ? 'Update lecturer information below.' : 'Add a new lecturer to the student mobile app directory.'}
                </p>
              </div>
              <button onClick={() => setShowModal(null)} className="p-2 bg-white text-slate-400 hover:text-slate-600 rounded-xl shadow-sm border border-slate-200 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <form id="lecturer-form" onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-6">
              <div className="grid grid-cols-2 gap-6">
                
                {/* Visual Identity Block */}
                <div className="col-span-2 bg-slate-50/50 p-5 rounded-xl border border-slate-100">
                  <h3 className="text-xs font-black text-primary-900 uppercase tracking-[0.25em] mb-4 flex items-center gap-3">
                    <span className="w-8 h-px bg-primary-200"></span>
                    PROFILE PICTURE
                  </h3>
                  <FileUpload
                    accept="image/*"
                    isImage={true}
                    folder="avatars"
                    onUploadComplete={(url: string) => setFormData({ ...formData, avatar_url: url })}
                    currentFileUrl={formData.avatar_url}
                    label="Lecturer Photo" 
                    description="Upload a photo of the lecturer."
                  />
                </div>

                {/* Personal Details */}
                <div className="col-span-2 pt-4">
                  <h3 className="text-xs font-black text-primary-900 uppercase tracking-[0.25em] mb-4 flex items-center gap-3">
                    <span className="w-8 h-px bg-primary-200"></span>
                    PERSONAL DETAILS
                  </h3>
                </div>

                <div className="col-span-2 sm:col-span-1">
                    <label className="block text-xs font-black text-slate-500 uppercase tracking-widest mb-3">Full Name</label>
                  <input
                    type="text"
                    value={formData.full_name}
                    onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary-500 focus:bg-white font-medium text-slate-900 transition-all"
                    required
                    placeholder="e.g., Ali Usman"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Academic Title</label>
                  <select
                    value={formData.title}
                    onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary-500 focus:bg-white font-medium text-slate-900 transition-all"
                  >
                    <option value="">None</option>
                    <option value="Dr.">Dr.</option>
                    <option value="Prof.">Prof.</option>
                    <option value="Mr.">Mr.</option>
                    <option value="Mrs.">Mrs.</option>
                    <option value="Ms.">Ms.</option>
                  </select>
                </div>

                <div className="col-span-2 sm:col-span-1">
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Position / Role</label>
                  <input
                    type="text"
                    value={formData.position}
                    onChange={(e) => setFormData({ ...formData, position: e.target.value })}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary-500 focus:bg-white font-medium text-slate-900 transition-all"
                    placeholder="e.g., Senior Lecturer"
                  />
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <label className="block text-xs font-black text-slate-500 uppercase tracking-widest mb-3">Department</label>
                  <div className="w-full px-4 py-3 bg-slate-100 border border-slate-200 rounded-xl font-bold text-slate-500 uppercase text-xs tracking-widest">
                    LIS Department
                  </div>
                </div>

                {/* Contact Details */}
                <div className="col-span-2 pt-4">
                  <h3 className="text-xs font-black text-primary-900 uppercase tracking-[0.25em] mb-4 flex items-center gap-3">
                    <span className="w-8 h-px bg-primary-200"></span>
                    CONTACT DETAILS
                  </h3>
                </div>

                <div>
                  <label className="block text-xs font-black text-slate-500 uppercase tracking-widest mb-3">Email Address</label>
                  <div className="relative">
                     <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                     <input
                        type="email"
                        value={formData.email}
                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                        className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary-500 focus:bg-white font-medium text-slate-900 transition-all"
                        placeholder="staff@umyu.edu.ng"
                      />
                  </div>
                </div>
                <div>
                    <label className="block text-xs font-black text-slate-500 uppercase tracking-widest mb-3">Phone Number</label>
                  <div className="relative">
                     <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                     <input
                        type="tel"
                        value={formData.phone}
                        onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                        className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary-500 focus:bg-white font-medium text-slate-900 transition-all"
                      />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Office Location</label>
                  <input
                    type="text"
                    value={formData.office_location}
                    onChange={(e) => setFormData({ ...formData, office_location: e.target.value })}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary-500 focus:bg-white font-medium text-slate-900 transition-all"
                    placeholder="e.g., Room 204, LIS Block"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Office Hours</label>
                  <input
                    type="text"
                    value={formData.office_hours}
                    onChange={(e) => setFormData({ ...formData, office_hours: e.target.value })}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary-500 focus:bg-white font-medium text-slate-900 transition-all"
                    placeholder="e.g., Mon-Wed 10am-12pm"
                  />
                </div>

                {/* Biography */}
                <div className="col-span-2 pt-4">
                  <h3 className="text-xs font-black text-primary-900 uppercase tracking-[0.25em] mb-4 flex items-center gap-3">
                    <span className="w-8 h-px bg-primary-200"></span>
                    BIOGRAPHY
                  </h3>
                </div>

                <div className="col-span-2">
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Specialization</label>
                  <input
                    type="text"
                    value={formData.specialization}
                    onChange={(e) => setFormData({ ...formData, specialization: e.target.value })}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary-500 focus:bg-white font-medium text-slate-900 transition-all"
                    placeholder="e.g., Digital Libraries, Informetrics"
                  />
                </div>
                
                <div className="col-span-2">
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Qualifications</label>
                  <input
                    type="text"
                    value={formData.qualifications}
                    onChange={(e) => setFormData({ ...formData, qualifications: e.target.value })}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary-500 focus:bg-white font-medium text-slate-900 transition-all"
                    placeholder="e.g., PhD (Info Sci), MLIS"
                  />
                </div>

                <div className="col-span-2">
                    <label className="block text-xs font-black text-slate-500 uppercase tracking-widest mb-3">Biography</label>
                  <textarea
                    value={formData.bio}
                    onChange={(e) => setFormData({ ...formData, bio: e.target.value })}
                    rows={4}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary-500 focus:bg-white font-medium text-slate-900 transition-all"
                    placeholder="Academic biography and details..."
                  />
                </div>
                
                {/* Visibility Status */}
                <div className="col-span-2 mt-2 bg-slate-50 p-4 rounded-xl border border-slate-200">
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      id="is_active"
                      checked={formData.is_active}
                      onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                      className="w-5 h-5 rounded border-slate-300 text-primary-600 focus:ring-primary-500 focus:ring-offset-slate-50 transition-colors cursor-pointer"
                    />
                    <div>
                        <label htmlFor="is_active" className="text-sm font-bold text-slate-700 cursor-pointer">Visible to Students</label>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">When enabled, this profile will be shown in the mobile app.</p>
                    </div>
                  </div>
                </div>

              </div>
            </form>
            
            <div className="flex flex-col gap-3 p-6 bg-slate-50 border-t border-slate-100">
              {formError && (
                <div className="flex items-center gap-3 px-4 py-3 bg-red-50 border border-red-100 rounded-xl">
                  <ShieldAlert className="w-4 h-4 text-red-500 shrink-0" />
                  <p className="text-sm font-medium text-red-700">{formError}</p>
                </div>
              )}
              <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowModal(null)}
                className="px-6 py-2.5 text-slate-600 font-bold hover:bg-slate-200 rounded-xl transition-colors"
              >
                Cancel
              </button>
              <button
                key="submit-btn"
                type="submit"
                form="lecturer-form"
                disabled={isSubmitting}
                className="btn-institutional px-8 py-2.5 min-w-[160px] disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Processing...</span>
                  </>
                ) : (
                  <>
                    <Plus className="w-4 h-4" />
                    <span>{showModal === 'edit' ? 'Update Profile' : 'Add to Mobile App'}</span>
                  </>
                )}
              </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Auxiliary Photo Gallery Modal */}
      {showModal === 'photos' && selectedLecturer && (
        <div className="fixed inset-0 bg-primary-950/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between p-6 bg-slate-50 border-b border-slate-100">
              <div>
                <h2 className="text-xl font-bold tracking-tight text-slate-900">Media Gallery</h2>
                <p className="text-sm text-slate-500 font-medium">Supplementary photos for {selectedLecturer.full_name}</p>
              </div>
              <button onClick={() => setShowModal(null)} className="p-2 bg-white text-slate-400 hover:text-slate-600 rounded-xl shadow-sm border border-slate-200 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                  {/* Left Column: Upload */}
                  <div className="md:col-span-1 space-y-6">
                      <div className="bg-slate-50 p-5 rounded-xl border border-slate-200">
                        <h3 className="text-xs font-black text-primary-900 uppercase tracking-[0.25em] mb-6 flex items-center gap-3">
                    <span className="w-8 h-px bg-primary-200"></span>
                    PROFILE PHOTO
                  </h3>
                        <div className="space-y-4">
                        <FileUpload
                            accept="image/*"
                            isImage={true}
                            folder="photos"
                            onUploadComplete={(url: string) => setPhotoUrl(url)}
                            currentFileUrl={photoUrl}
                            label="Upload Image"
                        />
                        <input
                            type="text"
                            value={photoCaption}
                            onChange={(e) => setPhotoCaption(e.target.value)}
                            placeholder="Add brief caption..."
                            className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary-500 text-sm font-medium"
                        />
                        <button
                            onClick={handleAddPhoto}
                            disabled={!photoUrl || isSubmitting}
                            className="w-full btn-institutional flex justify-center py-2.5 disabled:opacity-50"
                        >
                            <Upload className="w-4 h-4 mr-2" />
                            Add to Gallery
                        </button>
                        </div>
                      </div>
                      
                      <div className="bg-primary-50 p-5 rounded-xl border border-primary-100 flex items-center gap-4">
                         <div className="w-16 h-16 rounded-xl bg-white shadow-sm flex items-center justify-center overflow-hidden border border-primary-100 flex-shrink-0">
                            {selectedLecturer.avatar_url ? (
                                <img src={selectedLecturer.avatar_url} alt="Official" className="w-full h-full object-cover" />
                            ) : (
                                <User className="w-8 h-8 text-primary-300" />
                            )}
                         </div>
                         <div>
                            <p className="text-[10px] font-bold text-primary-600 uppercase tracking-wider mb-1">Official Photo</p>
                            <p className="text-xs text-primary-800 font-medium leading-tight">Displayed natively on mobile directory.</p>
                         </div>
                      </div>
                  </div>

                  {/* Right Column: Gallery */}
                  <div className="md:col-span-2">
                    <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4">Lecturer Photos ({selectedLecturer.photos?.length || 0})</h3>
                    {selectedLecturer.photos && selectedLecturer.photos.length > 0 ? (
                        <div className="grid grid-cols-2 gap-4">
                        {selectedLecturer.photos.map((photo) => (
                            <div key={photo.id} className="relative group rounded-xl overflow-hidden border border-slate-200 shadow-sm">
                            <img
                                src={photo.url}
                                alt={photo.caption || ''}
                                className="w-full h-48 object-cover"
                            />
                            {photo.caption && (
                                <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 to-transparent pt-8 pb-3 px-4">
                                   <p className="text-white text-xs font-medium tracking-wide truncate">{photo.caption}</p>
                                </div>
                            )}
                            {/* Hover Actions */}
                            <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-3xl transition-opacity animate-in fade-in duration-500" onClick={() => setShowModal(null)}></div>
                            <div className="absolute inset-0 bg-primary-950/80 opacity-0 group-hover:opacity-100 transition-all duration-300 flex flex-col items-center justify-center gap-3 backdrop-blur-sm">
                                <button
                                onClick={() => handleSetProfilePhoto(photo.url)}
                                className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white text-xs font-bold rounded-lg border border-white/20 transition-colors w-32"
                                >
                                Set as Official
                                </button>
                                <button
                                onClick={() => handleDeletePhoto(photo.id)}
                                className="px-4 py-2 bg-red-500/80 hover:bg-red-500 text-white text-xs font-bold rounded-lg shadow-sm transition-colors w-32"
                                >
                                Delete Photo
                                </button>
                            </div>
                            </div>
                        ))}
                        </div>
                    ) : (
                        <div className="h-64 rounded-2xl border-2 border-dashed border-slate-200 flex flex-col items-center justify-center bg-slate-50 text-slate-400">
                        <ImageIcon className="w-12 h-12 mb-3 text-slate-300" />
                        <p className="font-medium tracking-wide">No photos added yet</p>
                        </div>
                    )}
                  </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

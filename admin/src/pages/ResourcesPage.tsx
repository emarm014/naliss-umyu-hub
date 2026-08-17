import { useState, useMemo, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { deleteFromCloudinary } from '../lib/cloudinaryDelete';
import { useAuthStore } from '../store/auth.store';
import { useAdminDataStore } from '../store/adminData.store';
import {
  Plus, Search, Trash2, FileText, ExternalLink, X, Eye,
  Cloud, Loader2, Video, Archive, File, CheckCircle, Database,
  HardDrive, BookOpen, HelpCircle, Megaphone, CalendarDays,
  ShieldCheck, Server, Activity, Layers, Info, AlertTriangle,
  RefreshCw, Link2,
  Link2Off, MessageSquare, Play
} from 'lucide-react';
import FileUpload from '../lib/FileUpload';
import ErrorState from '../components/ui/ErrorState';
import InstitutionalDocumentViewer from '../components/InstitutionalDocumentViewer';
import { getValidUrl, getVideoThumbnail } from '../utils/media';
import { useFormDraft } from '../hooks/useFormDraft';

interface CloudResource {
  id: string;
  title: string;
  file_url: string;
  file_size: number;
  file_type: 'document' | 'image' | 'video' | 'other';
  category: string;
  uploaded_by: string | null;
  uploader_name: string | null;
  created_at: string;
  origin_table: 'resource' | 'material' | 'past_question' | 'announcement' | 'event' | 'personnel' | 'user_avatar' | 'group_chat' | 'gallery_topic' | 'gallery_media' | 'featured_student' | 'news' | 'archive' | 'personnel_gallery' | 'group_avatar' | 'notepad';
}

// Raw Cloudinary asset (from the cloudinary-assets edge function)
interface CloudinaryAsset {
  public_id: string;
  secure_url: string;
  bytes: number;
  format: string;
  resource_type: 'image' | 'raw' | 'video';
  created_at: string;
  folder: string;
  width: number | null;
  height: number | null;
  duration: number | null;
  // Computed after cross-referencing with DB
  status?: 'in_app' | 'group_chat' | 'orphan'; // in_app = vault/news, group_chat = chat media, orphan = not in DB
  db_title?: string;
  db_origin?: string;
}

const STORAGE_LIMIT = 25 * 1024 * 1024 * 1024;

function getEffectiveType(resource: CloudResource): 'document' | 'image' | 'video' | 'other' {
  const url = resource.file_url.toLowerCase();
  if (url.match(/\.(jpg|jpeg|png|gif|webp|svg)$/)) return 'image';
  if (url.match(/\.(pdf|doc|docx|txt|xls|xlsx|ppt|pptx)$/)) return 'document';
  if (url.match(/\.(mp4|mov|avi|mp3|wav)$/)) return 'video';
  return resource.file_type || 'other';
}

function formatFileSize(bytes?: number | null) {
  if (!bytes || bytes === 0) return null;
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function getFileType(fileName: string) {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  if (['pdf', 'doc', 'docx', 'txt', 'xls', 'xlsx', 'ppt', 'pptx'].includes(ext)) return 'document';
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext)) return 'image';
  if (['mp4', 'mov', 'avi', 'mp3', 'wav'].includes(ext)) return 'video';
  return 'other';
}

const ORIGIN_LABELS: Record<string, { label: string; color: string }> = {
  resource:          { label: 'Vault',              color: 'bg-primary-100 text-primary-700' },
  material:          { label: 'Material',           color: 'bg-blue-100 text-blue-700' },
  past_question:     { label: 'Past Question',      color: 'bg-amber-100 text-amber-700' },
  announcement:      { label: 'Announcement',       color: 'bg-emerald-100 text-emerald-700' },
  event:             { label: 'Event',              color: 'bg-purple-100 text-purple-700' },
  personnel:         { label: 'Personnel',          color: 'bg-rose-100 text-rose-700' },
  user_avatar:       { label: 'User Avatar',        color: 'bg-sky-100 text-sky-700' },
  group_chat:        { label: 'Group Chat',         color: 'bg-indigo-100 text-indigo-700' },
  gallery_topic:     { label: 'Gallery Topic',      color: 'bg-teal-100 text-teal-700' },
  gallery_media:     { label: 'Gallery Media',      color: 'bg-cyan-100 text-cyan-700' },
  featured_student:  { label: 'Featured Student',   color: 'bg-yellow-100 text-yellow-700' },
  news:              { label: 'News',               color: 'bg-orange-100 text-orange-700' },
  archive:           { label: 'Archive',            color: 'bg-stone-100 text-stone-700' },
  personnel_gallery: { label: 'Personnel Gallery',  color: 'bg-pink-100 text-pink-700' },
  group_avatar:      { label: 'Group Avatar',       color: 'bg-violet-100 text-violet-700' },
  notepad:           { label: 'Notepad',             color: 'bg-lime-100 text-lime-700' },
};

export default function ResourcesPage() {
  const navigate = useNavigate();
  const { resources: storeResources, analytics, isSyncing: loading, error, syncAll, refreshAnalytics } = useAdminDataStore();
  const { profile } = useAuthStore();

  useEffect(() => {
    syncAll();
  }, [syncAll]);

  const [activeTab, setActiveTab] = useState<'all' | 'vault' | 'institutional' | 'group_chat' | 'cloudinary'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'document' | 'image' | 'video'>('all');
  const [originFilter, setOriginFilter] = useState<string>('all');
  const [showPreview, setShowPreview] = useState<{ url: string; type: string; title: string } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<CloudResource | null>(null);
  // Bulk selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [showBulkConfirm, setShowBulkConfirm] = useState(false);

  // Cloudinary Raw tab state
  const [cloudAssets, setCloudAssets] = useState<CloudinaryAsset[]>([]);
  const [cloudAssetsLoading, setCloudAssetsLoading] = useState(false);
  const [cloudAssetsError, setCloudAssetsError] = useState<string | null>(null);
  const [cloudAssetsLastFetch, setCloudAssetsLastFetch] = useState<Date | null>(null);
  const [cloudSearchQuery, setCloudSearchQuery] = useState('');
  const [cloudTypeFilter, setCloudTypeFilter] = useState<'all' | 'image' | 'raw' | 'video'>('all');
  const [cloudStatusFilter, setCloudStatusFilter] = useState<'all' | 'in_app' | 'group_chat' | 'orphan'>('all');
  const [cloudFolderFilter, setCloudFolderFilter] = useState<string>('all');
  const [selectedCloudIds, setSelectedCloudIds] = useState<Set<string>>(new Set());
  const [isDeletingCloud, setIsDeletingCloud] = useState(false);
  const [showCloudBulkConfirm, setShowCloudBulkConfirm] = useState(false);
  const [confirmDeleteCloud, setConfirmDeleteCloud] = useState<CloudinaryAsset | null>(null);

  const { showModal: showUploadModal, setShowModal: setShowUploadModalRaw, formData, setFormData, clearDraft } = useFormDraft('resources_draft', {
    title: '',
    description: '',
    file_url: '',
    file_size: 0,
    file_type: '',
    category: 'general',
    batch_files: [] as Array<{ url: string; size: number; name: string; type: string }>
  });
  
  const setShowUploadModal = (show: boolean) => setShowUploadModalRaw(show ? 'create' : null);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = () => {};
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, []);

  // Declared early so fetchCloudinaryAssets useCallback can reference it
  const allResources = storeResources as unknown as CloudResource[];

  // ── Fetch all Cloudinary assets and cross-reference with DB ──────────────
  const fetchCloudinaryAssets = useCallback(async () => {
    setCloudAssetsLoading(true);
    setCloudAssetsError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setCloudAssetsError('Not authenticated.'); return; }

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/cloudinary-assets`,
        { headers: { Authorization: `Bearer ${session.access_token}` } }
      );
      const data = await res.json();
      if (!res.ok) { setCloudAssetsError(data?.error || 'Failed to fetch Cloudinary assets.'); return; }

      // Fetch latest DB records directly to bypass 5-min store cache
      const { data: dbData, error: dbError } = await supabase.from('cloud_archive').select('file_url, title, origin_table').limit(10000);
      const freshResources = dbError ? allResources : (dbData || []);
      const dbUrls = new Set(freshResources.map(r => r.file_url));

      // Cross-reference: mark each asset as in_app, group_chat or orphan
      const enriched: CloudinaryAsset[] = (data.assets || []).map((asset: CloudinaryAsset) => {
        const matchingDb = freshResources.find(r => r.file_url === asset.secure_url || r.file_url.includes(asset.public_id));
        const inDb = dbUrls.has(asset.secure_url) || !!matchingDb;
        const isGroupChat = matchingDb?.origin_table === 'group_chat';
        return {
          ...asset,
          status: inDb ? (isGroupChat ? 'group_chat' : 'in_app') : 'orphan',
          db_title: matchingDb?.title,
          db_origin: matchingDb?.origin_table,
        };
      });

      setCloudAssets(enriched);
      setCloudAssetsLastFetch(new Date());
    } catch {
      setCloudAssetsError('Could not load Cloudinary assets. Check your API credentials.');
    } finally {
      setCloudAssetsLoading(false);
    }
  }, [allResources]);

  // Auto-fetch when switching to Cloudinary tab
  useEffect(() => {
    if (activeTab === 'cloudinary' && cloudAssets.length === 0 && !cloudAssetsLoading) {
      fetchCloudinaryAssets();
    }
  }, [activeTab, cloudAssets.length, cloudAssetsLoading, fetchCloudinaryAssets]);

  // ── Delete a single Cloudinary asset directly ────────────────────────────
  const handleDeleteCloudAsset = async (asset: CloudinaryAsset) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      // Optimistic remove from UI immediately
      setCloudAssets(prev => prev.filter(a => a.public_id !== asset.public_id));
      setConfirmDeleteCloud(null);

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/cloudinary-assets`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ public_id: asset.public_id, resource_type: asset.resource_type }),
        }
      );
      const data = await res.json();
      const deleted = data.results?.[0]?.ok ?? false;

      if (deleted) {
        setSuccessMessage(`"${asset.public_id.split('/').pop()}" permanently deleted from Cloudinary. Storage freed.`);
      } else {
        // Put it back if deletion failed
        setCloudAssets(prev => [asset, ...prev]);
        setSuccessMessage(`Delete failed: ${data.results?.[0]?.result || 'unknown error'}`);
      }
      setTimeout(() => setSuccessMessage(null), 5000);
    } catch {
      setCloudAssets(prev => [asset, ...prev]);
      setSuccessMessage('Delete failed. Please try again.');
      setTimeout(() => setSuccessMessage(null), 4000);
    }
  };

  // ── Bulk delete Cloudinary assets ────────────────────────────────────────
  const handleBulkDeleteCloud = async () => {
    if (selectedCloudIds.size === 0) return;
    setIsDeletingCloud(true);
    setShowCloudBulkConfirm(false);

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setIsDeletingCloud(false); return; }

    const toDelete = cloudAssets.filter(a => selectedCloudIds.has(a.public_id));

    // Optimistic remove
    setCloudAssets(prev => prev.filter(a => !selectedCloudIds.has(a.public_id)));
    setSelectedCloudIds(new Set());

    try {
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/cloudinary-assets`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            assets: toDelete.map(a => ({ public_id: a.public_id, resource_type: a.resource_type }))
          }),
        }
      );
      const data = await res.json();
      const succeeded = (data.results || []).filter((r: any) => r.ok).length;
      const failed = toDelete.length - succeeded;

      if (failed > 0) {
        // Re-add failed ones back
        const failedIds = new Set((data.results || []).filter((r: any) => !r.ok).map((r: any) => r.public_id));
        const failedAssets = toDelete.filter(a => failedIds.has(a.public_id));
        setCloudAssets(prev => [...failedAssets, ...prev]);
        setSuccessMessage(`${succeeded} deleted from Cloudinary. ${failed} failed — check Cloudinary credentials.`);
      } else {
        setSuccessMessage(`${succeeded} asset${succeeded !== 1 ? 's' : ''} permanently deleted from Cloudinary. Storage freed.`);
      }
    } catch {
      // Restore all on network error
      setCloudAssets(prev => [...toDelete, ...prev]);
      setSuccessMessage('Bulk delete failed. Please try again.');
    }

    setIsDeletingCloud(false);
    setTimeout(() => setSuccessMessage(null), 6000);
  };

  const filteredResources = useMemo(() => {
    return allResources.filter(r => {
      const isVault = r.origin_table === 'resource';
      if (activeTab === 'vault' && !isVault) return false;
      if (activeTab === 'institutional' && (isVault || r.origin_table === 'group_chat')) return false;
      if (activeTab === 'group_chat' && r.origin_table !== 'group_chat') return false;
      if (originFilter !== 'all' && r.origin_table !== originFilter) return false;
      if (typeFilter !== 'all' && getEffectiveType(r) !== typeFilter) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        if (!r.title.toLowerCase().includes(q) && !r.origin_table.includes(q)) return false;
      }
      return true;
    });
  }, [allResources, activeTab, typeFilter, originFilter, searchQuery]);

  const stats = useMemo(() => {
    const vault = allResources.filter(r => r.origin_table === 'resource');
    const groupChat = allResources.filter(r => r.origin_table === 'group_chat');
    const institutional = allResources.filter(r => r.origin_table !== 'resource' && r.origin_table !== 'group_chat');
    // Use Cloudinary real storage if cloudAssets have been loaded (sum of all asset bytes)
    // Otherwise fall back to DB file_size sum
    const cloudinaryTotal = cloudAssets.length > 0
      ? cloudAssets.reduce((s, a) => s + (a.bytes || 0), 0)
      : null;
    const totalStorage = cloudinaryTotal ?? analytics?.storage?.total ?? allResources.reduce((s, r) => s + (r.file_size || 0), 0);
    return { vaultCount: vault.length, institutionalCount: institutional.length, groupChatCount: groupChat.length, totalStorage };
  }, [allResources, analytics, cloudAssets]);

  const usagePct = Math.min((stats.totalStorage / STORAGE_LIMIT) * 100, 100);

  // ── Cloudinary filtered assets ────────────────────────────────────────────
  const cloudFolders = useMemo(() => {
    const folders = new Set(cloudAssets.map(a => a.folder || 'root'));
    return ['all', ...Array.from(folders).sort()];
  }, [cloudAssets]);

  const filteredCloudAssets = useMemo(() => {
    return cloudAssets.filter(a => {
      if (cloudTypeFilter !== 'all' && a.resource_type !== cloudTypeFilter) return false;
      if (cloudStatusFilter !== 'all' && a.status !== cloudStatusFilter) return false;
      if (cloudFolderFilter !== 'all' && a.folder !== cloudFolderFilter) return false;
      if (cloudSearchQuery) {
        const q = cloudSearchQuery.toLowerCase();
        if (!a.public_id.toLowerCase().includes(q) && !(a.db_title || '').toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [cloudAssets, cloudTypeFilter, cloudStatusFilter, cloudFolderFilter, cloudSearchQuery]);

  const cloudStats = useMemo(() => ({
    total: cloudAssets.length,
    inApp: cloudAssets.filter(a => a.status === 'in_app').length,
    groupChat: cloudAssets.filter(a => a.status === 'group_chat').length,
    orphan: cloudAssets.filter(a => a.status === 'orphan').length,
    totalBytes: cloudAssets.reduce((s, a) => s + a.bytes, 0),
  }), [cloudAssets]);

  const handlePushTo = (path: string, resource: CloudResource) => {
    navigate(path, {
      state: {
        predefinedAsset: {
          title: resource.title,
          url: resource.file_url,
          size: resource.file_size,
          type: getEffectiveType(resource),
        },
      },
    });
  };

  const handlePreview = (resource: CloudResource) => {
    const url = resource.file_url;
    let corrected = url;
    const isWordOrPdf = url.toLowerCase().match(/\.(doc|docx|xls|xlsx|ppt|pptx|pdf)$/);
    if (isWordOrPdf && url.includes('/image/upload/')) {
      corrected = url.replace('/image/upload/', '/raw/upload/');
    }
    setShowPreview({ url: corrected, type: getEffectiveType(resource), title: resource.title });
  };

  const handleDelete = async (resource: CloudResource) => {
    const tableMap: Record<string, string> = {
      resource: 'resources', material: 'materials', past_question: 'past_questions',
      announcement: 'announcements', event: 'events',
    };
    const table = tableMap[resource.origin_table];
    if (!table) return;
    try {
      // Delete from DB first — if this fails, Cloudinary file is preserved
      const { error } = await supabase.from(table).delete().eq('id', resource.id);
      if (error) throw error;
      // Only clean Cloudinary after DB confirms
      deleteFromCloudinary([resource.file_url]);
      setSuccessMessage(`"${resource.title}" removed successfully.`);
      setConfirmDelete(null);
      refreshAnalytics();
      setTimeout(() => setSuccessMessage(null), 4000);
    } catch (err: unknown) {
      setSuccessMessage('Delete failed: ' + ((err as any)?.message || 'Unknown error'));
      setTimeout(() => setSuccessMessage(null), 4000);
    }
  };

  // Bulk delete selected items
  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    setIsBulkDeleting(true);
    setShowBulkConfirm(false);

    const tableMap: Record<string, string> = {
      resource: 'resources', material: 'materials', past_question: 'past_questions',
      announcement: 'announcements', event: 'events',
    };

    const toDelete = filteredResources.filter(r => selectedIds.has(r.id));
    const urlsToClean: string[] = [];

    for (const resource of toDelete) {
      const table = tableMap[resource.origin_table];
      if (!table) continue;
      try {
        const { error } = await supabase.from(table).delete().eq('id', resource.id);
        if (!error) urlsToClean.push(resource.file_url);
      } catch { /* continue */ }
    }

    // Bulk Cloudinary cleanup
    deleteFromCloudinary(urlsToClean);

    setSelectedIds(new Set());
    setIsBulkDeleting(false);
    setSuccessMessage(`${urlsToClean.length} file${urlsToClean.length !== 1 ? 's' : ''} deleted successfully.`);
    refreshAnalytics();
    setTimeout(() => setSuccessMessage(null), 5000);
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedIds.size === filteredResources.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredResources.map(r => r.id)));
    }
  };

  const handleArchive = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const hasBatch = formData.batch_files && formData.batch_files.length > 0;
    if ((!formData.file_url && !hasBatch) || !formData.title) return;
    
    setIsSubmitting(true);
    setArchiveError(null);
    try {
      if (hasBatch) {
          const inserts = formData.batch_files.map((f: any, i: number) => ({
              title: formData.batch_files.length > 1 && !formData.title.includes(f.name)
                  ? `${formData.title} (${i + 1})`
                  : formData.title || f.name,
              file_url: f.url,
              file_size: f.size,
              file_type: formData.file_type || f.type || getFileType(f.url),
              category: formData.category,
              uploaded_by: profile?.id,
          }));
          const { data: insertedList, error } = await supabase.from('resources').insert(inserts).select('*');
          if (error) throw error;
          if (insertedList) {
              insertedList.forEach(item => useAdminDataStore.getState().updateResource(item as any));
          }
      } else {
          const { data: inserted, error } = await supabase.from('resources').insert({
            title: formData.title,
            file_url: formData.file_url,
            file_size: formData.file_size,
            file_type: formData.file_type || getFileType(formData.file_url),
            category: formData.category,
            uploaded_by: profile?.id,
          }).select('*').single();
          if (error) throw error;
          if (inserted) useAdminDataStore.getState().updateResource(inserted as any);
      }
      
      setSuccessMessage('File(s) archived to vault successfully.');
      if (showUploadModal === 'create') clearDraft();
      else setShowUploadModal(false);
      setFormData({ title: '', description: '', file_url: '', file_size: 0, file_type: '', category: 'general', batch_files: [] });
      setTimeout(() => setSuccessMessage(null), 4000);
    } catch (err: unknown) {
      setArchiveError((err as any)?.message || 'Archive failed. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-8 pb-16">
      {/* Success toast */}
      {successMessage && (
        <div className="fixed top-6 right-6 z-[200] bg-primary-950 text-white px-6 py-4 rounded-2xl shadow-2xl flex items-center gap-4 animate-in slide-in-from-right-8 duration-300 border border-white/10">
          <CheckCircle className="w-5 h-5 text-green-400 shrink-0" />
          <p className="text-sm font-bold">{successMessage}</p>
          <button onClick={() => setSuccessMessage(null)} className="ml-2 text-white/40 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Header */}
      <div className="bg-primary-950 rounded-[2.5rem] p-10 text-white relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-primary-400/5 rounded-full blur-[100px] -mr-32 -mt-32 pointer-events-none" />
        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-10">
          <div>
            <div className="flex items-center gap-3 mb-5">
              <div className="px-3 py-1.5 bg-primary-400/20 border border-primary-300/30 rounded-xl flex items-center gap-2">
                <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-primary-300">Cloud Archive Active</span>
              </div>
            </div>
            <h1 className="text-4xl lg:text-6xl font-black leading-tight tracking-tight">
              Institutional<br />
              <span className="text-primary-400">Library.</span>
            </h1>
            <p className="text-primary-100/40 mt-4 text-base font-medium max-w-sm leading-relaxed">
              Every file uploaded to NALISS is indexed here. Store files in the vault and push them to the mobile app when ready — no re-uploading needed.
            </p>
            <div className="flex flex-wrap items-center gap-4 mt-8">
              <button
                onClick={() => { setActiveTab('vault'); setShowUploadModal(true); }}
                className="inline-flex items-center px-8 py-4 bg-white text-primary-950 rounded-2xl hover:bg-primary-400 transition-all shadow-xl font-black text-xs uppercase tracking-widest active:scale-95"
              >
                <Plus className="h-5 w-5 mr-2" />
                Upload to Vault
              </button>
              <div className="flex items-center gap-3 px-6 py-4 bg-white/5 rounded-2xl border border-white/10">
                <ShieldCheck className="w-5 h-5 text-emerald-400" />
                <div>
                  <p className="text-[10px] font-black text-white uppercase tracking-widest">{stats.vaultCount} Vault Files</p>
                  <p className="text-[9px] font-bold text-white/30 uppercase">Ready to push</p>
                </div>
              </div>
            </div>
          </div>

          {/* Storage meter */}
          <div className="w-full lg:max-w-xs p-8 bg-white/5 rounded-3xl border border-white/10">
            <div className="flex items-center justify-between mb-4">
              <span className="text-[10px] font-black text-white/30 uppercase tracking-widest flex items-center gap-2">
                <HardDrive className="w-4 h-4" /> Storage
              </span>
              <span className="text-[10px] font-black text-primary-400">{usagePct.toFixed(1)}%</span>
            </div>
            <div className="text-3xl font-black mb-2 tabular-nums">
              {formatFileSize(stats.totalStorage) || '0 B'}
            </div>
            <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden mb-6">
              <div
                className="h-full bg-gradient-to-r from-primary-400 to-emerald-400 rounded-full transition-all duration-700"
                style={{ width: `${usagePct}%` }}
              />
            </div>
            <div className="space-y-2 text-[10px] font-bold text-white/40 uppercase tracking-widest">
              <div className="flex justify-between">
                <span>Total files</span>
                <span className="text-white">{allResources.length}</span>
              </div>
              <div className="flex justify-between">
                <span>Vault (private)</span>
                <span className="text-white">{stats.vaultCount}</span>
              </div>
              <div className="flex justify-between">
                <span>Live in app</span>
                <span className="text-white">{stats.institutionalCount}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs + Filters */}
      <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 space-y-5">
        {/* Tab switcher + bulk controls */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex p-1.5 bg-gray-100 rounded-2xl w-fit gap-1">
            <button
              onClick={() => { setActiveTab('all'); setSelectedIds(new Set()); }}
              className={`flex items-center gap-2.5 px-5 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                activeTab === 'all' ? 'bg-primary-950 text-white shadow-md' : 'text-gray-400 hover:text-gray-600'
              }`}
            >
              <Cloud className="w-4 h-4" />
              All Media
              <span className={`px-2 py-0.5 rounded-lg text-[8px] font-black ${activeTab === 'all' ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-500'}`}>
                {allResources.length}
              </span>
            </button>
            <button
              onClick={() => { setActiveTab('vault'); setSelectedIds(new Set()); }}
              className={`flex items-center gap-2.5 px-5 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                activeTab === 'vault' ? 'bg-white text-primary-950 shadow-md' : 'text-gray-400 hover:text-gray-600'
              }`}
            >
              <Server className="w-4 h-4" />
              Vault
              <span className={`px-2 py-0.5 rounded-lg text-[8px] font-black ${activeTab === 'vault' ? 'bg-primary-100 text-primary-700' : 'bg-gray-200 text-gray-500'}`}>
                {stats.vaultCount}
              </span>
            </button>
            <button
              onClick={() => { setActiveTab('institutional'); setSelectedIds(new Set()); }}
              className={`flex items-center gap-2.5 px-5 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                activeTab === 'institutional' ? 'bg-white text-primary-950 shadow-md' : 'text-gray-400 hover:text-gray-600'
              }`}
            >
              <Layers className="w-4 h-4" />
              Live in App
              <span className={`px-2 py-0.5 rounded-lg text-[8px] font-black ${activeTab === 'institutional' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-200 text-gray-500'}`}>
                {stats.institutionalCount}
              </span>
            </button>
            <button
              onClick={() => { setActiveTab('group_chat'); setSelectedIds(new Set()); }}
              className={`flex items-center gap-2.5 px-5 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                activeTab === 'group_chat' ? 'bg-white text-primary-950 shadow-md' : 'text-gray-400 hover:text-gray-600'
              }`}
            >
              <MessageSquare className="w-4 h-4" />
              Group Chats
              <span className={`px-2 py-0.5 rounded-lg text-[8px] font-black ${activeTab === 'group_chat' ? 'bg-blue-100 text-blue-700' : 'bg-gray-200 text-gray-500'}`}>
                {stats.groupChatCount}
              </span>
            </button>
            <button
              onClick={() => { setActiveTab('cloudinary'); setSelectedIds(new Set()); setSelectedCloudIds(new Set()); }}
              className={`flex items-center gap-2.5 px-5 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                activeTab === 'cloudinary' ? 'bg-white text-primary-950 shadow-md' : 'text-gray-400 hover:text-gray-600'
              }`}
            >
              <Cloud className="w-4 h-4" />
              Cloudinary Raw
              {cloudAssets.length > 0 && (
                <span className={`px-2 py-0.5 rounded-lg text-[8px] font-black ${activeTab === 'cloudinary' ? 'bg-primary-100 text-primary-700' : 'bg-gray-200 text-gray-500'}`}>
                  {cloudAssets.length}
                </span>
              )}
              {cloudStats.orphan > 0 && (
                <span className="px-2 py-0.5 rounded-lg text-[8px] font-black bg-amber-100 text-amber-700">
                  {cloudStats.orphan} orphan
                </span>
              )}
            </button>
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-300" />
            <input
              type="text"
              placeholder="Search files..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-11 pr-4 py-3 bg-gray-50 border-none rounded-xl text-sm font-semibold focus:ring-2 focus:ring-primary-950 w-72 shadow-inner"
            />
          </div>
        </div>

        {/* Filters row */}
        <div className="flex items-center gap-2 flex-wrap">
          {(['all', 'document', 'image', 'video'] as const).map((t) => (
            <button key={t} onClick={() => setTypeFilter(t)}
              className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                typeFilter === t ? 'bg-primary-950 text-white shadow-lg' : 'bg-gray-50 text-gray-400 hover:bg-gray-100'
              }`}>
              {t === 'all' ? 'All Types' : t}
            </button>
          ))}
          {/* Origin filter */}
          <select
            value={originFilter}
            onChange={e => setOriginFilter(e.target.value)}
            className="px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest bg-gray-50 text-gray-500 border-none focus:ring-2 focus:ring-primary-950 appearance-none cursor-pointer"
          >
            <option value="all">All Sources</option>
            {Object.entries(ORIGIN_LABELS).map(([key, { label }]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>

          <div className="ml-auto flex items-center gap-3">
            <span className="text-[10px] font-black text-gray-300 uppercase tracking-widest flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5 text-emerald-500 animate-pulse" />
              {filteredResources.length} files
            </span>
          </div>
        </div>

        {/* Bulk action bar — shown when items are selected */}
        {selectedIds.size > 0 && (
          <div className="flex items-center justify-between px-5 py-4 bg-red-50 border border-red-100 rounded-2xl animate-in slide-in-from-top-2 duration-300">
            <div className="flex items-center gap-4">
              <button onClick={selectAll}
                className="flex items-center gap-2 text-xs font-black text-red-700 hover:text-red-900 transition-colors">
                <div className={`w-5 h-5 rounded border-2 border-red-400 flex items-center justify-center ${selectedIds.size === filteredResources.length ? 'bg-red-500 border-red-500' : ''}`}>
                  {selectedIds.size === filteredResources.length && <X className="w-3 h-3 text-white" />}
                </div>
                {selectedIds.size === filteredResources.length ? 'Deselect All' : 'Select All'}
              </button>
              <span className="text-xs font-black text-red-700">
                {selectedIds.size} file{selectedIds.size !== 1 ? 's' : ''} selected
              </span>
            </div>
            <div className="flex items-center gap-3">
              <button onClick={() => setSelectedIds(new Set())}
                className="px-4 py-2 text-[10px] font-black text-gray-500 hover:text-gray-700 uppercase tracking-widest transition-colors">
                Cancel
              </button>
              <button
                onClick={() => setShowBulkConfirm(true)}
                disabled={isBulkDeleting}
                className="flex items-center gap-2 px-5 py-2.5 bg-red-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-red-700 disabled:opacity-50 transition-all shadow-lg shadow-red-600/20"
              >
                {isBulkDeleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                Delete {selectedIds.size} Selected
              </button>
            </div>
          </div>
        )}

        {/* Select all row when nothing selected */}
        {selectedIds.size === 0 && filteredResources.length > 0 && (
          <div className="flex items-center gap-3">
            <button onClick={selectAll}
              className="flex items-center gap-2 text-[10px] font-black text-gray-400 hover:text-primary-700 uppercase tracking-widest transition-colors">
              <div className="w-4 h-4 rounded border-2 border-gray-300" />
              Select All ({filteredResources.length})
            </button>
          </div>
        )}

        {/* Info banners */}
        {activeTab === 'vault' && (
          <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-100 rounded-2xl text-amber-800 text-xs font-semibold">
            <Info className="w-4 h-4 shrink-0 mt-0.5 text-amber-500" />
            <span>Files in the <strong>Admin Vault</strong> are stored privately. Use <strong>Push to App</strong> to publish them without re-uploading.</span>
          </div>
        )}
        {activeTab === 'group_chat' && (
          <div className="flex items-start gap-3 p-4 bg-blue-50 border border-blue-100 rounded-2xl text-blue-800 text-xs font-semibold">
            <MessageSquare className="w-4 h-4 shrink-0 mt-0.5 text-blue-500" />
            <span>These are media files shared within <strong>Group Chats</strong>. They are live in the app. Deleting removes them from the chat completely.</span>
          </div>
        )}
        {activeTab === 'institutional' && (
          <div className="flex items-start gap-3 p-4 bg-emerald-50 border border-emerald-100 rounded-2xl text-emerald-800 text-xs font-semibold">
            <CheckCircle className="w-4 h-4 shrink-0 mt-0.5 text-emerald-500" />
            <span>These files are <strong>currently live</strong> in the mobile app. Deleting removes them from the source page and Cloudinary.</span>
          </div>
        )}
        {activeTab === 'all' && (
          <div className="flex items-start gap-3 p-4 bg-primary-50 border border-primary-100 rounded-2xl text-primary-800 text-xs font-semibold">
            <Cloud className="w-4 h-4 shrink-0 mt-0.5 text-primary-500" />
            <span>All media uploaded to Cloudinary across every section. Select files and use <strong>Delete Selected</strong> to remove them from both the app and Cloudinary storage.</span>
          </div>
        )}
        {activeTab === 'cloudinary' && (
          <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-100 rounded-2xl text-amber-800 text-xs font-semibold">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-500" />
            <span>
              <strong>Direct Cloudinary view</strong> — every file stored on your Cloudinary account.
              <span className="inline-flex items-center gap-1 ml-2 px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-md text-[9px] font-black uppercase"><Link2 className="w-3 h-3" /> In App</span> = linked to admin/mobile.
              <span className="inline-flex items-center gap-1 ml-2 px-2 py-0.5 bg-blue-100 text-blue-700 rounded-md text-[9px] font-black uppercase"><MessageSquare className="w-3 h-3" /> Chat</span> = in group chats.
              <span className="inline-flex items-center gap-1 ml-2 px-2 py-0.5 bg-amber-100 text-amber-700 rounded-md text-[9px] font-black uppercase"><Link2Off className="w-3 h-3" /> Orphan</span> = on Cloudinary only, not in any page.
              Deleting here removes the file from Cloudinary permanently.
            </span>
          </div>
        )}
      </div>

      {/* ── CLOUDINARY RAW TAB ─────────────────────────────────────────────── */}
      {activeTab === 'cloudinary' && (
        <div className="space-y-6">
          {/* Stats bar */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            {[
              { label: 'Total on Cloudinary', value: cloudStats.total, color: 'bg-primary-950 text-white', icon: Cloud },
              { label: 'Linked to App', value: cloudStats.inApp, color: 'bg-emerald-50 text-emerald-700 border border-emerald-100', icon: Link2 },
              { label: 'Group Chats', value: cloudStats.groupChat, color: 'bg-blue-50 text-blue-700 border border-blue-100', icon: MessageSquare },
              { label: 'Orphaned (unused)', value: cloudStats.orphan, color: 'bg-amber-50 text-amber-700 border border-amber-100', icon: Link2Off },
              { label: 'Total Size', value: formatFileSize(cloudStats.totalBytes) || '0 B', color: 'bg-gray-50 text-gray-700 border border-gray-100', icon: HardDrive },
            ].map(({ label, value, color, icon: Icon }) => (
              <div key={label} className={`p-5 rounded-2xl flex items-center gap-4 ${color}`}>
                <Icon className="w-5 h-5 shrink-0 opacity-70" />
                <div>
                  <p className="text-[9px] font-black uppercase tracking-widest opacity-60">{label}</p>
                  <p className="text-xl font-black">{value}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Filters */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300" />
              <input
                type="text"
                placeholder="Search by public_id or title..."
                value={cloudSearchQuery}
                onChange={e => setCloudSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border-none rounded-xl text-sm font-semibold focus:ring-2 focus:ring-primary-950"
              />
            </div>
            {/* Type filter */}
            {(['all', 'image', 'raw', 'video'] as const).map(t => (
              <button key={t} onClick={() => setCloudTypeFilter(t)}
                className={`px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${cloudTypeFilter === t ? 'bg-primary-950 text-white' : 'bg-gray-50 text-gray-400 hover:bg-gray-100'}`}>
                {t === 'all' ? 'All Types' : t === 'raw' ? 'Docs/Raw' : t}
              </button>
            ))}
            {/* Status filter */}
            {(['all', 'in_app', 'group_chat', 'orphan'] as const).map(s => (
              <button key={s} onClick={() => setCloudStatusFilter(s)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                  cloudStatusFilter === s
                    ? s === 'orphan' ? 'bg-amber-500 text-white' : s === 'in_app' ? 'bg-emerald-600 text-white' : s === 'group_chat' ? 'bg-blue-500 text-white' : 'bg-primary-950 text-white'
                    : 'bg-gray-50 text-gray-400 hover:bg-gray-100'
                }`}>
                {s === 'in_app' ? <><Link2 className="w-3 h-3" /> In App</> : s === 'orphan' ? <><Link2Off className="w-3 h-3" /> Orphan</> : s === 'group_chat' ? <><MessageSquare className="w-3 h-3" /> Chat</> : 'All Status'}
              </button>
            ))}
            {/* Folder filter */}
            <select value={cloudFolderFilter} onChange={e => setCloudFolderFilter(e.target.value)}
              className="px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest bg-gray-50 text-gray-500 border-none focus:ring-2 focus:ring-primary-950 appearance-none cursor-pointer">
              {cloudFolders.map(f => <option key={f} value={f}>{f === 'all' ? 'All Folders' : f}</option>)}
            </select>
            <button onClick={fetchCloudinaryAssets} disabled={cloudAssetsLoading}
              className="flex items-center gap-2 px-4 py-2 bg-primary-950 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-primary-800 disabled:opacity-50 transition-all ml-auto">
              <RefreshCw className={`w-3.5 h-3.5 ${cloudAssetsLoading ? 'animate-spin' : ''}`} />
              {cloudAssetsLoading ? 'Loading...' : 'Refresh'}
            </button>
          </div>

          {/* Bulk action bar */}
          {selectedCloudIds.size > 0 && (
            <div className="flex items-center justify-between px-5 py-4 bg-red-50 border border-red-100 rounded-2xl animate-in slide-in-from-top-2 duration-300">
              <div className="flex items-center gap-4">
                {/* Select All / Deselect All toggle */}
                <button
                  onClick={() => {
                    if (selectedCloudIds.size === filteredCloudAssets.length) {
                      setSelectedCloudIds(new Set());
                    } else {
                      setSelectedCloudIds(new Set(filteredCloudAssets.map(a => a.public_id)));
                    }
                  }}
                  className="flex items-center gap-2 text-xs font-black text-red-700 hover:text-red-900 transition-colors"
                >
                  <div className={`w-5 h-5 rounded border-2 border-red-400 flex items-center justify-center ${selectedCloudIds.size === filteredCloudAssets.length ? 'bg-red-500 border-red-500' : ''}`}>
                    {selectedCloudIds.size === filteredCloudAssets.length && <X className="w-3 h-3 text-white" />}
                  </div>
                  {selectedCloudIds.size === filteredCloudAssets.length ? 'Deselect All' : `Select All (${filteredCloudAssets.length})`}
                </button>
                <span className="text-xs font-black text-red-700">
                  {selectedCloudIds.size} asset{selectedCloudIds.size !== 1 ? 's' : ''} selected
                </span>
              </div>
              <div className="flex items-center gap-3">
                <button onClick={() => setSelectedCloudIds(new Set())} className="px-4 py-2 text-[10px] font-black text-gray-500 uppercase tracking-widest">Cancel</button>
                <button onClick={() => setShowCloudBulkConfirm(true)} disabled={isDeletingCloud}
                  className="flex items-center gap-2 px-5 py-2.5 bg-red-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-red-700 disabled:opacity-50 transition-all shadow-lg">
                  {isDeletingCloud ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                  Delete {selectedCloudIds.size} from Cloudinary
                </button>
              </div>
            </div>
          )}

          {/* Select All row when nothing selected yet */}
          {selectedCloudIds.size === 0 && filteredCloudAssets.length > 0 && !cloudAssetsLoading && (
            <div className="flex items-center gap-3">
              <button
                onClick={() => setSelectedCloudIds(new Set(filteredCloudAssets.map(a => a.public_id)))}
                className="flex items-center gap-2 text-[10px] font-black text-gray-400 hover:text-red-600 uppercase tracking-widest transition-colors"
              >
                <div className="w-4 h-4 rounded border-2 border-gray-300 hover:border-red-400 transition-colors" />
                Select All ({filteredCloudAssets.length})
              </button>
              {cloudStats.orphan > 0 && (
                <button
                  onClick={() => setSelectedCloudIds(new Set(filteredCloudAssets.filter(a => a.status === 'orphan').map(a => a.public_id)))}
                  className="flex items-center gap-2 text-[10px] font-black text-amber-500 hover:text-amber-700 uppercase tracking-widest transition-colors"
                >
                  <Link2Off className="w-3.5 h-3.5" />
                  Select All Orphans ({filteredCloudAssets.filter(a => a.status === 'orphan').length})
                </button>
              )}
            </div>
          )}

          {/* Asset grid */}
          {cloudAssetsLoading && cloudAssets.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-32 text-gray-300">
              <Loader2 className="w-12 h-12 animate-spin mb-6 text-primary-200" />
              <span className="font-black text-[10px] uppercase tracking-widest animate-pulse">Fetching all Cloudinary assets...</span>
            </div>
          ) : cloudAssetsError ? (
            <div className="flex items-center gap-4 p-5 bg-red-50 border border-red-100 rounded-2xl">
              <AlertTriangle className="w-5 h-5 text-red-500 shrink-0" />
              <p className="text-sm font-bold text-red-700">{cloudAssetsError}</p>
              <button onClick={fetchCloudinaryAssets} className="ml-auto px-4 py-2 bg-red-600 text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-red-700">Retry</button>
            </div>
          ) : filteredCloudAssets.length === 0 ? (
            <div className="bg-gray-50 rounded-3xl p-20 text-center border-2 border-dashed border-gray-100">
              <Cloud className="h-14 w-14 text-gray-200 mx-auto mb-4" />
              <p className="font-black text-gray-400 uppercase tracking-widest text-sm">No assets match your filters</p>
              {cloudAssetsLastFetch && <p className="text-xs text-gray-300 mt-2">Last fetched: {cloudAssetsLastFetch.toLocaleTimeString()}</p>}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
              {filteredCloudAssets.map(asset => {
                const isOrphan = asset.status === 'orphan';
                const isGroupChat = asset.status === 'group_chat';
                const isImage = asset.resource_type === 'image';
                const isVideo = asset.resource_type === 'video';
                const fileName = asset.public_id.split('/').pop() || asset.public_id;
                const isSelected = selectedCloudIds.has(asset.public_id);

                return (
                  <div key={asset.public_id}
                    className={`group bg-white rounded-3xl border shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 overflow-hidden flex flex-col ${
                      isSelected ? 'border-red-300 ring-2 ring-red-200' : isOrphan ? 'border-amber-200' : isGroupChat ? 'border-blue-200' : 'border-gray-100'
                    }`}
                  >
                    {/* Color bar */}
                    <div className={`h-1.5 w-full ${isImage ? 'bg-amber-400' : isVideo ? 'bg-emerald-500' : 'bg-blue-500'}`} />

                    {/* Media Thumbnail */}
                    <div className="h-32 bg-gray-50 overflow-hidden relative group-hover:opacity-90 transition-opacity">
                      {isImage ? (
                        <img src={getValidUrl(asset.secure_url)} alt={fileName} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" loading="lazy" />
                      ) : isVideo ? (
                        <div className="w-full h-full relative bg-purple-50">
                          <img src={getVideoThumbnail(getValidUrl(asset.secure_url))} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" loading="lazy" />
                          <div className="absolute inset-0 flex items-center justify-center bg-black/10">
                            <div className="w-10 h-10 bg-purple-600/90 rounded-full flex items-center justify-center shadow-lg"><Play className="w-4 h-4 text-white ml-1" /></div>
                          </div>
                        </div>
                      ) : (
                         <div className="w-full h-full flex items-center justify-center bg-blue-50/50"><FileText className="w-10 h-10 text-blue-300 group-hover:scale-110 transition-transform duration-300" /></div>
                      )}
                      
                      {/* Status badge overlay */}
                      <div className={`absolute top-2 right-2 flex items-center gap-1 px-2 py-1 rounded-lg text-[9px] font-black uppercase ${
                        isOrphan ? 'bg-amber-500 text-white' : isGroupChat ? 'bg-blue-500 text-white' : 'bg-emerald-500 text-white'
                      }`}>
                        {isOrphan ? <Link2Off className="w-3 h-3" /> : isGroupChat ? <MessageSquare className="w-3 h-3" /> : <Link2 className="w-3 h-3" />}
                        {isOrphan ? 'Orphan' : isGroupChat ? 'Chat' : 'In App'}
                      </div>
                    </div>

                    <div className="p-5 flex flex-col flex-1 gap-3">
                      {/* Header row */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          {/* Checkbox */}
                          <button onClick={() => setSelectedCloudIds(prev => { const n = new Set(prev); if (n.has(asset.public_id)) { n.delete(asset.public_id); } else { n.add(asset.public_id); } return n; })}
                            className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-all ${isSelected ? 'bg-red-500 border-red-500' : 'border-gray-300 hover:border-red-400'}`}>
                            {isSelected && <X className="w-3 h-3 text-white" />}
                          </button>
                        </div>
                      </div>

                      {/* File info */}
                      <div className="flex-1">
                        <p className="font-black text-gray-900 text-xs leading-tight line-clamp-2 break-all">
                          {asset.db_title || fileName}
                        </p>
                        {asset.db_title && (
                          <p className="text-[9px] text-gray-400 font-bold mt-0.5 truncate">{fileName}</p>
                        )}
                        <div className="flex flex-wrap items-center gap-2 mt-2">
                          <span className="text-[9px] font-bold text-gray-400">{formatFileSize(asset.bytes) || '—'}</span>
                          <span className="text-gray-200">·</span>
                          <span className="text-[9px] font-bold text-gray-400 uppercase">{asset.format || asset.resource_type}</span>
                          <span className="text-gray-200">·</span>
                          <span className="text-[9px] font-bold text-gray-400">{new Date(asset.created_at).toLocaleDateString()}</span>
                        </div>
                        {asset.db_origin && (
                          <span className={`inline-block mt-1.5 px-2 py-0.5 rounded-md text-[9px] font-black uppercase ${ORIGIN_LABELS[asset.db_origin]?.color || 'bg-gray-100 text-gray-500'}`}>
                            {ORIGIN_LABELS[asset.db_origin]?.label || asset.db_origin}
                          </span>
                        )}
                        <p className="text-[9px] text-gray-300 font-bold mt-1 truncate">{asset.folder}</p>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-2 pt-2 border-t border-gray-50">
                        <button onClick={() => setShowPreview({ url: asset.secure_url, type: isImage ? 'image' : isVideo ? 'video' : 'document', title: asset.db_title || fileName })}
                          className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-gray-50 hover:bg-primary-950 hover:text-white text-gray-500 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all">
                          <Eye className="w-3.5 h-3.5" /> Preview
                        </button>
                        <a href={asset.secure_url} target="_blank" rel="noopener noreferrer"
                          className="p-2 bg-gray-50 hover:bg-gray-100 text-gray-400 rounded-xl transition-all">
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                        <button onClick={() => setConfirmDeleteCloud(asset)}
                          className="p-2 bg-gray-50 hover:bg-red-50 hover:text-red-600 text-gray-400 rounded-xl transition-all">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Last fetch info */}
          {cloudAssetsLastFetch && (
            <p className="text-center text-[10px] font-bold text-gray-300 uppercase tracking-widest">
              Last fetched from Cloudinary: {cloudAssetsLastFetch.toLocaleTimeString()} · {filteredCloudAssets.length} of {cloudAssets.length} shown
            </p>
          )}
        </div>
      )}

      {/* ── EXISTING DB-BACKED TABS ─────────────────────────────────────────── */}
      {activeTab !== 'cloudinary' && (
        <>
      {/* File grid */}
      {loading && allResources.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-32 text-gray-300">
          <Loader2 className="w-12 h-12 animate-spin mb-6 text-primary-200" />
          <span className="font-black text-[10px] uppercase tracking-widest animate-pulse">Loading archive...</span>
        </div>
      ) : error ? (
        <ErrorState onRetry={() => syncAll(true)} message={error} />
      ) : filteredResources.length === 0 ? (
        <div className="bg-gray-50 rounded-3xl p-24 text-center border-2 border-dashed border-gray-100">
          <Archive className="h-14 w-14 text-gray-200 mx-auto mb-6" />
          <h3 className="text-xl font-black text-gray-900 uppercase tracking-tight">
            {activeTab === 'vault' ? 'Vault is empty' : 'No live files found'}
          </h3>
          <p className="text-gray-400 mt-2 text-sm font-medium">
            {activeTab === 'vault'
              ? 'Upload files to the vault to store them for future use.'
              : 'Files uploaded via Materials, Past Questions, Announcements, or Events will appear here.'}
          </p>
          {activeTab === 'vault' && (
            <button
              onClick={() => setShowUploadModal(true)}
              className="mt-6 inline-flex items-center gap-2 px-6 py-3 bg-primary-950 text-white rounded-xl font-black text-xs uppercase tracking-widest hover:bg-primary-800 transition-all"
            >
              <Plus className="w-4 h-4" /> Upload to Vault
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {filteredResources.map((resource) => {
            const effectiveType = getEffectiveType(resource);
            const origin = ORIGIN_LABELS[resource.origin_table] || { label: resource.origin_table, color: 'bg-gray-100 text-gray-600' };
            const isVault = resource.origin_table === 'resource';
            const canDelete = resource.origin_table !== 'personnel';

            return (
              <div
                key={`${resource.origin_table}-${resource.id}`}
                className={`group bg-white rounded-3xl border shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 overflow-hidden flex flex-col ${
                  selectedIds.has(resource.id) ? 'border-red-300 ring-2 ring-red-200' : 'border-gray-100'
                }`}
              >
                {/* File type color bar */}
                <div className={`h-1.5 w-full ${
                  effectiveType === 'document' ? 'bg-blue-500' :
                  effectiveType === 'image' ? 'bg-amber-400' :
                  effectiveType === 'video' ? 'bg-emerald-500' : 'bg-gray-300'
                }`} />

                {/* Media Thumbnail */}
                <div className="h-32 bg-gray-50 overflow-hidden relative group-hover:opacity-90 transition-opacity">
                  {effectiveType === 'image' ? (
                    <img src={getValidUrl(resource.file_url)} alt={resource.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" loading="lazy" />
                  ) : effectiveType === 'video' ? (
                    <div className="w-full h-full relative bg-purple-50">
                      <img src={getVideoThumbnail(getValidUrl(resource.file_url))} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" loading="lazy" />
                      <div className="absolute inset-0 flex items-center justify-center bg-black/10">
                        <div className="w-10 h-10 bg-purple-600/90 rounded-full flex items-center justify-center shadow-lg"><Play className="w-4 h-4 text-white ml-1" /></div>
                      </div>
                    </div>
                  ) : (
                     <div className="w-full h-full flex items-center justify-center bg-blue-50/50"><FileText className="w-10 h-10 text-blue-300 group-hover:scale-110 transition-transform duration-300" /></div>
                  )}
                  
                  {/* Status badge overlay */}
                  <div className={`absolute top-2 right-2 flex items-center gap-1 px-2 py-1 rounded-lg text-[9px] font-black uppercase ${origin.color}`}>
                    {origin.label}
                  </div>
                </div>

                <div className="p-5 flex flex-col flex-1 gap-4">
                  {/* Header row */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      {/* Checkbox */}
                      <button
                        onClick={() => toggleSelect(resource.id)}
                        className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-all ${
                          selectedIds.has(resource.id)
                            ? 'bg-red-500 border-red-500'
                            : 'border-gray-300 hover:border-red-400'
                        }`}
                      >
                        {selectedIds.has(resource.id) && <X className="w-3 h-3 text-white" />}
                      </button>
                    </div>
                  </div>

                  {/* Title */}
                  <div className="flex-1">
                    <h3 className="font-black text-gray-900 text-sm leading-tight line-clamp-2 group-hover:text-primary-950 transition-colors">
                      {resource.title}
                    </h3>
                    <div className="flex items-center gap-2 mt-2 text-[10px] font-bold text-gray-400">
                      {formatFileSize(resource.file_size) && (
                        <span>{formatFileSize(resource.file_size)}</span>
                      )}
                      <span>·</span>
                      <span>{new Date(resource.created_at).toLocaleDateString()}</span>
                    </div>
                    {resource.uploader_name && (
                      <p className="text-[10px] font-bold text-gray-400 mt-1 truncate">
                        by {resource.uploader_name}
                      </p>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="space-y-2 pt-2 border-t border-gray-50">
                    {/* Push to App buttons — only for vault items */}
                    {isVault && (
                      <div className="grid grid-cols-2 gap-1.5">
                        <button
                          onClick={() => handlePushTo('/materials', resource)}
                          className="flex items-center justify-center gap-1.5 py-2 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all"
                          title="Push to Materials"
                        >
                          <BookOpen className="w-3.5 h-3.5" /> Materials
                        </button>
                        <button
                          onClick={() => handlePushTo('/past-questions', resource)}
                          className="flex items-center justify-center gap-1.5 py-2 bg-amber-50 hover:bg-amber-100 text-amber-700 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all"
                          title="Push to Past Questions"
                        >
                          <HelpCircle className="w-3.5 h-3.5" /> Past Qs
                        </button>
                        <button
                          onClick={() => handlePushTo('/announcements', resource)}
                          className="flex items-center justify-center gap-1.5 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all"
                          title="Push to Announcements"
                        >
                          <Megaphone className="w-3.5 h-3.5" /> Announce
                        </button>
                        <button
                          onClick={() => handlePushTo('/events', resource)}
                          className="flex items-center justify-center gap-1.5 py-2 bg-purple-50 hover:bg-purple-100 text-purple-700 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all"
                          title="Push to Events"
                        >
                          <CalendarDays className="w-3.5 h-3.5" /> Events
                        </button>
                      </div>
                    )}

                    {/* Preview + Delete row */}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handlePreview(resource)}
                        className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-gray-50 hover:bg-primary-950 hover:text-white text-gray-500 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
                      >
                        <Eye className="w-4 h-4" /> Preview
                      </button>
                      <a
                        href={resource.file_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-2.5 bg-gray-50 hover:bg-gray-100 text-gray-400 rounded-xl transition-all"
                        title="Open in new tab"
                      >
                        <ExternalLink className="w-4 h-4" />
                      </a>
                      {canDelete && (
                        <button
                          onClick={() => setConfirmDelete(resource)}
                          className="p-2.5 bg-gray-50 hover:bg-red-50 hover:text-red-600 text-gray-400 rounded-xl transition-all"
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
        </>
      )}

      {/* Upload to Vault Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center p-6 bg-primary-950/60 backdrop-blur-md animate-in fade-in duration-300">
          <div className="relative w-full max-w-lg bg-white rounded-[2.5rem] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300">
            <div className="px-8 py-6 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Cloud className="w-5 h-5 text-primary-600" />
                  <span className="text-[10px] font-black text-primary-600 uppercase tracking-widest">Admin Vault</span>
                </div>
                <h2 className="text-2xl font-black text-gray-900 tracking-tight">Archive New File</h2>
                <p className="text-xs text-gray-400 font-medium mt-0.5">
                  Stored privately — push to the app when ready
                </p>
              </div>
              <button
                onClick={() => setShowUploadModal(false)}
                className="p-2.5 bg-white text-gray-400 hover:text-red-500 rounded-xl border border-gray-100 transition-all"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleArchive} className="p-8 space-y-6">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">File Title *</label>
                <input
                  type="text"
                  required
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  className="w-full px-5 py-3.5 bg-gray-50 border-none rounded-2xl text-sm font-bold focus:ring-2 focus:ring-primary-950 shadow-inner"
                  placeholder="e.g. Student Handbook 2026"
                />
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Category</label>
                <select
                  value={formData.category}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                  className="w-full px-5 py-3.5 bg-gray-50 border-none rounded-2xl text-sm font-bold focus:ring-2 focus:ring-primary-950 shadow-inner appearance-none"
                >
                  <option value="general">General</option>
                  <option value="academic">Academic</option>
                  <option value="administrative">Administrative</option>
                  <option value="media">Media / Images</option>
                  <option value="archive">Archive</option>
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Upload File *</label>
                <FileUpload
                  accept="*"
                  folder="resources"
                  multiple={true}
                  label="Drop file here or click to browse"
                  description="Any file type — PDF, Word, images, videos, etc."
                  onUploadComplete={(url, file) => {
                    setFormData(prev => ({
                      ...prev,
                      file_url: url,
                      file_size: file.size,
                      file_type: getFileType(file.name),
                      title: prev.title || file.name.replace(/\.[^/.]+$/, ''),
                    }));
                  }}
                  onMultiUploadComplete={(results) => {
                    const batchFiles = results.map(r => ({
                        url: r.url,
                        size: r.file.size,
                        name: r.originalFilename || r.file.name,
                        type: r.file.type || ''
                    }));
                    const existingFiles = formData.batch_files || [];
                    const combinedFiles = [...existingFiles, ...batchFiles];

                    setFormData(prev => ({
                        ...prev,
                        file_url: combinedFiles[0]?.url || prev.file_url,
                        file_size: combinedFiles[0]?.size || prev.file_size,
                        file_type: combinedFiles[0]?.type || prev.file_type,
                        title: prev.title || combinedFiles[0]?.name.replace(/\.[^/.]+$/, ''),
                        batch_files: combinedFiles
                    }));
                  }}
                  currentFileUrl={formData.file_url}
                  currentBatchUrls={formData.batch_files}
                  onRemoveBatchItem={(idx) => {
                      const updatedFiles = (formData.batch_files || []).filter((_, i) => i !== idx);
                      setFormData(prev => ({
                        ...prev,
                        batch_files: updatedFiles,
                        file_url: updatedFiles[0]?.url || '',
                      }));
                  }}
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    if (showUploadModal === 'create') clearDraft();
                    else setShowUploadModal(false);
                  }}
                  className="flex-1 py-4 bg-gray-50 text-gray-400 rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-gray-100 transition-all"
                >
                  {showUploadModal === 'create' ? 'Discard Draft' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || !formData.file_url}
                  className="flex-[2] py-4 bg-primary-950 text-white rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-primary-800 disabled:opacity-40 transition-all shadow-xl flex items-center justify-center gap-2"
                >
                  {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
                  Save to Vault
                </button>
              </div>
              {archiveError && (
                <div className="mt-3 flex items-center gap-3 px-4 py-3 bg-red-50 border border-red-100 rounded-xl">
                  <p className="text-sm font-medium text-red-700">{archiveError}</p>
                </div>
              )}
            </form>
          </div>
        </div>
      )}

      {/* Delete confirmation modal */}
      {confirmDelete && (
        <div className="fixed inset-0 z-[160] flex items-center justify-center p-6 bg-red-950/40 backdrop-blur-md animate-in fade-in duration-300">
          <div className="bg-white w-full max-w-sm rounded-[2.5rem] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300">
            <div className="p-8 text-center bg-red-50">
              <div className="w-16 h-16 bg-red-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-xl shadow-red-600/20">
                <Trash2 className="w-8 h-8 text-white" />
              </div>
              <h2 className="text-xl font-black text-gray-900">Delete File?</h2>
              <p className="text-sm text-gray-500 mt-2 font-medium">
                <span className="font-black text-gray-900">"{confirmDelete.title}"</span>
                {confirmDelete.origin_table !== 'resource' && (
                  <span className="block mt-1 text-red-600 font-bold">
                    ⚠️ This file is live in the app — deleting it will remove it from {ORIGIN_LABELS[confirmDelete.origin_table]?.label || confirmDelete.origin_table}.
                  </span>
                )}
              </p>
            </div>
            <div className="p-6 flex gap-3">
              <button
                onClick={() => setConfirmDelete(null)}
                className="flex-1 py-3.5 bg-gray-50 text-gray-400 rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-gray-100 transition-all"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(confirmDelete)}
                className="flex-[2] py-3.5 bg-red-600 text-white rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-red-700 transition-all shadow-xl shadow-red-600/20"
              >
                Delete Permanently
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk delete confirmation modal */}
      {showBulkConfirm && (
        <div className="fixed inset-0 z-[170] flex items-center justify-center p-6 bg-red-950/50 backdrop-blur-md animate-in fade-in duration-300">
          <div className="bg-white w-full max-w-md rounded-[2.5rem] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300 p-8">
            <div className="flex flex-col items-center text-center gap-4">
              <div className="w-16 h-16 bg-red-100 rounded-3xl flex items-center justify-center">
                <Trash2 className="w-8 h-8 text-red-600" />
              </div>
              <h3 className="text-xl font-black text-gray-900">Delete {selectedIds.size} Files?</h3>
              <p className="text-sm text-gray-500 font-medium leading-relaxed">
                This will permanently delete <span className="font-black text-gray-900">{selectedIds.size} selected file{selectedIds.size !== 1 ? 's' : ''}</span> from both the app and Cloudinary storage. This cannot be undone.
              </p>
              <div className="flex gap-3 w-full mt-2">
                <button onClick={() => setShowBulkConfirm(false)}
                  className="flex-1 py-3.5 border-2 border-gray-200 text-gray-600 rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-gray-50 transition-all">
                  Cancel
                </button>
                <button onClick={handleBulkDelete}
                  className="flex-[2] py-3.5 bg-red-600 text-white rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-red-700 transition-all shadow-xl shadow-red-600/20">
                  Delete {selectedIds.size} Files
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Cloudinary single delete confirmation */}
      {confirmDeleteCloud && (
        <div className="fixed inset-0 z-[160] flex items-center justify-center p-6 bg-red-950/40 backdrop-blur-md animate-in fade-in duration-300">
          <div className="bg-white w-full max-w-sm rounded-[2.5rem] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300">
            <div className="p-8 text-center bg-red-50">
              <div className="w-16 h-16 bg-red-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-xl shadow-red-600/20">
                <Trash2 className="w-8 h-8 text-white" />
              </div>
              <h2 className="text-xl font-black text-gray-900">Delete from Cloudinary?</h2>
              <p className="text-sm text-gray-500 mt-2 font-medium break-all">
                <span className="font-black text-gray-900">"{confirmDeleteCloud.public_id.split('/').pop()}"</span>
              </p>
              {confirmDeleteCloud.status === 'in_app' && (
                <p className="mt-2 text-xs font-bold text-red-600">⚠️ This file is linked to the app. Deleting it from Cloudinary will break the link.</p>
              )}
            </div>
            <div className="p-6 flex gap-3">
              <button onClick={() => setConfirmDeleteCloud(null)}
                className="flex-1 py-3.5 bg-gray-50 text-gray-400 rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-gray-100 transition-all">Cancel</button>
              <button onClick={() => handleDeleteCloudAsset(confirmDeleteCloud)}
                className="flex-[2] py-3.5 bg-red-600 text-white rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-red-700 transition-all shadow-xl shadow-red-600/20">
                Delete from Cloudinary
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cloudinary bulk delete confirmation */}
      {showCloudBulkConfirm && (
        <div className="fixed inset-0 z-[170] flex items-center justify-center p-6 bg-red-950/50 backdrop-blur-md animate-in fade-in duration-300">
          <div className="bg-white w-full max-w-md rounded-[2.5rem] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300 p-8">
            <div className="flex flex-col items-center text-center gap-4">
              <div className="w-16 h-16 bg-red-100 rounded-3xl flex items-center justify-center">
                <Trash2 className="w-8 h-8 text-red-600" />
              </div>
              <h3 className="text-xl font-black text-gray-900">Delete {selectedCloudIds.size} from Cloudinary?</h3>
              <p className="text-sm text-gray-500 font-medium leading-relaxed">
                This permanently removes <span className="font-black text-gray-900">{selectedCloudIds.size} asset{selectedCloudIds.size !== 1 ? 's' : ''}</span> from Cloudinary storage. Files linked to the app will have broken links.
              </p>
              <div className="flex gap-3 w-full mt-2">
                <button onClick={() => setShowCloudBulkConfirm(false)}
                  className="flex-1 py-3.5 border-2 border-gray-200 text-gray-600 rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-gray-50 transition-all">Cancel</button>
                <button onClick={handleBulkDeleteCloud}
                  className="flex-[2] py-3.5 bg-red-600 text-white rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-red-700 transition-all shadow-xl shadow-red-600/20">
                  Delete {selectedCloudIds.size} Assets
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Preview modal */}
      {showPreview && (
        <div className="fixed inset-0 bg-primary-950/95 flex items-center justify-center z-[200] p-4 lg:p-10 backdrop-blur-3xl animate-in fade-in duration-500">
          <div className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-6xl h-full lg:h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-500">
            <div className="px-8 py-5 border-b bg-gray-50 flex items-center justify-between gap-4">
              <div className="flex items-center gap-4 min-w-0">
                <div className="w-12 h-12 bg-primary-950 text-emerald-400 rounded-2xl flex items-center justify-center shrink-0">
                  {showPreview.type === 'video' ? <Video className="w-6 h-6" /> :
                   showPreview.type === 'image' ? <File className="w-6 h-6" /> :
                   <FileText className="w-6 h-6" />}
                </div>
                <div className="min-w-0">
                  <h3 className="font-black text-gray-900 truncate">{showPreview.title}</h3>
                  <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest truncate">
                    {showPreview.url.split('/').pop()?.split('?')[0]}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <a
                  href={showPreview.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 px-5 py-2.5 bg-white border border-gray-200 text-gray-700 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-gray-50 transition-all"
                >
                  <ExternalLink className="w-4 h-4" /> Open
                </a>
                <button
                  onClick={() => setShowPreview(null)}
                  className="p-2.5 bg-gray-900 text-white rounded-xl hover:bg-black transition-all"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-hidden bg-gray-50 flex items-center justify-center">
              {(() => {
                const url = showPreview.url.toLowerCase();
                const isImage = url.match(/\.(jpg|jpeg|png|gif|webp|svg)$/);
                const isVideo = url.match(/\.(mp4|mov|avi)$/);
                const isPdf = url.endsWith('.pdf');
                const isOffice = url.match(/\.(doc|docx|xls|xlsx|ppt|pptx)$/);

                if (isImage) return (
                  <img
                    src={showPreview.url}
                    alt={showPreview.title}
                    className="max-w-full max-h-full object-contain rounded-2xl shadow-2xl"
                  />
                );
                if (isVideo) return (
                  <div className="w-full max-w-4xl aspect-video bg-black rounded-2xl overflow-hidden shadow-2xl">
                    <video src={showPreview.url} controls className="w-full h-full" />
                  </div>
                );
                if (isPdf || isOffice) return (
                  <InstitutionalDocumentViewer url={showPreview.url} isOffice={!!isOffice} />
                );
                return (
                  <div className="text-center p-12">
                    <Archive className="w-16 h-16 text-gray-200 mx-auto mb-4" />
                    <p className="font-black text-gray-500 uppercase tracking-widest text-sm mb-6">Preview not available for this file type</p>
                    <a
                      href={showPreview.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 px-6 py-3 bg-primary-950 text-white rounded-xl font-black text-xs uppercase tracking-widest hover:bg-primary-800 transition-all"
                    >
                      <ExternalLink className="w-4 h-4" /> Open in Browser
                    </a>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

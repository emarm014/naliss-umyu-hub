import React, { useEffect, useState, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { deleteFromCloudinary } from '../lib/cloudinaryDelete';
import { useAdminDataStore } from '../store/adminData.store';
import { useAuthStore } from '../store/auth.store';
import { getAllowedLevelsForPermission } from '../utils/access';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import Modal from '../components/ui/Modal';
import {
  Image as ImageIcon, Film, FileText, Search,
  Download, Eye, Trash2, AlertTriangle, RefreshCw,
  Users, Play, HardDrive, CheckCircle2, Shield, Lock, X,
} from 'lucide-react';
import { format } from 'date-fns';

/**
 * Converts a Cloudinary video URL into a thumbnail image URL.
 * Works by replacing /video/upload/ with /video/upload/so_0,w_400,h_400,c_fill,f_jpg/
 * which generates a JPEG thumbnail from the first frame of the video.
 */
const getVideoThumbnail = (url: string): string => {
  try {
    // Cloudinary URL pattern: .../video/upload/v1234/folder/file.mp4
    return url.replace(/\/video\/upload\//, '/video/upload/so_0,w_400,h_400,c_fill,f_jpg/');
  } catch {
    return '';
  }
};

const getValidUrl = (url: string): string => {
  if (!url) return '';
  let validUrl = url;
  if (validUrl.startsWith('res.cloudinary.com')) validUrl = `https://${validUrl}`;
  else if (validUrl.startsWith('//')) validUrl = `https:${validUrl}`;
  else if (validUrl.startsWith('http://res.cloudinary.com')) validUrl = validUrl.replace('http://', 'https://');
  return validUrl;
};

interface MediaMessage {
  id: string;
  content: string;
  message_type: 'image' | 'video' | 'document' | 'audio';
  created_at: string;
  deleted_at?: string | null;
  is_deleted: boolean;
  deleted_by_user_id?: string | null;
  sender_id: string;
  group_id: string;
  metadata: { name?: string; size?: number } | null;
  sender?: { full_name: string; username: string; email: string; role: string; registration_number: string | null; level: string | null } | null;
  group?: { name: string; group_type: string } | null;
  deleted_by?: { full_name: string; username: string } | null;
}

interface GroupStat {
  group_id: string;
  group_name: string;
  group_type: string;
  total: number;
  images: number;
  videos: number;
  docs: number;
  size_bytes: number;
  items: MediaMessage[];
}

const fmtBytes = (b?: number): string => {
  if (!b || b === 0) return '0 B';
  const k = 1024, s = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return parseFloat((b / Math.pow(k, i)).toFixed(1)) + ' ' + s[i];
};

export default function GroupMediaPage() {
  const { groups: storeGroups } = useAdminDataStore();
  const { profile, permissions } = useAuthStore();
  const isModerator = profile?.role === 'moderator';
  const allowedLevels = isModerator ? getAllowedLevelsForPermission(permissions, 'can_manage_group_media') : null;

  const [moderatorGroupIds, setModeratorGroupIds] = useState<string[]>([]);
  const [moderatorGroupNames, setModeratorGroupNames] = useState<string[]>([]);
  const [moderatorGroupResolved, setModeratorGroupResolved] = useState<boolean>(!isModerator);
  const [media, setMedia] = useState<MediaMessage[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [groupFilter, setGroupFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedMedia, setSelectedMedia] = useState<MediaMessage | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [bulkDeletingGroup, setBulkDeletingGroup] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'groups' | 'grid'>('groups');
  const [showDeleted, setShowDeleted] = useState<'active' | 'deleted' | 'all'>('active');

  const showSuccess = (msg: string) => { setSuccessMessage(msg); setTimeout(() => setSuccessMessage(null), 5000); };
  const showError = (msg: string) => { setErrorMessage(msg); setTimeout(() => setErrorMessage(null), 5000); };

  const fetchMedia = async (overrideGroupIds?: string[]) => {
    setIsLoading(true); setError(null);
    try {
      const targetGroupIds = overrideGroupIds !== undefined ? overrideGroupIds : moderatorGroupIds;

      let query = supabase
        .from('messages')
        .select('id, content, message_type, content_type, attachment_url, created_at, deleted_at, is_deleted, deleted_by_user_id, sender_id, group_id, metadata, sender:users!messages_sender_id_fkey(full_name, username, email, role, registration_number, level), group:groups!messages_group_id_fkey(name, group_type), deleted_by:users!messages_deleted_by_user_id_fkey(full_name, username)')
        .or('message_type.in.(image,video,document,audio,file),content_type.in.(image,video,document,audio,file),content.ilike.http%,attachment_url.not.is.null')
        .order('created_at', { ascending: false })
        .limit(1000);

      // Filter for moderator groups if applicable
      if (isModerator && targetGroupIds.length > 0) {
        query = query.in('group_id', targetGroupIds);
      } else if (isModerator && targetGroupIds.length === 0) {
        setMedia([]); 
        setIsLoading(false); 
        return;
      }

      const { data, error: err } = await query;
      if (err) throw err;

      // Normalize media messages
      const normalized = ((data || []) as any[]).map((m: any) => {
        const rawUrl = m.attachment_url || m.content || '';
        const url = getValidUrl(rawUrl);
        const msgType = (m.message_type || m.content_type || '').toLowerCase();

        let type: 'image' | 'video' | 'document' | 'audio' = 'image';
        if (msgType.includes('video') || url.includes('/video/upload/') || url.match(/\.(mp4|mov|avi|webm)$/i)) {
          type = 'video';
        } else if (msgType.includes('audio') || url.match(/\.(mp3|wav|m4a|aac|ogg)$/i)) {
          type = 'audio';
        } else if (msgType.includes('doc') || msgType.includes('pdf') || url.match(/\.(pdf|docx?|pptx?|xlsx?|txt)$/i)) {
          type = 'document';
        }

        return {
          ...m,
          content: url || m.content,
          message_type: type,
        };
      });

      setMedia((normalized as unknown as MediaMessage[]) || []);
    } catch (e: unknown) { 
      setError((e as Error)?.message || 'Failed to load media.'); 
    } finally { 
      setIsLoading(false); 
    }
  };

  useEffect(() => {
    if (!isModerator) {
      setModeratorGroupResolved(true);
      fetchMedia([]);
      return;
    }

    if (!profile?.id) return;

    let query = supabase.from('groups').select('id, name');

    if (allowedLevels && allowedLevels.length > 0) {
      query = query.eq('group_type', 'level').in('level', allowedLevels);
    } else if (permissions?.assigned_level) {
      query = query.eq('group_type', 'level').eq('level', permissions.assigned_level);
    } else {
      query = query.eq('moderator_id', profile.id);
    }

    query.then(({ data }) => {
      const ids = data && data.length > 0 ? data.map(g => g.id) : [];
      const names = data && data.length > 0 ? data.map(g => g.name) : [];
      setModeratorGroupIds(ids);
      setModeratorGroupNames(names);
      setModeratorGroupResolved(true);
      fetchMedia(ids);
    });
  }, [isModerator, profile?.id, permissions, allowedLevels]); // eslint-disable-line

  useEffect(() => {
    if (!moderatorGroupResolved) return;
    const filter = isModerator && moderatorGroupIds.length > 0 ? `group_id=in.(${moderatorGroupIds.join(',')})` : undefined;
    const channel = supabase.channel(`group-media-watch:${Date.now()}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', ...(filter ? { filter } : {}) }, (payload) => {
        if ((payload.new as any)?.is_deleted) {
          const id = (payload.new as any)?.id;
          if (id) setMedia(prev => prev.filter(m => m.id !== id));
        }
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', ...(filter ? { filter } : {}) }, (payload) => {
        const msg = payload.new as any;
        if (!['image', 'video', 'document', 'audio'].includes(msg?.message_type)) return;
        fetchMedia();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [moderatorGroupResolved, isModerator, moderatorGroupIds]); // eslint-disable-line

  const handleDelete = async (msg: MediaMessage) => {
    if (!window.confirm('Delete this ' + msg.message_type + ' permanently? Removes from Cloudinary and chat. Cannot be undone.')) return;
    setDeletingId(msg.id);
    try {
      // DB first — if this fails, Cloudinary file is preserved (no orphaned records)
      const { error: err } = await supabase.from('messages').update({
        is_deleted: true,
        deleted_at: new Date().toISOString(),
        deleted_by_user_id: profile?.id || null,
      }).eq('id', msg.id);
      if (err) throw err;
      // Delete from Cloudinary — admin permanently removes the file
      await deleteFromCloudinary([msg.content]);
      setMedia(prev => prev.filter(m => m.id !== msg.id));
      setSelectedMedia(null);
      showSuccess(msg.message_type + ' deleted from Cloudinary and removed from chat.');
    } catch (e: unknown) { showError('Failed to delete: ' + ((e as Error)?.message || 'Unknown error')); }
    finally { setDeletingId(null); }
  };

  const handleBulkDeleteGroup = async (groupId: string, groupName: string) => {
    if (isModerator) return;
    const groupItems = media.filter(m => m.group_id === groupId);
    if (groupItems.length === 0) return;
    if (!window.confirm('Delete ALL ' + groupItems.length + ' media files from ' + groupName + '? Cannot be undone.')) return;
    setBulkDeletingGroup(groupId);
    try {
      // DB first — if this fails, Cloudinary files are preserved
      const { error: err } = await supabase.from('messages').update({ is_deleted: true }).in('id', groupItems.map(m => m.id));
      if (err) throw err;
      // Only delete from Cloudinary after DB confirms
      deleteFromCloudinary(groupItems.map(m => m.content));
      setMedia(prev => prev.filter(m => m.group_id !== groupId));
      showSuccess('Deleted ' + groupItems.length + ' files from ' + groupName + '. Storage freed.');
    } catch (e: unknown) { showError('Bulk delete failed: ' + ((e as Error)?.message || 'Unknown error')); }
    finally { setBulkDeletingGroup(null); }
  };

  const filtered = useMemo(() => media.filter(m => {
    if (showDeleted === 'active' && m.is_deleted) return false;
    if (showDeleted === 'deleted' && !m.is_deleted) return false;
    if (typeFilter !== 'all' && m.message_type !== typeFilter) return false;
    if (groupFilter !== 'all' && m.group_id !== groupFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      if (!m.sender?.full_name?.toLowerCase().includes(q) && !m.sender?.username?.toLowerCase().includes(q) && !m.group?.name?.toLowerCase().includes(q) && !m.metadata?.name?.toLowerCase().includes(q)) return false;
    }
    return true;
  }), [media, typeFilter, groupFilter, searchQuery, showDeleted]);

  const groupStats = useMemo((): GroupStat[] => {
    const map = new Map<string, GroupStat>();
    media.forEach(m => {
      if (!map.has(m.group_id)) map.set(m.group_id, { group_id: m.group_id, group_name: m.group?.name || 'Unknown', group_type: m.group?.group_type || 'department', total: 0, images: 0, videos: 0, docs: 0, size_bytes: 0, items: [] });
      const s = map.get(m.group_id)!;
      s.total++; s.size_bytes += m.metadata?.size || 0; s.items.push(m);
      if (m.message_type === 'image') s.images++;
      else if (m.message_type === 'video' || m.message_type === 'audio') s.videos++;
      else s.docs++;
    });
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [media]);

  const maxGroupCount = useMemo(() => Math.max(...groupStats.map(g => g.total), 1), [groupStats]);
  const stats = useMemo(() => ({
    total: media.length,
    images: media.filter(m => m.message_type === 'image').length,
    videos: media.filter(m => m.message_type === 'video' || m.message_type === 'audio').length,
    docs: media.filter(m => m.message_type === 'document').length,
    groups: groupStats.length,
  }), [media, groupStats]);

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto pb-12 animate-in fade-in duration-500">

      {successMessage && (
        <div className="fixed bottom-10 right-10 z-[200] bg-primary-950 border border-primary-800 text-white px-8 py-5 rounded-[2rem] shadow-2xl flex items-center gap-5">
          <CheckCircle2 className="w-6 h-6 text-green-400 shrink-0" />
          <p className="text-sm font-bold">{successMessage}</p>
        </div>
      )}

      {errorMessage && (
        <div className="fixed bottom-10 right-10 z-[200] bg-red-600 border border-red-500 text-white px-8 py-5 rounded-[2rem] shadow-2xl flex items-center gap-5">
          <X className="w-6 h-6 text-white shrink-0" />
          <p className="text-sm font-bold">{errorMessage}</p>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 bg-white p-8 rounded-3xl border border-gray-100 shadow-sm">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-1.5 h-8 bg-primary-950 rounded-full" />
            <h1 className="text-3xl font-black text-gray-900 tracking-tight uppercase">Group Chat Media</h1>
          </div>
          {isModerator ? (
            <div className="flex items-center gap-3 mt-1">
              <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-xl">
                <Lock className="w-3.5 h-3.5 text-amber-600" />
                <span className="text-xs font-black text-amber-700 uppercase tracking-widest">
                  {allowedLevels && allowedLevels.length > 0 
                    ? `LEVEL ${allowedLevels.join(', ')} HUBS` 
                    : (moderatorGroupNames.length > 0 ? moderatorGroupNames.join(', ') : 'YOUR GROUPS')}
                </span>
              </div>
              <p className="text-gray-500 font-medium text-sm">You can view and delete media shared in your assigned level groups.</p>
            </div>
          ) : (
            <p className="text-gray-500 font-medium">View, moderate and delete media. Deleting removes files from Cloudinary permanently.</p>
          )}
        </div>
        <div className="flex items-center gap-3">
          {!isModerator && (
            <div className="flex gap-1 bg-gray-100 p-1 rounded-xl">
              {(['groups', 'grid'] as const).map(v => (
                <button key={v} onClick={() => setViewMode(v)}
                  className={"px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all " + (viewMode === v ? 'bg-white text-primary-950 shadow-sm' : 'text-gray-400')}>
                  {v === 'groups' ? 'By Group' : 'Grid'}
                </button>
              ))}
            </div>
          )}
          <button onClick={() => fetchMedia()} disabled={isLoading}
            className="flex items-center gap-2 px-5 py-3 bg-primary-950 text-white rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-primary-800 transition-all disabled:opacity-50">
            <RefreshCw className={"w-4 h-4 " + (isLoading ? 'animate-spin' : '')} />
            Refresh
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {([
          { label: 'Total Media', value: stats.total, color: 'border-b-primary-950', Icon: HardDrive },
          { label: 'Images', value: stats.images, color: 'border-b-amber-500', Icon: ImageIcon },
          { label: 'Videos', value: stats.videos, color: 'border-b-purple-500', Icon: Film },
          { label: 'Documents', value: stats.docs, color: 'border-b-blue-500', Icon: FileText },
          { label: 'Groups w/ Media', value: stats.groups, color: 'border-b-emerald-500', Icon: Users },
        ] as { label: string; value: number; color: string; Icon: React.ElementType }[]).map(({ label, value, color, Icon }) => (
          <div key={label} className={"bg-white p-6 rounded-2xl border border-gray-100 shadow-sm border-b-4 " + color}>
            <div className="flex items-center justify-between mb-3">
              <Icon className="w-5 h-5 text-gray-400" />
              <span className="text-2xl font-black text-gray-900">{value}</span>
            </div>
            <p className="text-xs font-bold text-gray-500 uppercase tracking-widest">{label}</p>
          </div>
        ))}
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center h-64 bg-white rounded-3xl border border-gray-100">
          <LoadingSpinner size="lg" />
        </div>
      ) : error ? (
        <div className="bg-white rounded-3xl p-12 text-center border border-red-100">
          <AlertTriangle className="w-10 h-10 text-red-400 mx-auto mb-3" />
          <p className="font-bold text-red-600">{error}</p>
          <button onClick={() => fetchMedia()} className="mt-4 px-5 py-2 bg-primary-950 text-white rounded-xl text-xs font-black uppercase tracking-widest">Retry</button>
        </div>
      ) : media.length === 0 && isModerator && moderatorGroupIds.length === 0 ? (
        <div className="bg-white rounded-3xl p-20 text-center border-2 border-dashed border-gray-100">
          <Shield className="w-14 h-14 text-gray-200 mx-auto mb-4" />
          <h3 className="text-lg font-black text-gray-900">No Group Assigned</h3>
          <p className="text-gray-400 text-sm mt-1">You are not assigned as moderator of any group. Contact a super admin.</p>
        </div>
      ) : media.length === 0 ? (
        <div className="bg-white rounded-3xl p-20 text-center border-2 border-dashed border-gray-100">
          <ImageIcon className="w-14 h-14 text-gray-200 mx-auto mb-4" />
          <h3 className="text-lg font-black text-gray-900">No media found</h3>
          <p className="text-gray-400 text-sm mt-1">No media has been shared in group chats yet.</p>
        </div>
      ) : viewMode === 'groups' ? (
        <div className="space-y-4">
          {groupStats.map(gs => (
            <div key={gs.group_id} className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-4 flex-1 min-w-0">
                  <div className={"w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 " + (gs.group_type === 'level' ? 'bg-blue-100' : 'bg-emerald-100')}>
                    <Users className={"w-6 h-6 " + (gs.group_type === 'level' ? 'text-blue-600' : 'text-emerald-600')} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-black text-gray-900 truncate">{gs.group_name}</h3>
                      <span className={"px-2 py-0.5 rounded-lg text-[9px] font-black uppercase tracking-widest " + (gs.group_type === 'level' ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700')}>{gs.group_type}</span>
                    </div>
                    <div className="flex items-center gap-4 mt-1 flex-wrap">
                      <span className="text-xs font-bold text-gray-500">{gs.total} files</span>
                      <span className="text-xs font-bold text-amber-600">{gs.images} images</span>
                      <span className="text-xs font-bold text-purple-600">{gs.videos} videos</span>
                      <span className="text-xs font-bold text-blue-600">{gs.docs} docs</span>
                    </div>
                    <div className="mt-2 h-2 w-full max-w-xs bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-primary-600 rounded-full transition-all duration-700" style={{ width: (gs.total / maxGroupCount * 100) + '%' }} />
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <button onClick={() => setGroupFilter(gs.group_id === groupFilter ? 'all' : gs.group_id)}
                    className={"px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all " + (groupFilter === gs.group_id ? 'bg-primary-950 text-white' : 'bg-gray-50 text-gray-500 hover:bg-gray-100')}>
                    <Eye className="w-3.5 h-3.5 inline mr-1" />
                    {groupFilter === gs.group_id ? 'Viewing' : 'View Files'}
                  </button>
                  {!isModerator && (
                    <button onClick={() => handleBulkDeleteGroup(gs.group_id, gs.group_name)}
                      disabled={bulkDeletingGroup === gs.group_id}
                      className="flex items-center gap-1.5 px-4 py-2 bg-red-50 text-red-600 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-red-100 transition-all disabled:opacity-50">
                      <Trash2 className="w-3.5 h-3.5" />
                      {bulkDeletingGroup === gs.group_id ? 'Deleting...' : 'Delete All'}
                    </button>
                  )}
                </div>
              </div>
              {groupFilter === gs.group_id && (
                <div className="border-t border-gray-100 p-4 grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3">
                  {gs.items.map(msg => (
                    <div key={msg.id} className="relative group cursor-pointer rounded-xl overflow-hidden border border-gray-100 aspect-square bg-gray-50 hover:shadow-lg transition-all"
                      onClick={() => setSelectedMedia(msg)}>
                      {msg.message_type === 'image' ? (
                        <img src={getValidUrl(msg.content)} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                      ) : msg.message_type === 'video' ? (
                        <div className="w-full h-full relative bg-purple-50">
                          <img src={getVideoThumbnail(getValidUrl(msg.content))} alt="" className="w-full h-full object-cover"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                          <div className="absolute inset-0 flex items-center justify-center"><Play className="w-6 h-6 text-purple-500 drop-shadow-lg" /></div>
                        </div>
                      ) : (
                        <div className="w-full h-full flex items-center justify-center bg-blue-50"><FileText className="w-6 h-6 text-blue-400" /></div>
                      )}
                      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                        <button onClick={e => { e.stopPropagation(); handleDelete(msg); }} className="p-1.5 bg-red-500 rounded-lg">
                          <Trash2 className="w-3 h-3 text-white" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div>
          <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex flex-col md:flex-row gap-4 items-center mb-6">
            <div className="flex gap-2 flex-wrap">
              {(['all', 'image', 'video', 'document'] as const).map(t => (
                <button key={t} onClick={() => setTypeFilter(t)}
                  className={"px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all " + (typeFilter === t ? 'bg-primary-950 text-white shadow-lg' : 'bg-gray-50 text-gray-400 hover:bg-gray-100')}>
                  {t === 'all' ? 'All' : t === 'image' ? 'Images' : t === 'video' ? 'Videos' : 'Docs'}
                </button>
              ))}
            </div>
            {/* Active / Deleted / All toggle */}
            <div className="flex gap-1 bg-gray-100 p-1 rounded-xl">
              {(['active', 'deleted', 'all'] as const).map(v => (
                <button key={v} onClick={() => setShowDeleted(v)}
                  className={"px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all " + (showDeleted === v ? (v === 'deleted' ? 'bg-red-600 text-white shadow-sm' : 'bg-white text-primary-950 shadow-sm') : 'text-gray-400')}>
                  {v === 'active' ? '✓ Active' : v === 'deleted' ? '✕ Deleted' : 'All'}
                </button>
              ))}
            </div>
            <select value={groupFilter} onChange={e => setGroupFilter(e.target.value)}
              className="px-4 py-2.5 bg-gray-50 border-none rounded-xl text-sm font-semibold focus:ring-2 focus:ring-primary-950">
              <option value="all">All Groups</option>
              {storeGroups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
            <div className="relative flex-1">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300" />
              <input type="text" placeholder="Search..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-11 pr-4 py-3 bg-gray-50 border-none rounded-xl text-sm font-semibold focus:ring-2 focus:ring-primary-950 shadow-inner" />
            </div>
          </div>
          {filtered.length === 0 ? (
            <div className="bg-white rounded-3xl p-20 text-center border-2 border-dashed border-gray-100">
              <ImageIcon className="w-14 h-14 text-gray-200 mx-auto mb-4" />
              <p className="text-gray-400 text-sm">No media matches your filters.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
              {filtered.map(msg => (
                <div key={msg.id} className={`bg-white rounded-2xl border shadow-sm overflow-hidden group hover:shadow-xl hover:-translate-y-1 transition-all duration-300 cursor-pointer ${msg.is_deleted ? 'border-red-200 opacity-70' : 'border-gray-100'}`}
                  onClick={() => setSelectedMedia(msg)}>
                  <div className="relative aspect-square bg-gray-50 overflow-hidden">
                    {msg.message_type === 'image' ? (
                      <img src={getValidUrl(msg.content)} alt="chat media" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                    ) : msg.message_type === 'video' ? (
                      <div className="w-full h-full relative bg-purple-50">
                        <img src={getVideoThumbnail(getValidUrl(msg.content))} alt="" className="w-full h-full object-cover"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                        <div className="absolute inset-0 flex items-center justify-center">
                          <div className="w-12 h-12 bg-purple-600 rounded-full flex items-center justify-center shadow-lg"><Play className="w-5 h-5 text-white ml-0.5" /></div>
                        </div>
                      </div>
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-blue-50"><FileText className="w-10 h-10 text-blue-400" /></div>
                    )}
                    {msg.is_deleted && (
                      <div className="absolute inset-0 bg-red-900/70 flex flex-col items-center justify-center gap-1 p-2">
                        <span className="px-2 py-0.5 bg-red-600 text-white text-[9px] font-black uppercase tracking-widest rounded-lg">Deleted</span>
                        {msg.deleted_at && (
                          <span className="text-[8px] text-red-200 font-bold text-center">
                            {format(new Date(msg.deleted_at), 'MMM d, h:mm a')}
                          </span>
                        )}
                        {msg.deleted_by?.username && (
                          <span className="text-[8px] text-red-300 font-bold">@{msg.deleted_by.username}</span>
                        )}
                      </div>
                    )}
                    {!msg.is_deleted && (
                      <div className="absolute inset-0 bg-primary-950/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <Eye className="w-5 h-5 text-white" />
                      </div>
                    )}
                  </div>
                  <div className="p-3">
                    <p className="text-[10px] font-black text-gray-900 truncate">{msg.sender?.full_name || 'Unknown'}</p>
                    <p className="text-[9px] text-gray-400 font-bold truncate mt-0.5">@{msg.sender?.username || '—'} · {msg.group?.name || 'Unknown Group'}</p>
                    <p className="text-[9px] text-gray-300 font-bold mt-1">{format(new Date(msg.created_at), 'MMM d, yyyy')}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Detail Modal */}
      {selectedMedia && (
        <Modal isOpen={true} onClose={() => setSelectedMedia(null)} title="Media Details" size="lg">
          <div className="space-y-6">
            <div className="rounded-2xl overflow-hidden bg-gray-50 border border-gray-100 flex items-center justify-center min-h-[240px]">
              {selectedMedia.message_type === 'image' ? (
                <img src={getValidUrl(selectedMedia.content)} alt="preview" className="max-h-80 w-full object-contain"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
              ) : selectedMedia.message_type === 'video' ? (
                <video
                  key={selectedMedia.id}
                  controls
                  playsInline
                  preload="metadata"
                  className="max-h-80 w-full rounded-xl"
                >
                  <source src={getValidUrl(selectedMedia.content)} />
                  Your browser does not support video playback.
                </video>
              ) : selectedMedia.message_type === 'audio' ? (
                <div className="flex flex-col items-center gap-4 py-8 w-full px-6">
                  <Film className="w-12 h-12 text-purple-400" />
                  <audio controls preload="metadata" className="w-full">
                    <source src={getValidUrl(selectedMedia.content)} />
                  </audio>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-4 py-12">
                  <FileText className="w-16 h-16 text-blue-400" />
                  <p className="text-sm font-bold text-gray-600">{selectedMedia.metadata?.name || 'Document'}</p>
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              {([
                { label: 'Sent By', value: selectedMedia.sender?.full_name || 'Unknown' },
                { label: 'Username', value: selectedMedia.sender?.username ? `@${selectedMedia.sender.username}` : 'N/A' },
                { label: 'Email', value: selectedMedia.sender?.email || 'N/A' },
                { label: 'Reg. Number', value: selectedMedia.sender?.registration_number || 'N/A' },
                { label: 'Level', value: selectedMedia.sender?.level ? `Level ${selectedMedia.sender.level}` : 'N/A' },
                { label: 'Role', value: (selectedMedia.sender?.role || 'student').toUpperCase() },
                { label: 'Group', value: selectedMedia.group?.name || 'Unknown' },
                { label: 'Type', value: selectedMedia.message_type.toUpperCase() },
                { label: 'Sent At', value: format(new Date(selectedMedia.created_at), 'PPp') },
                { label: 'File Size', value: fmtBytes(selectedMedia.metadata?.size) },
                { label: 'File Name', value: selectedMedia.metadata?.name || 'N/A' },
                { label: 'Status', value: selectedMedia.is_deleted ? `Deleted ${selectedMedia.deleted_at ? format(new Date(selectedMedia.deleted_at), 'PPp') : ''}` : 'Active' },
              ] as { label: string; value: string }[]).map(({ label, value }) => (
                <div key={label} className={`p-4 rounded-xl border ${label === 'Status' && selectedMedia.is_deleted ? 'bg-red-50 border-red-100' : 'bg-gray-50 border-gray-100'}`}>
                  <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1">{label}</p>
                  <p className={`text-sm font-bold truncate ${label === 'Status' && selectedMedia.is_deleted ? 'text-red-600' : 'text-gray-900'}`}>{value}</p>
                </div>
              ))}
            </div>

            {/* Deletion stamp — shown when user deleted from mobile */}
            {selectedMedia.is_deleted && (
              <div className="p-5 bg-red-50 border border-red-200 rounded-2xl space-y-3">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-red-500 rounded-full" />
                  <p className="text-xs font-black text-red-700 uppercase tracking-widest">Deletion Record</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[9px] font-black text-red-400 uppercase tracking-widest mb-1">Deleted By</p>
                    <p className="text-sm font-bold text-red-800">
                      {selectedMedia.deleted_by?.full_name || selectedMedia.sender?.full_name || 'Unknown'}
                    </p>
                    <p className="text-[10px] text-red-500">@{selectedMedia.deleted_by?.username || selectedMedia.sender?.username || '—'}</p>
                  </div>
                  <div>
                    <p className="text-[9px] font-black text-red-400 uppercase tracking-widest mb-1">Deleted At</p>
                    <p className="text-sm font-bold text-red-800">
                      {selectedMedia.deleted_at ? format(new Date(selectedMedia.deleted_at), 'MMM d, yyyy') : '—'}
                    </p>
                    <p className="text-[10px] text-red-500">
                      {selectedMedia.deleted_at ? format(new Date(selectedMedia.deleted_at), 'h:mm a') : ''}
                    </p>
                  </div>
                  <div>
                    <p className="text-[9px] font-black text-red-400 uppercase tracking-widest mb-1">From Group</p>
                    <p className="text-sm font-bold text-red-800">{selectedMedia.group?.name || 'Unknown'}</p>
                  </div>
                  <div>
                    <p className="text-[9px] font-black text-red-400 uppercase tracking-widest mb-1">File Still on Cloudinary</p>
                    <p className="text-sm font-bold text-amber-700">Yes — Admin can delete</p>
                  </div>
                </div>
              </div>
            )}
            <div className="p-4 bg-red-50 border border-red-100 rounded-2xl">
              <p className="text-xs font-black text-red-700 uppercase tracking-widest mb-1">Storage Impact</p>
              <p className="text-sm text-red-600 font-medium">Deleting removes the file from Cloudinary permanently. Users who already downloaded it locally keep their copy.</p>
            </div>
            <div className="flex gap-3 pt-2">
              <a href={selectedMedia.content} target="_blank" rel="noopener noreferrer"
                className="flex-1 flex items-center justify-center gap-2 py-3 bg-primary-950 text-white rounded-2xl font-black uppercase tracking-widest text-xs hover:bg-primary-800 transition-all">
                <Eye className="w-4 h-4" /> Preview
              </a>
              <a href={selectedMedia.content} download
                className="flex items-center justify-center gap-2 px-5 py-3 bg-gray-100 text-gray-700 rounded-2xl font-black uppercase tracking-widest text-xs hover:bg-gray-200 transition-all">
                <Download className="w-4 h-4" />
              </a>
              <button onClick={() => handleDelete(selectedMedia)} disabled={deletingId === selectedMedia.id}
                className="flex items-center justify-center gap-2 px-5 py-3 bg-red-600 text-white rounded-2xl font-black uppercase tracking-widest text-xs hover:bg-red-700 transition-all disabled:opacity-50">
                <Trash2 className="w-4 h-4" />
                {deletingId === selectedMedia.id ? 'Deleting...' : 'Delete from Cloudinary'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

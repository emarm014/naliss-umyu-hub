import { useEffect, useState, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/auth.store';
import { format, addHours, addDays } from 'date-fns';

import { useAdminDataStore } from '../store/adminData.store';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import ErrorState from '../components/ui/ErrorState';
import Modal from '../components/ui/Modal';
import {
  Flag,
  CheckCircle,
  XCircle,
  Eye,
  Ban,
  AlertTriangle,
  MessageSquare,
  Shield,
  Filter,
  Clock,
  ChevronLeft,
  ChevronRight,
  ShieldAlert,
  UserX,
  RotateCcw
} from 'lucide-react';

interface MessageWithSender {
  id: string;
  group_id: string;
  sender_id: string;
  content: string;
  created_at: string;
  is_flagged: boolean;
  flagged_reason: string | null;
  flagged_by: string | null;
  is_deleted: boolean;
  sender?: {
    full_name: string;
    email: string;
    role: string;
  } | null;
  conversation?: {
    name: string | null;
    is_direct: boolean;
  } | null;
}

interface MessageReport {
  id: string;
  message_id: string;
  reported_by: string;
  reason: string;
  category: string;
  status: string;
  created_at: string;
  reporter?: {
    full_name: string;
    email: string;
  } | null;
  message?: MessageWithSender | null;
}

interface MutedUser {
  id: string;
  user_id: string;
  muted_by: string;
  reason: string | null;
  mute_until: string | null;
  created_at: string;
  user?: {
    full_name: string;
    email: string;
  } | null;
  mutedBy?: {
    full_name: string;
    email: string;
  } | null;
}


const ITEMS_PER_PAGE = 10;

export default function MessagingPage() {
  const { 
    flaggedMessages: allFlagged, 
    messageReports: allReports, 
    mutedUsers: allMuted, 
    isSyncing, 
    error: storeError, 
    syncAll,
    refreshAnalytics,
  } = useAdminDataStore();

  const [activeTab, setActiveTab] = useState<'flagged' | 'reports' | 'muted'>('flagged');
  const { profile } = useAuthStore();
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedMessage, setSelectedMessage] = useState<MessageWithSender | null>(null);
  const [showViewModal, setShowViewModal] = useState(false);
  
  // Mute logic
  const [showMuteModal, setShowMuteModal] = useState(false);
  const [muteTarget, setMuteTarget] = useState<{ id: string; name: string } | null>(null);
  const [muteReason, setMuteReason] = useState('');
  const [muteDuration, setMuteDuration] = useState<'1h' | '24h' | '7d' | '30d' | 'perm'>('24h');
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const showSuccess = (message: string) => {
    setSuccessMessage(message);
    setTimeout(() => setSuccessMessage(null), 5000);
  };

  const showError = (message: string) => {
    setErrorMessage(message);
    setTimeout(() => setErrorMessage(null), 5000);
  };

  // Derived Stats
  const stats = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return {
      openReports: allReports.filter(r => r.status === 'pending').length,
      flaggedToday: allFlagged.filter(m => new Date(m.created_at) >= today).length,
      mutedUsers: allMuted.length,
      safetyScore: 98
    };
  }, [allReports, allFlagged, allMuted]);

  // Unified List for Active Tab
  const activeList = useMemo(() => {
    if (activeTab === 'flagged') return allFlagged;
    if (activeTab === 'reports') return allReports;
    if (activeTab === 'muted') return allMuted;
    return [];
  }, [activeTab, allFlagged, allReports, allMuted]);

  // Pagination
  const totalCount = activeList.length;
  const totalPages = Math.ceil(totalCount / ITEMS_PER_PAGE);
  const paginatedList = useMemo(() => {
    const from = (currentPage - 1) * ITEMS_PER_PAGE;
    const to = from + ITEMS_PER_PAGE;
    return activeList.slice(from, to);
  }, [activeList, currentPage]);

  useEffect(() => {
    syncAll();
  }, [syncAll]);

  const handleUnflagMessage = async (messageId: string) => {
    try {
      const { error } = await supabase
        .from('messages')
        .update({ is_flagged: false, flagged_reason: null, flagged_by: null })
        .eq('id', messageId);

      if (error) throw error;
      refreshAnalytics();
    } catch (err: unknown) {
      showError('Failed to unflag: ' + ((err as any)?.message || 'Unknown error'));
    }
  };

  const handleDeleteMessage = async (messageId: string) => {
    if (!window.confirm('Are you sure you want to permanently delete this message? This action is irreversible.')) {
      return;
    }

    try {
      const { error } = await supabase
        .from('messages')
        .update({ is_deleted: true, is_flagged: false })
        .eq('id', messageId);

      if (error) throw error;
      showSuccess('Message removed from public view successfully.');
      refreshAnalytics();
    } catch (err: unknown) {
      showError('Failed to delete message: ' + ((err as any)?.message || 'Unknown error'));
    }
  };

  const handleResolveReport = async (reportId: string, status: 'resolved' | 'dismissed') => {
    if (status === 'dismissed' && !window.confirm('Are you sure you want to dismiss this report? This will mark it as reviewed without taking further action.')) {
      return;
    }

    try {
      const { error } = await supabase
        .from('message_reports')
        .update({ status, reviewed_at: new Date().toISOString(), reviewed_by: profile?.id })
        .eq('id', reportId);

      if (error) throw error;
      showSuccess(`Report ${status} successfully.`);
      refreshAnalytics();
    } catch (err: unknown) {
      showError('Failed to update report: ' + ((err as any)?.message || 'Unknown error'));
    }
  };

  const handleUnmuteUser = async (muteId: string) => {
    if (!window.confirm('Are you sure you want to lift this restriction? The user will be able to engage in messaging immediately.')) {
      return;
    }

    try {
      const { error } = await supabase.from('muted_users').delete().eq('id', muteId);
      if (error) throw error;
      showSuccess('User has been unmuted successfully.');
      refreshAnalytics();
    } catch (err: unknown) {
      showError('Failed to unmute: ' + ((err as any)?.message || 'Unknown error'));
    }
  };

  const handleMuteSubmit = async () => {
    if (!muteTarget || !profile?.id) return;
    try {
      let muteUntil = null;
      if (muteDuration === '1h') muteUntil = addHours(new Date(), 1).toISOString();
      if (muteDuration === '24h') muteUntil = addDays(new Date(), 1).toISOString();
      if (muteDuration === '7d') muteUntil = addDays(new Date(), 7).toISOString();
      if (muteDuration === '30d') muteUntil = addDays(new Date(), 30).toISOString();

      // Delete any existing mute for this user first, then insert fresh.
      // muted_users has a UNIQUE(user_id) constraint but no updated_at column,
      // so upsert cannot update the duration reliably — delete+insert is safe.
      await supabase.from('muted_users').delete().eq('user_id', muteTarget.id);

      const { error } = await supabase.from('muted_users').insert({
        user_id: muteTarget.id,
        muted_by: profile.id,
        reason: muteReason,
        mute_until: muteUntil,
      });

      if (error) throw error;
      setShowMuteModal(false);
      setMuteReason('');
      showSuccess(`${muteTarget.name} has been muted successfully.`);
      refreshAnalytics();
    } catch (err: unknown) {
      showError('Failed to mute user: ' + ((err as any)?.message || 'Unknown error'));
    }
  };

  return (
    <div className="space-y-6">
      {/* Global Success Feedback */}
      {successMessage && (
        <div className="fixed bottom-12 right-12 z-[100] bg-primary-950 border border-primary-800 text-white px-8 py-5 rounded-[2rem] shadow-2xl flex items-center gap-6 animate-in slide-in-from-bottom-12 duration-500">
          <div className="w-12 h-12 bg-primary-800 rounded-full flex items-center justify-center flex-shrink-0 border border-primary-700 shadow-inner">
            <CheckCircle className="w-6 h-6 text-green-400" />
          </div>
          <div>
            <p className="text-[10px] font-black tracking-[0.25em] text-primary-400 italic">SUCCESS</p>
            <p className="text-sm font-bold tracking-tight">{successMessage}</p>
          </div>
        </div>
      )}

      {/* Global Error Feedback */}
      {errorMessage && (
        <div className="fixed bottom-12 right-12 z-[100] bg-red-600 border border-red-500 text-white px-8 py-5 rounded-[2rem] shadow-2xl flex items-center gap-6 animate-in slide-in-from-bottom-12 duration-500">
          <div className="w-12 h-12 bg-red-700 rounded-full flex items-center justify-center flex-shrink-0 border border-red-600 shadow-inner">
            <XCircle className="w-6 h-6 text-white" />
          </div>
          <div>
            <p className="text-[10px] font-black tracking-[0.25em] text-red-200 italic">ERROR</p>
            <p className="text-sm font-bold tracking-tight">{errorMessage}</p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Moderation Center</h1>
          <p className="text-slate-500 mt-1 font-medium flex items-center gap-2">
            <Shield className="w-4 h-4 text-primary-600" />
            User Safety & Moderation
          </p>
        </div>
      </div>

      {/* Moderation Pulse */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Open Reports', val: stats.openReports, sub: 'pending', icon: AlertTriangle, cardBg: 'bg-red-50', iconColor: 'text-red-600', subColor: 'text-red-400', hoverBorder: 'hover:border-red-200' },
          { label: 'Red Flags', val: stats.flaggedToday, sub: 'today', icon: Flag, cardBg: 'bg-amber-50', iconColor: 'text-amber-600', subColor: 'text-amber-400', hoverBorder: 'hover:border-amber-200' },
          { label: 'Muted Registry', val: stats.mutedUsers, sub: 'users', icon: Ban, cardBg: 'bg-slate-50', iconColor: 'text-slate-600', subColor: 'text-slate-400', hoverBorder: 'hover:border-slate-200' },
          { label: 'Safety Score', val: `${stats.safetyScore}%`, sub: 'active', icon: Shield, cardBg: 'bg-emerald-50', iconColor: 'text-emerald-600', subColor: 'text-emerald-400', hoverBorder: 'hover:border-emerald-200' },
        ].map((s, i) => (
          <div key={i} className={`bg-white p-5 rounded-2xl shadow-sm border border-slate-100 flex items-center gap-4 group ${s.hoverBorder} transition-colors`}>
            <div className={`w-12 h-12 ${s.cardBg} rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform`}>
              <s.icon className={`w-6 h-6 ${s.iconColor}`} />
            </div>
            <div>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{s.label}</p>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-black text-slate-900">{s.val}</span>
                <span className={`text-[10px] font-bold ${s.subColor} uppercase`}>{s.sub}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-1">
        <div className="flex p-1 gap-1">
          {[
            { id: 'flagged', label: 'FLAGGED', icon: Flag, count: stats.flaggedToday, badgeBg: 'bg-amber-100', badgeText: 'text-amber-600' },
            { id: 'reports', label: 'REPORTS', icon: AlertTriangle, count: stats.openReports, badgeBg: 'bg-red-100', badgeText: 'text-red-600' },
            { id: 'muted', label: 'MUTED', icon: Ban, count: stats.mutedUsers, badgeBg: 'bg-slate-100', badgeText: 'text-slate-600' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => { setActiveTab(tab.id as any); setCurrentPage(1); }}
              className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-[11px] font-black transition-all ${
                activeTab === tab.id
                  ? 'bg-primary-950 text-white shadow-lg shadow-primary-950/20 translate-y-[-1px]'
                  : 'text-slate-500 hover:bg-slate-50'
              }`}
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
              {tab.count > 0 && (
                <span className={`px-1.5 py-0.5 ${tab.badgeBg} ${tab.badgeText} text-[9px] rounded-md`}>
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="min-h-[400px]">
        {isSyncing && activeList.length === 0 ? (
          <div className="flex items-center justify-center py-24 bg-white rounded-3xl border border-slate-100 border-dashed">
            <LoadingSpinner size="lg" />
          </div>
        ) : storeError ? (
          <div className="py-12 px-4 shadow-sm rounded-3xl bg-white border border-slate-100 font-medium text-red-500">
            <ErrorState onRetry={() => syncAll(true)} message={storeError} />
          </div>
        ) : (
          <div className="space-y-4">
            {activeTab === 'flagged' && paginatedList.map((msg: MessageWithSender) => (
              <ModerationCard 
                key={msg.id}
                type="flagged"
                title={msg.sender?.full_name || 'Unknown'}
                subtitle={msg.sender?.role || 'User'}
                content={msg.content}
                timestamp={msg.created_at}
                trigger={msg.flagged_reason}
                onView={() => { setSelectedMessage(msg); setShowViewModal(true); }}
                onAction={() => handleUnflagMessage(msg.id)}
                onDelete={() => handleDeleteMessage(msg.id)}
                onMute={() => { setMuteTarget({ id: msg.sender_id, name: msg.sender?.full_name || 'User' }); setShowMuteModal(true); }}
              />
            ))}
            {activeTab === 'reports' && paginatedList.map((report: MessageReport) => (
              <ModerationCard 
                key={report.id}
                type="report"
                title={`Reported by ${report.reporter?.full_name || 'Anonymous'}`}
                subtitle={`Case ID: ${report.id.slice(0, 8)}`}
                content={report.message?.content || '[Message Deleted]'}
                timestamp={report.created_at}
                trigger={report.category}
                reason={report.reason}
                onAction={() => handleResolveReport(report.id, 'resolved')}
                onDelete={() => handleResolveReport(report.id, 'dismissed')}
              />
            ))}
            {activeTab === 'muted' && paginatedList.map((mute: MutedUser) => (
              <ModerationCard 
                key={mute.id}
                type="mute"
                title={mute.user?.full_name || 'Restricted User'}
                subtitle={mute.user?.email || ''}
                timestamp={mute.created_at}
                muteUntil={mute.mute_until}
                reason={mute.reason}
                onAction={() => handleUnmuteUser(mute.id)}
              />
            ))}

            {totalCount === 0 && (activeTab === 'flagged' || activeTab === 'reports' || activeTab === 'muted') && (
              <div className="bg-white rounded-3xl shadow-sm border border-slate-100 p-24 text-center">
                <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-6">
                  <CheckCircle className="h-10 w-10 text-slate-200" />
                </div>
                <h3 className="text-xl font-black text-slate-900 uppercase tracking-tight">Clear Queue</h3>
                <p className="text-slate-500 font-medium">All items have been reviewed. No pending reports found.</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-4">
          <button
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            className="flex items-center gap-2 px-4 py-2 bg-white rounded-xl border border-slate-200 text-xs font-black text-slate-600 disabled:opacity-50 hover:bg-slate-50 transition-colors"
          >
            <ChevronLeft className="w-4 h-4" /> PREV
          </button>
          <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
            Level {currentPage} of {totalPages}
          </span>
          <button
            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
            className="flex items-center gap-2 px-4 py-2 bg-white rounded-xl border border-slate-200 text-xs font-black text-slate-600 disabled:opacity-50 hover:bg-slate-50 transition-colors"
          >
            NEXT <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Context Vault */}
      {showViewModal && selectedMessage && (
        <Modal 
          isOpen={true} 
          onClose={() => setShowViewModal(false)} 
          title="Context Vault" 
          size="lg"
        >
          <div className="space-y-8">
            <div className="flex items-center justify-between p-6 bg-slate-50 rounded-3xl border border-slate-100">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-2xl bg-primary-950 flex items-center justify-center font-black text-white text-2xl shadow-xl shadow-primary-950/20">
                  {selectedMessage.sender?.full_name?.charAt(0) || 'U'}
                </div>
                <div>
                  <h3 className="text-xl font-black text-slate-900">{selectedMessage.sender?.full_name || 'Unknown User'}</h3>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">{selectedMessage.sender?.email}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Sent At</p>
                <p className="text-sm font-bold text-slate-900">{format(new Date(selectedMessage.created_at), 'MMM d, p')}</p>
              </div>
            </div>

            <div className="space-y-4">
              <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                <MessageSquare className="w-4 h-4" /> Message Content
              </h4>
              <div className="p-8 bg-white rounded-3xl border-2 border-slate-100 shadow-inner italic text-xl text-slate-800 leading-relaxed font-medium relative overflow-hidden">
                <div className="absolute left-0 top-0 w-1.5 h-full bg-red-500" />
                "{selectedMessage.content}"
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="p-5 bg-slate-50 rounded-2xl border border-slate-100">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Flag Reason</p>
                <p className="text-sm font-bold text-slate-900 uppercase">{selectedMessage.flagged_reason || 'Manual Flag'}</p>
              </div>
              <div className="p-5 bg-slate-50 rounded-2xl border border-slate-100 text-right">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Priority</p>
                <p className="text-sm font-bold text-red-600 uppercase">High Priority</p>
              </div>
            </div>

            <div className="flex gap-3 pt-4">
              <button 
                onClick={() => { handleUnflagMessage(selectedMessage.id); setShowViewModal(false); }}
                className="flex-1 py-4 bg-emerald-600 text-white rounded-2xl font-black uppercase tracking-widest text-xs hover:bg-emerald-700 transition-all shadow-lg active:scale-95"
              >
                Mark Safe
              </button>
              <button 
                onClick={() => { handleDeleteMessage(selectedMessage.id); setShowViewModal(false); }}
                className="flex-1 py-4 bg-red-600 text-white rounded-2xl font-black uppercase tracking-widest text-xs hover:bg-red-700 transition-all shadow-lg active:scale-95"
              >
                Delete
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Mute Duration Selector */}
      {showMuteModal && (
        <Modal 
          isOpen={true} 
          onClose={() => setShowMuteModal(false)} 
          title="Restrict User"
        >
          <div className="space-y-6">
            <div className="p-5 bg-amber-50 rounded-2xl border border-amber-100 flex items-center gap-4 text-amber-900">
              <ShieldAlert className="w-6 h-6 flex-shrink-0" />
              <div>
                <p className="text-sm font-black uppercase">Restricting access for {muteTarget?.name}</p>
                <p className="text-xs font-medium opacity-80">This will disable their messaging capability across all channels.</p>
              </div>
            </div>

            <div className="space-y-4">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Select Duration</label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { id: '1h', label: '1 Hour' },
                  { id: '24h', label: '24 Hours' },
                  { id: '7d', label: '7 Days' },
                  { id: '30d', label: '30 Days' },
                  { id: 'perm', label: 'Permanent' },
                ].map(d => (
                  <button
                    key={d.id}
                    onClick={() => setMuteDuration(d.id as any)}
                    className={`p-3 rounded-xl text-xs font-black uppercase tracking-tight transition-all border ${
                      muteDuration === d.id 
                        ? 'bg-primary-950 text-white border-primary-950 shadow-md' 
                        : 'bg-white text-slate-600 border-slate-200 hover:border-primary-200'
                    }`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Reason</label>
              <textarea
                value={muteReason}
                onChange={(e) => setMuteReason(e.target.value)}
                placeholder="Reason for restriction..."
                className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-medium focus:ring-2 focus:ring-primary-950 min-h-[100px]"
              />
            </div>

            <div className="flex gap-3">
              <button 
                onClick={() => setShowMuteModal(false)}
                className="flex-1 py-4 bg-slate-100 text-slate-600 rounded-2xl font-black uppercase tracking-widest text-[10px] hover:bg-slate-200 transition-all"
              >
                Cancel
              </button>
              <button 
                onClick={handleMuteSubmit}
                className="flex-1 py-4 bg-primary-950 text-white rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-lg shadow-primary-950/20 active:scale-95"
              >
                Confirm Mute
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// Reusable Moderation Component
function ModerationCard({ 
  type, title, subtitle, content, timestamp, trigger, reason, muteUntil,
  onView, onAction, onDelete, onMute 
}: {
  type: 'flagged' | 'report' | 'mute';
  title: string;
  subtitle: string;
  content?: string;
  timestamp: string;
  trigger?: string | null;
  reason?: string | null;
  muteUntil?: string | null;
  onView?: () => void;
  onAction?: () => void;
  onDelete?: () => void;
  onMute?: () => void;
}) {
  const isFlagged = type === 'flagged';
  const isReport = type === 'report';
  const isMute = type === 'mute';

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 flex flex-col md:flex-row gap-6 transition-all hover:shadow-xl hover:border-primary-100 group">
      <div className="flex-1 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-black text-white ${
              isFlagged ? 'bg-amber-500' : isReport ? 'bg-red-500' : 'bg-slate-900'
            }`}>
              {(title || 'U').charAt(0).toUpperCase()}
            </div>
            <div>
              <p className="font-black text-slate-900 leading-none mb-1">{title}</p>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{subtitle}</p>
            </div>
          </div>
          <div className="flex flex-col items-end">
            <span className={`text-[10px] font-black px-2.5 py-1 rounded-lg uppercase tracking-tight mb-1 flex items-center gap-1.5 ${
              isFlagged ? 'bg-amber-50 text-amber-700' : isReport ? 'bg-red-50 text-red-700' : 'bg-slate-50 text-slate-700'
            }`}>
              {isFlagged ? <Flag className="w-3" /> : isReport ? <ShieldAlert className="w-3" /> : <Clock className="w-3" />}
              {type.toUpperCase()}
            </span>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
              {format(new Date(timestamp), 'MMM d, yyyy')}
            </span>
          </div>
        </div>

        {content && (
          <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 group-hover:bg-primary-50/30 group-hover:border-primary-100 transition-colors">
            <p className="text-slate-700 leading-relaxed font-medium line-clamp-3 italic">
              "{content}"
            </p>
          </div>
        )}

        {isMute && (
          <div className="space-y-4 p-4 bg-slate-50 rounded-2xl border border-slate-100">
             <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-widest">
              <span className="text-slate-400">DURATION</span>
              <span className="text-slate-950">{muteUntil ? format(new Date(muteUntil), 'PPp') : 'PERMANENT'}</span>
            </div>
            <div className="w-full bg-slate-200 h-1 rounded-full overflow-hidden">
              <div className="bg-slate-950 h-full w-[45%]" />
            </div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">REASON: <span className="text-slate-700 normal-case">{reason || 'None specified'}</span></p>
          </div>
        )}

        {!isMute && (
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-[10px] font-black text-slate-500 uppercase tracking-widest">
              <Filter className="w-3.5 h-3.5" />
              Category: <span className="text-slate-950">{trigger || 'Standard'}</span>
            </div>
            {reason && (
              <div className="flex items-center gap-2 text-[10px] font-black text-slate-500 uppercase tracking-widest">
                <AlertTriangle className="w-3.5 h-3.5 text-red-500" />
                Reason: <span className="text-red-700">{reason}</span>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex md:flex-col gap-2 justify-center border-t md:border-t-0 md:border-l border-slate-100 pt-4 md:pt-0 md:pl-6 min-w-[140px]">
        {isFlagged && (
          <>
            <button onClick={onView} className="btn-institutional-sm"><Eye className="w-3.5 h-3.5" /> Review</button>
            <button onClick={onAction} className="btn-institutional-sm bg-emerald-50 text-emerald-700 border-emerald-100"><CheckCircle className="w-3.5 h-3.5" /> Keep</button>
            <button onClick={onDelete} className="btn-institutional-sm bg-red-50 text-red-700 border-red-100"><XCircle className="w-3.5 h-3.5" /> Delete</button>
            <button onClick={onMute} className="btn-institutional-sm bg-slate-900 text-white"><UserX className="w-3.5 h-3.5" /> Mute User</button>
          </>
        )}
        {isReport && (
          <>
            <button onClick={onAction} className="btn-institutional-sm"><CheckCircle className="w-3.5 h-3.5" /> Resolved</button>
            <button onClick={onDelete} className="btn-institutional-sm bg-slate-50 text-slate-600"><RotateCcw className="w-3.5 h-3.5" /> Dismiss</button>
          </>
        )}
        {isMute && (
          <button onClick={onAction} className="btn-institutional-sm bg-slate-900 text-white"><Shield className="w-3.5 h-3.5" /> Unmute</button>
        )}
      </div>
    </div>
  );
}

import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import {
  Cloud, Database, HardDrive, BookOpen, AlertCircle, CheckCircle2,
  Users, LayoutDashboard, MessageSquare, ShieldCheck, Clock,
  Activity, RefreshCw, Calendar, FileText, GraduationCap,
  UserCheck, UserX, Shield, Megaphone, Eye, Download,
  BarChart3, Zap, Globe, Wifi, WifiOff, Server, Info,
} from 'lucide-react';
import type { UserRole } from '../types';
import { useAdminDataStore } from '../store/adminData.store';
import ErrorState from '../components/ui/ErrorState';
import LoadingSpinner from '../components/ui/LoadingSpinner';

const STORAGE_LIMIT = 25 * 1024 * 1024 * 1024;
const ANALYTICS_INTERVAL = 60_000;
const CLOUDINARY_INTERVAL = 5 * 60_000;

const fmt = (n: number) => (n || 0).toLocaleString();
const fmtBytes = (b: number) => {
  if (!b || b === 0) return '0 B';
  const k = 1024, s = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return `${parseFloat((b / Math.pow(k, i)).toFixed(2))} ${s[i]}`;
};
const timeAgo = (d: string) => {
  const sec = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (sec < 60) return 'Just now';
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
};

export default function AnalyticsPage() {
  const { analytics: census, activityLogs: recentActivity, isSyncing, error: storeError, syncAll, lastSync } = useAdminDataStore();

  const [isScanning, setIsScanning] = useState(false);
  const [forensicReport, setForensicReport] = useState<any>(null);
  const [showForensicModal, setShowForensicModal] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const autoRefreshRef = useRef(true);
  useEffect(() => { autoRefreshRef.current = autoRefresh; }, [autoRefresh]);

  const [cloudStats, setCloudStats] = useState<any>(null);
  const [cloudLoading, setCloudLoading] = useState(false);
  const [cloudError, setCloudError] = useState<string | null>(null);
  const [cloudLastFetch, setCloudLastFetch] = useState<Date | null>(null);

  const analyticsTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const cloudTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchCloudStats = useCallback(async () => {
    setCloudLoading(true);
    setCloudError(null);
    try {
      const { data, error } = await supabase.functions.invoke('cloudinary-usage');
      if (error) throw error;
      if (!data) throw new Error('No data received from Cloudinary usage service');
      setCloudStats({
        plan: data.plan || 'Free',
        storage:         { used_bytes: 0, used_human: '0 B', limit_human: '25 GB', percent: 0, ...data.storage },
        bandwidth:       { used_human: '0 B', limit_human: '25 GB', percent: 0, ...data.bandwidth },
        transformations: { used: 0, limit: 25000, percent: 0, ...data.transformations },
        credits:         { used: 0, limit: 25, percent: 0, ...data.credits },
        impressions:     { total: 0, ...(data.impressions || {}) },
        media_count:     { images: 0, videos: 0, raw: 0, total: 0, ...(data.media_count || {}) },
        resources:       { total: 0, images: 0, videos: 0, raw: 0, ...data.resources },
        errors:          { bad_request: 0, unauthorized: 0, not_found: 0, timeout: 0, rate_limited: 0, fallback_image: 0, ...(data.errors || {}) },
        folders:         Array.isArray(data.folders) ? data.folders : [],
        requests:        data.requests || 0,
      });
      setCloudLastFetch(new Date());
    } catch (err: any) {
      setCloudError(`Could not reach Cloudinary: ${err?.message || err || 'Unknown Error'}`);
    } finally {
      setCloudLoading(false);
    }
  }, []);

  useEffect(() => {
    syncAll();
    fetchCloudStats();
  }, []); // eslint-disable-line

  useEffect(() => {
    analyticsTimer.current = setInterval(() => { if (autoRefreshRef.current) syncAll(); }, ANALYTICS_INTERVAL);
    cloudTimer.current = setInterval(() => { if (autoRefreshRef.current) fetchCloudStats(); }, CLOUDINARY_INTERVAL);
    return () => {
      if (analyticsTimer.current) clearInterval(analyticsTimer.current);
      if (cloudTimer.current) clearInterval(cloudTimer.current);
    };
  }, []); // eslint-disable-line

  useEffect(() => {
    const ch = supabase.channel('analytics-watch')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'materials' }, () => { syncAll(true); fetchCloudStats(); })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'materials' }, () => { syncAll(true); fetchCloudStats(); })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'past_questions' }, () => { syncAll(true); fetchCloudStats(); })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'past_questions' }, () => { syncAll(true); fetchCloudStats(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, () => syncAll(true))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const runForensicScan = async () => {
    setIsScanning(true); setScanError(null);
    try {
      const { data, error: e } = await supabase.rpc('perform_system_forensics');
      if (e) throw e;
      setForensicReport(data); setShowForensicModal(true);
    } catch (err: unknown) {
      setScanError(err instanceof Error ? err.message : 'Scan failed.');
    } finally { setIsScanning(false); }
  };

  const storage = {
    materials:      census?.storage?.materials      || 0,
    past_questions: census?.storage?.past_questions || 0,
    resources:      census?.storage?.resources      || 0,
    total: cloudStats?.storage?.used_bytes ?? census?.storage?.total ?? 0,
  };
  const usagePct = Math.min((storage.total / STORAGE_LIMIT) * 100, 100);
  const isNearLimit = usagePct > 80;

  if (isSyncing && !census) {
    return (
      <div className="flex items-center justify-center h-[70vh]">
        <div className="text-center space-y-4">
          <LoadingSpinner size="lg" />
          <p className="text-sm font-black text-gray-950 uppercase tracking-widest">Loading Analytics...</p>
        </div>
      </div>
    );
  }
  if (storeError) return <div className="py-20"><ErrorState onRetry={() => syncAll(true)} message={storeError} /></div>;

  return (
    <div className="p-8 lg:p-12 max-w-7xl mx-auto space-y-10 pb-20">

      {/* HEADER */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-8 pb-8 border-b border-gray-100">
        <div>
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <div className="px-4 py-1.5 bg-primary-950 text-primary-400 rounded-full flex items-center gap-2 border border-primary-800/50">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span className="text-[10px] font-black uppercase tracking-[0.2em] italic">Insights Dashboard</span>
            </div>
            <div className={`px-4 py-1.5 rounded-full flex items-center gap-2 border ${autoRefresh ? 'bg-green-50 text-green-600 border-green-100' : 'bg-gray-50 text-gray-400 border-gray-100'}`}>
              {autoRefresh ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
              <span className="text-[10px] font-black uppercase tracking-widest">{autoRefresh ? 'Live Feed' : 'Paused'}</span>
            </div>
            {isSyncing && (
              <div className="px-4 py-1.5 bg-blue-50 text-blue-500 rounded-full flex items-center gap-2 border border-blue-100">
                <RefreshCw className="w-3 h-3 animate-spin" />
                <span className="text-[10px] font-black uppercase tracking-widest">Syncing</span>
              </div>
            )}
          </div>
          <h1 className="text-4xl lg:text-6xl font-black text-gray-950 tracking-tight leading-[0.9]">
            Analytics<br /><span className="text-primary-600">Statistics Report.</span>
          </h1>
          <p className="text-gray-400 mt-6 text-lg font-medium max-w-xl leading-relaxed">
            Comprehensive oversight — real-time metrics, user statistics, content analytics, Cloudinary storage intelligence, and system health.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setAutoRefresh(v => !v)}
            className={`px-5 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest border transition-all ${autoRefresh ? 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100' : 'bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100'}`}
          >
            {autoRefresh ? 'Auto-Refresh ON' : 'Auto-Refresh OFF'}
          </button>
          <button
            onClick={() => { syncAll(true); fetchCloudStats(); }}
            disabled={isSyncing}
            className="px-5 py-3 bg-primary-950 text-primary-400 rounded-2xl text-[10px] font-black uppercase tracking-widest border border-primary-800 hover:bg-primary-900 transition-all disabled:opacity-50 flex items-center gap-2"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
            Refresh Now
          </button>
        </div>
      </div>

      {/* SYNC TIMESTAMP */}
      <div className="flex items-center gap-3 px-5 py-3 bg-gray-50 rounded-2xl border border-gray-100 w-fit">
        <Clock className="w-4 h-4 text-gray-300" />
        <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Last Sync:</span>
        <span className="text-xs font-black text-gray-950">{lastSync ? new Date(lastSync).toLocaleTimeString() : 'Never'}</span>
        <span className="text-[10px] text-gray-300">•</span>
        <span className="text-[10px] font-bold text-gray-400">DB every 60s · Cloudinary every 5min</span>
      </div>

      {/* SECTION 1: USER CENSUS */}
      <div>
        <div className="flex items-center gap-3 mb-6">
          <div className="w-8 h-8 bg-primary-950 rounded-xl flex items-center justify-center"><Users className="w-4 h-4 text-primary-400" /></div>
          <h2 className="text-lg font-black text-gray-950 uppercase tracking-tight">User Distribution</h2>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {[
            { label: 'Total Users', value: census?.users?.total || 0, icon: Users, color: 'bg-primary-950', ic: 'text-primary-400' },
            { label: 'Active', value: census?.users?.active || 0, icon: UserCheck, color: 'bg-emerald-500', ic: 'text-white' },
            { label: 'Suspended', value: census?.users?.suspended || 0, icon: AlertCircle, color: 'bg-amber-500', ic: 'text-white' },
            { label: 'Banned', value: census?.users?.banned || 0, icon: UserX, color: 'bg-red-500', ic: 'text-white' },
            { label: 'Graduated', value: census?.users?.graduated || 0, icon: GraduationCap, color: 'bg-indigo-500', ic: 'text-white' },
            { label: 'Pending', value: census?.users?.pending || 0, icon: Clock, color: 'bg-blue-500', ic: 'text-white' },
          ].map((s) => (
            <div key={s.label} className="bg-white p-6 rounded-[2rem] border border-gray-100 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300">
              <div className={`${s.color} p-3 rounded-xl w-fit mb-4`}><s.icon className={`w-5 h-5 ${s.ic}`} /></div>
              <p className="text-2xl font-black text-gray-950 tracking-tighter">{fmt(s.value)}</p>
              <p className="text-[9px] font-black text-gray-400 uppercase tracking-[0.15em] mt-1">{s.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* SECTION 2: LEVEL & ROLE */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-white rounded-[2.5rem] border border-gray-100 shadow-sm p-8">
          <div className="flex items-center justify-between mb-8">
            <div><h3 className="text-lg font-black text-gray-950">Student Distribution</h3><p className="text-[10px] font-black text-gray-300 uppercase tracking-widest mt-1">Users by Level</p></div>
            <BarChart3 className="w-5 h-5 text-primary-300" />
          </div>
          <div className="space-y-5">
            {['100', '200', '300', '400'].map((level, i) => {
              const count = census?.users?.by_level?.[level] || 0;
              const pct = (count / (census?.users?.total || 1)) * 100;
              const bars = ['bg-primary-400', 'bg-primary-600', 'bg-primary-800', 'bg-primary-950'];
              return (
                <div key={level} className="space-y-2">
                  <div className="flex items-center justify-between px-1">
                    <span className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Level {level}</span>
                    <span className="text-xs font-black text-gray-950">{fmt(count)} <span className="text-[10px] text-gray-300">({pct.toFixed(0)}%)</span></span>
                  </div>
                  <div className="h-3 w-full bg-gray-50 rounded-full overflow-hidden border border-gray-100 p-0.5">
                    <div className={`h-full ${bars[i]} rounded-full transition-all duration-700`} style={{ width: `${Math.max(pct, 1)}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="bg-white rounded-[2.5rem] border border-gray-100 shadow-sm p-8">
          <div className="flex items-center justify-between mb-8">
            <div><h3 className="text-lg font-black text-gray-950">Access Control</h3><p className="text-[10px] font-black text-gray-300 uppercase tracking-widest mt-1">User Permissions</p></div>
            <Shield className="w-5 h-5 text-primary-300" />
          </div>
          <div className="space-y-5">
            {[
              { key: 'student', label: 'Students', color: 'bg-primary-400' },
              { key: 'moderator', label: 'Moderators', color: 'bg-emerald-500' },
              { key: 'super_admin', label: 'Super Admins', color: 'bg-primary-950' },
            ].map((role) => {
              const count = census?.users?.by_role?.[role.key as UserRole] || 0;
              const pct = (count / (census?.users?.total || 1)) * 100;
              return (
                <div key={role.key} className="space-y-2">
                  <div className="flex items-center justify-between px-1">
                    <span className="text-[10px] font-black text-gray-500 uppercase tracking-widest">{role.label}</span>
                    <span className="text-xs font-black text-gray-950">{fmt(count)} <span className="text-[10px] text-gray-300">({pct.toFixed(0)}%)</span></span>
                  </div>
                  <div className="h-3 w-full bg-gray-50 rounded-full overflow-hidden border border-gray-100 p-0.5">
                    <div className={`h-full ${role.color} rounded-full transition-all duration-700`} style={{ width: `${Math.max(pct, 1)}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-8 pt-6 border-t border-gray-50 grid grid-cols-3 gap-3">
            <div className="bg-emerald-50 rounded-2xl p-3 text-center border border-emerald-100"><p className="text-lg font-black text-emerald-700">{census?.users?.active || 0}</p><p className="text-[8px] font-black text-emerald-500 uppercase tracking-widest">Active</p></div>
            <div className="bg-amber-50 rounded-2xl p-3 text-center border border-amber-100"><p className="text-lg font-black text-amber-700">{census?.users?.suspended || 0}</p><p className="text-[8px] font-black text-amber-500 uppercase tracking-widest">Suspended</p></div>
            <div className="bg-red-50 rounded-2xl p-3 text-center border border-red-100"><p className="text-lg font-black text-red-700">{census?.users?.banned || 0}</p><p className="text-[8px] font-black text-red-500 uppercase tracking-widest">Banned</p></div>
          </div>
        </div>
      </div>

      {/* SECTION 3: CONTENT & COMMUNITY */}
      <div>
        <div className="flex items-center gap-3 mb-6">
          <div className="w-8 h-8 bg-primary-800 rounded-xl flex items-center justify-center"><Database className="w-4 h-4 text-primary-200" /></div>
          <h2 className="text-lg font-black text-gray-950 uppercase tracking-tight">Content & Community</h2>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          {[
            { label: 'Materials', value: census?.content?.materials || 0, icon: BookOpen, accent: 'bg-primary-950 text-primary-400' },
            { label: 'Past Questions', value: census?.content?.past_questions || 0, icon: FileText, accent: 'bg-amber-500 text-white' },
            { label: 'Courses', value: census?.content?.courses || 0, icon: LayoutDashboard, accent: 'bg-blue-600 text-white' },
            { label: 'Events', value: census?.content?.events || 0, icon: Calendar, accent: 'bg-emerald-600 text-white' },
            { label: 'Announcements', value: census?.content?.announcements || 0, icon: Megaphone, accent: 'bg-purple-600 text-white' },
          ].map((item) => (
            <div key={item.label} className="bg-white p-6 rounded-[2rem] border border-gray-100 shadow-sm hover:shadow-lg hover:-translate-y-1 transition-all duration-300">
              <div className={`${item.accent} p-3 rounded-xl w-fit mb-4`}><item.icon className="w-5 h-5" /></div>
              <p className="text-2xl font-black text-gray-950 tracking-tighter">{fmt(item.value)}</p>
              <p className="text-[9px] font-black text-gray-400 uppercase tracking-[0.15em] mt-1">{item.label}</p>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mt-4">
          {[
            { label: 'Groups', value: census?.community?.groups || 0, icon: Users },
            { label: 'Lecturers', value: census?.community?.lecturers || 0, icon: UserCheck },
            { label: 'Executives', value: census?.community?.executives || 0, icon: Shield },
            { label: 'Alumni', value: census?.community?.graduates || 0, icon: GraduationCap },
            { label: 'Messages', value: census?.community?.messages || 0, icon: MessageSquare },
            { label: 'Conversations', value: census?.community?.conversations || 0, icon: Globe },
          ].map((item) => (
            <div key={item.label} className="bg-gray-50 p-5 rounded-2xl border border-gray-100 hover:bg-white hover:shadow-lg hover:-translate-y-1 transition-all duration-300">
              <div className="flex items-center gap-3 mb-3"><item.icon className="w-4 h-4 text-gray-400" /><p className="text-[9px] font-black text-gray-400 uppercase tracking-widest">{item.label}</p></div>
              <p className="text-xl font-black text-gray-950 tracking-tighter">{fmt(item.value)}</p>
            </div>
          ))}
        </div>

        {/* Group Chat Media Breakdown */}
        <div className="mt-6 bg-gray-50 rounded-[2rem] border border-gray-100 p-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-7 h-7 bg-primary-950 rounded-xl flex items-center justify-center"><BarChart3 className="w-3.5 h-3.5 text-primary-400" /></div>
            <div>
              <h3 className="text-sm font-black text-gray-950 uppercase tracking-tight">Group Chat Media Breakdown</h3>
              <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">Media shared in group chats</p>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'Total Media', value: census?.community?.media_messages || 0, emoji: '📎', color: 'bg-white border-gray-200 text-gray-950' },
              { label: 'Images', value: census?.community?.image_messages || 0, emoji: '🖼️', color: 'bg-amber-50 border-amber-100 text-amber-800' },
              { label: 'Videos', value: census?.community?.video_messages || 0, emoji: '🎬', color: 'bg-purple-50 border-purple-100 text-purple-800' },
              { label: 'Documents', value: census?.community?.document_messages || 0, emoji: '📄', color: 'bg-blue-50 border-blue-100 text-blue-800' },
            ].map(({ label, value, emoji, color }) => (
              <div key={label} className={`flex items-center gap-3 p-4 rounded-2xl border ${color}`}>
                <span className="text-2xl">{emoji}</span>
                <div>
                  <p className="text-[9px] font-black uppercase tracking-widest opacity-70">{label}</p>
                  <p className="text-xl font-black tracking-tight">{fmt(value)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="bg-primary-950 rounded-[2.5rem] border border-primary-800 p-8 lg:p-10 shadow-2xl">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-8 h-8 bg-primary-400/20 rounded-xl flex items-center justify-center border border-primary-400/30"><Zap className="w-4 h-4 text-primary-400" /></div>
          <div><h2 className="text-lg font-black text-white uppercase tracking-tight">Engagement Metrics</h2><p className="text-[10px] font-bold text-primary-400/60 uppercase tracking-widest">Real-time user interaction</p></div>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
          {[
            { label: 'Material Views', value: census?.engagement?.material_views || 0, icon: Eye },
            { label: 'Material Downloads', value: census?.engagement?.material_downloads || 0, icon: Download },
            { label: 'Announcement Reach', value: census?.engagement?.announcement_views || 0, icon: Megaphone },
            { label: 'Total Interactions', value: (census?.engagement?.material_views || 0) + (census?.engagement?.material_downloads || 0) + (census?.engagement?.announcement_views || 0), icon: Activity },
          ].map((m) => (
            <div key={m.label} className="bg-white/5 p-6 rounded-[2rem] border border-white/10 hover:border-primary-400/30 transition-all duration-300">
              <div className="p-3 bg-primary-400/20 rounded-xl border border-primary-400/20 w-fit mb-4"><m.icon className="w-5 h-5 text-primary-400" /></div>
              <p className="text-3xl font-black text-white tracking-tighter">{fmt(m.value)}</p>
              <p className="text-[9px] font-black text-primary-400 uppercase tracking-[0.15em] mt-1">{m.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* SECTION 5: STORAGE */}
      <div className="bg-white rounded-[2.5rem] border border-gray-100 shadow-sm p-8 lg:p-10">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-primary-950 rounded-xl flex items-center justify-center"><Cloud className="w-4 h-4 text-primary-400" /></div>
            <div>
              <h2 className="text-lg font-black text-gray-950 uppercase tracking-tight">Storage Overview</h2>
              <p className="text-[10px] font-black text-gray-300 uppercase tracking-widest mt-0.5">{cloudStats ? 'Live from Cloudinary' : 'DB estimate'}</p>
            </div>
          </div>
          {isNearLimit
            ? <div className="px-4 py-2 bg-amber-50 border border-amber-200 rounded-xl flex items-center gap-2"><AlertCircle className="w-4 h-4 text-amber-500" /><span className="text-[10px] font-black text-amber-700 uppercase tracking-widest">Capacity Warning</span></div>
            : <div className="px-4 py-2 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500" /><span className="text-[10px] font-black text-emerald-700 uppercase tracking-widest">Healthy</span></div>
          }
        </div>
        <div className="flex flex-col lg:flex-row gap-8 mb-8">
          <div className="flex-1">
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Total Used</p>
            <div className="flex items-baseline gap-3">
              <p className="text-5xl font-black text-gray-950 tracking-tighter">{fmtBytes(storage.total)}</p>
              <span className="text-sm font-bold text-gray-300">/ {fmtBytes(STORAGE_LIMIT)}</span>
            </div>
          </div>
          <div className="lg:w-48 flex flex-col justify-center">
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Utilization</p>
            <p className={`text-3xl font-black tracking-tighter ${usagePct > 80 ? 'text-amber-600' : 'text-primary-600'}`}>{usagePct.toFixed(2)}%</p>
          </div>
        </div>
        <div className="h-8 w-full bg-gray-50 rounded-2xl overflow-hidden border border-gray-100 p-1.5 mb-8">
          <div className={`h-full rounded-xl transition-all duration-700 ${usagePct > 90 ? 'bg-gradient-to-r from-red-500 to-red-400' : usagePct > 70 ? 'bg-gradient-to-r from-amber-400 to-orange-400' : 'bg-gradient-to-r from-primary-600 to-emerald-500'}`} style={{ width: `${Math.max(usagePct, 1)}%` }} />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { label: 'Materials Archive', value: storage.materials, icon: BookOpen },
            { label: 'Past Questions', value: storage.past_questions, icon: FileText },
            { label: 'Other Resources', value: storage.resources, icon: HardDrive },
          ].map((b) => (
            <div key={b.label} className="bg-gray-50 p-5 rounded-2xl border border-gray-100 flex items-center gap-4">
              <div className="p-3 bg-white rounded-xl border border-gray-100 shadow-sm"><b.icon className="w-5 h-5 text-primary-600" /></div>
              <div className="flex-1">
                <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest">{b.label}</p>
                <p className="text-lg font-black text-gray-950 tracking-tight">{fmtBytes(b.value)}</p>
              </div>
              <span className="text-xs font-black text-primary-600">{storage.total > 0 ? ((b.value / storage.total) * 100).toFixed(0) : 0}%</span>
            </div>
          ))}
        </div>
      </div>

      {/* SECTION 6: CLOUDINARY INTELLIGENCE */}
      <div className="bg-white rounded-[2.5rem] border border-gray-100 shadow-sm overflow-hidden">
        <div className="p-8 lg:p-10 bg-gradient-to-br from-primary-950 to-primary-900 text-white">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-5">
              <div className="w-14 h-14 bg-white/10 rounded-2xl flex items-center justify-center border border-white/20"><Cloud className="w-7 h-7 text-primary-400" /></div>
              <div>
                <h3 className="text-2xl font-black tracking-tight">Cloudinary Storage Intelligence</h3>
                <p className="text-[10px] font-bold text-primary-300 uppercase tracking-widest mt-1">
                  {cloudStats?.plan || 'Free'} Plan — Live Usage Breakdown
                  {cloudLastFetch && ` — Updated ${cloudLastFetch.toLocaleTimeString()}`}
                </p>
              </div>
            </div>
            <button onClick={fetchCloudStats} disabled={cloudLoading} className="flex items-center gap-2 px-5 py-2.5 bg-white/10 hover:bg-white/20 text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-all border border-white/20 disabled:opacity-50">
              <RefreshCw className={`w-3.5 h-3.5 ${cloudLoading ? 'animate-spin' : ''}`} />
              {cloudLoading ? 'Fetching...' : 'Refresh'}
            </button>
          </div>
        </div>
        <div className="p-8 lg:p-10 space-y-8">
          {cloudLoading && !cloudStats && (
            <div className="flex flex-col items-center justify-center py-16 gap-4">
              <div className="w-12 h-12 relative">
                <div className="absolute inset-0 border-4 border-primary-100 rounded-full" />
                <div className="absolute inset-0 border-4 border-t-primary-600 rounded-full animate-spin" />
              </div>
              <p className="text-sm font-bold text-gray-400 uppercase tracking-widest animate-pulse">Fetching live Cloudinary data...</p>
            </div>
          )}
          {cloudError && (
            <div className="flex items-center gap-4 p-5 bg-red-50 border border-red-100 rounded-2xl">
              <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-bold text-red-700">{cloudError}</p>
                <p className="text-xs text-red-400 mt-1">Ensure CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET are set as Supabase Edge Function secrets.</p>
              </div>
              <button onClick={fetchCloudStats} className="px-4 py-2 bg-red-600 text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-red-700 transition-all">Retry</button>
            </div>
          )}
          {cloudStats && (
            <CloudinaryDashboard cloudStats={cloudStats} fmtBytes={fmtBytes} fmt={fmt} />
          )}
        </div>
      </div>

      {/* SECTION 7: FORENSIC SCAN */}
      <div className="bg-white rounded-[2.5rem] border border-gray-100 shadow-sm overflow-hidden">
        <div className="p-8 lg:p-10 flex flex-col lg:flex-row items-center justify-between gap-8 bg-gradient-to-br from-gray-50 to-white">
          <div className="flex items-center gap-6">
            <div className="w-20 h-20 bg-primary-950 rounded-[2rem] flex items-center justify-center border border-primary-800 shadow-2xl">
              <ShieldCheck className="w-10 h-10 text-primary-400" />
            </div>
            <div>
              <h3 className="text-2xl font-black text-gray-950 tracking-tight">System Audit Scan</h3>
              <p className="text-sm font-bold text-gray-400 uppercase tracking-widest mt-1 italic">Identify anomalies and optimize system parameters</p>
            </div>
          </div>
          <button onClick={runForensicScan} disabled={isScanning} className="w-full lg:w-auto px-10 py-5 bg-primary-950 text-primary-400 rounded-[2rem] text-xs font-black uppercase tracking-[0.2em] shadow-2xl hover:bg-primary-900 border border-primary-800 transition-all disabled:opacity-50 flex items-center justify-center gap-3">
            {isScanning ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
            {isScanning ? 'Scanning...' : 'Start Audit Scan'}
          </button>
        </div>
        {scanError && (
          <div className="mx-8 mb-6 flex items-center gap-3 p-4 bg-red-50 border border-red-100 rounded-2xl">
            <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
            <p className="text-sm font-bold text-red-700">{scanError}</p>
          </div>
        )}
      </div>

      {/* SECTION 8: RECENT ACTIVITY */}
      <div className="bg-white rounded-[2.5rem] border border-gray-100 shadow-sm p-8 lg:p-10">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-8 h-8 bg-primary-950 rounded-xl flex items-center justify-center"><Activity className="w-4 h-4 text-primary-400" /></div>
          <h2 className="text-lg font-black text-gray-950 uppercase tracking-tight">Recent Activity</h2>
        </div>
        {recentActivity.length === 0 ? (
          <p className="text-sm text-gray-400 font-medium text-center py-8">No recent activity recorded.</p>
        ) : (
          <div className="space-y-3">
            {recentActivity.slice(0, 20).map((log: any) => (
              <div key={log.id} className="flex items-center gap-4 p-4 bg-gray-50 rounded-2xl border border-gray-100">
                <div className={`w-2 h-2 rounded-full shrink-0 ${log.action?.includes('delete') || log.action?.includes('ban') ? 'bg-red-500' : log.action?.includes('create') || log.action?.includes('upload') ? 'bg-emerald-500' : 'bg-primary-500'}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-gray-950 truncate">{log.action}</p>
                  <p className="text-[10px] text-gray-400 font-medium">{log.user?.full_name || 'System'}</p>
                </div>
                <span className="text-[10px] font-black text-gray-300 shrink-0">{timeAgo(log.created_at)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* SECTION 9: SYSTEM HEALTH */}
      <div className="bg-primary-950 rounded-[2.5rem] p-8 border border-primary-800 shadow-2xl">
        <div className="flex flex-col md:flex-row items-center justify-between gap-8">
          <div className="flex items-center gap-6 text-white max-w-2xl">
            <div className="p-5 bg-primary-400/20 rounded-[2rem] border border-primary-400/30 shrink-0"><ShieldCheck className="w-10 h-10 text-primary-400" /></div>
            <div>
              <h4 className="text-2xl font-black tracking-tight mb-2">System Health Monitor</h4>
              <p className="text-sm text-primary-100/60 leading-relaxed font-medium">
                All subsystems operating normally. Storage at {usagePct.toFixed(1)}% utilization.
                {census?.users?.banned ? ` ${census.users.banned} banned account(s) on record.` : ' Zero security threats detected.'}
              </p>
            </div>
          </div>
          <div className="flex flex-col items-center gap-3 px-6 py-4 bg-white/5 border border-white/10 rounded-2xl shrink-0">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 bg-emerald-400 rounded-full animate-pulse" />
              <span className="text-[10px] font-black text-white uppercase tracking-widest">All Systems Operational</span>
            </div>
            <span className="text-[9px] font-bold text-primary-400/60 uppercase tracking-widest">Auto-synced every 60 seconds</span>
          </div>
        </div>
      </div>

      {showForensicModal && forensicReport && (
        <ForensicModal report={forensicReport} onClose={() => setShowForensicModal(false)} />
      )}
    </div>
  );
}

// Cloudinary sub-component — isolated so any data shape issue only affects this section
function CloudinaryDashboard({ cloudStats, fmtBytes, fmt }: { cloudStats: any; fmtBytes: (b: number) => string; fmt: (n: number) => string }) {
  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Image Impressions', value: fmt(cloudStats.impressions?.total || cloudStats.requests || 0), icon: Eye, color: 'text-blue-600 bg-blue-50', desc: 'Images served' },
          { label: 'Total Media Files', value: fmt(cloudStats.media_count?.total || cloudStats.resources?.total || 0), icon: Download, color: 'text-amber-600 bg-amber-50', desc: `${fmt(cloudStats.resources?.images || 0)} img · ${fmt(cloudStats.resources?.videos || 0)} vid · ${fmt(cloudStats.resources?.raw || 0)} doc` },
          { label: 'Transformations', value: fmt(cloudStats.transformations?.used || 0), icon: Activity, color: 'text-purple-600 bg-purple-50', desc: `of ${fmt(cloudStats.transformations?.limit || 25000)} limit` },
          { label: 'Bandwidth Used', value: cloudStats.bandwidth?.used_human || '0 B', icon: Wifi, color: 'text-emerald-600 bg-emerald-50', desc: `of ${cloudStats.bandwidth?.limit_human || '25 GB'} limit` },
        ].map((m) => (
          <div key={m.label} className="bg-white border border-gray-100 rounded-2xl p-5 flex items-center gap-4 shadow-sm">
            <div className={`p-3 rounded-xl ${m.color} shrink-0`}><m.icon className="w-5 h-5" /></div>
            <div>
              <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest">{m.label}</p>
              <p className="text-xl font-black text-gray-950 tracking-tight">{m.value}</p>
              <p className="text-[9px] font-bold text-gray-400">{m.desc}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5">
        {[
          { label: 'Storage', used: cloudStats.storage?.used_human || '0 B', limit: cloudStats.storage?.limit_human || '25 GB', pct: cloudStats.storage?.percent || 0, icon: HardDrive, desc: 'Total files stored' },
          { label: 'Bandwidth', used: cloudStats.bandwidth?.used_human || '0 B', limit: cloudStats.bandwidth?.limit_human || '25 GB', pct: cloudStats.bandwidth?.percent || 0, icon: Wifi, desc: 'Monthly delivery' },
          { label: 'Credits', used: `${Number(cloudStats.credits?.used || 0).toFixed(2)}`, limit: `${cloudStats.credits?.limit || 25}`, pct: cloudStats.credits?.percent || 0, icon: Zap, desc: 'Monthly credits used' },
          { label: 'Transformations', used: fmt(cloudStats.transformations?.used || 0), limit: fmt(cloudStats.transformations?.limit || 25000), pct: cloudStats.transformations?.percent || 0, icon: Activity, desc: 'Monthly transforms' },
        ].map((meter) => {
          const pct = meter.pct || 0;
          const bar = pct > 80 ? 'bg-red-500' : pct > 60 ? 'bg-amber-400' : 'bg-primary-600';
          const txt = pct > 80 ? 'text-red-600' : pct > 60 ? 'text-amber-600' : 'text-primary-600';
          return (
            <div key={meter.label} className="bg-gray-50 rounded-2xl border border-gray-100 p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`p-2.5 rounded-xl bg-white border border-gray-100 shadow-sm ${txt}`}><meter.icon className="w-4 h-4" /></div>
                  <div><p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{meter.label}</p><p className="text-[9px] text-gray-300 font-bold">{meter.desc}</p></div>
                </div>
                <span className={`text-sm font-black ${txt}`}>{pct.toFixed(1)}%</span>
              </div>
              <div>
                <div className="flex justify-between text-[10px] font-black text-gray-400 mb-2"><span>{meter.used}</span><span className="text-gray-300">/ {meter.limit}</span></div>
                <div className="h-2.5 bg-gray-200 rounded-full overflow-hidden"><div className={`h-full rounded-full transition-all duration-700 ${bar}`} style={{ width: `${Math.max(pct, 1)}%` }} /></div>
              </div>
              {pct > 80 && <div className="flex items-center gap-2 text-[9px] font-black text-red-600 uppercase tracking-widest"><AlertCircle className="w-3 h-3" />Approaching limit</div>}
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {[
          { label: 'Images', count: cloudStats.resources?.images || 0, icon: '🖼️', color: 'bg-amber-50 border-amber-100 text-amber-700' },
          { label: 'Videos', count: cloudStats.resources?.videos || 0, icon: '🎬', color: 'bg-purple-50 border-purple-100 text-purple-700' },
          { label: 'Documents / Raw', count: cloudStats.resources?.raw || 0, icon: '📄', color: 'bg-blue-50 border-blue-100 text-blue-700' },
        ].map((r) => (
          <div key={r.label} className={`flex items-center gap-4 p-5 rounded-2xl border ${r.color}`}>
            <span className="text-3xl">{r.icon}</span>
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest opacity-70">{r.label}</p>
              <p className="text-2xl font-black">{fmt(r.count)}</p>
              <p className="text-[9px] font-bold opacity-60">files stored</p>
            </div>
          </div>
        ))}
      </div>

      {cloudStats.errors && (
        <div className="bg-slate-900 rounded-2xl p-6 space-y-4">
          <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2"><AlertCircle className="w-3.5 h-3.5 text-red-400" />Error Summary (Last 30 Days)</h4>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {[
              { code: '400', label: 'Bad Request', val: cloudStats.errors.bad_request || 0 },
              { code: '401', label: 'Unauthorized', val: cloudStats.errors.unauthorized || 0 },
              { code: '404', label: 'Not Found', val: cloudStats.errors.not_found || 0 },
              { code: '408', label: 'Timeout', val: cloudStats.errors.timeout || 0 },
              { code: '420', label: 'Rate Limited', val: cloudStats.errors.rate_limited || 0 },
              { code: '200', label: 'Fallback', val: cloudStats.errors.fallback_image || 0 },
            ].map((e) => (
              <div key={e.code} className={`p-4 rounded-xl border text-center ${e.val > 0 ? 'text-red-400 bg-red-950/50 border-red-900' : 'text-slate-500 bg-slate-800 border-slate-700'}`}>
                <p className="text-[9px] font-black uppercase tracking-widest opacity-70 mb-1">{e.code}</p>
                <p className="text-2xl font-black">{e.val > 0 ? fmt(e.val) : '—'}</p>
                <p className="text-[9px] font-bold opacity-60 mt-0.5">{e.label}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {cloudStats.folders?.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest flex items-center gap-2"><Database className="w-3.5 h-3.5" />Storage by Folder</h4>
          <div className="space-y-2">
            {cloudStats.folders.slice(0, 12).map((folder: any) => {
              const pct = cloudStats.storage?.used_bytes > 0 ? Math.min(100, (folder.bytes / cloudStats.storage.used_bytes) * 100) : 0;
              const labels: Record<string, string> = { materials: 'Materials', past_questions: 'Past Questions', 'past-questions': 'Past Questions', announcements: 'Announcements', events: 'Events', avatars: 'Profile Photos', 'chat-docs': 'Chat Documents', 'chat-images': 'Chat Images', 'chat-videos': 'Chat Videos', mobile_uploads: 'Mobile Uploads', admin_uploads: 'Admin Uploads', groups: 'Group Media', resources: 'Vault Resources' };
              return (
                <div key={folder.name} className="flex items-center gap-4 p-3 bg-gray-50 rounded-xl border border-gray-100">
                  <div className="w-36 shrink-0">
                    <p className="text-[10px] font-black text-gray-700 truncate">{labels[folder.name] || folder.name}</p>
                    <p className="text-[9px] text-gray-400 font-bold">{fmt(folder.count)} files</p>
                  </div>
                  <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden"><div className="h-full bg-primary-500 rounded-full transition-all duration-700" style={{ width: `${Math.max(pct, 0.5)}%` }} /></div>
                  <div className="w-20 text-right shrink-0">
                    <p className="text-[10px] font-black text-gray-700">{fmtBytes(folder.bytes)}</p>
                    <p className="text-[9px] text-gray-400 font-bold">{pct.toFixed(1)}%</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div className="bg-primary-50 border border-primary-100 rounded-2xl p-6">
          <h4 className="text-xs font-black text-primary-700 uppercase tracking-widest mb-4 flex items-center gap-2"><Info className="w-3.5 h-3.5" />Free Tier Limits</h4>
          <div className="space-y-3">
            {[
              { label: 'Storage', value: '25 GB total', icon: HardDrive },
              { label: 'Bandwidth', value: '25 GB / month', icon: Wifi },
              { label: 'Credits', value: '25 / month', icon: Zap },
              { label: 'Transformations', value: '25,000 / month', icon: Activity },
              { label: 'Max image size', value: '10 MB per file', icon: Globe },
              { label: 'Max video size', value: '100 MB per file', icon: Server },
            ].map((l) => (
              <div key={l.label} className="flex items-center justify-between">
                <div className="flex items-center gap-2"><l.icon className="w-3.5 h-3.5 text-primary-500" /><span className="text-[10px] font-black text-primary-600 uppercase tracking-widest">{l.label}</span></div>
                <span className="text-xs font-black text-primary-900">{l.value}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="bg-slate-50 border border-slate-100 rounded-2xl p-6">
          <h4 className="text-xs font-black text-slate-600 uppercase tracking-widest mb-4 flex items-center gap-2"><Server className="w-3.5 h-3.5" />App Upload Restrictions</h4>
          <div className="space-y-2">
            {[
              { type: 'Images (all)', limit: '10 MB' },
              { type: 'Videos (all)', limit: '100 MB' },
              { type: 'Documents / PDFs', limit: '10 MB' },
              { type: 'Chat images', limit: '10 MB' },
              { type: 'Chat videos', limit: '100 MB' },
              { type: 'Chat documents', limit: '10 MB' },
            ].map((r) => (
              <div key={r.type} className="flex items-center justify-between py-1.5 border-b border-slate-100 last:border-0">
                <span className="text-[10px] font-bold text-slate-600">{r.type}</span>
                <span className="text-[10px] font-black text-primary-600 bg-primary-50 px-2 py-0.5 rounded-lg">{r.limit}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ForensicModal({ report, onClose }: { report: any; onClose: () => void }) {
  if (!report) return null;
  const anomalies = Array.isArray(report.anomalies) ? report.anomalies : [];

  const handleExportCSV = () => {
    if (anomalies.length === 0) return;
    const headers = ['Type', 'Entity', 'ID', 'Message', 'Severity'];
    const rows = anomalies.map((a: any) => [a.type, a.entity, a.id, `"${(a.message || '').replace(/"/g, '""')}"`, a.severity]);
    const csv = [headers, ...rows].map((r) => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `NALISS_Audit_${new Date().toISOString().split('T')[0]}.csv`;
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-primary-950/40 backdrop-blur-md">
      <div className="bg-white w-full max-w-2xl rounded-[3rem] shadow-2xl overflow-hidden border border-gray-100 flex flex-col max-h-[80vh]">
        <div className="px-10 py-8 bg-primary-950 flex items-center justify-between">
          <h3 className="text-xl font-black text-white tracking-tight uppercase">System Audit Report</h3>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-xl transition-colors text-white text-xl font-black leading-none">&times;</button>
        </div>
        <div className="overflow-y-auto flex-1 p-8 space-y-4">
          {anomalies.length === 0 ? (
            <div className="text-center py-12">
              <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-4" />
              <p className="text-lg font-black text-gray-950">No anomalies detected</p>
              <p className="text-sm text-gray-400 mt-2">System is operating within normal parameters.</p>
            </div>
          ) : (
            anomalies.map((a: any, i: number) => (
              <div key={i} className={`p-4 rounded-2xl border ${a.severity === 'critical' ? 'bg-red-50 border-red-100' : a.severity === 'warning' ? 'bg-amber-50 border-amber-100' : 'bg-gray-50 border-gray-100'}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-black text-gray-500 uppercase tracking-widest">{a.type} - {a.entity}</span>
                  <span className={`text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${a.severity === 'critical' ? 'bg-red-100 text-red-600' : a.severity === 'warning' ? 'bg-amber-100 text-amber-600' : 'bg-gray-100 text-gray-500'}`}>{a.severity}</span>
                </div>
                <p className="text-sm font-bold text-gray-950">{a.message}</p>
              </div>
            ))
          )}
        </div>
        {anomalies.length > 0 && (
          <div className="px-8 py-5 border-t border-gray-100 flex justify-end">
            <button onClick={handleExportCSV} className="px-6 py-3 bg-primary-950 text-primary-400 rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-primary-900 transition-all">
              Export CSV
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

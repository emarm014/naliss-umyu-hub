import { useEffect, useState } from 'react';
import {
  Users,
  FileText,
  MessageSquare,
  Calendar,
  TrendingUp,
  AlertCircle,
  Cloud,
  LayoutDashboard,
  Clock,
  ShieldCheck,
  ChevronRight,
  Database,
  Search,
  Plus
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { supabase, ensureActiveSession } from '../lib/supabase';
import { useShallow } from 'zustand/react/shallow';
import { useAdminDataStore } from '../store/adminData.store';

interface TrendData {
  newUsers: number;
  newMaterials: number;
  newMessages: number;
  prevUsers: number;
  prevMaterials: number;
  prevMessages: number;
}

const STORAGE_LIMIT = 25 * 1024 * 1024 * 1024; // 25GB - Storage Cap

function TrendBadge({ dir, pct }: { dir: 'up' | 'down' | 'flat'; pct: number }) {
  if (dir === 'flat' || pct === 0) {
    return (
      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-gray-50 text-gray-400 rounded-md text-[7px] font-black uppercase tracking-widest border border-gray-100">
        - NO CHANGE
      </span>
    );
  }
  if (dir === 'up') {
    return (
      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-green-50 text-green-500 rounded-md text-[7px] font-black uppercase tracking-widest border border-green-100">
        +{pct}%
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-red-50 text-red-500 rounded-md text-[7px] font-black uppercase tracking-widest border border-red-100">
      -{pct}%
    </span>
  );
}
export default function DashboardPage() {
  const navigate = useNavigate();
  const { analytics: census, isSyncing, lastSync, syncAll, error, syncWarnings } = useAdminDataStore(
    useShallow((state) => ({
      analytics: state.analytics,
      isSyncing: state.isSyncing,
      lastSync: state.lastSync,
      syncAll: state.syncAll,
      error: state.error,
      syncWarnings: state.syncWarnings,
    }))
  );
  const [trends, setTrends] = useState<TrendData | null>(null);
  const [cloudStorageBytes, setCloudStorageBytes] = useState<number | null>(null);

  useEffect(() => {
    syncAll();
  }, [syncAll]);

  // Fetch Cloudinary storage on mount for accurate storage card
  useEffect(() => {
    const fetchCloudStorage = async (retries = 2) => {
      // Ensure we have a valid, unexpired session token before invoking the edge function
      await ensureActiveSession();
      
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          const { data, error } = await supabase.functions.invoke('cloud-data');
          if (error) throw error;
          if (data?.storage?.used_bytes != null) {
            setCloudStorageBytes(data.storage.used_bytes);
          }
          return;
        } catch (err) {
          if (attempt < retries) {
            await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
            continue;
          }
          console.warn('[Storage Card] Failed to fetch Cloudinary storage:', err);
        }
      }
    };
    fetchCloudStorage();
  }, []);

  // Still fetch trends specifically or move them to store later
  // For now, let's focus on the instant census load
  useEffect(() => {
    async function fetchTrends() {
      try {
        const { data, error } = await supabase.rpc('fetch_activity_trends');
        if (error) throw error;
        if (data) {
          setTrends({
            newUsers: Number(data.newUsers) || 0,
            newMaterials: Number(data.newMaterials) || 0,
            newMessages: Number(data.newMessages) || 0,
            prevUsers: Number(data.prevUsers) || 0,
            prevMaterials: Number(data.prevMaterials) || 0,
            prevMessages: Number(data.prevMessages) || 0,
          });
        }
      } catch {
        // silent — trend data is non-critical, dashboard still shows main stats
      }
    }
    
    if (census) {
      fetchTrends();
    }
  }, [census]);

  // Component now renders a skeletal dashboard or empty state instead of a full-screen error
  if (!census && isSyncing && !lastSync) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] gap-6">
        <div className="relative">
          <div className="w-24 h-24 border-4 border-primary-100 border-t-primary-950 rounded-full animate-spin" />
          <div className="absolute inset-0 flex items-center justify-center">
             <ShieldCheck className="w-8 h-8 text-primary-950 animate-pulse" />
          </div>
        </div>
        <div className="text-center">
          <p className="text-sm font-black text-gray-900 uppercase tracking-[0.2em]">Loading Dashboard</p>
          <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mt-2">Fetching statistics...</p>
        </div>
      </div>
    );
  }

  const storageTotal = cloudStorageBytes !== null ? cloudStorageBytes : (census?.storage?.total || 0);

  const computeTrend = (current: number, previous: number): { pct: number; dir: 'up' | 'down' | 'flat' } | null => {
    if (previous === 0 && current === 0) return { pct: 0, dir: 'flat' };
    if (previous === 0) return { pct: 100, dir: 'up' };
    const pct = Math.round(((current - previous) / previous) * 100);
    return { pct: Math.abs(pct), dir: pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat' };
  };

  interface DashboardStat {
    name: string;
    value: number;
    icon: any;
    trend: { pct: number; dir: 'up' | 'down' | 'flat' } | null;
    subtext: string;
    color: string;
    iconColor: string;
    isStorage?: boolean;
  }

  const statCards: DashboardStat[] = [
    {
      name: 'Total Students',
      value: census?.users?.total ?? 0,
      icon: Users,
      trend: trends ? computeTrend(trends.newUsers, trends.prevUsers) : null,
      subtext: 'Registered students',
      color: 'bg-primary-950',
      iconColor: 'text-primary-400',
    },
    {
      name: 'Academic Materials',
      value: census?.content?.materials ?? 0,
      icon: Database,
      trend: trends ? computeTrend(trends.newMaterials, trends.prevMaterials) : null,
      subtext: 'Documents & files',
      color: 'bg-primary-800',
      iconColor: 'text-primary-300',
    },
    {
      name: 'Total Messages',
      value: census?.community?.messages ?? 0,
      icon: MessageSquare,
      trend: trends ? computeTrend(trends.newMessages, trends.prevMessages) : null,
      subtext: 'Chat activity',
      color: 'bg-primary-900',
      iconColor: 'text-primary-200',
    },
    {
      name: 'Storage Usage',
      value: storageTotal,
      icon: Cloud,
      trend: { 
        pct: STORAGE_LIMIT > 0 ? Math.round((storageTotal / STORAGE_LIMIT) * 100) : 0, 
        dir: (storageTotal > STORAGE_LIMIT * 0.8 ? 'up' : 'flat') as 'up' | 'flat'
      },
      isStorage: true,
      subtext: 'Server storage',
      color: 'bg-slate-900',
      iconColor: 'text-primary-400',
    },
  ];

  return (
    <div className="space-y-10 pb-12 animate-in fade-in duration-700">
      {/* Dashboard Header */}
      <div className="bg-primary-950 rounded-[3rem] p-10 lg:p-14 text-white shadow-2xl relative overflow-hidden group">
        <div className="absolute top-0 right-0 w-[800px] h-[800px] bg-primary-400/5 rounded-full blur-[140px] -mr-48 -mt-48 transition-all duration-1000 group-hover:bg-primary-400/10" />
        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-12">
          <div className="max-w-2xl">
            <div className="flex flex-wrap items-center gap-4 mb-4">
              <div className="px-4 py-1.5 bg-primary-400/20 border border-primary-300/30 rounded-xl flex items-center gap-2.5">
                <ShieldCheck className="w-4 h-4 text-primary-400 animate-pulse" />
                <span className="text-[10px] font-black uppercase tracking-[0.25em] text-primary-300 italic">Dashboard</span>
              </div>
              <div className="px-4 py-1.5 bg-white/5 border border-white/10 rounded-xl flex items-center gap-2.5">
                <Clock className="w-4 h-4 text-white/50" />
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/50">
                    {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                </span>
              </div>
              {(error || syncWarnings.length > 0 || !census) && !isSyncing && (
                <button 
                  onClick={() => syncAll(true)}
                  className="px-4 py-1.5 bg-red-500/20 border border-red-500/30 rounded-xl flex items-center gap-2.5 hover:bg-red-500/40 transition-colors animate-pulse"
                  title={error || (syncWarnings.length > 0 ? `Failed to sync: ${syncWarnings.join(', ')}. Click to retry.` : 'Failed to sync. Click to retry.')}
                >
                  <AlertCircle className="w-4 h-4 text-red-400" />
                  <span className="text-[10px] font-black uppercase tracking-[0.2em] text-red-200">
                    {error || (syncWarnings.length > 0 ? `Partial Sync Warning (Failed: ${syncWarnings.join(', ')})` : 'Sync Error - Retry')}
                  </span>
                </button>
              )}
            </div>
            <h1 className="text-4xl lg:text-7xl font-black leading-[1.05] tracking-tight">
              Admin <br/>
              <span className="text-primary-400">Dashboard.</span>
            </h1>
            <p className="text-primary-100/50 mt-8 text-xl font-medium leading-relaxed max-w-lg">
                Manage your institution's digital community from a single interface. View statistics, manage students, and update mobile app content.
            </p>
          </div>

          <div className="flex flex-col gap-6 lg:w-72">
              <div className="p-6 bg-white/5 rounded-[2rem] border border-white/10 backdrop-blur-xl shadow-2xl">
                 <p className="text-[10px] font-black text-white/30 uppercase tracking-[0.25em] mb-4">System Status</p>
                 <div className="flex items-center gap-4">
                    <div className="relative">
                        <div className="w-14 h-14 rounded-2xl bg-primary-400 flex items-center justify-center">
                            <TrendingUp className="w-7 h-7 text-primary-950" />
                        </div>
                        <div className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-green-400 rounded-full border-4 border-primary-950 shadow-lg shadow-green-400/50" />
                    </div>
                    <div>
                        <p className="text-2xl font-black tracking-tight">99.8%</p>
                        <p className="text-[10px] font-black text-primary-400 uppercase tracking-widest">Server Uptime</p>
                    </div>
                 </div>
              </div>
          </div>
        </div>
      </div>

      {/* Ecosystem Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 px-1">
        {statCards.map((stat) => (
          <div
            key={stat.name}
            className="group relative bg-white rounded-[2.5rem] border border-gray-100 shadow-sm hover:shadow-[0_40px_80px_rgba(0,0,0,0.06)] hover:-translate-y-2 transition-all duration-500 overflow-hidden"
          >
            <div className="p-8">
              <div className="flex items-center justify-between mb-8">
                <div className={`${stat.color} p-5 rounded-[1.5rem] shadow-xl shadow-primary-950/10 group-hover:scale-110 group-hover:rotate-6 transition-all duration-500`}>
                  <stat.icon className={`h-8 w-8 ${stat.iconColor} stroke-[2.5px]`} />
                </div>
                {stat.trend && (
                  <TrendBadge dir={stat.trend.dir} pct={stat.trend.pct} />
                )}
              </div>
              <div className="space-y-1">
                <p className="text-[11px] font-black text-gray-300 uppercase tracking-[0.1em]">{stat.name}</p>
                <div className="flex items-baseline gap-2">
                    <p className="text-3xl font-black text-gray-950 tracking-tight">
                        {stat.isStorage 
                            ? (stat.value / 1024 / 1024 / 1024).toFixed(1) + 'GB'
                            : stat.value.toLocaleString()}
                    </p>
                    <span className="text-[10px] font-black text-gray-300 uppercase tracking-widest">Total</span>
                </div>
              </div>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-tight mt-6 pt-6 border-t border-gray-50 flex items-center justify-between group-hover:text-primary-800 transition-colors">
                  {stat.subtext}
                  <ChevronRight className="w-4 h-4 opacity-0 -translate-x-4 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-500" />
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Live Distribution Analytics */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Academic Level Census */}
        <div className="bg-white rounded-[2.5rem] border border-gray-100 shadow-sm p-10 group overflow-hidden relative transition-all duration-500 hover:shadow-2xl">
          <div className="absolute top-0 right-0 w-32 h-32 bg-primary-50 rounded-bl-[5rem] -mr-16 -mt-16 transition-all duration-700 group-hover:bg-primary-100" />
          <div className="flex items-center justify-between mb-10 relative z-10">
            <div>
              <h2 className="text-xl font-black text-gray-950 tracking-tight">Student Distribution</h2>
              <p className="text-[10px] font-black text-gray-300 uppercase tracking-widest mt-1">Students per level</p>
            </div>
            <LayoutDashboard className="w-6 h-6 text-primary-300 group-hover:text-primary-600 transition-colors" />
          </div>
          <div className="space-y-6 relative z-10">
            {census?.users?.by_level && Object.keys(census.users.by_level).length > 0 ? Object.entries(census.users.by_level).map(([level, count], index) => {
               const percentage = ( (count as number) / (census?.users?.total || 1)) * 100;
               return (
                  <div key={level} className="space-y-2 group/item">
                    <div className="flex items-center justify-between px-1">
                      <span className="text-[10px] font-black text-gray-500 uppercase tracking-widest">{level} Level</span>
                      <span className="text-xs font-black text-gray-950">{(count as number).toLocaleString()} <span className="text-[10px] text-gray-300 ml-1">({percentage.toFixed(0)}%)</span></span>
                    </div>
                    <div className="h-2.5 w-full bg-gray-50 rounded-full overflow-hidden border border-gray-100 p-0.5">
                      <div
                        className="h-full bg-primary-950 rounded-full transition-all duration-1000 group-hover/item:bg-primary-600 shadow-[0_0_10px_rgba(10,10,10,0.1)]"
                        style={{ width: `${percentage}%`, transitionDelay: `${index * 100}ms` }}
                      />
                    </div>
                  </div>
               )
            }) : (
              <div className="py-8 text-center">
                <p className="text-sm font-black text-gray-300 uppercase tracking-widest">No students registered yet</p>
              </div>
            )}
          </div>
        </div>

        {/* Global Access Roles */}
        <div className="bg-white rounded-[2.5rem] border border-gray-100 shadow-sm p-10 group overflow-hidden relative transition-all duration-500 hover:shadow-2xl">
          <div className="absolute top-0 right-0 w-32 h-32 bg-primary-50 rounded-bl-[5rem] -mr-16 -mt-16 transition-all duration-700 group-hover:bg-primary-100" />
          <div className="flex items-center justify-between mb-10 relative z-10">
            <div>
              <h2 className="text-xl font-black text-gray-950 tracking-tight">User Roles</h2>
              <p className="text-[10px] font-black text-gray-300 uppercase tracking-widest mt-1">Personnel levels</p>
            </div>
            <Users className="w-6 h-6 text-primary-300 group-hover:text-primary-600 transition-colors" />
          </div>
          <div className="space-y-6 relative z-10">
            {census?.users?.by_role && Object.keys(census.users.by_role).length > 0 ? Object.entries(census.users.by_role).map(([role, count], index) => {
               const percentage = ( (count as number) / (census?.users?.total || 1)) * 100;
               const roleColor = role === 'super_admin' ? 'bg-primary-950' : role === 'moderator' ? 'bg-primary-400' : 'bg-primary-800';
               return (
                  <div key={role} className="space-y-2 group/item">
                    <div className="flex items-center justify-between px-1">
                      <span className="text-[10px] font-black text-gray-500 uppercase tracking-widest capitalize">{role.replace('_', ' ')}</span>
                      <span className="text-xs font-black text-gray-950">{(count as number).toLocaleString()} <span className="text-[10px] text-gray-300 ml-1">({percentage.toFixed(0)}%)</span></span>
                    </div>
                    <div className="h-2.5 w-full bg-gray-50 rounded-full overflow-hidden border border-gray-100 p-0.5">
                      <div
                        className={`h-full rounded-full transition-all duration-1000 ${roleColor} shadow-[0_0_10px_rgba(0,0,0,0.1)]`}
                        style={{ width: `${percentage}%`, transitionDelay: `${index * 100}ms` }}
                      />
                    </div>
                  </div>
               )
            }) : (
              <div className="py-8 text-center">
                <p className="text-sm font-black text-gray-300 uppercase tracking-widest">No users registered yet</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Strategic Operations & Pulse */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Quick Strategic Actions */}
        <div className="lg:col-span-2 bg-white rounded-[2.5rem] border border-gray-100 shadow-sm p-10">
          <div className="flex items-center justify-between mb-10">
            <div>
                <h2 className="text-xl font-black text-gray-950 tracking-tight">Quick Actions</h2>
                <p className="text-[10px] font-black text-gray-300 uppercase tracking-widest mt-1">Common tasks</p>
            </div>
            <div className="p-3 bg-gray-50 rounded-2xl flex items-center gap-2 border border-gray-100">
                <Search className="w-4 h-4 text-gray-300" />
                <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Global Search</span>
            </div>
          </div>
          
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
            <button onClick={() => navigate('/announcements')} className="flex flex-col items-start p-8 rounded-[2rem] bg-gray-50 border border-transparent hover:bg-white hover:border-primary-100 hover:shadow-xl transition-all group relative overflow-hidden">
              <div className="w-12 h-12 bg-primary-950 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 group-hover:rotate-6 transition-all duration-500">
                <FileText className="h-6 w-6 text-primary-400" />
              </div>
              <span className="text-xs font-black text-gray-950 uppercase tracking-tight">New Announcement</span>
              <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mt-2">Post Updates</p>
              <Plus className="absolute top-6 right-6 w-4 h-4 text-gray-200 group-hover:text-primary-600 transition-colors" />
            </button>
            <button onClick={() => navigate('/events')} className="flex flex-col items-start p-8 rounded-[2rem] bg-gray-50 border border-transparent hover:bg-white hover:border-primary-100 hover:shadow-xl transition-all group relative overflow-hidden">
              <div className="w-12 h-12 bg-primary-800 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 group-hover:rotate-6 transition-all duration-500">
                <Calendar className="h-6 w-6 text-primary-300" />
              </div>
              <span className="text-xs font-black text-gray-950 uppercase tracking-tight">Create Event</span>
              <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mt-2">Public Calendar</p>
              <Plus className="absolute top-6 right-6 w-4 h-4 text-gray-200 group-hover:text-primary-600 transition-colors" />
            </button>
            <button onClick={() => navigate('/messaging')} className="flex flex-col items-start p-8 rounded-[2rem] bg-gray-50 border border-transparent hover:bg-white hover:border-primary-100 hover:shadow-xl transition-all group relative overflow-hidden">
              <div className="w-12 h-12 bg-primary-900 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 group-hover:rotate-6 transition-all duration-500">
                <MessageSquare className="h-6 w-6 text-primary-200" />
              </div>
              <span className="text-xs font-black text-gray-950 uppercase tracking-tight">Manage Chats</span>
              <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mt-2">Inboxes</p>
              <Plus className="absolute top-6 right-6 w-4 h-4 text-gray-200 group-hover:text-primary-600 transition-colors" />
            </button>
            <button onClick={() => navigate('/materials')} className="flex flex-col items-start p-8 rounded-[2rem] bg-gray-50 border border-transparent hover:bg-white hover:border-primary-100 hover:shadow-xl transition-all group relative overflow-hidden">
              <div className="w-12 h-12 bg-slate-900 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 group-hover:rotate-6 transition-all duration-500">
                <Database className="h-6 w-6 text-primary-400" />
              </div>
              <span className="text-xs font-black text-gray-950 uppercase tracking-tight">Upload Materials</span>
              <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mt-2">Storage</p>
              <Plus className="absolute top-6 right-6 w-4 h-4 text-gray-200 group-hover:text-primary-600 transition-colors" />
            </button>
          </div>
        </div>

        {/* System Pulse & Alerts */}
        <div className="bg-white rounded-[2.5rem] border border-gray-100 shadow-sm p-10 group overflow-hidden relative transition-all duration-500 hover:shadow-2xl">
          <div className="flex items-center justify-between mb-10">
            <div>
              <h2 className="text-xl font-black text-gray-950 tracking-tight">Notifications</h2>
              <p className="text-[10px] font-black text-gray-300 uppercase tracking-widest mt-1">Pending alerts</p>
            </div>
            <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.6)]" />
          </div>
          
          <div className="space-y-5">
            {(census?.moderation?.pending_reports ?? 0) > 0 && (
              <div className="flex items-center gap-4 p-5 bg-amber-50 rounded-3xl border border-amber-100/50 hover:bg-amber-100 transition-colors cursor-pointer group/alert" onClick={() => navigate('/messaging')}>
                <div className="w-10 h-10 bg-amber-500 rounded-xl flex items-center justify-center text-white shadow-lg shadow-amber-500/20 group-hover/alert:scale-110 transition-transform">
                   <AlertCircle className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-xs font-black text-amber-950 uppercase tracking-tight">{census?.moderation?.pending_reports} Reports</p>
                  <p className="text-[10px] font-bold text-amber-600 uppercase tracking-widest">Review pending reports</p>
                </div>
              </div>
            )}
            {(census?.users?.banned ?? 0) > 0 && (
              <div className="flex items-center gap-4 p-5 bg-red-50 rounded-3xl border border-red-100/50 hover:bg-red-100 transition-colors cursor-pointer group/alert" onClick={() => navigate('/students')}>
                <div className="w-10 h-10 bg-red-500 rounded-xl flex items-center justify-center text-white shadow-lg shadow-red-500/20 group-hover/alert:scale-110 transition-transform">
                   <ShieldCheck className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-xs font-black text-red-950 uppercase tracking-tight">{census?.users?.banned} Banned Students</p>
                  <p className="text-[10px] font-bold text-red-600 uppercase tracking-widest">Manage blocked accounts</p>
                </div>
              </div>
            )}
            {storageTotal > STORAGE_LIMIT * 0.8 && (
              <div className="flex items-center gap-4 p-5 bg-primary-950 rounded-3xl border border-white/10 hover:bg-slate-900 transition-colors cursor-pointer group/alert text-white" onClick={() => navigate('/analytics')}>
                <div className="w-10 h-10 bg-primary-400 rounded-xl flex items-center justify-center text-primary-950 shadow-lg shadow-primary-400/20 group-hover/alert:scale-110 transition-transform text-white">
                   <Cloud className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-xs font-black uppercase tracking-tight">Storage Limit: {(storageTotal / STORAGE_LIMIT * 100).toFixed(0)}%</p>
                  <p className="text-[10px] font-bold text-primary-400 uppercase tracking-widest">Storage is almost full</p>
                </div>
              </div>
            )}
            {!census?.moderation?.pending_reports && !census?.users?.banned && (
              <div className="py-12 text-center">
                 <div className="w-20 h-20 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-6 shadow-inner">
                    <ShieldCheck className="w-10 h-10 text-green-500" />
                 </div>
                  <h3 className="text-xl font-black text-gray-950 uppercase tracking-tighter">System Status: Healthy</h3>
                  <p className="text-gray-500 font-bold uppercase tracking-[0.2em] text-[8px] max-w-[200px] mx-auto mt-2 leading-relaxed">No pending reports or issues detected.</p>
               </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}



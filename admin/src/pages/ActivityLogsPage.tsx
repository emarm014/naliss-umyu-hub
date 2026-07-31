import { useState, useMemo, useEffect } from 'react';
import { 
  History, 
  Search, 
  Filter, 
  Download, 
  Users, 
  BookOpen, 
  Calendar, 
  Megaphone, 
  MessageSquare, 
  Shield, 
  Server, 
  Activity,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  X,
  Eye,
  Copy,
  Check,
  Laptop,
  ShieldCheck,
  FileText,
  Clock
} from 'lucide-react';
import { useAdminDataStore } from '../store/adminData.store';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import ErrorState from '../components/ui/ErrorState';

export default function ActivityLogsPage() {
  const { activityLogs, isSyncing, error, syncAll, fetchActivityLogs } = useAdminDataStore();

  // Fast-fetch on mount — loads up to 500 logs immediately
  useEffect(() => { 
    fetchActivityLogs(); 
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [searchTerm, setSearchTerm] = useState('');
  const [filterSector, setFilterSector] = useState<string>('all');
  const [filterRole, setFilterRole] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedLog, setSelectedLog] = useState<any | null>(null);
  const [copied, setCopied] = useState(false);
  const itemsPerPage = 15;

  const filteredLogs = useMemo(() => {
    return activityLogs.filter(log => {
      // 1. Text search
      const q = searchTerm.toLowerCase();
      const matchesSearch = 
        !q ||
        log.action?.toLowerCase().includes(q) ||
        log.description?.toLowerCase().includes(q) ||
        (log.user?.full_name || '').toLowerCase().includes(q) ||
        (log.user?.email || '').toLowerCase().includes(q) ||
        (log.entity_type || '').toLowerCase().includes(q) ||
        (log.entity_id || '').toLowerCase().includes(q);

      // 2. Sector filter
      let matchesSector = true;
      if (filterSector === 'moderation') {
        matchesSector = log.action.includes('ban') || log.action.includes('suspend') || log.action.includes('restrict') || log.action.includes('verify') || log.action.includes('mute');
      } else if (filterSector === 'auth') {
        matchesSector = log.action.includes('auth') || log.action.includes('login');
      } else if (filterSector === 'user') {
        matchesSector = log.action.includes('user') || log.action.includes('role');
      } else if (filterSector === 'material') {
        matchesSector = log.action.includes('material') || log.action.includes('upload') || log.action.includes('past_question');
      } else if (filterSector === 'announcement') {
        matchesSector = log.action.includes('announcement');
      } else if (filterSector === 'event') {
        matchesSector = log.action.includes('event');
      } else if (filterSector === 'group') {
        matchesSector = log.action.includes('group') || log.action.includes('message');
      } else if (filterSector === 'settings') {
        matchesSector = log.action.includes('setting') || log.action.includes('security');
      }

      // 3. Role filter (Moderator actions vs Super Admin vs Student)
      let matchesRole = true;
      const actorRole = log.user?.role || log.metadata?.actor?.role;
      const isExternal = log.user?.is_external || log.metadata?.actor?.is_external;

      if (filterRole === 'moderator_all') {
        matchesRole = actorRole === 'moderator';
      } else if (filterRole === 'student_moderator') {
        matchesRole = actorRole === 'moderator' && !isExternal;
      } else if (filterRole === 'external_moderator') {
        matchesRole = actorRole === 'moderator' && isExternal;
      } else if (filterRole === 'super_admin') {
        matchesRole = actorRole === 'super_admin';
      }

      return matchesSearch && matchesSector && matchesRole;
    });
  }, [activityLogs, searchTerm, filterSector, filterRole]);

  // Summary statistics for executive oversight
  const stats = useMemo(() => {
    const total = activityLogs.length;
    const moderatorLogs = activityLogs.filter(l => (l.user?.role || l.metadata?.actor?.role) === 'moderator').length;
    const adminLogs = activityLogs.filter(l => (l.user?.role || l.metadata?.actor?.role) === 'super_admin').length;
    const securityLogs = activityLogs.filter(l => l.action.includes('ban') || l.action.includes('suspend') || l.action.includes('auth.login_failed')).length;
    return { total, moderatorLogs, adminLogs, securityLogs };
  }, [activityLogs]);

  const totalPages = Math.ceil(filteredLogs.length / itemsPerPage);
  const paginatedLogs = filteredLogs.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const getActionIcon = (action: string) => {
    if (action.includes('auth')) return <Shield className="w-4 h-4" />;
    if (action.includes('user') || action.includes('role')) return <Users className="w-4 h-4" />;
    if (action.includes('material') || action.includes('upload') || action.includes('past_question')) return <BookOpen className="w-4 h-4" />;
    if (action.includes('event')) return <Calendar className="w-4 h-4" />;
    if (action.includes('announcement')) return <Megaphone className="w-4 h-4" />;
    if (action.includes('message') || action.includes('group')) return <MessageSquare className="w-4 h-4" />;
    if (action.includes('ban') || action.includes('suspend') || action.includes('restrict')) return <ShieldAlertIcon className="w-4 h-4" />;
    if (action.includes('setting')) return <Server className="w-4 h-4" />;
    return <Activity className="w-4 h-4" />;
  };

  const getActionColor = (action: string) => {
    if (action.includes('auth.login_failed') || action.includes('ban') || action.includes('delete')) return 'bg-red-50 text-red-600 border-red-200';
    if (action.includes('auth.login_success') || action.includes('create') || action.includes('verify')) return 'bg-emerald-50 text-emerald-600 border-emerald-200';
    if (action.includes('suspend') || action.includes('edit') || action.includes('update') || action.includes('restrict')) return 'bg-amber-50 text-amber-600 border-amber-200';
    if (action.includes('auth')) return 'bg-purple-50 text-purple-600 border-purple-200';
    return 'bg-blue-50 text-blue-600 border-blue-200';
  };

  const formatDateTime = (dateString: string) => {
    if (!dateString) return { date: 'N/A', time: 'N/A', relative: '' };
    const date = new Date(dateString);
    return {
      date: date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
      time: date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      full: date.toLocaleString('en-GB', { dateStyle: 'full', timeStyle: 'medium' })
    };
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const exportLogs = () => {
    const headers = ['ID', 'Action', 'Entity Type', 'Entity ID', 'Actor Name', 'Actor Email', 'Actor Role', 'Description', 'Timestamp', 'IP Address'];
    const rows = filteredLogs.map(log => {
      const dt = formatDateTime(log.created_at);
      const actorRole = log.user?.role || log.metadata?.actor?.role || 'system';
      return [
        log.id,
        log.action,
        log.entity_type || 'N/A',
        log.entity_id || 'N/A',
        `"${(log.user?.full_name || log.metadata?.actor?.full_name || 'System').replace(/"/g, '""')}"`,
        log.user?.email || log.metadata?.actor?.email || 'N/A',
        actorRole,
        `"${(log.description || '').replace(/"/g, '""')}"`,
        `"${dt.full}"`,
        log.ip_address || 'Internal'
      ];
    });

    const csvContent = [headers, ...rows].map(row => row.join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `NALISS_Audit_Report_${new Date().toISOString().split('T')[0]}.csv`);
    link.click();
  };

  if (isSyncing && activityLogs.length === 0) {
    return (
      <div className="flex items-center justify-center h-[70vh]">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (error && activityLogs.length === 0) {
    return (
      <div className="p-8">
        <ErrorState message={error} onRetry={() => syncAll(true)} />
      </div>
    );
  }

  return (
    <div className="p-8 lg:p-12 max-w-[1600px] mx-auto space-y-8 animate-in fade-in duration-500 pb-16">
      {/* HEADER */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 pb-6 border-b border-gray-100">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <History className="w-5 h-5 text-primary-600" />
            <span className="text-[10px] font-black uppercase tracking-widest text-primary-600">Audit Ledger & Forensics</span>
          </div>
          <h1 className="text-4xl font-black text-gray-950 tracking-tight uppercase">System Activity Reports</h1>
          <p className="text-gray-400 mt-2 font-medium">Complete, timestamped audit trail of all super admin and moderator actions across the platform.</p>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={exportLogs}
            disabled={filteredLogs.length === 0}
            className="flex items-center gap-2 px-6 py-3.5 bg-white border border-slate-200 rounded-2xl text-xs font-black uppercase tracking-widest text-slate-700 hover:bg-slate-50 transition-all disabled:opacity-50 shadow-sm"
          >
            <Download className="w-4 h-4 text-emerald-600" />
            Export Audit Report (CSV)
          </button>
          <button 
            onClick={() => fetchActivityLogs()}
            disabled={isSyncing}
            className="flex items-center gap-2 px-6 py-3.5 bg-primary-950 text-white rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-slate-900 transition-all disabled:opacity-50 shadow-xl shadow-primary-950/20"
          >
            <Activity className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
            Refresh Audit Logs
          </button>
        </div>
      </div>

      {/* EXECUTIVE STATS OVERVIEW */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-all border-b-4 border-b-primary-950">
          <div className="flex items-center justify-between mb-3">
            <div className="w-10 h-10 bg-primary-50 rounded-xl flex items-center justify-center text-primary-600">
              <History className="w-5 h-5" />
            </div>
            <span className="text-[9px] font-black text-primary-600 bg-primary-50 px-2 py-1 rounded-md tracking-wider">TOTAL LOGS</span>
          </div>
          <h3 className="text-3xl font-black text-slate-900 leading-none">{stats.total}</h3>
          <p className="text-slate-400 text-xs mt-2 font-semibold">Recorded platform actions</p>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-all border-b-4 border-b-amber-500">
          <div className="flex items-center justify-between mb-3">
            <div className="w-10 h-10 bg-amber-50 rounded-xl flex items-center justify-center text-amber-600">
              <Shield className="w-5 h-5" />
            </div>
            <span className="text-[9px] font-black text-amber-600 bg-amber-50 px-2 py-1 rounded-md tracking-wider">MODERATOR ACTIONS</span>
          </div>
          <h3 className="text-3xl font-black text-slate-900 leading-none">{stats.moderatorLogs}</h3>
          <p className="text-slate-400 text-xs mt-2 font-semibold">Actions by assigned moderators</p>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-all border-b-4 border-b-emerald-500">
          <div className="flex items-center justify-between mb-3">
            <div className="w-10 h-10 bg-emerald-50 rounded-xl flex items-center justify-center text-emerald-600">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <span className="text-[9px] font-black text-emerald-600 bg-emerald-50 px-2 py-1 rounded-md tracking-wider">SUPER ADMIN ACTIONS</span>
          </div>
          <h3 className="text-3xl font-black text-slate-900 leading-none">{stats.adminLogs}</h3>
          <p className="text-slate-400 text-xs mt-2 font-semibold">Super admin configuration logs</p>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-all border-b-4 border-b-red-500">
          <div className="flex items-center justify-between mb-3">
            <div className="w-10 h-10 bg-red-50 rounded-xl flex items-center justify-center text-red-600">
              <AlertCircle className="w-5 h-5" />
            </div>
            <span className="text-[9px] font-black text-red-600 bg-red-50 px-2 py-1 rounded-md tracking-wider">SECURITY EVENTS</span>
          </div>
          <h3 className="text-3xl font-black text-slate-900 leading-none">{stats.securityLogs}</h3>
          <p className="text-slate-400 text-xs mt-2 font-semibold">Bans, suspensions & security locks</p>
        </div>
      </div>

      {/* FILTER & SEARCH BAR */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
        {/* Search */}
        <div className="md:col-span-6 relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input 
            type="text" 
            placeholder="Search logs by description, action code, actor name, or target ID..."
            className="w-full pl-12 pr-4 py-4 bg-white border border-slate-200 rounded-3xl text-sm font-semibold text-slate-900 focus:ring-2 focus:ring-primary-950 transition-all shadow-sm"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        {/* Sector Filter */}
        <div className="md:col-span-3 relative">
          <Filter className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <select 
            className="w-full pl-12 pr-4 py-4 bg-white border border-slate-200 rounded-3xl text-xs font-bold text-slate-800 appearance-none focus:ring-2 focus:ring-primary-950 transition-all shadow-sm uppercase tracking-wider"
            value={filterSector}
            onChange={(e) => setFilterSector(e.target.value)}
          >
            <option value="all">All Action Sectors</option>
            <option value="moderation">🛡️ Moderation & Enforcement</option>
            <option value="user">👤 User Management & Roles</option>
            <option value="auth">🔐 Authentication & Access</option>
            <option value="material">📚 Academic Materials & Cloud</option>
            <option value="announcement">📢 Announcements</option>
            <option value="event">🎉 Events & Event Pools</option>
            <option value="group">💬 Groups & Messaging</option>
            <option value="settings">⚙️ System Settings</option>
          </select>
        </div>

        {/* Actor Role Filter */}
        <div className="md:col-span-3 relative">
          <Users className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <select 
            className="w-full pl-12 pr-4 py-4 bg-white border border-slate-200 rounded-3xl text-xs font-bold text-slate-800 appearance-none focus:ring-2 focus:ring-primary-950 transition-all shadow-sm uppercase tracking-wider"
            value={filterRole}
            onChange={(e) => setFilterRole(e.target.value)}
          >
            <option value="all">All Actor Roles</option>
            <option value="moderator_all">🛡️ Moderator Actions Only</option>
            <option value="student_moderator">🎓 Student Moderator Actions</option>
            <option value="external_moderator">🌐 External Moderator Actions</option>
            <option value="super_admin">👑 Super Admin Actions</option>
          </select>
        </div>
      </div>

      {/* TAPPABLE REPORT TABLE */}
      <div className="bg-white rounded-[2.5rem] border border-slate-200/80 shadow-sm overflow-hidden overflow-x-auto relative">
        <div className="px-8 py-4 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
            Showing {paginatedLogs.length} of {filteredLogs.length} audit entries • <span className="text-primary-700">Click any row to read full audit report</span>
          </p>
        </div>

        <table className="w-full text-left border-collapse min-w-[900px]">
          <thead>
            <tr className="bg-slate-50/50">
              <th className="px-8 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400 border-b border-slate-100">Timestamp</th>
              <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400 border-b border-slate-100">Action & Sector</th>
              <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400 border-b border-slate-100">Performer / Actor</th>
              <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400 border-b border-slate-100">Report Summary</th>
              <th className="px-6 py-4 text-center text-[10px] font-black uppercase tracking-widest text-slate-400 border-b border-slate-100">IP / Device</th>
              <th className="px-6 py-4 text-right text-[10px] font-black uppercase tracking-widest text-slate-400 border-b border-slate-100">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {paginatedLogs.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-20 text-center">
                  <div className="mb-4 w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto border border-slate-200">
                    <History className="w-8 h-8 text-slate-300" />
                  </div>
                  <p className="text-sm font-bold text-slate-700">No activity logs found matching criteria.</p>
                  <p className="text-xs text-slate-400 mt-1 font-medium">Try clearing your search query or filter selections.</p>
                </td>
              </tr>
            ) : (
              paginatedLogs.map((log) => {
                const dt = formatDateTime(log.created_at);
                const actorName = log.user?.full_name || log.metadata?.actor?.full_name || 'System Auto';
                const actorEmail = log.user?.email || log.metadata?.actor?.email || '';
                const actorRole = log.user?.role || log.metadata?.actor?.role || 'admin';
                const isExternal = log.user?.is_external || log.metadata?.actor?.is_external;

                return (
                  <tr 
                    key={log.id} 
                    onClick={() => setSelectedLog(log)}
                    className="group hover:bg-slate-50/80 transition-colors cursor-pointer"
                  >
                    <td className="px-8 py-5">
                      <div className="flex flex-col">
                        <span className="text-xs font-black text-slate-900 tracking-tight">{dt.date}</span>
                        <span className="text-[10px] font-bold text-slate-400 italic mt-0.5">{dt.time}</span>
                      </div>
                    </td>

                    <td className="px-6 py-5">
                      <div className="flex items-center gap-3">
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center border shadow-sm group-hover:scale-105 transition-transform ${getActionColor(log.action)}`}>
                          {getActionIcon(log.action)}
                        </div>
                        <div>
                          <p className="text-xs font-black text-slate-900 leading-tight uppercase tracking-tight">
                            {log.action.replace(/\./g, ' → ').replace(/_/g, ' ')}
                          </p>
                          <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mt-0.5 inline-block">
                            {log.entity_type || 'System'}
                          </span>
                        </div>
                      </div>
                    </td>

                    <td className="px-6 py-5">
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-[10px] font-black shrink-0 ${
                          actorRole === 'super_admin' ? 'bg-primary-950 text-primary-400 border border-primary-800' :
                          isExternal ? 'bg-amber-100 text-amber-800 border border-amber-200' :
                          'bg-emerald-100 text-emerald-800 border border-emerald-200'
                        }`}>
                          {actorName.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-black text-slate-900 truncate max-w-[140px]">{actorName}</p>
                          {actorEmail && <p className="text-[9px] text-slate-400 font-semibold truncate max-w-[140px]">{actorEmail}</p>}
                          <div className="flex items-center gap-1 mt-0.5">
                            {actorRole === 'super_admin' ? (
                              <span className="px-1.5 py-0.5 bg-slate-900 text-primary-400 text-[8px] font-black rounded uppercase tracking-wider">Super Admin</span>
                            ) : isExternal ? (
                              <span className="px-1.5 py-0.5 bg-amber-100 text-amber-800 text-[8px] font-black rounded uppercase tracking-wider">Ext. Moderator</span>
                            ) : actorRole === 'moderator' ? (
                              <span className="px-1.5 py-0.5 bg-emerald-100 text-emerald-800 text-[8px] font-black rounded uppercase tracking-wider">Student Mod</span>
                            ) : (
                              <span className="text-[9px] font-bold text-slate-400 uppercase">User</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>

                    <td className="px-6 py-5">
                      <p className="text-xs font-medium text-slate-600 leading-relaxed max-w-sm line-clamp-2 italic">
                        {log.description || 'Action recorded.'}
                      </p>
                    </td>

                    <td className="px-6 py-5 text-center">
                      <div className="inline-flex px-2.5 py-1 bg-slate-100 rounded-lg items-center gap-1.5 border border-slate-200/80">
                        <Server className="w-3 h-3 text-slate-400" />
                        <span className="text-[9px] font-mono font-bold text-slate-600 tracking-wider uppercase">
                          {log.ip_address || 'System'}
                        </span>
                      </div>
                    </td>

                    <td className="px-6 py-5 text-right">
                      <span className="inline-flex items-center gap-1 text-[10px] font-black text-primary-700 bg-primary-50 group-hover:bg-primary-950 group-hover:text-white px-3 py-1.5 rounded-xl transition-all">
                        <Eye className="w-3.5 h-3.5" />
                        Report
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* PAGINATION */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-2">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] italic">
            Page {currentPage} of {totalPages} — Showing {paginatedLogs.length} audit entries
          </p>
          <div className="flex items-center gap-2">
            <button 
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="p-3 bg-white border border-slate-200 rounded-xl text-slate-400 hover:bg-slate-50 disabled:opacity-30 transition-all shadow-sm"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button 
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="p-3 bg-white border border-slate-200 rounded-xl text-slate-400 hover:bg-slate-50 disabled:opacity-30 transition-all shadow-sm"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}

      {/* DETAILED AUDIT REPORT MODAL */}
      {selectedLog && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-md animate-in fade-in duration-300">
          <div className="bg-white w-full max-w-3xl rounded-[2.5rem] shadow-2xl overflow-hidden border border-slate-100 flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-300">
            {/* Modal Header */}
            <div className="px-8 py-6 bg-slate-950 text-white flex items-center justify-between border-b border-slate-800">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-primary-900 border border-primary-700 rounded-xl flex items-center justify-center text-primary-400">
                  <FileText className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 bg-primary-900 text-primary-300 text-[8px] font-black rounded uppercase tracking-widest border border-primary-700">Official Report</span>
                    <span className="text-[10px] font-mono text-slate-400">ID: {selectedLog.id}</span>
                  </div>
                  <h2 className="text-lg font-black tracking-tight text-white uppercase mt-0.5">
                    {selectedLog.action?.replace(/\./g, ' → ')?.replace(/_/g, ' ')}
                  </h2>
                </div>
              </div>
              <button 
                onClick={() => setSelectedLog(null)} 
                className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-all"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-8 overflow-y-auto space-y-6 flex-1">
              {/* Actor Card */}
              <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200/80 space-y-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Actor / Performer Information</p>
                
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-2xl bg-primary-950 text-primary-400 border border-primary-800 flex items-center justify-center text-lg font-black">
                      {(selectedLog.user?.full_name || selectedLog.metadata?.actor?.full_name || 'S').charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <h3 className="text-base font-black text-slate-900">
                        {selectedLog.user?.full_name || selectedLog.metadata?.actor?.full_name || 'System Automated Task'}
                      </h3>
                      <p className="text-xs text-slate-500 font-semibold mt-0.5">
                        {selectedLog.user?.email || selectedLog.metadata?.actor?.email || 'N/A'}
                      </p>
                    </div>
                  </div>

                  {/* Role Tag */}
                  <div>
                    {selectedLog.user?.role === 'super_admin' || selectedLog.metadata?.actor?.role === 'super_admin' ? (
                      <span className="px-3 py-1.5 bg-primary-950 text-white text-xs font-black rounded-xl uppercase tracking-wider shadow-md">
                        👑 Super Admin
                      </span>
                    ) : selectedLog.user?.is_external || selectedLog.metadata?.actor?.is_external ? (
                      <span className="px-3 py-1.5 bg-amber-500 text-white text-xs font-black rounded-xl uppercase tracking-wider shadow-md">
                        🌐 External Moderator
                      </span>
                    ) : (selectedLog.user?.role === 'moderator' || selectedLog.metadata?.actor?.role === 'moderator') ? (
                      <span className="px-3 py-1.5 bg-emerald-600 text-white text-xs font-black rounded-xl uppercase tracking-wider shadow-md">
                        🎓 Student Moderator
                      </span>
                    ) : (
                      <span className="px-3 py-1.5 bg-slate-200 text-slate-800 text-xs font-black rounded-xl uppercase tracking-wider">
                        User / System
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Action & Timestamp Details Grid */}
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200/80">
                  <div className="flex items-center gap-2 text-slate-400 mb-1">
                    <Clock className="w-3.5 h-3.5" />
                    <span className="text-[9px] font-black uppercase tracking-widest">Exact Timestamp</span>
                  </div>
                  <p className="text-xs font-black text-slate-900">
                    {formatDateTime(selectedLog.created_at).full}
                  </p>
                </div>

                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200/80">
                  <div className="flex items-center gap-2 text-slate-400 mb-1">
                    <Laptop className="w-3.5 h-3.5" />
                    <span className="text-[9px] font-black uppercase tracking-widest">IP Address / Source</span>
                  </div>
                  <p className="text-xs font-mono font-bold text-slate-900">
                    {selectedLog.ip_address || 'Internal App Protocol'}
                  </p>
                </div>
              </div>

              {/* Target Entity Information */}
              <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200/80 grid grid-cols-2 gap-4">
                <div>
                  <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 block mb-1">Entity Type</span>
                  <span className="px-2.5 py-1 bg-white border border-slate-200 rounded-lg text-xs font-black uppercase tracking-wider text-slate-800 inline-block">
                    {selectedLog.entity_type || 'System'}
                  </span>
                </div>
                <div>
                  <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 block mb-1">Entity ID</span>
                  <span className="text-xs font-mono font-bold text-slate-900 truncate block">
                    {selectedLog.entity_id || 'N/A'}
                  </span>
                </div>
              </div>

              {/* Narrative Description */}
              <div className="p-5 bg-white border border-slate-200 rounded-2xl space-y-2">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Report Narrative & Description</p>
                <p className="text-sm font-semibold text-slate-800 leading-relaxed italic">
                  "{selectedLog.description}"
                </p>
              </div>

              {/* JSON Metadata Payload Explorer */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Action Metadata & Payload</p>
                  <button 
                    onClick={() => copyToClipboard(JSON.stringify(selectedLog, null, 2))}
                    className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-primary-700 hover:text-primary-900 bg-primary-50 px-3 py-1 rounded-lg border border-primary-100 transition-all"
                  >
                    {copied ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                    {copied ? 'Copied JSON!' : 'Copy Full JSON'}
                  </button>
                </div>

                <div className="bg-slate-950 p-5 rounded-2xl text-emerald-400 font-mono text-xs overflow-x-auto border border-slate-800 shadow-inner max-h-60">
                  <pre>{JSON.stringify(selectedLog.metadata || { description: selectedLog.description }, null, 2)}</pre>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-8 py-5 bg-slate-50 border-t border-slate-100 flex items-center justify-end">
              <button
                onClick={() => setSelectedLog(null)}
                className="px-6 py-3 bg-slate-950 text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-slate-900 transition-all"
              >
                Close Report
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AUDIT POLICY FOOTER */}
      <div className="bg-amber-50 border border-amber-100 rounded-[2rem] p-6 flex items-start gap-4">
        <div className="p-3 bg-amber-500 rounded-xl">
           <AlertCircle className="w-5 h-5 text-white" />
        </div>
        <div>
          <h4 className="text-sm font-black text-amber-900 tracking-tight mb-1 uppercase tracking-widest">Official Audit Policy Advisory</h4>
          <p className="text-xs text-amber-800 leading-relaxed font-medium">
            This activity log is an immutable, timestamped official ledger. All super admin and moderator actions are automatically attributed to enforce full security accountability. Click any entry to inspect full metadata payload reports.
          </p>
        </div>
      </div>
    </div>
  );
}

function ShieldAlertIcon(props: any) {
  return <Shield {...props} />;
}

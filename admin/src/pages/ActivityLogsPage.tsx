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
  ChevronRight
} from 'lucide-react';
import { useAdminDataStore } from '../store/adminData.store';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import ErrorState from '../components/ui/ErrorState';

export default function ActivityLogsPage() {
  const { activityLogs, isSyncing, error, syncAll, fetchActivityLogs } = useAdminDataStore();

  // Fast-fetch on mount — loads up to 200 logs immediately, not the whole app sync
  useEffect(() => { fetchActivityLogs(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [searchTerm, setSearchTerm] = useState('');
  const [filterAction, setFilterAction] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 15;

  const filteredLogs = useMemo(() => {
    return activityLogs.filter(log => {
      const matchesSearch = 
        log.action.toLowerCase().includes(searchTerm.toLowerCase()) ||
        log.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (log.user?.full_name || '').toLowerCase().includes(searchTerm.toLowerCase());
      
      const matchesFilter = filterAction === 'all' || log.action.toLowerCase().includes(filterAction.toLowerCase());
      
      return matchesSearch && matchesFilter;
    });
  }, [activityLogs, searchTerm, filterAction]);

  const totalPages = Math.ceil(filteredLogs.length / itemsPerPage);
  const paginatedLogs = filteredLogs.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const getActionIcon = (action: string) => {
    if (action.includes('auth')) return <Shield className="w-4 h-4" />;
    if (action.includes('user')) return <Users className="w-4 h-4" />;
    if (action.includes('material') || action.includes('upload')) return <BookOpen className="w-4 h-4" />;
    if (action.includes('event')) return <Calendar className="w-4 h-4" />;
    if (action.includes('announcement')) return <Megaphone className="w-4 h-4" />;
    if (action.includes('message')) return <MessageSquare className="w-4 h-4" />;
    if (action.includes('ban') || action.includes('suspend')) return <Shield className="w-4 h-4" />;
    if (action.includes('settings')) return <Server className="w-4 h-4" />;
    return <Activity className="w-4 h-4" />;
  };

  const getActionColor = (action: string) => {
    if (action.includes('auth.login_failed')) return 'bg-red-50 text-red-600 border-red-200';
    if (action.includes('auth.login_success')) return 'bg-emerald-50 text-emerald-600 border-emerald-200';
    if (action.includes('auth')) return 'bg-purple-50 text-purple-500 border-purple-100';
    if (action.includes('ban') || action.includes('delete')) return 'bg-red-50 text-red-500 border-red-100';
    if (action.includes('suspend') || action.includes('edit') || action.includes('update')) return 'bg-amber-50 text-amber-500 border-amber-100';
    if (action.includes('create') || action.includes('upload')) return 'bg-emerald-50 text-emerald-500 border-emerald-100';
    return 'bg-blue-50 text-blue-500 border-blue-100';
  };

  const formatDateTime = (dateString: string) => {
    const date = new Date(dateString);
    return {
      date: date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
      time: date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    };
  };

  const exportLogs = () => {
    const headers = ['Action', 'Description', 'Entity', 'Actor', 'Date', 'Time'];
    const rows = filteredLogs.map(log => {
      const dt = formatDateTime(log.created_at);
      return [
        log.action,
        `"${log.description.replace(/"/g, '""')}"`,
        log.entity_type || 'N/A',
        log.user?.full_name || 'System',
        dt.date,
        dt.time
      ];
    });

    const csvContent = [headers, ...rows].map(row => row.join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `NALISS_Activity_Logs_${new Date().toISOString().split('T')[0]}.csv`);
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
    <div className="p-8 lg:p-12 max-w-7xl mx-auto space-y-8 animate-in fade-in duration-500">
      {/* HEADER */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 pb-6 border-b border-gray-100">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <History className="w-5 h-5 text-primary-600" />
            <span className="text-[10px] font-black uppercase tracking-widest text-primary-600">Audit Log</span>
          </div>
          <h1 className="text-4xl font-black text-gray-950 tracking-tight">Activity Ledger</h1>
          <p className="text-gray-400 mt-2 font-medium">Sequential audit trail of administrative actions.</p>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={exportLogs}
            disabled={filteredLogs.length === 0}
            className="flex items-center gap-2 px-5 py-3 bg-white border border-gray-200 rounded-2xl text-[10px] font-black uppercase tracking-widest text-gray-700 hover:bg-gray-50 transition-all disabled:opacity-50 shadow-sm"
          >
            <Download className="w-3.5 h-3.5" />
            Export Archive
          </button>
          <button 
            onClick={() => syncAll(true)}
            disabled={isSyncing}
            className="flex items-center gap-2 px-5 py-3 bg-primary-950 text-primary-400 border border-primary-800 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-primary-900 transition-all disabled:opacity-50 shadow-xl"
          >
            <Activity className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
            Sync Ledger
          </button>
        </div>
      </div>

      {/* FILTER & SEARCH */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="md:col-span-2 relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input 
            type="text" 
            placeholder="Search by action, description or actor..."
            className="w-full pl-12 pr-4 py-4 bg-white border border-gray-100 rounded-3xl text-sm focus:ring-2 focus:ring-primary-500 transition-all shadow-sm"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="relative">
          <Filter className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <select 
            className="w-full pl-12 pr-4 py-4 bg-white border border-gray-100 rounded-3xl text-sm appearance-none focus:ring-2 focus:ring-primary-500 transition-all shadow-sm font-medium"
            value={filterAction}
            onChange={(e) => setFilterAction(e.target.value)}
          >
            <option value="all">All Actions</option>
            <option value="auth">Authentication</option>
            <option value="user">User Related</option>
            <option value="material">Materials</option>
            <option value="announcement">Announcements</option>
            <option value="event">Events</option>
            <option value="group">Groups</option>
            <option value="settings">System Settings</option>
            <option value="moderation">Moderation</option>
          </select>
        </div>
        <div className="bg-primary-50 px-6 py-4 rounded-3xl border border-primary-100 flex items-center justify-between">
          <div className="flex flex-col">
            <span className="text-[9px] font-black uppercase tracking-widest text-primary-600">Total Entries</span>
            <span className="text-xl font-black text-primary-950 tracking-tighter">{filteredLogs.length}</span>
          </div>
          <History className="w-8 h-8 text-primary-200" />
        </div>
      </div>

      {/* TABLE */}
      <div className="bg-white rounded-[2.5rem] border border-gray-100 shadow-sm overflow-hidden overflow-x-auto relative">
        <table className="w-full text-left border-collapse min-w-[800px]">
          <thead>
            <tr className="bg-gray-50/50">
              <th className="px-8 py-5 text-[10px] font-black uppercase tracking-widest text-gray-400 border-b border-gray-100">Timestamp</th>
              <th className="px-6 py-5 text-[10px] font-black uppercase tracking-widest text-gray-400 border-b border-gray-100">Action & Sector</th>
              <th className="px-6 py-5 text-[10px] font-black uppercase tracking-widest text-gray-400 border-b border-gray-100">Actor</th>
              <th className="px-6 py-5 text-[10px] font-black uppercase tracking-widest text-gray-400 border-b border-gray-100">Details</th>
              <th className="px-8 py-5 text-center text-[10px] font-black uppercase tracking-widest text-gray-400 border-b border-gray-100">IP/Device</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {paginatedLogs.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-20 text-center">
                  <div className="mb-4 w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mx-auto border border-gray-100">
                    <History className="w-8 h-8 text-gray-200" />
                  </div>
                  <p className="text-sm font-medium text-gray-400 mt-2">All system subsystems are operating within healthy parameters.</p>
                </td>
              </tr>
            ) : (
              paginatedLogs.map((log) => {
                const dt = formatDateTime(log.created_at);
                return (
                  <tr key={log.id} className="group hover:bg-gray-50/50 transition-colors">
                    <td className="px-8 py-6">
                      <div className="flex flex-col">
                        <span className="text-[11px] font-black text-gray-950 tracking-tight">{dt.date}</span>
                        <span className="text-[10px] font-bold text-gray-400 italic mt-0.5">{dt.time}</span>
                      </div>
                    </td>
                    <td className="px-6 py-6">
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-2xl flex items-center justify-center border shadow-sm group-hover:scale-110 transition-transform ${getActionColor(log.action)}`}>
                          {getActionIcon(log.action)}
                        </div>
                        <div>
                          <p className="text-xs font-black text-gray-900 leading-tight uppercase tracking-tight">{log.action.replace(/\./g, ' → ').replace(/_/g, ' ')}</p>
                          <span className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mt-1 inline-block">{log.entity_type || 'System'}</span>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-6 text-sm font-medium">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-primary-950 rounded-xl flex items-center justify-center text-[10px] font-black text-primary-400 border border-primary-800 shrink-0">
                          {log.user?.full_name?.charAt(0) || 'S'}
                        </div>
                        <div>
                          <p className="text-xs font-black text-gray-950 truncate max-w-[120px]">{log.user?.full_name || 'System Auto'}</p>
                          <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">Administrator</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-6">
                      <p className="text-xs font-medium text-gray-500 leading-relaxed max-w-sm line-clamp-2 italic">
                        {log.description}
                      </p>
                    </td>
                    <td className="px-8 py-6">
                       <div className="flex flex-col items-center">
                         <div className="px-2 py-1 bg-gray-100 rounded-md flex items-center gap-1.5 border border-gray-200">
                           <Server className="w-3 h-3 text-gray-400" />
                           <span className="text-[9px] font-black text-gray-500 tracking-widest uppercase">{log.ip_address || 'Internal'}</span>
                         </div>
                       </div>
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
          <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] italic">
            Page {currentPage} of {totalPages} — Showing {paginatedLogs.length} entries
          </p>
          <div className="flex items-center gap-2">
            <button 
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="p-3 bg-white border border-gray-200 rounded-xl text-gray-400 hover:bg-gray-50 disabled:opacity-30 transition-all shadow-sm"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button 
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="p-3 bg-white border border-gray-200 rounded-xl text-gray-400 hover:bg-gray-50 disabled:opacity-30 transition-all shadow-sm"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}

      {/* FOOTER ADVISORY */}
      <div className="bg-amber-50 border border-amber-100 rounded-[2rem] p-6 flex items-start gap-4">
        <div className="p-3 bg-amber-500 rounded-xl">
           <AlertCircle className="w-5 h-5 text-white" />
        </div>
        <div>
          <h4 className="text-sm font-black text-amber-900 tracking-tight mb-1 uppercase tracking-widest">Audit Policy Advisory</h4>
          <p className="text-xs text-amber-800 leading-relaxed font-medium">
            This log is a permanent official record. All administrative actions are timestamped and attributed to ensure accountability across the NALISS Platform. Any detected issues should be cross-referenced with detailed reports in the Analytics page.
          </p>
        </div>
      </div>
    </div>
  );
}

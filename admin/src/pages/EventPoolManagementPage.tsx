import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { Trophy, Settings, Activity, CheckCircle, Edit, Save, X, Users, Plus } from 'lucide-react';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import ErrorState from '../components/ui/ErrorState';
import Modal from '../components/ui/Modal';

type EventPool = {
 id: string;
 title: string;
 type: string;
 status: string;
 participation_rule: string;
 target_constraints: any;
 registration_open: string;
 registration_close: string;
 start_time: string;
 end_time: string;
 description: string;
};

type Submission = {
 id: string;
 user_id: string;
 answers: any;
 grading_status: string;
 grading_score: number | null;
 grading_feedback: string | null;
 podium_status: string | null;
 users: { full_name: string; username: string };
};

export default function EventPoolManagementPage() {
 const [pools, setPools] = useState<EventPool[]>([]);
 const [selectedPool, setSelectedPool] = useState<EventPool | null>(null);
 const [submissions, setSubmissions] = useState<Submission[]>([]);
 const [applications, setApplications] = useState<any[]>([]);
 const [participantsCount, setParticipantsCount] = useState(0);
 const [isLoading, setIsLoading] = useState(true);
 const [error, setError] = useState<string | null>(null);

 // Active View inside Modal: 'config' | 'monitor' | 'evaluate' | 'applications'
 const [activeView, setActiveView] = useState<'config' | 'monitor' | 'evaluate' | 'applications'>('config');

 // Evaluator states
 const [editingSubId, setEditingSubId] = useState<string | null>(null);
 const [scoreInput, setScoreInput] = useState('');
 const [feedbackInput, setFeedbackInput] = useState('');
 const [podiumInput, setPodiumInput] = useState('');

 const [showCreateModal, setShowCreateModal] = useState(false);
 const [newPoolTitle, setNewPoolTitle] = useState('');
 const [newPoolType, setNewPoolType] = useState('quiz');
 const [events, setEvents] = useState<any[]>([]);
 const [selectedEventId, setSelectedEventId] = useState('');

 useEffect(() => {
 fetchPools();
 fetchEvents();
 }, []);

 const fetchEvents = async () => {
 const { data } = await supabase.from('events').select('id, title').in('status', ['published', 'ongoing']);
 if (data) setEvents(data);
 };

 const fetchPools = async () => {
 setIsLoading(true);
 try {
 const { data, error } = await supabase.from('event_pools').select('*').order('created_at', { ascending: false });
 if (error) throw error;
 setPools(data || []);
 } catch (e: any) {
 setError(e.message);
 } finally {
 setIsLoading(false);
 }
 };

 const handleCreatePool = async (e: React.FormEvent) => {
 e.preventDefault();
 try {
 const { error } = await supabase.from('event_pools').insert({
 title: newPoolTitle,
 type: newPoolType,
 status: 'draft',
 participation_rule: 'open',
 event_id: selectedEventId || null
 });
 if (error) throw error;
 setShowCreateModal(false);
 setNewPoolTitle('');
 setNewPoolType('quiz');
 setSelectedEventId('');
 fetchPools();
 } catch (e: any) {
 alert('Failed to create event pool: ' + e.message);
 }
 };

 const loadPoolDetails = async (pool: EventPool) => {
 setSelectedPool(pool);
 setActiveView('config');
 try {
 // Fetch metrics
 const { count: pCount } = await supabase.from('pool_participants').select('*', { count: 'exact', head: true }).eq('pool_id', pool.id);
 setParticipantsCount(pCount || 0);

 // Fetch submissions
 const { data: subs } = await supabase.from('pool_submissions').select('id, user_id, answers, grading_status, grading_score, grading_feedback, podium_status, users:user_id(full_name, username)').eq('pool_id', pool.id);
 setSubmissions(subs ? subs.map((s: any) => ({ ...s, users: Array.isArray(s.users) ? s.users[0] : s.users })) : []);
 
 // Fetch applications
 const { data: apps } = await supabase.from('pool_applications').select('id, user_id, status, created_at, users:user_id(full_name, username)').eq('pool_id', pool.id).order('created_at', { ascending: false });
 setApplications(apps ? apps.map((a: any) => ({ ...a, users: Array.isArray(a.users) ? a.users[0] : a.users })) : []);
 } catch (e) {
 console.error(e);
 }
 };

 const handleSaveConfig = async (e: React.FormEvent<HTMLFormElement>) => {
 e.preventDefault();
 if (!selectedPool) return;
 
 const fd = new FormData(e.currentTarget);
 const participation_rule = fd.get('participation_rule') as string;
 const status = fd.get('status') as string;

 const enable_registration = fd.get('enable_registration') === 'on';
 const max_participants_raw = fd.get('max_participants');
 const max_participants = max_participants_raw ? parseInt(max_participants_raw as string, 10) : null;
 const application_deadline_raw = fd.get('application_deadline');
 const application_deadline = application_deadline_raw ? new Date(application_deadline_raw as string).toISOString() : null;

 try {
 const updates = {
 participation_rule,
 status,
 target_constraints: {
 enable_registration,
 ...(max_participants !== null && { max_participants }),
 ...(application_deadline !== null && { application_deadline })
 }
 };
 const { error } = await supabase.from('event_pools').update(updates).eq('id', selectedPool.id);
 if (error) throw error;
 fetchPools();
 setSelectedPool({ ...selectedPool, ...updates });
 alert('Configuration updated!');
 } catch (e: any) {
 alert('Failed: ' + e.message);
 }
 };

 const handleSaveEvaluation = async (subId: string, _userId: string) => {
 if (!selectedPool) return;
 try {
 const updates = {
 grading_score: scoreInput ? parseInt(scoreInput, 10) : null,
 grading_feedback: feedbackInput || null,
 podium_status: podiumInput || null,
 grading_status: 'graded'
 };

 const { error } = await supabase.from('pool_submissions').update(updates).eq('id', subId);
 if (error) throw error;

 // Update local state
 setSubmissions(submissions.map(s => s.id === subId ? { ...s, ...updates } : s));

 // If a podium status was assigned, generate announcement & update pool
 if (podiumInput) {
 await supabase.from('event_pools').update({ status: 'completed' }).eq('id', selectedPool.id);
 alert(`Winner successfully recorded and Pool marked as completed! Automated announcement triggered.`);
 fetchPools(); // refresh list
 } else {
 alert('Grade saved successfully.');
 }

 setEditingSubId(null);
 } catch (e: any) {
 alert('Error evaluating: ' + e.message);
 }
 };

 const handleApproveApplication = async (appId: string) => {
 try {
 const { error } = await supabase.rpc('approve_pool_application', { p_application_id: appId });
 if (error) throw error;
 
 // Update local state
 setApplications(applications.map(a => a.id === appId ? { ...a, status: 'approved' } : a));
 
 // Increment participants count locally
 setParticipantsCount(prev => prev + 1);
 
 alert('Application successfully approved!');
 } catch (e: any) {
 alert('Failed to approve application: ' + e.message);
 }
 };

 if (isLoading) return <LoadingSpinner />;
 if (error) return <ErrorState message={error} onRetry={fetchPools} />;

 return (
 <div className="p-6">
 <div className="flex items-center justify-between mb-8">
 <div>
 <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
 <Trophy className="h-6 w-6 text-primary-600 " />
 Event Pool Management
 </h1>
 <p className="text-gray-500 mt-1">Configure pools, monitor live metrics, and evaluate submissions.</p>
 </div>
 <button
 onClick={() => setShowCreateModal(true)}
 className="flex items-center gap-2 bg-primary-600 text-white px-4 py-2 rounded-lg hover:bg-primary-700 transition-colors shadow-sm"
 >
 <Plus className="h-5 w-5" />
 Create New Pool
 </button>
 </div>

 <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
 {pools.map(pool => (
 <div key={pool.id} className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 hover:border-primary-200 transition-colors">
 <div className="flex justify-between items-start mb-4">
 <h3 className="font-bold text-lg text-gray-900 line-clamp-1">{pool.title}</h3>
 <span className="px-2.5 py-1 bg-gray-100 text-gray-700 rounded-full text-xs font-medium capitalize">
 {pool.type}
 </span>
 </div>
 <p className="text-sm text-gray-500 mb-6 capitalize font-medium flex items-center gap-1.5">
 <Activity className="h-4 w-4" /> Status: {pool.status}
 </p>
 <button
 onClick={() => loadPoolDetails(pool)}
 className="w-full py-2.5 bg-primary-50 text-primary-700 hover:bg-primary-100 font-semibold rounded-lg flex items-center justify-center gap-2 transition-colors"
 >
 <Settings className="h-4 w-4" />
 Manage Pool
 </button>
 </div>
 ))}
 {pools.length === 0 && (
 <div className="col-span-full py-12 text-center text-gray-500 ">
 No Event Pools found. Create one from the database first.
 </div>
 )}
 </div>

 {selectedPool && (
 <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
 <div className="bg-white rounded-2xl w-full max-w-5xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
 
 {/* Header */}
 <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50 ">
 <div>
 <h2 className="text-xl font-bold text-gray-900 ">{selectedPool.title}</h2>
 <p className="text-sm text-gray-500 capitalize">{selectedPool.type} Engine</p>
 </div>
 <button onClick={() => setSelectedPool(null)} className="p-2 hover:bg-gray-200 rounded-lg transition-colors">
 <X className="h-5 w-5 text-gray-500 " />
 </button>
 </div>

 {/* Tabs */}
 <div className="flex px-6 border-b border-gray-200 ">
 <button onClick={() => setActiveView('config')} className={`px-4 py-3 font-medium text-sm border-b-2 transition-colors flex items-center gap-2 ${activeView === 'config' ? 'border-primary-600 text-primary-700 ' : 'border-transparent text-gray-500 hover:text-gray-700 '}`}>
 <Settings className="h-4 w-4" /> Configuration Editor
 </button>
 <button onClick={() => setActiveView('monitor')} className={`px-4 py-3 font-medium text-sm border-b-2 transition-colors flex items-center gap-2 ${activeView === 'monitor' ? 'border-primary-600 text-primary-700 ' : 'border-transparent text-gray-500 hover:text-gray-700 '}`}>
 <Activity className="h-4 w-4" /> Live Monitoring
 </button>
 <button onClick={() => setActiveView('evaluate')} className={`px-4 py-3 font-medium text-sm border-b-2 transition-colors flex items-center gap-2 ${activeView === 'evaluate' ? 'border-primary-600 text-primary-700 ' : 'border-transparent text-gray-500 hover:text-gray-700 '}`}>
 <CheckCircle className="h-4 w-4" /> Evaluation Terminal
 </button>
 <button onClick={() => setActiveView('applications')} className={`px-4 py-3 font-medium text-sm border-b-2 transition-colors flex items-center gap-2 ${activeView === 'applications' ? 'border-primary-600 text-primary-700 ' : 'border-transparent text-gray-500 hover:text-gray-700 '}`}>
 <Users className="h-4 w-4" /> Registrations
 </button>
 </div>

 {/* Content */}
 <div className="flex-1 overflow-y-auto p-6 bg-white ">
 
 {/* 1. Configuration Editor */}
 {activeView === 'config' && (
 <form onSubmit={handleSaveConfig} className="space-y-6 max-w-2xl">
 <div className="grid grid-cols-2 gap-4">
 <div>
 <label className="block text-sm font-semibold text-gray-700 mb-1">Status</label>
 <select name="status" defaultValue={selectedPool.status} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 ">
 <option value="draft">Draft</option>
 <option value="scheduled">Scheduled</option>
 <option value="live">Live</option>
 <option value="paused">Paused</option>
 <option value="completed">Completed</option>
 <option value="archived">Archived</option>
 </select>
 </div>
 <div>
 <label className="block text-sm font-semibold text-gray-700 mb-1">Participation Rule</label>
 <select name="participation_rule" defaultValue={selectedPool.participation_rule} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 ">
 <option value="open">Open (All)</option>
 <option value="level_based">Level Based</option>
 <option value="department_based">Department Based</option>
 <option value="individual_selection">Select Participants (Invite-Only)</option>
 </select>
 </div>
 </div>
 <div className="bg-slate-50 p-4 rounded-xl space-y-4 border border-slate-100 ">
 <h3 className="font-semibold text-sm text-slate-700 ">Registration Constraints</h3>
 
 <div className="flex items-center gap-2">
 <input type="checkbox" id="enable_registration" name="enable_registration" defaultChecked={selectedPool.target_constraints?.enable_registration ?? true} className="rounded text-primary-600 focus:ring-primary-500" />
 <label htmlFor="enable_registration" className="text-sm text-slate-700 ">Enable Registrations / Applications</label>
 </div>

 <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
 <div>
 <label className="block text-xs font-semibold text-slate-500 mb-1">Max Participants</label>
 <input type="number" name="max_participants" defaultValue={selectedPool.target_constraints?.max_participants || ''} placeholder="e.g. 50" className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-primary-500 " />
 </div>
 <div>
 <label className="block text-xs font-semibold text-slate-500 mb-1">Application Deadline</label>
 <input type="datetime-local" name="application_deadline" defaultValue={selectedPool.target_constraints?.application_deadline ? new Date(selectedPool.target_constraints.application_deadline).toISOString().slice(0, 16) : ''} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-primary-500 " />
 </div>
 </div>
 </div>
 <button type="submit" className="px-6 py-2 bg-primary-600 text-white font-semibold rounded-lg hover:bg-primary-700 flex items-center gap-2">
 <Save className="h-4 w-4" /> Save Configuration
 </button>
 </form>
 )}

 {/* 2. Live Monitoring Center */}
 {activeView === 'monitor' && (
 <div className="space-y-6">
 <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
 <div className="bg-blue-50 border border-blue-100 p-5 rounded-xl flex items-center gap-4">
 <div className="bg-blue-100 p-3 rounded-lg"><Users className="h-6 w-6 text-blue-600" /></div>
 <div>
 <p className="text-sm font-medium text-blue-600">Active Participants</p>
 <p className="text-2xl font-bold text-blue-900">{participantsCount}</p>
 </div>
 </div>
 <div className="bg-green-50 border border-green-100 p-5 rounded-xl flex items-center gap-4">
 <div className="bg-green-100 p-3 rounded-lg"><CheckCircle className="h-6 w-6 text-green-600" /></div>
 <div>
 <p className="text-sm font-medium text-green-600">Total Submissions</p>
 <p className="text-2xl font-bold text-green-900">{submissions.length}</p>
 </div>
 </div>
 <div className="bg-purple-50 border border-purple-100 p-5 rounded-xl flex items-center gap-4">
 <div className="bg-purple-100 p-3 rounded-lg"><Activity className="h-6 w-6 text-purple-600" /></div>
 <div>
 <p className="text-sm font-medium text-purple-600">Pool Status</p>
 <p className="text-2xl font-bold text-purple-900 capitalize">{selectedPool.status}</p>
 </div>
 </div>
 </div>
 
 <div className="bg-gray-50 rounded-xl p-6 border border-gray-200 ">
 <h3 className="font-semibold text-gray-900 mb-4">Scheduling Properties</h3>
 <div className="grid grid-cols-2 gap-y-4 text-sm">
 <div><span className="text-gray-500 block mb-1">Registration Opens</span><span className="font-medium">{new Date(selectedPool.registration_open).toLocaleString()}</span></div>
 <div><span className="text-gray-500 block mb-1">Registration Closes</span><span className="font-medium">{new Date(selectedPool.registration_close).toLocaleString()}</span></div>
 <div><span className="text-gray-500 block mb-1">Event Starts</span><span className="font-medium">{new Date(selectedPool.start_time).toLocaleString()}</span></div>
 <div><span className="text-gray-500 block mb-1">Event Ends</span><span className="font-medium">{new Date(selectedPool.end_time).toLocaleString()}</span></div>
 </div>
 </div>
 </div>
 )}

 {/* 3. Evaluation Terminal */}
 {activeView === 'evaluate' && (
 <div className="space-y-4">
 {submissions.length === 0 ? (
 <div className="text-center py-12 text-gray-500 bg-gray-50 rounded-xl border border-dashed border-gray-300">
 No submissions received yet.
 </div>
 ) : (
 <div className="border border-gray-200 rounded-xl overflow-hidden">
 <table className="w-full text-left text-sm">
 <thead className="bg-gray-50 text-gray-600 border-b border-gray-200 ">
 <tr>
 <th className="px-4 py-3 font-semibold">Student</th>
 <th className="px-4 py-3 font-semibold">Submission</th>
 <th className="px-4 py-3 font-semibold">Score</th>
 <th className="px-4 py-3 font-semibold">Podium</th>
 <th className="px-4 py-3 font-semibold text-right">Action</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-gray-100">
 {submissions.map(sub => (
 <tr key={sub.id} className="hover:bg-gray-50 ">
 <td className="px-4 py-3">
 <p className="font-medium text-gray-900 ">{sub.users?.full_name}</p>
 <p className="text-xs text-gray-500 ">@{sub.users?.username}</p>
 </td>
 <td className="px-4 py-3 max-w-xs truncate text-gray-500 ">
 {sub.answers?.text ? `"${sub.answers.text.substring(0, 50)}..."` : sub.answers?.file_url ? 'Attachment [Link]' : 'Complex Data'}
 </td>
 <td className="px-4 py-3 font-medium text-primary-700 ">{sub.grading_score !== null ? sub.grading_score : '--'}</td>
 <td className="px-4 py-3 font-bold text-amber-600">{sub.podium_status || '--'}</td>
 <td className="px-4 py-3 text-right">
 <button onClick={() => {
 setEditingSubId(sub.id);
 setScoreInput(sub.grading_score?.toString() || '');
 setFeedbackInput(sub.grading_feedback || '');
 setPodiumInput(sub.podium_status || '');
 }} className="text-primary-600 hover:text-primary-800 font-medium">Evaluate</button>
 </td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 )}

 {/* Inline Evaluation Editor Form */}
 {editingSubId && (
 <div className="mt-6 p-5 bg-primary-50 rounded-xl border border-primary-100 shadow-inner">
 <h4 className="font-bold text-primary-900 mb-4 flex items-center gap-2">
 <Edit className="h-4 w-4" /> Grading Panel
 </h4>
 <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
 <div>
 <label className="block text-sm font-semibold text-gray-700 mb-1">Numerical Score</label>
 <input type="number" value={scoreInput} onChange={e => setScoreInput(e.target.value)} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 " placeholder="e.g. 85" />
 </div>
 <div>
 <label className="block text-sm font-semibold text-gray-700 mb-1">Podium Assignment</label>
 <select value={podiumInput} onChange={e => setPodiumInput(e.target.value)} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 ">
 <option value="">None</option>
 <option value="Winner">Winner</option>
 <option value="1st Runner-Up">1st Runner-Up</option>
 <option value="2nd Runner-Up">2nd Runner-Up</option>
 </select>
 </div>
 </div>
 <div className="mb-4">
 <label className="block text-sm font-semibold text-gray-700 mb-1">Manual Feedback</label>
 <textarea value={feedbackInput} onChange={e => setFeedbackInput(e.target.value)} rows={2} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 " placeholder="Leave remarks for the participant..." />
 </div>
 <div className="flex gap-3 justify-end">
 <button onClick={() => setEditingSubId(null)} className="px-4 py-2 text-gray-600 font-medium hover:bg-gray-100 rounded-lg">Cancel</button>
 <button onClick={() => {
 const sub = submissions.find(s => s.id === editingSubId);
 if(sub) handleSaveEvaluation(editingSubId, sub.user_id);
 }} className="px-4 py-2 bg-primary-600 text-white font-semibold rounded-lg hover:bg-primary-700 shadow-sm flex items-center gap-2">
 <CheckCircle className="h-4 w-4" /> Save Result
 </button>
 </div>
 </div>
 )}
 </div>
 )}

 {/* 4. Registrations Table */}
 {activeView === 'applications' && (
 <div className="space-y-4">
 {applications.length === 0 ? (
 <div className="text-center py-12 text-gray-500 bg-gray-50 rounded-xl border border-dashed border-gray-300">
 No registrations received yet.
 </div>
 ) : (
 <div className="border border-gray-200 rounded-xl overflow-hidden">
 <table className="w-full text-left text-sm">
 <thead className="bg-gray-50 text-gray-600 border-b border-gray-200 ">
 <tr>
 <th className="px-4 py-3 font-semibold">Applicant</th>
 <th className="px-4 py-3 font-semibold">Date Applied</th>
 <th className="px-4 py-3 font-semibold">Status</th>
 <th className="px-4 py-3 font-semibold text-right">Action</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-gray-100">
 {applications.map(app => (
 <tr key={app.id} className="hover:bg-gray-50 ">
 <td className="px-4 py-3">
 <p className="font-medium text-gray-900 ">{app.users?.full_name}</p>
 <p className="text-xs text-gray-500 ">@{app.users?.username}</p>
 </td>
 <td className="px-4 py-3 text-gray-500 ">
 {new Date(app.created_at).toLocaleDateString()}
 </td>
 <td className="px-4 py-3">
 <span className={`px-2.5 py-1 rounded-full text-xs font-medium capitalize ${app.status === 'approved' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
 {app.status}
 </span>
 </td>
 <td className="px-4 py-3 text-right">
 {app.status === 'pending' && (
 <button onClick={() => handleApproveApplication(app.id)} className="px-3 py-1.5 bg-primary-600 text-white font-medium rounded-lg hover:bg-primary-700 transition-colors">
 Approve
 </button>
 )}
 </td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 )}
 </div>
 )}

 </div>
 </div>
 </div>
 )}

 <Modal isOpen={showCreateModal} onClose={() => setShowCreateModal(false)} title="Create New Pool" size="sm">
 <form onSubmit={handleCreatePool} className="space-y-6">
 <div>
 <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Pool Title</label>
 <input
 required
 type="text"
 value={newPoolTitle}
 onChange={(e) => setNewPoolTitle(e.target.value)}
 placeholder="e.g., Spring 2026 Code Quiz"
 className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-900 focus:bg-white focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-all placeholder:text-slate-400"
 />
 </div>
 <div>
 <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Pool Type</label>
 <select
 value={newPoolType}
 onChange={(e) => setNewPoolType(e.target.value)}
 className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-900 focus:bg-white focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-all"
 >
 <option value="quiz">Quiz</option>
 <option value="essay">Essay</option>
 <option value="challenge">Challenge</option>
 <option value="voting">Voting</option>
 <option value="debate">Debate</option>
 <option value="talent">Talent</option>
 <option value="academic">Academic</option>
 <option value="custom">Custom</option>
 </select>
 </div>
 <div>
 <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Associated Event (Optional)</label>
 <select
 value={selectedEventId}
 onChange={(e) => setSelectedEventId(e.target.value)}
 className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-900 focus:bg-white focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-all"
 >
 <option value="">None / Standalone Pool</option>
 {events.map(ev => (
 <option key={ev.id} value={ev.id}>{ev.title}</option>
 ))}
 </select>
 </div>
 <div className="pt-2 flex gap-3">
 <button
 type="button"
 onClick={() => setShowCreateModal(false)}
 className="flex-1 px-4 py-3 border border-slate-200 text-slate-700 rounded-xl font-bold hover:bg-slate-50 transition-colors"
 >
 Cancel
 </button>
 <button
 type="submit"
 className="flex-1 bg-primary-600 text-white px-4 py-3 rounded-xl font-bold hover:bg-primary-700 transition-colors shadow-lg shadow-primary-500/30"
 >
 Create Pool
 </button>
 </div>
 </form>
 </Modal>
 </div>
 );
}

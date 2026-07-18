import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { Trophy, Settings, Activity, CheckCircle, Edit, Save, X, Users, Plus, Trash2, BookOpen, Crown, Search, UserPlus, UserMinus } from 'lucide-react';
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

type QuizQuestion = {
 id: string;
 pool_id: string;
 question_text: string;
 options: string[];
 correct_option: string;
 points: number;
 question_type: string;
 media_url?: string | null;
};

export default function EventPoolManagementPage() {
 const [pools, setPools] = useState<EventPool[]>([]);
 const [selectedPool, setSelectedPool] = useState<EventPool | null>(null);
 const [submissions, setSubmissions] = useState<Submission[]>([]);
 const [applications, setApplications] = useState<any[]>([]);
 const [participantsCount, setParticipantsCount] = useState(0);
 const [isLoading, setIsLoading] = useState(true);
 const [error, setError] = useState<string | null>(null);

 // Active View inside Modal: 'config' | 'content' | 'monitor' | 'evaluate' | 'applications'
 const [activeView, setActiveView] = useState<'config' | 'content' | 'monitor' | 'evaluate' | 'applications'>('config');

 const [quizQuestions, setQuizQuestions] = useState<QuizQuestion[]>([]);
 const [isBulkMode, setIsBulkMode] = useState(false);
 const [newQuestionType, setNewQuestionType] = useState('single');

 // Evaluator states
 const [editingSubId, setEditingSubId] = useState<string | null>(null);
 const [scoreInput, setScoreInput] = useState('');
 const [feedbackInput, setFeedbackInput] = useState('');
 const [podiumInput, setPodiumInput] = useState('');
 
 // Participation Rule State
 const [activeParticipationRule, setActiveParticipationRule] = useState('open');

 // Invite-Only State
 const [inviteSearchQuery, setInviteSearchQuery] = useState('');
 const [inviteSearchResults, setInviteSearchResults] = useState<any[]>([]);
 const [invitedUsers, setInvitedUsers] = useState<any[]>([]);
 const [isInviteSearching, setIsInviteSearching] = useState(false);

 // Department list
 const [departments, setDepartments] = useState<any[]>([]);

 const [showCreateModal, setShowCreateModal] = useState<'create' | 'edit' | false>(false);
 const [editingPoolId, setEditingPoolId] = useState<string | null>(null);
 const [newPoolTitle, setNewPoolTitle] = useState('');
 const [newPoolType, setNewPoolType] = useState('quiz');
 const [events, setEvents] = useState<any[]>([]);
 const [selectedEventId, setSelectedEventId] = useState('');

 useEffect(() => {
 fetchPools();
 fetchEvents();
 fetchDepartments();
 }, []);

 const fetchDepartments = async () => {
 const { data } = await supabase.from('departments').select('id, name').order('name');
 if (data) setDepartments(data);
 };

 const handleInviteSearch = async (query: string) => {
 setInviteSearchQuery(query);
 if (query.length < 2) { setInviteSearchResults([]); return; }
 setIsInviteSearching(true);
 try {
   const { data } = await supabase.from('users').select('id, full_name, username, avatar_url, level').or(`full_name.ilike.%${query}%,username.ilike.%${query}%`).limit(8);
   // Filter out already invited users
   const invitedIds = invitedUsers.map(u => u.id);
   setInviteSearchResults((data || []).filter(u => !invitedIds.includes(u.id)));
 } catch { setInviteSearchResults([]); }
 finally { setIsInviteSearching(false); }
 };

 const addInvitedUser = (user: any) => {
 setInvitedUsers(prev => [...prev, user]);
 setInviteSearchResults(prev => prev.filter(u => u.id !== user.id));
 setInviteSearchQuery('');
 };

 const removeInvitedUser = (userId: string) => {
 setInvitedUsers(prev => prev.filter(u => u.id !== userId));
 };

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
 if (showCreateModal === 'create') {
 const { error } = await supabase.from('event_pools').insert({
 title: newPoolTitle,
 type: newPoolType,
 status: 'draft',
 participation_rule: 'open',
 event_id: selectedEventId || null
 });
 if (error) throw error;
 } else if (showCreateModal === 'edit' && editingPoolId) {
 const { error } = await supabase.from('event_pools').update({
 title: newPoolTitle,
 type: newPoolType,
 event_id: selectedEventId || null
 }).eq('id', editingPoolId);
 if (error) throw error;
 }
 setShowCreateModal(false);
 setEditingPoolId(null);
 setNewPoolTitle('');
 setNewPoolType('quiz');
 setSelectedEventId('');
 fetchPools();
 } catch (e: any) {
 alert('Failed to save event pool: ' + e.message);
 }
 };

 const handleDeletePool = async (id: string, title: string) => {
 if (!window.confirm(`Are you sure you want to delete "${title}"?`)) return;
 try {
 const { error } = await supabase.from('event_pools').delete().eq('id', id);
 if (error) throw error;
 setPools(prev => prev.filter(p => p.id !== id));
 } catch (e: any) {
 alert('Failed to delete pool: ' + e.message);
 }
 };

 const handleOpenEditModal = (pool: EventPool) => {
 setEditingPoolId(pool.id);
 setNewPoolTitle(pool.title);
 setNewPoolType(pool.type);
 setSelectedEventId(pool.target_constraints?.event_id || '');
 setShowCreateModal('edit');
 };

  const loadPoolDetails = async (pool: EventPool) => {
 setSelectedPool(pool);
 setActiveParticipationRule(pool.participation_rule);
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

 // Load invited users for invite-only pools
 const selectedUserIds: string[] = pool.target_constraints?.selected_users || [];
 if (selectedUserIds.length > 0) {
   const { data: invUsers } = await supabase.from('users').select('id, full_name, username, avatar_url, level').in('id', selectedUserIds);
   setInvitedUsers(invUsers || []);
 } else {
   setInvitedUsers([]);
 }

 // Fetch quiz questions if pool type is quiz
 if (pool.type === 'quiz') {
 const { data: questions } = await supabase.from('pool_quiz_questions').select('*').eq('pool_id', pool.id).order('created_at', { ascending: true });
 setQuizQuestions(questions || []);
 } else {
 setQuizQuestions([]);
 }
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

 const registration_open_raw = fd.get('registration_open');
 const registration_open = registration_open_raw ? new Date(registration_open_raw as string).toISOString() : null;
 const registration_close_raw = fd.get('registration_close');
 const registration_close = registration_close_raw ? new Date(registration_close_raw as string).toISOString() : null;
 const start_time_raw = fd.get('start_time');
 const start_time = start_time_raw ? new Date(start_time_raw as string).toISOString() : null;
 const end_time_raw = fd.get('end_time');
 const end_time = end_time_raw ? new Date(end_time_raw as string).toISOString() : null;

 // Advanced constraints
 const time_limit_per_question_sec_raw = fd.get('time_limit_per_question_sec');
 const time_limit_per_question_sec = time_limit_per_question_sec_raw ? parseInt(time_limit_per_question_sec_raw as string, 10) : null;
 const total_time_limit_sec_raw = fd.get('total_time_limit_sec');
 const total_time_limit_sec = total_time_limit_sec_raw ? parseInt(total_time_limit_sec_raw as string, 10) : null;
 const strict_once_off_selection = fd.get('strict_once_off_selection') === 'on';
 const instant_feedback = fd.get('instant_feedback') === 'on';
 
 const allowed_levels = fd.getAll('allowed_levels') as string[];
 const allowed_departments = fd.getAll('allowed_departments') as string[];

 try {
 const updates = {
 participation_rule,
 status,
 ...(registration_open && { registration_open }),
 ...(registration_close && { registration_close }),
 ...(start_time && { start_time }),
 ...(end_time && { end_time }),
 target_constraints: {
 ...selectedPool.target_constraints,
 enable_registration,
 ...(max_participants !== null && { max_participants }),
 ...(application_deadline !== null && { application_deadline }),
 ...(time_limit_per_question_sec !== null && { time_limit_per_question_sec }),
 ...(total_time_limit_sec !== null && { total_time_limit_sec }),
 strict_once_off_selection,
 instant_feedback,
 allowed_levels: allowed_levels.length > 0 ? allowed_levels : selectedPool.target_constraints?.allowed_levels,
 allowed_departments: allowed_departments.length > 0 ? allowed_departments : selectedPool.target_constraints?.allowed_departments,
 ...(participation_rule === 'individual_selection' && { selected_users: invitedUsers.map(u => u.id) })
 }
 };
 const { error } = await supabase.from('event_pools').update(updates).eq('id', selectedPool.id);
 if (error) throw error;

 // Check if status changed
 if (status !== selectedPool.status && ['live', 'paused', 'completed'].includes(status)) {
   supabase.functions.invoke('event-pool-broadcaster', {
     body: { pool_id: selectedPool.id, title: selectedPool.title, new_status: status }
   }).catch(e => console.error('Broadcast failed:', e));
 }

 fetchPools();
 setSelectedPool({ ...selectedPool, ...updates });
 alert('Configuration updated!');
 } catch (e: any) {
 alert('Failed: ' + e.message);
 }
 };

 const handleSaveEvaluation = async (subId: string, userId: string) => {
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

 // If a podium status was assigned, also write winner_position to pool_participants
 if (podiumInput) {
 const positionMap: Record<string, number> = { 'Winner': 1, '1st Runner-Up': 2, '2nd Runner-Up': 3 };
 const winnerPosition = positionMap[podiumInput] || null;

 if (winnerPosition) {
   await supabase.from('pool_participants')
     .update({ winner_position: winnerPosition })
     .eq('pool_id', selectedPool.id)
     .eq('user_id', userId);
 }

 await supabase.from('event_pools').update({ status: 'completed' }).eq('id', selectedPool.id);
 
 supabase.functions.invoke('event-pool-broadcaster', {
   body: { pool_id: selectedPool.id, title: selectedPool.title, new_status: 'completed' }
 }).catch(e => console.error('Broadcast failed:', e));

 alert(`Winner successfully recorded and Pool marked as completed! Automated announcement triggered.`);
 fetchPools();
 } else {
 alert('Grade saved successfully.');
 }

 setEditingSubId(null);
 } catch (e: any) {
 alert('Error evaluating: ' + e.message);
 }
 };

 const handleDeclareAndFeatureWinner = async () => {
 if (!selectedPool) return;
 const winnerSub = submissions.find(s => s.podium_status === 'Winner');
 if (!winnerSub) { alert('No Winner has been assigned yet. Use the Evaluate tab to assign a podium status first.'); return; }
 if (!window.confirm(`Feature "${winnerSub.users?.full_name}" as Event Winner for "${selectedPool.title}"?`)) return;
 try {
   const { error } = await supabase.from('featured_students').insert([{
     user_id: winnerSub.user_id,
     type: 'event_winner',
     scope: 'department',
     title: `Event Pool Winner — ${selectedPool.title}`,
     subtitle: `Winner of ${selectedPool.title}`,
     pool_id: selectedPool.id,
     is_active: true,
   }]);
   if (error) throw error;
   alert('🎉 Winner has been featured! Students will see the announcement in their app.');
 } catch (e: any) {
   alert('Failed to feature winner: ' + e.message);
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

 const handleUnapproveApplication = async (appId: string) => {
 if (!window.confirm("Are you sure you want to cancel this user's ticket?")) return;
 try {
 const { error } = await supabase.rpc('unapprove_pool_application', { p_application_id: appId });
 if (error) throw error;
 
 setApplications(applications.map(a => a.id === appId ? { ...a, status: 'rejected' } : a));
 setParticipantsCount(prev => Math.max(0, prev - 1));
 alert('Ticket cancelled successfully.');
 } catch (e: any) {
 alert('Failed to cancel ticket: ' + e.message);
 }
 };

 const handleApproveAllPending = async () => {
 if (!selectedPool) return;
 if (!window.confirm("Approve all pending applications up to the max capacity?")) return;
 try {
 const { data, error } = await supabase.rpc('approve_all_pool_applications', { p_pool_id: selectedPool.id });
 if (error) throw error;
 
 const approvedCount = data?.approved_count || 0;
 alert(`Successfully approved ${approvedCount} application(s).`);
 
 // Refresh applications and participant count
 loadPoolDetails(selectedPool);
 } catch (e: any) {
 alert('Failed to bulk approve: ' + e.message);
 }
 };

 const handleSaveInstructions = async (e: React.FormEvent<HTMLFormElement>) => {
 e.preventDefault();
 if (!selectedPool) return;
 const fd = new FormData(e.currentTarget);
 const instructions = fd.get('instructions') as string;
 const media_url = fd.get('media_url') as string;
 try {
 const updates = {
 target_constraints: {
 ...selectedPool.target_constraints,
 instructions,
 media_url
 }
 };
 const { error } = await supabase.from('event_pools').update(updates).eq('id', selectedPool.id);
 if (error) throw error;
 setSelectedPool({ ...selectedPool, ...updates });
 fetchPools();
 alert('Instructions saved!');
 } catch (e: any) {
 alert('Failed to save instructions: ' + e.message);
 }
 };

 const handleAddQuizQuestion = async (e: React.FormEvent<HTMLFormElement>) => {
 e.preventDefault();
 if (!selectedPool) return;
 const fd = new FormData(e.currentTarget);
 const question_text = fd.get('question_text') as string;
 const question_type = fd.get('question_type') as string || 'single';
 const media_url = fd.get('media_url') as string || null;
 const option1 = fd.get('option1') as string;
 const option2 = fd.get('option2') as string;
 const option3 = fd.get('option3') as string;
 const option4 = fd.get('option4') as string;
 const correct_option = fd.get('correct_option') as string;
 const tf_correct = fd.get('tf_correct') as string;
 const points = parseInt(fd.get('points') as string, 10) || 1;

 let finalOptions = [option1, option2, option3, option4].filter(Boolean);
 let finalCorrect = correct_option;

 if (question_type === 'true_false') {
 finalOptions = ['True', 'False'];
 finalCorrect = tf_correct;
 }

 try {
 const { data, error } = await supabase.from('pool_quiz_questions').insert({
 pool_id: selectedPool.id,
 question_text,
 question_type,
 media_url,
 options: finalOptions,
 correct_option: finalCorrect,
 points
 }).select().single();
 if (error) throw error;
 
 setQuizQuestions([...quizQuestions, data]);
 (e.target as HTMLFormElement).reset();
 alert('Question added!');
 } catch (e: any) {
 alert('Failed to add question: ' + e.message);
 }
 };

 const handleDeleteQuizQuestion = async (qId: string) => {
 if (!window.confirm('Delete this question?')) return;
 try {
 const { error } = await supabase.from('pool_quiz_questions').delete().eq('id', qId);
 if (error) throw error;
 setQuizQuestions(quizQuestions.filter(q => q.id !== qId));
 } catch (e: any) {
 alert('Failed to delete question: ' + e.message);
 }
 };

 const handleBulkImport = async (e: React.FormEvent<HTMLFormElement>) => {
 e.preventDefault();
 if (!selectedPool) return;
 const fd = new FormData(e.currentTarget);
 const rawText = fd.get('bulk_text') as string;
 
 if (!rawText.trim()) return;
 
 const blocks = rawText.split(/\n\s*\n/).filter(b => b.trim().length > 0);
 const newQuestions = [];
 
 for (const block of blocks) {
 const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
 if (lines.length < 3) continue;
 
 const question_text = lines[0].replace(/^\d+[\.\)]\s*/, '').trim();
 const options: string[] = [];
 let correct_option = '';
 let points = 1;
 
 for (let i = 1; i < lines.length; i++) {
 const line = lines[i];
 if (line.match(/^[A-Za-z][\.\)]\s/)) {
 options.push(line.replace(/^[A-Za-z][\.\)]\s*/, '').trim());
 } else if (line.toLowerCase().startsWith('answer:')) {
 const ansLetter = line.replace(/answer:/i, '').trim().toUpperCase();
 const idx = ansLetter.charCodeAt(0) - 65;
 if (idx >= 0 && idx < options.length) {
 correct_option = options[idx];
 } else {
 correct_option = line.replace(/answer:/i, '').trim();
 }
 } else if (line.toLowerCase().startsWith('points:')) {
 points = parseInt(line.replace(/points:/i, '').trim(), 10) || 1;
 }
 }
 
 if (question_text && options.length >= 2 && correct_option) {
 newQuestions.push({
 pool_id: selectedPool.id,
 question_text,
 options,
 correct_option,
 points
 });
 }
 }
 
 if (newQuestions.length === 0) {
 alert("No valid questions parsed. Please check your format.");
 return;
 }
 
 try {
 const { data, error } = await supabase.from('pool_quiz_questions').insert(newQuestions).select();
 if (error) throw error;
 setQuizQuestions([...quizQuestions, ...(data || [])]);
 setIsBulkMode(false);
 alert(`Successfully imported ${newQuestions.length} questions!`);
 } catch (err: any) {
 alert("Failed to bulk import: " + err.message);
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
 onClick={() => {
 setShowCreateModal('create');
 setNewPoolTitle('');
 setNewPoolType('quiz');
 setSelectedEventId('');
 setEditingPoolId(null);
 }}
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
 <h3 className="font-bold text-lg text-gray-900 line-clamp-1 pr-2">{pool.title}</h3>
 <div className="flex items-center gap-2 flex-shrink-0">
 <span className="px-2.5 py-1 bg-gray-100 text-gray-700 rounded-full text-xs font-medium capitalize">
 {pool.type}
 </span>
 <button onClick={() => handleOpenEditModal(pool)} className="p-1.5 text-slate-400 hover:text-primary-600 hover:bg-primary-50 rounded-md transition-colors" title="Edit Pool Info">
 <Edit className="h-4 w-4" />
 </button>
 <button onClick={() => handleDeletePool(pool.id, pool.title)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors" title="Delete Pool">
 <Trash2 className="h-4 w-4" />
 </button>
 </div>
 </div>
 <p className="text-sm text-gray-500 mb-6 capitalize font-medium flex items-center gap-1.5">
 <Activity className="h-4 w-4" /> Status: {pool.status}
 </p>
 <button
 onClick={() => loadPoolDetails(pool)}
 className="w-full py-2.5 bg-primary-50 text-primary-700 hover:bg-primary-100 font-semibold rounded-lg flex items-center justify-center gap-2 transition-colors"
 >
 <Settings className="h-4 w-4" />
 Manage Pool Rules & Setup
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
 <div className="flex px-6 border-b border-gray-200 overflow-x-auto hide-scrollbar">
 <button onClick={() => setActiveView('config')} className={`px-4 py-3 font-medium text-sm border-b-2 transition-colors flex items-center gap-2 flex-shrink-0 ${activeView === 'config' ? 'border-primary-600 text-primary-700 ' : 'border-transparent text-gray-500 hover:text-gray-700 '}`}>
 <Settings className="h-4 w-4" /> Configuration Editor
 </button>
 <button onClick={() => setActiveView('content')} className={`px-4 py-3 font-medium text-sm border-b-2 transition-colors flex items-center gap-2 flex-shrink-0 ${activeView === 'content' ? 'border-primary-600 text-primary-700 ' : 'border-transparent text-gray-500 hover:text-gray-700 '}`}>
 <BookOpen className="h-4 w-4" /> Content Builder
 </button>
 <button onClick={() => setActiveView('monitor')} className={`px-4 py-3 font-medium text-sm border-b-2 transition-colors flex items-center gap-2 flex-shrink-0 ${activeView === 'monitor' ? 'border-primary-600 text-primary-700 ' : 'border-transparent text-gray-500 hover:text-gray-700 '}`}>
 <Activity className="h-4 w-4" /> Live Monitoring
 </button>
 <button onClick={() => setActiveView('evaluate')} className={`px-4 py-3 font-medium text-sm border-b-2 transition-colors flex items-center gap-2 flex-shrink-0 ${activeView === 'evaluate' ? 'border-primary-600 text-primary-700 ' : 'border-transparent text-gray-500 hover:text-gray-700 '}`}>
 <CheckCircle className="h-4 w-4" /> Evaluation Terminal
 </button>
 <button onClick={() => setActiveView('applications')} className={`px-4 py-3 font-medium text-sm border-b-2 transition-colors flex items-center gap-2 flex-shrink-0 ${activeView === 'applications' ? 'border-primary-600 text-primary-700 ' : 'border-transparent text-gray-500 hover:text-gray-700 '}`}>
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
 <select name="participation_rule" value={activeParticipationRule} onChange={(e) => setActiveParticipationRule(e.target.value)} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 ">
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

  {activeParticipationRule === 'level_based' && (
      <div className="mt-4 p-3 bg-white border rounded-lg border-slate-200">
          <label className="block text-xs font-semibold text-slate-500 mb-2">Allowed Levels</label>
          <div className="flex flex-wrap gap-3">
              {['100', '200', '300', '400', '500', '600'].map(level => {
                  const isChecked = selectedPool.target_constraints?.allowed_levels?.includes(level);
                  return (
                      <label key={level} className="flex items-center gap-1.5 text-sm text-gray-700">
                          <input type="checkbox" name="allowed_levels" value={level} defaultChecked={isChecked} className="rounded text-primary-600 focus:ring-primary-500" />
                          Level {level}
                      </label>
                  );
              })}
          </div>
      </div>
  )}
  {activeParticipationRule === 'department_based' && (
      <div className="mt-4 p-3 bg-white border rounded-lg border-slate-200">
          <label className="block text-xs font-semibold text-slate-500 mb-2">Allowed Departments</label>
          {departments.length === 0 ? (
              <p className="text-sm text-gray-400">No departments found in the database.</p>
          ) : (
              <div className="flex flex-wrap gap-3">
                  {departments.map(dept => {
                      const isChecked = selectedPool.target_constraints?.allowed_departments?.includes(dept.id);
                      return (
                          <label key={dept.id} className="flex items-center gap-1.5 text-sm text-gray-700">
                              <input type="checkbox" name="allowed_departments" value={dept.id} defaultChecked={isChecked} className="rounded text-primary-600 focus:ring-primary-500" />
                              {dept.name}
                          </label>
                      );
                  })}
              </div>
          )}
      </div>
  )}
  {activeParticipationRule === 'individual_selection' && (
      <div className="mt-4 p-3 bg-white border rounded-lg border-slate-200">
          <label className="block text-xs font-semibold text-slate-500 mb-2">Invite Participants</label>
          {/* Search Input */}
          <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                  type="text"
                  value={inviteSearchQuery}
                  onChange={(e) => handleInviteSearch(e.target.value)}
                  placeholder="Search by name or username..."
                  className="w-full pl-9 pr-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-primary-500"
              />
          </div>
          {/* Search Results Dropdown */}
          {inviteSearchResults.length > 0 && (
              <div className="border rounded-lg mb-3 max-h-48 overflow-y-auto divide-y">
                  {inviteSearchResults.map(user => (
                      <button key={user.id} onClick={() => addInvitedUser(user)} className="w-full flex items-center gap-3 px-3 py-2 hover:bg-primary-50 transition-colors text-left">
                          <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center text-primary-700 font-bold text-xs">
                              {user.full_name?.[0] || '?'}
                          </div>
                          <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-gray-900 truncate">{user.full_name}</p>
                              <p className="text-xs text-gray-500">@{user.username} · Level {user.level || '?'}</p>
                          </div>
                          <UserPlus className="h-4 w-4 text-primary-500 flex-shrink-0" />
                      </button>
                  ))}
              </div>
          )}
          {isInviteSearching && <p className="text-xs text-gray-400 mb-2">Searching...</p>}
          {/* Invited Users List */}
          <div className="space-y-2">
              <p className="text-xs text-gray-500 font-semibold">{invitedUsers.length} Invited Participant{invitedUsers.length !== 1 ? 's' : ''}</p>
              {invitedUsers.map(user => (
                  <div key={user.id} className="flex items-center gap-3 px-3 py-2 bg-green-50 border border-green-200 rounded-lg">
                      <div className="w-7 h-7 rounded-full bg-green-200 flex items-center justify-center text-green-800 font-bold text-xs">
                          {user.full_name?.[0] || '?'}
                      </div>
                      <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">{user.full_name}</p>
                          <p className="text-xs text-gray-500">@{user.username}</p>
                      </div>
                      <button onClick={() => removeInvitedUser(user.id)} className="p-1 hover:bg-red-100 rounded transition-colors" title="Remove">
                          <UserMinus className="h-4 w-4 text-red-500" />
                      </button>
                  </div>
              ))}
          </div>
      </div>
  )}
  </div>

 <div className="bg-slate-50 p-4 rounded-xl space-y-4 border border-slate-100 ">
 <h3 className="font-semibold text-sm text-slate-700">Scheduling Properties</h3>
 <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
 <div>
 <label className="block text-xs font-semibold text-slate-500 mb-1">Registration Opens</label>
 <input type="datetime-local" name="registration_open" defaultValue={selectedPool.registration_open ? new Date(selectedPool.registration_open).toISOString().slice(0, 16) : ''} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-primary-500 " />
 </div>
 <div>
 <label className="block text-xs font-semibold text-slate-500 mb-1">Registration Closes</label>
 <input type="datetime-local" name="registration_close" defaultValue={selectedPool.registration_close ? new Date(selectedPool.registration_close).toISOString().slice(0, 16) : ''} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-primary-500 " />
 </div>
 <div>
 <label className="block text-xs font-semibold text-slate-500 mb-1">Event Starts</label>
 <input type="datetime-local" name="start_time" defaultValue={selectedPool.start_time ? new Date(selectedPool.start_time).toISOString().slice(0, 16) : ''} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-primary-500 " />
 </div>
 <div>
 <label className="block text-xs font-semibold text-slate-500 mb-1">Event Ends</label>
 <input type="datetime-local" name="end_time" defaultValue={selectedPool.end_time ? new Date(selectedPool.end_time).toISOString().slice(0, 16) : ''} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-primary-500 " />
 </div>
 </div>
 </div>

 <div className="bg-slate-50 p-4 rounded-xl space-y-4 border border-slate-100 ">
 <h3 className="font-semibold text-sm text-slate-700">Advanced Settings</h3>
 <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
 {selectedPool.type === 'quiz' ? (
 <>
 <div>
 <label className="block text-xs font-semibold text-slate-500 mb-1">Time Limit Per Question (seconds)</label>
 <input type="number" name="time_limit_per_question_sec" defaultValue={selectedPool.target_constraints?.time_limit_per_question_sec || ''} placeholder="e.g. 5" className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-primary-500 " />
 </div>
 <div>
 <label className="block text-xs font-semibold text-slate-500 mb-1">Total Quiz Time Limit (seconds)</label>
 <input type="number" name="total_time_limit_sec" defaultValue={selectedPool.target_constraints?.total_time_limit_sec || ''} placeholder="e.g. 300 for 5 mins" className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-primary-500 " />
 </div>
 <div className="flex items-center gap-2 md:col-span-2">
 <input type="checkbox" id="strict_once_off_selection" name="strict_once_off_selection" defaultChecked={selectedPool.target_constraints?.strict_once_off_selection ?? false} className="rounded text-primary-600 focus:ring-primary-500" />
 <label htmlFor="strict_once_off_selection" className="text-sm text-slate-700 ">Strict Once-Off Selection (Users cannot change their answer once tapped)</label>
 </div>
 <div className="flex items-center gap-2 md:col-span-2">
 <input type="checkbox" id="instant_feedback" name="instant_feedback" defaultChecked={selectedPool.target_constraints?.instant_feedback ?? false} className="rounded text-primary-600 focus:ring-primary-500" />
 <label htmlFor="instant_feedback" className="text-sm text-slate-700 ">Instant Feedback (Show true/false immediately after selection - Works best if Once-Off is enabled)</label>
 </div>
 </>
 ) : (
 <div>
 <label className="block text-xs font-semibold text-slate-500 mb-1">Total Event Time Limit (seconds)</label>
 <input type="number" name="total_time_limit_sec" defaultValue={selectedPool.target_constraints?.total_time_limit_sec || ''} placeholder="e.g. 300 for 5 mins" className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-primary-500 " />
 </div>
 )}
 </div>
 </div>

 <button type="submit" className="px-6 py-2 bg-primary-600 text-white font-semibold rounded-lg hover:bg-primary-700 flex items-center gap-2">
 <Save className="h-4 w-4" /> Save Configuration
 </button>
 </form>
 )}

 {/* Content Builder */}
 {activeView === 'content' && (
 <div className="space-y-6">
 {selectedPool.type === 'quiz' ? (
 <div className="space-y-6">
 {/* List existing questions */}
 <div className="space-y-4">
 <div className="flex items-center justify-between">
 <h3 className="font-semibold text-gray-900">Quiz Questions ({quizQuestions.length})</h3>
 <button onClick={() => setIsBulkMode(!isBulkMode)} className="text-sm font-medium text-primary-600 hover:text-primary-700">
 {isBulkMode ? 'Switch to Manual Entry' : 'Bulk Import Questions'}
 </button>
 </div>
 {quizQuestions.length === 0 && <p className="text-gray-500 text-sm">No questions added yet.</p>}
 {quizQuestions.map((q, i) => (
 <div key={q.id} className="bg-gray-50 border border-gray-200 p-4 rounded-xl flex items-start justify-between">
 <div>
 <p className="font-semibold text-gray-900 text-sm mb-2">Q{i + 1}. {q.question_text} 
 <span className="text-xs text-primary-600 ml-2">({q.points} pts)</span>
 <span className="text-xs bg-gray-200 px-2 py-0.5 rounded ml-2 uppercase">{q.question_type}</span>
 {q.media_url && <span className="text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded ml-2">Has Media</span>}
 </p>
 <ul className="text-sm text-gray-600 space-y-1 list-disc list-inside">
 {q.options.map((opt, j) => (
 <li key={j} className={q.correct_option?.includes(opt) ? 'text-green-600 font-bold' : ''}>
 {opt} {q.correct_option?.includes(opt) && '✓'}
 </li>
 ))}
 </ul>
 </div>
 <button type="button" onClick={() => handleDeleteQuizQuestion(q.id)} className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
 <Trash2 className="h-4 w-4" />
 </button>
 </div>
 ))}
 </div>

 {/* Add new question form or Bulk mode */}
 {isBulkMode ? (
 <form onSubmit={handleBulkImport} className="bg-primary-50 border border-primary-100 p-6 rounded-xl space-y-4">
 <h4 className="font-semibold text-primary-900">Bulk Import Questions</h4>
 <div className="bg-white p-4 rounded-lg border border-primary-200 text-sm text-gray-600">
 <p className="font-semibold mb-2">Required Format:</p>
 <pre className="text-xs text-gray-500 whitespace-pre-wrap">
 1. What is the capital of France?{"\n"}
 A) London{"\n"}
 B) Berlin{"\n"}
 C) Paris{"\n"}
 D) Madrid{"\n"}
 Answer: C{"\n"}
 Points: 2
 </pre>
 <p className="mt-2 text-xs text-primary-600">Separate questions with a blank line. Points are optional (default 1).</p>
 </div>
 <textarea required name="bulk_text" rows={15} className="w-full px-3 py-2 border border-primary-200 rounded-lg focus:ring-2 focus:ring-primary-500 font-mono text-sm" placeholder="Paste your questions here..." />
 <button type="submit" className="bg-primary-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-primary-700 flex items-center gap-2">
 <Save className="h-4 w-4" /> Parse & Import
 </button>
 </form>
 ) : (
 <form onSubmit={handleAddQuizQuestion} className="bg-primary-50 border border-primary-100 p-6 rounded-xl space-y-4">
 <h4 className="font-semibold text-primary-900">Add New Question</h4>
 
 <div className="grid grid-cols-2 gap-4">
 <div>
 <label className="block text-xs font-bold text-primary-800 mb-1">Question Type</label>
 <select name="question_type" value={newQuestionType} onChange={e => setNewQuestionType(e.target.value)} className="w-full px-3 py-2 border border-primary-200 rounded-lg focus:ring-2 focus:ring-primary-500">
 <option value="single">Single Choice (Multiple Choice)</option>
 <option value="multiple">Multiple Answer (Checkboxes)</option>
 <option value="true_false">True / False</option>
 </select>
 </div>
 <div>
 <label className="block text-xs font-bold text-primary-800 mb-1">Attachment / Media URL (Optional)</label>
 <input name="media_url" type="url" className="w-full px-3 py-2 border border-primary-200 rounded-lg focus:ring-2 focus:ring-primary-500" placeholder="https://image-url.com/img.png" />
 </div>
 </div>

 <div>
 <label className="block text-xs font-bold text-primary-800 mb-1">Question Prompt</label>
 <input required name="question_text" type="text" className="w-full px-3 py-2 border border-primary-200 rounded-lg focus:ring-2 focus:ring-primary-500" placeholder="e.g. What is the capital of France?" />
 </div>

 {newQuestionType !== 'true_false' && (
 <div className="grid grid-cols-2 gap-4">
 <div>
 <label className="block text-xs font-bold text-primary-800 mb-1">Option 1</label>
 <input required name="option1" type="text" className="w-full px-3 py-2 border border-primary-200 rounded-lg focus:ring-2 focus:ring-primary-500" />
 </div>
 <div>
 <label className="block text-xs font-bold text-primary-800 mb-1">Option 2</label>
 <input required name="option2" type="text" className="w-full px-3 py-2 border border-primary-200 rounded-lg focus:ring-2 focus:ring-primary-500" />
 </div>
 <div>
 <label className="block text-xs font-bold text-primary-800 mb-1">Option 3 (Optional)</label>
 <input name="option3" type="text" className="w-full px-3 py-2 border border-primary-200 rounded-lg focus:ring-2 focus:ring-primary-500" />
 </div>
 <div>
 <label className="block text-xs font-bold text-primary-800 mb-1">Option 4 (Optional)</label>
 <input name="option4" type="text" className="w-full px-3 py-2 border border-primary-200 rounded-lg focus:ring-2 focus:ring-primary-500" />
 </div>
 </div>
 )}

 <div className="grid grid-cols-2 gap-4">
 <div>
 {newQuestionType === 'true_false' ? (
 <>
 <label className="block text-xs font-bold text-primary-800 mb-1">Correct Answer</label>
 <select name="tf_correct" className="w-full px-3 py-2 border border-green-300 rounded-lg focus:ring-2 focus:ring-green-500 bg-green-50">
 <option value="True">True</option>
 <option value="False">False</option>
 </select>
 </>
 ) : (
 <>
 <label className="block text-xs font-bold text-primary-800 mb-1">Exact Correct Option text</label>
 <input required name="correct_option" type="text" className="w-full px-3 py-2 border border-green-300 rounded-lg focus:ring-2 focus:ring-green-500 bg-green-50" placeholder={newQuestionType === 'multiple' ? "e.g. Option1, Option2" : "Must exactly match one option above"} />
 {newQuestionType === 'multiple' && <p className="text-[10px] text-gray-500 mt-1">Separate multiple exact answers with commas.</p>}
 </>
 )}
 </div>
 <div>
 <label className="block text-xs font-bold text-primary-800 mb-1">Points</label>
 <input required name="points" type="number" defaultValue="1" min="1" className="w-full px-3 py-2 border border-primary-200 rounded-lg focus:ring-2 focus:ring-primary-500" />
 </div>
 </div>
 <button type="submit" className="bg-primary-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-primary-700 flex items-center gap-2">
 <Plus className="h-4 w-4" /> Add Question
 </button>
 </form>
 )}
 </div>
 ) : (
 <form onSubmit={handleSaveInstructions} className="space-y-4 max-w-3xl">
 <div>
 <label className="block text-sm font-semibold text-gray-700 mb-2">Prompt / Instructions for Participants</label>
 <p className="text-sm text-gray-500 mb-3">These instructions will be displayed to the participant when they start the event.</p>
 <textarea 
 name="instructions" 
 rows={10} 
 defaultValue={selectedPool.target_constraints?.instructions || ''} 
 className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary-500"
 placeholder="e.g. Write a 500-word essay about..."
 />
 </div>
 <div>
 <label className="block text-sm font-semibold text-gray-700 mb-2">Attachment / Media URL (Optional)</label>
 <input 
 name="media_url" 
 type="url"
 defaultValue={selectedPool.target_constraints?.media_url || ''} 
 className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary-500"
 placeholder="e.g. https://example.com/image.png"
 />
 </div>
 <button type="submit" className="bg-primary-600 text-white px-6 py-2 rounded-lg font-semibold hover:bg-primary-700 flex items-center gap-2">
 <Save className="h-4 w-4" /> Save Instructions
 </button>
 </form>
 )}
 </div>
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
 <div><span className="text-gray-500 block mb-1">Registration Opens</span><span className="font-medium">{selectedPool.registration_open ? new Date(selectedPool.registration_open).toLocaleString() : 'Not Set'}</span></div>
 <div><span className="text-gray-500 block mb-1">Registration Closes</span><span className="font-medium">{selectedPool.registration_close ? new Date(selectedPool.registration_close).toLocaleString() : 'Not Set'}</span></div>
 <div><span className="text-gray-500 block mb-1">Event Starts</span><span className="font-medium">{selectedPool.start_time ? new Date(selectedPool.start_time).toLocaleString() : 'Not Set'}</span></div>
 <div><span className="text-gray-500 block mb-1">Event Ends</span><span className="font-medium">{selectedPool.end_time ? new Date(selectedPool.end_time).toLocaleString() : 'Not Set'}</span></div>
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

 {/* Declare & Feature Winner Button */}
 {submissions.some(s => s.podium_status === 'Winner') && (
 <div className="mt-6 p-5 bg-amber-50 rounded-xl border border-amber-200 flex items-center justify-between shadow-sm">
  <div className="flex items-center gap-3">
   <div className="bg-amber-100 p-3 rounded-lg"><Crown className="h-5 w-5 text-amber-600" /></div>
   <div>
    <p className="font-bold text-amber-900">Winner Assigned</p>
    <p className="text-sm text-amber-600">{submissions.find(s => s.podium_status === 'Winner')?.users?.full_name} — Tap to feature them in the app.</p>
   </div>
  </div>
  <button onClick={handleDeclareAndFeatureWinner} className="px-5 py-2.5 bg-amber-600 text-white font-bold rounded-xl hover:bg-amber-700 transition-all shadow-lg shadow-amber-600/20 flex items-center gap-2 text-sm">
   <Crown className="h-4 w-4" /> Feature Winner
  </button>
 </div>
 )}
 </div>
 )}

 {/* 4. Registrations Table */}
 {activeView === 'applications' && (
 <div className="space-y-4">
 <div className="flex justify-end">
    <button onClick={handleApproveAllPending} disabled={!applications.some(a => a.status === 'pending')} className="bg-primary-600 text-white px-4 py-2 rounded-lg hover:bg-primary-700 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed">
        Approve All Pending
    </button>
 </div>
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
 <span className={`px-2.5 py-1 rounded-full text-xs font-medium capitalize ${app.status === 'approved' ? 'bg-green-100 text-green-700' : app.status === 'rejected' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
 {app.status}
 </span>
 </td>
 <td className="px-4 py-3 text-right">
 {app.status === 'pending' && (
 <div className="flex justify-end gap-2">
 <button onClick={() => handleApproveApplication(app.id)} className="px-3 py-1.5 bg-primary-600 text-white font-medium rounded-lg hover:bg-primary-700 transition-colors">
 Approve
 </button>
 <button onClick={() => handleUnapproveApplication(app.id)} className="px-3 py-1.5 bg-red-100 text-red-700 font-medium rounded-lg hover:bg-red-200 transition-colors">
 Reject
 </button>
 </div>
 )}
 {app.status === 'approved' && (
 <button onClick={() => handleUnapproveApplication(app.id)} className="px-3 py-1.5 bg-red-50 border border-red-200 text-red-600 font-medium rounded-lg hover:bg-red-100 transition-colors text-xs">
 Cancel Ticket
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

 <Modal isOpen={!!showCreateModal} onClose={() => setShowCreateModal(false)} title={showCreateModal === 'create' ? "Create New Pool" : "Edit Pool Info"} size="sm">
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
 {showCreateModal === 'create' ? 'Create Pool' : 'Save Changes'}
 </button>
 </div>
 </form>
 </Modal>
 </div>
 );
}

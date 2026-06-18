import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/auth.store';
import { Trophy, Settings, Activity, CheckCircle, Edit, Save, X, Users } from 'lucide-react';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import ErrorState from '../components/ui/ErrorState';

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
    const { profile } = useAuthStore();
    const [pools, setPools] = useState<EventPool[]>([]);
    const [selectedPool, setSelectedPool] = useState<EventPool | null>(null);
    const [submissions, setSubmissions] = useState<Submission[]>([]);
    const [participantsCount, setParticipantsCount] = useState(0);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Active View inside Modal: 'config' | 'monitor' | 'evaluate'
    const [activeView, setActiveView] = useState<'config' | 'monitor' | 'evaluate'>('config');

    // Evaluator states
    const [editingSubId, setEditingSubId] = useState<string | null>(null);
    const [scoreInput, setScoreInput] = useState('');
    const [feedbackInput, setFeedbackInput] = useState('');
    const [podiumInput, setPodiumInput] = useState('');

    useEffect(() => {
        fetchPools();
    }, []);

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
        } catch (e) {
            console.error(e);
        }
    };

    const handleSaveConfig = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (!selectedPool) return;
        
        const fd = new FormData(e.currentTarget);
        const participation_rule = fd.get('participation_rule') as string;
        const target_constraints = fd.get('target_constraints') as string;
        const status = fd.get('status') as string;

        try {
            const updates = {
                participation_rule,
                status,
                target_constraints: JSON.parse(target_constraints || '{}')
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

    if (isLoading) return <LoadingSpinner />;
    if (error) return <ErrorState message={error} onRetry={fetchPools} />;

    return (
        <div className="p-6">
            <div className="flex items-center justify-between mb-8">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                        <Trophy className="h-6 w-6 text-primary-600" />
                        Event Pool Management
                    </h1>
                    <p className="text-gray-500 mt-1">Configure pools, monitor live metrics, and evaluate submissions.</p>
                </div>
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
                    <div className="col-span-full py-12 text-center text-gray-500">
                        No Event Pools found. Create one from the database first.
                    </div>
                )}
            </div>

            {selectedPool && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl w-full max-w-5xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
                        
                        {/* Header */}
                        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50">
                            <div>
                                <h2 className="text-xl font-bold text-gray-900">{selectedPool.title}</h2>
                                <p className="text-sm text-gray-500 capitalize">{selectedPool.type} Engine</p>
                            </div>
                            <button onClick={() => setSelectedPool(null)} className="p-2 hover:bg-gray-200 rounded-lg transition-colors">
                                <X className="h-5 w-5 text-gray-500" />
                            </button>
                        </div>

                        {/* Tabs */}
                        <div className="flex px-6 border-b border-gray-200">
                            <button onClick={() => setActiveView('config')} className={`px-4 py-3 font-medium text-sm border-b-2 transition-colors flex items-center gap-2 ${activeView === 'config' ? 'border-primary-600 text-primary-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
                                <Settings className="h-4 w-4" /> Configuration Editor
                            </button>
                            <button onClick={() => setActiveView('monitor')} className={`px-4 py-3 font-medium text-sm border-b-2 transition-colors flex items-center gap-2 ${activeView === 'monitor' ? 'border-primary-600 text-primary-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
                                <Activity className="h-4 w-4" /> Live Monitoring
                            </button>
                            <button onClick={() => setActiveView('evaluate')} className={`px-4 py-3 font-medium text-sm border-b-2 transition-colors flex items-center gap-2 ${activeView === 'evaluate' ? 'border-primary-600 text-primary-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
                                <CheckCircle className="h-4 w-4" /> Evaluation Terminal
                            </button>
                        </div>

                        {/* Content */}
                        <div className="flex-1 overflow-y-auto p-6 bg-white">
                            
                            {/* 1. Configuration Editor */}
                            {activeView === 'config' && (
                                <form onSubmit={handleSaveConfig} className="space-y-6 max-w-2xl">
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-sm font-semibold text-gray-700 mb-1">Status</label>
                                            <select name="status" defaultValue={selectedPool.status} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500">
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
                                            <select name="participation_rule" defaultValue={selectedPool.participation_rule} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500">
                                                <option value="open">Open (All)</option>
                                                <option value="level_based">Level Based</option>
                                                <option value="department_based">Department Based</option>
                                            </select>
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-semibold text-gray-700 mb-1">Target Constraints (JSON)</label>
                                        <textarea name="target_constraints" defaultValue={JSON.stringify(selectedPool.target_constraints, null, 2)} rows={4} className="w-full px-3 py-2 border rounded-lg font-mono text-sm focus:ring-2 focus:ring-primary-500" />
                                        <p className="text-xs text-gray-500 mt-1">Example: {`{"levels": ["100", "200"]}`}</p>
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
                                    
                                    <div className="bg-gray-50 rounded-xl p-6 border border-gray-200">
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
                                                <thead className="bg-gray-50 text-gray-600 border-b border-gray-200">
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
                                                        <tr key={sub.id} className="hover:bg-gray-50/50">
                                                            <td className="px-4 py-3">
                                                                <p className="font-medium text-gray-900">{sub.users?.full_name}</p>
                                                                <p className="text-xs text-gray-500">@{sub.users?.username}</p>
                                                            </td>
                                                            <td className="px-4 py-3 max-w-xs truncate text-gray-500">
                                                                {sub.answers?.text ? `"${sub.answers.text.substring(0, 50)}..."` : sub.answers?.file_url ? 'Attachment [Link]' : 'Complex Data'}
                                                            </td>
                                                            <td className="px-4 py-3 font-medium text-primary-700">{sub.grading_score !== null ? sub.grading_score : '--'}</td>
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
                                                    <input type="number" value={scoreInput} onChange={e => setScoreInput(e.target.value)} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500" placeholder="e.g. 85" />
                                                </div>
                                                <div>
                                                    <label className="block text-sm font-semibold text-gray-700 mb-1">Podium Assignment</label>
                                                    <select value={podiumInput} onChange={e => setPodiumInput(e.target.value)} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500">
                                                        <option value="">None</option>
                                                        <option value="Winner">Winner</option>
                                                        <option value="1st Runner-Up">1st Runner-Up</option>
                                                        <option value="2nd Runner-Up">2nd Runner-Up</option>
                                                    </select>
                                                </div>
                                            </div>
                                            <div className="mb-4">
                                                <label className="block text-sm font-semibold text-gray-700 mb-1">Manual Feedback</label>
                                                <textarea value={feedbackInput} onChange={e => setFeedbackInput(e.target.value)} rows={2} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500" placeholder="Leave remarks for the participant..." />
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

                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

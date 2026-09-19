import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/auth.store';
import FileUpload from '../lib/FileUpload';
import { Trophy, Settings, Activity, CheckCircle, Edit, Save, X, Users, Plus, Trash2, BookOpen, Crown, Search, UserPlus, FileText, MessageSquare, Sparkles, Lock, FileDown } from 'lucide-react';
import { getAllowedLevelsForPermission } from '../utils/access';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import ErrorState from '../components/ui/ErrorState';
import Modal from '../components/ui/Modal';
import { ElectionGazetteModal } from '../components/voting/ElectionGazetteModal';

export interface PoolCandidate {
  id: string;
  pool_id: string;
  candidate_user_id?: string | null;
  display_name: string;
  position_title: string;
  bio?: string | null;
  photo_url?: string | null;
  vote_count: number;
  judge_score: number;
  final_score: number;
  podium_rank?: string | null;
  is_winner: boolean;
  created_at: string;
}

export type VotingCandidate = {
  id: string;
  user_id: string;
  full_name: string;
  username: string;
  avatar_url?: string;
  level?: string;
  position_title: string;
  photo_url?: string;
  manifesto?: string;
};

export type DebateTopic = {
  id: string;
  topic_title: string;
  description: string;
  sides: string[];
  time_per_speaker_sec: number;
};

export type TalentAct = {
  id: string;
  performer_user_id?: string;
  performer_name: string;
  act_title: string;
  act_type?: string;
  description?: string;
  media_url?: string;
};

export type CustomContentBlock = {
  id: string;
  title: string;
  body: string;
  media_url?: string;
};

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
 score?: number | null;
 time_taken_seconds?: number | null;
 created_at?: string;
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
 explanation?: string | null;
};

const DEFAULT_RUBRIC_CRITERIA = [
  { key: "relevance", label: "Relevance & Focus", max_points: 25 },
  { key: "originality", label: "Originality & Insight", max_points: 25 },
  { key: "structure", label: "Structure & Flow", max_points: 25 },
  { key: "depth", label: "Research & Analytical Depth", max_points: 25 }
];

export default function EventPoolManagementPage() {
  const { profile, permissions } = useAuthStore();
  
  const eventAllowedLevels = useMemo(() => {
    if (profile?.role === 'super_admin') return null; // Unrestricted (Super Admin)
    return getAllowedLevelsForPermission(permissions, 'can_manage_events');
  }, [profile?.role, permissions]);

  const [pools, setPools] = useState<EventPool[]>([]);

  const isSuperAdmin = profile?.role === 'super_admin';
  const canManagePool = (pool: EventPool) => isSuperAdmin || (profile?.role === 'moderator' && (pool as any).created_by === profile?.id);

  const displayedPools = useMemo(() => {
    if (!eventAllowedLevels) return pools;
    if (eventAllowedLevels.length === 0) return [];
    return pools.filter(pool => {
      const allowed = pool.target_constraints?.allowed_levels;
      if (!allowed || allowed.length === 0 || allowed.includes('all')) return true;
      return allowed.some((lvl: string) => eventAllowedLevels.includes(lvl as any));
    });
  }, [pools, eventAllowedLevels]);
 const [selectedPool, setSelectedPool] = useState<EventPool | null>(null);
 const [submissions, setSubmissions] = useState<Submission[]>([]);
 const [votingCandidates, setVotingCandidates] = useState<PoolCandidate[]>([]);
 const [totalTurnout, setTotalTurnout] = useState(0);
 const [applications, setApplications] = useState<any[]>([]);
 const [participantsCount, setParticipantsCount] = useState(0);
 const [isLoading, setIsLoading] = useState(true);
 const [error, setError] = useState<string | null>(null);

 // Active View inside Modal: 'config' | 'content' | 'monitor' | 'evaluate' | 'applications'
 const [activeView, setActiveView] = useState<'config' | 'content' | 'monitor' | 'evaluate' | 'applications'>('config');

  const [quizQuestions, setQuizQuestions] = useState<QuizQuestion[]>([]);
  const [newQuestionType, setNewQuestionType] = useState('single');

  // Bulk Importer States
  const [isBulkImportOpen, setIsBulkImportOpen] = useState(false);
  const [bulkImportFormat, setBulkImportFormat] = useState<'json' | 'csv'>('json');
  const [bulkRawText, setBulkRawText] = useState('');
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [isImporting, setIsImporting] = useState(false);

  // Quiz Evaluation Tab
  const [quizEvalTab, setQuizEvalTab] = useState<'submissions' | 'item-analysis'>('submissions');

  // Student Audit Modal State
  const [selectedSubmissionForAudit, setSelectedSubmissionForAudit] = useState<Submission | null>(null);

  // Essay / Challenge Evaluation Modal States
  const [selectedSubmissionForEssayEval, setSelectedSubmissionForEssayEval] = useState<Submission | null>(null);
  const [rubricScores, setRubricScores] = useState<Record<string, number>>({});
  const [evaluatorNotes, setEvaluatorNotes] = useState('');
  const [evaluationStatus, setEvaluationStatus] = useState<'completed' | 'needs_revision'>('completed');

  // Election Gazette Modal State
  const [isGazetteOpen, setIsGazetteOpen] = useState(false);

 // Evaluator states
 const [editingSubId, setEditingSubId] = useState<string | null>(null);
 const [scoreInput, setScoreInput] = useState('');
 const [feedbackInput, setFeedbackInput] = useState('');
 const [podiumInput, setPodiumInput] = useState('');
 
 // Participation Rule State
 const [activeParticipationRule, setActiveParticipationRule] = useState('open');

  // Invite-Only State
  const [inviteSearchQuery, setInviteSearchQuery] = useState('');
  const [inviteFilterLevel, setInviteFilterLevel] = useState('all');
  const [inviteSearchResults, setInviteSearchResults] = useState<any[]>([]);
  const [invitedUsers, setInvitedUsers] = useState<any[]>([]);
  const [isInviteSearching, setIsInviteSearching] = useState(false);

  // Voting Content Builder State
  const [candidatesList, setCandidatesList] = useState<VotingCandidate[]>([]);
  const [candidateSearchQuery, setCandidateSearchQuery] = useState('');
  const [candidateFilterLevel] = useState('all');
  const [candidateSearchResults, setCandidateSearchResults] = useState<any[]>([]);

  const [selectedStudentForCandidate, setSelectedStudentForCandidate] = useState<any | null>(null);

  const [candidatePhotoUrl, setCandidatePhotoUrl] = useState('');


  // Debate State
  const [debateTopics, setDebateTopics] = useState<DebateTopic[]>([]);
  
  // Talent State
  const [talentActs, setTalentActs] = useState<TalentAct[]>([]);

  // Essay State
  const [essayMinWords, setEssayMinWords] = useState('');
  const [essayMaxWords, setEssayMaxWords] = useState('');
  const [essayRubric, setEssayRubric] = useState<string[]>([]);

  // Challenge State
  const [challengeObjectives, setChallengeObjectives] = useState<string[]>([]);
  const [challengeSubmissionFormat, setChallengeSubmissionFormat] = useState('text');

  // Academic State
  const [academicReferences, setAcademicReferences] = useState<Array<{ title: string; url: string }>>([]);
  const [academicMarkingScheme, setAcademicMarkingScheme] = useState('');

  // Custom Blocks State
  const [customBlocks, setCustomBlocks] = useState<CustomContentBlock[]>([]);

  const [showCreateModal, setShowCreateModal] = useState<'create' | 'edit' | false>(false);
  const [editingPoolId, setEditingPoolId] = useState<string | null>(null);
  const [newPoolTitle, setNewPoolTitle] = useState('');
  const [newPoolType, setNewPoolType] = useState('quiz');
  const [events, setEvents] = useState<any[]>([]);
  const [selectedEventId, setSelectedEventId] = useState('');

 useEffect(() => {
 fetchPools();
 fetchEvents();
 }, []);

  const fetchInviteUsers = async (query: string, level: string) => {
    setIsInviteSearching(true);
    try {
      let req = supabase.from('users')
        .select('id, full_name, username, avatar_url, level, role, is_external')
        .eq('role', 'student');
      
      if (query.trim().length >= 2) {
        req = req.or(`full_name.ilike.%${query}%,username.ilike.%${query}%`);
      }
      
      if (level !== 'all') {
        if (eventAllowedLevels && !eventAllowedLevels.includes(level as any)) {
          setInviteSearchResults([]);
          setIsInviteSearching(false);
          return;
        }
        req = req.eq('level', level);
      } else if (eventAllowedLevels && eventAllowedLevels.length > 0) {
        req = req.in('level', eventAllowedLevels);
      }
      
      const { data } = await req.limit(50);
      const invitedIds = invitedUsers.map(u => u.id);
      
      // Strict filter: exclude external moderators & already invited users
      const filtered = (data || []).filter((u: any) => 
        !u.is_external && 
        u.role !== 'moderator' && 
        !invitedIds.includes(u.id)
      );
      setInviteSearchResults(filtered);
    } catch { setInviteSearchResults([]); }
    finally { setIsInviteSearching(false); }
  };

  const handleInviteSearch = (query: string) => {
    setInviteSearchQuery(query);
    fetchInviteUsers(query, inviteFilterLevel);
  };

  const handleInviteFilterChange = (level: string) => {
    setInviteFilterLevel(level);
    fetchInviteUsers(inviteSearchQuery, level);
  };

  useEffect(() => {
    if (activeParticipationRule === 'individual_selection') {
      fetchInviteUsers(inviteSearchQuery, inviteFilterLevel);
    }
  }, [activeParticipationRule]);

  const addInvitedUser = (user: any) => {
    setInvitedUsers(prev => [...prev, user]);
    setInviteSearchResults(prev => prev.filter(u => u.id !== user.id));
  };

  const removeInvitedUser = (userId: string) => {
    setInvitedUsers(prev => prev.filter(u => u.id !== userId));
    fetchInviteUsers(inviteSearchQuery, inviteFilterLevel);
  };

  // Voting Candidate Search Logic
  const fetchCandidateSearchUsers = async (query: string, level: string) => {
    try {
      let req = supabase.from('users')
        .select('id, full_name, username, avatar_url, level, role, is_external')
        .eq('role', 'student');
        
      if (query.trim().length >= 2) {
        req = req.or(`full_name.ilike.%${query}%,username.ilike.%${query}%`);
      }
      
      if (level !== 'all') {
        if (eventAllowedLevels && !eventAllowedLevels.includes(level as any)) {
          setCandidateSearchResults([]);
          return;
        }
        req = req.eq('level', level);
      } else if (eventAllowedLevels && eventAllowedLevels.length > 0) {
        req = req.in('level', eventAllowedLevels);
      }
      
      const { data } = await req.limit(50);
      const existingCandidateUserIds = candidatesList.map(c => c.user_id);
      
      // Strict filter: exclude external moderators & existing candidates
      const filtered = (data || []).filter((u: any) => 
        !u.is_external && 
        u.role !== 'moderator' && 
        !existingCandidateUserIds.includes(u.id)
      );
      setCandidateSearchResults(filtered);
    } catch {
      setCandidateSearchResults([]);
    }
  };

  const handleCandidateSearch = (query: string) => {
    setCandidateSearchQuery(query);
    if (!query.trim()) {
      setSelectedStudentForCandidate(null);
      setCandidateSearchResults([]);
      return;
    }
    fetchCandidateSearchUsers(query, candidateFilterLevel);
  };

  const handleSelectCandidateSearchResult = (user: any) => {
    setSelectedStudentForCandidate(user);
    setCandidateSearchQuery(user.full_name);
    setCandidatePhotoUrl(user.avatar_url || '');
    setCandidateSearchResults([]); // Close dropdown
  };

  useEffect(() => {
    if (selectedPool?.type === 'voting' && activeView === 'content') {
      fetchCandidateSearchUsers(candidateSearchQuery, candidateFilterLevel);
    }
  }, [selectedPool?.type, activeView]);

  // const _handleAddCandidate = (user: any) => {
  //   setSelectedStudentForCandidate(user);
  //   setCandidatePositionTitle('');
  //   setCandidatePhotoUrl(user.avatar_url || '');
  //   setCandidateManifesto('');
  // };

  // const _handleConfirmCandidateAdd = () => {
  //   if (!selectedStudentForCandidate) return;
  //   const newCand: VotingCandidate = {
  //     id: crypto.randomUUID(),
  //     user_id: selectedStudentForCandidate.id,
  //     full_name: selectedStudentForCandidate.full_name,
  //     username: selectedStudentForCandidate.username,
  //     avatar_url: selectedStudentForCandidate.avatar_url,
  //     level: selectedStudentForCandidate.level,
  //     position_title: candidatePositionTitle.trim() || 'Candidate',
  //     photo_url: candidatePhotoUrl || selectedStudentForCandidate.avatar_url || '',
  //     manifesto: candidateManifesto.trim()
  //   };
  //   setCandidatesList(prev => [...prev, newCand]);
  //   setSelectedStudentForCandidate(null);
  //   setCandidatePositionTitle('');
  //   setCandidatePhotoUrl('');
  //   setCandidateManifesto('');
  //   setCandidateSearchResults(prev => prev.filter(u => u.id !== selectedStudentForCandidate.id));
  // };

  // const _handleRemoveCandidate = (candidateId: string) => {
  //   setCandidatesList(prev => prev.filter(c => c.id !== candidateId));
  // };

  // @ts-ignore
  const _handleSaveVotingCandidates = async () => {
    if (!selectedPool) return;
    try {
      const updates = {
        target_constraints: {
          ...selectedPool.target_constraints,
          candidates: candidatesList
        }
      };
      const { error } = await supabase.from('event_pools').update(updates).eq('id', selectedPool.id);
      if (error) throw error;
      setSelectedPool({ ...selectedPool, ...updates });
      fetchPools();
      alert('Voting Candidates saved successfully!');
    } catch (e: any) {
      alert('Failed to save candidates: ' + e.message);
    }
  };

  const handleSaveDebateTopics = async () => {
    if (!selectedPool) return;
    try {
      const updates = {
        target_constraints: {
          ...selectedPool.target_constraints,
          debate_topics: debateTopics
        }
      };
      const { error } = await supabase.from('event_pools').update(updates).eq('id', selectedPool.id);
      if (error) throw error;
      setSelectedPool({ ...selectedPool, ...updates });
      fetchPools();
      alert('Debate Topics saved successfully!');
    } catch (e: any) {
      alert('Failed to save debate topics: ' + e.message);
    }
  };

  const handleSaveTalentActs = async () => {
    if (!selectedPool) return;
    try {
      const updates = {
        target_constraints: {
          ...selectedPool.target_constraints,
          talent_acts: talentActs
        }
      };
      const { error } = await supabase.from('event_pools').update(updates).eq('id', selectedPool.id);
      if (error) throw error;
      setSelectedPool({ ...selectedPool, ...updates });
      fetchPools();
      alert('Talent Acts saved successfully!');
    } catch (e: any) {
      alert('Failed to save talent acts: ' + e.message);
    }
  };

  const handleSaveEssaySetup = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedPool) return;
    const fd = new FormData(e.currentTarget);
    const instructions = fd.get('instructions') as string;
    const media_url = fd.get('media_url') as string;
    const minWords = parseInt(essayMinWords || '0', 10);
    const maxWords = parseInt(essayMaxWords || '0', 10);

    try {
      const updates = {
        target_constraints: {
          ...selectedPool.target_constraints,
          instructions,
          media_url,
          word_limit_min: minWords || null,
          word_limit_max: maxWords || null,
          rubric_criteria: essayRubric
        }
      };
      const { error } = await supabase.from('event_pools').update(updates).eq('id', selectedPool.id);
      if (error) throw error;
      setSelectedPool({ ...selectedPool, ...updates });
      fetchPools();
      alert('Essay Configuration saved successfully!');
    } catch (e: any) {
      alert('Failed to save essay config: ' + e.message);
    }
  };

  const handleSaveRubricEvaluation = async () => {
    if (!selectedSubmissionForEssayEval) return;
    try {
      const criteria = selectedPool?.target_constraints?.rubric_criteria || DEFAULT_RUBRIC_CRITERIA;
      let calculatedTotal = 0;
      criteria.forEach((c: any) => {
        calculatedTotal += (rubricScores[c.key] || 0);
      });

      const updatedAnswers = {
        ...selectedSubmissionForEssayEval.answers,
        rubric_breakdown: rubricScores,
        evaluator_feedback: evaluatorNotes
      };

      const { error } = await supabase.from('pool_submissions').update({
        score: calculatedTotal,
        answers: updatedAnswers,
        grading_status: evaluationStatus,
        grading_score: calculatedTotal,
        grading_feedback: evaluatorNotes
      }).eq('id', selectedSubmissionForEssayEval.id);
      if (error) throw error;

      // Refresh table UI
      setSubmissions(submissions.map(s => 
        s.id === selectedSubmissionForEssayEval.id 
          ? { ...s, score: calculatedTotal, answers: updatedAnswers, grading_status: evaluationStatus } 
          : s
      ));
      
      setSelectedSubmissionForEssayEval(null);
      alert('Rubric evaluation saved successfully!');
    } catch (e: any) {
      alert('Failed to save rubric evaluation: ' + e.message);
    }
  };

  const handleOpenEssayEval = (sub: Submission) => {
    setSelectedSubmissionForEssayEval(sub);
    setEvaluatorNotes(sub.answers?.evaluator_feedback || '');
    setEvaluationStatus(sub.grading_status === 'needs_revision' ? 'needs_revision' : 'completed');
    
    // Initialize rubric scores
    const criteria = selectedPool?.target_constraints?.rubric_criteria || DEFAULT_RUBRIC_CRITERIA;
    const initialScores: Record<string, number> = {};
    criteria.forEach((c: any) => {
      initialScores[c.key] = sub.answers?.rubric_breakdown?.[c.key] || 0;
    });
    setRubricScores(initialScores);
  };

  const handleSaveChallengeSetup = async (e: React.FormEvent<HTMLFormElement>) => {
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
          media_url,
          objectives: challengeObjectives,
          submission_format: challengeSubmissionFormat
        }
      };
      const { error } = await supabase.from('event_pools').update(updates).eq('id', selectedPool.id);
      if (error) throw error;
      setSelectedPool({ ...selectedPool, ...updates });
      fetchPools();
      alert('Challenge Configuration saved successfully!');
    } catch (e: any) {
      alert('Failed to save challenge config: ' + e.message);
    }
  };

  const handleSaveAcademicSetup = async (e: React.FormEvent<HTMLFormElement>) => {
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
          media_url,
          reference_materials: academicReferences,
          marking_scheme: academicMarkingScheme
        }
      };
      const { error } = await supabase.from('event_pools').update(updates).eq('id', selectedPool.id);
      if (error) throw error;
      setSelectedPool({ ...selectedPool, ...updates });
      fetchPools();
      alert('Academic Configuration saved successfully!');
    } catch (e: any) {
      alert('Failed to save academic config: ' + e.message);
    }
  };

  const handleSaveCustomBlocks = async (e: React.FormEvent<HTMLFormElement>) => {
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
          media_url,
          custom_blocks: customBlocks
        }
      };
      const { error } = await supabase.from('event_pools').update(updates).eq('id', selectedPool.id);
      if (error) throw error;
      setSelectedPool({ ...selectedPool, ...updates });
      fetchPools();
      alert('Custom Content saved successfully!');
    } catch (e: any) {
      alert('Failed to save custom content: ' + e.message);
    }
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
        const defaultLevels = eventAllowedLevels || ['100', '200', '300', '400'];
        const { error } = await supabase.from('event_pools').insert({
          title: newPoolTitle,
          type: newPoolType,
          status: 'draft',
          participation_rule: eventAllowedLevels ? 'level_based' : 'open',
          target_constraints: {
            allowed_levels: defaultLevels,
            enable_registration: true
          },
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
    if (!canManagePool(pool)) {
      alert('Access Denied: Moderators cannot manage or modify event pools created by Super Admin.');
      return;
    }
    setSelectedPool(pool);
 setActiveParticipationRule(pool.participation_rule);
 setActiveView('config');
 try {
 // Fetch metrics
 const { count: pCount } = await supabase.from('pool_participants').select('*', { count: 'exact', head: true }).eq('pool_id', pool.id);
 setParticipantsCount(pCount || 0);

 // Fetch submissions or candidates
 if (pool.type === 'voting') {
   const { data: cands } = await supabase.from('pool_candidates').select('*').eq('pool_id', pool.id).order('vote_count', { ascending: false });
   setVotingCandidates(cands || []);
   const { count: vCount } = await supabase.from('pool_votes').select('*', { count: 'exact', head: true }).eq('pool_id', pool.id);
   setTotalTurnout(vCount || 0);
   setSubmissions([]); // clear generic submissions
 } else {
   const { data: subs } = await supabase.from('pool_submissions').select('id, user_id, answers, grading_status, grading_score, grading_feedback, podium_status, users:user_id(full_name, username)').eq('pool_id', pool.id);
   setSubmissions(subs ? subs.map((s: any) => ({ ...s, users: Array.isArray(s.users) ? s.users[0] : s.users })) : []);
   setVotingCandidates([]);
   setTotalTurnout(0);
 }
 
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

  // Load type-specific structured content from target_constraints
  const tc = pool.target_constraints || {};
  setCandidatesList(tc.candidates || []);
  setDebateTopics(tc.debate_topics || []);
  setTalentActs(tc.talent_acts || []);
  setEssayMinWords(tc.word_limit_min ? String(tc.word_limit_min) : '');
  setEssayMaxWords(tc.word_limit_max ? String(tc.word_limit_max) : '');
  setEssayRubric(tc.rubric_criteria || []);
  setChallengeObjectives(tc.objectives || []);
  setChallengeSubmissionFormat(tc.submission_format || 'text');
  setAcademicReferences(tc.reference_materials || []);
  setAcademicMarkingScheme(tc.marking_scheme || '');
  setCustomBlocks(tc.custom_blocks || []);
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
 
  let allowed_levels: string[] = [];
  if (eventAllowedLevels) {
    const formLevels = fd.getAll('allowed_levels') as string[];
    allowed_levels = formLevels.filter(lvl => eventAllowedLevels.includes(lvl as any));
    if (allowed_levels.length === 0) allowed_levels = eventAllowedLevels;
  } else {
    allowed_levels = fd.getAll('allowed_levels') as string[];
    if (allowed_levels.length === 0) allowed_levels = ['100', '200', '300', '400'];
  }

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

  const handleConfirmInviteOnly = async () => {
    if (!selectedPool || invitedUsers.length === 0) return;
    try {
        const userIds = invitedUsers.map(u => u.id);
        
        // Use RPC to confirm participants safely, bypassing RLS
        const { error: rpcErr } = await supabase.rpc('confirm_invite_only_participants', {
            p_pool_id: selectedPool.id,
            p_user_ids: userIds
        });

        if (rpcErr) throw rpcErr;

        alert('Participants confirmed and approved. They will now appear in the Registrations tab.');
        
        // Fetch updated pool state
        const { data: updatedPool } = await supabase.from('event_pools').select('*').eq('id', selectedPool.id).single();
        
        // Update local state and UI
        if (updatedPool) {
            loadPoolDetails(updatedPool);
        }
        setInvitedUsers([]); // Clear selection after confirmation
    } catch (e: any) {
        alert('Failed to confirm participants: ' + e.message);
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
 const positionMap: Record<string, number> = { 'Winner': 1, '1st Runner-Up': 2, '2nd Runner-Up': 3, '4th Position': 4, '5th Position': 5 };
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

  const handleDeclareAndFeatureSpecificWinner = async (winnerSub: any) => {
  if (!selectedPool) return;
  if (!window.confirm(`Feature "${winnerSub.users?.full_name}" as ${winnerSub.podium_status} for "${selectedPool.title}"?`)) return;
  try {
    const { error } = await supabase.from('featured_students').insert([{
      user_id: winnerSub.user_id,
      type: 'event_winner',
      scope: 'department',
      title: `${winnerSub.podium_status} — ${selectedPool.title}`,
      subtitle: `${winnerSub.podium_status} of ${selectedPool.title}`,
      pool_id: selectedPool.id,
      is_active: true,
    }]);
    if (error) throw error;
    alert(`${winnerSub.users?.full_name} successfully featured!`);
  } catch (e: any) {
    alert('Failed to feature winner: ' + e.message);
  }
  };

 const handleCreateCandidate = async (e: React.FormEvent<HTMLFormElement>) => {
   e.preventDefault();
   if (!selectedPool) return;
   const fd = new FormData(e.currentTarget);
   try {
     const { error } = await supabase.from('pool_candidates').insert({
       pool_id: selectedPool.id,
       display_name: candidateSearchQuery || (fd.get('display_name') as string),
       position_title: fd.get('position_title') as string,
       bio: fd.get('bio') as string,
       photo_url: candidatePhotoUrl || null,
       candidate_user_id: selectedStudentForCandidate?.id || null
     });
     if (error) throw error;
     alert('Candidate created successfully!');
     loadPoolDetails(selectedPool);
     setCandidatePhotoUrl('');
     setSelectedStudentForCandidate(null);
     setCandidateSearchQuery('');
     setCandidateSearchResults([]);
     (e.target as HTMLFormElement).reset();
   } catch (e: any) { alert('Error: ' + e.message); }
 };

 const handleDeleteCandidate = async (candId: string) => {
   if (selectedPool?.status !== 'draft' && selectedPool?.status !== 'scheduled') {
     alert('Cannot delete candidates once the election has started.');
     return;
   }
   if (!window.confirm('Delete this candidate?')) return;
   try {
     const { error } = await supabase.from('pool_candidates').delete().eq('id', candId);
     if (error) throw error;
     loadPoolDetails(selectedPool!);
   } catch (e: any) { alert('Error: ' + e.message); }
 };

 const handleCertifyElection = async () => {
   if (!selectedPool) return;
   if (!window.confirm("Are you sure you want to certify the election? This will seal the ballot box, crown the top candidate(s), and mark the event as completed.")) return;
   try {
     const { error } = await supabase.rpc('certify_voting_winners', { p_pool_id: selectedPool.id });
     if (error) throw error;
     alert("Election certified and winners officially declared!");
     fetchPools();
     setSelectedPool(null);
   } catch (e: any) { alert('Error: ' + e.message); }
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

 const handleExecuteBulkImport = async () => {
    if (!selectedPool) return;
    setIsImporting(true);
    setImportErrors([]);
    let parsedQuestions: any[] = [];

    try {
      if (bulkImportFormat === 'json') {
        const parsed = JSON.parse(bulkRawText);
        if (!Array.isArray(parsed)) throw new Error('Root JSON must be an array of questions');
        
        parsed.forEach((q, idx) => {
          if (!q.question_text || typeof q.question_text !== 'string') throw new Error(`Row ${idx + 1}: Missing or invalid question_text`);
          if (!q.options || !Array.isArray(q.options) || q.options.length < 2) throw new Error(`Row ${idx + 1}: options must be an array of at least 2 strings`);
          if (!q.correct_option || typeof q.correct_option !== 'string') throw new Error(`Row ${idx + 1}: Missing or invalid correct_option`);
          if (!q.options.includes(q.correct_option)) throw new Error(`Row ${idx + 1}: correct_option is not present in the options array`);
          
          parsedQuestions.push({
            question_text: q.question_text,
            options: q.options,
            correct_option: q.correct_option,
            points: Number(q.points) || 1,
            explanation: q.explanation || null
          });
        });
      } else {
        // CSV Parsing
        const lines = bulkRawText.split(/\r?\n/).filter(l => l.trim().length > 0);
        if (lines.length <= 1) throw new Error('CSV requires a header row and at least one data row');
        
        const parseCSVLine = (line: string) => {
          const result = [];
          let cur = '';
          let inQuotes = false;
          for (let i = 0; i < line.length; i++) {
            const char = line[i];
            if (char === '"' && line[i+1] === '"') { cur += '"'; i++; } // Escaped quote
            else if (char === '"') { inQuotes = !inQuotes; }
            else if (char === ',' && !inQuotes) { result.push(cur); cur = ''; }
            else { cur += char; }
          }
          result.push(cur);
          return result;
        };

        const headers = parseCSVLine(lines[0]).map(h => h.trim().toLowerCase());
        const qIdx = headers.indexOf('question');
        const ansIdx = headers.indexOf('correct');
        const ptsIdx = headers.indexOf('points');
        const expIdx = headers.indexOf('explanation');
        
        // Find option columns dynamically or by naming convention
        const optionIndices = headers.map((h, i) => h.startsWith('option') ? i : -1).filter(i => i !== -1);
        
        if (qIdx === -1 || ansIdx === -1 || optionIndices.length < 2) {
          throw new Error('CSV must contain headers: question, correct, and at least two option_X columns (e.g. option_a, option_b)');
        }

        for (let i = 1; i < lines.length; i++) {
          const row = parseCSVLine(lines[i]);
          if (row.length < headers.length) continue; // Skip malformed rows
          
          const qText = row[qIdx]?.trim();
          const qAns = row[ansIdx]?.trim();
          const qPts = ptsIdx !== -1 ? Number(row[ptsIdx]?.trim()) || 1 : 1;
          const qExp = expIdx !== -1 ? row[expIdx]?.trim() || null : null;
          
          const opts = optionIndices.map(idx => row[idx]?.trim()).filter(Boolean);
          
          if (!qText) throw new Error(`Row ${i + 1}: Missing question text`);
          if (opts.length < 2) throw new Error(`Row ${i + 1}: Requires at least 2 non-empty options`);
          if (!opts.includes(qAns)) throw new Error(`Row ${i + 1}: correct option '${qAns}' not found in options [${opts.join(', ')}]`);
          
          parsedQuestions.push({
            question_text: qText,
            options: opts,
            correct_option: qAns,
            points: qPts,
            explanation: qExp
          });
        }
      }

      // Batch DB Insert
      const recordsToInsert = parsedQuestions.map(q => ({
        pool_id: selectedPool.id,
        question_text: q.question_text.trim(),
        options: q.options.map((o: string) => o.trim()),
        correct_option: q.correct_option.trim(),
        points: q.points || 1,
        explanation: q.explanation?.trim() || null
      }));

      const { data, error } = await supabase.from('pool_quiz_questions').insert(recordsToInsert).select();
      if (error) throw error;
      
      setQuizQuestions(prev => [...prev, ...(data || [])]);
      alert(`Successfully imported ${recordsToInsert.length} questions!`);
      setIsBulkImportOpen(false);
      setBulkRawText('');
    } catch (err: any) {
      setImportErrors([err.message || 'Unknown parsing error']);
    } finally {
      setIsImporting(false);
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
  {displayedPools.length === 0 ? (
    <div className="col-span-full py-16 text-center bg-white rounded-2xl border border-slate-200 p-8">
      <Trophy className="w-12 h-12 text-slate-300 mx-auto mb-3" />
      <p className="text-base font-bold text-slate-700">No event pools found</p>
      <p className="text-xs text-slate-400 mt-1">
        {eventAllowedLevels ? `No event pools found for Level ${eventAllowedLevels.join(', ')}.` : 'Create a new event pool to get started.'}
      </p>
    </div>
  ) : (
    displayedPools.map(pool => (
 <div key={pool.id} className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 hover:border-primary-200 transition-colors">
 <div className="flex justify-between items-start mb-4">
 <h3 className="font-bold text-lg text-gray-900 line-clamp-1 pr-2">{pool.title}</h3>
 <div className="flex items-center gap-2 flex-shrink-0">
 <span className="px-2.5 py-1 bg-gray-100 text-gray-700 rounded-full text-xs font-medium capitalize">
 {pool.type}
 </span>
 {canManagePool(pool) && (
   <>
     <button onClick={() => handleOpenEditModal(pool)} className="p-1.5 text-slate-400 hover:text-primary-600 hover:bg-primary-50 rounded-md transition-colors" title="Edit Pool Info">
     <Edit className="h-4 w-4" />
     </button>
     <button onClick={() => handleDeletePool(pool.id, pool.title)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors" title="Delete Pool">
     <Trash2 className="h-4 w-4" />
     </button>
   </>
 )}
 </div>
 </div>
 <p className="text-sm text-gray-500 mb-6 capitalize font-medium flex items-center gap-1.5">
 <Activity className="h-4 w-4" /> Status: {pool.status}
 </p>
 {canManagePool(pool) ? (
    <button
      onClick={() => loadPoolDetails(pool)}
      className="w-full py-2.5 bg-primary-50 text-primary-700 hover:bg-primary-100 font-semibold rounded-lg flex items-center justify-center gap-2 transition-colors"
    >
      <Settings className="h-4 w-4" />
      Manage Pool Rules & Setup
    </button>
  ) : (
    <div className="w-full py-2.5 bg-slate-100 text-slate-400 font-bold rounded-lg flex items-center justify-center gap-2 text-xs border border-slate-200 cursor-not-allowed">
      <Lock className="h-3.5 w-3.5 text-slate-400" />
      Super Admin Pool (Protected)
    </div>
  )}
 </div>
 ))
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
 <option value="scheduled">Scheduled (Auto-Live)</option>
 <option value="completed">Completed</option>
 <option value="archived">Archived</option>
 </select>
 </div>
 <div>
 <label className="block text-sm font-semibold text-gray-700 mb-1">Participation Rule</label>
 <select name="participation_rule" value={activeParticipationRule} onChange={(e) => setActiveParticipationRule(e.target.value)} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 ">
 <option value="open">Open (All)</option>
 <option value="level_based">Level Based</option>
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
       <div className="mt-4 p-4 bg-white border rounded-xl border-slate-200">
           <div className="flex items-center justify-between mb-2">
               <label className="block text-xs font-bold text-slate-700">Allowed Target Levels</label>
               {eventAllowedLevels && (
                   <span className="text-[10px] font-black uppercase text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                       🔒 Restricted to Level(s) {eventAllowedLevels.join(', ')}
                   </span>
               )}
           </div>
           <div className="flex flex-wrap gap-3">
               {(eventAllowedLevels || ['100', '200', '300', '400']).map(level => {
                   const isChecked = selectedPool.target_constraints?.allowed_levels?.includes(level) ?? true;
                   return (
                       <label key={level} className="flex items-center gap-1.5 text-sm text-gray-800 font-medium cursor-pointer">
                           <input
                               type="checkbox"
                               name="allowed_levels"
                               value={level}
                               defaultChecked={isChecked}
                               className="rounded text-primary-600 focus:ring-primary-500"
                           />
                           Level {level}
                       </label>
                   );
               })}
           </div>
       </div>
   )}
   {activeParticipationRule === 'individual_selection' && (
       <div className="mt-4 p-4 bg-white border rounded-xl border-slate-200">
           <label className="block text-sm font-bold text-slate-700 mb-4">Invite Participants</label>
           
           <div className="flex flex-col md:flex-row gap-6">
               {/* Left Column: Student Browser */}
               <div className="flex-1 space-y-3">
                   <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Browse Students</h4>
                   
                   {/* Filters Row */}
                   <div className="flex gap-2">
                       <div className="relative flex-1">
                           <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                           <input
                               type="text"
                               value={inviteSearchQuery}
                               onChange={(e) => handleInviteSearch(e.target.value)}
                               placeholder="Search by name or username..."
                               className="w-full pl-9 pr-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-primary-500"
                           />
                       </div>
                       <select 
                           value={inviteFilterLevel}
                           onChange={(e) => handleInviteFilterChange(e.target.value)}
                           className="px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-primary-500 bg-white min-w-[100px]"
                       >
                           <option value="all">All Assigned Levels</option>
                           {(eventAllowedLevels || ['100', '200', '300', '400']).map(lvl => (
                               <option key={lvl} value={lvl}>Level {lvl}</option>
                           ))}
                       </select>
                   </div>
                   {/* Browser List */}
                  <div className="border rounded-lg h-[300px] overflow-y-auto divide-y bg-slate-50 relative">
                      {isInviteSearching && (
                          <div className="absolute inset-0 bg-white/50 flex items-center justify-center backdrop-blur-sm z-10">
                              <LoadingSpinner size="sm" />
                          </div>
                      )}
                      
                      {inviteSearchResults.length === 0 && !isInviteSearching ? (
                          <div className="p-8 text-center text-gray-500 text-sm">
                              No students found matching your criteria.
                          </div>
                      ) : (
                          inviteSearchResults.map(user => (
                              <div key={user.id} className="w-full flex items-center gap-3 px-3 py-3 hover:bg-white transition-colors">
                                  <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-slate-700 font-bold text-xs shrink-0">
                                      {user.full_name?.[0] || '?'}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                      <p className="text-sm font-medium text-gray-900 truncate">{user.full_name}</p>
                                      <p className="text-xs text-gray-500">@{user.username} • Level {user.level || '?'}</p>
                                  </div>
                                  <button 
                                      type="button"
                                      onClick={() => addInvitedUser(user)} 
                                      className="flex items-center gap-1.5 px-3 py-1.5 bg-primary-50 text-primary-700 hover:bg-primary-100 rounded-md text-xs font-medium transition-colors shrink-0"
                                  >
                                      <UserPlus className="h-3 w-3" /> Add
                                  </button>
                              </div>
                          ))
                      )}
                  </div>
              </div>

              {/* Right Column: Selected Participants */}
              <div className="w-full md:w-72 flex flex-col">
                  <div className="flex items-center justify-between mb-3">
                      <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Selected</h4>
                      <span className="bg-primary-100 text-primary-800 text-xs font-bold px-2 py-0.5 rounded-full">
                          {invitedUsers.length}
                      </span>
                  </div>
                  
                  <div className="border rounded-lg flex-1 h-[300px] overflow-y-auto bg-white p-2 space-y-2">
                      {invitedUsers.length === 0 ? (
                          <div className="h-full flex flex-col items-center justify-center text-center p-4">
                              <Users className="h-8 w-8 text-slate-300 mb-2" />
                              <p className="text-sm text-slate-500">No participants selected yet.</p>
                          </div>
                      ) : (
                          invitedUsers.map(user => (
                              <div key={user.id} className="flex items-center gap-3 px-3 py-2 bg-slate-50 border border-slate-100 rounded-lg group hover:border-red-200 transition-colors">
                                  <div className="w-7 h-7 rounded-full bg-primary-100 flex items-center justify-center text-primary-800 font-bold text-xs shrink-0">
                                      {user.full_name?.[0] || '?'}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                      <p className="text-sm font-medium text-slate-900 truncate">{user.full_name}</p>
                                      <p className="text-[10px] text-slate-500 truncate">@{user.username}</p>
                                  </div>
                                  <button 
                                      type="button"
                                      onClick={() => removeInvitedUser(user.id)} 
                                      className="p-1.5 hover:bg-red-100 text-slate-400 hover:text-red-600 rounded-md transition-colors opacity-0 group-hover:opacity-100 shrink-0" 
                                      title="Remove from list"
                                  >
                                      <Trash2 className="h-4 w-4" />
                                  </button>
                              </div>
                          ))
                      )}
                  </div>
                  <button
                      type="button"
                      onClick={handleConfirmInviteOnly}
                      disabled={invitedUsers.length === 0}
                      className="w-full py-2.5 bg-primary-600 text-white rounded-lg text-sm font-semibold hover:bg-primary-700 transition-colors mt-3 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                      <CheckCircle className="h-4 w-4" />
                      Confirm & Approve
                  </button>
              </div>
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
 <button onClick={() => setIsBulkImportOpen(true)} className="text-sm font-medium text-primary-600 hover:text-primary-700">
 Bulk Import Questions
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

 {/* Add new question form */}
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
 </div>
 ) : selectedPool.type === 'voting' ? (
  <div className="space-y-6">
    <div className="bg-emerald-50 border border-emerald-200 p-4 rounded-xl flex justify-between items-center">
      <div>
        <h4 className="font-bold text-emerald-900">Manage Voting Candidates</h4>
        <p className="text-xs text-emerald-700">Add or remove candidates directly from the election roster.</p>
      </div>
    </div>
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <form onSubmit={handleCreateCandidate} className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-4">
        <h5 className="font-bold text-sm">Add New Candidate</h5>
        <div className="relative">
          <label className="block text-xs font-bold mb-1">Display Name *</label>
          <input required name="display_name" type="text" className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="e.g. John Doe (Type to search registered users)" value={candidateSearchQuery} onChange={(e) => handleCandidateSearch(e.target.value)} autoComplete="off" />
          
          {candidateSearchQuery.length >= 2 && candidateSearchResults.length > 0 && (
            <div className="absolute z-10 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
              {candidateSearchResults.map(user => (
                <div key={user.id} className="p-2 hover:bg-slate-50 cursor-pointer flex items-center gap-2 border-b border-slate-100 last:border-b-0" onClick={() => handleSelectCandidateSearchResult(user)}>
                  {user.avatar_url ? <img src={user.avatar_url} className="w-6 h-6 rounded-full object-cover" /> : <div className="w-6 h-6 rounded-full bg-slate-200 flex items-center justify-center"><Users className="w-3 h-3 text-slate-400" /></div>}
                  <div>
                    <p className="text-sm font-bold text-slate-800">{user.full_name}</p>
                    <p className="text-xs text-slate-500">@{user.username} {user.level ? `• Level ${user.level}` : ''}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div>
          <label className="block text-xs font-bold mb-1">Position / Office *</label>
          <input required name="position_title" type="text" className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="e.g. President" />
        </div>
        <div>
          <label className="block text-xs font-bold mb-1">Bio / Manifesto</label>
          <textarea name="bio" rows={2} className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="Message to voters..."></textarea>
        </div>
        <div>
          <label className="block text-xs font-bold mb-1">Candidate Photo</label>
          <FileUpload accept="image/*" isImage={true} folder="candidate_posters" onUploadComplete={(url) => setCandidatePhotoUrl(url)} currentFileUrl={candidatePhotoUrl} />
        </div>
        <button type="submit" className="w-full py-2 bg-emerald-600 text-white rounded-lg font-bold text-sm hover:bg-emerald-700">Add Candidate</button>
      </form>
      <div className="space-y-3 max-h-[500px] overflow-y-auto">
        <h5 className="font-bold text-sm">Current Roster ({votingCandidates.length})</h5>
        {votingCandidates.map(c => (
          <div key={c.id} className="p-3 bg-white border border-slate-200 rounded-xl flex justify-between items-center shadow-sm">
            <div className="flex gap-3 items-center">
              {c.photo_url ? <img src={c.photo_url} className="w-10 h-10 rounded-full object-cover" /> : <div className="w-10 h-10 rounded-full bg-slate-200 flex items-center justify-center"><Users className="w-5 h-5 text-slate-400" /></div>}
              <div>
                <p className="font-bold text-sm text-slate-900">{c.display_name}</p>
                <p className="text-[10px] text-emerald-700 font-black uppercase tracking-wider">{c.position_title}</p>
              </div>
            </div>
            <button type="button" onClick={() => handleDeleteCandidate(c.id)} className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"><Trash2 className="w-4 h-4" /></button>
          </div>
        ))}
      </div>
    </div>
  </div>
  ) : selectedPool.type === 'debate' ? (
  /* DEBATE CONTENT BUILDER */
  <div className="space-y-6 max-w-3xl">
    <div className="bg-purple-50 border border-purple-200 p-4 rounded-xl flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className="bg-purple-100 p-2.5 rounded-lg text-purple-700">
          <MessageSquare className="h-5 w-5" />
        </div>
        <div>
          <h4 className="font-bold text-purple-900 text-sm">Debate Motions & Topics Builder</h4>
          <p className="text-xs text-purple-700">Configure debate motions, speaker time limits, and arguments.</p>
        </div>
      </div>
      <button
        type="button"
        onClick={handleSaveDebateTopics}
        className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5 shadow-sm"
      >
        <Save className="h-3.5 w-3.5" /> Save Debate Setup
      </button>
    </div>

    <div className="space-y-4">
      {debateTopics.map((topic, idx) => (
        <div key={topic.id} className="p-4 bg-white border border-slate-200 rounded-xl space-y-3 shadow-sm">
          <div className="flex justify-between items-center">
            <h5 className="font-bold text-xs uppercase tracking-wider text-purple-800">Debate Motion #{idx + 1}</h5>
            <button
              onClick={() => setDebateTopics(prev => prev.filter(t => t.id !== topic.id))}
              className="text-slate-400 hover:text-red-600 p-1"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
          <input
            type="text"
            value={topic.topic_title}
            onChange={(e) => {
              const val = e.target.value;
              setDebateTopics(prev => prev.map(t => t.id === topic.id ? { ...t, topic_title: val } : t));
            }}
            placeholder="Motion Title e.g. Artificial Intelligence will benefit higher education..."
            className="w-full px-3 py-2 border rounded-lg text-sm font-medium focus:ring-2 focus:ring-purple-500"
          />
          <textarea
            value={topic.description}
            onChange={(e) => {
              const val = e.target.value;
              setDebateTopics(prev => prev.map(t => t.id === topic.id ? { ...t, description: val } : t));
            }}
            rows={2}
            placeholder="Motion background & rules..."
            className="w-full px-3 py-2 border rounded-lg text-xs focus:ring-2 focus:ring-purple-500"
          />
        </div>
      ))}

      <button
        type="button"
        onClick={() => setDebateTopics(prev => [...prev, { id: crypto.randomUUID(), topic_title: '', description: '', sides: ['For', 'Against'], time_per_speaker_sec: 180 }])}
        className="w-full py-3 border-2 border-dashed border-purple-200 hover:border-purple-400 text-purple-700 font-bold rounded-xl text-xs flex items-center justify-center gap-2 transition-colors"
      >
        <Plus className="h-4 w-4" /> Add Debate Motion
      </button>
    </div>
  </div>
  ) : selectedPool.type === 'talent' ? (
  /* TALENT SHOW CONTENT BUILDER */
  <div className="space-y-6 max-w-3xl">
    <div className="bg-amber-50 border border-amber-200 p-4 rounded-xl flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className="bg-amber-100 p-2.5 rounded-lg text-amber-700">
          <Sparkles className="h-5 w-5" />
        </div>
        <div>
          <h4 className="font-bold text-amber-900 text-sm">Talent Show Performance Slots</h4>
          <p className="text-xs text-amber-700">Register performance acts, contestants, and showcase video media.</p>
        </div>
      </div>
      <button
        type="button"
        onClick={handleSaveTalentActs}
        className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5 shadow-sm"
      >
        <Save className="h-3.5 w-3.5" /> Save Talent Acts
      </button>
    </div>

    <div className="space-y-4">
      {talentActs.map((act, idx) => (
        <div key={act.id} className="p-4 bg-white border border-slate-200 rounded-xl space-y-3 shadow-sm">
          <div className="flex justify-between items-center">
            <h5 className="font-bold text-xs uppercase tracking-wider text-amber-800">Performance Act #{idx + 1}</h5>
            <button
              onClick={() => setTalentActs(prev => prev.filter(a => a.id !== act.id))}
              className="text-slate-400 hover:text-red-600 p-1"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <input
              type="text"
              value={act.act_title}
              onChange={(e) => {
                const val = e.target.value;
                setTalentActs(prev => prev.map(a => a.id === act.id ? { ...a, act_title: val } : a));
              }}
              placeholder="Act Title e.g. Musical Solo, Standup Comedy..."
              className="px-3 py-2 border rounded-lg text-xs font-semibold focus:ring-2 focus:ring-amber-500"
            />
            <input
              type="text"
              value={act.performer_name}
              onChange={(e) => {
                const val = e.target.value;
                setTalentActs(prev => prev.map(a => a.id === act.id ? { ...a, performer_name: val } : a));
              }}
              placeholder="Performer / Group Name..."
              className="px-3 py-2 border rounded-lg text-xs focus:ring-2 focus:ring-amber-500"
            />
          </div>
          <input
            type="url"
            value={act.media_url || ''}
            onChange={(e) => {
              const val = e.target.value;
              setTalentActs(prev => prev.map(a => a.id === act.id ? { ...a, media_url: val } : a));
            }}
            placeholder="Sample Media / Video URL (Optional)"
            className="w-full px-3 py-2 border rounded-lg text-xs focus:ring-2 focus:ring-amber-500"
          />
        </div>
      ))}

      <button
        type="button"
        onClick={() => setTalentActs(prev => [...prev, { id: crypto.randomUUID(), performer_name: '', act_title: '', act_type: 'General' }])}
        className="w-full py-3 border-2 border-dashed border-amber-200 hover:border-amber-400 text-amber-700 font-bold rounded-xl text-xs flex items-center justify-center gap-2 transition-colors"
      >
        <Plus className="h-4 w-4" /> Add Performance Act
      </button>
    </div>
  </div>
  ) : selectedPool.type === 'essay' ? (
  /* ESSAY CONTENT BUILDER */
  <form onSubmit={handleSaveEssaySetup} className="space-y-6 max-w-3xl">
    <div className="bg-blue-50 border border-blue-200 p-4 rounded-xl flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className="bg-blue-100 p-2.5 rounded-lg text-blue-700">
          <FileText className="h-5 w-5" />
        </div>
        <div>
          <h4 className="font-bold text-blue-900 text-sm">Essay Prompt & Rubric Configuration</h4>
          <p className="text-xs text-blue-700">Set word limits, essay prompt instructions, and evaluation criteria.</p>
        </div>
      </div>
      <button
        type="submit"
        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5 shadow-sm"
      >
        <Save className="h-3.5 w-3.5" /> Save Essay Setup
      </button>
    </div>

    <div className="space-y-4">
      <div>
        <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Essay Prompt & Topic Instructions *</label>
        <textarea
          name="instructions"
          required
          rows={6}
          defaultValue={selectedPool.target_constraints?.instructions || ''}
          placeholder="Detailed prompt for the essay competition..."
          className="w-full px-3 py-2 border rounded-xl text-sm focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1">Min Word Count</label>
          <input
            type="number"
            value={essayMinWords}
            onChange={(e) => setEssayMinWords(e.target.value)}
            placeholder="e.g. 300"
            className="w-full px-3 py-2 border rounded-lg text-xs"
          />
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1">Max Word Count</label>
          <input
            type="number"
            value={essayMaxWords}
            onChange={(e) => setEssayMaxWords(e.target.value)}
            placeholder="e.g. 1000"
            className="w-full px-3 py-2 border rounded-lg text-xs"
          />
        </div>
      </div>

      <div>
        <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Attachment / Reference URL (Optional)</label>
        <input
          name="media_url"
          type="url"
          defaultValue={selectedPool.target_constraints?.media_url || ''}
          placeholder="https://example.com/essay_guidelines.pdf"
          className="w-full px-3 py-2 border rounded-lg text-xs"
        />
      </div>
    </div>
  </form>
  ) : selectedPool.type === 'challenge' ? (
  /* CHALLENGE CONTENT BUILDER */
  <form onSubmit={handleSaveChallengeSetup} className="space-y-6 max-w-3xl">
    <div className="bg-orange-50 border border-orange-200 p-4 rounded-xl flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className="bg-orange-100 p-2.5 rounded-lg text-orange-700">
          <Trophy className="h-5 w-5" />
        </div>
        <div>
          <h4 className="font-bold text-orange-900 text-sm">Challenge Brief & Objectives Setup</h4>
          <p className="text-xs text-orange-700">Configure challenge instructions, target objectives, and submission rules.</p>
        </div>
      </div>
      <button
        type="submit"
        className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5 shadow-sm"
      >
        <Save className="h-3.5 w-3.5" /> Save Challenge Setup
      </button>
    </div>

    <div className="space-y-4">
      <div>
        <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Challenge Brief & Rules *</label>
        <textarea
          name="instructions"
          required
          rows={6}
          defaultValue={selectedPool.target_constraints?.instructions || ''}
          placeholder="Detailed challenge problem statement and submission instructions..."
          className="w-full px-3 py-2 border rounded-xl text-sm focus:ring-2 focus:ring-orange-500"
        />
      </div>

      <div>
        <label className="block text-xs font-bold text-slate-700 mb-1">Submission Format</label>
        <select
          value={challengeSubmissionFormat}
          onChange={(e) => setChallengeSubmissionFormat(e.target.value)}
          className="w-full px-3 py-2 border rounded-lg text-xs bg-white"
        >
          <option value="text">Text Response / Written Answer</option>
          <option value="link">Repository / External URL Link</option>
          <option value="file">File Upload Attachment</option>
          <option value="code">Source Code Snippet</option>
        </select>
      </div>

      <div>
        <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Attachment / Reference Media URL (Optional)</label>
        <input
          name="media_url"
          type="url"
          defaultValue={selectedPool.target_constraints?.media_url || ''}
          placeholder="https://example.com/challenge_dataset.zip"
          className="w-full px-3 py-2 border rounded-lg text-xs"
        />
      </div>
    </div>
  </form>
  ) : selectedPool.type === 'academic' ? (
  /* ACADEMIC CONTENT BUILDER */
  <form onSubmit={handleSaveAcademicSetup} className="space-y-6 max-w-3xl">
    <div className="bg-indigo-50 border border-indigo-200 p-4 rounded-xl flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className="bg-indigo-100 p-2.5 rounded-lg text-indigo-700">
          <BookOpen className="h-5 w-5" />
        </div>
        <div>
          <h4 className="font-bold text-indigo-900 text-sm">Academic Project / Research Setup</h4>
          <p className="text-xs text-indigo-700">Configure academic assignment guidelines, syllabus references, and marking schemes.</p>
        </div>
      </div>
      <button
        type="submit"
        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5 shadow-sm"
      >
        <Save className="h-3.5 w-3.5" /> Save Academic Setup
      </button>
    </div>

    <div className="space-y-4">
      <div>
        <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Academic Prompt & Course Work Instructions *</label>
        <textarea
          name="instructions"
          required
          rows={6}
          defaultValue={selectedPool.target_constraints?.instructions || ''}
          placeholder="Academic assignment question or research topic..."
          className="w-full px-3 py-2 border rounded-xl text-sm focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      <div>
        <label className="block text-xs font-bold text-slate-700 mb-1">Marking Scheme / Grading Breakdown</label>
        <textarea
          value={academicMarkingScheme}
          onChange={(e) => setAcademicMarkingScheme(e.target.value)}
          rows={3}
          placeholder="e.g., 40% Methodology, 30% Analysis, 30% Presentation..."
          className="w-full px-3 py-2 border rounded-lg text-xs"
        />
      </div>

      <div>
        <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Lecture Slides / Syllabus Attachment URL (Optional)</label>
        <input
          name="media_url"
          type="url"
          defaultValue={selectedPool.target_constraints?.media_url || ''}
          placeholder="https://example.com/lecture_material.pdf"
          className="w-full px-3 py-2 border rounded-lg text-xs"
        />
      </div>
    </div>
  </form>
  ) : selectedPool.type === 'custom' ? (
  /* CUSTOM CONTENT BUILDER */
  <form onSubmit={handleSaveCustomBlocks} className="space-y-6 max-w-3xl">
    <div className="bg-slate-100 border border-slate-200 p-4 rounded-xl flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className="bg-slate-200 p-2.5 rounded-lg text-slate-700">
          <Settings className="h-5 w-5" />
        </div>
        <div>
          <h4 className="font-bold text-slate-900 text-sm">Custom Event Configuration</h4>
          <p className="text-xs text-slate-600">Configure bespoke instructions and flexible parameters for custom programs.</p>
        </div>
      </div>
      <button
        type="submit"
        className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5 shadow-sm"
      >
        <Save className="h-3.5 w-3.5" /> Save Custom Setup
      </button>
    </div>

    <div className="space-y-4">
      <div>
        <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Custom Event Guidelines & Description *</label>
        <textarea
          name="instructions"
          required
          rows={6}
          defaultValue={selectedPool.target_constraints?.instructions || ''}
          placeholder="General rules, details, and prompts for participants..."
          className="w-full px-3 py-2 border rounded-xl text-sm focus:ring-2 focus:ring-slate-500"
        />
      </div>

      <div>
        <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Media / Attachment URL (Optional)</label>
        <input
          name="media_url"
          type="url"
          defaultValue={selectedPool.target_constraints?.media_url || ''}
          placeholder="https://example.com/resource.png"
          className="w-full px-3 py-2 border rounded-lg text-xs"
        />
      </div>
    </div>
  </form>
  ) : (
  /* GENERIC FALLBACK BUILDER */
  <form onSubmit={handleSaveInstructions} className="space-y-4 max-w-3xl">
    <div>
      <label className="block text-sm font-semibold text-gray-700 mb-2">Prompt / Instructions for Participants</label>
      <p className="text-sm text-gray-500 mb-3">These instructions will be displayed to the participant when they start the event.</p>
      <textarea
        name="instructions"
        rows={10}
        defaultValue={selectedPool.target_constraints?.instructions || ''}
        className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary-500"
        placeholder="Instructions & rules for this event..."
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

 {/* 3. Evaluation Terminal & Voting Tally */}
 {activeView === 'evaluate' && (
   <div className="space-y-6">
     {selectedPool.type === 'voting' ? (
       <div className="space-y-6">
         <div className="flex justify-between items-center bg-gray-50 p-4 rounded-xl border border-gray-200">
         <div>
           <h3 className="font-bold text-gray-900">Live Election Telemetry</h3>
           <p className="text-sm text-gray-500">Total Verified Ballots Cast: {totalTurnout}</p>
         </div>
         <div className="flex gap-3 items-center">
           <span className={`px-3 py-1 rounded-full text-xs font-bold ${selectedPool.status === 'completed' ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'}`}>
             {selectedPool.status === 'completed' ? 'Sealed & Certified' : (selectedPool.status === 'live' ? 'Live Poll' : 'Scheduled')}
           </span>
           {selectedPool.status === 'completed' && (
             <button
               onClick={() => setIsGazetteOpen(true)}
               className="px-4 py-2 bg-gray-800 text-white rounded-lg text-sm font-semibold hover:bg-black flex items-center gap-2"
             >
               <FileDown className="w-4 h-4" />
               Export Election Gazette
             </button>
           )}
           {(selectedPool.status === 'live' || new Date() > new Date(selectedPool.end_time || '')) && selectedPool.status !== 'completed' && (
             <button
               onClick={handleCertifyElection}
               className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-semibold hover:bg-green-700"
             >
               Certify Results & Close Poll
             </button>
           )}
         </div>
       </div>

       {votingCandidates.length === 0 ? (
         <div className="text-center py-12 text-gray-500 bg-gray-50 rounded-xl border border-dashed border-gray-300">
           No candidates in this election.
         </div>
       ) : (
         <div className="space-y-6">
           {Object.entries(
             votingCandidates.reduce((acc: Record<string, PoolCandidate[]>, cand) => {
               acc[cand.position_title] = acc[cand.position_title] || [];
               acc[cand.position_title].push(cand);
               return acc;
             }, {})
           ).map(([position, candidates]) => {
             // Calculate category total votes to determine local turnout percentage
             const categoryTotalVotes = candidates.reduce((sum, c) => sum + c.vote_count, 0);

             return (
             <div key={position} className="border border-gray-200 rounded-xl overflow-hidden bg-white shadow-sm">
               <div className="bg-blue-50 px-4 py-3 border-b border-gray-200 flex justify-between items-center">
                 <h4 className="font-bold text-blue-900 uppercase tracking-wider text-sm">{position}</h4>
                 <span className="text-xs font-bold text-blue-700">{categoryTotalVotes} Valid Ballots Cast</span>
               </div>
               <table className="w-full text-left text-sm">
                 <thead className="bg-gray-50 text-gray-600 border-b border-gray-200">
                   <tr>
                     <th className="px-4 py-3 font-semibold">Rank</th>
                     <th className="px-4 py-3 font-semibold">Candidate</th>
                     <th className="px-4 py-3 font-semibold text-right">Votes</th>
                     <th className="px-4 py-3 font-semibold w-1/4">Turnout %</th>
                   </tr>
                 </thead>
                 <tbody className="divide-y divide-gray-100">
                   {candidates.map((cand, idx) => (
                     <tr key={cand.id} className="hover:bg-gray-50 bg-white">
                       <td className="px-4 py-3 font-bold text-gray-700">
                         {cand.podium_rank ? cand.podium_rank : `#${idx + 1}`}
                       </td>
                       <td className="px-4 py-3 flex items-center gap-3">
                         {cand.photo_url ? (
                           <img src={cand.photo_url} alt="" className="w-8 h-8 rounded-full object-cover shadow-sm" />
                         ) : (
                           <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center">
                             <Users className="w-4 h-4 text-slate-500" />
                           </div>
                         )}
                         <div>
                           <div className="font-semibold text-gray-900 flex items-center gap-2">
                             {cand.display_name}
                             {cand.is_winner && <Crown className="w-4 h-4 text-yellow-500" />}
                           </div>
                         </div>
                       </td>
                       <td className="px-4 py-3 font-bold text-gray-900 text-right">{cand.vote_count}</td>
                       <td className="px-4 py-3 text-gray-600">
                         <div className="flex items-center gap-2">
                           <div className="flex-1 bg-gray-200 rounded-full h-2 overflow-hidden">
                             <div className="bg-blue-600 h-2 rounded-full" style={{ width: `${categoryTotalVotes > 0 ? (cand.vote_count / categoryTotalVotes) * 100 : 0}%` }}></div>
                           </div>
                           <span className="text-xs font-medium w-10 text-right">{categoryTotalVotes > 0 ? ((cand.vote_count / categoryTotalVotes) * 100).toFixed(1) : '0.0'}%</span>
                         </div>
                       </td>
                     </tr>
                   ))}
                 </tbody>
               </table>
             </div>
             );
           })}
         </div>
       )}
     </div>    ) : selectedPool.type === 'quiz' ? (
      <div className="space-y-4">
        <div className="flex border-b border-gray-200">
          <button onClick={() => setQuizEvalTab('submissions')} className={`px-4 py-2 font-semibold text-sm ${quizEvalTab === 'submissions' ? 'text-primary-600 border-b-2 border-primary-600' : 'text-gray-500 hover:text-gray-700'}`}>Submissions & Audit</button>
          <button onClick={() => setQuizEvalTab('item-analysis')} className={`px-4 py-2 font-semibold text-sm ${quizEvalTab === 'item-analysis' ? 'text-primary-600 border-b-2 border-primary-600' : 'text-gray-500 hover:text-gray-700'}`}>Item Analysis</button>
        </div>

        {quizEvalTab === 'submissions' ? (
          submissions.length === 0 ? (
            <div className="text-center py-12 text-gray-500 bg-gray-50 rounded-xl border border-dashed border-gray-300">
              No submissions received yet.
            </div>
          ) : (
            <div className="border border-gray-200 rounded-xl overflow-hidden">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 text-gray-600 border-b border-gray-200">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Student</th>
                    <th className="px-4 py-3 font-semibold">Final Score</th>
                    <th className="px-4 py-3 font-semibold">Time Elapsed</th>
                    <th className="px-4 py-3 font-semibold text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {submissions.map(sub => (
                    <tr key={sub.id} className="hover:bg-gray-50 bg-white">
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900">{sub.users?.full_name}</p>
                        <p className="text-xs text-gray-500">@{sub.users?.username}</p>
                      </td>
                      <td className="px-4 py-3 font-medium text-primary-700">{sub.score !== null && sub.score !== undefined ? sub.score : '--'} pts</td>
                      <td className="px-4 py-3 text-gray-600">{sub.time_taken_seconds ? `${Math.floor(sub.time_taken_seconds / 60)}m ${sub.time_taken_seconds % 60}s` : '--'}</td>
                      <td className="px-4 py-3 text-right">
                        <button onClick={() => setSelectedSubmissionForAudit(sub)} className="text-primary-600 hover:text-primary-800 font-medium px-3 py-1.5 bg-primary-50 rounded-lg">Audit Answers</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : (
          <div className="border border-gray-200 rounded-xl overflow-hidden">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-gray-600 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 font-semibold w-12">Q#</th>
                  <th className="px-4 py-3 font-semibold">Question Preview</th>
                  <th className="px-4 py-3 font-semibold text-center">Attempts</th>
                  <th className="px-4 py-3 font-semibold">Error Rate</th>
                  <th className="px-4 py-3 font-semibold">Top Distractor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {quizQuestions.map((q, idx) => {
                  const attempts = submissions.filter(s => s.answers && s.answers[q.id] !== undefined);
                  const totalAttempts = attempts.length;
                  let correctCount = 0;
                  const distractorCounts: Record<string, number> = {};

                  attempts.forEach(s => {
                    const ans = s.answers[q.id];
                    if (ans === q.correct_option) {
                      correctCount++;
                    } else {
                      distractorCounts[ans] = (distractorCounts[ans] || 0) + 1;
                    }
                  });

                  const wrongCount = totalAttempts - correctCount;
                  const difficultyRatio = totalAttempts > 0 ? (wrongCount / totalAttempts) * 100 : 0;
                  
                  let mostCommonDistractor = 'None';
                  let maxD = 0;
                  Object.entries(distractorCounts).forEach(([k, v]) => {
                    if (v > maxD) { maxD = v; mostCommonDistractor = k; }
                  });

                  return (
                    <tr key={q.id} className="hover:bg-gray-50 bg-white">
                      <td className="px-4 py-3 font-bold text-gray-500">{idx + 1}</td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900 truncate max-w-xs" title={q.question_text}>{q.question_text}</p>
                        <p className="text-xs text-green-600 font-semibold mt-0.5">Key: {q.correct_option}</p>
                      </td>
                      <td className="px-4 py-3 text-center font-medium text-gray-700">{totalAttempts}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 bg-gray-200 rounded-full h-2 overflow-hidden w-24">
                            <div className={`h-2 rounded-full ${difficultyRatio < 25 ? 'bg-green-500' : difficultyRatio < 65 ? 'bg-yellow-500' : 'bg-red-500'}`} style={{ width: `${difficultyRatio}%` }}></div>
                          </div>
                          <span className={`text-xs font-bold ${difficultyRatio < 25 ? 'text-green-600' : difficultyRatio < 65 ? 'text-yellow-600' : 'text-red-600'}`}>{difficultyRatio.toFixed(1)}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {mostCommonDistractor !== 'None' ? (
                          <span className="px-2.5 py-1 bg-red-50 text-red-700 rounded-lg text-xs font-medium truncate max-w-[150px] inline-block" title={mostCommonDistractor}>{mostCommonDistractor}</span>
                        ) : (
                          <span className="text-xs text-gray-400">--</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    ) : (
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
                  <tr key={sub.id} className="hover:bg-gray-50 bg-white">
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
                      {(selectedPool.type === 'essay' || selectedPool.type === 'challenge') ? (
                        <button onClick={() => handleOpenEssayEval(sub)} className="text-primary-600 hover:text-primary-800 font-medium px-3 py-1.5 bg-primary-50 rounded-lg">
                          Grade Submission
                        </button>
                      ) : (
                        <button onClick={() => {
                          setEditingSubId(sub.id);
                          setScoreInput(sub.grading_score?.toString() || '');
                          setFeedbackInput(sub.grading_feedback || '');
                          setPodiumInput(sub.podium_status || '');
                        }} className="text-primary-600 hover:text-primary-800 font-medium">Evaluate</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )} </div>
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
 <option value="4th Position">4th Position</option>
 <option value="5th Position">5th Position</option>
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

 {/* Feature Winners Section */}
 {submissions.some(s => s.podium_status) && (
 <div className="mt-6 space-y-3">
   <h4 className="font-bold text-gray-900 flex items-center gap-2"><Crown className="h-5 w-5 text-amber-500"/> Feature Declared Winners</h4>
   {submissions.filter(s => s.podium_status).map(sub => (
     <div key={sub.id} className="p-4 bg-amber-50 rounded-xl border border-amber-200 flex items-center justify-between shadow-sm">
      <div className="flex items-center gap-3">
       <div className="bg-amber-100 p-2 rounded-lg"><Crown className="h-4 w-4 text-amber-600" /></div>
       <div>
        <p className="font-bold text-amber-900">{sub.podium_status} Assigned</p>
        <p className="text-sm text-amber-700">{sub.users?.full_name}</p>
       </div>
      </div>
      <button onClick={() => handleDeclareAndFeatureSpecificWinner(sub)} className="px-4 py-2 bg-amber-600 text-white font-bold rounded-xl hover:bg-amber-700 transition-all shadow-md text-sm flex items-center gap-2">
       Feature in App
      </button>
     </div>
   ))}
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

        <Modal isOpen={isBulkImportOpen} onClose={() => setIsBulkImportOpen(false)} title="Bulk Import Questions" size="md">
          <div className="space-y-4">
            <div className="flex gap-4">
              <label className="flex items-center gap-2">
                <input type="radio" name="bulkFormat" checked={bulkImportFormat === 'json'} onChange={() => setBulkImportFormat('json')} /> JSON
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name="bulkFormat" checked={bulkImportFormat === 'csv'} onChange={() => setBulkImportFormat('csv')} /> CSV
              </label>
            </div>
            {bulkImportFormat === 'json' ? (
              <div className="bg-white p-3 rounded-lg border border-primary-200 text-xs text-gray-600">
                <pre>
{`[
  {
    "question_text": "What is the capital of France?",
    "options": ["London", "Berlin", "Paris", "Madrid"],
    "correct_option": "Paris",
    "points": 2,
    "explanation": "Paris is the capital of France."
  }
]`}
                </pre>
              </div>
            ) : (
              <div className="bg-white p-3 rounded-lg border border-primary-200 text-xs text-gray-600">
                <p>Headers required: question, option_a, option_b, correct, points, explanation</p>
                <pre>
{`question,option_a,option_b,option_c,correct,points
What is 2+2?,3,4,5,4,1`}
                </pre>
              </div>
            )}
            
            <textarea
              value={bulkRawText}
              onChange={(e) => setBulkRawText(e.target.value)}
              rows={10}
              className="w-full px-3 py-2 border border-primary-200 rounded-lg focus:ring-2 focus:ring-primary-500 font-mono text-sm"
              placeholder={`Paste your ${bulkImportFormat.toUpperCase()} here...`}
            />

            {importErrors.length > 0 && (
              <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm border border-red-200">
                <ul className="list-disc list-inside">
                  {importErrors.map((err, idx) => <li key={idx}>{err}</li>)}
                </ul>
              </div>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <button onClick={() => setIsBulkImportOpen(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
              <button
                onClick={handleExecuteBulkImport}
                disabled={isImporting || !bulkRawText.trim()}
                className="bg-primary-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-primary-700 disabled:opacity-50"
              >
                {isImporting ? 'Importing...' : 'Parse & Import'}
              </button>
            </div>
          </div>
        </Modal>

        <Modal isOpen={!!selectedSubmissionForAudit} onClose={() => setSelectedSubmissionForAudit(null)} title="Student Exam Sheet Audit" size="lg">
          {selectedSubmissionForAudit && (
            <div className="space-y-6">
              {/* Header */}
              <div className="bg-primary-50 p-4 rounded-xl border border-primary-100 flex items-center justify-between">
                <div>
                  <h4 className="font-bold text-primary-900 text-lg">{selectedSubmissionForAudit.users?.full_name}</h4>
                  <p className="text-sm text-primary-700">Submitted: {new Date(selectedSubmissionForAudit.created_at || '').toLocaleString()}</p>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-black text-primary-700">{selectedSubmissionForAudit.score} <span className="text-sm font-medium">pts</span></div>
                  <div className="text-sm font-medium text-gray-500">
                    ⏱ {selectedSubmissionForAudit.time_taken_seconds ? `${Math.floor(selectedSubmissionForAudit.time_taken_seconds / 60)}m ${selectedSubmissionForAudit.time_taken_seconds % 60}s` : 'Unknown time'}
                  </div>
                </div>
              </div>

              {/* Questions Audit List */}
              <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2">
                {quizQuestions.map((q, idx) => {
                  const studentAns = selectedSubmissionForAudit.answers?.[q.id];
                  const isCorrect = studentAns === q.correct_option;

                  return (
                    <div key={q.id} className={`p-4 rounded-xl border ${isCorrect ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                      <div className="flex justify-between items-start mb-3">
                        <h5 className="font-bold text-gray-900 text-sm">
                          <span className="text-gray-500 mr-2">{idx + 1}.</span>
                          {q.question_text}
                        </h5>
                        <div className={`font-bold whitespace-nowrap ml-4 ${isCorrect ? 'text-green-700' : 'text-red-700'}`}>
                          {isCorrect ? `+${q.points}` : '0'} pts
                        </div>
                      </div>

                      <div className="space-y-2 text-sm">
                        {q.options.map((opt, oIdx) => {
                          const isSelected = opt === studentAns;
                          const isActuallyCorrect = opt === q.correct_option;

                          let rowClass = "flex items-center gap-2 p-2 rounded-lg border ";
                          if (isSelected && isActuallyCorrect) {
                            rowClass += "bg-green-100 border-green-300 text-green-900 font-bold";
                          } else if (isSelected && !isActuallyCorrect) {
                            rowClass += "bg-red-100 border-red-300 text-red-900 font-bold";
                          } else if (!isSelected && isActuallyCorrect) {
                            rowClass += "bg-green-50 border-green-300 border-dashed text-green-800 font-medium";
                          } else {
                            rowClass += "bg-white border-gray-100 text-gray-600";
                          }

                          return (
                            <div key={oIdx} className={rowClass}>
                              <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${isSelected ? (isActuallyCorrect ? 'bg-green-600 border-green-600' : 'bg-red-600 border-red-600') : 'border-gray-300'}`}>
                                {isSelected && <div className="w-2 h-2 rounded-full bg-white" />}
                              </div>
                              {opt}
                              {isActuallyCorrect && !isSelected && <span className="ml-auto text-xs text-green-600 font-bold">(Correct Answer)</span>}
                            </div>
                          );
                        })}
                      </div>

                      {q.explanation && (
                        <div className="mt-4 p-3 bg-white/60 rounded-lg text-xs text-gray-700 border border-gray-200">
                          <span className="font-bold text-gray-900 block mb-1">Explanation:</span>
                          {q.explanation}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </Modal>

        <Modal isOpen={!!selectedSubmissionForEssayEval} onClose={() => setSelectedSubmissionForEssayEval(null)} title="Evaluation Rubric Scorecard" size="xl">
          {selectedSubmissionForEssayEval && (
            <div className="flex flex-col lg:flex-row gap-6 max-h-[75vh]">
              {/* Left Pane: The Submission */}
              <div className="flex-1 bg-gray-50 border border-gray-200 rounded-xl overflow-hidden flex flex-col max-h-[75vh]">
                <div className="p-4 border-b border-gray-200 bg-white">
                  <h4 className="font-bold text-gray-900">{selectedSubmissionForEssayEval.users?.full_name}</h4>
                  <p className="text-xs text-gray-500">@{selectedSubmissionForEssayEval.users?.username} • Submitted {new Date(selectedSubmissionForEssayEval.created_at || '').toLocaleString()}</p>
                </div>
                <div className="p-5 overflow-y-auto flex-1 text-sm text-gray-800 leading-relaxed font-serif">
                  {selectedSubmissionForEssayEval.answers?.text ? (
                    <div className="whitespace-pre-wrap">{selectedSubmissionForEssayEval.answers.text}</div>
                  ) : selectedSubmissionForEssayEval.answers?.file_url ? (
                    <div className="flex flex-col items-center justify-center h-full text-center p-6">
                      <div className="bg-primary-100 p-4 rounded-full mb-4 text-primary-600">
                        <Save className="h-8 w-8" />
                      </div>
                      <p className="font-bold text-gray-900 mb-2">File Submission</p>
                      <a href={selectedSubmissionForEssayEval.answers.file_url} target="_blank" rel="noreferrer" className="text-primary-600 hover:underline">
                        Open Attached Document
                      </a>
                    </div>
                  ) : (
                    <div className="text-gray-400 italic">No text content available.</div>
                  )}
                </div>
              </div>

              {/* Right Pane: Rubric Scorecard */}
              <div className="flex-1 flex flex-col overflow-y-auto pr-2 max-h-[75vh] pb-4">
                <div className="bg-primary-50 p-4 rounded-xl border border-primary-100 mb-6 sticky top-0 z-10 shadow-sm flex items-center justify-between">
                  <div>
                    <h4 className="font-bold text-primary-900">Total Score</h4>
                    <p className="text-xs text-primary-700">Calculated automatically</p>
                  </div>
                  <div className="text-3xl font-black text-primary-700">
                    {Object.values(rubricScores).reduce((a, b) => a + b, 0)}
                    <span className="text-lg text-primary-400 font-medium"> / {(selectedPool?.target_constraints?.rubric_criteria || DEFAULT_RUBRIC_CRITERIA).reduce((a: number, c: any) => a + c.max_points, 0)}</span>
                  </div>
                </div>

                <div className="space-y-6 flex-1">
                  {(selectedPool?.target_constraints?.rubric_criteria || DEFAULT_RUBRIC_CRITERIA).map((c: any) => (
                    <div key={c.key} className="bg-white p-4 rounded-xl border border-gray-200">
                      <div className="flex justify-between items-end mb-3">
                        <div>
                          <label className="block text-sm font-bold text-gray-900">{c.label}</label>
                          <span className="text-xs text-gray-500">Max {c.max_points} pts</span>
                        </div>
                        <input
                          type="number"
                          min="0"
                          max={c.max_points}
                          value={rubricScores[c.key] || 0}
                          onChange={(e) => setRubricScores(prev => ({ ...prev, [c.key]: Math.min(c.max_points, Math.max(0, parseInt(e.target.value) || 0)) }))}
                          className="w-20 px-3 py-1.5 border rounded-lg text-center font-bold focus:ring-2 focus:ring-primary-500"
                        />
                      </div>
                      <input
                        type="range"
                        min="0"
                        max={c.max_points}
                        value={rubricScores[c.key] || 0}
                        onChange={(e) => setRubricScores(prev => ({ ...prev, [c.key]: parseInt(e.target.value) }))}
                        className="w-full accent-primary-600"
                      />
                    </div>
                  ))}

                  <div className="pt-4 border-t border-gray-200">
                    <label className="block text-sm font-bold text-gray-900 mb-2">Evaluator Notes</label>
                    <textarea
                      rows={3}
                      value={evaluatorNotes}
                      onChange={(e) => setEvaluatorNotes(e.target.value)}
                      placeholder="Constructive feedback for the student..."
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500"
                    />
                  </div>

                  <div className="flex items-center gap-4 py-2">
                    <label className="text-sm font-bold text-gray-900">Status:</label>
                    <label className="flex items-center gap-2 text-sm text-gray-700">
                      <input type="radio" checked={evaluationStatus === 'completed'} onChange={() => setEvaluationStatus('completed')} className="text-primary-600 focus:ring-primary-500" /> Completed
                    </label>
                    <label className="flex items-center gap-2 text-sm text-gray-700">
                      <input type="radio" checked={evaluationStatus === 'needs_revision'} onChange={() => setEvaluationStatus('needs_revision')} className="text-primary-600 focus:ring-primary-500" /> Needs Revision
                    </label>
                  </div>
                </div>

                <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-200 sticky bottom-0 bg-white z-10 py-2">
                  <button onClick={() => setSelectedSubmissionForEssayEval(null)} className="px-4 py-2 text-gray-600 font-medium hover:bg-gray-100 rounded-lg">Cancel</button>
                  <button onClick={handleSaveRubricEvaluation} className="px-6 py-2 bg-primary-600 text-white font-bold rounded-lg hover:bg-primary-700 shadow-md flex items-center gap-2">
                    <CheckCircle className="w-4 h-4" />
                    Save & Submit Score
                  </button>
                </div>
              </div>
            </div>
          )}
        </Modal>

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

 <ElectionGazetteModal
    isOpen={isGazetteOpen}
    onClose={() => setIsGazetteOpen(false)}
    pool={selectedPool}
    candidates={votingCandidates}
    totalTurnout={totalTurnout}
 />

 </div>
 );
}

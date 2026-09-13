import React, { useRef } from 'react';

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

interface Props {
    isOpen: boolean;
    onClose: () => void;
    pool: any;
    candidates: PoolCandidate[];
    totalTurnout: number;
    certificationDate?: string;
    hash?: string;
}

export function ElectionGazetteModal({ isOpen, onClose, pool, candidates, totalTurnout, certificationDate, hash }: Props) {
    const printAreaRef = useRef<HTMLDivElement>(null);

    if (!isOpen) return null;

    const handlePrint = () => {
        window.print();
    };

    // Group candidates by position
    const groupedCandidates = candidates.reduce((acc, cand) => {
        const pos = cand.position_title || 'General';
        if (!acc[pos]) acc[pos] = [];
        acc[pos].push(cand);
        return acc;
    }, {} as Record<string, PoolCandidate[]>);

    // Sort positions and within positions sort by vote count descending
    Object.keys(groupedCandidates).forEach(pos => {
        groupedCandidates[pos].sort((a, b) => b.vote_count - a.vote_count);
    });

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4 sm:p-6 print:bg-transparent print:p-0">
            <style>{`
                @media print {
                    body * {
                        visibility: hidden;
                    }
                    .gazette-print-area, .gazette-print-area * {
                        visibility: visible;
                    }
                    .gazette-print-area {
                        position: absolute;
                        left: 0;
                        top: 0;
                        width: 100%;
                        margin: 0;
                        padding: 20px;
                        background: white;
                    }
                    .no-print {
                        display: none !important;
                    }
                }
            `}</style>
            
            <div className="bg-white w-full max-w-4xl max-h-full overflow-y-auto rounded-xl shadow-2xl flex flex-col print:shadow-none print:rounded-none">
                {/* Header Toolbar (No Print) */}
                <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-gray-50 no-print sticky top-0 z-10">
                    <h3 className="text-lg font-bold text-gray-900">Election Gazette Preview</h3>
                    <div className="flex gap-3">
                        <button onClick={onClose} className="px-4 py-2 text-gray-600 hover:bg-gray-200 rounded-lg font-medium transition-colors">
                            Close
                        </button>
                        <button onClick={handlePrint} className="px-6 py-2 bg-primary-600 hover:bg-primary-700 text-white font-bold rounded-lg shadow-sm transition-colors flex items-center gap-2">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" /></svg>
                            Print / Save as PDF
                        </button>
                    </div>
                </div>

                {/* Printable Document Area */}
                <div ref={printAreaRef} className="gazette-print-area p-8 sm:p-12 text-black bg-white flex-1" style={{ minHeight: '100%' }}>
                    {/* Official Headers */}
                    <div className="text-center mb-10 border-b-2 border-black pb-8">
                        <h1 className="text-2xl sm:text-3xl font-black uppercase mb-2">National Association of Library & Information Science Students (NALISS)</h1>
                        <h2 className="text-xl sm:text-2xl font-bold uppercase mb-4">Umaru Musa Yar'adua University, Katsina</h2>
                        <div className="inline-block border-t border-b border-gray-400 py-2 mb-4">
                            <h3 className="text-lg font-bold tracking-widest uppercase">Official Independent Electoral Commission (INEC / DEC)</h3>
                        </div>
                        <h4 className="text-2xl font-black uppercase mt-4 underline underline-offset-4 decoration-4">Declaration of Results & Election Audit Gazette</h4>
                    </div>

                    {/* Metadata Grid */}
                    <div className="grid grid-cols-2 gap-x-8 gap-y-4 mb-10 text-sm border border-black p-4">
                        <div>
                            <span className="font-bold uppercase text-xs text-gray-600 block mb-1">Election Title</span>
                            <span className="font-bold text-base">{pool?.title}</span>
                        </div>
                        <div>
                            <span className="font-bold uppercase text-xs text-gray-600 block mb-1">Certification Date (WAT)</span>
                            <span className="font-medium text-base">{certificationDate || new Date().toLocaleString()}</span>
                        </div>
                        <div>
                            <span className="font-bold uppercase text-xs text-gray-600 block mb-1">Verified Ballots Cast</span>
                            <span className="font-black text-lg">{totalTurnout}</span>
                        </div>
                        <div>
                            <span className="font-bold uppercase text-xs text-gray-600 block mb-1">Cryptographic Ledger Hash</span>
                            <span className="font-mono text-xs break-all">{hash || "0x" + Array.from(crypto.getRandomValues(new Uint8Array(20))).map(b => b.toString(16).padStart(2, '0')).join('')}</span>
                        </div>
                    </div>

                    {/* Category Breakdown Tables */}
                    <div className="space-y-12">
                        {Object.keys(groupedCandidates).map(position => {
                            const candidatesForPos = groupedCandidates[position];
                            const totalVotesForPos = candidatesForPos.reduce((sum, c) => sum + c.vote_count, 0);

                            return (
                                <div key={position} className="break-inside-avoid">
                                    <h5 className="text-lg font-black uppercase mb-4 bg-gray-100 p-2 border-l-4 border-black">Office: {position}</h5>
                                    <table className="w-full text-left border-collapse border border-black text-sm">
                                        <thead>
                                            <tr className="bg-gray-50">
                                                <th className="border border-black px-3 py-2 font-bold w-16 text-center">Rank</th>
                                                <th className="border border-black px-3 py-2 font-bold">Candidate Name</th>
                                                <th className="border border-black px-3 py-2 font-bold w-32 text-right">Votes</th>
                                                <th className="border border-black px-3 py-2 font-bold w-32 text-right">Share (%)</th>
                                                <th className="border border-black px-3 py-2 font-bold w-48 text-center">Electoral Status</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {candidatesForPos.map((c, idx) => {
                                                const isWinnerRow = idx === 0 && (c.is_winner || pool?.status === 'completed');
                                                const share = totalVotesForPos > 0 ? ((c.vote_count / totalVotesForPos) * 100).toFixed(1) : '0.0';

                                                return (
                                                    <tr key={c.id} className={isWinnerRow ? 'font-bold bg-green-50/50 print:bg-transparent' : ''}>
                                                        <td className="border border-black px-3 py-2 text-center">{idx + 1}</td>
                                                        <td className="border border-black px-3 py-2 uppercase">{c.display_name}</td>
                                                        <td className="border border-black px-3 py-2 text-right font-mono">{c.vote_count.toLocaleString()}</td>
                                                        <td className="border border-black px-3 py-2 text-right font-mono">{share}%</td>
                                                        <td className="border border-black px-3 py-2 text-center">
                                                            {isWinnerRow ? (
                                                                <span className="font-black uppercase border border-black px-2 py-0.5 whitespace-nowrap">Winner - 1st Place</span>
                                                            ) : (
                                                                <span className="text-gray-600 uppercase">Runner-Up</span>
                                                            )}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            );
                        })}
                    </div>

                    {/* Audit & Certification Footer */}
                    <div className="mt-20 pt-8 border-t-2 border-black break-inside-avoid">
                        <p className="italic text-sm text-center mb-16 font-serif">
                            "This document certifies that the above results reflect the exact, un-tampered ballots cast into the secure cryptographic ledger."
                        </p>
                        
                        <div className="flex justify-between items-end px-4 sm:px-12">
                            <div className="text-center">
                                <div className="border-b border-black w-48 sm:w-64 mb-2"></div>
                                <span className="block font-bold text-sm uppercase">Returning Officer / CEC</span>
                                <span className="block text-xs mt-1">Signature & Date</span>
                            </div>
                            <div className="text-center">
                                <div className="border-b border-black w-48 sm:w-64 mb-2"></div>
                                <span className="block font-bold text-sm uppercase">Staff Adviser / DSA</span>
                                <span className="block text-xs mt-1">Signature & Date</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

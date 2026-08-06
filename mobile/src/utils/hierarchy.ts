export const getLecturerRank = (position: string | null): number => {
    if (!position) return 99;
    const p = position.toLowerCase().trim();
    if (p.includes('librarian')) return 1;
    if (p.includes('hod') || p.includes('head of department')) return 2;
    if (p.includes('prof')) return 3;
    if (p.includes('dr') || p.includes('doctor')) return 4;
    return 99;
};

export const getExecutiveRank = (position: string | null): number => {
    if (!position) return 99;
    const p = position.toLowerCase().trim();
    if (p.includes('president') && !p.includes('vice')) return 1;
    if (p.includes('vice president') || p.includes('vice_president')) return 2;
    if (p.includes('secretary') && !p.includes('assistant') && !p.includes('financial')) return 3;
    if (p.includes('assistant secretary') || p.includes('assistant_secretary')) return 4;
    if (p.includes('financial secretary') || p.includes('financial_secretary')) return 5;
    if (p.includes('treasurer')) return 6;
    if (p.includes('public relations') || p.includes('pro')) return 7;
    if (p.includes('social')) return 8;
    if (p.includes('sport')) return 9;
    if (p.includes('welfare')) return 10;
    if (p.includes('academic')) return 11;
    return 99;
};

export const sortHierarchically = (list: any[], type: 'lecturer' | 'executive') => {
    return list.sort((a, b) => {
        const strA = type === 'lecturer' ? (a.position || a.title || a.full_name || '') : (a.position_code || a.position || '');
        const strB = type === 'lecturer' ? (b.position || b.title || b.full_name || '') : (b.position_code || b.position || '');
        
        const rankA = type === 'lecturer' ? getLecturerRank(strA) : getExecutiveRank(strA);
        const rankB = type === 'lecturer' ? getLecturerRank(strB) : getExecutiveRank(strB);
        
        if (rankA !== rankB) {
            return rankA - rankB;
        }
        // Fallback to display_order if ranks are same
        const orderA = typeof a.display_order === 'number' ? a.display_order : 999;
        const orderB = typeof b.display_order === 'number' ? b.display_order : 999;
        return orderA - orderB;
    });
};

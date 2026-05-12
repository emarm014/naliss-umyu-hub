export const NalissLogo = ({ className = "w-32 h-32" }: { className?: string }) => {
    return (
        <svg className={className} viewBox="0 0 300 300" xmlns="http://www.w3.org/2000/svg">
            <defs>
                <path id="textPathTop" d="M 40, 150 A 110,110 0 1,1 260,150 A 110,110 0 1,1 40,150" />
                <path id="textPathBottom" d="M 260, 150 A 110,110 0 0,1 40,150" />
            </defs>

            {/* Outer Ring */}
            <circle cx="150" cy="150" r="130" fill="#FFFFFF" stroke="#1B5E20" strokeWidth="35" />

            {/* Ring inner/outer Borders */}
            <circle cx="150" cy="150" r="147.5" fill="none" stroke="#FFFFFF" strokeWidth="2" />
            <circle cx="150" cy="150" r="112.5" fill="none" stroke="#000000" strokeWidth="1" opacity="0.5" />

            {/* Ring Text */}
            <text fill="#FFFFFF" fontSize="14" fontWeight="bold" fontFamily="sans-serif">
                <textPath href="#textPathTop" startOffset="3%">
                    NATIONAL ASSOCIATION OF LIBRARY AND INFORMATION SCIENCE STUDENTS'
                </textPath>
            </text>
            <text fill="#FFFFFF" fontSize="24" fontWeight="bold" fontFamily="sans-serif">
                <textPath href="#textPathBottom" startOffset="50%" textAnchor="middle">
                    NALISS
                </textPath>
            </text>

            {/* Center Content Placeholder - Books & Computers */}
            <g transform="translate(150, 115)">
                {/* Colorful Books */}
                <g transform="translate(-40, -50) scale(0.6)">
                    <rect x="-20" y="0" width="40" height="10" fill="#4CAF50" stroke="#000" />
                    <rect x="-25" y="10" width="50" height="12" fill="#2196F3" stroke="#000" />
                    <rect x="-22" y="22" width="44" height="10" fill="#F44336" stroke="#000" />
                    <rect x="-30" y="32" width="60" height="14" fill="#FFC107" stroke="#000" />
                </g>

                {/* Colorful Computer */}
                <g transform="translate(40, -50) scale(0.6)">
                    <rect x="-20" y="0" width="40" height="30" fill="#B0BEC5" stroke="#000" />
                    <rect x="-16" y="4" width="32" height="22" fill="#81D4FA" stroke="#000" />
                    <rect x="-5" y="30" width="10" height="10" fill="#B0BEC5" stroke="#000" />
                    <rect x="-15" y="40" width="30" height="5" fill="#B0BEC5" stroke="#000" />
                    <rect x="-25" y="50" width="45" height="10" fill="#90A4AE" stroke="#000" />
                </g>

                {/* Outlined Computer */}
                <g transform="translate(-30, 20) scale(0.8)">
                    <rect x="-25" y="0" width="50" height="35" fill="#FFF" stroke="#000" strokeWidth="1.5" />
                    <rect x="-21" y="4" width="42" height="27" fill="#FFF" stroke="#000" strokeWidth="1" />
                    <rect x="-6" y="35" width="12" height="10" fill="#FFF" stroke="#000" strokeWidth="1.5" />
                    <rect x="-20" y="45" width="40" height="5" fill="#FFF" stroke="#000" strokeWidth="1.5" />
                    <rect x="-35" y="55" width="60" height="12" fill="#FFF" stroke="#000" strokeWidth="1.5" />
                </g>

                {/* Outlined Books */}
                <g transform="translate(35, 20) scale(0.7)">
                    <path d="M -25,0 L 25,10 L 15,25 L -35,15 Z" fill="#FFF" stroke="#000" strokeWidth="1.5" />
                    <path d="M -25,10 L 25,20 L 15,35 L -35,25 Z" fill="#FFF" stroke="#000" strokeWidth="1.5" />
                    <path d="M -25,20 L 25,30 L 15,45 L -35,35 Z" fill="#FFF" stroke="#000" strokeWidth="1.5" />
                </g>
            </g>

            {/* UMYUK CHAPTER text */}
            <text x="150" y="210" fill="#1B5E20" fontSize="13" fontWeight="bold" textAnchor="middle" stroke="#FFF" strokeWidth="0.5">
                UMYUK
            </text>
            <text x="150" y="230" fill="#FFFFFF" fontSize="20" fontWeight="bold" textAnchor="middle" stroke="#1B5E20" strokeWidth="1">
                CHAPTER
            </text>

            {/* Bottom Ribbon */}
            <g transform="translate(150, 260)">
                <path d="M -130,0 L 130,0 L 130,25 L -130,25 Z" fill="#1B5E20" />
                <path d="M -130,0 L -150,12.5 L -130,25 Z" fill="#1B5E20" />
                <path d="M 130,0 L 150,12.5 L 130,25 Z" fill="#1B5E20" />
                <text x="0" y="17" fill="#FFFFFF" fontSize="14" fontWeight="bold" textAnchor="middle">
                    Information is Light
                </text>
            </g>
        </svg>
    );
};

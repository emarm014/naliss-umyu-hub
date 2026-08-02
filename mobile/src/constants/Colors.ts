/**
 * Design System Colors for NALISS UMYU HUB
 * Following a premium, deep-blue focused palette with vibrant accents.
 */

const tintColorLight = '#059669'; // Emerald Green Accent
const tintColorDark = '#38bdf8';  // Sky 400

export const Colors = {
    light: {
        text: '#0f172a',          // Slate 900
        textSecondary: '#475569', // Slate 600
        textMuted: '#94a3b8',     // Slate 400
        background: '#f8fafc',    // Slate 50
        card: '#ffffff',
        tint: tintColorLight,
        icon: '#64748b',          // Slate 500
        tabIconDefault: '#94a3b8',
        tabIconSelected: tintColorLight,
        primary: '#059669',       // Emerald Green Accent
        secondary: '#2E7D32',     // Green 800
        accent: '#f59e0b',        // Amber 500
        success: '#059669',       // Unified with brand emerald
        error: '#dc2626',         // Red 600
        warning: '#f59e0b',
        info: '#0ea5e9',
        border: '#e2e8f0',        // Slate 200
        divider: '#f1f5f9',       // Slate 100
        white: '#ffffff',
        black: '#020617',
        surface: '#f1f5f9',
        surfaceVariant: '#e2e8f0',
        glass: 'rgba(255, 255, 255, 0.7)',
        glassSubtle: 'rgba(255, 255, 255, 0.3)',
        shadow: 'rgba(0, 0, 0, 0.05)',
        // Quick Action Backgrounds (Professional Muted)
        actionMint: '#ecfdf5',
        actionBlue: '#f0f9ff',
        actionOrange: '#fffbeb',
        actionPurple: '#faf5ff',
        actionRed: '#fef2f2',
        actionCyan: '#ecfeff',
        // Quick Action Icons (Light Mode)
        actionMintIcon: '#059669',
        actionBlueIcon: '#0284c7',
        actionOrangeIcon: '#d97706',
        actionPurpleIcon: '#8b5cf6',
        actionRedIcon: '#dc2626',
        actionCyanIcon: '#0891b2',
    },
    dark: {
        text: '#f8fafc',
        textSecondary: '#94a3b8',
        textMuted: '#64748b',
        background: '#020617',    // Deep Navy/Black
        card: '#0f172a',          // Slate 900
        tint: tintColorDark,
        icon: '#94a3b8',
        tabIconDefault: '#475569',
        tabIconSelected: tintColorDark,
        primary: '#34d399',       // Emerald 400 for dark mode accessibility
        secondary: '#10b981',     // Emerald 500
        accent: '#fbbf24',
        success: '#34d399',
        error: '#f87171',
        warning: '#fbbf24',
        info: '#22d3ee',
        border: '#1e293b',
        divider: '#0f172a',
        white: '#ffffff',
        black: '#000000',
        surface: '#0f172a',
        surfaceVariant: '#1e293b',
        glass: 'rgba(15, 23, 42, 0.7)',
        glassSubtle: 'rgba(15, 23, 42, 0.3)',
        shadow: 'rgba(0, 0, 0, 0.3)',
        // Quick Action Backgrounds (Dark Mode Muted)
        actionMint: '#064e3b',   // Emerald 900
        actionBlue: '#0c4a6e',   // Sky 900
        actionOrange: '#7c2d12', // Orange 900
        actionPurple: '#4c1d95', // Purple 900
        actionRed: '#7f1d1d',    // Red 900
        actionCyan: '#164e63',   // Cyan 900
        // Quick Action Icons (Dark Mode - High Contrast Vibrant)
        actionMintIcon: '#34d399',
        actionBlueIcon: '#38bdf8',
        actionOrangeIcon: '#fbbf24',
        actionPurpleIcon: '#c084fc',
        actionRedIcon: '#f87171',
        actionCyanIcon: '#22d3ee',
    },
};

export const COLORS = Colors.light;

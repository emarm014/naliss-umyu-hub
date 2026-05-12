import React from 'react';
import Svg, { Rect } from 'react-native-svg';

interface DevicesIconProps {
    size?: number;
    color?: string;
}

export const DevicesIcon: React.FC<DevicesIconProps> = ({ size = 24, color = "#000" }) => {
    return (
        <Svg width={size} height={size} viewBox="0 0 100 100">
            {/* Monitor Frame */}
            <Rect x="20" y="20" width="60" height="40" fill="none" stroke={color} strokeWidth="6" rx="4" />
            {/* Screen */}
            <Rect x="25" y="25" width="50" height="30" fill="none" stroke={color} strokeWidth="2" rx="2" />
            {/* Stand */}
            <Rect x="45" y="60" width="10" height="15" fill="none" stroke={color} strokeWidth="6" />
            {/* Base */}
            <Rect x="30" y="75" width="40" height="6" fill="none" stroke={color} strokeWidth="6" rx="2" />
            {/* Keyboard */}
            <Rect x="15" y="85" width="50" height="8" fill="none" stroke={color} strokeWidth="5" rx="2" />
            {/* Mouse */}
            <Rect x="75" y="85" width="10" height="8" fill="none" stroke={color} strokeWidth="5" rx="4" />
        </Svg>
    );
};

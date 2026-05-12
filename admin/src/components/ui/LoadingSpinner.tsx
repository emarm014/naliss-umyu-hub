import { useEffect, useState } from 'react';

interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  fullScreen?: boolean;
  text?: string;
}

export default function LoadingSpinner({ size = 'md', fullScreen = false, text }: LoadingSpinnerProps) {
  const [colorIndex, setColorIndex] = useState(0);
  const colors = ['#DC143C', '#228B22', '#FFD700']; // Red, Green, Gold - NALISS colors

  useEffect(() => {
    const interval = setInterval(() => {
      setColorIndex((prev) => (prev + 1) % colors.length);
    }, 800);
    return () => clearInterval(interval);
  }, [colors.length]);

  const sizeClasses = {
    sm: 'w-10 h-10',
    md: 'w-16 h-16',
    lg: 'w-24 h-24',
  };

  const spinner = (
    <div className="flex flex-col items-center justify-center gap-4">
      <div className="relative">
        {/* Outer rotating ring */}
        <div
          className={`${sizeClasses[size]} rounded-full border-4 border-transparent animate-spin`}
          style={{
            borderTopColor: colors[colorIndex],
            borderRightColor: colors[(colorIndex + 1) % colors.length],
            transition: 'border-color 0.3s ease',
          }}
        />

        {/* Logo in center */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div
            className={`${size === 'sm' ? 'w-6 h-6' : size === 'md' ? 'w-10 h-10' : 'w-16 h-16'} transition-all duration-300`}
            style={{
              filter: `drop-shadow(0 0 8px ${colors[colorIndex]})`,
            }}
          >
            <img
              src="/naliss-logo.png"
              alt="NALISS"
              className="w-full h-full object-contain"
            />
          </div>
        </div>
      </div>

      {/* Pulsing dots */}
      <div className="flex gap-1">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="w-2 h-2 rounded-full animate-pulse"
            style={{
              backgroundColor: colors[(colorIndex + i) % colors.length],
              animationDelay: `${i * 200}ms`,
            }}
          />
        ))}
      </div>

      {text && (
        <p className="text-sm text-gray-500 animate-pulse">{text}</p>
      )}
    </div>
  );

  if (fullScreen) {
    return (
      <div className="fixed inset-0 bg-white/80 backdrop-blur-sm flex items-center justify-center z-50">
        {spinner}
      </div>
    );
  }

  return spinner;
}

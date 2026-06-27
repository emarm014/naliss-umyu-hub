import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { SafeModal } from '../common/overlays';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
}

export default function Modal({ isOpen, onClose, title, children, size = 'md' }: ModalProps) {
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  const getMappedSize = () => {
    switch (size) {
      case 'sm': return 'small';
      case 'lg':
      case 'xl': return 'large';
      case 'full': return 'fullscreen';
      case 'md':
      default: return 'medium';
    }
  };

  return (
    <SafeModal
      visible={isOpen}
      onClose={onClose}
      size={getMappedSize()}
      contentClassName={`flex flex-col p-0 ${size === 'full' ? 'max-w-[95vw] h-[95vh]' : ''}`}
    >
      {/* Header */}
      <div className="p-8 pb-4 flex items-center justify-between border-b border-slate-50 dark:border-slate-800 bg-white/50 dark:bg-slate-900/50 backdrop-blur-sm sticky top-0 z-10">
        <div>
           <h2 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">{title}</h2>
           <div className="w-12 h-1.5 bg-emerald-950 dark:bg-emerald-500 rounded-full mt-2" />
        </div>
        <button 
          onClick={onClose}
          className="w-12 h-12 bg-slate-50 dark:bg-slate-800 rounded-2xl flex items-center justify-center text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-all border border-slate-100/50 dark:border-slate-700/50 shadow-sm hover:shadow-xl hover:-translate-y-1 active:scale-95"
        >
          <X className="w-6 h-6 stroke-[3px]" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-8 pt-6 text-slate-700 dark:text-slate-300">
        {children}
      </div>
    </SafeModal>
  );
}

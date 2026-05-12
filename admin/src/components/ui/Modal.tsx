import React, { useEffect } from 'react';
import { X } from 'lucide-react';

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

  if (!isOpen) return null;

  const sizeClasses = {
    sm: 'max-w-md',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
    full: 'max-w-[95vw] h-[95vh]'
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 animate-in fade-in duration-300">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-slate-900/60 backdrop-blur-md"
        onClick={onClose}
      />

      {/* Modal Container */}
      <div className={`relative w-full ${sizeClasses[size]} bg-white rounded-[2.5rem] shadow-2xl overflow-hidden border border-slate-100 flex flex-col animate-in zoom-in-95 slide-in-from-bottom-8 duration-500`}>
        {/* Header */}
        <div className="p-8 pb-4 flex items-center justify-between border-b border-slate-50 bg-white/50 backdrop-blur-sm sticky top-0 z-10">
          <div>
             <h2 className="text-2xl font-black text-slate-900 tracking-tight">{title}</h2>
             <div className="w-12 h-1.5 bg-primary-950 rounded-full mt-2" />
          </div>
          <button 
            onClick={onClose}
            className="w-12 h-12 bg-slate-50 rounded-2xl flex items-center justify-center text-slate-400 hover:text-red-500 hover:bg-red-50 transition-all border border-slate-100/50 shadow-sm hover:shadow-xl hover:-translate-y-1 active:scale-95"
          >
            <X className="w-6 h-6 stroke-[3px]" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-8 pt-6">
          {children}
        </div>
      </div>
    </div>
  );
}

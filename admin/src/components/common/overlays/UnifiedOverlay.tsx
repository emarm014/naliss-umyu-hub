import React, { useEffect, useRef } from 'react';
import { AlertCircle, CheckCircle, HelpCircle, ShieldAlert } from 'lucide-react';

export type OverlaySize = 'small' | 'medium' | 'large' | 'fullscreen';
export type OverlayAnimation = 'fade' | 'slide-up' | 'scale';

const SIZE_MAP: Record<OverlaySize, string> = {
    small: 'max-w-sm',
    medium: 'max-w-md',
    large: 'max-w-2xl',
    fullscreen: 'max-w-full w-full h-full',
};

export interface SafeOverlayProps {
    visible: boolean;
    onClose?: () => void;
    onShow?: () => void;
    children: React.ReactNode;
    animationType?: OverlayAnimation;
    dismissible?: boolean;
    overlayStyle?: React.CSSProperties;
    className?: string;
}

/**
 * Base overlay container for Web/PWA providing backdrop, escape key handler, and focus trapping.
 */
export const SafeOverlayContainer = ({
    visible,
    onClose,
    onShow,
    children,
    dismissible = true,
    overlayStyle,
    className = ''
}: SafeOverlayProps) => {
    const overlayRef = useRef<HTMLDivElement>(null);

    // Trigger onShow
    useEffect(() => {
        if (visible && onShow) {
            onShow();
        }
    }, [visible, onShow]);

    // Handle Escape Key Dismissal
    useEffect(() => {
        if (!visible) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && dismissible && onClose) {
                onClose();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [visible, dismissible, onClose]);

    // Focus Trapping & Tab Navigation
    useEffect(() => {
        if (!visible || !overlayRef.current) return;
        
        const focusableElements = overlayRef.current.querySelectorAll(
            'a[href], button, textarea, input[type="text"], input[type="radio"], input[type="checkbox"], select'
        );
        const firstElement = focusableElements[0] as HTMLElement;
        const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement;

        if (firstElement) firstElement.focus();

        const handleTab = (e: KeyboardEvent) => {
            if (e.key !== 'Tab') return;

            if (e.shiftKey) {
                if (document.activeElement === firstElement && lastElement) {
                    lastElement.focus();
                    e.preventDefault();
                }
            } else {
                if (document.activeElement === lastElement && firstElement) {
                    firstElement.focus();
                    e.preventDefault();
                }
            }
        };

        window.addEventListener('keydown', handleTab);
        return () => window.removeEventListener('keydown', handleTab);
    }, [visible]);

    if (!visible) return null;

    return (
        <div 
            className={`fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm transition-opacity duration-300 ${className}`}
            style={overlayStyle}
            ref={overlayRef}
            role="dialog"
            aria-modal="true"
        >
            {/* Backdrop click dismiss */}
            <div 
                className="absolute inset-0" 
                onClick={() => { if (dismissible && onClose) onClose(); }} 
            />
            <div className="relative z-10 w-full flex justify-center items-center pointer-events-none">
                <div className="pointer-events-auto w-full flex justify-center">
                    {children}
                </div>
            </div>
        </div>
    );
};

export interface SafeModalProps extends SafeOverlayProps {
    size?: OverlaySize;
    contentStyle?: React.CSSProperties;
    contentClassName?: string;
}

/**
 * Centered modal for web. Limits max width and centers content.
 */
export const SafeModal = ({ 
    size = 'medium', 
    contentStyle, 
    contentClassName = '', 
    children, 
    ...props 
}: SafeModalProps) => {
    const sizeClass = SIZE_MAP[size];

    return (
        <SafeOverlayContainer {...props}>
            <div 
                className={`w-full ${sizeClass} bg-white dark:bg-slate-900 rounded-2xl shadow-2xl overflow-hidden border border-slate-100 dark:border-slate-800 transition-all duration-300 transform scale-100 p-6 ${contentClassName}`}
                style={contentStyle}
            >
                {children}
            </div>
        </SafeOverlayContainer>
    );
};

/**
 * Bottom anchored drawer/sheet equivalent for web. Acting as a sheet on mobile screens, and center modal on desktop.
 */
export const SafeBottomSheet = ({ 
    size = 'medium', 
    contentStyle, 
    contentClassName = '', 
    children, 
    ...props 
}: SafeModalProps) => {
    const sizeClass = SIZE_MAP[size];

    return (
        <SafeOverlayContainer {...props} className="items-end sm:items-center">
            <div 
                className={`w-full ${sizeClass} bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden border-t sm:border border-slate-100 dark:border-slate-800 transition-all duration-300 transform translate-y-0 sm:translate-y-0 p-6 pb-safe ${contentClassName}`}
                style={contentStyle}
            >
                {children}
            </div>
        </SafeOverlayContainer>
    );
};

export interface SafeDialogProps extends SafeModalProps {
    title: string;
    message?: string;
    type?: 'confirm' | 'warning' | 'success' | 'permission';
    confirmText?: string;
    cancelText?: string;
    onConfirm: () => void;
    onCancel?: () => void;
}

/**
 * Centered dialogue box for alerts, confirmations, or warnings.
 */
export const SafeDialog = ({
    title, 
    message, 
    type = 'confirm', 
    confirmText = 'Confirm', 
    cancelText = 'Cancel', 
    onConfirm, 
    onCancel, 
    ...props 
}: SafeDialogProps) => {
    const getIcon = () => {
        switch(type) {
            case 'warning': return <ShieldAlert className="w-12 h-12 text-amber-500" />;
            case 'success': return <CheckCircle className="w-12 h-12 text-emerald-500" />;
            case 'permission': return <ShieldAlert className="w-12 h-12 text-blue-500" />;
            case 'confirm':
            default: return <HelpCircle className="w-12 h-12 text-emerald-600 dark:text-emerald-500" />;
        }
    };

    return (
        <SafeModal {...props} size="small" onClose={onCancel}>
            <div className="flex flex-col items-center text-center">
                <div className="mb-4">{getIcon()}</div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">{title}</h3>
                {message && <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">{message}</p>}
                
                <div className="flex gap-3 w-full">
                    {(onCancel || props.dismissible !== false) && (
                        <button 
                            className="flex-1 py-2.5 rounded-lg font-semibold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition"
                            onClick={onCancel || props.onClose}
                        >
                            {cancelText}
                        </button>
                    )}
                    <button 
                        className={`flex-1 py-2.5 rounded-lg font-semibold text-white transition ${
                            type === 'warning' ? 'bg-red-600 hover:bg-red-700' : 'bg-emerald-600 hover:bg-emerald-700'
                        }`}
                        onClick={onConfirm}
                    >
                        {confirmText}
                    </button>
                </div>
            </div>
        </SafeModal>
    );
};

export interface SafeAsyncContentProps {
    isLoading: boolean;
    error: Error | string | null;
    isSuccess?: boolean;
    successMessage?: string;
    onRetry?: () => void;
    onClose?: () => void;
    children: React.ReactNode;
}

/**
 * Standardized spinner/failure/success component for asynchronous overlay flows.
 */
export const SafeAsyncContent = ({
    isLoading,
    error,
    isSuccess,
    successMessage = 'Operation Completed Successfully!',
    onRetry,
    onClose,
    children
}: SafeAsyncContentProps) => {
    if (isLoading) {
        return (
            <div className="py-8 flex flex-col items-center justify-center text-center">
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-emerald-600 mb-4" />
                <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Processing request...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="py-6 flex flex-col items-center text-center">
                <AlertCircle className="w-12 h-12 text-red-500 mb-4" />
                <h4 className="text-base font-bold text-slate-900 dark:text-white mb-2">Operation Failed</h4>
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
                    {typeof error === 'string' ? error : error.message}
                </p>
                <div className="flex gap-3 w-full">
                    {onClose && (
                        <button 
                            className="flex-1 py-2.5 rounded-lg font-semibold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition"
                            onClick={onClose}
                        >
                            Close
                        </button>
                    )}
                    {onRetry && (
                        <button 
                            className="flex-1 py-2.5 rounded-lg font-semibold text-white bg-emerald-600 hover:bg-emerald-700 transition"
                            onClick={onRetry}
                        >
                            Retry
                        </button>
                    )}
                </div>
            </div>
        );
    }

    if (isSuccess) {
        return (
            <div className="py-6 flex flex-col items-center text-center">
                <CheckCircle className="w-12 h-12 text-emerald-500 mb-4" />
                <h4 className="text-base font-bold text-slate-900 dark:text-white mb-2">Success</h4>
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">{successMessage}</p>
                {onClose && (
                    <button 
                        className="w-full py-2.5 rounded-lg font-semibold text-white bg-emerald-600 hover:bg-emerald-700 transition"
                        onClick={onClose}
                    >
                        Continue
                    </button>
                )}
            </div>
        );
    }

    return <>{children}</>;
};

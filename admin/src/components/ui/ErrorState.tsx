import { AlertCircle, RefreshCw } from 'lucide-react';


interface ErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
  className?: string;
}

export default function ErrorState({ 
  title = "Something went wrong", 
  message = "We couldn't load the data. Please check your network connection and try again.", 
  onRetry,
  className = ""
}: ErrorStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center p-8 bg-white rounded-xl border border-red-100 shadow-sm text-center ${className}`}>
      <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mb-4">
        <AlertCircle className="w-8 h-8 text-red-500" />
      </div>
      <h3 className="text-lg font-semibold text-gray-900 mb-2">{title}</h3>
      <p className="text-sm text-gray-500 max-w-sm mb-6 pb-2">
        {message}
      </p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="inline-flex items-center px-4 py-2 bg-red-50 text-red-700 hover:bg-red-100 hover:text-red-800 font-medium rounded-lg transition-colors focus:ring-2 focus:ring-red-200 focus:outline-none"
        >
          <RefreshCw className="w-4 h-4 mr-2" />
          Try Again
        </button>
      )}
    </div>
  );
}

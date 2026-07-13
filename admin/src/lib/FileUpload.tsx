import { useState, useRef, useEffect } from 'react';
import { Upload, Loader2, CheckCircle, X, File as FileIcon, Film, Plus } from 'lucide-react';
import { uploadToCloudinary } from './cloudinary';

interface FileUploadProps {
    accept?: string;
    folder?: string;
    onUploadComplete: (url: string, file: File, originalFilename?: string) => void;
    onUploadError?: (error: Error) => void;
    currentFileUrl?: string;
    label?: string;
    description?: string;
    isImage?: boolean;
    multiple?: boolean;
    onMultiUploadComplete?: (results: Array<{url: string, file: File, originalFilename?: string}>) => void;
    currentBatchUrls?: Array<{url: string, name: string, size?: number, type?: string}>;
    onRemoveBatchItem?: (index: number) => void;
}

export default function FileUpload({
    accept = '*/*',
    folder = 'uploads',
    onUploadComplete,
    onUploadError,
    currentFileUrl,
    label = 'Upload File',
    description = 'Select a file to upload',
    isImage = false,
    multiple = false,
    onMultiUploadComplete,
    currentBatchUrls = [],
    onRemoveBatchItem,
}: FileUploadProps) {
    const [isUploading, setIsUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState<string>('');
    const [uploadError, setUploadError] = useState<string>('');
    const [queuedFiles, setQueuedFiles] = useState<File[]>([]);
    const [previews, setPreviews] = useState<Record<string, string>>({});
    
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Generate previews for images/videos in queue
    useEffect(() => {
        const newPreviews: Record<string, string> = {};
        queuedFiles.forEach(file => {
            if (file.type.startsWith('image/') || file.type.startsWith('video/')) {
                newPreviews[file.name] = URL.createObjectURL(file);
            }
        });
        setPreviews(newPreviews);
        
        return () => {
            Object.values(newPreviews).forEach(url => URL.revokeObjectURL(url));
        };
    }, [queuedFiles]);

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const filesList = e.target.files;
        if (!filesList || filesList.length === 0) return;

        const incomingFiles = Array.from(filesList);
        
        // We auto-upload, so we don't need to append to queuedFiles. We just upload the incoming ones.
        let filesToUpload = multiple ? incomingFiles : [incomingFiles[0]];

        if (multiple && filesToUpload.length > 5) {
            setUploadError('⚠️ Maximum limit of 5 files per selection exceeded. Truncating to 5.');
            filesToUpload = filesToUpload.slice(0, 5);
        }

        // Validate sizes
        const validFiles = filesToUpload.filter(file => {
            const isImageFile = file.type.startsWith('image/');
            const MAX_FILE_SIZE = isImageFile ? 10 * 1024 * 1024 : 100 * 1024 * 1024;
            if (file.size > MAX_FILE_SIZE) {
                setUploadError(`File ${file.name} is too large. Maximum allowed size is ${isImageFile ? '10 MB' : '100 MB'}.`);
                return false;
            }
            return true;
        });

        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }

        if (validFiles.length > 0) {
            await executeUpload(validFiles);
        }
    };

    const removeFileFromQueue = (indexToRemove: number) => {
        setQueuedFiles(prev => prev.filter((_, idx) => idx !== indexToRemove));
        setUploadError('');
    };

    const formatFileSize = (bytes: number) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    };

    const executeUpload = async (filesToUpload: File[]) => {
        setIsUploading(true);
        setUploadProgress(multiple ? `Uploading ${filesToUpload.length} files...` : 'Uploading to cloud storage...');
        setUploadError('');

        try {
            if (multiple && onMultiUploadComplete) {
                const successful: Array<{url: string, file: File, originalFilename: string}> = [];
                const errors: string[] = [];

                for (let i = 0; i < filesToUpload.length; i++) {
                    const file = filesToUpload[i];
                    setUploadProgress(`Uploading file ${i + 1} of ${filesToUpload.length}...`);
                    try {
                        const result = await uploadToCloudinary(file, folder);
                        successful.push({
                            url: result.secure_url,
                            file,
                            originalFilename: result.original_filename || file.name
                        });
                    } catch (err: any) {
                        errors.push(err?.message || 'Unknown error');
                    }
                }
                
                const failedCount = errors.length;

                if (successful.length > 0) {
                    setUploadProgress(failedCount > 0 ? `Upload complete! (${failedCount} failed)` : 'Upload complete!');
                    onMultiUploadComplete(successful);
                }
                
                if (failedCount > 0) {
                    setUploadError(`⚠️ ${failedCount} file(s) failed to upload.`);
                    if (onUploadError) onUploadError(new Error(errors.join(', ')));
                    if (successful.length === 0) {
                        throw new Error('All files failed to upload.');
                    }
                }
            } else {
                const file = filesToUpload[0];
                const result = await uploadToCloudinary(file, folder);

                setUploadProgress('Upload complete!');
                onUploadComplete(result.secure_url, file, result.original_filename);
            }

            setTimeout(() => setUploadProgress(''), 2000);
        } catch (error: unknown) {
            setUploadProgress('');
            setUploadError('Upload failed. Please check your connection and try again.');
            if (onUploadError) onUploadError(error as Error);
        } finally {
            setIsUploading(false);
        }
    };

    return (
        <div className="w-full space-y-4">
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
                <div
                    onClick={() => !isUploading && fileInputRef.current?.click()}
                    className={`relative flex flex-col items-center justify-center w-full min-h-[120px] rounded-xl border-2 border-dashed
                    ${isUploading ? 'border-gray-200 bg-gray-50 cursor-not-allowed' : uploadError ? 'border-red-300 bg-red-50 cursor-pointer' : 'border-gray-300 hover:border-primary-500 hover:bg-primary-50 cursor-pointer'}
                    overflow-hidden transition-all group`}
                >
                    <input
                        ref={fileInputRef}
                        type="file"
                        multiple={multiple}
                        accept={accept}
                        onChange={handleFileSelect}
                        disabled={isUploading}
                        className="hidden"
                    />

                    {isUploading ? (
                        <div className="flex flex-col items-center justify-center text-primary-600 gap-2 p-4">
                            <Loader2 className="w-8 h-8 animate-spin" />
                            <span className="text-sm font-bold">{uploadProgress}</span>
                        </div>
                    ) : uploadProgress ? (
                        <div className="flex flex-col items-center justify-center text-emerald-600 gap-2 p-4">
                            <CheckCircle className="w-8 h-8" />
                            <span className="text-sm font-bold">{uploadProgress}</span>
                        </div>
                    ) : queuedFiles.length > 0 ? (
                        <div className="flex flex-col items-center justify-center text-primary-600 gap-2 p-6">
                            <div className="w-12 h-12 bg-primary-100 rounded-full flex items-center justify-center">
                                <Upload className="w-6 h-6 text-primary-600" />
                            </div>
                            <span className="text-sm font-bold">{queuedFiles.length} file(s) selected</span>
                            <span className="text-xs text-primary-400 font-medium tracking-wide">Click to add more files</span>
                        </div>
                    ) : isImage && currentFileUrl ? (
                        <div className="relative w-full h-full flex items-center justify-center p-2 bg-gray-50">
                            <img src={currentFileUrl} alt="Preview" className="max-h-32 object-contain rounded-lg shadow-sm" />
                            <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity backdrop-blur-sm">
                                <span className="text-white text-sm font-bold flex items-center gap-2 px-4 py-2 bg-white/20 rounded-xl">
                                    <Upload className="w-4 h-4" /> Change Image
                                </span>
                            </div>
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center text-gray-500 hover:text-primary-600 gap-3 p-8">
                            <div className="w-14 h-14 bg-gray-50 group-hover:bg-primary-100 rounded-full flex items-center justify-center transition-colors">
                                <Upload className="w-6 h-6 text-gray-400 group-hover:text-primary-600 transition-colors" />
                            </div>
                            <div className="text-center">
                                <span className="text-sm font-bold block text-gray-700 group-hover:text-primary-700">{currentFileUrl ? 'File Uploaded ✓' : description}</span>
                                <span className="text-xs text-gray-400 font-medium tracking-wide mt-1 block">Click to browse your device</span>
                            </div>
                            {currentFileUrl && !isImage && (
                                <div className="mt-2 flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-lg">
                                    <CheckCircle className="w-3.5 h-3.5" />
                                    <span className="text-xs font-bold truncate max-w-[200px]">
                                        {currentFileUrl.split('/').pop()}
                                    </span>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Error Message */}
            {uploadError && (
                <div className="flex items-center gap-2 text-red-600 bg-red-50 p-3 rounded-xl border border-red-100">
                    <X className="w-4 h-4 shrink-0" />
                    <span className="text-sm font-semibold">{uploadError}</span>
                </div>
            )}

            {/* File Queue & Uploaded List */}
            {((queuedFiles.length > 0 && !isUploading && !uploadProgress) || currentBatchUrls.length > 0) && (
                <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm mt-4">
                    <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex justify-between items-center">
                        <span className="text-xs font-black text-gray-500 uppercase tracking-widest">
                            Upload Queue ({queuedFiles.length}) {currentBatchUrls.length > 0 && `| Uploaded (${currentBatchUrls.length})`}
                        </span>
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                setQueuedFiles([]);
                            }}
                            className="text-xs font-bold text-gray-400 hover:text-red-500 transition-colors"
                        >
                            Clear All
                        </button>
                    </div>
                    <ul className="divide-y divide-gray-100 max-h-64 overflow-y-auto">
                        {currentBatchUrls.map((file, idx) => (
                            <li key={`batch-${idx}`} className="flex items-center justify-between p-3 hover:bg-emerald-50 transition-colors group bg-emerald-50/30">
                                <div className="flex items-center gap-3 min-w-0">
                                    <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center shrink-0 overflow-hidden border border-emerald-200/50">
                                        <CheckCircle className="w-5 h-5 text-emerald-600" />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <p className="text-sm font-bold text-emerald-900 truncate">{file.name}</p>
                                        <p className="text-xs font-semibold text-emerald-600">{file.size ? formatFileSize(file.size) : 'Uploaded'}</p>
                                    </div>
                                </div>
                                {onRemoveBatchItem && (
                                    <button
                                        type="button"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onRemoveBatchItem(idx);
                                        }}
                                        className="p-2 text-emerald-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                                        title="Remove uploaded file"
                                    >
                                        <X className="w-4 h-4" />
                                    </button>
                                )}
                            </li>
                        ))}
                        {queuedFiles.map((file, idx) => (
                            <li key={`queue-${idx}`} className="flex items-center justify-between p-3 hover:bg-gray-50 transition-colors group">
                                <div className="flex items-center gap-3 min-w-0">
                                    {/* Thumbnail / Icon */}
                                    <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center shrink-0 overflow-hidden border border-gray-200/50">
                                        {file.type.startsWith('image/') && previews[file.name] ? (
                                            <img src={previews[file.name]} alt="preview" className="w-full h-full object-cover" />
                                        ) : file.type.startsWith('video/') && previews[file.name] ? (
                                            <div className="relative w-full h-full bg-slate-900 flex items-center justify-center">
                                                <Film className="w-4 h-4 text-slate-400" />
                                            </div>
                                        ) : (
                                            <FileIcon className="w-4 h-4 text-gray-400" />
                                        )}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <p className="text-sm font-bold text-gray-900 truncate">{file.name}</p>
                                        <p className="text-xs font-semibold text-gray-400">{formatFileSize(file.size)}</p>
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        removeFileFromQueue(idx);
                                    }}
                                    className="p-2 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                                    title="Remove file"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            </li>
                        ))}
                    </ul>
                    
                    {/* Add More Files Button (Serial Selection) */}
                    {multiple && queuedFiles.length < 5 && (
                        <div className="p-2 bg-white border-t border-gray-100 flex justify-center">
                            <button
                                type="button"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    fileInputRef.current?.click();
                                }}
                                className="flex items-center gap-2 px-4 py-2 text-xs font-bold text-primary-600 bg-primary-50 rounded-lg hover:bg-primary-100 hover:text-primary-700 transition-colors"
                            >
                                <Plus className="w-4 h-4" />
                                Add Another File
                            </button>
                        </div>
                    )}
                    
                </div>
            )}
        </div>
    );
}

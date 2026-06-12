import { useState, useRef } from 'react';
import { Upload, Loader2, CheckCircle } from 'lucide-react';
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
}: FileUploadProps) {
    const [isUploading, setIsUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState<string>('');
    const [uploadError, setUploadError] = useState<string>('');
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const filesList = e.target.files;
        if (!filesList || filesList.length === 0) return;

        const files = Array.from(filesList);

        if (multiple && files.length > 5) {
            setUploadError('⚠️ Maximum limit of 5 files exceeded.');
            if (fileInputRef.current) fileInputRef.current.value = '';
            // Toast would ideally be triggered here, but returning error text is standard
            return;
        }

        // Validate sizes
        for (const file of files) {
            const isImageFile = file.type.startsWith('image/');
            const MAX_FILE_SIZE = isImageFile ? 10 * 1024 * 1024 : 100 * 1024 * 1024;
            const limitLabel = isImageFile ? '10 MB' : '100 MB';

            if (file.size > MAX_FILE_SIZE) {
                setUploadError(`File ${file.name} is too large. Maximum allowed size is ${limitLabel}.`);
                if (fileInputRef.current) fileInputRef.current.value = '';
                return;
            }
        }

        setIsUploading(true);
        setUploadProgress(multiple ? `Uploading ${files.length} files...` : 'Uploading to cloud storage...');
        setUploadError('');

        try {
            if (multiple && onMultiUploadComplete) {
                const uploadPromises = files.map(file => uploadToCloudinary(file, folder).then(result => ({
                    url: result.secure_url,
                    file,
                    originalFilename: result.original_filename || file.name
                })));
                
                const results = await Promise.all(uploadPromises);
                setUploadProgress('Upload complete!');
                onMultiUploadComplete(results);
            } else {
                const file = files[0];
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
            if (fileInputRef.current) {
                fileInputRef.current.value = '';
            }
        }
    };

    return (
        <div className="w-full">
            <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
            <div
                onClick={() => !isUploading && fileInputRef.current?.click()}
                className={`relative flex flex-col items-center justify-center w-full min-h-[120px] rounded-lg border-2 border-dashed
          ${isUploading ? 'border-gray-200 bg-gray-50 cursor-not-allowed' : uploadError ? 'border-red-300 bg-red-50 cursor-pointer' : 'border-gray-300 hover:border-primary-500 hover:bg-primary-50 cursor-pointer'}
          overflow-hidden transition-colors group`}
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
                        <span className="text-sm font-medium">{uploadProgress}</span>
                    </div>
                ) : uploadError ? (
                    <div className="flex flex-col items-center justify-center text-red-600 gap-2 p-4">
                        <span className="text-sm font-medium">{uploadError}</span>
                        <span className="text-xs text-red-400">Click to try again</span>
                    </div>
                ) : uploadProgress ? (
                    <div className="flex flex-col items-center justify-center text-green-600 gap-2 p-4">
                        <CheckCircle className="w-8 h-8" />
                        <span className="text-sm font-medium">{uploadProgress}</span>
                    </div>
                ) : isImage && currentFileUrl ? (
                    <div className="relative w-full h-full flex items-center justify-center p-2 bg-gray-50">
                        <img src={currentFileUrl} alt="Preview" className="max-h-32 object-contain" />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                            <span className="text-white text-sm font-medium flex items-center gap-1">
                                <Upload className="w-4 h-4" /> Change Image
                            </span>
                        </div>
                    </div>
                ) : (
                    <div className="flex flex-col items-center justify-center text-gray-500 hover:text-primary-600 gap-2 p-6">
                        <Upload className="w-8 h-8 text-gray-400 group-hover:text-primary-500 transition-colors" />
                        <span className="text-sm font-medium text-center">{currentFileUrl ? 'File Uploaded ✓' : description}</span>
                        {currentFileUrl && !isImage && (
                            <span className="text-xs text-green-600 font-medium truncate max-w-[200px]">
                                {currentFileUrl.split('/').pop()}
                            </span>
                        )}
                        <span className="text-xs text-gray-400">Click to browse your device</span>
                    </div>
                )}
            </div>
        </div>
    );
}

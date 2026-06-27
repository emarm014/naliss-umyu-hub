import * as FileSystem from 'expo-file-system/legacy';

const CLOUDINARY_CLOUD_NAME = process.env.EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME || 'dno3wqlm3';

// Central base path calculation
export const getVaultBase = (): string => {
    const fs = FileSystem as any;
    const docDir: string =
        fs.Paths?.document?.uri ||
        fs.documentDirectory ||
        fs.cacheDirectory ||
        '';
    const base = docDir.endsWith('/') ? docDir : `${docDir}/`;
    return `${base}naliss_vault/`;
};

export const AssetPathResolver = {
    /**
     * Resolve standard namespace folder for asset types.
     */
    getFolderForType(assetType: string): string {
        const type = assetType.toLowerCase();
        if (type.startsWith('chat_')) {
            if (type === 'chat_audio' || type === 'chat_voice') return 'voice_notes/';
            if (type === 'chat_video') return 'videos/';
            if (type === 'chat_document' || type === 'chat_pdf') return 'documents/';
            return 'chat_media/';
        }
        if (type === 'voice_note' || type === 'audio') return 'voice_notes/';
        if (type === 'video') return 'videos/';
        if (type === 'study_material' || type === 'lecture_note' || type === 'pdf' || type === 'document') {
            return 'study_materials/';
        }
        if (type === 'announcement_cover' || type === 'announcement_attachment') {
            return 'announcement_files/';
        }
        if (type === 'event_cover') return 'event_resources/';
        if (type === 'user_avatar' || type === 'group_avatar' || type === 'avatar') {
            return 'avatars/';
        }
        return 'documents/';
    },

    /**
     * Returns a fully qualified, standardized local filesystem path.
     */
    resolveLocalPath(assetId: string, assetType: string, remoteUrl: string): string {
        const vaultBase = getVaultBase();
        const folder = this.getFolderForType(assetType);
        
        // Extract extension safely
        const cleanUrl = remoteUrl.split('?')[0];
        const ext = cleanUrl.split('.').pop() || 'dat';
        
        // Return standardized file path
        return `${vaultBase}${folder}media_${assetId}.${ext}`;
    }
};

export interface CloudinaryMetadata {
    publicId: string;
    resourceType?: 'image' | 'video' | 'raw';
    version?: string;
    format?: string;
}

export const CloudinaryUrlRegenerator = {
    /**
     * Dynamic secure Cloudinary URL builder.
     */
    regenerateUrl(meta: CloudinaryMetadata, transformations: string[] = []): string {
        const cloudName = CLOUDINARY_CLOUD_NAME;
        const resType = meta.resourceType || 'image';
        const format = meta.format ? `.${meta.format}` : '';
        const versionStr = meta.version ? `v${meta.version}/` : '';
        
        let transPart = '';
        if (transformations.length > 0) {
            transPart = transformations.join(',') + '/';
        }
        
        return `https://res.cloudinary.com/${cloudName}/${resType}/upload/${transPart}${versionStr}${meta.publicId}${format}`;
    },

    /**
     * Extracts Cloudinary metadata elements safely from a string URL.
     */
    parseUrl(url: string): CloudinaryMetadata | null {
        if (!url.includes('cloudinary.com')) return null;
        try {
            const segments = url.split('/');
            const uploadIndex = segments.indexOf('upload');
            if (uploadIndex === -1 || uploadIndex + 1 >= segments.length) return null;

            const resourceType = segments[uploadIndex - 1] as any;
            
            // Skip transformations if present (segments starting with w_, c_, h_, q_, etc.)
            let targetIndex = uploadIndex + 1;
            while (targetIndex < segments.length && (
                segments[targetIndex].includes('_') || 
                segments[targetIndex] === 'f_auto' || 
                segments[targetIndex] === 'q_auto'
            )) {
                targetIndex++;
            }

            if (targetIndex >= segments.length) return null;

            // Resolve version segment (usually starts with 'v')
            let version = '';
            if (segments[targetIndex].startsWith('v') && /^\d+$/.test(segments[targetIndex].substring(1))) {
                version = segments[targetIndex].substring(1);
                targetIndex++;
            }

            const remainder = segments.slice(targetIndex).join('/');
            const dotIdx = remainder.lastIndexOf('.');
            let publicId = remainder;
            let format = '';
            
            if (dotIdx !== -1) {
                publicId = remainder.substring(0, dotIdx);
                format = remainder.substring(dotIdx + 1).split('?')[0];
            }

            return {
                publicId,
                resourceType,
                version: version || undefined,
                format: format || undefined
            };
        } catch (_) {
            return null;
        }
    }
};

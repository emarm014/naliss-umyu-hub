import { getVaultBase } from './vault';

export { getVaultBase };

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

    resolveLocalPath(assetId: string, assetType: string, remoteUrl: string): string {
        const vaultBase = getVaultBase();
        const folder = this.getFolderForType(assetType);
        
        let ext = '';
        if (remoteUrl) {
            const cleanUrl = remoteUrl.split('?')[0].split('#')[0];
            // Extract the filename part (after the last slash) to avoid matching dots in the domain (e.g. res.cloudinary.com)
            const fileName = cleanUrl.substring(cleanUrl.lastIndexOf('/') + 1);
            if (fileName.includes('.')) {
                const candidate = fileName.split('.').pop()?.toLowerCase() || '';
                // Only accept valid file extensions (alphanumeric, 1-6 chars)
                if (candidate && /^[a-z0-9]{1,6}$/i.test(candidate)) {
                    ext = candidate;
                }
            }
        }

        // Provide standard default extensions if no valid extension is present in the URL
        if (!ext || ext === 'dat') {
            const type = assetType.toLowerCase();
            if (type.includes('image') || type.includes('avatar') || type.includes('cover')) ext = 'jpg';
            else if (type.includes('video')) ext = 'mp4';
            else if (type.includes('audio') || type.includes('voice')) ext = 'mp3';
            else if (type.includes('document') || type.includes('pdf') || type.includes('lecture') || type.includes('study')) ext = 'pdf';
            else ext = 'dat';
        }

        return `${vaultBase}${folder}${assetId}.${ext}`;
    }
};



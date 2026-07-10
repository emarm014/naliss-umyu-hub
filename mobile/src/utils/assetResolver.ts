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
        const cleanUrl = remoteUrl.split('?')[0];
        const ext = cleanUrl.split('.').pop() || 'dat';
        return `${vaultBase}${folder}${assetId}.${ext}`;
    }
};



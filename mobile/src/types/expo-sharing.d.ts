declare module 'expo-sharing' {
    export interface SharingOptions {
        mimeType?: string;
        UTI?: string;
        dialogTitle?: string;
    }

    export function isAvailableAsync(): Promise<boolean>;
    export function shareAsync(url: string, options?: SharingOptions): Promise<void>;
}

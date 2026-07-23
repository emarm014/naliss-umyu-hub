import * as FileSystem from 'expo-file-system/legacy';

/**
 * Single source of truth for the local on-device vault directory.
 * Works on both SDK 55 (Paths API) and older builds.
 */
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

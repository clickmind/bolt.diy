import { atom } from 'nanostores';

/**
 * Global store for Expo preview URLs (used by BaseChat + QR modal).
 * Set to a URL string to open the modal; set to null to close it.
 */
export const expoUrlAtom = atom<string | null>(null);

/** Optional helper setter */
export const setExpoUrl = (url: string | null) => {
  expoUrlAtom.set(url);
};

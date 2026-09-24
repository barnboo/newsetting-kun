/**
 * IndexedDB storage engine for Setting-kun
 * Stores large binary data (PDF background image, cropped icons as DataURLs, and session state)
 * allowing full offline recovery and persistence across browser sessions.
 */

export interface SavedSession {
  fileData: {
    file_id: string;
    image_url: string;
    width: number;
    height: number;
  } | null;
  extractedData: {
    backgroundUrl: string;
    iconsRegionUrl: string;
    extractedIcons: Array<{
      id: string;
      url: string;
      rect: { x: number; y: number; width: number; height: number };
      label?: string;
    }>;
  } | null;
  iconLabels: Record<string, string>;
  selectedRegions: any[];
  currentPhase: number;
  updatedAt: number;
}

const DB_NAME = 'settingkun_indexeddb';
const DB_VERSION = 1;
const STORE_NAME = 'sessions';
const SESSION_KEY = 'active_session';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Fetch an image URL and convert to Base64 Data URL for permanent browser storage
 */
export async function urlToDataUrl(url: string): Promise<string> {
  if (!url || url.startsWith('data:') || url.startsWith('blob:')) return url;
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve((reader.result as string) || url);
      reader.onerror = () => resolve(url);
      reader.readAsDataURL(blob);
    });
  } catch (err) {
    console.warn('Could not convert URL to data URL:', url, err);
    return url;
  }
}

/**
 * Save active session to IndexedDB with all images converted to standalone DataURLs
 */
export async function saveSessionToIndexedDB(session: SavedSession): Promise<void> {
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(session, SESSION_KEY);

      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.error('Failed to save session to IndexedDB:', err);
  }
}

/**
 * Load the active session from IndexedDB
 */
export async function loadSessionFromIndexedDB(): Promise<SavedSession | null> {
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(SESSION_KEY);

      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('IndexedDB is not available or empty:', err);
    return null;
  }
}

/**
 * Clear the saved session from IndexedDB
 */
export async function clearSessionFromIndexedDB(): Promise<void> {
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(SESSION_KEY);

      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.error('Failed to clear session from IndexedDB:', err);
  }
}

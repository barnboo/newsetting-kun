/**
 * IndexedDB storage engine for Setting-kun
 * Stores large binary data (PDF background image, cropped icons as DataURLs, and session state)
 * with complete project separation (keyed by file_id).
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
const ACTIVE_ID_KEY = '__active_project_id__';

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
 * Crop an icon directly from an image URL (data URL or regular URL) on an HTML5 canvas.
 * Produces a transparent PNG Data URL without contacting the server.
 * Guarantees icon recovery even if server files are wiped on redeployment.
 */
export function cropIconFromImage(
  imageUrl: string,
  rect: { x: number; y: number; width: number; height: number }
): Promise<string> {
  return new Promise((resolve) => {
    if (!imageUrl) {
      resolve('');
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const w = Math.max(1, Math.round(rect.width));
        const h = Math.max(1, Math.round(rect.height));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve('');
          return;
        }
        ctx.drawImage(
          img,
          rect.x,
          rect.y,
          rect.width,
          rect.height,
          0,
          0,
          w,
          h
        );
        // Make white/near-white background transparent
        const imgData = ctx.getImageData(0, 0, w, h);
        const data = imgData.data;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i] > 240 && data[i + 1] > 240 && data[i + 2] > 240) {
            data[i + 3] = 0;
          }
        }
        ctx.putImageData(imgData, 0, 0);
        resolve(canvas.toDataURL('image/png'));
      } catch (err) {
        console.warn('cropIconFromImage canvas error:', err);
        resolve('');
      }
    };
    img.onerror = (err) => {
      console.warn('cropIconFromImage load error:', err);
      resolve('');
    };
    img.src = imageUrl;
  });
}

/**
 * Save session to IndexedDB, keyed by project file_id for strict project separation
 */
export async function saveSessionToIndexedDB(session: SavedSession): Promise<void> {
  try {
    const fileId = session.fileData?.file_id || 'default';
    const key = `session_${fileId}`;
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put(session, key);
      store.put(fileId, ACTIVE_ID_KEY);

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.error('Failed to save session to IndexedDB:', err);
  }
}

/**
 * Update session timestamp in IndexedDB
 */
export async function updateSessionTimestampInIndexedDB(fileId: string): Promise<void> {
  try {
    const db = await openDatabase();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(`session_${fileId}`);
      req.onsuccess = () => {
        const sess = req.result as SavedSession | undefined;
        if (sess) {
          sess.updatedAt = Date.now();
          store.put(sess, `session_${fileId}`);
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // Ignore error
  }
}

/**
 * Load a session from IndexedDB. If fileId is provided, loads that specific project;
 * otherwise loads the most recently active project session.
 */
export async function loadSessionFromIndexedDB(fileId?: string): Promise<SavedSession | null> {
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);

      if (fileId) {
        const req = store.get(`session_${fileId}`);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
        return;
      }

      // Check active project id first
      const activeReq = store.get(ACTIVE_ID_KEY);
      activeReq.onsuccess = () => {
        const activeId = activeReq.result;
        if (activeId) {
          const req = store.get(`session_${activeId}`);
          req.onsuccess = () => resolve(req.result || null);
          req.onerror = () => reject(req.error);
        } else {
          // Fallback: search all records for the most recently updated
          const allReq = store.openCursor();
          let latestSession: SavedSession | null = null;
          allReq.onsuccess = (e) => {
            const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
            if (cursor) {
              if (cursor.key !== ACTIVE_ID_KEY && cursor.value?.updatedAt) {
                if (!latestSession || cursor.value.updatedAt > latestSession.updatedAt) {
                  latestSession = cursor.value;
                }
              }
              cursor.continue();
            } else {
              resolve(latestSession);
            }
          };
          allReq.onerror = () => resolve(null);
        }
      };
      activeReq.onerror = () => resolve(null);
    });
  } catch (err) {
    console.warn('IndexedDB is not available or empty:', err);
    return null;
  }
}

/**
 * Get all saved project sessions from IndexedDB
 */
export async function getAllSessionsFromIndexedDB(): Promise<SavedSession[]> {
  try {
    const db = await openDatabase();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const allReq = store.openCursor();
      const sessions: SavedSession[] = [];

      allReq.onsuccess = (e) => {
        const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
        if (cursor) {
          if (cursor.key !== ACTIVE_ID_KEY && cursor.value?.fileData) {
            sessions.push(cursor.value);
          }
          cursor.continue();
        } else {
          // Sort by latest updated first
          sessions.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
          resolve(sessions);
        }
      };
      allReq.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
}

/**
 * Clear a specific project session from IndexedDB (or the active session)
 */
export async function clearSessionFromIndexedDB(fileId?: string): Promise<void> {
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);

      if (fileId) {
        store.delete(`session_${fileId}`);
        const activeReq = store.get(ACTIVE_ID_KEY);
        activeReq.onsuccess = () => {
          if (activeReq.result === fileId) {
            store.delete(ACTIVE_ID_KEY);
          }
        };
      } else {
        const activeReq = store.get(ACTIVE_ID_KEY);
        activeReq.onsuccess = () => {
          const activeId = activeReq.result;
          if (activeId) {
            store.delete(`session_${activeId}`);
          }
          store.delete(ACTIVE_ID_KEY);
        };
      }

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.error('Failed to clear session from IndexedDB:', err);
  }
}

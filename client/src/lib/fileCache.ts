// ─── IndexedDB file cache ───
// Caches raw downloaded file ArrayBuffers so they survive page refreshes
// and don't need to be re-fetched from the server.

const DB_NAME = "sc_file_cache";
const DB_VERSION = 1;
const STORE_NAME = "files";

function openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

/** Get a cached file by its URL key. Returns the ArrayBuffer or null. */
export async function getCachedFile(url: string): Promise<ArrayBuffer | null> {
    try {
        const db = await openDB();
        return new Promise((resolve) => {
            const tx = db.transaction(STORE_NAME, "readonly");
            const store = tx.objectStore(STORE_NAME);
            const req = store.get(url);
            req.onsuccess = () => resolve(req.result ?? null);
            req.onerror = () => resolve(null);
        });
    } catch {
        return null;
    }
}

/** Store a file's ArrayBuffer in the cache. */
export async function setCachedFile(url: string, data: ArrayBuffer): Promise<void> {
    try {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, "readwrite");
            const store = tx.objectStore(STORE_NAME);
            const req = store.put(data, url);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    } catch {
        // Silently fail — caching is best-effort
    }
}

/**
 * Fetch a file with caching. Checks IndexedDB first, falls back to network
 * fetch, and stores the result for future use.
 */
export async function fetchFileWithCache(url: string): Promise<ArrayBuffer> {
    // Try cache first
    const cached = await getCachedFile(url);
    if (cached) return cached;

    // Network fetch
    const res = await fetch(url);
    const buffer = await res.arrayBuffer();

    // Store in cache (fire-and-forget)
    setCachedFile(url, buffer).catch(() => {});

    return buffer;
}

/** Get total cache size in bytes and file count. */
export async function getCacheStats(): Promise<{ size: number; count: number }> {
    try {
        const db = await openDB();
        return new Promise((resolve) => {
            const tx = db.transaction(STORE_NAME, "readonly");
            const store = tx.objectStore(STORE_NAME);
            const cursorReq = store.openCursor();
            let size = 0;
            let count = 0;
            cursorReq.onsuccess = () => {
                const cursor = cursorReq.result;
                if (cursor) {
                    const value = cursor.value as ArrayBuffer;
                    size += value.byteLength;
                    count++;
                    cursor.continue();
                } else {
                    resolve({ size, count });
                }
            };
            cursorReq.onerror = () => resolve({ size: 0, count: 0 });
        });
    } catch {
        return { size: 0, count: 0 };
    }
}

/** Clear all cached files. */
export async function clearFileCache(): Promise<void> {
    try {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, "readwrite");
            const store = tx.objectStore(STORE_NAME);
            const req = store.clear();
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    } catch {
        // Silently fail
    }
}

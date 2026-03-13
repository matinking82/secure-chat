// ─── IndexedDB file cache ───
// Caches file ArrayBuffers so they survive page refreshes.
// Each entry stores { data: ArrayBuffer, decrypted: boolean } so that
// already-decrypted files can be served instantly without re-running
// expensive PBKDF2 key derivation + AES-GCM decryption.
// Old entries (plain ArrayBuffer) are treated as decrypted: false for
// backward compatibility.

import { decryptFile } from "./crypto";

// ─── In-memory decrypted file URL cache ───
// Caches blob URLs of already-decrypted files so that re-mounting a
// MessageBubble doesn't trigger blob re-creation within the same session.
// Keyed by chatId → fileUrl → blob URL.
const decryptedUrlCache = new Map<string, Map<string, string>>();
const cachedBlobUrls = new Set<string>();

/** Return a previously cached decrypted blob URL, or null. */
export function getDecryptedUrl(chatId: string, fileUrl: string): string | null {
    return decryptedUrlCache.get(chatId)?.get(fileUrl) ?? null;
}

/** Store a decrypted blob URL in the in-memory cache. */
export function setDecryptedUrl(chatId: string, fileUrl: string, blobUrl: string): void {
    let chatMap = decryptedUrlCache.get(chatId);
    if (!chatMap) {
        chatMap = new Map();
        decryptedUrlCache.set(chatId, chatMap);
    }
    const prev = chatMap.get(fileUrl);
    if (prev && prev !== blobUrl) {
        cachedBlobUrls.delete(prev);
        URL.revokeObjectURL(prev);
    }
    chatMap.set(fileUrl, blobUrl);
    cachedBlobUrls.add(blobUrl);
}

/** Revoke and remove all cached decrypted URLs for a chat (e.g. on key change). */
export function clearDecryptedUrlsForChat(chatId: string): void {
    const chatMap = decryptedUrlCache.get(chatId);
    if (chatMap) {
        for (const url of chatMap.values()) {
            cachedBlobUrls.delete(url);
            URL.revokeObjectURL(url);
        }
        decryptedUrlCache.delete(chatId);
    }
}

/** Revoke and remove every cached decrypted URL. */
export function clearAllDecryptedUrls(): void {
    for (const chatMap of decryptedUrlCache.values()) {
        for (const url of chatMap.values()) {
            URL.revokeObjectURL(url);
        }
    }
    decryptedUrlCache.clear();
    cachedBlobUrls.clear();
}

/** Check whether a blob URL lives in the decrypted cache (should not be revoked externally). */
export function isDecryptedUrlCached(blobUrl: string): boolean {
    return cachedBlobUrls.has(blobUrl);
}

// ─── IndexedDB cache entry format ───

interface CachedFileEntry {
    data: ArrayBuffer;
    decrypted: boolean;
}

/** Normalize an IndexedDB value into CachedFileEntry, handling old plain-ArrayBuffer entries. */
function normalizeCacheEntry(value: unknown): CachedFileEntry | null {
    if (!value) return null;
    // Old format: plain ArrayBuffer (cached before decrypted flag was added)
    if (value instanceof ArrayBuffer) {
        return { data: value, decrypted: false };
    }
    // New format: { data: ArrayBuffer, decrypted: boolean }
    const entry = value as Record<string, unknown>;
    if (entry.data instanceof ArrayBuffer && typeof entry.decrypted === "boolean") {
        return { data: entry.data, decrypted: entry.decrypted };
    }
    return null;
}

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

/** Get a cached file entry by its URL key. Returns { data, decrypted } or null. */
async function getCachedFileEntry(url: string): Promise<CachedFileEntry | null> {
    try {
        const db = await openDB();
        return new Promise((resolve) => {
            const tx = db.transaction(STORE_NAME, "readonly");
            const store = tx.objectStore(STORE_NAME);
            const req = store.get(url);
            req.onsuccess = () => resolve(normalizeCacheEntry(req.result));
            req.onerror = () => resolve(null);
        });
    } catch {
        return null;
    }
}

/** Store a file entry in the IndexedDB cache with its decrypted flag. */
async function setCachedFileEntry(url: string, data: ArrayBuffer, decrypted: boolean): Promise<void> {
    try {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, "readwrite");
            const store = tx.objectStore(STORE_NAME);
            const req = store.put({ data, decrypted }, url);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    } catch {
        // Silently fail — caching is best-effort
    }
}

/**
 * Fetch a file with caching and optional decryption.
 *
 * 1. Checks IndexedDB — if the entry is already decrypted, returns it immediately.
 * 2. If the entry is not yet decrypted, tries to decrypt with the supplied key.
 *    On success the cache entry is upgraded to decrypted: true.
 * 3. Falls back to a network fetch, attempts decryption, and caches the result.
 *
 * Returns { data, decrypted } where `data` is the best available content and
 * `decrypted` indicates whether it has been successfully decrypted.
 */
export async function fetchFileWithCache(
    url: string,
    key: string,
    chatId: string
): Promise<CachedFileEntry> {
    // ── Try IndexedDB cache ──
    const entry = await getCachedFileEntry(url);
    if (entry) {
        if (entry.decrypted) return entry;

        // Cached but not yet decrypted — try with the current key
        if (key) {
            const dec = await decryptFile(entry.data, key, chatId);
            if (dec) {
                // Upgrade cache entry to decrypted
                setCachedFileEntry(url, dec, true).catch(() => {});
                return { data: dec, decrypted: true };
            }
        }
        return entry;
    }

    // ── Network fetch ──
    const res = await fetch(url);
    const buffer = await res.arrayBuffer();

    // Try to decrypt before caching
    if (key) {
        const dec = await decryptFile(buffer, key, chatId);
        if (dec) {
            setCachedFileEntry(url, dec, true).catch(() => {});
            return { data: dec, decrypted: true };
        }
    }

    // Cache raw (encrypted) for later retry when the correct key is set
    setCachedFileEntry(url, buffer, false).catch(() => {});
    return { data: buffer, decrypted: false };
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
                    const entry = normalizeCacheEntry(cursor.value);
                    if (entry) size += entry.data.byteLength;
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

/** Clear all cached files (IndexedDB + in-memory decrypted URLs). */
export async function clearFileCache(): Promise<void> {
    clearAllDecryptedUrls();
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

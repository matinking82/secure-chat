// ─── GIF & Sticker local storage (IndexedDB) ───
// Saves GIFs and stickers locally per user. When sent, they are re-uploaded as files.

const DB_NAME = "sc_gif_sticker_db";
const DB_VERSION = 1;
const GIF_STORE = "gifs";
const STICKER_STORE = "stickers";

export interface GifStickerItem {
    id: string;       // unique ID (timestamp-based)
    blob: Blob;        // the actual file data
    thumbnail?: Blob;  // optional thumbnail for stickers
    name: string;      // original file name
    mime: string;      // mime type
    addedAt: number;   // timestamp when added
}

function openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(GIF_STORE)) {
                db.createObjectStore(GIF_STORE, { keyPath: "id" });
            }
            if (!db.objectStoreNames.contains(STICKER_STORE)) {
                db.createObjectStore(STICKER_STORE, { keyPath: "id" });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function getAllFromStore(storeName: string): Promise<GifStickerItem[]> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, "readonly");
        const store = tx.objectStore(storeName);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result as GifStickerItem[]);
        req.onerror = () => reject(req.error);
    });
}

async function addToStore(storeName: string, item: GifStickerItem): Promise<void> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, "readwrite");
        const store = tx.objectStore(storeName);
        const req = store.put(item);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

async function removeFromStore(storeName: string, id: string): Promise<void> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, "readwrite");
        const store = tx.objectStore(storeName);
        const req = store.delete(id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

// ─── Public API ───

export async function getSavedGifs(): Promise<GifStickerItem[]> {
    const items = await getAllFromStore(GIF_STORE);
    return items.sort((a, b) => b.addedAt - a.addedAt);
}

export async function saveGif(file: File | Blob, name: string): Promise<GifStickerItem> {
    const item: GifStickerItem = {
        id: `gif_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        blob: file,
        name,
        mime: file.type || "video/mp4",
        addedAt: Date.now(),
    };
    await addToStore(GIF_STORE, item);
    return item;
}

export async function removeGif(id: string): Promise<void> {
    await removeFromStore(GIF_STORE, id);
}

export async function getSavedStickers(): Promise<GifStickerItem[]> {
    const items = await getAllFromStore(STICKER_STORE);
    return items.sort((a, b) => b.addedAt - a.addedAt);
}

export async function saveSticker(file: File | Blob, name: string): Promise<GifStickerItem> {
    const item: GifStickerItem = {
        id: `sticker_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        blob: file,
        name,
        mime: file.type || "image/webp",
        addedAt: Date.now(),
    };
    await addToStore(STICKER_STORE, item);
    return item;
}

export async function removeSticker(id: string): Promise<void> {
    await removeFromStore(STICKER_STORE, id);
}

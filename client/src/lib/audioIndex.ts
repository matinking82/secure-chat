export interface ChatAudioIndexItem {
    trackKey: string;
    fileUrl: string;
    encryptedFileUrl?: string;
    title: string;
    chatId: string;
    chatLabel?: string;
    isVoice?: boolean;
    createdAt: string;
    artist?: string;
    album?: string;
    durationSec?: number;
}

const AUDIO_INDEX_STORAGE_KEY = "sc_audio_index_v1";
const FALLBACK_CREATED_AT = "1970-01-01T00:00:00.000Z";

type AudioIndexStore = Record<string, ChatAudioIndexItem[]>;

function toTime(value: string): number {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function loadStore(): AudioIndexStore {
    const raw = localStorage.getItem(AUDIO_INDEX_STORAGE_KEY);
    if (!raw) return {};
    try {
        return JSON.parse(raw) as AudioIndexStore;
    } catch {
        return {};
    }
}

function saveStore(store: AudioIndexStore): void {
    localStorage.setItem(AUDIO_INDEX_STORAGE_KEY, JSON.stringify(store));
}

function selectEncryptedFileUrl(item: ChatAudioIndexItem, prev?: ChatAudioIndexItem): string | undefined {
    return item.encryptedFileUrl
        || prev?.encryptedFileUrl
        || (!item.fileUrl.startsWith("blob:") ? item.fileUrl : undefined)
        || (prev?.fileUrl && !prev.fileUrl.startsWith("blob:") ? prev.fileUrl : undefined);
}

export function upsertChatAudioIndex(chatId: string, items: ChatAudioIndexItem[]): void {
    const normalizedItems = items.map((item) => ({
        ...item,
        createdAt: item.createdAt || FALLBACK_CREATED_AT,
    }));
    if (!normalizedItems.length) return;
    const store = loadStore();
    const existing = store[chatId] || [];
    const merged = new Map<string, ChatAudioIndexItem>();
    for (const item of existing) merged.set(item.trackKey, item);
    for (const item of normalizedItems) {
        const prev = merged.get(item.trackKey);
        const nextEncryptedFileUrl = selectEncryptedFileUrl(item, prev);
        merged.set(item.trackKey, {
            ...prev,
            ...item,
            encryptedFileUrl: nextEncryptedFileUrl,
        });
    }
    store[chatId] = Array.from(merged.values()).sort((a, b) => toTime(a.createdAt) - toTime(b.createdAt));
    saveStore(store);
    if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("sc-audio-index-updated", { detail: { chatId } }));
    }
}

export function getChatAudioIndex(chatId: string): ChatAudioIndexItem[] {
    const store = loadStore();
    const items = store[chatId] || [];
    return [...items].sort((a, b) => toTime(a.createdAt) - toTime(b.createdAt));
}

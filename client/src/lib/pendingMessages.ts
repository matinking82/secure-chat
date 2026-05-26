import type { ChatMessage } from "../types";

const PENDING_MESSAGES_STORAGE_KEY = "sc_pending_messages_v1";

type PendingMessageMap = Record<string, ChatMessage[]>;

function readPendingMap(): PendingMessageMap {
    try {
        const raw = localStorage.getItem(PENDING_MESSAGES_STORAGE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") return {};
        return parsed as PendingMessageMap;
    } catch {
        return {};
    }
}

function writePendingMap(map: PendingMessageMap) {
    localStorage.setItem(PENDING_MESSAGES_STORAGE_KEY, JSON.stringify(map));
}

export function getPendingMessages(chatId: string): ChatMessage[] {
    const map = readPendingMap();
    const messages = map[chatId];
    if (!Array.isArray(messages)) return [];
    return messages;
}

export function upsertPendingMessage(chatId: string, message: ChatMessage) {
    const map = readPendingMap();
    const messages = Array.isArray(map[chatId]) ? map[chatId] : [];
    const idx = messages.findIndex((m) => m.id === message.id);
    if (idx >= 0) {
        messages[idx] = message;
    } else {
        messages.push(message);
    }
    map[chatId] = messages;
    writePendingMap(map);
}

export function removePendingMessage(chatId: string, messageId: number) {
    const map = readPendingMap();
    const messages = Array.isArray(map[chatId]) ? map[chatId] : [];
    const filtered = messages.filter((m) => m.id !== messageId);
    if (filtered.length > 0) {
        map[chatId] = filtered;
    } else {
        delete map[chatId];
    }
    writePendingMap(map);
}

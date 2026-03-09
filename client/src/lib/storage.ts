import type { SavedChat, UserSettings, EncryptionKeys } from "../types";
import { DEFAULT_APPEARANCE_SETTINGS, sanitizeAppearanceSettings } from "./appearance";

// ─── Browser Identity (Public/Private Key Pair) ───

const KEYS_STORAGE_KEY = "sc_browser_keys";
const BROWSER_ID_KEY = "sc_browser_id";
const PUBLIC_KEY_KEY = "sc_public_key";

// Derive a short fingerprint from a public key JWK for use as browserId
async function deriveFingerprint(publicKeyJwk: JsonWebKey): Promise<string> {
    const data = new TextEncoder().encode(JSON.stringify(publicKeyJwk));
    const hash = await crypto.subtle.digest("SHA-256", data);
    const arr = new Uint8Array(hash);
    // Convert first 16 bytes to hex string for a compact ID
    return Array.from(arr.slice(0, 16))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}

// Generate ECDSA key pair and store in localStorage
async function generateAndStoreKeys(): Promise<{ browserId: string; publicKey: string }> {
    const keyPair = await crypto.subtle.generateKey(
        { name: "ECDSA", namedCurve: "P-256" },
        true, // extractable
        ["sign", "verify"]
    );

    const publicKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
    const privateKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);

    // Store keys
    localStorage.setItem(
        KEYS_STORAGE_KEY,
        JSON.stringify({ publicKey: publicKeyJwk, privateKey: privateKeyJwk })
    );

    const fingerprint = await deriveFingerprint(publicKeyJwk);
    const publicKeyStr = JSON.stringify(publicKeyJwk);
    localStorage.setItem(BROWSER_ID_KEY, fingerprint);
    localStorage.setItem(PUBLIC_KEY_KEY, publicKeyStr);

    return { browserId: fingerprint, publicKey: publicKeyStr };
}

// Initialize browser identity - call once at app startup
export async function initBrowserIdentity(): Promise<{ browserId: string; publicKey: string }> {
    const existingKeys = localStorage.getItem(KEYS_STORAGE_KEY);
    if (existingKeys) {
        try {
            const { publicKey } = JSON.parse(existingKeys);
            const fingerprint = await deriveFingerprint(publicKey);
            const publicKeyStr = JSON.stringify(publicKey);
            localStorage.setItem(BROWSER_ID_KEY, fingerprint);
            localStorage.setItem(PUBLIC_KEY_KEY, publicKeyStr);
            return { browserId: fingerprint, publicKey: publicKeyStr };
        } catch {
            // Corrupted keys, regenerate
        }
    }

    // Check if there's a legacy browserId (from before key-based auth)
    // In that case, still generate keys but keep the old ID for compatibility
    return generateAndStoreKeys();
}

// Synchronous getter - returns cached browserId (fingerprint of public key)
// Falls back to legacy UUID or generates one if keys haven't been initialized yet
export function getBrowserId(): string {
    let id = localStorage.getItem(BROWSER_ID_KEY);
    if (!id) {
        // Fallback: generate a temporary UUID until async init completes
        id = crypto.randomUUID();
        localStorage.setItem(BROWSER_ID_KEY, id);
    }
    return id;
}

// Get the stored public key (as JSON string)
export function getPublicKey(): string | null {
    return localStorage.getItem(PUBLIC_KEY_KEY);
}

// Get the stored key pair
export function getStoredKeys(): { publicKey: JsonWebKey; privateKey: JsonWebKey } | null {
    const raw = localStorage.getItem(KEYS_STORAGE_KEY);
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

// Sign a challenge string with the private key (ECDSA P-256 + SHA-256)
export async function signChallenge(challenge: string): Promise<string | null> {
    const keys = getStoredKeys();
    if (!keys?.privateKey) return null;
    try {
        const privateKey = await crypto.subtle.importKey(
            "jwk",
            keys.privateKey,
            { name: "ECDSA", namedCurve: "P-256" },
            false,
            ["sign"]
        );
        const data = new TextEncoder().encode(challenge);
        const signature = await crypto.subtle.sign(
            { name: "ECDSA", hash: "SHA-256" },
            privateKey,
            data
        );
        // Convert to base64
        return btoa(String.fromCharCode(...new Uint8Array(signature)));
    } catch {
        return null;
    }
}

// ─── User Settings ───

const SETTINGS_KEY = "sc_user_settings";

export function getUserSettings(): UserSettings {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
        try {
            const parsed = JSON.parse(raw) as Partial<UserSettings>;
            return {
                displayName: parsed.displayName || "Anonymous",
                browserId: getBrowserId(),
                pushEnabled: Boolean(parsed.pushEnabled),
                appearance: sanitizeAppearanceSettings(parsed.appearance),
            };
        } catch {
            // fall through
        }
    }
    return {
        displayName: "Anonymous",
        browserId: getBrowserId(),
        pushEnabled: false,
        appearance: DEFAULT_APPEARANCE_SETTINGS,
    };
}

export function saveUserSettings(settings: Partial<UserSettings>): UserSettings {
    const current = getUserSettings();
    const updated: UserSettings = {
        ...current,
        ...settings,
        browserId: getBrowserId(),
        appearance: sanitizeAppearanceSettings({
            ...current.appearance,
            ...(settings.appearance || {}),
        }),
    };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(updated));
    return updated;
}

// ─── Saved Chats ───

const CHATS_KEY = "sc_saved_chats";

export function getSavedChats(): SavedChat[] {
    const raw = localStorage.getItem(CHATS_KEY);
    if (raw) {
        try {
            return JSON.parse(raw);
        } catch {
            return [];
        }
    }
    return [];
}

export function saveChatList(chats: SavedChat[]) {
    localStorage.setItem(CHATS_KEY, JSON.stringify(chats));
}

export function addChat(chatId: string, label?: string): SavedChat[] {
    const chats = getSavedChats();
    if (!chats.find((c) => c.chatId === chatId)) {
        chats.unshift({
            chatId,
            label: label || chatId,
            unreadCount: 0,
        });
        saveChatList(chats);
    }
    return chats;
}

export function removeChat(chatId: string): SavedChat[] {
    const chats = getSavedChats().filter((c) => c.chatId !== chatId);
    saveChatList(chats);
    return chats;
}

export function updateChatMeta(
    chatId: string,
    updates: Partial<SavedChat>
): SavedChat[] {
    const chats = getSavedChats();
    const idx = chats.findIndex((c) => c.chatId === chatId);
    if (idx !== -1) {
        chats[idx] = { ...chats[idx], ...updates };
        saveChatList(chats);
    }
    return chats;
}

// ─── Encryption Keys ───

const KEYS_KEY = "sc_encryption_keys";

export function getEncryptionKeys(): EncryptionKeys {
    const raw = localStorage.getItem(KEYS_KEY);
    if (raw) {
        try {
            return JSON.parse(raw);
        } catch {
            return {};
        }
    }
    return {};
}

export const DEFAULT_ENCRYPTION_KEY = 'securechat-default-key-2024';

export function getEncryptionKey(chatId: string): string {
    return getEncryptionKeys()[chatId] || DEFAULT_ENCRYPTION_KEY;
}

export function setEncryptionKey(chatId: string, key: string): EncryptionKeys {
    const keys = getEncryptionKeys();
    if (key) {
        keys[chatId] = key;
    } else {
        delete keys[chatId];
    }
    localStorage.setItem(KEYS_KEY, JSON.stringify(keys));
    // Dispatch event so components can re-decrypt with the new key
    window.dispatchEvent(
        new CustomEvent("encryption-key-changed", { detail: { chatId } })
    );
    return keys;
}

// ─── Export / Import all local data ───

const ALL_STORAGE_KEYS = [
    KEYS_STORAGE_KEY,    // sc_browser_keys
    BROWSER_ID_KEY,      // sc_browser_id
    PUBLIC_KEY_KEY,      // sc_public_key
    SETTINGS_KEY,        // sc_user_settings
    CHATS_KEY,           // sc_saved_chats
    KEYS_KEY,            // sc_encryption_keys
    "sc_emoji_history",  // emoji usage counts
];

/** Export all SecureChat data from localStorage as a JSON string */
export function exportAllData(): string {
    const data: Record<string, string | null> = {};

    // Export known keys
    for (const key of ALL_STORAGE_KEYS) {
        data[key] = localStorage.getItem(key);
    }

    // Export push subscription IDs (dynamic keys: sc_push_sub_*)
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith("sc_push_sub_")) {
            data[key] = localStorage.getItem(key);
        }
    }

    return JSON.stringify(data, null, 2);
}

/** Import SecureChat data from a JSON string into localStorage */
export function importAllData(jsonStr: string): void {
    const data = JSON.parse(jsonStr) as Record<string, string | null>;

    for (const [key, value] of Object.entries(data)) {
        // Only import keys that belong to SecureChat
        if (!key.startsWith("sc_")) continue;
        if (value === null || value === undefined) {
            localStorage.removeItem(key);
        } else {
            localStorage.setItem(key, value);
        }
    }
}

export function getPushSubId(chatId: string): string | null {
    return localStorage.getItem(`sc_push_sub_${chatId}`);
}

export function setPushSubId(chatId: string, subId: string | null) {
    if (subId) {
        localStorage.setItem(`sc_push_sub_${chatId}`, subId);
    } else {
        localStorage.removeItem(`sc_push_sub_${chatId}`);
    }
}

// ─── Drafts (per-chat text drafts) ───

const DRAFTS_KEY = "sc_drafts";

export function getDraft(chatId: string): string {
    const raw = localStorage.getItem(DRAFTS_KEY);
    if (raw) {
        try {
            const drafts = JSON.parse(raw);
            return drafts[chatId] || "";
        } catch {
            return "";
        }
    }
    return "";
}

export function setDraft(chatId: string, text: string) {
    const raw = localStorage.getItem(DRAFTS_KEY);
    let drafts: Record<string, string> = {};
    if (raw) {
        try {
            drafts = JSON.parse(raw);
        } catch { /* ignore */ }
    }
    if (text.trim()) {
        drafts[chatId] = text;
    } else {
        delete drafts[chatId];
    }
    localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
}

// ─── Per-chat display name ───

const CHAT_DISPLAY_NAMES_KEY = "sc_chat_display_names";

export function getChatDisplayName(chatId: string): string {
    const raw = localStorage.getItem(CHAT_DISPLAY_NAMES_KEY);
    if (raw) {
        try {
            const names = JSON.parse(raw);
            return names[chatId] || "";
        } catch {
            return "";
        }
    }
    return "";
}

export function setChatDisplayName(chatId: string, name: string) {
    const raw = localStorage.getItem(CHAT_DISPLAY_NAMES_KEY);
    let names: Record<string, string> = {};
    if (raw) {
        try {
            names = JSON.parse(raw);
        } catch { /* ignore */ }
    }
    if (name.trim()) {
        names[chatId] = name.trim();
    } else {
        delete names[chatId];
    }
    localStorage.setItem(CHAT_DISPLAY_NAMES_KEY, JSON.stringify(names));
}

// ─── PV (Private) Chat Key Mapping ───

const PV_KEYS_KEY = "sc_pv_keys";

interface PvKeyEntry {
    chatKey: string; // Random key used as chatId
    confirmed: boolean;
}

export function getPvKeyMap(): Record<string, PvKeyEntry> {
    const raw = localStorage.getItem(PV_KEYS_KEY);
    if (raw) {
        try {
            return JSON.parse(raw);
        } catch {
            return {};
        }
    }
    return {};
}

export function getPvChatKey(otherBrowserId: string): PvKeyEntry | null {
    const map = getPvKeyMap();
    return map[otherBrowserId] || null;
}

export function setPvChatKey(otherBrowserId: string, chatKey: string, confirmed: boolean) {
    const map = getPvKeyMap();
    map[otherBrowserId] = { chatKey, confirmed };
    localStorage.setItem(PV_KEYS_KEY, JSON.stringify(map));
}

export function confirmPvChatKey(otherBrowserId: string) {
    const map = getPvKeyMap();
    if (map[otherBrowserId]) {
        map[otherBrowserId].confirmed = true;
        localStorage.setItem(PV_KEYS_KEY, JSON.stringify(map));
    }
}

export function generatePvChatKey(): string {
    return "pv-" + crypto.randomUUID();
}
